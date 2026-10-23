import {describe, expect, test} from "@odoo/hoot";
import {MoveWizardScreen} from "@barcode_stock/js/screens/move_wizard_screen.esm";

const LOT_A = {id: 21, name: "6077102", product_id: [7, "Duck confit"], product_qty: 4};
const LOT_B = {id: 22, name: "6077103", product_id: [7, "Duck confit"], product_qty: 9};

/**
 * A move wizard on move 5 of picking 3, without mounting it.
 *
 * @param {Object} [options] the operation, the move's lines and the lot given
 * @returns {MoveWizardScreen} the wizard
 */
function moveWizard({
    type = "outgoing",
    lines = [],
    defaultLot = null,
    tracking = "lot",
} = {}) {
    const wizard = Object.create(MoveWizardScreen.prototype);
    wizard.props = {
        params: {moveId: 5, pickingId: 3, pickingTypeCode: type, defaultLot},
    };
    wizard.state = {
        selectedLotId: defaultLot ? String(defaultLot) : null,
        qtyPicked: 1,
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
        getRemainingQty: () => 4,
    };
    return wizard;
}

function line(lotId, quantity, qtyPicked = 0) {
    return {
        id: lotId * 10,
        move_id: [5, "Duck confit"],
        lot_id: lotId ? [lotId, lotId === 21 ? "6077102" : "6077103"] : false,
        quantity,
        qty_picked: qtyPicked,
    };
}

describe("BarcodeStock", () => {
    test("a move reserved against a lot opens with that lot chosen", async () => {
        const wizard = moveWizard({lines: [line(21, 4)]});
        await wizard.loadData();
        expect(wizard.state.selectedLotId).toBe("21");
        // Listed even if the lots offered had left it out.
        expect(wizard.state.lots.map((lot) => lot.id)).toEqual([21, 22]);
    });

    test("the next reserved lot once the first one is picked", async () => {
        const wizard = moveWizard({lines: [line(21, 2, 2), line(22, 2)]});
        await wizard.loadData();
        expect(wizard.state.selectedLotId).toBe("22");
        // Everything picked: no lot is chosen for the operator.
        const done = moveWizard({lines: [line(21, 2, 2), line(22, 2, 2)]});
        await done.loadData();
        expect(done.state.selectedLotId).toBe(null);
    });

    test("a scanned lot, a reception or an untracked product keep their way", async () => {
        const scanned = moveWizard({lines: [line(21, 4)], defaultLot: 22});
        await scanned.loadData();
        expect(scanned.state.selectedLotId).toBe("22");
        const receipt = moveWizard({type: "incoming", lines: [line(21, 4)]});
        await receipt.loadData();
        expect(receipt.state.selectedLotId).toBe(null);
        const untracked = moveWizard({tracking: "none", lines: [line(21, 4)]});
        await untracked.loadData();
        expect(untracked.state.selectedLotId).toBe(null);
        const noLot = moveWizard({lines: [line(null, 4)]});
        await noLot.loadData();
        expect(noLot.state.selectedLotId).toBe(null);
    });
});
