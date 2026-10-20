/** @odoo-module **/

import "@barcode_gs1_stock/js/gs1_stock_quantity.esm";
import {
    compileGs1Nomenclature,
    setGs1Nomenclature,
} from "@barcode_gs1/js/gs1_nomenclature.esm";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";
import {parseGs1} from "@barcode_gs1/js/gs1_parser.esm";

// Units of measure as a stock database ships them: `factor` is how many of the
// unit make one unit of its category's reference (a kilogram is 1000 grams),
// and `rounding` is what a quantity in that unit is rounded to.
const UOMS = [
    {id: 1, name: "Units", category_id: [1, "Unit"], factor: 1.0, rounding: 0.01},
    {id: 13, name: "kg", category_id: [3, "Weight"], factor: 1.0, rounding: 0.01},
    {id: 14, name: "g", category_id: [3, "Weight"], factor: 1000.0, rounding: 0.01},
    {id: 16, name: "lb", category_id: [3, "Weight"], factor: 2.20462, rounding: 0.01},
    {
        id: 6,
        name: "m",
        category_id: [4, "Length / Distance"],
        factor: 1.0,
        rounding: 0.01,
    },
];

/**
 * A scanner state with the units loaded. By default, the way Odoo ships: units
 * rounded to 0.01 and quantities stored with two decimals. `rounding` overrides
 * a unit's rounding by id, `digits` the decimals of "Product Unit of Measure".
 */
function stateWithUoms({rounding = {}, digits = 2} = {}) {
    const state = new BarcodeScannerState({});
    state.uomsById = Object.fromEntries(
        UOMS.map((uom) => [
            uom.id,
            {...uom, rounding: rounding[uom.id] ?? uom.rounding},
        ])
    );
    state.quantityDigits = digits;
    return state;
}

// The configuration that reads grams: kilograms rounded to 0.001 and quantities
// stored with three decimals.
function stateReadingGrams() {
    return stateWithUoms({rounding: {13: 0.001}, digits: 3});
}

// What barcode_gs1 hands over for a box of cured meat: two pieces, 2.497 kg.
const TWO_PIECES_OF_2497_G = {
    qty: 2,
    quantity: 2,
    count: 2,
    weight: 2.497,
    weightUom: {id: 13, name: "kg"},
};

QUnit.module("Gs1StockQuantity", () => {
    QUnit.test(
        "a product stocked by weight takes the weight, in its own unit",
        (assert) => {
            const state = stateReadingGrams();
            assert.strictEqual(state.scannedQuantity(TWO_PIECES_OF_2497_G, 13), 2.497);
            // The label weighs in kilograms, the product is stocked in grams.
            assert.strictEqual(state.scannedQuantity(TWO_PIECES_OF_2497_G, 14), 2497);
        }
    );

    QUnit.test("the weight is rounded the way it will be stored", (assert) => {
        // Odoo's defaults keep two decimals of a kilogram: 2.497 kg is stored as
        // 2.50, so that is the quantity shown.
        assert.strictEqual(
            stateWithUoms().scannedQuantity(TWO_PIECES_OF_2497_G, 13),
            2.5
        );
        // Both settings count: a finer unit with two decimals still stores 2.50,
        // and so do three decimals with a unit rounded to 0.01.
        const finerUnit = stateWithUoms({rounding: {13: 0.001}});
        assert.strictEqual(finerUnit.scannedQuantity(TWO_PIECES_OF_2497_G, 13), 2.5);
        const moreDecimals = stateWithUoms({digits: 3});
        assert.strictEqual(moreDecimals.scannedQuantity(TWO_PIECES_OF_2497_G, 13), 2.5);
        // When the decimals could not be read, the unit's rounding still applies.
        const noDigits = stateWithUoms({rounding: {13: 0.001}, digits: null});
        assert.strictEqual(noDigits.scannedQuantity(TWO_PIECES_OF_2497_G, 13), 2.497);
    });

    QUnit.test("a product counted in units takes the piece count", (assert) => {
        assert.strictEqual(stateWithUoms().scannedQuantity(TWO_PIECES_OF_2497_G, 1), 2);
    });

    QUnit.test(
        "a weight with no count is a single unit for a product in units",
        (assert) => {
            // A cheese wheel label: 4.324 kg net and no count at all. Adding
            // "4.324 units" would be wrong; one box was scanned.
            const wheel = {qty: null, weight: 4.324, weightUom: {id: 13, name: "kg"}};
            assert.strictEqual(stateReadingGrams().scannedQuantity(wheel, 13), 4.324);
            assert.strictEqual(stateWithUoms().scannedQuantity(wheel, 13), 4.32);
            assert.strictEqual(stateWithUoms().scannedQuantity(wheel, 1), 1);
        }
    );

    QUnit.test(
        "a measure in another unit of the same category is converted",
        (assert) => {
            const pounds = {qty: null, weight: 5, weightUom: {id: 16, name: "lb"}};
            assert.strictEqual(stateReadingGrams().scannedQuantity(pounds, 13), 2.268);
            assert.strictEqual(stateWithUoms().scannedQuantity(pounds, 13), 2.27);
        }
    );

    QUnit.test("a measure of the wrong kind never becomes the quantity", (assert) => {
        // A length says nothing about how much of a product to pick.
        const length = {qty: 3, count: 3, weight: 2.5, weightUom: {id: 6, name: "m"}};
        const state = stateWithUoms();
        assert.strictEqual(state.scannedQuantity(length, 6), 2.5);
        assert.strictEqual(state.scannedQuantity(length, 13), 3);
    });

    QUnit.test("without a measure, the base reading stands", (assert) => {
        const state = stateWithUoms();
        assert.strictEqual(state.scannedQuantity({qty: 7, count: 7}, 13), 7);
        assert.strictEqual(state.scannedQuantity({}, 13), 1);
        assert.strictEqual(state.scannedQuantity(null, 13), 1);
        // A unit we could not read leaves the stated quantity alone.
        assert.strictEqual(state.scannedQuantity(TWO_PIECES_OF_2497_G, 999), 2);
    });
});

QUnit.module("Gs1StockQuantity loading", () => {
    function fakeOrm({digits = 3, fail = false} = {}) {
        const calls = [];
        return {
            calls,
            async searchRead(model, domain, fields) {
                calls.push([model, fields]);
                return UOMS;
            },
            async call(model, method, args) {
                calls.push([model, method, args]);
                if (fail) {
                    throw new Error("No access");
                }
                return digits;
            },
        };
    }

    QUnit.test("the units and the stored decimals are read once", async (assert) => {
        const orm = fakeOrm();
        const state = new BarcodeScannerState(orm);
        await state.loadUoms();
        assert.strictEqual(state.uomsById[13].rounding, 0.01);
        assert.strictEqual(state.quantityDigits, 3);
        assert.deepEqual(orm.calls, [
            ["uom.uom", ["name", "category_id", "factor", "rounding"]],
            ["decimal.precision", "precision_get", ["Product Unit of Measure"]],
        ]);
        await state.loadUoms();
        assert.strictEqual(orm.calls.length, 2);
    });

    QUnit.test(
        "the units still load when the decimals cannot be read",
        async (assert) => {
            const state = new BarcodeScannerState(fakeOrm({fail: true}));
            await state.loadUoms();
            assert.strictEqual(state.uomsById[13].name, "kg");
            assert.strictEqual(state.quantityDigits, null);
        }
    );
});

QUnit.module("Gs1StockQuantity packaging", (hooks) => {
    // The carton's own GTIN-14 (packaging indicator 1) holds twelve cheeses.
    const CARTON = "19501101020914";

    hooks.afterEach(() => setGs1Nomenclature(null));

    // The two rules of Odoo's GS1 nomenclature these labels need, with the unit
    // AI 3103 is expressed in.
    function loadNomenclature() {
        setGs1Nomenclature(
            compileGs1Nomenclature({id: 1, name: "Default GS1 Nomenclature"}, [
                {
                    name: "GTIN",
                    sequence: 2,
                    pattern: "(01)(\\d{14})",
                    type: "product",
                    gs1_content_type: "identifier",
                },
                {
                    name: "Variable count of items",
                    sequence: 20,
                    pattern: "(30)(\\d{0,8})",
                    type: "quantity",
                    gs1_content_type: "measure",
                    gs1_decimal_usage: false,
                },
                {
                    name: "Net weight, kilograms",
                    sequence: 21,
                    pattern: "(310[0-5])(\\d{6})",
                    type: "quantity",
                    gs1_content_type: "measure",
                    gs1_decimal_usage: true,
                    associated_uom_id: [13, "kg"],
                },
            ])
        );
    }

    // A picking with one move of cheese, whose carton is a packaging of 12.
    function pickingState(productUomId) {
        const state = stateWithUoms();
        state.productsById = {
            7: {
                id: 7,
                display_name: "Cheese",
                barcode: "9501101020917",
                uom_id: [productUomId, "unit"],
                tracking: "none",
            },
        };
        state.moves = [{id: 70, product_id: [7, "Cheese"]}];
        state.packagings = [
            {id: 3, product_id: [7, "Cheese"], barcode: CARTON, qty: 12},
        ];
        state.buildIndexes();
        return state;
    }

    function scan(state, label) {
        return state.applyScanResult({barcode: label, ...parseGs1(label)});
    }

    QUnit.test("a carton label with no count is the pack's quantity", (assert) => {
        loadNomenclature();
        // The weight is decoded, but a product counted in units ignores it.
        const result = scan(pickingState(1), `(01)${CARTON}(3103)004324`);
        assert.strictEqual(result.candidates.length, 1);
        assert.strictEqual(result.quantity, 12);
        assert.strictEqual(scan(pickingState(1), `(01)${CARTON}`).quantity, 12);
    });

    QUnit.test(
        "a count on the carton label wins over the pack's quantity",
        (assert) => {
            loadNomenclature();
            assert.strictEqual(
                scan(pickingState(1), `(01)${CARTON}(30)10`).quantity,
                10
            );
        }
    );

    QUnit.test(
        "a carton weighed for a product stocked by weight is the weight",
        (assert) => {
            loadNomenclature();
            // 4.324 kg, stored with Odoo's two decimals: not the pack's 12.
            const result = scan(pickingState(13), `(01)${CARTON}(3103)004324`);
            assert.strictEqual(result.quantity, 4.32);
        }
    );
});
