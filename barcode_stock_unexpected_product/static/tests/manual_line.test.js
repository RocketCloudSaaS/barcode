/** @odoo-module **/

import {
    getManualLineInitialQuantity,
    lotIdForName,
    matchesProductSearch,
} from "@barcode_stock_unexpected_product/js/screens/product_selector_screen_patch.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {ProductSelectorScreen} from "@barcode_stock/js/screens/product_selector_screen.esm";
import {isManualLineEligible} from "@barcode_stock_unexpected_product/js/screens/picking_screen_patch.esm";

QUnit.module("BarcodeStockUnexpectedProduct", () => {
    QUnit.test(
        "manual line search matches name, internal reference, and barcode",
        (assert) => {
            const product = {name: "Widget", default_code: "W-01", barcode: "12345"};
            assert.strictEqual(matchesProductSearch(product, "widget"), true);
            assert.strictEqual(matchesProductSearch(product, "w-01"), true);
            assert.strictEqual(matchesProductSearch(product, "12345"), true);
            assert.strictEqual(matchesProductSearch(product, "missing"), false);
        }
    );

    QUnit.test(
        "manual line eligibility is restricted to permitted internal transfers",
        (assert) => {
            assert.strictEqual(isManualLineEligible("internal", true), true);
            assert.strictEqual(isManualLineEligible("incoming", true), false);
            assert.strictEqual(isManualLineEligible("outgoing", true), false);
            assert.strictEqual(isManualLineEligible("internal", false), false);
        }
    );

    QUnit.test(
        "manual selection calls the pending-demand RPC and reloads the picking",
        async (assert) => {
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
            assert.deepEqual(calls, [
                [
                    "stock.picking",
                    "barcode_scanner_add_manual_line_to_picking",
                    [7, 11, 2.5, 13, false],
                ],
            ]);
            assert.strictEqual(backs[0].focusMoveId, 42);
            assert.strictEqual(backs[0].added, undefined);
        }
    );

    QUnit.test(
        "unlisted GS1 product passes normalized quantity and lot to the selector",
        async (assert) => {
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
                        assert.strictEqual(scan.quantity, 2.5);
                        assert.strictEqual(scan.lot, "LOT-GS1");
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

            assert.strictEqual(navigations[0][0], "product_selector");
            assert.strictEqual(navigations[0][1].scannedQuantity, 2.5);
            assert.strictEqual(navigations[0][1].scannedLotName, "LOT-GS1");
            assert.strictEqual(navigations[0][1].autoPick, true);
        }
    );

    QUnit.test(
        "manual selector defaults to the GS1 quantity and selects its lot by name",
        async (assert) => {
            assert.strictEqual(
                getManualLineInitialQuantity({scannedQuantity: 2.5}),
                2.5
            );
            assert.strictEqual(getManualLineInitialQuantity({}), 1);
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

            assert.strictEqual(mock.state.qty, 2.5);
            assert.strictEqual(mock.state.lotId, "13");
            assert.strictEqual(
                lotIdForName([{id: 13, name: "LOT-GS1"}], "LOT-GS1"),
                "13"
            );
        }
    );

    QUnit.test(
        "only manual-line mode uses the barcode-aware product filter",
        (assert) => {
            const product = {name: "Widget", default_code: "", barcode: "GS1-CODE"};
            const selector = Object.assign(
                Object.create(ProductSelectorScreen.prototype),
                {
                    props: {params: {mode: "manual_line"}},
                    state: {search: "GS1-CODE", products: [product]},
                }
            );
            assert.deepEqual(selector.filteredProducts, [product]);

            selector.props.params.mode = "quick_info_product";
            assert.deepEqual(selector.filteredProducts, []);
        }
    );

    QUnit.test(
        "manual selection keeps the screen open when the RPC fails",
        async (assert) => {
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
            assert.strictEqual(backCount, 0);
            assert.strictEqual(notifyCount, 0);
        }
    );
});
