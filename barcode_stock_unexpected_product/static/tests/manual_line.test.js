/** @odoo-module **/

import {expect, test} from "@odoo/hoot";
import {ProductSelectorScreen} from "@barcode_stock/js/screens/product_selector_screen";
import {isManualLineEligible} from "@barcode_stock_unexpected_product/js/screens/picking_screen_patch";
import {matchesProductSearch} from "@barcode_stock_unexpected_product/js/screens/product_selector_screen_patch";

test("manual line search matches name, internal reference, and barcode", () => {
    const product = {name: "Widget", default_code: "W-01", barcode: "12345"};
    expect(matchesProductSearch(product, "widget")).toBe(true);
    expect(matchesProductSearch(product, "w-01")).toBe(true);
    expect(matchesProductSearch(product, "12345")).toBe(true);
    expect(matchesProductSearch(product, "missing")).toBe(false);
});

test("manual line eligibility is restricted to permitted internal transfers", () => {
    expect(isManualLineEligible("internal", true)).toBe(true);
    expect(isManualLineEligible("incoming", true)).toBe(false);
    expect(isManualLineEligible("outgoing", true)).toBe(false);
    expect(isManualLineEligible("internal", false)).toBe(false);
});

test("manual selection calls the pending-demand RPC and reloads the picking", async () => {
    const calls = [];
    const backs = [];
    const mock = {
        props: {params: {mode: "manual_line", pickingId: 7, reloadToken: 9}},
        state: {selectedProduct: {id: 11}, qty: 2000, lotId: 13},
        inventory: {
            call: async (...args) => calls.push(args),
            notify: () => undefined,
        },
        store: {goBack: (params) => backs.push(params)},
    };
    await ProductSelectorScreen.prototype.confirmSelection.call(mock);
    expect(calls).toEqual([
        [
            "stock.picking",
            "barcode_scanner_add_manual_line_to_picking",
            [7, 11, 2000, 13],
        ],
    ]);
    expect(backs[0].reloadToken).toBe(9);
    expect(backs[0].added).toBe(true);
});

test("manual selection keeps the screen open when the RPC fails", async () => {
    let backCount = 0;
    let notifyCount = 0;
    const mock = {
        props: {params: {mode: "manual_line", pickingId: 7}},
        state: {selectedProduct: {id: 11}, qty: 1, lotId: false},
        inventory: {
            call: async () => {
                throw new Error("not available");
            },
            notify: () => notifyCount++,
        },
        store: {goBack: () => backCount++},
    };
    await ProductSelectorScreen.prototype.confirmSelection.call(mock);
    expect(backCount).toBe(0);
    expect(notifyCount).toBe(0);
});
