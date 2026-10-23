/** @odoo-module **/
import {
    COUNTABLE_PRODUCTS,
    InventoryCountScreen,
} from "@barcode_inventory/js/screens/inventory_count_screen.esm";
import {InventoryLocationScreen} from "@barcode_inventory/js/screens/inventory_location_screen.esm";
import {InventoryProductSelectorScreen} from "@barcode_inventory/js/screens/inventory_product_selector_screen.esm";
import {makeTestEnv} from "@web/../tests/helpers/mock_env";
import {parseBarcode} from "@barcode_scanner/js/barcode_parser.esm";
import {templates} from "@web/core/assets";

/**
 * QUnit has no "match object" assertion: compare the keys the expected object
 * names, as the HOOT test did.
 *
 * @param {Object} assert the QUnit assertion object
 * @param {Object} actual the object under test
 * @param {Object} expected the keys to compare
 */
function matchObject(assert, actual, expected) {
    const picked = {};
    for (const key of Object.keys(expected)) {
        picked[key] = actual[key];
    }
    assert.deepEqual(picked, expected);
}

const UNTRACKED = {
    id: 7,
    display_name: "Bolts",
    tracking: "none",
    uom_id: [1, "Units"],
    type: "product",
};
const BY_LOT = {
    id: 8,
    display_name: "Cheese",
    tracking: "lot",
    uom_id: [12, "kg"],
    type: "product",
};
const BY_SERIAL = {
    id: 9,
    display_name: "Drill",
    tracking: "serial",
    uom_id: [1, "Units"],
    type: "product",
};
// A product with no stock to count.
const SERVICE = {
    id: 20,
    display_name: "Gift wrapping",
    tracking: "none",
    uom_id: [1, "Units"],
    type: "consu",
};

/**
 * The fake services a screen talks to. What it tells the operator lands in
 * `notes`, where it navigates in `moves`, what it searches for in `searches`
 * (answered in turn with `found`, the last answer repeated), what it asks
 * the server in `calls` (answered with `answer`, or in turn with `answers`;
 * failing when the answer is an Error) and the dialogs it opens in `dialogs`.
 *
 * @param {Object} [options] the answers to give
 * @returns {Object} the fakes and what they recorded
 */
function fakes({found = [[]], answer = {}, answers = null} = {}) {
    const notes = [];
    const moves = [];
    const searches = [];
    const calls = [];
    const dialogs = [];
    const inventory = {
        notify: (message, options) =>
            notes.push({message: String(message), ...options}),
        searchRead: async (model, domain) => {
            searches.push({model, domain});
            return found[Math.min(searches.length, found.length) - 1];
        },
        call: async (model, method, args, kwargs) => {
            calls.push(kwargs ? {model, method, args, kwargs} : {model, method, args});
            const reply = answers ? answers[calls.length - 1] : answer;
            if (reply instanceof Error) {
                throw reply;
            }
            return reply;
        },
        openDialog: (component, props) => dialogs.push(props),
    };
    const store = {
        navigate: (route, params, options) => moves.push({route, params, options}),
        goBack: (params) => moves.push({route: "back", params}),
    };
    return {inventory, store, notes, moves, searches, calls, dialogs};
}

/**
 * A count screen holding `lines`, without mounting it.
 *
 * @param {Object} [options] the lines and the fakes' answers
 * @returns {Object} the screen and what its fakes recorded
 */
function countScreen({lines = [], ...answers} = {}) {
    const screen = Object.create(InventoryCountScreen.prototype);
    const recorded = fakes(answers);
    screen._seq = lines.length;
    screen.state = {
        locationId: 3,
        locationName: "WH/Stock/Shelf",
        lines,
        loading: false,
        applying: false,
    };
    screen.inventory = recorded.inventory;
    screen.store = recorded.store;
    screen.flashLine = () => undefined;
    return {screen, ...recorded};
}

function stockLine(values) {
    return {
        _id: 1,
        lot_id: false,
        lot_name: "",
        theoretical_qty: 0,
        uom: "Units",
        lot_fixed: false,
        lot_options: [],
        counted: null,
        isNew: false,
        ...values,
    };
}

QUnit.module("BarcodeInventory");

QUnit.test(
    "the same product and lot add up on one line, the newest on top",
    async (assert) => {
        const {screen} = countScreen();
        await screen.addOrIncrement(UNTRACKED, null, 1);
        await screen.addOrIncrement(UNTRACKED, null, 2);
        assert.strictEqual(screen.state.lines.length, 1);
        assert.strictEqual(screen.state.lines[0].counted, "3");
        await screen.addOrIncrement(BY_LOT, "LOT-9", 1);
        assert.deepEqual(
            screen.state.lines.map((l) => l.product_id),
            [8, 7]
        );
        matchObject(assert, screen.state.lines[0], {
            lot_name: "LOT-9",
            lot_fixed: true,
            counted: "1",
            uom: "kg",
            isNew: true,
        });
    }
);

QUnit.test(
    "a product added from the selector is listed, not counted",
    async (assert) => {
        const {screen, calls} = countScreen({answer: ["LOT-1"]});
        await screen.addOrIncrement(BY_LOT, null, null);
        matchObject(assert, screen.state.lines[0], {counted: null, lot_fixed: false});
        // Its lot is still to be set: the lots a count here can use are
        // suggested, as the server finds them.
        assert.deepEqual(calls, [
            {
                model: "stock.inventory",
                method: "action_barcode_lot_names",
                args: [3, 8, ""],
            },
        ]);
        assert.deepEqual(screen.state.lines[0].lot_options, ["LOT-1"]);
        // Picking it again leaves its line as it is.
        await screen.addOrIncrement(BY_LOT, null, null);
        assert.strictEqual(screen.state.lines.length, 1);
        assert.strictEqual(screen.state.lines[0].counted, null);
    }
);

QUnit.test("a serial number counts one unit, once", async (assert) => {
    const {screen, notes} = countScreen();
    await screen.addOrIncrement(BY_SERIAL, "SN-1", 3);
    await screen.addOrIncrement(BY_SERIAL, "SN-1", 1);
    assert.strictEqual(screen.state.lines.length, 1);
    assert.strictEqual(screen.state.lines[0].counted, "1");
    // Without its serial number yet, the line stands for one unit too.
    await screen.addOrIncrement(BY_SERIAL, null, 1);
    await screen.addOrIncrement(BY_SERIAL, null, 1);
    assert.strictEqual(screen.state.lines[0].counted, "1");
    assert.deepEqual(notes, [
        {message: "Serial number SN-1 is already counted.", type: "warning"},
        {
            message:
                "Drill is already counted: set its serial number before counting another one.",
            type: "warning",
        },
    ]);
});

QUnit.test("scanning a serial number in stock counts it", async (assert) => {
    const {screen, notes} = countScreen({
        lines: [
            stockLine({
                product_id: 9,
                tracking: "serial",
                lot_name: "SN-1",
                lot_fixed: true,
                theoretical_qty: 1,
            }),
        ],
    });
    await screen.addOrIncrement(BY_SERIAL, "SN-1", 1);
    assert.strictEqual(screen.state.lines.length, 1);
    assert.strictEqual(screen.state.lines[0].counted, "1");
    assert.deepEqual(notes, []);
});

QUnit.test("a scan looks for the product by every code it carries", async (assert) => {
    const {screen, searches} = countScreen({found: [[SERVICE, BY_LOT]]});
    await screen.onBarcodeScanned("(01)0123(10)L1(30)4", {
        gtin: "0123",
        value: "0123",
        lot: "L1",
        qty: 4,
    });
    const [{domain}] = searches;
    assert.ok(String(JSON.stringify(domain)).includes("0123"));
    assert.ok(String(JSON.stringify(domain)).includes("(01)0123(10)L1(30)4"));
    // The storable one among those it matches is counted.
    assert.strictEqual(screen.state.lines.length, 1);
    matchObject(assert, screen.state.lines[0], {
        product_id: 8,
        lot_name: "L1",
        counted: "4",
    });
});

QUnit.test(
    "a scanned product with no stock to count is refused, saying why",
    async (assert) => {
        const {screen, notes} = countScreen({found: [[SERVICE]]});
        await screen.onBarcodeScanned("777", {value: "777"});
        assert.deepEqual(screen.state.lines, []);
        assert.deepEqual(notes, [
            {
                message:
                    "Gift wrapping is not a storable product: it has no stock to count.",
                type: "warning",
            },
        ]);
    }
);

QUnit.test("a scan matching no product says so", async (assert) => {
    const {screen, notes} = countScreen();
    await screen.onBarcodeScanned("999", {value: "999"});
    assert.deepEqual(screen.state.lines, []);
    assert.deepEqual(notes, [{message: "No product matches “999”.", type: "warning"}]);
});

QUnit.test(
    "a plain EAN-13, as the core parser reads it, counts one unit",
    async (assert) => {
        const {screen, searches} = countScreen({found: [[UNTRACKED]]});
        const parsed = parseBarcode("4006381333931");
        await screen.onBarcodeScanned("4006381333931", parsed);
        assert.ok(String(JSON.stringify(searches[0].domain)).includes("4006381333931"));
        matchObject(assert, screen.state.lines[0], {
            product_id: 7,
            lot_name: "",
            counted: "1",
        });
    }
);

QUnit.test(
    "a scan that resolves while the count is applied changes nothing",
    async (assert) => {
        const {screen, notes} = countScreen();
        let resolve = null;
        screen.inventory.searchRead = () =>
            new Promise((done) => {
                resolve = done;
            });
        const scan = screen.onBarcodeScanned("0123", {value: "0123"});
        // Apply is pressed while the product is looked up.
        screen.state.applying = true;
        resolve([UNTRACKED]);
        await scan;
        assert.deepEqual(screen.state.lines, []);
        assert.deepEqual(notes, [
            {
                message: "Wait until the count is applied to scan again.",
                type: "warning",
            },
        ]);
    }
);

QUnit.test("the count is sent once, and stays as sent meanwhile", async (assert) => {
    const line = stockLine({product_id: 7, tracking: "none", counted: "2"});
    const lot = stockLine({_id: 2, product_id: 8, tracking: "lot", lot_name: "L"});
    const {screen, calls, moves} = countScreen({lines: [line, lot]});
    let resolve = null;
    screen.inventory.call = (model, method, args) => {
        calls.push({model, method, args});
        return new Promise((done) => {
            resolve = done;
        });
    };
    const sending = screen.apply();
    await screen.apply();
    assert.strictEqual(calls.length, 1);
    // While it is on its way, nothing changes the lines it sent.
    screen.setCounted(line, "5");
    screen.setLotName(lot, "OTHER");
    screen.removeLine(line);
    screen.addProduct();
    assert.deepEqual(
        screen.state.lines.map((l) => [l.counted, l.lot_name]),
        [
            ["2", ""],
            [null, "L"],
        ]
    );
    resolve({done: true, adjusted: 1});
    await sending;
    assert.deepEqual(
        moves.map((m) => m.route),
        ["main"]
    );
});

QUnit.test("a scan stands for its piece count, or one unit", (assert) => {
    const {screen} = countScreen();
    assert.strictEqual(screen.scannedQuantity({qty: 6}), 6);
    assert.strictEqual(screen.scannedQuantity({quantity: "2.5"}), 2.5);
    assert.strictEqual(screen.scannedQuantity({qty: null, quantity: null}), 1);
    assert.strictEqual(screen.scannedQuantity(undefined), 1);
    // A label stating zero counts zero; one stating no quantity, nothing.
    assert.strictEqual(screen.scannedQuantity({qty: 0}), 0);
    assert.strictEqual(screen.scannedQuantity({qty: "abc"}), null);
    assert.strictEqual(screen.scannedQuantity({qty: Infinity}), null);
    assert.strictEqual(screen.scannedQuantity({qty: -2}), null);
});

QUnit.test("scans wait while the count is being applied", async (assert) => {
    const {screen, notes, searches} = countScreen();
    screen.state.applying = true;
    await screen.onBarcodeScanned("0123", {value: "0123"});
    assert.deepEqual(searches, []);
    assert.deepEqual(notes, [
        {
            message: "Wait until the count is applied to scan again.",
            type: "warning",
        },
    ]);
});

QUnit.test("each line shows how far the count is from the stock", async (assert) => {
    await makeTestEnv();
    const {screen} = countScreen();
    const line = stockLine({product_id: 7, tracking: "none", theoretical_qty: 0.1});
    assert.strictEqual(screen.diff(line), null);
    screen.setCounted(line, "0.3");
    assert.strictEqual(screen.formatDiff(screen.diff(line)), "+0.2");
    assert.strictEqual(screen.diffClass(line), "ilx-inv-diff-up");
    screen.setCounted(line, "0");
    assert.strictEqual(screen.formatDiff(screen.diff(line)), "-0.1");
    assert.strictEqual(screen.diffClass(line), "ilx-inv-diff-down");
    screen.setCounted(line, "0.1");
    assert.strictEqual(screen.formatDiff(screen.diff(line)), "0");
    assert.strictEqual(screen.diffClass(line), "ilx-inv-diff-none");
    screen.setCounted(line, "");
    assert.strictEqual(screen.isCounted(line), false);
    assert.strictEqual(screen.formatQty(10), "10");
});

QUnit.test("applying sends the counted lines only", async (assert) => {
    const counted = stockLine({
        _id: 1,
        product_id: 8,
        tracking: "lot",
        lot_name: "LOT-1",
        counted: "4",
    });
    const untouched = stockLine({_id: 2, product_id: 7, tracking: "none"});
    const {screen, calls, notes, moves} = countScreen({
        lines: [counted, untouched],
        answer: {done: true, adjusted: 1},
    });
    assert.deepEqual(screen.countedLines, [counted]);
    await screen.apply();
    assert.deepEqual(calls, [
        {
            model: "stock.inventory",
            method: "action_barcode_apply_count",
            args: [
                3,
                [
                    {
                        product_id: 8,
                        lot_name: "LOT-1",
                        counted_qty: 4,
                        theoretical_qty: 0,
                    },
                ],
            ],
            kwargs: {force: false},
        },
    ]);
    assert.deepEqual(notes, [
        {message: "Inventory adjusted: 1 product(s).", type: "success"},
    ]);
    assert.deepEqual(moves, [
        {route: "main", params: {}, options: {clearHistory: true}},
    ]);
});

QUnit.test(
    "nothing is applied without a count, or a lot where one is needed",
    async (assert) => {
        const {screen, calls, notes} = countScreen({
            lines: [
                stockLine({
                    product_id: 8,
                    product_name: "Cheese",
                    tracking: "lot",
                    lot_name: " ",
                }),
            ],
        });
        await screen.apply();
        screen.state.lines[0].counted = "2";
        await screen.apply();
        assert.deepEqual(calls, []);
        assert.deepEqual(
            notes.map((n) => n.message),
            [
                "Count at least one product before applying.",
                "Set the lot/serial for Cheese before applying.",
            ]
        );
    }
);

QUnit.test("a quantity that is not a number is not sent", async (assert) => {
    const {screen, calls, notes} = countScreen({
        lines: [
            stockLine({
                product_id: 7,
                product_name: "Bolts",
                tracking: "none",
                counted: "1e309",
            }),
        ],
    });
    await screen.apply();
    assert.deepEqual(calls, []);
    assert.deepEqual(
        notes.map((n) => n.message),
        ["The counted quantity for Bolts is not a number."]
    );
});

QUnit.test(
    "stock changed while counting: shown, asked, forced only as confirmed",
    async (assert) => {
        await makeTestEnv();
        const line = stockLine({
            product_id: 7,
            product_name: "Bolts",
            tracking: "none",
            theoretical_qty: 10,
            counted: "8",
        });
        const changed = {
            done: false,
            changed: [
                {
                    product_id: 7,
                    product_name: "Bolts",
                    lot_name: "",
                    shown: 10,
                    now: 15,
                    uom: "Units",
                },
            ],
        };
        const {screen, calls, dialogs, moves} = countScreen({
            lines: [line],
            answers: [changed, {done: true, adjusted: 1}, changed],
        });
        await screen.apply();
        // Nothing applied: the line shows the stock as it is now, and the
        // operator is asked.
        assert.deepEqual(calls[0].kwargs, {force: false});
        assert.strictEqual(calls[0].args[1][0].theoretical_qty, 10);
        assert.strictEqual(line.theoretical_qty, 15);
        assert.strictEqual(screen.state.applying, false);
        assert.strictEqual(dialogs.length, 1);
        assert.ok(
            String(dialogs[0].body).includes("Bolts: 10 Units when counting, 15 now")
        );
        // Confirmed as it stands, the count is forced.
        await dialogs[0].confirm();
        assert.deepEqual(calls[1].kwargs, {force: true});
        assert.deepEqual(
            moves.map((m) => m.route),
            ["main"]
        );
        // Had the count changed since the question, it is checked again.
        screen.state.applying = false;
        await screen.apply(true, "another count");
        assert.deepEqual(calls[2].kwargs, {force: false});
    }
);

QUnit.test(
    "cancelling the stock warning and applying again asks again",
    async (assert) => {
        await makeTestEnv();
        const line = stockLine({
            product_id: 7,
            product_name: "Bolts",
            tracking: "none",
            theoretical_qty: 10,
            checked_qty: 10,
            counted: "8",
        });
        const changed = {
            done: false,
            changed: [
                {
                    product_id: 7,
                    product_name: "Bolts",
                    lot_name: "",
                    shown: 10,
                    now: 15,
                    uom: "Units",
                },
            ],
        };
        const {screen, calls, dialogs} = countScreen({
            lines: [line],
            answers: [changed, changed],
        });
        await screen.apply();
        // The operator cancels: the line shows the stock as it is now...
        assert.strictEqual(line.theoretical_qty, 15);
        // ...but applying again is still checked against the stock shown as
        // counting began, so the server warns again.
        await screen.apply();
        assert.deepEqual(
            calls.map((c) => c.args[1][0].theoretical_qty),
            [10, 10]
        );
        assert.deepEqual(
            calls.map((c) => c.kwargs),
            [{force: false}, {force: false}]
        );
        assert.strictEqual(dialogs.length, 2);
    }
);

QUnit.test(
    "a scan stating zero counts zero, an unreadable one nothing",
    async (assert) => {
        const {screen, notes} = countScreen({found: [[UNTRACKED], [BY_LOT]]});
        await screen.onBarcodeScanned("0123", {value: "0123", qty: 0});
        matchObject(assert, screen.state.lines[0], {product_id: 7, counted: "0"});
        await screen.onBarcodeScanned("0456", {value: "0456", qty: "x"});
        assert.strictEqual(screen.state.lines.length, 1);
        assert.deepEqual(
            notes.map((n) => n.message),
            ["The quantity on the label of Cheese cannot be read."]
        );
    }
);

QUnit.test("the lot field looks lots up as the operator types", async (assert) => {
    const line = stockLine({product_id: 8, tracking: "lot"});
    const {screen, calls} = countScreen({lines: [line]});
    const pending = [];
    screen.inventory.call = (model, method, args) => {
        calls.push(args);
        return new Promise((done) => pending.push(done));
    };
    screen.setLotName(line, "L");
    screen.setLotName(line, "LO");
    assert.strictEqual(line.lot_name, "LO");
    assert.deepEqual(calls, [
        [3, 8, "L"],
        [3, 8, "LO"],
    ]);
    // Only the latest answer fills the list.
    pending[1](["LOT-1", "LOT-2"]);
    pending[0](["L-OLD"]);
    await Promise.resolve();
    await Promise.resolve();
    assert.deepEqual(line.lot_options, ["LOT-1", "LOT-2"]);
});

QUnit.test("a refused count can be applied again", async (assert) => {
    const {screen, moves} = countScreen({
        lines: [stockLine({product_id: 7, tracking: "none", counted: "1"})],
        answer: new Error("refused"),
    });
    await screen.apply();
    assert.strictEqual(screen.state.applying, false);
    assert.deepEqual(moves, []);
});

QUnit.test("the lines and the location are loaded from the server", async (assert) => {
    const {screen, calls} = countScreen({
        answer: {
            lines: [
                {
                    product_id: 8,
                    tracking: "lot",
                    lot_name: "LOT-1",
                    theoretical_qty: 5,
                },
                {
                    product_id: 8,
                    tracking: "lot",
                    lot_name: false,
                    theoretical_qty: 1,
                },
            ],
        },
    });
    await screen.loadLines();
    assert.strictEqual(calls[0].method, "action_barcode_location_lines");
    assert.deepEqual(
        screen.state.lines.map((l) => [l._id, l.lot_fixed, l.counted]),
        [
            [1, true, null],
            [2, false, null],
        ]
    );
    assert.deepEqual(
        screen.state.lines.map((l) => l.checked_qty),
        [5, 1]
    );
    assert.strictEqual(screen.needsLotInput(screen.state.lines[1]), true);
    screen.setLotName(screen.state.lines[1], "LOT-2");
    assert.strictEqual(screen.state.lines[1].lot_name, "LOT-2");
    screen.removeLine(screen.state.lines[0]);
    assert.deepEqual(
        screen.state.lines.map((l) => l._id),
        [2]
    );
});

QUnit.test(
    "the + picker keeps the count and leaves out the untracked listed",
    (assert) => {
        const {screen, moves} = countScreen({
            lines: [
                stockLine({_id: 1, product_id: 7, tracking: "none", counted: "2"}),
                stockLine({_id: 2, product_id: 8, tracking: "lot", lot_name: "L"}),
            ],
        });
        screen.addProduct();
        assert.strictEqual(moves[0].route, "inventory_product_selector");
        matchObject(assert, moves[0].params, {
            locationId: 3,
            locationName: "WH/Stock/Shelf",
            excludeProductIds: [7],
        });
        assert.deepEqual(
            moves[0].params.lines.map((l) => l.counted),
            ["2", null]
        );
    }
);

QUnit.test(
    "the selector shows only the latest search, of countable products",
    async (assert) => {
        const screen = Object.create(InventoryProductSelectorScreen.prototype);
        const {inventory, store, searches, moves} = fakes();
        let answer = null;
        const pending = [];
        inventory.searchRead = (model, domain) => {
            searches.push(domain);
            return new Promise((resolve) => pending.push(() => resolve(answer)));
        };
        Object.assign(screen, {
            inventory,
            store,
            props: {params: {locationId: 3, lines: [], excludeProductIds: [7]}},
            state: {search: "bo", results: [], loading: true},
        });
        const first = screen.search();
        screen.state.search = "bol";
        const second = screen.search();
        assert.deepEqual(searches[1], [
            ...COUNTABLE_PRODUCTS,
            "|",
            ["name", "ilike", "bol"],
            ["barcode", "ilike", "bol"],
            ["id", "not in", [7]],
        ]);
        answer = [UNTRACKED];
        pending[1]();
        await second;
        answer = [BY_LOT];
        pending[0]();
        await first;
        assert.deepEqual(screen.state.results, [UNTRACKED]);
        screen.pickProduct(UNTRACKED);
        screen.goBack();
        assert.deepEqual(
            moves.map((m) => m.params.addProduct?.id),
            [7, undefined]
        );
        matchObject(assert, moves[1].params, {locationId: 3, lines: []});
    }
);

QUnit.test(
    "the selector refuses a scanned product with no stock to count",
    async (assert) => {
        const screen = Object.create(InventoryProductSelectorScreen.prototype);
        const {inventory, store, notes, moves} = fakes({
            found: [[SERVICE], [UNTRACKED]],
        });
        Object.assign(screen, {inventory, store, props: {params: {lines: []}}});
        await screen.onBarcodeScanned("777", {value: "777"});
        assert.deepEqual(moves, []);
        assert.deepEqual(
            notes.map((n) => n.message),
            ["Gift wrapping is not a storable product: it has no stock to count."]
        );
        await screen.onBarcodeScanned("123", {value: "123"});
        assert.deepEqual(
            moves.map((m) => m.params.addProduct?.id),
            [7]
        );
    }
);

QUnit.test(
    "the count screen locks while applying and takes decimal counts",
    (assert) => {
        const template = templates.querySelector(
            '[t-name="barcode_inventory.InventoryCountScreen"]'
        );
        assert.ok(template);
        const html = template.outerHTML;
        assert.ok(html.includes('step="any"'));
        assert.strictEqual(html.split('t-att-disabled="state.applying"').length - 1, 4);
    }
);

QUnit.test("operators who cannot apply a count are told so first", async (assert) => {
    const hasGroup = async () => false;
    const screen = Object.create(InventoryLocationScreen.prototype);
    const {inventory, store, searches} = fakes({
        found: [[{id: 4, display_name: "Shelf"}]],
    });
    Object.assign(screen, {
        inventory,
        store,
        user: {hasGroup},
        state: {locations: [], search: "", loading: true, canApply: true},
    });
    await screen.loadScreen();
    matchObject(assert, screen.state, {canApply: false, loading: false});
    await screen.onBarcodeScanned("SHELF", {value: "SHELF"});
    assert.deepEqual(searches, []);
});

QUnit.test("an inventory administrator picks or scans the location", async (assert) => {
    const hasGroup = async () => true;
    const screen = Object.create(InventoryLocationScreen.prototype);
    const shelf = {id: 4, display_name: "WH/Stock/Shelf"};
    const {inventory, store, notes, moves} = fakes({
        found: [[shelf, {id: 5, display_name: "WH/Stock/Bin"}], [shelf], []],
    });
    Object.assign(screen, {
        inventory,
        store,
        user: {hasGroup},
        state: {locations: [], search: "", loading: true, canApply: true},
    });
    await screen.loadScreen();
    assert.strictEqual(screen.state.locations.length, 2);
    screen.state.search = "bin";
    assert.deepEqual(
        screen.filteredLocations.map((l) => l.id),
        [5]
    );
    await screen.onBarcodeScanned("SHELF", {value: "SHELF"});
    matchObject(assert, moves[0], {
        route: "inventory_count",
        params: {locationId: 4, locationName: "WH/Stock/Shelf"},
    });
    await screen.onBarcodeScanned("NOPE", {value: "NOPE"});
    assert.strictEqual(screen.state.search, "NOPE");
    assert.deepEqual(notes, [
        {message: "No internal location matches “NOPE”.", type: "warning"},
    ]);
});
