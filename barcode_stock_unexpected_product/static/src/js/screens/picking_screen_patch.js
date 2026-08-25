/** @odoo-module **/

import {PickingScreen} from "@barcode_stock/js/screens/picking_screen";
import {barcodeMatchDomain} from "@barcode_scanner/js/utils/scan_match";
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
                const added = await this.inventory.call(
                    "stock.picking",
                    "barcode_scanner_add_line_to_picking",
                    [this.state.picking.id, product.id, normalized.quantity, lotId]
                );
                // The added line is picked in full, so it only shows up in
                // the "Done" tab: hand the move over for the screen to follow
                // it there once the reload below brings it in.
                const productRef = [product.id, product.display_name];
                const addedMove = added?.move_id
                    ? {id: added.move_id, product_id: productRef}
                    : null;
                this.setLastScanContext({
                    barcode,
                    source,
                    tone: "success",
                    message: _t("Product added to transfer."),
                    quantity: normalized.quantity,
                    move: addedMove,
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
