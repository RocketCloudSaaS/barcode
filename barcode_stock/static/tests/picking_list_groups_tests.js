/** @odoo-module **/

import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";

QUnit.module("BarcodeStock", () => {
    QUnit.test("the first group shown starts open, the others collapsed", (assert) => {
        const list = Object.create(PickingListScreen.prototype);
        list.state = {search: ""};
        // The operations came in by scheduled date: the zone of the earliest
        // one is not the first group the list draws.
        const groups = {Zeta: [1], Alpha: [2], "No zone": [3]};
        assert.deepEqual(list.sortedGroupKeys(groups), ["Alpha", "No zone", "Zeta"]);
        assert.deepEqual(list.initialCollapsedGroups(groups), {
            "root-Alpha": false,
            "root-No zone": true,
            "root-Zeta": true,
        });
        // While searching, every group is open.
        list.state.search = "WH/OUT";
        assert.deepEqual(list.initialCollapsedGroups(groups), {
            "root-Alpha": false,
            "root-No zone": false,
            "root-Zeta": false,
        });
    });
});
