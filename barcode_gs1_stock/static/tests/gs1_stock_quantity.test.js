import "@barcode_gs1_stock/js/gs1_stock_quantity.esm";
import {afterEach, describe, expect, test} from "@odoo/hoot";
import {
    compileGs1Nomenclature,
    setGs1Nomenclature,
} from "@barcode_gs1/js/gs1_nomenclature.esm";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";
import {parseGs1} from "@barcode_gs1/js/gs1_parser.esm";

// Units of measure as a stock database holds them: `factor` is how many of the
// unit make one unit of its category's reference (a kilogram is 1000 grams).
const UOMS = [
    {id: 1, name: "Units", category_id: [1, "Unit"], factor: 1.0},
    {id: 13, name: "kg", category_id: [3, "Weight"], factor: 1.0},
    {id: 14, name: "g", category_id: [3, "Weight"], factor: 1000.0},
    {id: 16, name: "lb", category_id: [3, "Weight"], factor: 2.20462},
    {id: 6, name: "m", category_id: [4, "Length / Distance"], factor: 1.0},
];

function stateWithUoms() {
    const state = new BarcodeScannerState({});
    state.uomsById = Object.fromEntries(UOMS.map((uom) => [uom.id, uom]));
    return state;
}

// What barcode_gs1 hands over for a box of cured meat: two pieces, 2.497 kg.
const TWO_PIECES_OF_2497_G = {
    qty: 2,
    quantity: 2,
    count: 2,
    weight: 2.497,
    weightUom: {id: 13, name: "kg"},
};

describe("Gs1StockQuantity", () => {
    test("a product stocked by weight takes the weight, in its own unit", () => {
        const state = stateWithUoms();
        expect(state.scannedQuantity(TWO_PIECES_OF_2497_G, 13)).toBe(2.497);
        // The label weighs in kilograms, the product is stocked in grams.
        expect(state.scannedQuantity(TWO_PIECES_OF_2497_G, 14)).toBe(2497);
    });

    test("a product counted in units takes the piece count", () => {
        expect(stateWithUoms().scannedQuantity(TWO_PIECES_OF_2497_G, 1)).toBe(2);
    });

    test("a weight with no count is a single unit for a product in units", () => {
        // A cheese wheel label: 4.324 kg net and no count at all. Adding "4.324
        // units" would be wrong; one box was scanned.
        const wheel = {qty: null, weight: 4.324, weightUom: {id: 13, name: "kg"}};
        const state = stateWithUoms();
        expect(state.scannedQuantity(wheel, 13)).toBe(4.324);
        expect(state.scannedQuantity(wheel, 1)).toBe(1);
    });

    test("a measure in another unit of the same category is converted", () => {
        const pounds = {qty: null, weight: 5, weightUom: {id: 16, name: "lb"}};
        expect(stateWithUoms().scannedQuantity(pounds, 13)).toBe(2.267965);
    });

    test("a measure of the wrong kind never becomes the quantity", () => {
        // A length says nothing about how much of a product to pick.
        const length = {qty: 3, count: 3, weight: 2.5, weightUom: {id: 6, name: "m"}};
        const state = stateWithUoms();
        expect(state.scannedQuantity(length, 6)).toBe(2.5);
        expect(state.scannedQuantity(length, 13)).toBe(3);
    });

    test("without a measure, the base reading stands", () => {
        const state = stateWithUoms();
        expect(state.scannedQuantity({qty: 7, count: 7}, 13)).toBe(7);
        expect(state.scannedQuantity({}, 13)).toBe(1);
        expect(state.scannedQuantity(null, 13)).toBe(1);
        // A unit we could not read leaves the stated quantity alone.
        expect(state.scannedQuantity(TWO_PIECES_OF_2497_G, 999)).toBe(2);
    });
});

describe("Gs1StockQuantity packaging", () => {
    // The carton's own GTIN-14 (packaging indicator 1) holds twelve cheeses.
    const CARTON = "19501101020914";

    afterEach(() => setGs1Nomenclature(null));

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

    test("a carton label with no count is the pack's quantity", () => {
        loadNomenclature();
        // The weight is decoded, but a product counted in units ignores it.
        const result = scan(pickingState(1), `(01)${CARTON}(3103)004324`);
        expect(result.candidates.length).toBe(1);
        expect(result.quantity).toBe(12);
        expect(scan(pickingState(1), `(01)${CARTON}`).quantity).toBe(12);
    });

    test("a count on the carton label wins over the pack's quantity", () => {
        loadNomenclature();
        expect(scan(pickingState(1), `(01)${CARTON}(30)10`).quantity).toBe(10);
    });

    test("a carton weighed for a product stocked by weight is the weight", () => {
        loadNomenclature();
        // 4.324 kg: not the pack's 12.
        const result = scan(pickingState(13), `(01)${CARTON}(3103)004324`);
        expect(result.quantity).toBe(4.324);
    });
});
