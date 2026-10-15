/** @odoo-module **/

import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";

QUnit.module("BarcodeStock", () => {
    QUnit.test("grouping levels nest in the order of groupOrder", (assert) => {
        const list = Object.create(PickingListScreen.prototype);
        list.state = {groupByLevels: []};
        list.computeGroups = () => undefined;
        // A module adding a level only extends groupOrder.
        list.groupOrder = ["extra", "date", "state"];
        list.toggleGroupLevel("state");
        list.toggleGroupLevel("extra");
        assert.deepEqual(list.state.groupByLevels, ["extra", "state"]);
        list.toggleGroupLevel("date");
        assert.deepEqual(list.state.groupByLevels, ["extra", "date", "state"]);
        list.toggleGroupLevel("extra");
        assert.deepEqual(list.state.groupByLevels, ["date", "state"]);
    });
});
