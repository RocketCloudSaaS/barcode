import {beforeEach, describe, expect, test} from "@odoo/hoot";
import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";
import {MoveWizardScreen} from "@barcode_stock/js/screens/move_wizard_screen.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {patchTranslations} from "@web/../tests/web_test_helpers";

const STOCK = [8, "WH/Stock"];
const SHELF_1 = [11, "WH/Stock/Shelf 1"];
const SHELF_2 = [12, "WH/Stock/Shelf 2"];
const OUTPUT = [13, "WH/Output"];
const LOT_A = {id: 21, name: "6077102", product_id: [7, "Duck confit"]};
const LOT_B = {id: 22, name: "6077103", product_id: [7, "Duck confit"]};

let lineId = 0;

/**
 * A line of move 5, reserved where Odoo found its stock.
 *
 * @param {Object} values the line's quantity, what was picked, its lot and
 *   locations
 * @returns {Object} the line
 */
function line({quantity, picked = 0, lot = false, from = SHELF_1, to = OUTPUT}) {
    lineId += 1;
    return {
        id: lineId,
        move_id: [5, "Duck confit"],
        product_id: [7, "Duck confit"],
        lot_id: lot ? [lot.id, lot.name] : false,
        quantity,
        qty_picked: picked,
        location_id: from,
        location_dest_id: to,
    };
}

/**
 * A move wizard on move 5 of picking 3, without mounting it. What it confirms
 * lands in `confirmed`, and the lots it looks up in `lookedUp`, found at
 * `lotAt`.
 *
 * @param {Object} [options] the operation, the product's tracking, the move's
 *   lines, what the move still lacks, the lot scanned and where lots lie
 * @returns {MoveWizardScreen} the wizard
 */
function moveWizard({
    type = "internal",
    tracking = "none",
    lines = [],
    remaining = 5,
    defaultLot = null,
    lotAt = false,
} = {}) {
    const wizard = Object.create(MoveWizardScreen.prototype);
    const move = {
        id: 5,
        product_id: [7, "Duck confit"],
        product_uom_qty: remaining,
        location_id: type === "incoming" ? [4, "Partners/Vendors"] : STOCK,
        location_dest_id: type === "incoming" ? STOCK : OUTPUT,
    };
    Object.assign(wizard, {
        props: {
            params: {moveId: 5, pickingId: 3, pickingTypeCode: type, defaultLot},
        },
        lookedUp: [],
        state: {
            selectedLotId: defaultLot ? String(defaultLot) : null,
            qtyPicked: 1,
            tracking: "none",
            mode: "pick",
            lots: [],
            useExistingLots: true,
            useCreateLots: type === "incoming",
            sourceLocation: null,
            destLocation: null,
        },
        barcodeScannerState: {
            ready: true,
            activePickingId: 3,
            useExistingLots: true,
            useCreateLots: type === "incoming",
            lotsById: {21: LOT_A, 22: LOT_B},
            getMove: () => move,
            getProduct: () => ({id: 7, tracking}),
            getMoveLinesForMove: () => lines,
            getLotsForProduct: () => [LOT_A, LOT_B],
            getRemainingQty: () => remaining,
            lotSourceLocation: async (lotId, locationId) => {
                wizard.lookedUp.push([lotId, locationId]);
                return lotAt;
            },
        },
        barcodeScannerSync: {
            validateConfirmMovePayload: () => null,
            confirmMove: async (payload) => {
                wizard.confirmed = payload;
            },
        },
        feedback: {success: () => undefined},
        store: {navigate: () => undefined},
        inventory: {notify: () => undefined},
    });
    return wizard;
}

describe("BarcodeStock", () => {
    beforeEach(() => patchTranslations());

    test("a pick writes no location the operator did not choose", () => {
        const state = new BarcodeScannerState({});
        const reserved = line({quantity: 2});
        state.pickingTypeCode = "internal";
        state.moveLines = [reserved];
        const pick = {moveId: 5, pickingId: 3, productId: 7, qtyPicked: 2};
        state.stageMoveLine(pick);
        expect(reserved.location_id).toEqual(SHELF_1);
        expect(reserved.location_dest_id).toEqual(OUTPUT);
        const [sent] = state.sync.queue;
        expect("location_id" in sent.values).toBe(false);
        expect("location_dest_id" in sent.values).toBe(false);
        // One the operator chose is written.
        state.stageMoveLine({...pick, locationId: 12, locationDestId: 8});
        expect(state.sync.queue[0].values).toMatchObject({
            location_id: 12,
            location_dest_id: 8,
        });
    });

    test("outside receptions, a pick fills the reserved lines in turn", () => {
        const state = new BarcodeScannerState({});
        const first = line({quantity: 2, picked: 1});
        const second = line({quantity: 3, from: SHELF_2});
        state.pickingTypeCode = "internal";
        state.moveLines = [first, second];
        const pick = {moveId: 5, pickingId: 3, productId: 7, qtyPicked: 1};
        state.stageMoveLine(pick);
        expect(first.qty_picked).toBe(2);
        state.stageMoveLine(pick);
        expect(second.qty_picked).toBe(1);
        // A reception goes on the line with nothing picked yet, as before.
        const receipt = new BarcodeScannerState({});
        const started = line({quantity: 2, picked: 1});
        const untouched = line({quantity: 3});
        receipt.pickingTypeCode = "incoming";
        receipt.moveLines = [started, untouched];
        receipt.stageMoveLine(pick);
        expect(untouched.qty_picked).toBe(1);
    });

    test("a product without lots is picked line by line, from where it lies", async () => {
        const first = line({quantity: 2});
        const second = line({quantity: 3, from: SHELF_2});
        const wizard = moveWizard({lines: [first, second]});
        await wizard.loadData();
        expect(wizard.targetLine).toBe(first);
        expect(wizard.pickableQty).toBe(2);
        expect(wizard.shownSourceLocation).toEqual({
            id: 11,
            display_name: "WH/Stock/Shelf 1",
        });
        wizard.fulfillRemaining();
        await wizard.confirmPick();
        expect(wizard.confirmed).toMatchObject({
            moveLineId: first.id,
            qtyPicked: 2,
            locationId: false,
            locationDestId: false,
        });
        // The first line picked, the second one is next, from its own shelf.
        first.qty_picked = 2;
        const next = moveWizard({lines: [first, second], remaining: 3});
        await next.loadData();
        expect(next.targetLine).toBe(second);
        expect(next.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 2");
    });

    test("only a location the operator chose is sent", async () => {
        const wizard = moveWizard({lines: [line({quantity: 2})]});
        await wizard.loadData();
        wizard.state.sourceLocation = {id: 12, display_name: "WH/Stock/Shelf 2"};
        expect(wizard.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 2");
        await wizard.confirmPick();
        expect(wizard.confirmed).toMatchObject({locationId: 12, locationDestId: false});
    });

    test("the location shown follows the lot chosen", async () => {
        const wizard = moveWizard({
            tracking: "lot",
            lines: [
                line({quantity: 2, lot: LOT_A}),
                line({quantity: 3, lot: LOT_B, from: SHELF_2}),
            ],
        });
        await wizard.loadData();
        expect(wizard.state.selectedLotId).toBe("21");
        expect(wizard.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 1");
        wizard.onLotChange({target: {value: "22"}});
        expect(wizard.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 2");
    });

    test("a lot the reservation does not carry is picked from where it lies", async () => {
        // A delivery reserved lot A on Shelf 1; lot B lies on Shelf 2.
        const wizard = moveWizard({
            type: "outgoing",
            tracking: "lot",
            lines: [line({quantity: 2, lot: LOT_A})],
            lotAt: SHELF_2,
        });
        await wizard.loadData();
        expect(wizard.lookedUp).toEqual([]);
        await wizard.onLotChange({target: {value: "22"}});
        expect(wizard.lookedUp).toEqual([[22, 8]]);
        expect(wizard.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 2");
        await wizard.confirmPick();
        expect(wizard.confirmed).toMatchObject({lotId: 22, locationId: 12});
        // Back on the reserved lot, its line's shelf again, and none written.
        await wizard.onLotChange({target: {value: "21"}});
        expect(wizard.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 1");
        await wizard.confirmPick();
        expect(wizard.confirmed).toMatchObject({lotId: 21, locationId: false});
    });

    test("a scanned lot the reservation does not carry is looked up too", async () => {
        const wizard = moveWizard({
            tracking: "lot",
            lines: [line({quantity: 2, lot: LOT_A})],
            defaultLot: 22,
            lotAt: SHELF_2,
        });
        await wizard.loadData();
        expect(wizard.shownSourceLocation.display_name).toBe("WH/Stock/Shelf 2");
        // One the operator chose still wins.
        wizard.state.sourceLocation = {id: 8, display_name: "WH/Stock"};
        await wizard.confirmPick();
        expect(wizard.confirmed).toMatchObject({locationId: 8});
        // A lot with no stock under the move's source keeps the line's.
        const nowhere = moveWizard({
            tracking: "lot",
            lines: [line({quantity: 2, lot: LOT_A})],
            defaultLot: 22,
        });
        await nowhere.loadData();
        await nowhere.confirmPick();
        expect(nowhere.confirmed).toMatchObject({locationId: false});
    });

    test("where a lot lies is its oldest quant with stock under the source", async () => {
        const asked = [];
        const state = new BarcodeScannerState({
            searchRead: async (...args) => {
                asked.push(args);
                return [{id: 3, location_id: SHELF_2}];
            },
        });
        expect(await state.lotSourceLocation(22, 8)).toEqual(SHELF_2);
        expect(asked).toEqual([
            [
                "stock.quant",
                [
                    ["lot_id", "=", 22],
                    ["location_id", "child_of", 8],
                    ["quantity", ">", 0],
                ],
                ["location_id"],
                {limit: 1, order: "in_date, id"},
            ],
        ]);
        const empty = new BarcodeScannerState({searchRead: async () => []});
        expect(await empty.lotSourceLocation(22, 8)).toBe(false);
    });

    test("a reception shows its line's putaway shelf and keeps it", async () => {
        const wizard = moveWizard({
            type: "incoming",
            lines: [line({quantity: 3, from: [4, "Partners/Vendors"], to: SHELF_2})],
            remaining: 3,
        });
        await wizard.loadData();
        expect(wizard.targetLine).toBe(null);
        expect(wizard.shownDestLocation.display_name).toBe("WH/Stock/Shelf 2");
        await wizard.confirmPick();
        expect(wizard.confirmed).toMatchObject({locationDestId: false});
    });

    test("a re-scan in the picking sends no location", async () => {
        const screen = Object.create(PickingScreen.prototype);
        const sent = [];
        const move = {id: 5, product_id: [7, "Duck confit"], location_id: STOCK};
        Object.assign(screen, {
            props: {},
            state: {
                picking: {id: 3},
                moveLines: [line({quantity: 2, picked: 1})],
            },
            barcodeScannerState: {
                applyScanResult: () => ({candidates: [move], quantity: 1}),
                indexes: {trackingByProductId: {7: "none"}},
            },
            barcodeScannerSync: {confirmMove: async (payload) => sent.push(payload)},
            feedback: {success: () => undefined},
            setLastScanContext: () => undefined,
            _reloadMoves: async () => undefined,
        });
        await screen.handleBarcode("DUCK");
        expect(sent.length).toBe(1);
        expect("locationId" in sent[0]).toBe(false);
        expect("locationDestId" in sent[0]).toBe(false);
    });
});
