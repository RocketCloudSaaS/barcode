/** @odoo-module **/

import {
    PRODUCT_FIELDS,
    PURCHASABLE_PRODUCTS,
    PurchaseScreen,
} from "@barcode_purchase/js/screens/purchase_screen.esm";
import {PurchaseProductSelectorScreen} from "@barcode_purchase/js/screens/product_selector_screen.esm";

// Units of measure as a database holds them; a dozen is a twelfth of a unit.
const UOMS = [
    {id: 1, factor: 1, rounding: 0.01},
    {id: 2, factor: 1 / 12, rounding: 0.01},
];
const BOLTS = {
    id: 7,
    display_name: "Bolts",
    default_code: "B-7",
    tracking: "none",
    uom_id: [1, "Units"],
    uom_po_id: [1, "Units"],
};
const CHEESE = {...BOLTS, id: 8, display_name: "Cheese", tracking: "lot"};
// Stocked by the unit, bought by the dozen.
const EGGS = {...BOLTS, id: 9, display_name: "Eggs", uom_po_id: [2, "Dozens"]};

/**
 * Assert that `actual` holds, at least, the entries of `expected` (the QUnit
 * form of the partial object match the tests were written with). Arrays and
 * plain values are compared as they are.
 */
function assertMatches(assert, actual, expected, message) {
    if (Array.isArray(expected) || !(expected instanceof Object)) {
        assert.deepEqual(actual, expected, message);
        return;
    }
    for (const [key, value] of Object.entries(expected)) {
        assertMatches(assert, actual?.[key], value, `${message}: ${key}`);
    }
}

/**
 * A purchase screen, without mounting it, with the units of measure loaded.
 * What it tells the operator lands in `notes`, where it navigates in `moves`,
 * what it searches for in `searches` (answered by model with `found`) and the
 * calls it makes in `calls`, answered by method with `answers`.
 */
async function purchaseScreen({found = {}, answers = {}, state = {}} = {}) {
    const screen = Object.create(PurchaseScreen.prototype);
    const notes = [];
    const moves = [];
    const searches = [];
    const calls = [];
    screen.state = {
        supplier: {id: 3, name: "Vendor"},
        destinationLocation: null,
        buyer: null,
        vendorRef: "",
        lines: [],
        autoValidate: true,
        saving: false,
        ...state,
    };
    screen.inventory = {
        notify: (message, options) =>
            notes.push({message: String(message), ...options}),
        searchRead: async (model, domain) => {
            searches.push({model, domain});
            return model === "uom.uom" ? UOMS : found[model] || [];
        },
        call: async (model, method, args, kwargs) => {
            calls.push({model, method, args, kwargs});
            const answer = answers[method];
            return typeof answer === "function" ? answer(args) : answer;
        },
    };
    screen.store = {navigate: (route, params) => moves.push({route, params})};
    await screen.loadUoms();
    return {screen, notes, moves, searches, calls};
}

QUnit.module("BarcodePurchase", function () {
    QUnit.test(
        "the same product and lot add up on one line, priced by the order",
        async function (assert) {
            const {screen} = await purchaseScreen();
            screen.addLine(BOLTS, null, 1);
            screen.addLine(BOLTS, null, 2);
            screen.addLine(CHEESE, "LOT-A", 1);
            screen.addLine(CHEESE, "LOT-B", 1);
            assert.deepEqual(
                screen.state.lines.map((l) => [l.product_id, l.lot_name, l.qty]),
                [
                    [7, null, 3],
                    [8, "LOT-A", 1],
                    [8, "LOT-B", 1],
                ]
            );
            // No price of its own: the order will price it from the vendor.
            assertMatches(
                assert,
                screen.state.lines[0],
                {
                    price_unit: null,
                    uom_name: "Units",
                    tracking: "none",
                },
                "first line"
            );
            screen.removeLine(screen.state.lines[1]);
            assert.deepEqual(
                screen.state.lines.map((l) => l.lot_name),
                [null, "LOT-B"]
            );
        }
    );

    QUnit.test(
        "a line is in the purchase unit, and a label's pieces are converted",
        async function (assert) {
            const {screen} = await purchaseScreen();
            // 24 eggs on the label are 2 dozens; a plain scan is one dozen.
            screen.addPicked({product: EGGS, parsed: {lot: "LOT-E", qty: 24}});
            screen.addPicked({product: EGGS, parsed: null});
            screen.addPicked({product: EGGS, parsed: {qty: 6}});
            assert.deepEqual(
                screen.state.lines.map((l) => [l.lot_name, l.qty, l.uom_name]),
                [
                    ["LOT-E", 2, "Dozens"],
                    [null, 1.5, "Dozens"],
                ]
            );
            // Bought by the unit: the pieces as they come, the lot kept.
            screen.addPicked({product: CHEESE, parsed: {lot: "LOT-C", qty: 3}});
            assertMatches(
                assert,
                screen.state.lines[2],
                {lot_name: "LOT-C", qty: 3},
                "cheese line"
            );
            // A weight is no count: converting it is left to a bridge module.
            assert.strictEqual(
                screen.scannedQuantity({qty: null, weight: 1.25}, BOLTS),
                1
            );
        }
    );

    QUnit.test(
        "the vendor's prices are shown until the operator types one",
        async function (assert) {
            const {screen, calls} = await purchaseScreen({
                answers: {barcode_purchase_prices: ([, lines]) => lines.map(() => 7)},
            });
            screen.addLine(BOLTS, null, 2);
            screen.addLine(CHEESE, "LOT-A", 1);
            screen.state.lines[1].price_unit = 0;
            await screen.refreshPrices();
            // Only the line without a typed price is asked about.
            assert.deepEqual(calls[0].args, [3, [{product_id: 7, qty: 2}]]);
            assert.deepEqual(
                screen.state.lines.map((l) => screen.linePrice(l)),
                [7, 0]
            );
            assert.deepEqual(
                screen.state.lines.map((l) => screen.lineSubtotal(l)),
                ["14.00", "0.00"]
            );
            // No vendor yet: nothing to ask.
            screen.state.supplier = null;
            await screen.refreshPrices();
            assert.strictEqual(calls.length, 1);
        }
    );

    QUnit.test(
        "an older price answer never overwrites a later one",
        async function (assert) {
            const pending = [];
            const {screen} = await purchaseScreen({
                answers: {
                    barcode_purchase_prices: () => new Promise((r) => pending.push(r)),
                },
            });
            screen.addLine(BOLTS, null, 1);
            const first = screen.refreshPrices();
            const second = screen.refreshPrices();
            pending[1]([5]);
            await second;
            pending[0]([9]);
            await first;
            assert.strictEqual(screen.state.lines[0].price_estimate, 5);
        }
    );

    QUnit.test(
        "a scanned location sets the destination, anything else a product",
        async function (assert) {
            const shelf = {id: 5, display_name: "WH/Stock/Shelf"};
            const withShelf = await purchaseScreen({
                found: {"stock.location": [shelf]},
            });
            await withShelf.screen.onBarcodeScanned("LOC-SHELF", null);
            assert.deepEqual(withShelf.screen.state.destinationLocation, shelf);
            const located = withShelf.searches.find(
                (search) => search.model === "stock.location"
            );
            assert.deepEqual(located.domain[0], ["usage", "=", "internal"]);
            assert.deepEqual(withShelf.screen.state.lines, []);

            const {screen, searches, calls} = await purchaseScreen({
                found: {"product.product": [BOLTS]},
                answers: {barcode_purchase_prices: [4]},
            });
            await screen.onBarcodeScanned("9501101020917", {value: "9501101020917"});
            const products = searches.find(
                (search) => search.model === "product.product"
            );
            assert.deepEqual(products.domain.slice(0, 2), PURCHASABLE_PRODUCTS);
            assertMatches(
                assert,
                screen.state.lines[0],
                {product_id: 7, price_estimate: 4},
                "scanned line"
            );
            assert.strictEqual(calls[0].method, "barcode_purchase_prices");
        }
    );

    QUnit.test("a serial number is listed once, one unit", async function (assert) {
        const {screen, notes} = await purchaseScreen();
        const drill = {...BOLTS, id: 10, display_name: "Drill", tracking: "serial"};
        screen.addPicked({product: drill, parsed: {serial: "SN-1", qty: 3}});
        screen.addPicked({product: drill, parsed: {serial: "SN-1"}});
        assert.deepEqual(
            screen.state.lines.map((l) => [l.lot_name, l.qty]),
            [["SN-1", 1]]
        );
        assert.deepEqual(notes, [
            {message: "Serial number SN-1 is already on the list.", type: "warning"},
        ]);
    });

    QUnit.test("a scan the save overtakes adds nothing", async function (assert) {
        let answer = null;
        const {screen, notes} = await purchaseScreen();
        screen.inventory.searchRead = (model) =>
            model === "product.product"
                ? new Promise((resolve) => {
                      answer = resolve;
                  })
                : Promise.resolve([]);
        const scanning = screen.onBarcodeScanned("9501101020917", null);
        await Promise.resolve();
        await Promise.resolve();
        // The order goes off while the product is being looked up.
        screen.state.saving = true;
        answer([BOLTS]);
        await scanning;
        assert.deepEqual(screen.state.lines, []);
        assert.deepEqual(
            notes.map((n) => n.message),
            ["Wait until the order is saved to scan again."]
        );
    });

    QUnit.test(
        "an unknown product and a scan while saving add nothing",
        async function (assert) {
            const {screen, notes} = await purchaseScreen();
            await screen.onBarcodeScanned("NOPE", null);
            screen.state.saving = true;
            await screen.onBarcodeScanned("NOPE", null);
            assert.deepEqual(screen.state.lines, []);
            assert.deepEqual(
                notes.map((n) => n.message),
                ["Product not found.", "Wait until the order is saved to scan again."]
            );
        }
    );

    QUnit.test(
        "the order is sent in one call, priced only where the operator typed",
        async function (assert) {
            const {screen, calls, moves, notes} = await purchaseScreen({
                answers: {
                    action_barcode_purchase: {
                        name: "P00042",
                        state: "purchase",
                        missing_lots: [],
                        unplaced_lots: [],
                    },
                },
                state: {
                    destinationLocation: {id: 5, display_name: "Shelf"},
                    buyer: {id: 9, name: "Buyer"},
                    vendorRef: "REF-1",
                },
            });
            screen.addLine(CHEESE, "LOT-A", 2);
            screen.addLine(BOLTS, null, 1);
            screen.state.lines[1].price_unit = 0;
            await screen.createPurchase();
            assert.deepEqual(calls, [
                {
                    model: "purchase.order",
                    method: "action_barcode_purchase",
                    args: [
                        3,
                        [
                            {
                                product_id: 8,
                                qty: 2,
                                price_unit: null,
                                lot_name: "LOT-A",
                            },
                            {product_id: 7, qty: 1, price_unit: 0, lot_name: false},
                        ],
                    ],
                    kwargs: {
                        confirm: true,
                        location_dest_id: 5,
                        user_id: 9,
                        partner_ref: "REF-1",
                    },
                },
            ]);
            assert.deepEqual(moves, [{route: "main", params: undefined}]);
            assert.deepEqual(notes, [
                {message: "Purchase order P00042 confirmed.", type: "success"},
            ]);
            assert.strictEqual(screen.state.saving, false);
        }
    );

    QUnit.test(
        "a draft is saved without touching the validate box",
        async function (assert) {
            const {screen, calls, notes} = await purchaseScreen({
                answers: {
                    action_barcode_purchase: {
                        name: "P00043",
                        state: "draft",
                        missing_lots: [],
                        unplaced_lots: [],
                    },
                },
            });
            screen.addLine(BOLTS, null, 1);
            await screen.saveDraft();
            assert.strictEqual(calls[0].kwargs.confirm, false);
            assert.strictEqual(screen.state.autoValidate, true);
            assert.deepEqual(notes, [
                {message: "Purchase order P00043 saved as a draft.", type: "success"},
            ]);
        }
    );

    QUnit.test(
        "nothing is sent without a vendor or a product",
        async function (assert) {
            const noVendor = await purchaseScreen({state: {supplier: null}});
            await noVendor.screen.createPurchase();
            const noLines = await purchaseScreen();
            await noLines.screen.createPurchase();
            assert.deepEqual([...noVendor.calls, ...noLines.calls], []);
            assert.deepEqual(
                [noVendor.notes[0].message, noLines.notes[0].message],
                ["Please select a supplier.", "Please add at least one product."]
            );
        }
    );

    QUnit.test(
        "the operator is told what the order ended up as",
        async function (assert) {
            const told = async (result, confirm = true) => {
                const {screen, notes} = await purchaseScreen();
                screen.notifyOutcome(
                    {missing_lots: [], unplaced_lots: [], ...result},
                    confirm
                );
                return notes.map((n) => [n.message, n.type]);
            };
            assert.deepEqual(
                await told({name: "P1", state: "purchase", missing_lots: ["Cheese"]}),
                [
                    [
                        "P1 confirmed -- set the lot/serial of Cheese on the receipt.",
                        "warning",
                    ],
                ]
            );
            assert.deepEqual(await told({name: "P1", state: "to approve"}), [
                ["Purchase order P1 created -- it is waiting for approval.", "warning"],
            ]);
            assert.deepEqual(await told({name: "P1", state: "draft"}), [
                ["Purchase order P1 was created but is still a draft.", "warning"],
            ]);
            assert.deepEqual(await told({name: "P1", state: "draft"}, false), [
                ["Purchase order P1 saved as a draft.", "success"],
            ]);
            assert.deepEqual(
                await told({
                    name: "P1",
                    state: "purchase",
                    unplaced_lots: ["Cheese (LOT-X)"],
                }),
                [
                    [
                        "Set these lots on the receipt by hand: Cheese (LOT-X)",
                        "warning",
                    ],
                    ["Purchase order P1 confirmed.", "success"],
                ]
            );
        }
    );

    QUnit.test("the product selector hands the picked product back", function (assert) {
        const selector = Object.create(PurchaseProductSelectorScreen.prototype);
        const moves = [];
        const lines = [{product_id: 7, lot_name: null, qty: 1}];
        selector.props = {params: {supplier: {id: 3}, lines}};
        selector.store = {navigate: (route, params) => moves.push({route, params})};
        selector.confirmSelection({...EGGS, image_url: "/x.png"}, {lot: "LOT-A"});
        assert.strictEqual(moves[0].route, "purchase");
        assertMatches(
            assert,
            moves[0].params,
            {
                supplier: {id: 3},
                lines,
                addProduct: {
                    product: {id: 9, uom_po_id: [2, "Dozens"]},
                    parsed: {lot: "LOT-A"},
                },
            },
            "selector params"
        );
        // Only the fields a line needs ride along.
        assert.deepEqual(
            Object.keys(moves[0].params.addProduct.product).sort(),
            ["id", ...PRODUCT_FIELDS].sort()
        );
    });
});
