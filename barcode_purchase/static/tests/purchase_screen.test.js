import {
    PRODUCT_FIELDS,
    PURCHASABLE_PRODUCTS,
    PurchaseScreen,
} from "@barcode_purchase/js/screens/purchase_screen.esm";
import {beforeEach, describe, expect, test} from "@odoo/hoot";
import {PurchaseProductSelectorScreen} from "@barcode_purchase/js/screens/product_selector_screen.esm";
import {patchTranslations} from "@web/../tests/web_test_helpers";

const BOLTS = {
    id: 7,
    display_name: "Bolts",
    default_code: "B-7",
    standard_price: 2,
    tracking: "none",
    uom_po_id: [1, "Units"],
};
const CHEESE = {...BOLTS, id: 8, display_name: "Cheese", tracking: "lot"};

/**
 * A purchase screen, without mounting it. What it tells the operator lands in
 * `notes`, where it navigates in `moves`, what it searches for in `searches`
 * (answered by model with `found`) and the orders it sends in `calls`, answered
 * with `answer`.
 */
function purchaseScreen({found = {}, answer = null, state = {}} = {}) {
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
            return found[model] || [];
        },
        call: async (model, method, args, kwargs) => {
            calls.push({model, method, args, kwargs});
            return answer;
        },
    };
    screen.store = {navigate: (route, params) => moves.push({route, params})};
    return {screen, notes, moves, searches, calls};
}

describe("BarcodePurchase", () => {
    beforeEach(() => patchTranslations());

    test("the same product and lot add up on one line", () => {
        const {screen} = purchaseScreen();
        screen.addLine(BOLTS, null, 1);
        screen.addLine(BOLTS, null, 2);
        screen.addLine(CHEESE, "LOT-A", 1);
        screen.addLine(CHEESE, "LOT-B", 1);
        expect(
            screen.state.lines.map((l) => [l.product_id, l.lot_name, l.qty])
        ).toEqual([
            [7, null, 3],
            [8, "LOT-A", 1],
            [8, "LOT-B", 1],
        ]);
        expect(screen.state.lines[0]).toMatchObject({price_unit: 2, tracking: "none"});
        screen.removeLine(screen.state.lines[1]);
        expect(screen.state.lines.map((l) => l.lot_name)).toEqual([null, "LOT-B"]);
    });

    test("a picked product brings the lot and the pieces its label states", () => {
        const {screen} = purchaseScreen();
        screen.addPicked({product: CHEESE, parsed: {lot: "LOT-A", qty: 3}});
        screen.addPicked({product: CHEESE, parsed: {serial: "SN-1", qty: null}});
        screen.addPicked({product: BOLTS, parsed: null});
        expect(screen.state.lines.map((l) => [l.lot_name, l.qty])).toEqual([
            ["LOT-A", 3],
            ["SN-1", 1],
            [null, 1],
        ]);
        // A weight is no count: converting it is left to a bridge module.
        expect(screen.scannedQuantity({qty: null, weight: 1.25}, 12)).toBe(1);
    });

    test("a scanned location sets the destination, anything else a product", async () => {
        const shelf = {id: 5, display_name: "WH/Stock/Shelf"};
        const withShelf = purchaseScreen({found: {"stock.location": [shelf]}});
        await withShelf.screen.onBarcodeScanned("LOC-SHELF", null);
        expect(withShelf.screen.state.destinationLocation).toEqual(shelf);
        expect(withShelf.searches[0].domain[0]).toEqual(["usage", "=", "internal"]);
        expect(withShelf.screen.state.lines).toEqual([]);

        const {screen, searches} = purchaseScreen({
            found: {"product.product": [BOLTS]},
        });
        await screen.onBarcodeScanned("9501101020917", {value: "9501101020917"});
        expect(searches[1].domain.slice(0, 2)).toEqual(PURCHASABLE_PRODUCTS);
        expect(screen.state.lines[0].product_id).toBe(7);
    });

    test("an unknown product and a scan while saving add nothing", async () => {
        const {screen, notes} = purchaseScreen();
        await screen.onBarcodeScanned("NOPE", null);
        screen.state.saving = true;
        await screen.onBarcodeScanned("NOPE", null);
        expect(screen.state.lines).toEqual([]);
        expect(notes.map((n) => n.message)).toEqual([
            "Product not found.",
            "Wait until the order is saved to scan again.",
        ]);
    });

    test("the order is sent in one call, with all the operator chose", async () => {
        const {screen, calls, moves, notes} = purchaseScreen({
            answer: {
                name: "P00042",
                state: "purchase",
                missing_lots: [],
                unplaced_lots: [],
            },
            state: {
                destinationLocation: {id: 5, display_name: "Shelf"},
                buyer: {id: 9, name: "Buyer"},
                vendorRef: "REF-1",
            },
        });
        screen.addLine(CHEESE, "LOT-A", 2);
        await screen.createPurchase();
        expect(calls).toEqual([
            {
                model: "purchase.order",
                method: "action_barcode_purchase",
                args: [3, [{product_id: 8, qty: 2, price_unit: 2, lot_name: "LOT-A"}]],
                kwargs: {
                    confirm: true,
                    location_dest_id: 5,
                    user_id: 9,
                    partner_ref: "REF-1",
                },
            },
        ]);
        expect(moves).toEqual([{route: "main", params: undefined}]);
        expect(notes).toEqual([
            {message: "Purchase order P00042 confirmed.", type: "success"},
        ]);
        expect(screen.state.saving).toBe(false);
    });

    test("nothing is sent without a vendor or a product", async () => {
        const noVendor = purchaseScreen({state: {supplier: null}});
        await noVendor.screen.createPurchase();
        const noLines = purchaseScreen();
        await noLines.screen.createPurchase();
        expect([...noVendor.calls, ...noLines.calls]).toEqual([]);
        expect([noVendor.notes[0].message, noLines.notes[0].message]).toEqual([
            "Please select a supplier.",
            "Please add at least one product.",
        ]);
    });

    test("the operator is told what the order ended up as", () => {
        const told = (result, state = {}) => {
            const {screen, notes} = purchaseScreen({state});
            screen.notifyOutcome({missing_lots: [], unplaced_lots: [], ...result});
            return notes.map((n) => [n.message, n.type]);
        };
        expect(told({name: "P1", state: "purchase", missing_lots: ["Cheese"]})).toEqual(
            [
                [
                    "P1 confirmed -- set the lot/serial of Cheese on the receipt.",
                    "warning",
                ],
            ]
        );
        expect(told({name: "P1", state: "to approve"})).toEqual([
            ["Purchase order P1 created -- it is waiting for approval.", "warning"],
        ]);
        expect(told({name: "P1", state: "draft"})).toEqual([
            ["Purchase order P1 was created but is still a draft.", "warning"],
        ]);
        expect(told({name: "P1", state: "draft"}, {autoValidate: false})).toEqual([
            ["Purchase order P1 saved as a draft.", "success"],
        ]);
        expect(
            told({name: "P1", state: "purchase", unplaced_lots: ["Cheese (LOT-X)"]})
        ).toEqual([
            ["Set these lots on the receipt by hand: Cheese (LOT-X)", "warning"],
            ["Purchase order P1 confirmed.", "success"],
        ]);
    });

    test("the product selector hands the picked product back", () => {
        const selector = Object.create(PurchaseProductSelectorScreen.prototype);
        const moves = [];
        const lines = [{product_id: 7, lot_name: null, qty: 1}];
        selector.props = {params: {supplier: {id: 3}, lines}};
        selector.store = {navigate: (route, params) => moves.push({route, params})};
        selector.confirmSelection({...CHEESE, image_url: "/x.png"}, {lot: "LOT-A"});
        expect(moves[0].route).toBe("purchase");
        expect(moves[0].params).toMatchObject({
            supplier: {id: 3},
            lines,
            addProduct: {
                product: {id: 8, uom_po_id: [1, "Units"]},
                parsed: {lot: "LOT-A"},
            },
        });
        // Only the fields a line needs ride along.
        expect(Object.keys(moves[0].params.addProduct.product).sort()).toEqual(
            ["id", ...PRODUCT_FIELDS].sort()
        );
    });
});
