/** @odoo-module **/

import {EventBus} from "@odoo/owl";
import {registry} from "@web/core/registry";
import {parseBarcode} from "@barcode_scanner/js/barcode_parser";

export const barcodeService = {
    dependencies: [],
    start() {
        const bus = new EventBus();

        function isEditable(element) {
            if (!element || element.nodeType !== 1) {
                return false;
            }
            return (
                element.matches('input, textarea, [contenteditable="true"]') ||
                element.isContentEditable
            );
        }

        // Emit a scan on the bus. Keep the GS1 FNC1 group separator in the string
        // the parser receives; only strip a trailing newline suffix and measure
        // length on the significant characters.
        function emit(raw) {
            const code = String(raw || "").replace(/[\r\n]+$/, "");
            const significant = code.replace(/[\r\n]/g, "");
            if (significant.length < 3) {
                return;
            }
            bus.trigger("barcode_scanned", {barcode: code, parsed: parseBarcode(code)});
        }

        // --- HID keyboard-wedge path: real key events, one char each, usually
        // terminated by Enter. Always listening; harmless on normal pages
        // because it ignores editable targets and only fires on Enter. ---
        let buffer = "";
        let hidTimeout = null;
        let lastKeyTime = 0;
        const SCANNER_KEY_DELAY = 150;

        function resetHid() {
            buffer = "";
            clearTimeout(hidTimeout);
            hidTimeout = null;
        }

        // --- Android IME / soft-input path: PDAs in "input box" mode inject the
        // whole barcode as a single `input` event (inputType "insertText") into
        // the focused field, with no usable key events. A hidden input is kept
        // focused while the app is open so those scans always land where we can
        // read them. Focus is reclaimed only when it is actually lost (after a
        // navigation), never on a timer, so the on-screen keyboard the field
        // raises stays dismissable by the user. Scoped via activate()/
        // deactivate() so it never steals focus on the rest of the back office.
        let captureInput = null;
        let imeBuffer = "";
        let imeTimeout = null;
        let active = false;

        function flushIme() {
            clearTimeout(imeTimeout);
            imeTimeout = null;
            const value = imeBuffer || (captureInput ? captureInput.value : "");
            imeBuffer = "";
            if (captureInput) {
                captureInput.value = "";
            }
            if (value) {
                emit(value);
            }
        }

        function scheduleImeFlush() {
            clearTimeout(imeTimeout);
            imeTimeout = setTimeout(flushIme, 120);
        }

        function onImeInput(ev) {
            if (typeof ev.data === "string") {
                imeBuffer += ev.data;
            }
            // A newline suffix, in the data or the value, ends the scan now.
            const value = captureInput ? captureInput.value : "";
            if (/[\r\n]/.test(ev.data || "") || /[\r\n]/.test(value)) {
                flushIme();
                return;
            }
            scheduleImeFlush();
        }

        function keepFocus() {
            if (!active || !captureInput || !document.body.contains(captureInput)) {
                return;
            }
            // Never fight an open dialog (confirmations, the camera scanner…).
            if (document.querySelector(".o_dialog, .modal")) {
                return;
            }
            const el = document.activeElement;
            // Already on our field, or the user is in a real field / dismissed
            // the keyboard while keeping our field focused: leave it be.
            if (el === captureInput || (el && isEditable(el))) {
                return;
            }
            try {
                captureInput.focus({preventScroll: true});
            } catch {
                captureInput.focus();
            }
        }

        function onFocusOut() {
            // Reclaim focus only if it truly landed on nothing (e.g. after a
            // navigation), so continuous scanning keeps working without a timer
            // that would re-summon a dismissed keyboard.
            setTimeout(keepFocus, 0);
        }

        function onKeyDown(ev) {
            const target = ev.target;

            if (target === captureInput) {
                // The IME path owns this field; an Enter suffix flushes now.
                if (ev.key === "Enter") {
                    ev.preventDefault();
                    flushIme();
                }
                return;
            }

            const barcodeAllowed = target.dataset && target.dataset.enableBarcode;
            if (isEditable(target) && !barcodeAllowed) {
                return;
            }
            if (barcodeAllowed) {
                ev.stopPropagation();
            }

            const now = Date.now();
            const delta = now - lastKeyTime;
            lastKeyTime = now;
            if (delta > SCANNER_KEY_DELAY) {
                buffer = "";
            }
            if (ev.key === "Enter") {
                if (buffer.length >= 3) {
                    emit(buffer);
                }
                resetHid();
                return;
            }
            if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                buffer += ev.key;
                clearTimeout(hidTimeout);
                hidTimeout = setTimeout(resetHid, 2000);
            }
        }

        function activate() {
            if (active) {
                return;
            }
            active = true;
            captureInput = document.createElement("input");
            captureInput.type = "text";
            captureInput.setAttribute("autocomplete", "off");
            captureInput.setAttribute("autocorrect", "off");
            captureInput.setAttribute("autocapitalize", "off");
            captureInput.setAttribute("spellcheck", "false");
            captureInput.setAttribute("aria-hidden", "true");
            captureInput.tabIndex = -1;
            captureInput.style.cssText =
                "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0.01;" +
                "border:0;padding:0;margin:0;font-size:16px;background:transparent;";
            document.body.appendChild(captureInput);
            captureInput.addEventListener("input", onImeInput);
            document.addEventListener("focusout", onFocusOut, true);
            keepFocus();
        }

        function deactivate() {
            if (!active) {
                return;
            }
            active = false;
            document.removeEventListener("focusout", onFocusOut, true);
            clearTimeout(imeTimeout);
            imeTimeout = null;
            imeBuffer = "";
            if (captureInput) {
                captureInput.removeEventListener("input", onImeInput);
                captureInput.remove();
                captureInput = null;
            }
        }

        document.addEventListener("keydown", onKeyDown, true);

        return {
            bus,
            parseBarcode,
            activate,
            deactivate,
            destroy() {
                document.removeEventListener("keydown", onKeyDown, true);
                clearTimeout(hidTimeout);
                deactivate();
            },
        };
    },
};
registry.category("services").add("barcodeScannerBarcode", barcodeService);
