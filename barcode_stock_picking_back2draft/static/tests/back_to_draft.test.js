/** @odoo-module **/

import "@barcode_stock_picking_back2draft/js/picking_screen_patch.esm";
import "@barcode_stock_picking_back2draft/js/picking_list_screen_patch.esm";
import {describe, expect, test} from "@odoo/hoot";
import {barcodeApiService} from "@barcode_scanner/js/api.esm";
import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";

function makeInventory(orm, notifications) {
    return barcodeApiService.start(null, {
        orm,
        notification: {
            add: (message, options) =>
                notifications.push({
                    message: String.prototype.toString.call(message),
                    options,
                }),
        },
        dialog: {},
    });
}

function makePickingScreen(inventory) {
    const dialogs = [];
    const navigations = [];
    const screen = {
        state: {picking: {id: 42, state: "cancel"}},
        pickingId: 42,
        listParams: {warehouseId: 7},
        inventory,
        store: {navigate: (...args) => navigations.push(args)},
        dialog: {add: (dialogClass, props) => dialogs.push({dialogClass, props})},
    };
    return {screen, dialogs, navigations};
}

function makePickingListScreen(pickings = []) {
    const screen = Object.create(PickingListScreen.prototype);
    screen.props = {params: {type: "outgoing", warehouseId: 7}};
    screen.state = {
        pickings,
        moveStatsByPickingId: {},
        collapsedGroups: {},
        groupedPickings: {},
        groupByLevels: [],
        search: "",
        activeFilters: [],
        filterValues: {state: "all", date: null},
        stateLabels: {assigned: "Assigned", cancel: "Cancelled"},
    };
    return screen;
}

describe("BarcodeStockPickingBack2Draft", () => {
    test("resets a canceled picking after confirmation", async () => {
        const calls = [];
        const notifications = [];
        const inventory = makeInventory(
            {
                call: async (...args) => {
                    calls.push(args);
                    return true;
                },
            },
            notifications
        );
        const {screen, dialogs, navigations} = makePickingScreen(inventory);

        await PickingScreen.prototype.backToDraft.call(screen);

        expect(dialogs.length).toBe(1);
        await dialogs[0].props.confirm();
        expect(calls).toEqual([
            ["stock.picking", "action_back_to_draft", [[42]], {}],
        ]);
        expect(notifications).toEqual([
            {message: "Picking returned to draft.", options: {type: "success"}},
        ]);
        expect(navigations).toEqual([
            ["picking_list", {warehouseId: 7}, {clearHistory: true}],
        ]);
    });

    test("keeps the picking open after a safe RPC error and allows retry", async () => {
        let shouldFail = true;
        const calls = [];
        const notifications = [];
        const inventory = makeInventory(
            {
                call: async (...args) => {
                    calls.push(args);
                    if (shouldFail) {
                        throw {
                            data: {
                                name: "odoo.exceptions.AccessDenied",
                                message: "Unsafe server detail",
                                debug: "Sensitive traceback",
                            },
                        };
                    }
                    return true;
                },
            },
            notifications
        );
        const {screen, dialogs, navigations} = makePickingScreen(inventory);

        await PickingScreen.prototype.backToDraft.call(screen);
        await dialogs[0].props.confirm();

        expect(notifications).toEqual([
            {
                message: "An error occurred while calling the server.",
                options: {type: "danger"},
            },
        ]);
        expect(navigations).toEqual([]);
        expect(screen.state.picking.state).toBe("cancel");

        shouldFail = false;
        await PickingScreen.prototype.backToDraft.call(screen);
        await dialogs[1].props.confirm();

        expect(calls.length).toBe(2);
        expect(notifications).toEqual([
            {
                message: "An error occurred while calling the server.",
                options: {type: "danger"},
            },
            {message: "Picking returned to draft.", options: {type: "success"}},
        ]);
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
        const screen = makePickingListScreen();
        screen.inventory = {
            searchRead: async (...args) => {
                searches.push({domain: args[1], options: args[3]});
                return args[1][2][1] === "="
                    ? [{id: 99, name: "OUT/099", state: "cancel"}]
                    : [{id: 1, name: "OUT/001", state: "assigned"}];
            },
        };
        screen.loadMoveStats = async () => ({});

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
        expect(screen.getMatchingPickings().map((picking) => picking.name)).toEqual([
            "OUT/001",
        ]);
    });

    test("shows canceled pickings only for the explicit Cancelled filter", () => {
        const screen = makePickingListScreen([
            {id: 1, name: "OUT/001", state: "assigned"},
            {id: 2, name: "OUT/002", state: "cancel"},
        ]);
        screen.state.groupByLevels = ["state"];

        screen.computeGroups();
        expect(screen.filteredPickings.map((picking) => picking.id)).toEqual([1]);
        expect(Object.keys(screen.state.groupedPickings)).toEqual(["Assigned"]);

        screen.state.activeFilters = ["state"];
        screen.state.filterValues.state = "cancel";
        screen.computeGroups();
        expect(screen.filteredPickings.map((picking) => picking.id)).toEqual([2]);
        expect(Object.keys(screen.state.groupedPickings)).toEqual(["Cancelled"]);

        screen.state.filterValues.state = "all";
        screen.computeGroups();
        expect(screen.filteredPickings.map((picking) => picking.id)).toEqual([1]);

        screen.clearFilters();
        expect(screen.state.groupByLevels).toEqual(["state"]);
        expect(screen.filteredPickings.map((picking) => picking.id)).toEqual([1]);
        expect(Object.keys(screen.state.groupedPickings)).toEqual(["Assigned"]);
    });

    test("keeps other active filters and grouping while hiding canceled records", () => {
        const date = new Date();
        const dateValue = [
            date.getFullYear(),
            String(date.getMonth() + 1).padStart(2, "0"),
            String(date.getDate()).padStart(2, "0"),
        ].join("-");
        const nextDate = new Date(date);
        nextDate.setDate(date.getDate() + 1);
        const nextDateValue = [
            nextDate.getFullYear(),
            String(nextDate.getMonth() + 1).padStart(2, "0"),
            String(nextDate.getDate()).padStart(2, "0"),
        ].join("-");
        const screen = makePickingListScreen([
            {
                id: 1,
                name: "OUT/001",
                state: "assigned",
                scheduled_date: `${dateValue} 12:00:00`,
            },
            {
                id: 2,
                name: "OUT/002",
                state: "assigned",
                scheduled_date: `${nextDateValue} 12:00:00`,
            },
            {
                id: 3,
                name: "OUT/003",
                state: "cancel",
                scheduled_date: `${dateValue} 12:00:00`,
            },
        ]);
        screen.state.activeFilters = ["date"];
        screen.state.filterValues.date = `custom:${dateValue}`;
        screen.state.groupByLevels = ["state"];

        screen.computeGroups();

        expect(screen.filteredPickings.map((picking) => picking.id)).toEqual([1]);
        expect(Object.keys(screen.state.groupedPickings)).toEqual(["Assigned"]);

        screen.state.activeFilters = ["state", "date"];
        screen.state.filterValues.state = "cancel";
        screen.computeGroups();
        expect(screen.filteredPickings.map((picking) => picking.id)).toEqual([3]);
    });
});
