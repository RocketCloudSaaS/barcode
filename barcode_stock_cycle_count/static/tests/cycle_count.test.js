/** @odoo-module **/

import "@barcode_stock_cycle_count/js/camera_routes.esm";
import "@barcode_stock_cycle_count/js/tiles/cycle_count_menu_tile.esm";

import {barcodeMenuTiles, barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {getFixture, mount, nextTick} from "@web/../tests/helpers/utils";
import {translatedTerms, translationLoaded} from "@web/core/l10n/translation";
import {BarcodeScannerFeedbackService} from "@barcode_scanner/js/services/feedback_service.esm";
import {CycleCountCountScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_count_screen.esm";
import {CycleCountDoneScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_done_screen.esm";
import {CycleCountListScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_list_screen.esm";
import {CycleCountLocationScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_location_screen.esm";
import {makeTestEnv} from "@web/../tests/helpers/mock_env";
import {registry} from "@web/core/registry";

const count = {id: 7, name: "March count", location_id: 8, location_name: "WH/Stock"};

/**
 * QUnit has no "match object" assertion: compare the keys the expected object
 * names, as the HOOT test did.
 *
 * @param {Object} assert the QUnit assertion object
 * @param {Object} actual the object under test
 * @param {Object} expected the keys to compare
 */
function matchObject(assert, actual, expected) {
    const picked = {};
    for (const key of Object.keys(expected)) {
        picked[key] = actual[key];
    }
    assert.deepEqual(picked, expected);
}

/**
 * Build a screen holding `props` without mounting it, so its methods can be
 * exercised directly.
 *
 * @param {Function} Screen the screen class
 * @param {Object} [props] extra route parameters
 * @returns {Object} the screen
 */
function screen(Screen, props = {}) {
    return Object.assign(Object.create(Screen.prototype), {
        props: {params: {cycleCountId: count.id, cycleCount: count, ...props}},
        state: {},
        // The user is a service in Odoo 17; the screens read `userId` and `tz`.
        user: {userId: 7, tz: "UTC"},
        feedback: {
            success: () => undefined,
            warning: () => undefined,
            error: () => undefined,
        },
        store: {navigate: () => undefined, goBack: () => undefined},
        dialog: {add: () => undefined},
    });
}

/**
 * Register the fake services a screen talks to, then build the environment
 * that starts them.
 *
 * Odoo 17 `makeTestEnv` starts the services held by the "services" registry;
 * unlike Odoo 18 HOOT, it takes no `services` config object.
 *
 * @param {Object} services service name -> service instance
 * @returns {Promise<Object>} the environment
 */
async function makeScreenEnv(services) {
    const serviceRegistry = registry.category("services");
    for (const [name, service] of Object.entries(services)) {
        serviceRegistry.add(name, {start: () => service});
    }
    return makeTestEnv();
}

/**
 * Mount `Component` in the QUnit fixture with the given fake services.
 *
 * @param {Function} Component the component to mount
 * @param {Object} services service name -> service instance
 * @param {Object} [props] the component props
 * @returns {Promise<Object>} the mounted component and its environment
 */
async function mountScreen(Component, services, props = {}) {
    const env = await makeScreenEnv(services);
    const component = await mount(Component, getFixture(), {env, props});
    return {component, env};
}

/**
 * Strip the layout whitespace QWeb keeps between template nodes, so a text
 * assertion checks what an operator reads rather than how it is indented.
 *
 * @param {String} value the text content
 * @returns {String} the text without surrounding whitespace runs
 */
function textOf(value) {
    return String(value).replace(/\s+/g, " ").trim();
}

QUnit.module("BarcodeStockCycleCount", () => {
    QUnit.test("errorNotificationUsesDangerType", (assert) => {
        const notifications = [];
        const feedback = new BarcodeScannerFeedbackService({
            add: (...args) => notifications.push(args),
        });
        feedback.enabled = {audio: false, vibration: false, flash: false};
        const message = "Unable to apply the cycle count";

        feedback.error({message, notify: true});

        // The 18.0 HOOT source expected the "danger" type here; the 17.0
        // scanner service forwards its level verbatim, so it is "error".
        assert.deepEqual(notifications, [[message, {type: "error"}]]);
        feedback.destroy();
    });

    QUnit.test("testHomeTileNavigatesToCycleCount", (assert) => {
        const tile = barcodeMenuTiles.get("cycle_count");
        let route = null;
        tile.action({navigate: (name) => (route = name)});
        assert.strictEqual(barcodeMenuTiles.contains("cycle_count"), true);
        assert.strictEqual(route, "cycle_count_list");
    });

    QUnit.test("testListLoadAndSelection", async (assert) => {
        const list = screen(CycleCountListScreen);
        list.state = {counts: [], showAll: false, loading: true};
        let callArgs = null;
        list.inventory = {
            call: async (_model, _method, args) => {
                callArgs = args;
                return {counts: [{id: args[0] ? 2 : 1}]};
            },
        };
        const navigations = [];
        list.store = {navigate: (...args) => navigations.push(args)};
        await list.loadCounts();
        assert.deepEqual(callArgs, [false]);
        assert.deepEqual(list.state.counts, [{id: 1}]);
        list.selectCount(list.state.counts[0]);
        assert.deepEqual(navigations[0], [
            "cycle_count_location",
            {cycleCountId: 1, cycleCount: {id: 1}, showAll: false},
        ]);
    });

    QUnit.test("listCountersAndSubtitle", (assert) => {
        const list = screen(CycleCountListScreen);
        list.state = {
            counts: [
                {id: 1, state: "draft", date_deadline: "2020-01-01"},
                {id: 2, state: "open", date_deadline: "2020-01-02"},
                {id: 3, name: "Future", state: "open", date_deadline: "2099-01-01"},
                {id: 4, state: "draft"},
            ],
            loading: false,
            search: "",
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
        };
        list.todayInUserTimezone = () => "2020-01-02";

        assert.deepEqual(
            list.summaryCards.map((card) => card.value),
            [4, 2, 2, 1]
        );
        assert.strictEqual(
            `${list.filteredCounts.length}/${list.state.counts.length} visible`,
            "4/4 visible"
        );
        list.state.search = "future";
        assert.strictEqual(
            `${list.filteredCounts.length}/${list.state.counts.length} visible`,
            "1/4 visible"
        );
    });

    QUnit.test("searchAndScanResolution", async (assert) => {
        const list = screen(CycleCountListScreen);
        const records = [
            {id: 1, name: "March Count", location_name: "WH/Stock"},
            {id: 2, name: "April Count", location_name: "WH/Output"},
            {id: 3, name: "April Count", location_name: "WH/Input"},
        ];
        list.state = {
            counts: records,
            showAll: false,
            loading: false,
            search: "",
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
        };
        const signals = [];
        const navigations = [];
        list.feedback = {
            success: (signal) => signals.push(["success", signal]),
            warning: (signal) => signals.push(["warning", signal]),
            info: (signal) => signals.push(["info", signal]),
        };
        list.store = {navigate: (...args) => navigations.push(args)};

        assert.deepEqual(list.getMatchingCounts("  march "), [records[0]]);
        await list.onBarcodeScanned(" wh/stock ");
        assert.deepEqual(navigations[0], [
            "cycle_count_location",
            {cycleCountId: 1, cycleCount: records[0], showAll: false},
        ]);

        list.openingCount = false;
        await list.onBarcodeScanned("April Count");
        assert.strictEqual(signals.at(-1)[0], "info");
        assert.strictEqual(navigations.length, 1);
        await list.onBarcodeScanned("Unknown");
        assert.strictEqual(signals.at(-1)[0], "warning");
        assert.strictEqual(navigations.length, 1);

        list.state.search = "existing";
        list.state.loading = true;
        await list.onBarcodeScanned("March Count");
        assert.strictEqual(list.state.search, "existing");
        list.state.loading = false;
        await list.onBarcodeScanned("   ");
        assert.strictEqual(list.state.search, "existing");
    });

    QUnit.test("filtersCombineAndClear", (assert) => {
        const list = screen(CycleCountListScreen);
        list.state = {
            counts: [
                {
                    id: 1,
                    name: "Alpha",
                    state: "open",
                    responsible_id: 7,
                    date_deadline: "2020-01-02T23:59:00Z",
                },
                {
                    id: 2,
                    name: "Alpha unassigned",
                    state: "open",
                    responsible_id: false,
                    date_deadline: "2020-01-02",
                },
                {id: 3, name: "Draft", state: "draft", date_deadline: "2020-01-01"},
            ],
            search: "alpha",
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
        };
        list.todayInUserTimezone = () => "2020-01-02";

        list.setFilterValue("state", "open");
        list.setFilterValue("assignment", "mine");
        list.setFilterValue("deadline", "today");
        assert.deepEqual(
            list.getMatchingCounts(list.state.search).map((item) => item.id),
            [1]
        );
        assert.strictEqual(
            list.matchesAssignment({responsible_id: false}, "mine"),
            false
        );

        list.setCustomDate("2020-01-02");
        assert.deepEqual(
            list.getMatchingCounts("alpha").map((item) => item.id),
            [1]
        );
        list.clearFilters();
        assert.strictEqual(list.state.search, "");
        assert.deepEqual(list.state.activeFilters, []);
        assert.strictEqual(list.state.counts.length, 3);
    });

    QUnit.test("defaultFilterPersistence", async (assert) => {
        const otherOperation = {
            activeFilters: ["state"],
            filterValues: {state: "open"},
        };
        const savedCycleCount = {
            activeFilters: ["assignment"],
            filterValues: {assignment: "mine"},
        };
        const list = screen(CycleCountListScreen);
        list.state = {};
        const writes = [];
        const warnings = [];
        list.feedback = {
            success: () => undefined,
            warning: (signal) => warnings.push(signal),
            error: () => undefined,
        };
        list.inventory = {
            read: async (model, _ids, fields) => {
                assert.strictEqual(model, "res.users");
                assert.deepEqual(fields, ["barcode_default_filters"]);
                return [
                    {
                        barcode_default_filters: {
                            outgoing: otherOperation,
                            cycle_count: savedCycleCount,
                        },
                    },
                ];
            },
            write: async (model, _ids, values) => {
                writes.push({model, values});
            },
        };

        // The persisted default is applied when there is no session view, and
        // the filled star reflects it.
        await list.loadDefaultFilter();
        assert.deepEqual(list.allDefaults, {
            outgoing: otherOperation,
            cycle_count: savedCycleCount,
        });
        assert.deepEqual(list.state.activeFilters, ["assignment"]);
        assert.strictEqual(list.state.filterValues.assignment, "mine");
        assert.strictEqual(list.state.filterValues.state, "all");
        assert.strictEqual(list.isCurrentFilterDefault, true);

        // Starring saves a filters-only config and preserves other keys,
        // ignoring the search and grouping of the current view.
        list.clearFilters();
        list.setFilterValue("state", "open");
        list.state.search = "march";
        list.state.groupByLevels = ["state"];
        await list.toggleDefaultFilter();
        assert.strictEqual(writes.length, 1);
        assert.strictEqual(writes[0].model, "res.users");
        assert.deepEqual(
            writes[0].values.barcode_default_filters.outgoing,
            otherOperation
        );
        assert.deepEqual(writes[0].values.barcode_default_filters.cycle_count, {
            activeFilters: ["state"],
            filterValues: {state: "open"},
        });
        assert.strictEqual(
            "search" in writes[0].values.barcode_default_filters.cycle_count,
            false
        );
        assert.strictEqual(list.isCurrentFilterDefault, true);

        // Unstarring removes only the cycle_count entry.
        await list.toggleDefaultFilter();
        assert.strictEqual(writes.length, 2);
        assert.deepEqual(writes[1].values.barcode_default_filters, {
            outgoing: otherOperation,
        });
        assert.strictEqual(list.state.savedDefault, null);

        // Starring with no active filters warns and does not write.
        list.clearFilters();
        await list.toggleDefaultFilter();
        assert.strictEqual(warnings.length, 1);
        assert.strictEqual(writes.length, 2);

        // The session view wins over the saved default.
        const sessionView = screen(CycleCountListScreen);
        sessionView.state = {
            activeFilters: ["deadline"],
            filterValues: {state: "all", assignment: "all", deadline: "today"},
            search: "march",
            groupByLevels: ["deadline"],
            collapsedGroups: {},
        };
        sessionView.persistSessionView();
        const recreated = screen(CycleCountListScreen);
        recreated.state = {};
        recreated.inventory = list.inventory;
        await recreated.loadDefaultFilter();
        assert.deepEqual(recreated.state.activeFilters, ["deadline"]);
        assert.strictEqual(recreated.state.filterValues.deadline, "today");
        assert.strictEqual(recreated.state.search, "march");
        assert.deepEqual(recreated.state.groupByLevels, ["deadline"]);
        assert.strictEqual(recreated.isCurrentFilterDefault, false);
    });

    QUnit.test("groupingAndPersistence", async (assert) => {
        const list = screen(CycleCountListScreen);
        list.state = {
            counts: [
                {id: 1, state: "draft", date_deadline: "2020-01-01"},
                {id: 2, state: "open", date_deadline: "2020-01-02"},
                {id: 3, state: "open"},
            ],
            search: "",
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
            groupByLevels: ["state"],
            collapsedGroups: {},
        };
        list.todayInUserTimezone = () => "2020-01-02";
        list.getGroupKey = (record, level) =>
            level === "state"
                ? record.state === "draft"
                    ? "Planned"
                    : "Execution"
                : record.date_deadline === "2020-01-01"
                ? "Overdue"
                : record.date_deadline === "2020-01-02"
                ? "Today"
                : "No deadline";
        const stateGroups = list.groupRecursively(list.state.counts, ["state"]);
        assert.deepEqual(Object.keys(stateGroups), ["Planned", "Execution"]);
        assert.strictEqual(list.countGroupEntries(stateGroups), 3);

        const deadlineGroups = list.groupRecursively(list.state.counts, ["deadline"]);
        assert.deepEqual(Object.keys(deadlineGroups), [
            "Overdue",
            "Today",
            "No deadline",
        ]);
        list.toggleGroup("root-Planned");
        assert.strictEqual(list.state.collapsedGroups["root-Planned"], true);
        list.state.groupByLevels = ["state", "deadline"];
        list.persistSessionView();

        const normalized = list.normalizeView({
            activeFilters: ["state", "unknown"],
            filterValues: {state: "invalid"},
            groupByLevels: ["deadline", "bad"],
        });
        assert.deepEqual(normalized.activeFilters, []);
        assert.deepEqual(normalized.groupByLevels, ["deadline"]);

        const recreated = screen(CycleCountListScreen);
        await recreated.loadDefaultFilter();
        assert.deepEqual(recreated.state.groupByLevels, ["state", "deadline"]);
        assert.strictEqual(recreated.state.collapsedGroups["root-Planned"], true);
    });

    QUnit.test("testScanMatchesLine", async (assert) => {
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
        const line = {
            quant_id: 20,
            product_id: 40,
            lot_id: 9,
            lot_name: "LOT-1",
            tracking: "serial",
            theoretical_qty: 1,
            counted: null,
        };
        countScreen.state = {lines: [line], applying: false};
        countScreen.inventory = {
            searchRead: async (model) =>
                model === "product.product"
                    ? [{id: 40, tracking: "serial"}]
                    : [{id: 9, name: "LOT-1", product_id: [40, "Product"]}],
        };
        await countScreen.onBarcodeScanned("ignored", {
            productCodes: ["PROD-40"],
            lot: "LOT-1",
            quantity: 1,
        });
        assert.strictEqual(line.counted, 1);
    });

    QUnit.test(
        "saveCountPersistsDirtyLinesWithRevisionWithoutApplyingOrClosing",
        async (assert) => {
            const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
            const zeroLine = {
                quant_id: 20,
                counted: 0,
                counted_qty: null,
                barcode_cycle_count_counted: false,
                lot_id: false,
                lot_name: false,
                write_date: "revision-20",
            };
            const clearedLine = {
                quant_id: 21,
                counted: null,
                counted_qty: 5,
                barcode_cycle_count_counted: true,
                lot_id: 9,
                lot_name: "LOT-1",
                write_date: "revision-21",
            };
            const unchangedLine = {
                quant_id: 22,
                counted: 3,
                counted_qty: 3,
                barcode_cycle_count_counted: true,
                write_date: "revision-22",
            };
            countScreen.state = {
                lines: [zeroLine, clearedLine, unchangedLine],
                loading: false,
                error: false,
                applying: false,
                saving: false,
                resolvingScan: false,
            };
            const calls = [];
            const successes = [];
            countScreen.feedback = {
                success: (signal) => successes.push(signal),
            };
            countScreen.inventory = {
                call: async (model, method, args) => {
                    calls.push([model, method, args]);
                    const payload = args[1];
                    return {
                        quant_id: payload.quant_id,
                        counted_qty: payload.counted_qty,
                        barcode_cycle_count_counted: payload.counted_qty !== null,
                        write_date: `saved-${payload.quant_id}`,
                    };
                },
            };

            await countScreen.saveCount();

            assert.deepEqual(calls, [
                [
                    "stock.inventory",
                    "barcode_save_cycle_count_line",
                    [
                        12,
                        {
                            quant_id: 20,
                            counted_qty: 0,
                            lot_id: false,
                            lot_name: false,
                            write_date: "revision-20",
                        },
                    ],
                ],
                [
                    "stock.inventory",
                    "barcode_save_cycle_count_line",
                    [
                        12,
                        {
                            quant_id: 21,
                            counted_qty: null,
                            lot_id: 9,
                            lot_name: "LOT-1",
                            write_date: "revision-21",
                        },
                    ],
                ],
            ]);
            matchObject(assert, zeroLine, {
                counted: 0,
                counted_qty: 0,
                barcode_cycle_count_counted: true,
                write_date: "saved-20",
            });
            matchObject(assert, clearedLine, {
                counted: null,
                counted_qty: null,
                barcode_cycle_count_counted: false,
                write_date: "saved-21",
            });
            assert.strictEqual(unchangedLine.write_date, "revision-22");
            assert.deepEqual(countScreen.dirtyLines, []);
            assert.strictEqual(successes.length, 1);
            assert.deepEqual(
                calls.map(([, method]) => method),
                ["barcode_save_cycle_count_line", "barcode_save_cycle_count_line"]
            );
        }
    );

    QUnit.test("saveCountKeepsUnacknowledgedLinesForRetry", async (assert) => {
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
        const lines = [
            {
                quant_id: 30,
                counted: 0,
                counted_qty: null,
                barcode_cycle_count_counted: false,
                write_date: "revision-30",
            },
            {
                quant_id: 31,
                counted: 4,
                counted_qty: null,
                barcode_cycle_count_counted: false,
                write_date: "revision-31",
            },
            {
                quant_id: 32,
                counted: null,
                counted_qty: 2,
                barcode_cycle_count_counted: true,
                write_date: "revision-32",
            },
        ];
        countScreen.state = {
            lines,
            loading: false,
            error: false,
            applying: false,
            saving: false,
            resolvingScan: false,
        };
        const calls = [];
        const errors = [];
        const successes = [];
        let failSecondLine = true;
        countScreen.feedback = {
            error: (signal) => errors.push(signal),
            success: (signal) => successes.push(signal),
        };
        countScreen.inventory = {
            call: async (_model, method, args) => {
                const payload = args[1];
                calls.push([method, payload.quant_id, payload.counted_qty]);
                if (payload.quant_id === 31 && failSecondLine) {
                    failSecondLine = false;
                    throw new Error("Revision conflict");
                }
                return {
                    quant_id: payload.quant_id,
                    counted_qty: payload.counted_qty,
                    barcode_cycle_count_counted: payload.counted_qty !== null,
                    write_date: `saved-${payload.quant_id}`,
                };
            },
        };

        await countScreen.saveCount();

        assert.deepEqual(calls, [
            ["barcode_save_cycle_count_line", 30, 0],
            ["barcode_save_cycle_count_line", 31, 4],
        ]);
        matchObject(assert, lines[0], {
            counted: 0,
            counted_qty: 0,
            barcode_cycle_count_counted: true,
            write_date: "saved-30",
        });
        matchObject(assert, lines[1], {
            counted: 4,
            counted_qty: null,
            write_date: "revision-31",
        });
        matchObject(assert, lines[2], {
            counted: null,
            counted_qty: 2,
            write_date: "revision-32",
        });
        assert.deepEqual(errors, [{message: "Revision conflict", notify: true}]);
        assert.strictEqual(successes.length, 0);
        assert.strictEqual(countScreen.state.saving, false);

        await countScreen.saveCount();

        assert.deepEqual(calls, [
            ["barcode_save_cycle_count_line", 30, 0],
            ["barcode_save_cycle_count_line", 31, 4],
            ["barcode_save_cycle_count_line", 31, 4],
            ["barcode_save_cycle_count_line", 32, null],
        ]);
        matchObject(assert, lines[1], {
            counted: 4,
            counted_qty: 4,
            barcode_cycle_count_counted: true,
            write_date: "saved-31",
        });
        matchObject(assert, lines[2], {
            counted: null,
            counted_qty: null,
            barcode_cycle_count_counted: false,
            write_date: "saved-32",
        });
        assert.deepEqual(countScreen.dirtyLines, []);
        assert.strictEqual(successes.length, 1);
    });

    QUnit.test("savingBlocksCompetingScansAndEdits", async (assert) => {
        const countScreen = screen(CycleCountCountScreen);
        const line = {quant_id: 40, counted: 1, counted_qty: null};
        let resolveSave = null;
        const payloads = [];
        const warnings = [];
        countScreen.state = {
            lines: [line],
            loading: false,
            error: false,
            applying: false,
            saving: false,
            resolvingScan: false,
        };
        countScreen.feedback = {
            success: () => undefined,
            error: () => undefined,
            warning: (signal) => warnings.push(signal),
        };
        countScreen.inventory = {
            call: (_model, _method, args) => {
                payloads.push(args[1]);
                return new Promise((resolve) => {
                    resolveSave = resolve;
                });
            },
        };

        const save = countScreen.saveCount();
        assert.strictEqual(countScreen.state.saving, true);
        countScreen.setCounted(line, "7");
        countScreen.adjustCounted(line, 1);
        assert.strictEqual(await countScreen.onBarcodeScanned("SKU-40"), false);
        assert.strictEqual(line.counted, 1);

        // Preserve an edit from another local source if it lands before an ACK.
        line.counted = 7;
        resolveSave({
            quant_id: 40,
            counted_qty: 1,
            barcode_cycle_count_counted: true,
            write_date: "saved-40",
        });
        await save;
        assert.strictEqual(countScreen.state.saving, false);
        matchObject(assert, line, {
            counted: 7,
            counted_qty: 1,
            write_date: "saved-40",
        });
        assert.deepEqual(countScreen.dirtyLines, [line]);
        assert.strictEqual(warnings.length, 1);

        countScreen.inventory.call = async (_model, _method, args) => {
            payloads.push(args[1]);
            return {
                quant_id: args[1].quant_id,
                counted_qty: args[1].counted_qty,
                barcode_cycle_count_counted: args[1].counted_qty !== null,
                write_date: "saved-41",
            };
        };
        await countScreen.saveCount();

        assert.deepEqual(
            payloads.map(({counted_qty, write_date}) => [counted_qty, write_date]),
            [
                [1, false],
                [7, "saved-40"],
            ]
        );
        matchObject(assert, line, {
            counted: 7,
            counted_qty: 7,
            barcode_cycle_count_counted: true,
            write_date: "saved-41",
        });
        assert.deepEqual(countScreen.dirtyLines, []);
    });

    QUnit.test("testDifferenceIsVisible", (assert) => {
        const countScreen = screen(CycleCountCountScreen);
        assert.strictEqual(countScreen.difference({counted: 7, theoretical_qty: 5}), 2);
        assert.strictEqual(
            countScreen.difference({counted: null, theoretical_qty: 5}),
            null
        );
    });

    QUnit.test("testRoundingOnlyDifferenceIsZero", (assert) => {
        const countScreen = screen(CycleCountCountScreen);
        assert.strictEqual(
            countScreen.difference({
                counted: 5.4,
                theoretical_qty: 5,
                rounding: 1,
            }),
            0
        );
        assert.strictEqual(
            countScreen.difference({
                counted: 5.5,
                theoretical_qty: 5,
                rounding: 1,
            }),
            0.5
        );
    });

    QUnit.test("testTrackedLineRejectsMissingOrMismatchedLot", async (assert) => {
        const countScreen = screen(CycleCountCountScreen);
        const line = {
            product_id: 40,
            tracking: "lot",
            lot_id: 9,
            lot_name: "LOT-1",
            counted: null,
        };
        countScreen.state = {lines: [line], applying: false};
        const signals = [];
        countScreen.feedback = {
            warning: (signal) => signals.push(signal),
        };
        countScreen.inventory = {
            searchRead: async (model) =>
                model === "product.product" ? [{id: 40, tracking: "lot"}] : [],
        };
        await countScreen.onBarcodeScanned("ignored", {
            productCodes: ["PROD-40"],
            lot: "LOT-2",
            quantity: 1,
        });
        assert.strictEqual(line.counted, null);
        assert.strictEqual(signals.length, 1);
    });

    QUnit.test(
        "unknownProductScanAddsAuthoritativeLineAndSubmitsOnce",
        async (assert) => {
            const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
            const existingLine = {
                quant_id: 20,
                product_id: 30,
                lot_id: false,
                lot_name: false,
                tracking: "none",
                theoretical_qty: 5,
                counted: 6,
            };
            const addedLine = {
                quant_id: 21,
                product_id: 40,
                product_name: "Scanned product",
                tracking: "none",
                lot_id: false,
                lot_name: false,
                theoretical_qty: 8,
                counted_qty: 0,
                uom: "Units",
                rounding: 1,
            };
            const addCalls = [];
            let applyArgs = null;
            countScreen.state = {lines: [existingLine], applying: false};
            countScreen.inventory = {
                searchRead: async () => [{id: 40, tracking: "none"}],
                call: async (_model, method, args) => {
                    if (method === "barcode_add_cycle_count_quant") {
                        addCalls.push(args);
                        return addedLine;
                    }
                    applyArgs = args;
                    return {
                        cycle_count_id: count.id,
                        inventory_id: 12,
                        applied_count: 2,
                        accuracy: 100,
                    };
                },
            };

            await countScreen.onBarcodeScanned("SKU-40", {
                productCodes: ["SKU-40"],
                quantity: 2,
            });
            await countScreen.onBarcodeScanned("SKU-40", {
                productCodes: ["SKU-40"],
                quantity: 1,
            });

            assert.deepEqual(addCalls, [[12, 40, false]]);
            assert.strictEqual(countScreen.state.lines.length, 2);
            assert.strictEqual(existingLine.counted, 6);
            matchObject(assert, countScreen.state.lines[1], {
                quant_id: 21,
                theoretical_qty: 8,
                counted_qty: 0,
                counted: 3,
            });
            await countScreen.callApply(countScreen.countedLines, false);
            assert.deepEqual(applyArgs, [
                12,
                [
                    {
                        quant_id: 20,
                        counted_qty: 6,
                        lot_id: false,
                        lot_name: false,
                    },
                    {
                        quant_id: 21,
                        counted_qty: 3,
                        lot_id: false,
                        lot_name: false,
                    },
                ],
                false,
            ]);
        }
    );

    QUnit.test(
        "typedLotUsesExistingIdentityAndRejectsInvalidMatches",
        async (assert) => {
            const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
            const addedLine = {
                quant_id: 31,
                product_id: 40,
                product_name: "Tracked product",
                tracking: "lot",
                lot_id: 9,
                lot_name: "LOT-A",
                theoretical_qty: 7,
                counted_qty: 0,
                uom: "Units",
                rounding: 1,
            };
            const addCalls = [];
            let applyArgs = null;
            countScreen.state = {
                lines: [],
                applying: false,
                identityInput: "LOT-A",
                resolvingScan: false,
            };
            countScreen.inventory = {
                searchRead: async (model, domain) => {
                    if (model === "product.product" && domain[0]?.[0] === "barcode") {
                        return [];
                    }
                    if (model === "stock.lot" && domain[0]?.[0] === "name") {
                        return [
                            {
                                id: 9,
                                name: "LOT-A",
                                product_id: [40, "Tracked product"],
                            },
                        ];
                    }
                    return [{id: 40, tracking: "lot"}];
                },
                call: async (_model, method, args) => {
                    if (method === "barcode_add_cycle_count_quant") {
                        addCalls.push(args);
                        return addedLine;
                    }
                    applyArgs = args;
                    return {
                        cycle_count_id: count.id,
                        inventory_id: 12,
                        applied_count: 1,
                        accuracy: 100,
                    };
                },
            };

            await countScreen.resolveIdentityInput();
            assert.strictEqual(countScreen.state.identityInput, "");
            assert.deepEqual(addCalls, [[12, 40, 9]]);
            matchObject(assert, countScreen.state.lines[0], {
                product_id: 40,
                lot_id: 9,
                lot_name: "LOT-A",
                theoretical_qty: 7,
                counted: 1,
            });
            await countScreen.callApply(countScreen.countedLines, false);
            matchObject(assert, applyArgs[1][0], {
                quant_id: 31,
                counted_qty: 1,
                lot_id: 9,
                lot_name: "LOT-A",
            });

            const rejected = screen(CycleCountCountScreen, {inventoryId: 12});
            const warnings = [];
            let rejectedAdd = false;
            rejected.state = {lines: [], applying: false};
            rejected.feedback = {
                warning: (signal) => warnings.push(signal),
            };
            rejected.inventory = {
                searchRead: async (model) =>
                    model === "product.product"
                        ? [{id: 40, tracking: "lot"}]
                        : [
                              {
                                  id: 10,
                                  name: "LOT-X",
                                  product_id: [41, "Other product"],
                              },
                          ],
                call: async () => (rejectedAdd = true),
            };
            await rejected.onBarcodeScanned("SKU-40", {
                productCodes: ["SKU-40"],
                lot: "LOT-X",
            });
            assert.deepEqual(rejected.state.lines, []);
            assert.strictEqual(rejectedAdd, false);
            assert.strictEqual(warnings.length, 1);
        }
    );

    QUnit.test("openExecutionCountResumesLinkedAdjustmentDirectly", async (assert) => {
        const open = {
            id: 72,
            name: "Open",
            state: "open",
            location_id: 8,
            location_name: "WH/Stock",
            inventory_id: 120,
            inventory_state: "in_progress",
        };
        const list = screen(CycleCountListScreen);
        list.state = {
            counts: [],
            showAll: false,
            loading: true,
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
        };
        const calls = [];
        list.inventory = {
            call: async (...args) => {
                calls.push(args);
                return {counts: [open]};
            },
        };
        await list.loadCounts();
        assert.deepEqual(list.state.counts, [open]);

        const navigations = [];
        list.store = {navigate: (...args) => navigations.push(args)};
        calls.length = 0;
        list.selectCount(open);
        // Expectation EXP-01: an Execution (open) count opens its count
        // screen directly with the existing linked adjustment; no location
        // screen and no adjustment creation/restart call.
        assert.deepEqual(navigations, [
            [
                "cycle_count_count",
                {
                    cycleCountId: 72,
                    cycleCount: open,
                    inventoryId: 120,
                    expectedLocationId: 8,
                    expectedLocationName: "WH/Stock",
                    showAll: false,
                },
            ],
        ]);
        assert.strictEqual(
            navigations.some(([route]) => route === "cycle_count_location"),
            false
        );
        assert.deepEqual(calls, []);

        // The resumed screen loads the existing linked adjustment and
        // preserves the saved count progress.
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 120});
        let lineRequest = null;
        countScreen.inventory = {
            call: async (_model, _method, args) => {
                lineRequest = args;
                return {
                    inventory: {id: 120},
                    lines: [
                        {
                            quant_id: 501,
                            product_id: 40,
                            product_name: "Existing progress",
                            tracking: "none",
                            lot_id: false,
                            lot_name: false,
                            theoretical_qty: 5,
                            counted_qty: 7,
                        },
                    ],
                };
            },
        };
        await countScreen.loadLines();
        assert.deepEqual(lineRequest, [120]);
        assert.strictEqual(countScreen.state.lines[0].counted, 7);
    });

    QUnit.test("openCountWithDraftAdjustmentUsesConfirmStartGate", (assert) => {
        const open = {
            id: 73,
            name: "Open with draft adjustment",
            state: "open",
            location_id: 8,
            location_name: "WH/Stock",
            inventory_id: 121,
            inventory_state: "draft",
        };
        const list = screen(CycleCountListScreen);
        list.state = {showAll: false};
        const navigations = [];
        list.store = {navigate: (...args) => navigations.push(args)};

        list.selectCount(open);

        assert.deepEqual(navigations, [
            [
                "cycle_count_location",
                {cycleCountId: 73, cycleCount: open, showAll: false},
            ],
        ]);
    });

    QUnit.test("plannedCountKeepsConfirmStartAndLocationGuard", async (assert) => {
        const draft = {
            id: 71,
            name: "Draft",
            state: "draft",
            location_id: 8,
            location_name: "WH/Stock",
        };
        const list = screen(CycleCountListScreen);
        list.state = {
            counts: [],
            showAll: false,
            loading: true,
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
        };
        list.inventory = {call: async () => ({counts: [draft]})};
        await list.loadCounts();

        const navigations = [];
        list.store = {navigate: (...args) => navigations.push(args)};
        list.selectCount(draft);
        // Expectation EXP-02: a Planned (draft) count keeps the start flow.
        assert.deepEqual(navigations, [
            [
                "cycle_count_location",
                {cycleCountId: 71, cycleCount: draft, showAll: false},
            ],
        ]);

        const location = screen(CycleCountLocationScreen, navigations[0][1]);
        const locationRoutes = [];
        location.state = {count: draft, confirmed: false, loading: false};
        let draftConfirmation = null;
        location.inventory = {
            call: async (_model, method, args) => {
                draftConfirmation = [method, args];
                return {cycle_count: draft, inventory: {id: 121}};
            },
        };
        location.store = {navigate: (...args) => locationRoutes.push(args)};
        // No count entry before activating Confirm and start.
        assert.deepEqual(locationRoutes, []);
        await location.confirmStart();
        assert.deepEqual(draftConfirmation, ["barcode_confirm", [71]]);
        assert.strictEqual(location.state.inventoryId, 121);
        location.goToCount();
        assert.strictEqual(locationRoutes[0][0], "cycle_count_count");
        assert.strictEqual(locationRoutes[0][1].inventoryId, 121);
        assert.strictEqual(locationRoutes[0][1].expectedLocationId, 8);
    });

    QUnit.test("confirmStartUsesValidationDetailForScannerFeedback", async (assert) => {
        const location = screen(CycleCountLocationScreen);
        location.state.confirmed = false;
        const message =
            "There's already an Adjustment in Process using one requested Location: WH/Stock. " +
            "Blocking adjustments: INV/DEMO Ejecución — Pasillo D";
        const error = Object.assign(new Error("Odoo Server Error"), {
            data: {
                name: "odoo.exceptions.ValidationError",
                message,
            },
        });
        location.inventory = {
            call: async () => {
                throw error;
            },
        };
        let feedback = null;
        location.feedback = {error: (options) => (feedback = options)};

        await location.confirmStart();

        assert.deepEqual(feedback, {message, notify: false});
        assert.strictEqual(location.state.confirmed, false);
        assert.strictEqual(location.state.startError.type, "blocked");
        assert.strictEqual(Boolean(location.state.startError.title), true);
        assert.strictEqual(Boolean(location.state.startError.message), true);
        assert.strictEqual(location.state.startError.location, "WH/Stock");
        assert.strictEqual(
            location.state.startError.blockers,
            "INV/DEMO Ejecución — Pasillo D"
        );
        assert.strictEqual(Boolean(location.state.startError.action), true);
        assert.strictEqual(location.state.starting, false);
    });

    QUnit.test("testApplyPayloadContainsEveryExplicitLine", async (assert) => {
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
        countScreen.state = {
            lines: [
                {quant_id: 1, counted: 5, theoretical_qty: 5, tracking: "none"},
                {quant_id: 2, counted: 7, theoretical_qty: 5, tracking: "none"},
            ],
            applying: false,
        };
        let payload = null;
        countScreen.callApply = async (lines, confirmZero) =>
            (payload = {lines, confirmZero});
        await countScreen.apply();
        assert.deepEqual(
            payload.lines.map((line) => line.quant_id),
            [1, 2]
        );
        assert.strictEqual(payload.confirmZero, false);
    });

    QUnit.test("testScreensUseBarcodeRegistriesAndFeedback", (assert) => {
        for (const route of [
            "cycle_count_list",
            "cycle_count_location",
            "cycle_count_count",
            "cycle_count_done",
        ]) {
            assert.strictEqual(barcodeScreens.contains(route), true);
        }
        assert.strictEqual(
            CycleCountListScreen.prototype.setup
                .toString()
                .includes("barcodeScannerFeedback"),
            true
        );
        assert.strictEqual(
            CycleCountLocationScreen.prototype.setup
                .toString()
                .includes("barcodeScannerFeedback"),
            true
        );
        assert.strictEqual(
            CycleCountCountScreen.prototype.setup
                .toString()
                .includes("barcodeScannerFeedback"),
            true
        );
    });

    QUnit.test("testMobileCountFlowUsesScannerHandler", (assert) => {
        assert.strictEqual(
            CycleCountCountScreen.prototype.setup
                .toString()
                .includes("useBarcodeHandler"),
            true
        );
    });

    QUnit.test("testCancelSkipConfirmationStaysOnGate", (assert) => {
        const location = screen(CycleCountLocationScreen);
        location.state = {count, confirmed: true};
        let confirmation = null;
        location.dialog = {
            add: (_dialog, options) => (confirmation = options),
        };
        let navigated = false;
        location.goToCount = () => (navigated = true);
        location.skipLocation();
        assert.strictEqual(typeof confirmation.confirm, "function");
        assert.strictEqual(navigated, false);
    });

    QUnit.test(
        "testNonMatchingLocationScanRejectedWithExplicitSkipConfirmation",
        async (assert) => {
            const location = screen(CycleCountLocationScreen);
            location.state = {count, confirmed: true};
            const signals = [];
            location.feedback = {
                warning: (signal) => signals.push(signal),
            };
            let navigated = false;
            location.goToCount = () => (navigated = true);
            location.inventory = {
                searchRead: async () => [{id: 99, display_name: "WH/Other"}],
                call: async () => {
                    throw new Error("Wrong location");
                },
            };
            await location.onBarcodeScanned("WH/OTHER", {value: "WH/OTHER"});
            assert.strictEqual(signals[0].message, "Wrong location");
            assert.strictEqual(navigated, false);
        }
    );

    QUnit.test("testFailurePreservesScreenState", async (assert) => {
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
        const line = {
            quant_id: 2,
            counted: 7,
            theoretical_qty: 5,
            tracking: "none",
        };
        const signals = [];
        countScreen.state = {lines: [line], applying: false};
        countScreen.feedback = {
            error: (signal) => signals.push(signal),
        };
        countScreen.inventory = {
            call: async () => {
                throw new Error("Server unavailable");
            },
        };
        await countScreen.callApply([line], false);
        assert.deepEqual(countScreen.state.lines, [line]);
        assert.strictEqual(countScreen.state.applying, false);
        assert.strictEqual(signals[0].message, "Server unavailable");
    });

    QUnit.test("testDoneReturnPreservesShowAllMode", (assert) => {
        const countScreen = screen(CycleCountCountScreen, {showAll: true});
        const navigations = [];
        countScreen.store = {navigate: (...args) => navigations.push(args)};
        countScreen.openDone({
            cycle_count_id: count.id,
            inventory_id: 12,
            applied_count: 1,
            accuracy: 100,
        });
        assert.strictEqual(navigations[0][1].showAll, true);
    });

    QUnit.test(
        "done screen returns to the cycle-count list from header and action",
        async (assert) => {
            translatedTerms[translationLoaded] = true;
            const fixture = getFixture();
            const navigations = [];
            await mountScreen(
                CycleCountDoneScreen,
                {
                    barcodeStore: {
                        navigate: (...args) => navigations.push(args),
                    },
                },
                {
                    params: {
                        cycleCount: count,
                        appliedCount: 3,
                        accuracy: 96,
                        showAll: true,
                    },
                }
            );

            assert.ok(
                fixture
                    .querySelector(".ilx-cycle-count-done__header")
                    .textContent.includes("Cycle Count")
            );
            assert.ok(
                fixture
                    .querySelector(".ilx-cycle-count-done__summary")
                    .textContent.includes("Cycle count complete")
            );
            assert.ok(
                fixture
                    .querySelector(".ilx-cycle-count-done__results")
                    .textContent.includes("3")
            );
            assert.ok(
                fixture
                    .querySelector(".ilx-cycle-count-done__results")
                    .textContent.includes("96")
            );
            assert.strictEqual(
                fixture.querySelectorAll(".ilx-cycle-count-done__result strong")[1]
                    .textContent,
                "96%"
            );

            fixture.querySelector(".ilx-cycle-count-done__back").click();
            fixture.querySelector(".ilx-cycle-count-done__return").click();
            assert.deepEqual(navigations, [
                ["cycle_count_list", {showAll: true}, {clearHistory: true}],
                ["cycle_count_list", {showAll: true}, {clearHistory: true}],
            ]);
        }
    );

    QUnit.test("testNoBarcodeScannerCoreModification", (assert) => {
        assert.strictEqual(
            barcodeScreens.get("cycle_count_count").component,
            CycleCountCountScreen
        );
        assert.strictEqual(
            barcodeScreens.get("cycle_count_location").component,
            CycleCountLocationScreen
        );
        assert.strictEqual(barcodeMenuTiles.contains("cycle_count"), true);
    });

    QUnit.test("cycle count card hierarchy and keyboard activation", async (assert) => {
        translatedTerms[translationLoaded] = true;
        const fixture = getFixture();
        const cycleCount = {
            id: 84,
            name: "March inventory count",
            state: "draft",
            location_name: "WH/Stock/Shelving Zone A",
            responsible_id: 7,
            responsible_name: "Jordan Lee",
            date_deadline: "2025-12-30",
        };
        const navigations = [];
        const barcodeApi = {
            call: async () => ({counts: [cycleCount]}),
            searchRead: async () => [],
            readGroup: async () => [],
            read: async () => [{barcode_default_filters: {}}],
            write: async () => undefined,
            create: async () => [],
            unlink: async () => undefined,
            notify: () => undefined,
            openDialog: () => undefined,
        };
        const originalTodayInUserTimezone =
            CycleCountListScreen.prototype.todayInUserTimezone;
        CycleCountListScreen.prototype.todayInUserTimezone = () => "2026-01-01";
        let component = null;
        try {
            const mounted = await mountScreen(
                CycleCountListScreen,
                {
                    barcodeApi,
                    barcodeStore: {
                        navigate: (...args) => navigations.push(args),
                        goBack: () => undefined,
                    },
                    barcodeScannerFeedback: {
                        success: () => undefined,
                        warning: () => undefined,
                        error: () => undefined,
                    },
                    barcodeScannerBarcode: {bus: new EventTarget()},
                    user: {userId: 7, tz: "UTC"},
                },
                {params: {}}
            );
            component = mounted.component;
        } finally {
            CycleCountListScreen.prototype.todayInUserTimezone =
                originalTodayInUserTimezone;
        }
        // Other tests persist their search, filters and grouping in the
        // module-local session view; start this focused render unfiltered.
        component.todayInUserTimezone = () => "2026-01-01";
        component.clearFilters();
        component.state.groupByLevels = [];
        component.computeGroups();
        await nextTick();

        const card = fixture.querySelector(".ilx-queue-card");
        assert.strictEqual(card.getAttribute("role"), "button");
        assert.strictEqual(card.getAttribute("tabindex"), "0");
        const heading = card.querySelector(".ilx-queue-card__top");
        assert.strictEqual(
            heading.querySelector(".ilx-cycle-count-card__name").textContent,
            "March inventory count"
        );
        assert.ok(heading.textContent.includes("Planned"));
        assert.strictEqual(
            heading.querySelector(".ilx-cycle-count-card__location"),
            null
        );

        const location = card.querySelector(".ilx-cycle-count-card__location");
        assert.notStrictEqual(location.querySelector(".fa-map-marker"), null);
        assert.strictEqual(
            location.querySelector(".ilx-cycle-count-card__location-name").textContent,
            "WH/Stock/Shelving Zone A"
        );
        const metadata = card.querySelectorAll(".ilx-cycle-count-card__meta");
        assert.strictEqual(metadata.length, 2);
        assert.strictEqual(
            card.querySelector(".ilx-cycle-count-card__assignee").textContent.trim(),
            "Assignee: Jordan Lee"
        );
        const deadline = card.querySelector(".ilx-cycle-count-card__deadline");
        assert.strictEqual(deadline.textContent.trim(), "Deadline: Overdue");
        assert.strictEqual(
            deadline.classList.contains("ilx-cycle-count-overdue"),
            true
        );
        assert.strictEqual(
            getComputedStyle(deadline).backgroundColor,
            "rgb(253, 236, 234)"
        );
        assert.strictEqual(getComputedStyle(deadline).color, "rgb(186, 26, 26)");
        assert.strictEqual(deadline.textContent.match(/Overdue/g).length, 1);
        assert.strictEqual(
            card.querySelectorAll(".ilx-cycle-count-card__deadline").length,
            1
        );

        const enter = new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(enter);
        assert.strictEqual(enter.defaultPrevented, true);
        assert.deepEqual(navigations, [
            ["cycle_count_location", {cycleCountId: 84, cycleCount, showAll: false}],
        ]);

        component.openingCount = false;
        const space = new KeyboardEvent("keydown", {
            key: " ",
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(space);
        assert.strictEqual(space.defaultPrevented, true);
        assert.strictEqual(navigations.length, 1);

        const spaceUp = new KeyboardEvent("keyup", {
            key: " ",
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(spaceUp);
        assert.strictEqual(spaceUp.defaultPrevented, true);
        assert.strictEqual(navigations.length, 2);
        assert.deepEqual(navigations[1], navigations[0]);
    });

    QUnit.module("CycleCountCountScreen rendered UX", () => {
        const renderedLines = [
            {
                quant_id: 1,
                product_id: 40,
                product_name: "Desk Lamp",
                tracking: "none",
                lot_id: false,
                lot_name: false,
                theoretical_qty: 5,
                counted_qty: null,
                uom: "Units",
                rounding: 1,
            },
            {
                quant_id: 2,
                product_id: 41,
                product_name: "Cable",
                tracking: "lot",
                lot_id: 9,
                lot_name: "LOT-9",
                theoretical_qty: 10,
                counted_qty: 12,
                uom: "Units",
                rounding: 1,
            },
            {
                quant_id: 3,
                product_id: 41,
                product_name: "Cable",
                tracking: "serial",
                lot_id: 10,
                lot_name: "SN-1",
                theoretical_qty: 1,
                counted_qty: 0,
                uom: "Units",
                rounding: 1,
            },
        ];

        async function mountCountScreen({
            lines = renderedLines,
            call,
            searchRead,
        } = {}) {
            translatedTerms[translationLoaded] = true;
            const signals = {success: [], warning: [], error: []};
            const barcodeApi = {
                call:
                    call ||
                    (async () => ({
                        lines: lines.map((line) => ({...line})),
                    })),
                searchRead: searchRead || (async () => []),
                readGroup: async () => [],
                read: async () => [],
                write: async () => undefined,
                create: async () => [],
                unlink: async () => undefined,
                notify: () => undefined,
                openDialog: () => undefined,
            };
            const env = await makeScreenEnv({
                barcodeApi,
                barcodeStore: {navigate: () => undefined, goBack: () => undefined},
                barcodeScannerFeedback: {
                    success: (signal) => signals.success.push(signal),
                    warning: (signal) => signals.warning.push(signal),
                    error: (signal) => signals.error.push(signal),
                },
                barcodeScannerBarcode: {bus: new EventTarget()},
                dialog: {add: () => undefined},
            });
            const component = await mount(CycleCountCountScreen, getFixture(), {
                env,
                props: {
                    params: {
                        cycleCountId: count.id,
                        cycleCount: count,
                        inventoryId: 12,
                    },
                },
            });
            return {component, signals, env};
        }

        /**
         * Give the count list a 100px-tall scroll viewport and place the line
         * of `quantId` at `lineRect`, so the scroll code has a viewport to
         * align against.
         *
         * @param {Number} quantId the line to place
         * @param {Object} lineRect the line's top/bottom
         * @param {Number} [scrollTop] the current scroll offset
         * @returns {Object} the scroll container and the calls it received
         */
        function mockCountScrollViewport(quantId, lineRect, scrollTop = 0) {
            const scrollContainer = getFixture().querySelector(".ilx-count-main");
            const scrollCalls = [];
            Object.defineProperties(scrollContainer, {
                clientHeight: {configurable: true, value: 100},
                clientTop: {configurable: true, value: 0},
                scrollTop: {configurable: true, writable: true, value: scrollTop},
            });
            scrollContainer.getBoundingClientRect = () => ({top: 100, bottom: 200});
            Object.defineProperty(scrollContainer, "scrollTo", {
                configurable: true,
                value: ({top, behavior}) => {
                    scrollCalls.push({top, behavior});
                    scrollContainer.scrollTop = top;
                },
            });
            const line = [...scrollContainer.querySelectorAll(".ilx-count-line")].find(
                (item) => item.dataset.quantId === String(quantId)
            );
            line.getBoundingClientRect = () => lineRect;
            return {scrollContainer, scrollCalls};
        }

        QUnit.test(
            "partial save is a separate footer action enabled for dirty lines",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen();
                const saveButton = fixture.querySelector(".ilx-count-save");
                const applyButton = fixture.querySelector(".ilx-count-apply");

                assert.notStrictEqual(saveButton, null);
                assert.ok(saveButton.textContent.includes("Save Draft"));
                assert.strictEqual(saveButton.disabled, true);
                assert.notStrictEqual(applyButton, null);
                assert.ok(applyButton.textContent.includes("Apply count"));
                assert.ok(applyButton.textContent.includes("verified"));
                const footer = fixture.querySelector(".ilx-count-footer");
                assert.strictEqual(footer.children[0], saveButton);
                assert.strictEqual(footer.children[1], applyButton);

                component.setCounted(component.state.lines[0], "0");
                await nextTick();

                assert.strictEqual(saveButton.disabled, false);
                assert.strictEqual(applyButton.disabled, false);

                component.state.saving = true;
                await nextTick();

                assert.strictEqual(saveButton.disabled, true);
                assert.strictEqual(applyButton.disabled, true);
                assert.strictEqual(
                    fixture.querySelector(".ilx-count-qty input").disabled,
                    true
                );
                assert.strictEqual(
                    fixture.querySelector(".ilx-emp-v2-back-btn").disabled,
                    true
                );
            }
        );

        QUnit.test(
            "QTS-01: product and lot identity readable per row",
            async (assert) => {
                const fixture = getFixture();
                await mountCountScreen();
                const cards = fixture.querySelectorAll(".ilx-count-line");
                assert.strictEqual(cards.length, 3);
                assert.ok(cards[0].textContent.includes("Desk Lamp"));
                assert.strictEqual(
                    cards[0].querySelector(".ilx-count-line__lot"),
                    null
                );
                assert.ok(cards[1].textContent.includes("Cable"));
                assert.strictEqual(
                    cards[1].querySelector(".ilx-count-line__lot").textContent,
                    "LOT-9"
                );
                assert.ok(cards[2].textContent.includes("Cable"));
                assert.strictEqual(
                    cards[2].querySelector(".ilx-count-line__lot").textContent,
                    "SN-1"
                );
            }
        );

        QUnit.test(
            "QTS-02: on hand, counted and difference are distinct and labeled",
            async (assert) => {
                const fixture = getFixture();
                await mountCountScreen();
                const cards = fixture.querySelectorAll(".ilx-count-line");
                const labels = [
                    ...cards[1].querySelectorAll(".ilx-count-qty__label"),
                ].map((el) => el.textContent.trim());
                assert.deepEqual(labels, ["On hand", "Counted"]);
                assert.strictEqual(
                    cards[1].querySelector(".ilx-count-difference__label").textContent,
                    "Diff"
                );
                assert.ok(
                    cards[1]
                        .querySelector(".ilx-count-qty__value")
                        .textContent.includes("10")
                );
                assert.strictEqual(
                    cards[1].querySelector('input[type="number"]').value,
                    "12"
                );
                assert.strictEqual(
                    cards[1].querySelector(".ilx-count-diff-chip").textContent.trim(),
                    "+2Units"
                );
                assert.strictEqual(
                    cards[2].querySelector(".ilx-count-diff-chip").textContent.trim(),
                    "-1Units"
                );
                assert.strictEqual(
                    cards[0].querySelector(".ilx-count-diff-chip").textContent.trim(),
                    "—"
                );
            }
        );

        QUnit.test(
            "QTS-03: loading, error, empty and progress states",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen();
                // Populated: X of Y (zero counted counts, null does not) + bar.
                const progress = fixture.querySelector(".ilx-count-progress");
                assert.ok(textOf(progress.textContent).includes("2 of 3 counted"));
                const bar = fixture.querySelector('[role="progressbar"]');
                assert.strictEqual(bar.getAttribute("aria-valuenow"), "2");
                assert.strictEqual(bar.getAttribute("aria-valuemax"), "3");

                component.state.loading = true;
                await nextTick();
                assert.ok(
                    fixture
                        .querySelector(".ilx-count-state--loading")
                        .textContent.includes("Loading count lines")
                );

                component.state.loading = false;
                component.state.error = true;
                await nextTick();
                assert.ok(
                    fixture
                        .querySelector(".ilx-count-state--error")
                        .textContent.includes("Unable to load count lines")
                );

                component.state.error = false;
                component.state.lines = [];
                await nextTick();
                assert.ok(
                    fixture
                        .querySelector(".ilx-count-state--empty")
                        .textContent.includes("No stock in this location")
                );
                assert.strictEqual(fixture.querySelector('[role="progressbar"]'), null);
            }
        );

        QUnit.test(
            "QTS-04: accepted scan feedback highlights exact row; rejected warns",
            async (assert) => {
                const fixture = getFixture();
                const {component, signals} = await mountCountScreen({
                    searchRead: async (model) =>
                        model === "product.product"
                            ? [{id: 41, tracking: "lot"}]
                            : [
                                  {
                                      id: 9,
                                      name: "LOT-9",
                                      product_id: [41, "Cable"],
                                  },
                              ],
                });
                await component.onBarcodeScanned("scan", {
                    productCodes: ["P41"],
                    lot: "LOT-9",
                    quantity: 1,
                });
                await nextTick();
                assert.strictEqual(component.state.lines[1].counted, 13);
                const highlighted = fixture.querySelector(
                    ".ilx-count-line--highlighted"
                );
                assert.ok(highlighted.textContent.includes("LOT-9"));
                const feedback = fixture.querySelector(".ilx-count-feedback");
                assert.ok(feedback.className.includes("ilx-count-feedback--success"));
                assert.ok(feedback.textContent.includes("Cable"));
                assert.ok(feedback.textContent.includes("LOT-9"));

                // A rejected scan replaces the banner, clears the highlight and
                // leaves quantities untouched.
                const before = component.state.lines.map((line) => line.counted);
                await component.onBarcodeScanned("scan", {
                    productCodes: ["P41"],
                    lot: "",
                    quantity: 1,
                });
                await nextTick();
                assert.deepEqual(
                    component.state.lines.map((line) => line.counted),
                    before
                );
                assert.strictEqual(
                    fixture.querySelector(".ilx-count-line--highlighted"),
                    null
                );
                const feedback2 = fixture.querySelector(".ilx-count-feedback");
                assert.ok(feedback2.className.includes("ilx-count-feedback--warning"));
                assert.ok(signals.warning.length > 0);
            }
        );

        QUnit.test(
            "scan viewport: successful scan minimally scrolls an offscreen line and restores scanner focus",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen({
                    searchRead: async (model) =>
                        model === "product.product" ? [{id: 40, tracking: "none"}] : [],
                });
                const {scrollCalls} = mockCountScrollViewport(
                    1,
                    {top: 240, bottom: 280},
                    25
                );
                const scannerInput = fixture.querySelector("#cycle-count-identity");
                scannerInput.focus();

                assert.strictEqual(
                    await component.onBarcodeScanned("P40", {
                        productCodes: ["P40"],
                    }),
                    true
                );
                await nextTick();

                assert.strictEqual(component.state.lines[0].counted, 1);
                assert.strictEqual(scrollCalls.length, 1);
                // Align only the clipped bottom edge: 80px is the nearest move.
                assert.strictEqual(scrollCalls[0].top, 105);
                assert.strictEqual(document.activeElement, scannerInput);
            }
        );

        QUnit.test(
            "scan viewport: successful scan scrolls a newly added offscreen line into view",
            async (assert) => {
                const fixture = getFixture();
                const originalGetBoundingClientRect =
                    Element.prototype.getBoundingClientRect;
                Element.prototype.getBoundingClientRect = function () {
                    if (this.matches(".ilx-count-main")) {
                        return {top: 100, bottom: 200};
                    }
                    if (this.matches('.ilx-count-line[data-quant-id="44"]')) {
                        return {top: 250, bottom: 290};
                    }
                    return originalGetBoundingClientRect.call(this);
                };
                try {
                    const addedLine = {
                        quant_id: 44,
                        product_id: 42,
                        product_name: "New item",
                        tracking: "none",
                        lot_id: false,
                        lot_name: false,
                        theoretical_qty: 3,
                        counted_qty: null,
                        uom: "Units",
                        rounding: 1,
                    };
                    const {component} = await mountCountScreen({
                        call: async (_model, method) =>
                            method === "barcode_get_cycle_count_lines"
                                ? {lines: renderedLines}
                                : addedLine,
                        searchRead: async (model) =>
                            model === "product.product"
                                ? [{id: 42, tracking: "none"}]
                                : [],
                    });
                    const scrollContainer = fixture.querySelector(".ilx-count-main");
                    const scrollCalls = [];
                    Object.defineProperties(scrollContainer, {
                        clientHeight: {configurable: true, value: 100},
                        clientTop: {configurable: true, value: 0},
                        scrollTop: {
                            configurable: true,
                            writable: true,
                            value: 10,
                        },
                    });
                    Object.defineProperty(scrollContainer, "scrollTo", {
                        configurable: true,
                        value: ({top, behavior}) => {
                            scrollCalls.push({top, behavior});
                            scrollContainer.scrollTop = top;
                        },
                    });
                    const scannerInput = fixture.querySelector("#cycle-count-identity");
                    scannerInput.focus();

                    assert.strictEqual(
                        await component.onBarcodeScanned("P42", {
                            productCodes: ["P42"],
                        }),
                        true
                    );
                    await nextTick();

                    assert.notStrictEqual(
                        fixture.querySelector('[data-quant-id="44"]'),
                        null
                    );
                    assert.strictEqual(component.state.lines.at(-1).counted, 1);
                    assert.strictEqual(scrollCalls.length, 1);
                    assert.strictEqual(scrollCalls[0].top, 100);
                    assert.strictEqual(document.activeElement, scannerInput);
                } finally {
                    Element.prototype.getBoundingClientRect =
                        originalGetBoundingClientRect;
                }
            }
        );

        QUnit.test(
            "scan viewport: successful scan leaves the viewport unchanged when its line is visible",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen({
                    searchRead: async (model) =>
                        model === "product.product" ? [{id: 40, tracking: "none"}] : [],
                });
                const {scrollCalls, scrollContainer} = mockCountScrollViewport(
                    1,
                    {top: 125, bottom: 175},
                    42
                );
                const scannerInput = fixture.querySelector("#cycle-count-identity");
                scannerInput.focus();

                assert.strictEqual(
                    await component.onBarcodeScanned("P40", {
                        productCodes: ["P40"],
                    }),
                    true
                );
                await nextTick();

                assert.deepEqual(scrollCalls, []);
                assert.strictEqual(scrollContainer.scrollTop, 42);
                assert.strictEqual(document.activeElement, scannerInput);
            }
        );

        QUnit.test(
            "scan viewport: unresolved E-COM06 scan does not scroll and restores scanner focus",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen({
                    searchRead: async () => [],
                });
                const {scrollCalls, scrollContainer} = mockCountScrollViewport(
                    1,
                    {top: 240, bottom: 280},
                    25
                );
                const scannerInput = fixture.querySelector("#cycle-count-identity");
                scannerInput.focus();

                assert.strictEqual(
                    await component.onBarcodeScanned("E-COM06", {
                        productCodes: ["E-COM06"],
                        value: "E-COM06",
                    }),
                    false
                );
                await nextTick();

                assert.deepEqual(scrollCalls, []);
                assert.strictEqual(scrollContainer.scrollTop, 25);
                assert.strictEqual(document.activeElement, scannerInput);
            }
        );

        QUnit.test(
            "QTS-04b: serial over-one scan stays rejected without success highlight",
            async (assert) => {
                const fixture = getFixture();
                const {component, signals} = await mountCountScreen({
                    searchRead: async (model) =>
                        model === "product.product"
                            ? [{id: 41, tracking: "serial"}]
                            : [
                                  {
                                      id: 10,
                                      name: "SN-1",
                                      product_id: [41, "Cable"],
                                  },
                              ],
                });
                await component.onBarcodeScanned("scan", {
                    productCodes: ["P41"],
                    lot: "SN-1",
                    quantity: 2,
                });
                await nextTick();
                // SetCounted rejects serial > 1: no highlight, no success feedback.
                assert.strictEqual(
                    fixture.querySelector(".ilx-count-line--highlighted"),
                    null
                );
                const feedback = fixture.querySelector(".ilx-count-feedback");
                assert.ok(feedback.className.includes("ilx-count-feedback--warning"));
                assert.ok(signals.warning.at(-1).message.includes("serial"));
            }
        );

        QUnit.test(
            "QTS-05: no literal false; valid zero still renders",
            async (assert) => {
                const fixture = getFixture();
                await mountCountScreen();
                const cards = fixture.querySelectorAll(".ilx-count-line");
                for (const card of cards) {
                    assert.notOk(card.textContent.includes("false"));
                }
                const serialCard = cards[2];
                assert.strictEqual(
                    serialCard.querySelector('input[type="number"]').value,
                    "0"
                );
            }
        );

        QUnit.test(
            "QTS-06: actionable controls meet 44px touch target",
            async (assert) => {
                const fixture = getFixture();
                await mountCountScreen();
                const targets = [
                    fixture.querySelector(".ilx-emp-v2-back-btn"),
                    fixture.querySelector("form .btn.btn-primary"),
                    fixture.querySelector('input[type="number"]'),
                    fixture.querySelector(".ilx-emp-v2-confirm-btn"),
                ];
                for (const el of targets) {
                    const style = getComputedStyle(el);
                    assert.ok(parseFloat(style.minHeight) >= 44);
                }
            }
        );

        QUnit.test(
            "QTS-07: rendered quantity buttons use whole steps and keep manual decimals",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen({
                    lines: [
                        {
                            ...renderedLines[0],
                            rounding: 0.01,
                            counted_qty: 2.25,
                        },
                    ],
                });
                const card = fixture.querySelector(".ilx-count-line");
                const input = card.querySelector('input[type="number"]');
                assert.strictEqual(input.step, "1");

                card.querySelector('[aria-label^="Increase counted quantity"]').click();
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 3.25);

                const quickButtons = card.querySelectorAll(".ilx-count-quick__button");
                quickButtons[1].click();
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 4.25);
                quickButtons[2].click();
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 9.25);

                input.value = "8.75";
                input.dispatchEvent(new Event("input", {bubbles: true}));
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 8.75);
                card.querySelector('[aria-label^="Decrease counted quantity"]').click();
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 7.75);

                const setToOnHand = quickButtons[0];
                const style = getComputedStyle(setToOnHand);
                assert.strictEqual(style.color, "rgb(255, 255, 255)");
                assert.strictEqual(style.backgroundColor, "rgb(77, 54, 121)");
            }
        );

        QUnit.test(
            "QTS-08: Set to on-hand is hidden only at exact equality",
            async (assert) => {
                const fixture = getFixture();
                const {component} = await mountCountScreen({
                    lines: [
                        {...renderedLines[0], counted_qty: null, rounding: 1},
                        {
                            ...renderedLines[0],
                            quant_id: 2,
                            product_name: "Rounded difference",
                            counted_qty: 5.4,
                            theoretical_qty: 5,
                            rounding: 1,
                        },
                    ],
                });
                const [pendingCard, roundedCard] =
                    fixture.querySelectorAll(".ilx-count-line");
                const setToOnHand = (card) =>
                    card.querySelector(".ilx-count-quick__button--match");
                const quickButton = (label) =>
                    [...pendingCard.querySelectorAll(".ilx-count-quick__button")].find(
                        (button) => button.textContent.trim() === label
                    );

                // Both pending counts and exact-unequal counts can still be set.
                assert.notStrictEqual(setToOnHand(pendingCard), null);
                assert.strictEqual(component.difference(component.state.lines[1]), 0);
                assert.notStrictEqual(setToOnHand(roundedCard), null);
                setToOnHand(pendingCard).click();
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 5);
                assert.strictEqual(setToOnHand(pendingCard), null);

                // Keep Quick count and its increment controls when Set is hidden.
                assert.notStrictEqual(
                    pendingCard.querySelector(".ilx-count-quick"),
                    null
                );
                assert.notStrictEqual(quickButton("+1"), undefined);
                assert.notStrictEqual(quickButton("+5"), undefined);

                // Moving away from on-hand restores the action.
                quickButton("+1").click();
                await nextTick();
                assert.strictEqual(component.state.lines[0].counted, 6);
                assert.notStrictEqual(setToOnHand(pendingCard), null);
            }
        );

        QUnit.test(
            "quantity controls use whole steps and preserve manual decimals",
            (assert) => {
                const countScreen = screen(CycleCountCountScreen);
                countScreen.state = {lines: [], highlightedQuantId: null};
                const decimalLine = {
                    quant_id: 4,
                    counted: 16.25,
                    theoretical_qty: 16,
                    rounding: 0.01,
                    tracking: "none",
                };
                assert.strictEqual(countScreen.quantityStep(decimalLine), 1);
                countScreen.adjustCounted(
                    decimalLine,
                    countScreen.quantityStep(decimalLine)
                );
                assert.strictEqual(decimalLine.counted, 17.25);
                countScreen.adjustCounted(
                    decimalLine,
                    -countScreen.quantityStep(decimalLine)
                );
                assert.strictEqual(decimalLine.counted, 16.25);
                countScreen.adjustCounted(decimalLine, 5);
                assert.strictEqual(decimalLine.counted, 21.25);

                const serialLine = {
                    quant_id: 5,
                    counted: 0,
                    theoretical_qty: 1,
                    rounding: 1,
                    tracking: "serial",
                };
                countScreen.adjustCounted(serialLine, 1);
                countScreen.adjustCounted(serialLine, 1);
                assert.strictEqual(serialLine.counted, 1);

                // Manual precision remains accepted; the explicit buttons still
                // move this manually entered decimal count by one whole unit.
                countScreen.setCounted(decimalLine, "16.75");
                assert.strictEqual(decimalLine.counted, 16.75);
                countScreen.adjustCounted(decimalLine, -1);
                assert.strictEqual(decimalLine.counted, 15.75);

                countScreen.state.lines = [
                    decimalLine,
                    serialLine,
                    {...decimalLine, quant_id: 6, counted: null},
                ];
                assert.strictEqual(countScreen.progressPercent, 67);
            }
        );
    });
});
