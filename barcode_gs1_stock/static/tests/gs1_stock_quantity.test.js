/** @odoo-module **/

import {describe, expect, test} from "@odoo/hoot";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state";
import "@barcode_gs1_stock/js/gs1_stock_quantity";

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
        const wheel = {qty: 4.324, weight: 4.324, weightUom: {id: 13, name: "kg"}};
        const state = stateWithUoms();
        expect(state.scannedQuantity(wheel, 13)).toBe(4.324);
        expect(state.scannedQuantity(wheel, 1)).toBe(1);
    });

    test("a measure in another unit of the same category is converted", () => {
        const pounds = {qty: 5, weight: 5, weightUom: {id: 16, name: "lb"}};
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
