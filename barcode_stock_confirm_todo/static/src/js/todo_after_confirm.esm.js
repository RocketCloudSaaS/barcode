import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {tabForMove} from "@barcode_stock/js/utils/move_progress.esm";
import {patch} from "@web/core/utils/patch";

/**
 * Extend the core tab decision after a scan.
 *
 * The core screen already shows the tab of the highlighted move. That is
 * right for a move still waiting in "To Do", but it sends the operator to
 * "Done" when a scan completes one line of a picking that still has work,
 * forcing a tap back to "To Do" after every line. Call the core decision
 * first, then only correct that one case: if the highlighted move is complete
 * while another move is still pending, pull the screen back to "To Do".
 * Everything else -- no highlight, a highlight that no longer exists, an
 * empty picking, or a fully picked picking -- keeps the core result.
 */
patch(PickingScreen.prototype, {
    focusScannedMove() {
        super.focusScannedMove();
        const moves = this.state.moves || [];
        const move = moves.find(
            (candidate) => candidate.id === this.state.highlightedMoveId
        );
        // Only correct the one case where the aggregate rule differs from
        // core's: the highlighted move is complete but work remains.
        if (
            move &&
            tabForMove(move) === "done" &&
            moves.some((candidate) => tabForMove(candidate) === "todo")
        ) {
            this.state.activeTab = "todo";
        }
    },
});
