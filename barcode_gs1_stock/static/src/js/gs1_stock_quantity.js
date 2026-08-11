/** @odoo-module **/

import {patch} from "@web/core/utils/patch";
import {barcodeStartupTasks} from "@barcode_scanner/js/registries";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state";

/**
 * Read the quantity of a GS1 scan the way the warehouse means it.
 *
 * A GS1 label states both a piece count (AI 30/37) and, for goods sold by
 * weight, a measure (AI 310n and friends) — a box of cured meat carries "2
 * pieces" and "2.497 kg". Neither `barcode_gs1`, which only decodes, nor
 * `barcode_stock`, which knows nothing of GS1, can decide which one is the
 * quantity picked: that depends on the unit the product is stocked in, so it is
 * decided here.
 */
patch(BarcodeScannerState.prototype, {
    /**
     * Fetch every unit of measure once. There are a handful of them, they are
     * needed to compare a measure with a product, and the scan path itself is
     * synchronous — so they are warmed up when the app starts.
     */
    async loadUoms() {
        if (this.uomsById && Object.keys(this.uomsById).length) {
            return this.uomsById;
        }
        const uoms = await this.orm.searchRead(
            "uom.uom",
            [],
            ["name", "category_id", "factor"]
        );
        this.uomsById = Object.fromEntries(uoms.map((uom) => [uom.id, uom]));
        return this.uomsById;
    },

    /**
     * @override
     * The measure a GS1 label carries becomes the quantity when its unit is the
     * kind the product is stocked in, converted into that unit. When it is not —
     * a weight for a product counted in units — the piece count is the quantity
     * instead, and a single unit when the label states no count: a weight must
     * never turn into a number of units.
     */
    scannedQuantity(scan, productUomId) {
        const measure = parseFloat(scan?.weight);
        const measureUom = this.uomsById?.[scan?.weightUom?.id];
        const productUom = this.uomsById?.[productUomId];
        if (!Number.isFinite(measure) || !measureUom || !productUom) {
            // No measure, or units we could not read: the scan speaks for itself.
            return super.scannedQuantity(...arguments);
        }
        if (measureUom.category_id?.[0] !== productUom.category_id?.[0]) {
            const count = parseFloat(scan?.count);
            return Number.isFinite(count) && count > 0 ? count : 1;
        }
        // Odoo's factor is how many of a unit make one unit of its category's
        // reference, so converting is a ratio of the two. Only the floating point
        // noise is rounded away: the unit's own rounding would coarsen the
        // 2.497 kg the label states to 2.50.
        const converted =
            (measure / (measureUom.factor || 1)) * (productUom.factor || 1);
        return Math.round(converted * 1e6) / 1e6;
    },
});

barcodeStartupTasks.add("gs1_stock_uoms", (env) =>
    env.services.barcodeScannerState.loadUoms()
);
