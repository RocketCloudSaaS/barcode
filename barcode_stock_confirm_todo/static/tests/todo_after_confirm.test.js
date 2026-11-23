import {describe, expect, test} from "@odoo/hoot";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {tabForMove} from "@barcode_stock/js/utils/move_progress.esm";

describe("BarcodeStockConfirmTodo", () => {
    function screen(moves, highlightedMoveId = null) {
        return Object.assign(Object.create(PickingScreen.prototype), {
            state: {moves, activeTab: "info", highlightedMoveId},
        });
    }

    const todoMove = {
        id: 1,
        product_uom_qty: 2000,
        quantity: 2000,
        qty_done_total: 0,
    };
    const doneMove = {
        id: 2,
        product_uom_qty: 1000,
        quantity: 1000,
        qty_done_total: 1000,
    };

    test("the tab rule and the list rule agree on what is pending", () => {
        expect(tabForMove(todoMove)).toBe("todo");
        expect(tabForMove(doneMove)).toBe("done");
    });

    test("a confirmation that completes one move of many stays on To Do", () => {
        const s = screen([{...doneMove}, {...todoMove}], doneMove.id);
        s.focusScannedMove();
        expect(s.state.activeTab).toBe("todo");
    });

    test("a fully picked picking lands on Done", () => {
        const s = screen([{...doneMove}, {...doneMove, id: 3}], doneMove.id);
        s.focusScannedMove();
        expect(s.state.activeTab).toBe("done");
    });

    test("a picking without moves keeps the tab it opened on", () => {
        const s = screen([]);
        s.focusScannedMove();
        expect(s.state.activeTab).toBe("info");
    });

    test("a reload without a highlighted move keeps the tab", () => {
        // Deleting a line on Done must not chase another pending move to To Do.
        const s = screen([{...todoMove}, {...doneMove}]);
        s.state.activeTab = "done";
        s.focusScannedMove();
        expect(s.state.activeTab).toBe("done");
    });

    test("a highlighted move that no longer exists keeps the tab", () => {
        const s = screen([{...todoMove}], 999);
        s.state.activeTab = "done";
        s.focusScannedMove();
        expect(s.state.activeTab).toBe("done");
    });
});
