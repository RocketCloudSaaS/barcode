/** @odoo-module **/

import {describe, expect, test} from "@odoo/hoot";
import {appendPurchaseOriginToSearchText} from "@barcode_stock_purchase_origin/js/picking_list_search";

describe("BarcodeStockPurchaseOrigin", () => {
    test("purchase origin is appended to the picking search text", () => {
        const picking = {purchase_origin: "PO-ORIGIN-QA-001"};
        const base = "wh/in/0001 vendor scheduled";
        expect(appendPurchaseOriginToSearchText(base, picking)).toBe(
            "wh/in/0001 vendor scheduled po-origin-qa-001"
        );
    });

    test("empty origin adds no term", () => {
        const base = "wh/in/0001 vendor scheduled";
        expect(appendPurchaseOriginToSearchText(base, {purchase_origin: ""})).toBe(
            base
        );
        expect(appendPurchaseOriginToSearchText(base, {})).toBe(base);
        expect(appendPurchaseOriginToSearchText(base, {purchase_origin: null})).toBe(
            base
        );
    });

    test("base search text is retained", () => {
        const base = "wh/in/0001 vendor scheduled";
        const extended = appendPurchaseOriginToSearchText(base, {
            purchase_origin: "PO-1",
        });
        expect(extended).toContain(base);
        expect(extended).toContain("po-1");
    });
});
