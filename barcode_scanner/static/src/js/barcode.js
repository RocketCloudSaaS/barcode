/** @odoo-module **/

import {EventBus} from "@odoo/owl";
import {registry} from "@web/core/registry";
import {parseBarcode} from "@barcode_scanner/js/barcode_parser";

export const barcodeService = {
    dependencies: [],
    start() {
        const bus = new EventBus();
        let buffer = "";
        let timeout = null;
        let lastKeyTime = 0;

        const SCANNER_KEY_DELAY = 150;

        function isEditable(element) {
            if (!element || element.nodeType !== 1) return false;
            return (
                element.matches('input, textarea, [contenteditable="true"]') ||
                element.isContentEditable
            );
        }

        function resetBuffer() {
            buffer = "";
            clearTimeout(timeout);
            timeout = null;
        }

        function onKeyDown(ev) {
            const target = ev.target;
            if (isEditable(target) && !target.dataset.enableBarcode) {
                return;
            }

            const now = Date.now();
            const delta = now - lastKeyTime;
            lastKeyTime = now;

            if (delta > SCANNER_KEY_DELAY) {
                buffer = "";
            }

            if (ev.key === "Enter") {
                if (buffer.length >= 3) {
                    const parsed = parseBarcode(buffer);
                    bus.trigger("barcode_scanned", {
                        barcode: buffer,
                        parsed: parsed,
                    });
                }
                resetBuffer();
                return;
            }

            if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
                buffer += ev.key;
                clearTimeout(timeout);
                timeout = setTimeout(resetBuffer, 2000);
            }
        }

        document.addEventListener("keydown", onKeyDown, true);

        return {
            bus,
            destroy() {
                document.removeEventListener("keydown", onKeyDown, true);
                clearTimeout(timeout);
            },
            parseBarcode,
        };
    },
};
registry.category("services").add("barcodeScannerBarcode", barcodeService);
