/** @odoo-module **/

import {patch} from "@web/core/utils/patch";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state";

/**
 * Recognize every barcode a product carries in the warehouse app.
 *
 * `product_multi_barcode` lets a product hold several barcodes (its main one
 * plus alternates). `barcode_stock` only indexes the main barcode and the
 * packagings, so scanning an alternate barcode inside a picking is rejected
 * even though the product is on the move. This bridge loads the alternate
 * barcodes of the products in the current picking and indexes them so a scan
 * of any of them resolves to the same move.
 */
patch(BarcodeScannerState.prototype, {
    /**
     * @override
     * Drop the alternate barcodes of the previous picking so a new one starts
     * clean.
     */
    reset() {
        super.reset(...arguments);
        this.alternateBarcodes = [];
    },

    /**
     * @override
     * Load the alternate barcodes of the products in the picking and keep them
     * so `buildIndexes` can map each one to its product.
     */
    async preloadPicking(pickingId) {
        const snapshot = await super.preloadPicking(...arguments);
        const productIds = Object.keys(this.productsById).map(Number);
        this.alternateBarcodes = [];
        if (productIds.length) {
            try {
                this.alternateBarcodes = await this.orm.searchRead(
                    "product.barcode",
                    [["product_id", "in", productIds]],
                    ["name", "product_id"]
                );
            } catch {
                // A user without read access to product.barcode still loads the
                // picking; it just falls back to main barcodes and packagings.
                this.alternateBarcodes = [];
            }
        }
        this.buildIndexes();
        return snapshot;
    },

    /**
     * @override
     * Map every alternate barcode to its product so a scan of any of them
     * matches the same move as the main barcode.
     */
    buildIndexes() {
        const indexes = super.buildIndexes(...arguments);
        for (const barcode of this.alternateBarcodes || []) {
            const productId = barcode.product_id?.[0];
            const code = barcode.name;
            if (!productId || !code) {
                continue;
            }
            indexes.barcodeToProductIds[code] = [
                ...(indexes.barcodeToProductIds[code] || []),
                productId,
            ];
        }
        this.indexes = indexes;
        return indexes;
    },
});
