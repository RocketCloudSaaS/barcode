import {Component, onPatched, onWillStart, useRef, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";
import {barcodeMatchAnyDomain} from "@barcode_scanner/js/utils/scan_match.esm";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";

export class CycleCountCountScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.dialog = useService("dialog");
        this.feedback = useService("barcodeScannerFeedback");
        this.countMainRef = useRef("countMain");
        this.identityInputRef = useRef("identityInput");
        this._scanCount = 0;
        this._pendingScrollQuantId = null;
        this._restoreScanInputFocus = false;
        this.state = useState({
            lines: [],
            loading: true,
            applying: false,
            saving: false,
            error: false,
            identityInput: "",
            resolvingScan: false,
            scanFeedback: null,
            highlightedQuantId: null,
        });
        useBarcodeHandler({
            onScan: (barcode, parsed) => this.onBarcodeScanned(barcode, parsed),
        });
        onPatched(() => {
            this._scrollToScannedLine();
            this._restoreScanInputFocusIfNeeded();
        });
        onWillStart(() => this.loadLines());
    }

    _scrollToScannedLine() {
        const quantId = this._pendingScrollQuantId;
        if (quantId === null || quantId === undefined) return;
        this._pendingScrollQuantId = null;
        if (this.state.highlightedQuantId !== quantId) return;

        const scrollContainer = this.countMainRef.el;
        const line = scrollContainer
            ? [...scrollContainer.querySelectorAll(".ilx-count-line")].find(
                  (item) => item.dataset.quantId === String(quantId)
              )
            : null;
        if (!scrollContainer || !line) return;

        const containerRect = scrollContainer.getBoundingClientRect();
        const lineRect = line.getBoundingClientRect();
        const visibleTop = containerRect.top + scrollContainer.clientTop;
        const visibleBottom = visibleTop + scrollContainer.clientHeight;
        let nextScrollTop = scrollContainer.scrollTop;
        if (lineRect.top < visibleTop) {
            nextScrollTop += lineRect.top - visibleTop;
        } else if (lineRect.bottom > visibleBottom) {
            nextScrollTop += lineRect.bottom - visibleBottom;
        }
        if (nextScrollTop !== scrollContainer.scrollTop) {
            const reduceMotion =
                typeof window.matchMedia === "function" &&
                window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            scrollContainer.scrollTo({
                top: nextScrollTop,
                behavior: reduceMotion ? "instant" : "smooth",
            });
        }
    }

    _restoreScanInputFocusIfNeeded() {
        if (!this._restoreScanInputFocus || this.state.resolvingScan) return;
        this._restoreScanInputFocus = false;
        const input = this.identityInputRef.el;
        if (input && !input.disabled) {
            input.focus({preventScroll: true});
        }
    }

    async loadLines() {
        try {
            const result = await this.inventory.call(
                "stock.inventory",
                "barcode_get_cycle_count_lines",
                [this.props.params.inventoryId]
            );
            this.state.lines = (result.lines || []).map((line) => ({
                ...line,
                counted: line.counted_qty ?? null,
            }));
            this.state.error = false;
        } catch (error) {
            this.state.error = true;
            this.feedback.error({message: error.message, notify: true});
        } finally {
            this.state.loading = false;
        }
    }

    async onBarcodeScanned(barcode, parsed) {
        if (this.state.loading || this.state.applying || this.state.saving) {
            return false;
        }
        this._scanCount = (this._scanCount || 0) + 1;
        this._restoreScanInputFocus = true;
        this.state.resolvingScan = true;
        try {
            const identity = await this.resolveScanIdentity(barcode, parsed);
            if (!identity) return false;
            const {product, lot} = identity;
            const line = this.state.lines.find(
                (item) =>
                    item.product_id === product.id &&
                    (product.tracking === "none"
                        ? !item.lot_id
                        : item.lot_id === lot.id)
            );
            const quantity = parseFloat(parsed?.quantity ?? parsed?.qty) || 1;
            if (line) {
                const previousCounted = line.counted;
                this.setCounted(line, (parseFloat(line.counted) || 0) + quantity);
                if (line.counted !== previousCounted) {
                    this.state.highlightedQuantId = line.quant_id;
                    this._pendingScrollQuantId = line.quant_id;
                    this.state.scanFeedback = {
                        type: "success",
                        message: this._scanSuccessMessage(line),
                    };
                }
                return true;
            }
            return await this.addScannedLine(product, lot, quantity);
        } catch (error) {
            this.feedback.error({message: error.message, notify: true});
            this.state.scanFeedback = {type: "error", message: error.message};
            this.state.highlightedQuantId = null;
            return false;
        } finally {
            this._scanCount -= 1;
            this.state.resolvingScan = this._scanCount > 0;
        }
    }

    async resolveScanIdentity(barcode, parsed) {
        const product = await this.findScannedProduct(barcode, parsed);
        if (product === false) return null;
        let lotName = String(parsed?.lot || parsed?.serial || "").trim();
        if (!product && !lotName) {
            lotName = String(parsed?.value || barcode || "").trim();
        }
        const identity = await this.resolveScanLot(product, lotName);
        if (!identity) return null;
        if (!identity.product) {
            this._scanWarning(_t("No existing product or lot/serial matches this scan."));
            return null;
        }
        return identity;
    }

    async findScannedProduct(barcode, parsed) {
        const candidates = [
            ...(parsed?.productCodes || []),
            parsed?.gtin,
            parsed?.value,
            barcode,
        ];
        const domain = barcodeMatchAnyDomain(candidates);
        const products = domain
            ? await this.inventory.searchRead("product.product", domain, [
                  "id",
                  "tracking",
              ])
            : [];
        if (products.length > 1) {
            this._scanWarning(_t("More than one product matches this scan."));
            return false;
        }
        return products[0] || null;
    }

    validateScanTracking(product, lotName) {
        if (product && product.tracking === "none" && lotName) {
            this._scanWarning(_t("An untracked product cannot use a lot or serial."));
            return false;
        }
        if (product && product.tracking !== "none" && !lotName) {
            this._scanWarning(_t("Scan or enter an existing lot or serial."));
            return false;
        }
        return true;
    }

    async resolveScanLot(product, lotName) {
        if (!this.validateScanTracking(product, lotName)) return null;
        let resolvedProduct = product;
        let lot = null;
        if (lotName) {
            lot = await this.resolveExistingLot(product, lotName);
            if (!lot) return null;
            if (!resolvedProduct) resolvedProduct = await this.resolveLotProduct(lot);
            if (!resolvedProduct) return null;
        }
        return {product: resolvedProduct, lot};
    }

    async resolveExistingLot(product, lotName) {
        const lotDomain = barcodeMatchAnyDomain([lotName], "name");
        const domain = product
            ? [["product_id", "=", product.id], ...lotDomain]
            : lotDomain;
        const lots = await this.inventory.searchRead("stock.lot", domain, [
            "id",
            "name",
            "product_id",
        ]);
        if (lots.length !== 1) {
            this._scanWarning(_t("No unique existing lot or serial matches this scan."));
            return null;
        }
        const lot = lots[0];
        const lotProductId = Array.isArray(lot.product_id)
            ? lot.product_id[0]
            : lot.product_id?.id || lot.product_id;
        if (!lotProductId) {
            this._scanWarning(_t("The lot or serial has no product identity."));
            return null;
        }
        if (product && lotProductId !== product.id) {
            this._scanWarning(_t("The lot or serial does not belong to this product."));
            return null;
        }
        return lot;
    }

    async resolveLotProduct(lot) {
        const lotProductId = Array.isArray(lot.product_id)
            ? lot.product_id[0]
            : lot.product_id?.id || lot.product_id;
        const products = await this.inventory.searchRead(
            "product.product",
            [["id", "=", lotProductId]],
            ["id", "tracking"]
        );
        if (products.length !== 1 || products[0].tracking === "none") {
            this._scanWarning(_t("The product for this lot or serial is unavailable."));
            return null;
        }
        return products[0];
    }

    async addScannedLine(product, lot, quantity) {
        const addedLine = await this.inventory.call(
            "stock.inventory",
            "barcode_add_cycle_count_quant",
            [this.props.params.inventoryId, product.id, lot?.id || false]
        );
        if (
            !addedLine?.quant_id ||
            addedLine.product_id !== product.id ||
            (product.tracking === "none"
                ? Boolean(addedLine.lot_id)
                : addedLine.lot_id !== lot?.id)
        ) {
            this._scanWarning(_t("The server returned a different count line."));
            return false;
        }
        const currentLine = this.state.lines.find(
            (item) =>
                item.quant_id === addedLine.quant_id ||
                (item.product_id === addedLine.product_id &&
                    (product.tracking === "none"
                        ? !item.lot_id
                        : item.lot_id === addedLine.lot_id))
        );
        const counted = currentLine?.counted ?? addedLine.counted_qty ?? null;
        const resolvedLine = currentLine
            ? Object.assign(currentLine, addedLine, {counted})
            : {...addedLine, counted};
        if (!currentLine) {
            this.state.lines.push(resolvedLine);
        }
        const previousCounted = resolvedLine.counted ?? null;
        this.setCounted(
            resolvedLine,
            (parseFloat(resolvedLine.counted) || 0) + quantity
        );
        if (resolvedLine.counted !== previousCounted) {
            this.state.highlightedQuantId = resolvedLine.quant_id;
            this._pendingScrollQuantId = resolvedLine.quant_id;
            this.state.scanFeedback = {
                type: "success",
                message: this._scanSuccessMessage(resolvedLine),
            };
        }
        return true;
    }

    _scanWarning(message) {
        this.feedback.warning({message, notify: true});
        this.state.scanFeedback = {type: "warning", message};
        this.state.highlightedQuantId = null;
    }

    _scanSuccessMessage(line) {
        const parts = [line.product_name];
        if (line.lot_name) {
            parts.push(line.lot_name);
        }
        return _t("Counted: %s", parts.filter(Boolean).join(" · "));
    }

    async resolveIdentityInput() {
        const value = this.state.identityInput.trim();
        if (!value || this.state.resolvingScan || this.state.saving) {
            return;
        }
        if (await this.onBarcodeScanned(value)) {
            this.state.identityInput = "";
        }
    }

    setCounted(line, value) {
        if (this.state.saving) return;
        const quantity = value === "" ? null : Number(value);
        if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
            this._scanWarning(_t("Quantity cannot be negative."));
            return;
        }
        if (line.tracking === "serial" && quantity > 1) {
            this._scanWarning(_t("A serial number can only be counted once."));
            return;
        }
        line.counted = quantity;
    }

    difference(line) {
        if (line.counted === null) return null;
        const difference = line.counted - line.theoretical_qty;
        const rounding = Number(line.rounding) || 0;
        return rounding && Math.abs(difference) < rounding / 2 ? 0 : difference;
    }

    get progressPercent() {
        const total = this.state.lines.length;
        return total ? Math.round((this.countedLines.length / total) * 100) : 0;
    }

    get dirtyLines() {
        return this.state.lines.filter(
            (line) => line.counted !== (line.counted_qty ?? null)
        );
    }

    get hasDirtyLines() {
        return this.dirtyLines.length > 0;
    }

    quantityStep() {
        // The explicit quantity controls always move in whole-unit steps.
        // UoM rounding remains relevant to differences, not button increments.
        return 1;
    }

    differenceClass(line) {
        const difference = this.difference(line);
        if (difference === null) return "is-empty";
        if (difference === 0) return "is-zero";
        return difference > 0 ? "is-positive" : "is-negative";
    }

    lineClasses(line) {
        const classes = [];
        if (line.quant_id === this.state.highlightedQuantId) {
            classes.push("ilx-count-line--highlighted");
        }
        if (line.counted === null) {
            classes.push("ilx-count-line--pending");
        } else if (this.difference(line) === 0) {
            classes.push("ilx-count-line--match");
        } else {
            classes.push("ilx-count-line--variance");
        }
        return classes.join(" ");
    }

    adjustCounted(line, delta) {
        if (this.state.saving) return;
        const current = line.counted === null ? 0 : Number(line.counted) || 0;
        const step = Number.isFinite(Number(delta)) ? Math.trunc(Number(delta)) : 0;
        let quantity = Math.max(0, current + step);
        if (line.tracking === "serial") {
            quantity = Math.min(quantity, 1);
        }
        this.setCounted(line, quantity);
    }

    setCountToOnHand(line) {
        if (this.state.saving) return;
        this.setCounted(line, line.theoretical_qty);
    }

    get countedLines() {
        return this.state.lines.filter((line) => line.counted !== null);
    }

    async saveCount() {
        if (
            this.state.loading ||
            this.state.error ||
            this.state.applying ||
            this.state.saving ||
            this.state.resolvingScan
        ) {
            return;
        }
        const lines = this.dirtyLines.map((line) => ({
            line,
            payload: {
                quant_id: line.quant_id,
                counted_qty: line.counted,
                lot_id: line.lot_id || false,
                lot_name: line.lot_name || false,
                write_date: line.write_date || false,
            },
        }));
        if (!lines.length) return;

        this.state.saving = true;
        try {
            for (const {line, payload} of lines) {
                const ack = await this.inventory.call(
                    "stock.inventory",
                    "barcode_save_cycle_count_line",
                    [this.props.params.inventoryId, payload]
                );
                if (
                    !ack ||
                    ack.quant_id !== payload.quant_id ||
                    !Object.prototype.hasOwnProperty.call(ack, "counted_qty") ||
                    !Object.prototype.hasOwnProperty.call(
                        ack,
                        "barcode_cycle_count_counted"
                    ) ||
                    !Object.prototype.hasOwnProperty.call(ack, "write_date")
                ) {
                    throw new Error(
                        _t("The server did not confirm saving this count line.")
                    );
                }
                line.counted_qty = ack.counted_qty ?? null;
                line.barcode_cycle_count_counted =
                    ack.barcode_cycle_count_counted;
                line.write_date = ack.write_date;
            }
            if (this.dirtyLines.length) {
                this.feedback.warning({
                    message: _t("Count changed while saving. Save again to keep the latest count."),
                    notify: true,
                });
                return;
            }
            this.feedback.success({
                message: _t("Cycle count saved."),
                notify: true,
            });
        } catch (error) {
            this.feedback.error({message: error.message, notify: true});
        } finally {
            this.state.saving = false;
        }
    }

    async apply() {
        if (
            this.state.loading ||
            this.state.applying ||
            this.state.saving ||
            this.state.resolvingScan
        ) {
            return;
        }
        const lines = this.countedLines;
        if (lines.length !== this.state.lines.length) {
            this.feedback.warning({
                message: _t("Count every line before completing the count."),
                notify: true,
            });
            return;
        }
        const missingLot = lines.find(
            (line) => line.tracking !== "none" && !line.lot_id
        );
        if (missingLot) {
            this.feedback.warning({
                message: _t("A tracked product must retain its lot or serial."),
                notify: true,
            });
            return;
        }
        if (lines.every((line) => !this.difference(line))) {
            this.confirmZero();
            return;
        }
        await this.callApply(lines, false);
    }

    confirmZero() {
        this.dialog.add(ConfirmationDialog, {
            title: _t("No differences"),
            body: _t("Close this cycle count without applying inventory?"),
            confirm: () => this.callClose(this.countedLines),
        });
    }

    async callApply(lines, confirmZero) {
        if (this.state.saving) return;
        this.state.applying = true;
        try {
            const result = await this.inventory.call(
                "stock.inventory",
                "barcode_apply_cycle_count",
                [
                    this.props.params.inventoryId,
                    lines.map((line) => ({
                        quant_id: line.quant_id,
                        counted_qty: line.counted,
                        lot_id: line.lot_id || false,
                        lot_name: line.lot_name || false,
                    })),
                    confirmZero,
                ]
            );
            this.openDone(result);
        } catch (error) {
            this.state.applying = false;
            this.feedback.error({message: error.message, notify: true});
        }
    }

    async callClose(lines) {
        if (this.state.saving) return;
        this.state.applying = true;
        try {
            this.openDone(
                await this.inventory.call(
                    "stock.inventory",
                    "barcode_close_cycle_count",
                    [
                        this.props.params.inventoryId,
                        lines.map((line) => ({
                            quant_id: line.quant_id,
                            counted_qty: line.counted,
                            lot_id: line.lot_id || false,
                            lot_name: line.lot_name || false,
                        })),
                        true,
                    ]
                )
            );
        } catch (error) {
            this.state.applying = false;
            this.feedback.error({message: error.message, notify: true});
        }
    }

    openDone(result) {
        this.feedback.success({message: _t("Cycle count completed."), notify: true});
        this.store.navigate("cycle_count_done", {
            cycleCountId: result.cycle_count_id,
            cycleCount: this.props.params.cycleCount,
            inventoryId: result.inventory_id,
            appliedCount: result.applied_count,
            accuracy: result.accuracy,
            showAll: this.props.params.showAll,
        });
    }

    goBack() {
        if (this.state.saving) return;
        this.store.goBack();
    }
    static template = "barcode_stock_cycle_count.CycleCountCountScreen";
}

barcodeScreens.add("cycle_count_count", {component: CycleCountCountScreen});
