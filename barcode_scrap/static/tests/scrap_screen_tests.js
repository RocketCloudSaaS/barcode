/** @odoo-module **/

import {
    SCRAPPABLE_PRODUCTS,
    ScrapScreen,
} from "@barcode_scrap/js/screens/scrap_screen.esm";
import {ScrapProductSelectorScreen} from "@barcode_scrap/js/screens/scrap_product_selector_screen.esm";

const UNTRACKED = {
    id: 7,
    display_name: "Bolts",
    tracking: "none",
    uom_id: [1, "Units"],
};
const BY_LOT = {id: 8, display_name: "Cheese", tracking: "lot", uom_id: [12, "kg"]};
const BY_SERIAL = {
    id: 9,
    display_name: "Drill",
    tracking: "serial",
    uom_id: [1, "Units"],
};

/**
 * A scrap screen on a location holding `stock`, without mounting it. What it
 * tells the operator lands in `notes`, where it navigates in `moves`, what it
 * searches for in `searches` (answered with `found`), the scraps it asks the
 * server for in `calls` (answered in turn with `answers`) and the dialogs it
 * opens in `dialogs`.
 */
function scrapScreen({stock = [], lines = [], found = [], answers = []} = {}) {
    const screen = Object.create(ScrapScreen.prototype);
    const notes = [];
    const moves = [];
    const searches = [];
    const calls = [];
    const dialogs = [];
    screen._seq = lines.length;
    screen.state = {
        locationId: 3,
        locationName: "WH/Stock/Shelf",
        lines,
        stock,
        scrapLocationId: 4,
    };
    screen.inventory = {
        notify: (message, options) =>
            notes.push({message: String(message), ...options}),
        searchRead: async (model, domain) => {
            searches.push(domain);
            return found;
        },
        call: async (model, method, args, kwargs) => {
            calls.push({lines: args[1], ...kwargs});
            return answers[calls.length - 1];
        },
        openDialog: (component, props) => dialogs.push(props),
    };
    screen.store = {
        navigate: (route, params) => moves.push({route, params}),
        goBack: (params) => moves.push({route: "back", params}),
    };
    screen.flashLine = () => undefined;
    return {screen, notes, moves, searches, calls, dialogs};
}

/** Assert that `actual` has, at least, every property of `expected`. */
function assertMatch(assert, actual, expected, message) {
    for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(actual[key], value, `${message}: ${key}`);
    }
}

const STOCK = [
    {product_id: 7, lot_id: false, lot_name: false, quantity: 4},
    {product_id: 7, lot_id: false, lot_name: false, quantity: 6},
    {product_id: 8, lot_id: 21, lot_name: "ABC", quantity: 2},
    {product_id: 8, lot_id: 22, lot_name: "abc", quantity: 3},
    {product_id: 8, lot_id: 23, lot_name: "LOT-9", quantity: 1},
];

QUnit.module("BarcodeScrap");

QUnit.test(
    "the same product and lot add up on one line, the newest on top",
    async (assert) => {
        const {screen} = scrapScreen({stock: STOCK});
        await screen.addOrIncrement(UNTRACKED, null, 1);
        await screen.addOrIncrement(UNTRACKED, null, 2);
        assert.strictEqual(screen.state.lines.length, 1);
        assert.strictEqual(screen.state.lines[0].qty, "3");
        await screen.addOrIncrement(BY_LOT, "LOT-9", 1);
        assert.deepEqual(
            screen.state.lines.map((l) => l.product_id),
            [8, 7]
        );
        assertMatch(
            assert,
            screen.state.lines[0],
            {lot_id: 23, lot_name: "LOT-9"},
            "new lot line"
        );
    }
);

QUnit.test(
    "a lot is matched exactly first, and in another case only alone",
    (assert) => {
        const {screen} = scrapScreen({stock: STOCK});
        // Lots that differ only in case are distinct lots.
        assert.strictEqual(screen.findStockLot(8, "ABC").lot_id, 21);
        assert.strictEqual(screen.findStockLot(8, "abc").lot_id, 22);
        assert.strictEqual(screen.findStockLot(8, "Abc"), null);
        assert.strictEqual(screen.findStockLot(8, " lot-9 ").lot_id, 23);
        assert.strictEqual(screen.findStockLot(8, ""), null);
    }
);

QUnit.test("lots that differ in case stay on lines of their own", async (assert) => {
    const {screen} = scrapScreen({stock: STOCK});
    await screen.addOrIncrement(BY_LOT, "ABC", 1);
    await screen.addOrIncrement(BY_LOT, "abc", 1);
    assert.deepEqual(
        screen.state.lines.map((l) => l.lot_id),
        [22, 21]
    );
});

QUnit.test("the single lot a location holds fills itself in", async (assert) => {
    const {screen} = scrapScreen({
        stock: [{product_id: 8, lot_id: 23, lot_name: "LOT-9", quantity: 1}],
    });
    await screen.addOrIncrement(BY_LOT, null, 1);
    assertMatch(
        assert,
        screen.state.lines[0],
        {lot_id: 23, lot_name: "LOT-9"},
        "single lot"
    );
    // Not when the location holds several lots of it.
    const several = scrapScreen({stock: STOCK}).screen;
    await several.addOrIncrement(BY_LOT, null, 1);
    assertMatch(
        assert,
        several.state.lines[0],
        {lot_id: false, lot_name: ""},
        "several lots"
    );
});

QUnit.test("a serial number is listed once, one unit", async (assert) => {
    const {screen, notes} = scrapScreen();
    await screen.addOrIncrement(BY_SERIAL, "SN-1", 3);
    await screen.addOrIncrement(BY_SERIAL, "SN-1", 1);
    assert.strictEqual(screen.state.lines.length, 1);
    assert.strictEqual(screen.state.lines[0].qty, "1");
    assert.deepEqual(notes, [
        {message: "Serial number SN-1 is already on the list.", type: "warning"},
    ]);
});

QUnit.test("a line shows what the location holds of it", (assert) => {
    const {screen} = scrapScreen({stock: STOCK});
    assert.strictEqual(screen.available({product_id: 7, tracking: "none"}), 10);
    assert.strictEqual(
        screen.available({product_id: 8, tracking: "lot", lot_id: 22}),
        3
    );
    // A tracked line without its lot yet: nothing to show.
    assert.strictEqual(
        screen.available({product_id: 8, tracking: "lot", lot_id: false}),
        null
    );
});

QUnit.test("the scrap button and the final message sum the lines up", (assert) => {
    const {screen} = scrapScreen();
    assert.strictEqual(String(screen.scrapLabel()), "Scrap");
    const kilos = [
        {product_id: 8, product_name: "Cheese", uom: "kg", qty: "2"},
        {product_id: 8, product_name: "Cheese", uom: "kg", qty: "0.5"},
    ];
    screen.state.lines = kilos;
    assert.strictEqual(screen.scrapLabel(), "Scrap 2.5 kg");
    assert.strictEqual(screen.scrappedMessage(kilos), "Scrapped 2.5 kg of Cheese.");
    // Units that cannot be added up: a count of products instead.
    const mixed = [
        ...kilos,
        {product_id: 7, product_name: "Bolts", uom: "Units", qty: "4"},
    ];
    screen.state.lines = mixed;
    assert.strictEqual(screen.scrapLabel(), "Scrap 2 products");
    assert.strictEqual(screen.scrappedMessage(mixed), "Scrapped 2 products.");
});

QUnit.test("a scan counts the pieces it states, or one unit", (assert) => {
    const {screen} = scrapScreen();
    assert.strictEqual(screen.scannedQuantity({qty: 4, quantity: 4}, 1), 4);
    assert.strictEqual(screen.scannedQuantity({qty: null, quantity: null}, 1), 1);
    // A weight is no count: converting it is left to a bridge module.
    assert.strictEqual(screen.scannedQuantity({qty: null, weight: 1.25}, 12), 1);
    assert.strictEqual(screen.scannedQuantity(null, 1), 1);
});

QUnit.test("only goods are searched for, scanned or picked", async (assert) => {
    const {screen, searches} = scrapScreen({found: [UNTRACKED]});
    await screen.onBarcodeScanned("9501101020917", {value: "9501101020917"});
    assert.deepEqual(searches[0].slice(0, 1), SCRAPPABLE_PRODUCTS);
    assert.strictEqual(screen.state.lines[0].product_id, 7);

    const selector = Object.create(ScrapProductSelectorScreen.prototype);
    const domains = [];
    selector.props = {params: {stockProductIds: [7]}};
    selector.state = {search: "", results: [], loading: true};
    selector.inventory = {
        searchRead: async (model, domain) => {
            domains.push(domain);
            return [];
        },
    };
    await selector.search();
    selector.state.search = "bolt";
    await selector.search();
    assert.deepEqual(domains, [
        [...SCRAPPABLE_PRODUCTS, ["id", "in", [7]]],
        [
            ...SCRAPPABLE_PRODUCTS,
            "|",
            ["name", "ilike", "bolt"],
            ["barcode", "ilike", "bolt"],
        ],
    ]);
});

QUnit.test("the lines in progress survive a trip to the product selector", (assert) => {
    const line = {_id: 1, product_id: 7, lot_id: false, lot_name: "", qty: "2"};
    const {screen, moves} = scrapScreen({stock: STOCK, lines: [line]});
    screen.addProduct();
    const [{route, params}] = moves;
    assert.strictEqual(route, "scrap_product_selector");
    assertMatch(
        assert,
        params,
        {
            locationId: 3,
            lines: [line],
            scrapLocationId: 4,
            stockProductIds: [7, 8],
        },
        "selector params"
    );
    // A copy: what happens to the screen's lines meanwhile is not carried.
    assert.notStrictEqual(params.lines[0], line);

    const selector = Object.create(ScrapProductSelectorScreen.prototype);
    const back = [];
    selector.props = {params};
    selector.store = {goBack: (backParams) => back.push(backParams)};
    selector.pickProduct(BY_LOT);
    assertMatch(
        assert,
        back[0],
        {locationId: 3, lines: [line], scrapLocationId: 4},
        "back params"
    );
    assertMatch(
        assert,
        back[0].addProduct,
        {id: 8, tracking: "lot", uom_id: [12, "kg"]},
        "added product"
    );
});

QUnit.test("a scan waits while the scrap is on its way", async (assert) => {
    const {screen, notes, searches} = scrapScreen({found: [UNTRACKED]});
    screen.state.scrapping = true;
    await screen.onBarcodeScanned("9501101020917", {value: "9501101020917"});
    assert.deepEqual(searches, []);
    assert.deepEqual(screen.state.lines, []);
    assert.deepEqual(notes, [
        {message: "Wait until the scrap is done to scan again.", type: "warning"},
    ]);
});

QUnit.test(
    "scrapping anyway only covers the lines the warning was about",
    async (assert) => {
        const short = {
            product_name: "Bolts",
            lot_name: false,
            requested: 12,
            available: 10,
            uom: "Units",
        };
        const line = {
            _id: 1,
            product_id: 7,
            product_name: "Bolts",
            tracking: "none",
            uom: "Units",
            lot_id: false,
            lot_name: "",
            qty: "12",
        };
        const {screen, calls, dialogs, moves} = scrapScreen({
            lines: [line],
            answers: [
                {done: false, insufficient: [short]},
                {done: true, count: 1, names: ["SP/1"]},
            ],
        });
        await screen.scrap();
        assertMatch(
            assert,
            calls[0],
            {force: false, scrap_location_id: 4},
            "first call"
        );
        // Confirmed as warned: forced.
        await dialogs[0].confirm();
        assert.strictEqual(calls[1].force, true);
        assert.strictEqual(moves[0].route, "main");

        // Lines changed between the warning and the confirmation: checked again.
        const again = scrapScreen({
            lines: [{...line}],
            answers: [
                {done: false, insufficient: [short]},
                {done: false, insufficient: [short]},
            ],
        });
        await again.screen.scrap();
        again.screen.state.lines[0].qty = "20";
        await again.dialogs[0].confirm();
        assert.strictEqual(again.calls[1].force, false);
        assert.strictEqual(again.calls[1].lines[0].qty, 20);
    }
);

QUnit.test("without a destination there is nothing to scrap into", async (assert) => {
    const line = {
        _id: 1,
        product_id: 7,
        tracking: "none",
        lot_id: false,
        lot_name: "",
        qty: "1",
    };
    const {screen, calls, notes} = scrapScreen({lines: [line]});
    assert.strictEqual(screen.canScrap, true);
    screen.state.scrapLocationId = null;
    assert.strictEqual(screen.canScrap, false);
    await screen.scrap();
    assert.deepEqual(calls, []);
    assert.deepEqual(notes, [
        {message: "Choose where the scrapped goods go.", type: "warning"},
    ]);
});

QUnit.test("a search answered late never overwrites a later one", async (assert) => {
    const selector = Object.create(ScrapProductSelectorScreen.prototype);
    const pending = [];
    selector.props = {params: {stockProductIds: []}};
    selector.state = {search: "", results: [], loading: true};
    selector.inventory = {
        searchRead: () => new Promise((resolve) => pending.push(resolve)),
    };
    selector.state.search = "bo";
    const first = selector.search();
    selector.state.search = "bolt";
    const second = selector.search();
    // The later search answers first, the earlier one after it.
    pending[1]([BY_LOT]);
    await second;
    pending[0]([UNTRACKED, BY_LOT]);
    await first;
    assert.deepEqual(selector.state.results, [BY_LOT]);
});
