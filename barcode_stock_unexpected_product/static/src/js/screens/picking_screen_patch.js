/** @odoo-module **/

import {PickingScreen} from "@barcode_stock/js/screens/picking_screen";
import {barcodeMatchDomain} from "@barcode_stock/js/utils/scan_match";
import {_t} from "@web/core/l10n/translation";
import {patch} from "@web/core/utils/patch";

patch(PickingScreen.prototype, {
    async handleBarcode(barcode, parsedData = null, payload = {}) {
        const normalized = this.barcodeScannerState.applyScanResult({
            barcode,
            ...(parsedData || {}),
        });
        const source = payload?.source || "hardware";
        if (!normalized.candidates.length) {
            // ponytail: also match default_code (user scans internal reference)
            let productDomain = barcodeMatchDomain(barcode);
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
            const lotId =
                product.tracking !== "none" && normalized.lot
                    ? normalized.lot.id
                    : false;
            try {
                await this.inventory.call(
                    "stock.picking",
                    "barcode_scanner_add_line_to_picking",
                    [this.state.picking.id, product.id, normalized.quantity, lotId]
                );
                this.setLastScanContext({
                    barcode,
                    source,
                    tone: "success",
                    message: _t("Product added to transfer."),
                    quantity: normalized.quantity,
                });
                this.feedback.success({
                    notify: true,
                    message: _t("Product added to transfer."),
                });
                await this._reloadMoves();
            } catch (error) {
                const message =
                    error?.data?.message ||
                    error?.message ||
                    _t("Product could not be added to the transfer.");
                this.setLastScanContext({
                    barcode,
                    source,
                    tone: "danger",
                    message,
                });
                this.feedback.warning({notify: true, message});
            }
            return;
        }
        return super.handleBarcode(...arguments);
    },
});
