/** @odoo-module **/

import {describe, expect, test} from "@odoo/hoot";
import {
    getManualLineInitialQuantity,
    lotIdForName,
    matchesProductSearch,
} from "@barcode_stock_unexpected_product/js/screens/product_selector_screen_patch.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {ProductSelectorScreen} from "@barcode_stock/js/screens/product_selector_screen.esm";
import {isManualLineEligible} from "@barcode_stock_unexpected_product/js/screens/picking_screen_patch.esm";

describe("BarcodeStockUnexpectedProduct", () => {
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
            state: {selectedProduct: {id: 11}, qty: 2.5, lotId: "13"},
            inventory: {
                call: async (...args) => {
                    calls.push(args);
                    return {move_id: 42};
                },
                notify: () => undefined,
            },
            store: {goBack: (params) => backs.push(params)},
        };
        await ProductSelectorScreen.prototype.confirmSelection.call(mock);
        expect(calls).toEqual([
            [
                "stock.picking",
                "barcode_scanner_add_manual_line_to_picking",
                [7, 11, 2.5, 13, false],
            ],
        ]);
        expect(backs[0].focusMoveId).toBe(42);
        expect(backs[0].added).toBe(undefined);
    });

    test("unlisted GS1 product passes normalized quantity and lot to the selector", async () => {
        const navigations = [];
        const screen = Object.assign(Object.create(PickingScreen.prototype), {
            props: {pickingId: 7, listParams: {activeTab: "todo"}},
            state: {
                picking: {id: 7},
                pickingTypeCode: "internal",
                pickingTypeAllowInsertNewLine: true,
            },
            barcodeScannerState: {
                applyScanResult: (scan) => {
                    expect(scan.quantity).toBe(2.5);
                    expect(scan.lot).toBe("LOT-GS1");
                    return {
                        candidates: [],
                        quantity: 2.5,
                        lotName: "LOT-GS1",
                    };
                },
            },
            inventory: {
                searchRead: async () => [{id: 11, display_name: "Widget"}],
            },
            store: {navigate: (...args) => navigations.push(args)},
        });

        await PickingScreen.prototype.handleBarcode.call(screen, "GS1-CODE", {
            quantity: 2.5,
            lot: "LOT-GS1",
        });

        expect(navigations[0][0]).toBe("product_selector");
        expect(navigations[0][1].scannedQuantity).toBe(2.5);
        expect(navigations[0][1].scannedLotName).toBe("LOT-GS1");
        expect(navigations[0][1].autoPick).toBe(true);
    });

    test("manual selector defaults to the GS1 quantity and selects its lot by name", async () => {
        expect(getManualLineInitialQuantity({scannedQuantity: 2.5})).toBe(2.5);
        expect(getManualLineInitialQuantity({})).toBe(1);
        const mock = {
            props: {
                params: {
                    mode: "manual_line",
                    preselectProduct: 11,
                    scannedLotName: "LOT-GS1",
                },
            },
            state: {
                products: [],
                search: "",
                loading: true,
                selectedProduct: null,
                qty: getManualLineInitialQuantity({scannedQuantity: 2.5}),
                lotId: false,
                lots: [],
            },
            inventory: {
                searchRead: async (model) =>
                    model === "product.product"
                        ? [{id: 11, name: "Widget", tracking: "lot"}]
                        : [{id: 13, name: "LOT-GS1"}],
            },
        };

        await ProductSelectorScreen.prototype.loadProducts.call(mock);

        expect(mock.state.qty).toBe(2.5);
        expect(mock.state.lotId).toBe("13");
        expect(lotIdForName([{id: 13, name: "LOT-GS1"}], "LOT-GS1")).toBe("13");
    });

    test("only manual-line mode uses the barcode-aware product filter", () => {
        const product = {name: "Widget", default_code: "", barcode: "GS1-CODE"};
        const selector = Object.assign(Object.create(ProductSelectorScreen.prototype), {
            props: {params: {mode: "manual_line"}},
            state: {search: "GS1-CODE", products: [product]},
        });
        expect(selector.filteredProducts).toEqual([product]);

        selector.props.params.mode = "quick_info_product";
        expect(selector.filteredProducts).toEqual([]);
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
});
