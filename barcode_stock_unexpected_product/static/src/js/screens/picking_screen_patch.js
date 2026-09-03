/** @odoo-module **/

import {PickingScreen} from "@barcode_stock/js/screens/picking_screen";
import {barcodeMatchDomain} from "@barcode_stock/js/utils/scan_match";
import {_t} from "@web/core/l10n/translation";
import {patch} from "@web/core/utils/patch";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";

export function isManualLineEligible(pickingTypeCode, allowInsertNewLine) {
    return pickingTypeCode === "internal" && Boolean(allowInsertNewLine);
}

patch(PickingScreen.prototype, {
    get canAddManualLine() {
        return isManualLineEligible(
            this.state.pickingTypeCode,
            this.state.pickingTypeAllowInsertNewLine
        );
    },

    async loadData() {
        await super.loadData(...arguments);
        const snapshot = this.barcodeScannerState.getSnapshot();
        this.state.pickingTypeAllowInsertNewLine =
            snapshot.pickingTypeAllowInsertNewLine || false;
    },

    openManualLineSelector() {
        this.store.navigate("product_selector", {
            mode: "manual_line",
            pickingId: this.pickingId,
            pickingTypeCode: this.state.pickingTypeCode,
            listParams: this.listParams,
            reloadToken: Date.now(),
        });
    },

    deleteManualMove(moveId) {
        this.dialog.add(ConfirmationDialog, {
            title: "Confirm deletion",
            body: "Are you sure you want to delete this manually added line?",
            confirm: async () => {
                try {
                    await this.inventory.call(
                        "stock.picking",
                        "barcode_scanner_delete_manual_line",
                        [moveId]
                    );
                    this.inventory.notify("Manual line deleted.", {
                        type: "success",
                    });
                    await this._reloadMoves();
                } catch {
                    // Shared api service already showed the failure to the operator.
                }
            },
        });
    },

    async handleBarcode(barcode, parsedData = null, payload = {}) {
        const normalized = this.barcodeScannerState.applyScanResult({
            barcode,
            ...(parsedData || {}),
        });
        const source = payload?.source || "hardware";
        if (!normalized.candidates.length) {
            // Ponytail: also match default_code (user scans internal reference)
            const productDomain = barcodeMatchDomain(barcode);
            let products = productDomain
                ? await this.inventory.searchRead("product.product", productDomain, [
                      "display_name",
                      "tracking",
                  ])
                : [];
            if (!products.length) {
                const altDomain = barcodeMatchDomain(barcode, "default_code");
                products = altDomain
                    ? await this.inventory.searchRead("product.product", altDomain, [
                          "display_name",
                          "tracking",
                      ])
                    : [];
            }
            if (!products.length || !this.state.picking?.id) {
                this.setLastScanContext({
                    barcode,
                    source,
                    tone: "warning",
                    message: _t("Scanned barcode is not part of the current picking."),
                });
                this.feedback.warning({
                    notify: true,
                    message: _t("Scanned barcode is not part of the current picking."),
                });
                return;
            }
            const product = products[0];
            if (this.canAddManualLine) {
                // UX: open the selector pre-searched with the scanned product
                // so the operator sets the demand quantity (picked auto-fills).
                this.store.navigate("product_selector", {
                    mode: "manual_line",
                    pickingId: this.pickingId,
                    pickingTypeCode: this.state.pickingTypeCode,
                    listParams: this.listParams,
                    reloadToken: Date.now(),
                    preselectProduct: product.id,
                    preselectBarcode: barcode,
                    autoPick: true,
                });
                return;
            }
            const message = _t(
                "Adding a new product line from the scanner is not allowed for this operation type."
            );
            this.setLastScanContext({
                barcode,
                source,
                tone: "warning",
                message,
            });
            this.feedback.warning({notify: true, message});
            return;
        }
        return super.handleBarcode(...arguments);
    },
});
