/** @odoo-module **/

import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";
import {MoveWizardScreen} from "@barcode_stock/js/screens/move_wizard_screen.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";

const LOT_A = {id: 21, name: "6077102", product_id: [7, "Duck confit"], product_qty: 4};
const LOT_B = {id: 22, name: "6077103", product_id: [7, "Duck confit"], product_qty: 9};

/**
 * A move wizard on move 5 of picking 3, without mounting it. What it confirms
 * lands in `confirmed`.
 *
 * @param {Object} [options] the operation, the move's lines and the lot and
 *   quantity given
 * @returns {MoveWizardScreen} the wizard
 */
function moveWizard({
    type = "outgoing",
    lines = [],
    defaultLot = null,
    defaultQty = null,
    tracking = "lot",
    remaining = 4,
} = {}) {
    const wizard = Object.create(MoveWizardScreen.prototype);
    wizard.props = {
        params: {
            moveId: 5,
            pickingId: 3,
            pickingTypeCode: type,
            defaultLot,
            defaultQty,
        },
    };
    wizard.state = {
        selectedLotId: defaultLot ? String(defaultLot) : null,
        qtyPicked: defaultQty || 1,
        tracking: "none",
        mode: "pick",
        lots: [],
        useExistingLots: true,
        useCreateLots: false,
        sourceLocation: null,
        destLocation: null,
    };
    wizard.barcodeScannerState = {
        ready: true,
        activePickingId: 3,
        useExistingLots: true,
        useCreateLots: type === "incoming",
        lotsById: {21: LOT_A, 22: LOT_B},
        getMove: () => ({
            id: 5,
            product_id: [7, "Duck confit"],
            product_uom_qty: 4,
            location_id: [8, "WH/Stock"],
            location_dest_id: [9, "Customers"],
        }),
        getProduct: () => ({id: 7, tracking}),
        getMoveLinesForMove: () => lines,
        getLotsForProduct: () => [LOT_B],
        getRemainingQty: () => remaining,
        lotSourceLocation: async () => false,
    };
    Object.assign(wizard, {
        feedback: {success: () => undefined},
        barcodeScannerSync: {
            validateConfirmMovePayload: () => null,
            confirmMove: async (payload) => {
                wizard.confirmed = payload;
            },
        },
        store: {navigate: () => undefined},
        inventory: {notify: () => undefined},
    });
    return wizard;
}

let lineId = 0;

function line(lotId, quantity, qtyPicked = 0) {
    lineId += 1;
    return {
        id: lineId,
        move_id: [5, "Duck confit"],
        product_id: [7, "Duck confit"],
        lot_id: lotId ? [lotId, lotId === 21 ? "6077102" : "6077103"] : false,
        quantity,
        qty_picked: qtyPicked,
    };
}

/**
 * Assert that `actual` carries every key of `expected` with the same value.
 *
 * @param {Object} assert the QUnit assertion object
 * @param {Object} actual the object handed over
 * @param {Object} expected the values it must carry
 */
function assertContains(assert, actual, expected) {
    for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(actual[key], value, key);
    }
}

QUnit.module("BarcodeStock", () => {
    QUnit.test(
        "a move reserved against a lot opens with that lot chosen",
        async (assert) => {
            const wizard = moveWizard({lines: [line(21, 4)]});
            await wizard.loadData();
            assert.strictEqual(wizard.state.selectedLotId, "21");
            // Listed even if the lots offered had left it out.
            assert.deepEqual(
                wizard.state.lots.map((lot) => lot.id),
                [21, 22]
            );
        }
    );

    QUnit.test("the next reserved lot once the first one is picked", async (assert) => {
        const wizard = moveWizard({lines: [line(21, 2, 2), line(22, 2)]});
        await wizard.loadData();
        assert.strictEqual(wizard.state.selectedLotId, "22");
        // Everything picked: no lot is chosen for the operator.
        const done = moveWizard({lines: [line(21, 2, 2), line(22, 2, 2)]});
        await done.loadData();
        assert.strictEqual(done.state.selectedLotId, null);
    });

    QUnit.test(
        "a scanned lot, a reception or an untracked product keep their way",
        async (assert) => {
            const scanned = moveWizard({lines: [line(21, 4)], defaultLot: 22});
            await scanned.loadData();
            assert.strictEqual(scanned.state.selectedLotId, "22");
            const receipt = moveWizard({type: "incoming", lines: [line(21, 4)]});
            await receipt.loadData();
            assert.strictEqual(receipt.state.selectedLotId, null);
            const untracked = moveWizard({tracking: "none", lines: [line(21, 4)]});
            await untracked.loadData();
            assert.strictEqual(untracked.state.selectedLotId, null);
            const noLot = moveWizard({lines: [line(null, 4)]});
            await noLot.loadData();
            assert.strictEqual(noLot.state.selectedLotId, null);
        }
    );

    QUnit.test(
        "Fulfill completes the chosen lot's reservation, not the whole move",
        async (assert) => {
            // 4 reserved over two lots, 2 each.
            const wizard = moveWizard({lines: [line(21, 2), line(22, 2)]});
            await wizard.loadData();
            assert.strictEqual(wizard.state.selectedLotId, "21");
            assert.strictEqual(wizard.pickableQty, 2);
            assert.strictEqual(wizard.fulfillIncrement, 1);
            assert.strictEqual(wizard.quantityHelper, "2 remaining to process");
            wizard.fulfillRemaining();
            assert.strictEqual(wizard.state.qtyPicked, 2);
            assert.strictEqual(wizard.canFulfill, false);
            // Lot A picked, the wizard opens on lot B with what is left of it.
            const next = moveWizard({
                lines: [line(21, 2, 2), line(22, 2)],
                remaining: 2,
            });
            await next.loadData();
            assert.strictEqual(next.state.selectedLotId, "22");
            next.fulfillRemaining();
            assert.strictEqual(next.state.qtyPicked, 2);
        }
    );

    QUnit.test(
        "a lot with nothing reserved left fulfils what the move lacks",
        async (assert) => {
            // The operator picks lot A again, its reservation already picked.
            const wizard = moveWizard({
                lines: [line(21, 2, 2), line(22, 2)],
                defaultLot: 21,
                remaining: 2,
            });
            await wizard.loadData();
            assert.strictEqual(wizard.state.selectedLotId, "21");
            assert.strictEqual(wizard.pickableQty, 2);
            // No lot chosen at all: the move's remaining, as before.
            const none = moveWizard({tracking: "none", remaining: 3});
            await none.loadData();
            assert.strictEqual(none.pickableQty, 3);
        }
    );

    QUnit.test(
        "a lot reserved over several lines is picked line by line",
        async (assert) => {
            // 9 reserved: lot A over two lines (2 + 3), lot B on one.
            const [a1, a2, b] = [line(21, 2), line(21, 3), line(22, 4)];
            const wizard = moveWizard({lines: [a1, a2, b], remaining: 9});
            await wizard.loadData();
            assert.strictEqual(wizard.state.selectedLotId, "21");
            assert.strictEqual(wizard.targetLine, a1);
            wizard.fulfillRemaining();
            assert.strictEqual(wizard.state.qtyPicked, 2);
            // Confirmed on that very line.
            await wizard.confirmPick();
            assertContains(assert, wizard.confirmed, {
                moveLineId: a1.id,
                lotId: 21,
                qtyPicked: 2,
            });
            // Its first line picked, lot A goes on with its second one.
            a1.qty_picked = 2;
            const next = moveWizard({lines: [a1, a2, b], remaining: 7});
            await next.loadData();
            assert.strictEqual(next.state.selectedLotId, "21");
            assert.strictEqual(next.targetLine, a2);
            assert.strictEqual(next.pickableQty, 3);
            // Lot A covered, even if over-picked on its first line: on to lot B.
            a1.qty_picked = 5;
            const last = moveWizard({lines: [a1, a2, b], remaining: 4});
            await last.loadData();
            assert.strictEqual(last.state.selectedLotId, "22");
            assert.strictEqual(last.targetLine, b);
            assert.strictEqual(last.pickableQty, 4);
        }
    );

    QUnit.test("a pick goes on the reserved line named", (assert) => {
        const state = new BarcodeScannerState({});
        const [a1, a2] = [line(21, 2), line(21, 3)];
        state.moveLines = [a1, a2];
        const pick = {moveId: 5, pickingId: 3, productId: 7, lotId: 21};
        state.stageMoveLine({...pick, qtyPicked: 3, moveLineId: a2.id});
        assert.strictEqual(a2.qty_picked, 3);
        assert.strictEqual(a1.qty_picked, 0);
        // None named: on the lot's line with nothing picked yet, as before.
        state.stageMoveLine({...pick, qtyPicked: 1});
        assert.strictEqual(a1.qty_picked, 1);
        // One of another move is not taken.
        state.stageMoveLine({...pick, moveId: 6, qtyPicked: 1, moveLineId: a1.id});
        assert.strictEqual(a1.qty_picked, 1);
    });

    QUnit.test(
        "a tapped move starts at no more than its lot's reservation holds",
        async (assert) => {
            const tapped = moveWizard({lines: [line(21, 0.5)]});
            await tapped.loadData();
            assert.strictEqual(tapped.state.selectedLotId, "21");
            assert.strictEqual(tapped.state.qtyPicked, 0.5);
            // Still one unit when the lot holds more.
            const more = moveWizard({lines: [line(21, 3)]});
            await more.loadData();
            assert.strictEqual(more.state.qtyPicked, 1);
            // A scan's quantity stands.
            const scanned = moveWizard({lines: [line(21, 0.5)], defaultQty: 1});
            await scanned.loadData();
            assert.strictEqual(scanned.state.qtyPicked, 1);
        }
    );

    QUnit.test("only a scan hands the wizard a quantity", (assert) => {
        const screen = Object.create(PickingScreen.prototype);
        const opened = [];
        screen.props = {};
        screen.state = {picking: {id: 3}, pickingTypeCode: "outgoing"};
        screen.store = {
            navigate: (name, params) => opened.push(params.defaultQty),
        };
        const move = {id: 5, quantity: 4};
        screen.openMoveWizard(move);
        screen.openMoveWizard(move, {qty: 6});
        assert.deepEqual(opened, [null, 6]);
    });

    QUnit.test(
        "a reception fulfils what the move lacks, whatever its lot's lines hold",
        async (assert) => {
            const receipt = moveWizard({
                type: "incoming",
                lines: [line(21, 1)],
                defaultLot: 21,
                remaining: 4,
            });
            await receipt.loadData();
            assert.strictEqual(receipt.pickableQty, 4);
            receipt.fulfillRemaining();
            assert.strictEqual(receipt.state.qtyPicked, 4);
        }
    );
});
