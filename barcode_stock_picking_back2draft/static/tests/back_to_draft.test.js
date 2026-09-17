/** @odoo-module **/

import "@barcode_stock_picking_back2draft/js/picking_screen_patch.esm";
import "@barcode_stock_picking_back2draft/js/picking_list_screen_patch.esm";
import {describe, expect, test} from "@odoo/hoot";
import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";

describe("BarcodeStockPickingBack2Draft", () => {
    test("resets a canceled picking after confirmation", async () => {
        const calls = [];
        const navigations = [];
        const dialogs = [];
        const screen = {
            state: {picking: {id: 42, state: "cancel"}},
            pickingId: 42,
            listParams: {warehouseId: 7},
            inventory: {
                call: async (...args) => calls.push(args),
                notify: (...args) => args,
            },
            store: {navigate: (...args) => navigations.push(args)},
            dialog: {add: (dialogClass, props) => dialogs.push({dialogClass, props})},
        };

        await PickingScreen.prototype.backToDraft.call(screen);

        expect(dialogs.length).toBe(1);
        await dialogs[0].props.confirm();
        expect(calls).toEqual([["stock.picking", "action_back_to_draft", [[42]]]]);
        expect(navigations).toEqual([
            ["picking_list", {warehouseId: 7}, {clearHistory: true}],
        ]);
    });

    test("does not ask nor call the action for a non-canceled picking", async () => {
        const calls = [];
        const dialogs = [];
        const screen = {
            state: {picking: {id: 42, state: "assigned"}},
            pickingId: 42,
            inventory: {call: async (...args) => calls.push(args)},
            store: {navigate: (...args) => args},
            dialog: {add: (dialogClass, props) => dialogs.push({dialogClass, props})},
        };

        await PickingScreen.prototype.backToDraft.call(screen);

        expect(dialogs).toEqual([]);
        expect(calls).toEqual([]);
    });

    test("lists canceled pickings from the bridge patch", async () => {
        const searches = [];
        const screen = {
            props: {params: {type: "outgoing", warehouseId: 7}},
            state: {pickings: [], moveStatsByPickingId: {}},
            inventory: {
                searchRead: async (...args) => {
                    searches.push({domain: args[1], options: args[3]});
                    return args[1][2][1] === "="
                        ? [{id: 99, name: "OUT/099", state: "cancel"}]
                        : [{id: 1, name: "OUT/001", state: "assigned"}];
                },
            },
            loadMoveStats: async () => ({}),
            computeGroups: () => ({}),
        };

        await PickingListScreen.prototype.loadPickings.call(screen);

        expect(searches.length).toBe(2);
        expect(searches[0].domain).toEqual([
            ["picking_type_id.warehouse_id", "=", 7],
            ["picking_type_id.code", "=", "outgoing"],
            ["state", "not in", ["done", "cancel"]],
        ]);
        expect(searches[1].domain).toEqual([
            ["picking_type_id.warehouse_id", "=", 7],
            ["picking_type_id.code", "=", "outgoing"],
            ["state", "=", "cancel"],
        ]);
        expect(screen.state.pickings.map((picking) => picking.name)).toEqual([
            "OUT/001",
            "OUT/099",
        ]);
    });
});
