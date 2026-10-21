/** @odoo-module **/

import "@barcode_stock_partner_delivery_zone/js/picking_info_delivery_zone.esm";
import {
    NO_ZONE,
    NO_ZONE_GROUP,
    UNKNOWN_ZONE_GROUP,
    ZONE,
} from "@barcode_stock_partner_delivery_zone/js/picking_list_delivery_zone.esm";
import {PickingInfoTab} from "@barcode_stock/js/components/picking_info_tab.esm";
import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";
import {templates} from "@web/core/assets";

const ZONES = [
    {id: 1, name: "North"},
    {id: 2, name: "South"},
];

const PICKINGS = [
    {id: 10, name: "WH/OUT/00010", state: "assigned", delivery_zone_id: [1, "North"]},
    {id: 11, name: "WH/OUT/00011", state: "assigned", delivery_zone_id: [2, "South"]},
    {id: 12, name: "WH/OUT/00012", state: "assigned", delivery_zone_id: false},
];

/**
 * A list screen without its OWL setup, wired the way the patch sets it up.
 *
 * @param {Object} [options] the operation type and the fake ORM to use
 * @returns {PickingListScreen} the screen to test
 */
function listScreen({type = "outgoing", inventory = {}} = {}) {
    const screen = Object.create(PickingListScreen.prototype);
    screen.props = {params: {type}};
    screen.inventory = inventory;
    // 17.0's list reads the saved defaults for `this.userService.userId`.
    screen.userService = {userId: 1};
    screen.groupOrder = ["date", "state"];
    screen.groupLabels = {date: "Date", state: "Status"};
    screen.filterLabels = {state: "Status", date: "Date"};
    screen.allDefaults = {};
    screen.state = {
        pickings: PICKINGS.map((picking) => ({...picking})),
        groupByLevels: [],
        groupedPickings: {},
        activeFilters: [],
        filterValues: {state: "all", date: null},
        stateLabels: {assigned: "Ready"},
        deliveryZones: ZONES,
        savedDefault: null,
        search: "",
    };
    screen.initDeliveryZone();
    // Unit tests never mount the screen: keep the session views untouched.
    screen.persistSessionView = () => undefined;
    return screen;
}

const ids = (pickings) => pickings.map((picking) => picking.id);

QUnit.module("DeliveryZone", () => {
    QUnit.test("the zone is the outermost grouping level", (assert) => {
        const screen = listScreen();
        assert.deepEqual(screen.groupOrder, [ZONE, "date", "state"]);
        assert.strictEqual(screen.groupLabels[ZONE], "Delivery Zone");
        assert.strictEqual(screen.filterLabels[ZONE], "Delivery Zone");
    });

    QUnit.test(
        "operations group by zone, those without one under No zone",
        (assert) => {
            const screen = listScreen();
            const groups = screen.groupRecursively(screen.state.pickings, [ZONE]);
            assert.deepEqual(ids(groups["zone:1"]), [10]);
            assert.deepEqual(ids(groups["zone:2"]), [11]);
            assert.deepEqual(ids(groups[NO_ZONE_GROUP]), [12]);
            assert.deepEqual(screen.sortedGroupKeys(groups, 0), [
                NO_ZONE_GROUP,
                "zone:1",
                "zone:2",
            ]);
            assert.strictEqual(screen.getGroupTitle("zone:1"), "North");
            assert.strictEqual(screen.getGroupTitle(NO_ZONE_GROUP), "No zone");
            // Other levels keep showing their own key.
            assert.strictEqual(screen.getGroupTitle("Ready"), "Ready");
        }
    );

    QUnit.test("zones are grouped by id, whatever their name", (assert) => {
        const screen = listScreen();
        const zone = (id, name) => ({
            id,
            name: `WH/OUT/000${id}`,
            state: "assigned",
            delivery_zone_id: [id, name],
        });
        screen.state.pickings = [
            zone(1, "North"),
            zone(3, "North"),
            zone(4, "No zone"),
            zone(5, "__proto__"),
            zone(6, "constructor"),
            {id: 7, name: "WH/OUT/0007", state: "assigned", delivery_zone_id: false},
        ];
        const groups = screen.groupRecursively(screen.state.pickings, [ZONE]);
        const keys = screen.sortedGroupKeys(groups, 0);
        // Two zones sharing a name stay apart, as does a zone named like the
        // group of the operations without one.
        assert.deepEqual(
            keys.map((key) => screen.getGroupTitle(key)),
            ["__proto__", "constructor", "No zone", "No zone", "North", "North"]
        );
        assert.deepEqual(
            keys.map((key) => ids(groups[key])),
            [[5], [6], [4], [7], [1], [3]]
        );
    });

    QUnit.test("the list opens even if the zones cannot be read", async (assert) => {
        const screen = listScreen({
            inventory: {
                searchRead: () => Promise.reject(new Error("offline")),
            },
        });
        assert.deepEqual(await screen.loadZoneCatalog(), []);
        screen.state.deliveryZones = [];
        assert.deepEqual(
            screen.zoneFilterOptions.map((o) => o.value),
            [null, NO_ZONE]
        );
    });

    QUnit.test("adding a grouping level keeps the zone outermost", (assert) => {
        const screen = listScreen();
        screen.state.groupByLevels = ["date"];
        screen.toggleGroupLevel(ZONE);
        assert.deepEqual(screen.state.groupByLevels, [ZONE, "date"]);
        screen.toggleGroupLevel(ZONE);
        assert.deepEqual(screen.state.groupByLevels, ["date"]);
    });

    QUnit.test(
        "the zone filter keeps one zone, or the operations without one",
        (assert) => {
            const screen = listScreen();
            screen.setZoneFilter(1);
            assert.deepEqual(ids(screen.getMatchingPickings()), [10]);
            assert.strictEqual(screen.getFilterDisplayValue(ZONE), "North");
            screen.setZoneFilter(NO_ZONE);
            assert.deepEqual(ids(screen.getMatchingPickings()), [12]);
            assert.strictEqual(screen.getFilterDisplayValue(ZONE), "No zone");
            assert.ok(screen.isZoneOptionSelected(NO_ZONE));
            screen.setZoneFilter(null);
            assert.notOk(screen.state.activeFilters.includes(ZONE));
            assert.deepEqual(ids(screen.getMatchingPickings()), [10, 11, 12]);
            assert.ok(screen.isZoneOptionSelected(null));
        }
    );

    QUnit.test("the zone filter can be saved as the default", (assert) => {
        const screen = listScreen();
        screen.setZoneFilter(2);
        const config = screen.currentFilterConfig;
        assert.ok(config.activeFilters.includes(ZONE));
        assert.strictEqual(config.filterValues[ZONE], 2);
        const other = listScreen();
        other.applyFilterConfig(config);
        assert.deepEqual(ids(other.getMatchingPickings()), [11]);
    });

    QUnit.test(
        "a zone filtered on and archived since still shows as itself",
        (assert) => {
            const archived = [...ZONES, {id: 3, name: "East", active: false}];
            const values = (screen) => screen.zoneFilterOptions.map((o) => o.value);
            const saved = listScreen();
            saved.state.deliveryZones = archived;
            saved.setZoneFilter(3);
            const screen = listScreen();
            screen.state.deliveryZones = archived;
            // An archived zone is not offered...
            assert.deepEqual(values(screen), [null, NO_ZONE, 1, 2]);
            // ...unless it is the one a saved filter keeps.
            screen.applyFilterConfig(saved.currentFilterConfig);
            assert.deepEqual(screen.zoneFilterOptions.at(-1), {
                value: 3,
                label: "East (archived)",
            });
            assert.ok(screen.isZoneOptionSelected(3));
            assert.strictEqual(screen.getFilterDisplayValue(ZONE), "East (archived)");
            // Back to all the zones, it is offered no more.
            screen.setZoneFilter(null);
            assert.deepEqual(values(screen), [null, NO_ZONE, 1, 2]);
        }
    );

    QUnit.test("the search also matches the zone name", (assert) => {
        const screen = listScreen();
        assert.deepEqual(ids(screen.getMatchingPickings("south")), [11]);
    });

    QUnit.test("zones are read alongside the move statistics", async (assert) => {
        const pickings = [{id: 10}, {id: 12}];
        const screen = listScreen({
            inventory: {
                searchRead: () => [],
                read: (model, recordIds) =>
                    model === "stock.picking"
                        ? recordIds.map((id) => ({
                              id,
                              delivery_zone_id: id === 10 ? [1, "North"] : false,
                          }))
                        : [],
            },
        });
        await screen.loadMoveStats(pickings);
        assert.deepEqual(pickings[0].delivery_zone_id, [1, "North"]);
        assert.strictEqual(pickings[1].delivery_zone_id, false);
    });

    QUnit.test(
        "the list opens even if the operations' zones cannot be read",
        async (assert) => {
            const notes = [];
            const pickings = [
                {id: 10, state: "assigned"},
                {id: 12, state: "assigned"},
            ];
            const screen = listScreen({
                inventory: {
                    searchRead: () => [],
                    read: (model) =>
                        model === "stock.picking"
                            ? Promise.reject(new Error("offline"))
                            : [],
                    notify: (message, options) =>
                        notes.push({message: String(message), ...options}),
                },
            });
            await screen.loadMoveStats(pickings);
            assert.deepEqual(
                pickings.map((p) => p.delivery_zone_id),
                [undefined, undefined]
            );
            assert.deepEqual(notes, [
                {
                    message:
                        "The delivery zones could not be read: the operations are listed without them.",
                    type: "warning",
                },
            ]);
            // Their zone is unknown, not "no zone": grouped apart, and kept in
            // sight whatever zone is filtered on.
            screen.state.pickings = pickings;
            const groups = screen.groupRecursively(pickings, [ZONE]);
            assert.deepEqual(Object.keys(groups), [UNKNOWN_ZONE_GROUP]);
            assert.strictEqual(
                screen.getGroupTitle(UNKNOWN_ZONE_GROUP),
                "Unknown zone"
            );
            screen.setZoneFilter(NO_ZONE);
            assert.deepEqual(ids(screen.getMatchingPickings()), [10, 12]);
            screen.setZoneFilter(1);
            assert.deepEqual(ids(screen.getMatchingPickings()), [10, 12]);
        }
    );

    QUnit.test(
        "delivery orders open grouped by zone, other operations do not",
        async (assert) => {
            const inventory = {read: () => [{barcode_default_filters: {}}]};
            const outgoing = listScreen({type: "outgoing", inventory});
            await outgoing.loadDefaultFilter();
            assert.deepEqual(outgoing.state.groupByLevels, [ZONE]);
            const incoming = listScreen({type: "incoming", inventory});
            await incoming.loadDefaultFilter();
            assert.deepEqual(incoming.state.groupByLevels, []);
        }
    );

    QUnit.test("a grouping restored from the session is kept", async (assert) => {
        const inventory = {read: () => [{barcode_default_filters: {}}]};
        const screen = listScreen({type: "outgoing", inventory});
        screen.applyViewState({activeFilters: [], filterValues: {}, groupByLevels: []});
        assert.strictEqual(screen.sessionViewRestored, true);
        await screen.loadDefaultFilter();
        assert.deepEqual(screen.state.groupByLevels, []);
    });
});

QUnit.module("DeliveryZone info tab", () => {
    function infoTab(write) {
        const tab = Object.create(PickingInfoTab.prototype);
        tab.props = {picking: {id: 10}};
        tab.zoneState = {
            zones: ZONES,
            zone: [1, "North"],
            saving: false,
            failed: false,
        };
        tab.inventory = {write, notify: () => undefined};
        return tab;
    }

    QUnit.test("changing the zone writes it at once", async (assert) => {
        const calls = [];
        const tab = infoTab((model, recordIds, vals) =>
            calls.push([model, recordIds, vals])
        );
        await tab.onDeliveryZoneChange({target: {value: "2"}});
        assert.deepEqual(calls, [["stock.picking", [10], {delivery_zone_id: 2}]]);
        assert.deepEqual(tab.zoneState.zone, [2, "South"]);
        await tab.onDeliveryZoneChange({target: {value: ""}});
        assert.deepEqual(calls[1][2], {delivery_zone_id: false});
        assert.strictEqual(tab.zoneState.zone, false);
    });

    QUnit.test(
        "a refused change shows the zone the operation still has",
        async (assert) => {
            const tab = infoTab(() => {
                throw new Error("refused");
            });
            const target = {value: "2"};
            await tab.onDeliveryZoneChange({target});
            assert.deepEqual(tab.zoneState.zone, [1, "North"]);
            assert.strictEqual(target.value, "1");
            assert.strictEqual(tab.zoneState.saving, false);
        }
    );

    QUnit.test("the zone cannot be changed if it could not be read", async (assert) => {
        const tab = infoTab(() => undefined);
        tab.zoneState.zone = false;
        tab.inventory.searchRead = () => Promise.reject(new Error("offline"));
        tab.inventory.read = () => Promise.resolve([]);
        await tab.loadDeliveryZone();
        assert.strictEqual(tab.zoneState.failed, true);
        assert.strictEqual(tab.zoneState.zone, false);
    });

    QUnit.test(
        "the zones and the operation's own are read together",
        async (assert) => {
            const tab = infoTab(() => undefined);
            tab.zoneState.zone = false;
            tab.inventory.searchRead = () => Promise.resolve(ZONES);
            tab.inventory.read = () =>
                Promise.resolve([{id: 10, delivery_zone_id: [2, "South"]}]);
            await tab.loadDeliveryZone();
            assert.strictEqual(tab.zoneState.failed, false);
            assert.deepEqual(tab.zoneState.zone, [2, "South"]);
            assert.deepEqual(tab.zoneState.zones, ZONES);
        }
    );

    QUnit.test("an archived zone still set stays in the list", (assert) => {
        const tab = infoTab(() => undefined);
        tab.zoneState.zone = [9, "Old zone"];
        assert.deepEqual(
            tab.deliveryZoneOptions.map((zone) => zone.id),
            [1, 2, 9]
        );
        assert.ok(tab.isDeliveryZoneSelected({id: 9}));
    });
});

QUnit.module("DeliveryZone templates", () => {
    // Template extensions are applied when the bundle is generated: an XPath
    // that no longer finds its node would only break when the screen is drawn.
    QUnit.test(
        "the zone reaches the list, its cards and the information tab",
        (assert) => {
            const html = (name) =>
                templates.querySelector(`[t-name="${name}"]`).outerHTML;
            assert.ok(
                html("barcode_scanner.PickingListScreen").includes("zoneFilterOptions")
            );
            assert.ok(
                html("barcode_scanner.GroupRenderer").includes("p.delivery_zone_id")
            );
            assert.ok(
                html("barcode_scanner.GroupRenderer").includes(
                    "component.getGroupTitle(groupKey)"
                )
            );
            assert.ok(
                html("barcode_scanner.PickingInfoTab").includes("onDeliveryZoneChange")
            );
        }
    );
});
