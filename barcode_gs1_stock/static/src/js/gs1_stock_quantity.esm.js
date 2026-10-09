import {roundDecimals, roundPrecision} from "@web/core/utils/numbers";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";
import {barcodeStartupTasks} from "@barcode_scanner/js/registries.esm";
import {patch} from "@web/core/utils/patch";

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
     * Fetch every unit of measure once, with the number of decimals a quantity
     * is stored with. There are a handful of units, they are needed to compare
     * a measure with a product, and the scan path itself is synchronous — so
     * they are warmed up when the app starts.
     */
    async loadUoms() {
        if (this.uomsById && Object.keys(this.uomsById).length) {
            return this.uomsById;
        }
        const [uoms, digits] = await Promise.all([
            this.orm.searchRead(
                "uom.uom",
                [],
                ["name", "category_id", "factor", "rounding"]
            ),
            this.orm
                .call("decimal.precision", "precision_get", ["Product Unit of Measure"])
                .catch(() => null),
        ]);
        this.quantityDigits = Number.isInteger(digits) ? digits : null;
        this.uomsById = Object.fromEntries(uoms.map((uom) => [uom.id, uom]));
        return this.uomsById;
    },

    /**
     * The measure a GS1 label carries, as a quantity of the product: converted
     * into the unit the product is stocked in, and rounded the way the server
     * will store it. Null when there is no measure, when its unit is not the
     * kind the product is stocked in (a weight for a product counted in units),
     * or when the units could not be read.
     */
    measureQuantity(scan, productUomId) {
        const measure = parseFloat(scan?.weight);
        const measureUom = this.uomsById?.[scan?.weightUom?.id];
        const productUom = this.uomsById?.[productUomId];
        if (
            !Number.isFinite(measure) ||
            !measureUom ||
            !productUom ||
            measureUom.category_id?.[0] !== productUom.category_id?.[0]
        ) {
            return null;
        }
        // Odoo's factor is how many of a unit make one unit of its category's
        // reference, so converting is a ratio of the two.
        const quantity =
            (measure / (measureUom.factor || 1)) * (productUom.factor || 1);
        return this.roundAsStored(quantity, productUom);
    },

    /**
     * A quantity in `uom` as the server will store it. What lands in stock is
     * rounded to the unit's rounding and to the decimals of "Product Unit of
     * Measure": with the defaults (0.01 kg, two decimals) the 2.497 kg a label
     * states is stored as 2.50. Rounding here too shows the quantity that will
     * be stored, not one that will change once saved.
     */
    roundAsStored(quantity, uom) {
        let rounded =
            uom.rounding > 0 ? roundPrecision(quantity, uom.rounding) : quantity;
        if (Number.isInteger(this.quantityDigits)) {
            rounded = roundDecimals(rounded, this.quantityDigits);
        }
        return rounded;
    },

    /**
     * @override
     * The measure becomes the quantity when its unit is the kind the product is
     * stocked in. Otherwise the base reading stands: the piece count on the
     * label, or a single unit when it states none — a weight must never turn
     * into a number of units.
     */
    scannedQuantity(scan, productUomId) {
        const measured = this.measureQuantity(scan, productUomId);
        return measured === null ? super.scannedQuantity(...arguments) : measured;
    },

    /**
     * @override
     * A packaging barcode stands for a whole pack, and the base takes the pack's
     * quantity whenever the label states no count. A measure is more precise
     * than that: a carton of cheese weighing 4.32 kg is 4.32 for a product
     * stocked in kilograms, not the pack's nominal quantity.
     */
    applyScanResult(scan) {
        const result = super.applyScanResult(...arguments);
        const productId = result.candidates?.[0]?.product_id?.[0];
        const measured = this.measureQuantity(
            scan,
            this.productsById?.[productId]?.uom_id?.[0]
        );
        if (measured !== null) {
            result.quantity = measured;
        }
        return result;
    },
});

barcodeStartupTasks.add("gs1_stock_uoms", (env) =>
    env.services.barcodeScannerState.loadUoms()
);
