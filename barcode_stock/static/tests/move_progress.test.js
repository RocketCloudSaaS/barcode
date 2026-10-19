/** @odoo-module **/

import {isMovePending, tabForMove} from "@barcode_stock/js/utils/move_progress.esm";

QUnit.module("BarcodeStock", () => {
    QUnit.test(
        "a move is pending until the picked quantity reaches the reserved one",
        (assert) => {
            assert.ok(isMovePending({quantity: 5, qty_done_total: 0}));
            assert.ok(isMovePending({quantity: 5, qty_done_total: 4.5}));
            // Nothing reserved: the move is still offered for scanning.
            assert.ok(isMovePending({quantity: 0, qty_done_total: 0}));
            // Complete, and over-picked past the reservation.
            assert.notOk(isMovePending({quantity: 5, qty_done_total: 5}));
            assert.notOk(isMovePending({quantity: 5, qty_done_total: 7}));
            assert.notOk(isMovePending(null));
        }
    );

    QUnit.test("a scan lands on the tab that renders the line", (assert) => {
        // The To Do list hides a completed move, so a scan on one has to open
        // the Done tab or the operator sees a list without their line.
        assert.strictEqual(tabForMove({quantity: 5, qty_done_total: 2}), "todo");
        assert.strictEqual(tabForMove({quantity: 5, qty_done_total: 5}), "done");
    });
});
