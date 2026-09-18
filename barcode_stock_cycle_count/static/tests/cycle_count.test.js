/** @odoo-module **/

import {EventBus} from "@odoo/owl";
import {describe, expect, test} from "@odoo/hoot";
import {animationFrame} from "@odoo/hoot-dom";
import {mountWithCleanup} from "@web/../tests/web_test_helpers";
import {translatedTerms, translationLoaded} from "@web/core/l10n/translation";
import {barcodeMenuTiles, barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {BarcodeScannerFeedbackService} from "@barcode_scanner/js/services/feedback_service.esm";
import {CycleCountCountScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_count_screen.esm";
import {CycleCountDoneScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_done_screen.esm";
import {CycleCountListScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_list_screen.esm";
import {CycleCountLocationScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_location_screen.esm";
import "@barcode_stock_cycle_count/js/camera_routes.esm";
import "@barcode_stock_cycle_count/js/tiles/cycle_count_menu_tile.esm";

const count = {id: 7, name: "March count", location_id: 8, location_name: "WH/Stock"};

/* eslint-disable no-empty-function */
function screen(Screen, props = {}) {
    return Object.assign(Object.create(Screen.prototype), {
        props: {params: {cycleCountId: count.id, cycleCount: count, ...props}},
        state: {},
        feedback: {success() {}, warning() {}, error() {}},
        store: {navigate() {}, goBack() {}},
        dialog: {add() {}},
    });
}
/* eslint-enable no-empty-function */

describe("BarcodeStockCycleCount", () => {
    test("errorNotificationUsesDangerType", () => {
        const notifications = [];
        const feedback = new BarcodeScannerFeedbackService({
            add: (...args) => notifications.push(args),
        });
        feedback.enabled = {audio: false, vibration: false, flash: false};
        const message = "Unable to apply the cycle count";

        feedback.error({message, notify: true});

        expect(notifications).toEqual([[message, {type: "danger"}]]);
        feedback.destroy();
    });

    test("testHomeTileNavigatesToCycleCount", () => {
        const tile = barcodeMenuTiles.get("cycle_count");
        let route = null;
        tile.action({navigate: (name) => (route = name)});
        expect(barcodeMenuTiles.contains("cycle_count")).toBe(true);
        expect(route).toBe("cycle_count_list");
    });

    test("testListLoadAndSelection", async () => {
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
        expect(callArgs).toEqual([false]);
        expect(list.state.counts).toEqual([{id: 1}]);
        list.selectCount(list.state.counts[0]);
        expect(navigations[0]).toEqual([
            "cycle_count_location",
            {cycleCountId: 1, cycleCount: {id: 1}, showAll: false},
        ]);
    });

    test("listCountersAndSubtitle", () => {
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

        expect(list.summaryCards.map((card) => card.value)).toEqual([4, 2, 2, 1]);
        expect(
            `${list.filteredCounts.length}/${list.state.counts.length} visible`
        ).toBe("4/4 visible");
        list.state.search = "future";
        expect(
            `${list.filteredCounts.length}/${list.state.counts.length} visible`
        ).toBe("1/4 visible");
    });

    test("searchAndScanResolution", async () => {
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

        expect(list.getMatchingCounts("  march ")).toEqual([records[0]]);
        await list.onBarcodeScanned(" wh/stock ");
        expect(navigations[0]).toEqual([
            "cycle_count_location",
            {cycleCountId: 1, cycleCount: records[0], showAll: false},
        ]);

        list.openingCount = false;
        await list.onBarcodeScanned("April Count");
        expect(signals.at(-1)[0]).toBe("info");
        expect(navigations).toHaveLength(1);
        await list.onBarcodeScanned("Unknown");
        expect(signals.at(-1)[0]).toBe("warning");
        expect(navigations).toHaveLength(1);

        list.state.search = "existing";
        list.state.loading = true;
        await list.onBarcodeScanned("March Count");
        expect(list.state.search).toBe("existing");
        list.state.loading = false;
        await list.onBarcodeScanned("   ");
        expect(list.state.search).toBe("existing");
    });

    test("filtersCombineAndClear", () => {
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
        expect(
            list.getMatchingCounts(list.state.search).map((item) => item.id)
        ).toEqual([1]);
        expect(list.matchesAssignment({responsible_id: false}, "mine")).toBe(false);

        list.setCustomDate("2020-01-02");
        expect(list.getMatchingCounts("alpha").map((item) => item.id)).toEqual([1]);
        list.clearFilters();
        expect(list.state.search).toBe("");
        expect(list.state.activeFilters).toEqual([]);
        expect(list.state.counts).toHaveLength(3);
    });

    test("defaultFilterPersistence", async () => {
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
                expect(model).toBe("res.users");
                expect(fields).toEqual(["barcode_default_filters"]);
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
        expect(list.allDefaults).toEqual({
            outgoing: otherOperation,
            cycle_count: savedCycleCount,
        });
        expect(list.state.activeFilters).toEqual(["assignment"]);
        expect(list.state.filterValues.assignment).toBe("mine");
        expect(list.state.filterValues.state).toBe("all");
        expect(list.isCurrentFilterDefault).toBe(true);

        // Starring saves a filters-only config and preserves other keys,
        // ignoring the search and grouping of the current view.
        list.clearFilters();
        list.setFilterValue("state", "open");
        list.state.search = "march";
        list.state.groupByLevels = ["state"];
        await list.toggleDefaultFilter();
        expect(writes).toHaveLength(1);
        expect(writes[0].model).toBe("res.users");
        expect(writes[0].values.barcode_default_filters.outgoing).toEqual(
            otherOperation
        );
        expect(writes[0].values.barcode_default_filters.cycle_count).toEqual({
            activeFilters: ["state"],
            filterValues: {state: "open"},
        });
        expect("search" in writes[0].values.barcode_default_filters.cycle_count).toBe(
            false
        );
        expect(list.isCurrentFilterDefault).toBe(true);

        // Unstarring removes only the cycle_count entry.
        await list.toggleDefaultFilter();
        expect(writes).toHaveLength(2);
        expect(writes[1].values.barcode_default_filters).toEqual({
            outgoing: otherOperation,
        });
        expect(list.state.savedDefault).toBe(null);

        // Starring with no active filters warns and does not write.
        list.clearFilters();
        await list.toggleDefaultFilter();
        expect(warnings).toHaveLength(1);
        expect(writes).toHaveLength(2);

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
        expect(recreated.state.activeFilters).toEqual(["deadline"]);
        expect(recreated.state.filterValues.deadline).toBe("today");
        expect(recreated.state.search).toBe("march");
        expect(recreated.state.groupByLevels).toEqual(["deadline"]);
        expect(recreated.isCurrentFilterDefault).toBe(false);
    });

    test("groupingAndPersistence", async () => {
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
        expect(Object.keys(stateGroups)).toEqual(["Planned", "Execution"]);
        expect(list.countGroupEntries(stateGroups)).toBe(3);

        const deadlineGroups = list.groupRecursively(list.state.counts, ["deadline"]);
        expect(Object.keys(deadlineGroups)).toEqual([
            "Overdue",
            "Today",
            "No deadline",
        ]);
        list.toggleGroup("root-Planned");
        expect(list.state.collapsedGroups["root-Planned"]).toBe(true);
        list.state.groupByLevels = ["state", "deadline"];
        list.persistSessionView();

        const normalized = list.normalizeView({
            activeFilters: ["state", "unknown"],
            filterValues: {state: "invalid"},
            groupByLevels: ["deadline", "bad"],
        });
        expect(normalized.activeFilters).toEqual([]);
        expect(normalized.groupByLevels).toEqual(["deadline"]);

        const recreated = screen(CycleCountListScreen);
        await recreated.loadDefaultFilter();
        expect(recreated.state.groupByLevels).toEqual(["state", "deadline"]);
        expect(recreated.state.collapsedGroups["root-Planned"]).toBe(true);
    });

    test("testScanMatchesLine", async () => {
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
        expect(line.counted).toBe(1);
    });

    test("saveCountPersistsDirtyLinesWithRevisionWithoutApplyingOrClosing", async () => {
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
        countScreen.feedback = {success: (signal) => successes.push(signal)};
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

        expect(calls).toEqual([
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
        expect(zeroLine).toMatchObject({
            counted: 0,
            counted_qty: 0,
            barcode_cycle_count_counted: true,
            write_date: "saved-20",
        });
        expect(clearedLine).toMatchObject({
            counted: null,
            counted_qty: null,
            barcode_cycle_count_counted: false,
            write_date: "saved-21",
        });
        expect(unchangedLine.write_date).toBe("revision-22");
        expect(countScreen.dirtyLines).toEqual([]);
        expect(successes).toHaveLength(1);
        expect(calls.map(([, method]) => method)).toEqual([
            "barcode_save_cycle_count_line",
            "barcode_save_cycle_count_line",
        ]);
    });

    test("saveCountKeepsUnacknowledgedLinesForRetry", async () => {
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

        expect(calls).toEqual([
            ["barcode_save_cycle_count_line", 30, 0],
            ["barcode_save_cycle_count_line", 31, 4],
        ]);
        expect(lines[0]).toMatchObject({
            counted: 0,
            counted_qty: 0,
            barcode_cycle_count_counted: true,
            write_date: "saved-30",
        });
        expect(lines[1]).toMatchObject({
            counted: 4,
            counted_qty: null,
            write_date: "revision-31",
        });
        expect(lines[2]).toMatchObject({
            counted: null,
            counted_qty: 2,
            write_date: "revision-32",
        });
        expect(errors).toEqual([{message: "Revision conflict", notify: true}]);
        expect(successes).toHaveLength(0);
        expect(countScreen.state.saving).toBe(false);

        await countScreen.saveCount();

        expect(calls).toEqual([
            ["barcode_save_cycle_count_line", 30, 0],
            ["barcode_save_cycle_count_line", 31, 4],
            ["barcode_save_cycle_count_line", 31, 4],
            ["barcode_save_cycle_count_line", 32, null],
        ]);
        expect(lines[1]).toMatchObject({
            counted: 4,
            counted_qty: 4,
            barcode_cycle_count_counted: true,
            write_date: "saved-31",
        });
        expect(lines[2]).toMatchObject({
            counted: null,
            counted_qty: null,
            barcode_cycle_count_counted: false,
            write_date: "saved-32",
        });
        expect(countScreen.dirtyLines).toEqual([]);
        expect(successes).toHaveLength(1);
    });

    test("savingBlocksCompetingScansAndEdits", async () => {
        const countScreen = screen(CycleCountCountScreen);
        const line = {quant_id: 40, counted: 1, counted_qty: null};
        let resolveSave;
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
        expect(countScreen.state.saving).toBe(true);
        countScreen.setCounted(line, "7");
        countScreen.adjustCounted(line, 1);
        expect(await countScreen.onBarcodeScanned("SKU-40")).toBe(false);
        expect(line.counted).toBe(1);

        // Preserve an edit from another local source if it lands before an ACK.
        line.counted = 7;
        resolveSave({
            quant_id: 40,
            counted_qty: 1,
            barcode_cycle_count_counted: true,
            write_date: "saved-40",
        });
        await save;
        expect(countScreen.state.saving).toBe(false);
        expect(line).toMatchObject({counted: 7, counted_qty: 1, write_date: "saved-40"});
        expect(countScreen.dirtyLines).toEqual([line]);
        expect(warnings).toHaveLength(1);

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

        expect(payloads.map(({counted_qty, write_date}) => [counted_qty, write_date])).toEqual([
            [1, false],
            [7, "saved-40"],
        ]);
        expect(line).toMatchObject({
            counted: 7,
            counted_qty: 7,
            barcode_cycle_count_counted: true,
            write_date: "saved-41",
        });
        expect(countScreen.dirtyLines).toEqual([]);
    });

    test("testDifferenceIsVisible", () => {
        const countScreen = screen(CycleCountCountScreen);
        expect(countScreen.difference({counted: 7, theoretical_qty: 5})).toBe(2);
        expect(countScreen.difference({counted: null, theoretical_qty: 5})).toBe(null);
    });

    test("testRoundingOnlyDifferenceIsZero", () => {
        const countScreen = screen(CycleCountCountScreen);
        expect(
            countScreen.difference({
                counted: 5.4,
                theoretical_qty: 5,
                rounding: 1,
            })
        ).toBe(0);
        expect(
            countScreen.difference({
                counted: 5.5,
                theoretical_qty: 5,
                rounding: 1,
            })
        ).toBe(0.5);
    });

    test("testTrackedLineRejectsMissingOrMismatchedLot", async () => {
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
        countScreen.feedback = {warning: (signal) => signals.push(signal)};
        countScreen.inventory = {
            searchRead: async (model) =>
                model === "product.product" ? [{id: 40, tracking: "lot"}] : [],
        };
        await countScreen.onBarcodeScanned("ignored", {
            productCodes: ["PROD-40"],
            lot: "LOT-2",
            quantity: 1,
        });
        expect(line.counted).toBe(null);
        expect(signals).toHaveLength(1);
    });

    test("unknownProductScanAddsAuthoritativeLineAndSubmitsOnce", async () => {
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

        expect(addCalls).toEqual([[12, 40, false]]);
        expect(countScreen.state.lines).toHaveLength(2);
        expect(existingLine.counted).toBe(6);
        expect(countScreen.state.lines[1]).toMatchObject({
            quant_id: 21,
            theoretical_qty: 8,
            counted_qty: 0,
            counted: 3,
        });
        await countScreen.callApply(countScreen.countedLines, false);
        expect(applyArgs).toEqual([
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
    });

    test("typedLotUsesExistingIdentityAndRejectsInvalidMatches", async () => {
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
                        {id: 9, name: "LOT-A", product_id: [40, "Tracked product"]},
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
        expect(countScreen.state.identityInput).toBe("");
        expect(addCalls).toEqual([[12, 40, 9]]);
        expect(countScreen.state.lines[0]).toMatchObject({
            product_id: 40,
            lot_id: 9,
            lot_name: "LOT-A",
            theoretical_qty: 7,
            counted: 1,
        });
        await countScreen.callApply(countScreen.countedLines, false);
        expect(applyArgs[1][0]).toMatchObject({
            quant_id: 31,
            counted_qty: 1,
            lot_id: 9,
            lot_name: "LOT-A",
        });

        const rejected = screen(CycleCountCountScreen, {inventoryId: 12});
        const warnings = [];
        let rejectedAdd = false;
        rejected.state = {lines: [], applying: false};
        rejected.feedback = {warning: (signal) => warnings.push(signal)};
        rejected.inventory = {
            searchRead: async (model) =>
                model === "product.product"
                    ? [{id: 40, tracking: "lot"}]
                    : [{id: 10, name: "LOT-X", product_id: [41, "Other product"]}],
            call: async () => (rejectedAdd = true),
        };
        await rejected.onBarcodeScanned("SKU-40", {
            productCodes: ["SKU-40"],
            lot: "LOT-X",
        });
        expect(rejected.state.lines).toEqual([]);
        expect(rejectedAdd).toBe(false);
        expect(warnings).toHaveLength(1);
    });

    test("openExecutionCountResumesLinkedAdjustmentDirectly", async () => {
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
        expect(list.state.counts).toEqual([open]);

        const navigations = [];
        list.store = {navigate: (...args) => navigations.push(args)};
        calls.length = 0;
        list.selectCount(open);
        // Expectation EXP-01: an Execution (open) count opens its count screen
        // directly with the existing linked adjustment; no location screen and
        // no adjustment creation/restart call.
        expect(navigations).toEqual([
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
        expect(navigations.some(([route]) => route === "cycle_count_location")).toBe(
            false
        );
        expect(calls).toEqual([]);

        // The resumed screen loads the existing linked adjustment and preserves
        // the saved count progress.
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
        expect(lineRequest).toEqual([120]);
        expect(countScreen.state.lines[0].counted).toBe(7);
    });

    test("openCountWithDraftAdjustmentUsesConfirmStartGate", () => {
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

        expect(navigations).toEqual([
            [
                "cycle_count_location",
                {cycleCountId: 73, cycleCount: open, showAll: false},
            ],
        ]);
    });

    test("plannedCountKeepsConfirmStartAndLocationGuard", async () => {
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
        expect(navigations).toEqual([
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
        expect(locationRoutes).toEqual([]);
        await location.confirmStart();
        expect(draftConfirmation).toEqual(["barcode_confirm", [71]]);
        expect(location.state.inventoryId).toBe(121);
        location.goToCount();
        expect(locationRoutes[0][0]).toBe("cycle_count_count");
        expect(locationRoutes[0][1].inventoryId).toBe(121);
        expect(locationRoutes[0][1].expectedLocationId).toBe(8);
    });

    test("confirmStartUsesValidationDetailForScannerFeedback", async () => {
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

        expect(feedback).toEqual({message, notify: false});
        expect(location.state.confirmed).toBe(false);
        expect(location.state.startError.type).toBe("blocked");
        expect(Boolean(location.state.startError.title)).toBe(true);
        expect(Boolean(location.state.startError.message)).toBe(true);
        expect(location.state.startError.location).toBe("WH/Stock");
        expect(location.state.startError.blockers).toBe(
            "INV/DEMO Ejecución — Pasillo D"
        );
        expect(Boolean(location.state.startError.action)).toBe(true);
        expect(location.state.starting).toBe(false);
    });

    test("testApplyPayloadContainsEveryExplicitLine", async () => {
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
        expect(payload.lines.map((line) => line.quant_id)).toEqual([1, 2]);
        expect(payload.confirmZero).toBe(false);
    });

    test("testScreensUseBarcodeRegistriesAndFeedback", () => {
        for (const route of [
            "cycle_count_list",
            "cycle_count_location",
            "cycle_count_count",
            "cycle_count_done",
        ]) {
            expect(barcodeScreens.contains(route)).toBe(true);
        }
        expect(
            CycleCountListScreen.prototype.setup
                .toString()
                .includes("barcodeScannerFeedback")
        ).toBe(true);
        expect(
            CycleCountLocationScreen.prototype.setup
                .toString()
                .includes("barcodeScannerFeedback")
        ).toBe(true);
        expect(
            CycleCountCountScreen.prototype.setup
                .toString()
                .includes("barcodeScannerFeedback")
        ).toBe(true);
    });

    test("testMobileCountFlowUsesScannerHandler", () => {
        expect(
            CycleCountCountScreen.prototype.setup
                .toString()
                .includes("useBarcodeHandler")
        ).toBe(true);
    });

    test("testCancelSkipConfirmationStaysOnGate", () => {
        const location = screen(CycleCountLocationScreen);
        location.state = {count, confirmed: true};
        let confirmation = null;
        location.dialog = {add: (_dialog, options) => (confirmation = options)};
        let navigated = false;
        location.goToCount = () => (navigated = true);
        location.skipLocation();
        expect(typeof confirmation.confirm).toBe("function");
        expect(navigated).toBe(false);
    });

    test("testNonMatchingLocationScanRejectedWithExplicitSkipConfirmation", async () => {
        const location = screen(CycleCountLocationScreen);
        location.state = {count, confirmed: true};
        const signals = [];
        location.feedback = {warning: (signal) => signals.push(signal)};
        let navigated = false;
        location.goToCount = () => (navigated = true);
        location.inventory = {
            searchRead: async () => [{id: 99, display_name: "WH/Other"}],
            call: async () => {
                throw new Error("Wrong location");
            },
        };
        await location.onBarcodeScanned("WH/OTHER", {value: "WH/OTHER"});
        expect(signals[0].message).toBe("Wrong location");
        expect(navigated).toBe(false);
    });

    test("testFailurePreservesScreenState", async () => {
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
        const line = {quant_id: 2, counted: 7, theoretical_qty: 5, tracking: "none"};
        const signals = [];
        countScreen.state = {lines: [line], applying: false};
        countScreen.feedback = {error: (signal) => signals.push(signal)};
        countScreen.inventory = {
            call: async () => {
                throw new Error("Server unavailable");
            },
        };
        await countScreen.callApply([line], false);
        expect(countScreen.state.lines).toEqual([line]);
        expect(countScreen.state.applying).toBe(false);
        expect(signals[0].message).toBe("Server unavailable");
    });

    test("testDoneReturnPreservesShowAllMode", () => {
        const countScreen = screen(CycleCountCountScreen, {showAll: true});
        const navigations = [];
        countScreen.store = {navigate: (...args) => navigations.push(args)};
        countScreen.openDone({
            cycle_count_id: count.id,
            inventory_id: 12,
            applied_count: 1,
            accuracy: 100,
        });
        expect(navigations[0][1].showAll).toBe(true);
    });

    test("done screen returns to the cycle-count list from header and action", async () => {
        translatedTerms[translationLoaded] = true;
        const navigations = [];
        await mountWithCleanup(CycleCountDoneScreen, {
            env: {
                bus: new EventBus(),
                services: {
                    barcodeStore: {
                        navigate: (...args) => navigations.push(args),
                    },
                },
            },
            noMainContainer: true,
            props: {
                params: {
                    cycleCount: count,
                    appliedCount: 3,
                    accuracy: 96,
                    showAll: true,
                },
            },
        });

        expect(document.querySelector(".ilx-cycle-count-done__header").textContent).toInclude(
            "Cycle Count"
        );
        expect(document.querySelector(".ilx-cycle-count-done__summary").textContent).toInclude(
            "Cycle count complete"
        );
        expect(document.querySelector(".ilx-cycle-count-done__results").textContent).toInclude(
            "3"
        );
        expect(document.querySelector(".ilx-cycle-count-done__results").textContent).toInclude(
            "96"
        );
        expect(
            document.querySelectorAll(".ilx-cycle-count-done__result strong")[1].textContent
        ).toBe("96%");

        document.querySelector(".ilx-cycle-count-done__back").click();
        document.querySelector(".ilx-cycle-count-done__return").click();
        expect(navigations).toEqual([
            ["cycle_count_list", {showAll: true}, {clearHistory: true}],
            ["cycle_count_list", {showAll: true}, {clearHistory: true}],
        ]);
    });

    test("testNoBarcodeScannerCoreModification", () => {
        expect(barcodeScreens.get("cycle_count_count").component).toBe(
            CycleCountCountScreen
        );
        expect(barcodeScreens.get("cycle_count_location").component).toBe(
            CycleCountLocationScreen
        );
        expect(barcodeMenuTiles.contains("cycle_count")).toBe(true);
    });

    test("cycle count card hierarchy and keyboard activation", async () => {
        translatedTerms[translationLoaded] = true;
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
        let component;
        try {
            component = await mountWithCleanup(CycleCountListScreen, {
                env: {
                    bus: new EventBus(),
                    debug: false,
                    isSmall: false,
                    services: {
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
                    },
                },
                noMainContainer: true,
                props: {params: {}},
            });
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
        await animationFrame();

        const card = document.querySelector(".ilx-queue-card");
        expect(card.getAttribute("role")).toBe("button");
        expect(card.getAttribute("tabindex")).toBe("0");
        const heading = card.querySelector(".ilx-queue-card__top");
        expect(heading.querySelector(".ilx-cycle-count-card__name").textContent).toBe(
            "March inventory count"
        );
        expect(heading.textContent).toInclude("Planned");
        expect(heading.querySelector(".ilx-cycle-count-card__location")).toBe(null);

        const location = card.querySelector(".ilx-cycle-count-card__location");
        expect(location.querySelector(".fa-map-marker")).not.toBe(null);
        expect(
            location.querySelector(".ilx-cycle-count-card__location-name").textContent
        ).toBe("WH/Stock/Shelving Zone A");
        const metadata = card.querySelectorAll(".ilx-cycle-count-card__meta");
        expect(metadata).toHaveLength(2);
        expect(
            card.querySelector(".ilx-cycle-count-card__assignee").textContent.trim()
        ).toBe("Assignee: Jordan Lee");
        const deadline = card.querySelector(".ilx-cycle-count-card__deadline");
        expect(deadline.textContent.trim()).toBe("Deadline: Overdue");
        expect(deadline.classList.contains("ilx-cycle-count-overdue")).toBe(true);
        expect(getComputedStyle(deadline).backgroundColor).toBe("rgb(253, 236, 234)");
        expect(getComputedStyle(deadline).color).toBe("rgb(186, 26, 26)");
        expect(deadline.textContent.match(/Overdue/g)).toHaveLength(1);
        expect(card.querySelectorAll(".ilx-cycle-count-card__deadline")).toHaveLength(1);

        const enter = new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(enter);
        expect(enter.defaultPrevented).toBe(true);
        expect(navigations).toEqual([
            ["cycle_count_location", {cycleCountId: 84, cycleCount, showAll: false}],
        ]);

        component.openingCount = false;
        const space = new KeyboardEvent("keydown", {
            key: " ",
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(space);
        expect(space.defaultPrevented).toBe(true);
        expect(navigations).toHaveLength(1);

        const spaceUp = new KeyboardEvent("keyup", {
            key: " ",
            bubbles: true,
            cancelable: true,
        });
        card.dispatchEvent(spaceUp);
        expect(spaceUp.defaultPrevented).toBe(true);
        expect(navigations).toHaveLength(2);
        expect(navigations[1]).toEqual(navigations[0]);
    });

    describe("CycleCountCountScreen rendered UX", () => {
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

        async function mountCountScreen({lines = renderedLines, call, searchRead} = {}) {
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
            const env = {
                bus: new EventBus(),
                debug: false,
                isSmall: false,
                services: {
                    barcodeApi,
                    barcodeStore: {navigate() {}, goBack() {}},
                    barcodeScannerFeedback: {
                        success: (signal) => signals.success.push(signal),
                        warning: (signal) => signals.warning.push(signal),
                        error: (signal) => signals.error.push(signal),
                    },
                    barcodeScannerBarcode: {bus: new EventTarget()},
                    dialog: {add() {}},
                },
            };
            const component = await mountWithCleanup(CycleCountCountScreen, {
                env,
                noMainContainer: true,
                props: {
                    params: {cycleCountId: count.id, cycleCount: count, inventoryId: 12},
                },
            });
            return {component, signals, env};
        }

        test("partial save is a separate footer action enabled for dirty lines", async () => {
            const {component} = await mountCountScreen();
            const saveButton = document.querySelector(".ilx-count-save");
            const applyButton = document.querySelector(".ilx-count-apply");

            expect(saveButton).not.toBe(null);
            expect(saveButton.textContent).toInclude("Save Draft");
            expect(saveButton.disabled).toBe(true);
            expect(applyButton).not.toBe(null);
            expect(applyButton.textContent).toInclude("Apply count");
            expect(applyButton.textContent).toInclude("verified");
            const footer = document.querySelector(".ilx-count-footer");
            expect(footer.children[0]).toBe(saveButton);
            expect(footer.children[1]).toBe(applyButton);

            component.setCounted(component.state.lines[0], "0");
            await animationFrame();

            expect(saveButton.disabled).toBe(false);
            expect(applyButton.disabled).toBe(false);

            component.state.saving = true;
            await animationFrame();

            expect(saveButton.disabled).toBe(true);
            expect(applyButton.disabled).toBe(true);
            expect(document.querySelector(".ilx-count-qty input").disabled).toBe(true);
            expect(document.querySelector(".ilx-emp-v2-back-btn").disabled).toBe(true);
        });

        function mockCountScrollViewport(quantId, lineRect, scrollTop = 0) {
            const scrollContainer = document.querySelector(".ilx-count-main");
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

        test("QTS-01: product and lot identity readable per row", async () => {
            await mountCountScreen();
            const cards = document.querySelectorAll(".ilx-count-line");
            expect(cards.length).toBe(3);
            expect(cards[0].textContent).toInclude("Desk Lamp");
            expect(cards[0].querySelector(".ilx-count-line__lot")).toBe(null);
            expect(cards[1].textContent).toInclude("Cable");
            expect(cards[1].querySelector(".ilx-count-line__lot").textContent).toBe(
                "LOT-9"
            );
            expect(cards[2].textContent).toInclude("Cable");
            expect(cards[2].querySelector(".ilx-count-line__lot").textContent).toBe(
                "SN-1"
            );
        });

        test("QTS-02: on hand, counted and difference are distinct and labeled", async () => {
            await mountCountScreen();
            const cards = document.querySelectorAll(".ilx-count-line");
            const labels = [...cards[1].querySelectorAll(".ilx-count-qty__label")].map(
                (el) => el.textContent.trim()
            );
            expect(labels).toEqual(["On hand", "Counted"]);
            expect(
                cards[1].querySelector(".ilx-count-difference__label").textContent
            ).toBe("Diff");
            expect(cards[1].querySelector(".ilx-count-qty__value").textContent).toInclude(
                "10"
            );
            expect(cards[1].querySelector('input[type="number"]').value).toBe("12");
            expect(cards[1].querySelector(".ilx-count-diff-chip").textContent.trim()).toBe(
                "+2Units"
            );
            expect(cards[2].querySelector(".ilx-count-diff-chip").textContent.trim()).toBe(
                "-1Units"
            );
            expect(cards[0].querySelector(".ilx-count-diff-chip").textContent.trim()).toBe(
                "—"
            );
        });

        test("QTS-03: loading, error, empty and progress states", async () => {
            const {component} = await mountCountScreen();
            // Populated: X of Y (zero counted counts, null does not) + bar.
            const progress = document.querySelector(".ilx-count-progress");
            expect(progress.textContent).toInclude("2 of 3 counted");
            const bar = document.querySelector('[role="progressbar"]');
            expect(bar.getAttribute("aria-valuenow")).toBe("2");
            expect(bar.getAttribute("aria-valuemax")).toBe("3");

            component.state.loading = true;
            await animationFrame();
            expect(document.querySelector(".ilx-count-state--loading").textContent).toInclude(
                "Loading count lines"
            );

            component.state.loading = false;
            component.state.error = true;
            await animationFrame();
            expect(document.querySelector(".ilx-count-state--error").textContent).toInclude(
                "Unable to load count lines"
            );

            component.state.error = false;
            component.state.lines = [];
            await animationFrame();
            expect(document.querySelector(".ilx-count-state--empty").textContent).toInclude(
                "No stock in this location"
            );
            expect(document.querySelector('[role="progressbar"]')).toBe(null);
        });

        test("QTS-04: accepted scan feedback highlights exact row; rejected warns", async () => {
            const {component, signals} = await mountCountScreen({
                searchRead: async (model) =>
                    model === "product.product"
                        ? [{id: 41, tracking: "lot"}]
                        : [{id: 9, name: "LOT-9", product_id: [41, "Cable"]}],
            });
            await component.onBarcodeScanned("scan", {
                productCodes: ["P41"],
                lot: "LOT-9",
                quantity: 1,
            });
            await animationFrame();
            expect(component.state.lines[1].counted).toBe(13);
            const highlighted = document.querySelector(".ilx-count-line--highlighted");
            expect(highlighted.textContent).toInclude("LOT-9");
            const feedback = document.querySelector(".ilx-count-feedback");
            expect(feedback.className).toInclude("ilx-count-feedback--success");
            expect(feedback.textContent).toInclude("Cable");
            expect(feedback.textContent).toInclude("LOT-9");

            // A rejected scan replaces the banner, clears the highlight and
            // leaves quantities untouched.
            const before = component.state.lines.map((line) => line.counted);
            await component.onBarcodeScanned("scan", {
                productCodes: ["P41"],
                lot: "",
                quantity: 1,
            });
            await animationFrame();
            expect(component.state.lines.map((line) => line.counted)).toEqual(before);
            expect(document.querySelector(".ilx-count-line--highlighted")).toBe(null);
            const feedback2 = document.querySelector(".ilx-count-feedback");
            expect(feedback2.className).toInclude("ilx-count-feedback--warning");
            expect(signals.warning.length).toBeGreaterThan(0);
        });

        test("scan viewport: successful scan minimally scrolls an offscreen line and restores scanner focus", async () => {
            const {component} = await mountCountScreen({
                searchRead: async (model) =>
                    model === "product.product" ? [{id: 40, tracking: "none"}] : [],
            });
            const {scrollCalls} = mockCountScrollViewport(1, {top: 240, bottom: 280}, 25);
            const scannerInput = document.querySelector("#cycle-count-identity");
            scannerInput.focus();

            expect(
                await component.onBarcodeScanned("P40", {productCodes: ["P40"]})
            ).toBe(true);
            await animationFrame();

            expect(component.state.lines[0].counted).toBe(1);
            expect(scrollCalls.length).toBe(1);
            // Align only the clipped bottom edge: 80px is the nearest movement.
            expect(scrollCalls[0].top).toBe(105);
            expect(document.activeElement).toBe(scannerInput);
        });

        test("scan viewport: successful scan scrolls a newly added offscreen line into view", async () => {
            const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
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
                        model === "product.product" ? [{id: 42, tracking: "none"}] : [],
                });
                const scrollContainer = document.querySelector(".ilx-count-main");
                const scrollCalls = [];
                Object.defineProperties(scrollContainer, {
                    clientHeight: {configurable: true, value: 100},
                    clientTop: {configurable: true, value: 0},
                    scrollTop: {configurable: true, writable: true, value: 10},
                });
                Object.defineProperty(scrollContainer, "scrollTo", {
                    configurable: true,
                    value: ({top, behavior}) => {
                        scrollCalls.push({top, behavior});
                        scrollContainer.scrollTop = top;
                    },
                });
                const scannerInput = document.querySelector("#cycle-count-identity");
                scannerInput.focus();

                expect(
                    await component.onBarcodeScanned("P42", {productCodes: ["P42"]})
                ).toBe(true);
                await animationFrame();

                expect(
                    document.querySelector('[data-quant-id="44"]')
                ).not.toBe(null);
                expect(component.state.lines.at(-1).counted).toBe(1);
                expect(scrollCalls.length).toBe(1);
                expect(scrollCalls[0].top).toBe(100);
                expect(document.activeElement).toBe(scannerInput);
            } finally {
                Element.prototype.getBoundingClientRect = originalGetBoundingClientRect;
            }
        });

        test("scan viewport: successful scan leaves the viewport unchanged when its line is visible", async () => {
            const {component} = await mountCountScreen({
                searchRead: async (model) =>
                    model === "product.product" ? [{id: 40, tracking: "none"}] : [],
            });
            const {scrollCalls, scrollContainer} = mockCountScrollViewport(
                1,
                {top: 125, bottom: 175},
                42
            );
            const scannerInput = document.querySelector("#cycle-count-identity");
            scannerInput.focus();

            expect(
                await component.onBarcodeScanned("P40", {productCodes: ["P40"]})
            ).toBe(true);
            await animationFrame();

            expect(scrollCalls).toEqual([]);
            expect(scrollContainer.scrollTop).toBe(42);
            expect(document.activeElement).toBe(scannerInput);
        });

        test("scan viewport: unresolved E-COM06 scan does not scroll and restores scanner focus", async () => {
            const {component} = await mountCountScreen({searchRead: async () => []});
            const {scrollCalls, scrollContainer} = mockCountScrollViewport(
                1,
                {top: 240, bottom: 280},
                25
            );
            const scannerInput = document.querySelector("#cycle-count-identity");
            scannerInput.focus();

            expect(
                await component.onBarcodeScanned("E-COM06", {
                    productCodes: ["E-COM06"],
                    value: "E-COM06",
                })
            ).toBe(false);
            await animationFrame();

            expect(scrollCalls).toEqual([]);
            expect(scrollContainer.scrollTop).toBe(25);
            expect(document.activeElement).toBe(scannerInput);
        });

        test("QTS-04b: serial over-one scan stays rejected without success highlight", async () => {
            const {component, signals} = await mountCountScreen({
                searchRead: async (model) =>
                    model === "product.product"
                        ? [{id: 41, tracking: "serial"}]
                        : [{id: 10, name: "SN-1", product_id: [41, "Cable"]}],
            });
            await component.onBarcodeScanned("scan", {
                productCodes: ["P41"],
                lot: "SN-1",
                quantity: 2,
            });
            await animationFrame();
            // setCounted rejects serial > 1: no highlight, no success feedback.
            expect(document.querySelector(".ilx-count-line--highlighted")).toBe(null);
            const feedback = document.querySelector(".ilx-count-feedback");
            expect(feedback.className).toInclude("ilx-count-feedback--warning");
            expect(signals.warning.at(-1).message).toInclude("serial");
        });

        test("QTS-05: no literal false; valid zero still renders", async () => {
            await mountCountScreen();
            const cards = document.querySelectorAll(".ilx-count-line");
            for (const card of cards) {
                expect(card.textContent).not.toInclude("false");
            }
            const serialCard = cards[2];
            expect(
                serialCard.querySelector('input[type="number"]').value
            ).toBe("0");
        });

        test("QTS-06: actionable controls meet 44px touch target", async () => {
            await mountCountScreen();
            const targets = [
                document.querySelector(".ilx-emp-v2-back-btn"),
                document.querySelector("form .btn.btn-primary"),
                document.querySelector('input[type="number"]'),
                document.querySelector(".ilx-emp-v2-confirm-btn"),
            ];
            for (const el of targets) {
                const style = getComputedStyle(el);
                expect(parseFloat(style.minHeight) >= 44).toBe(true);
            }
        });

        test("QTS-07: rendered quantity buttons use whole steps and keep manual decimals", async () => {
            const {component} = await mountCountScreen({
                lines: [{...renderedLines[0], rounding: 0.01, counted_qty: 2.25}],
            });
            const card = document.querySelector(".ilx-count-line");
            const input = card.querySelector('input[type="number"]');
            expect(input.step).toBe("1");

            card.querySelector('[aria-label^="Increase counted quantity"]').click();
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(3.25);

            const quickButtons = card.querySelectorAll(".ilx-count-quick__button");
            quickButtons[1].click();
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(4.25);
            quickButtons[2].click();
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(9.25);

            input.value = "8.75";
            input.dispatchEvent(new Event("input", {bubbles: true}));
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(8.75);
            card.querySelector('[aria-label^="Decrease counted quantity"]').click();
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(7.75);

            const setToOnHand = quickButtons[0];
            const style = getComputedStyle(setToOnHand);
            expect(style.color).toBe("rgb(255, 255, 255)");
            expect(style.backgroundColor).toBe("rgb(77, 54, 121)");
        });

        test("QTS-08: Set to on-hand is hidden only at exact equality", async () => {
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
            const [pendingCard, roundedCard] = document.querySelectorAll(
                ".ilx-count-line"
            );
            const setToOnHand = (card) =>
                card.querySelector(".ilx-count-quick__button--match");
            const quickButton = (label) =>
                [...pendingCard.querySelectorAll(".ilx-count-quick__button")].find(
                    (button) => button.textContent.trim() === label
                );

            // Both pending counts and exact-unequal counts can still be set.
            expect(setToOnHand(pendingCard)).not.toBe(null);
            expect(component.difference(component.state.lines[1])).toBe(0);
            expect(setToOnHand(roundedCard)).not.toBe(null);
            setToOnHand(pendingCard).click();
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(5);
            expect(setToOnHand(pendingCard)).toBe(null);

            // Keep Quick count and its increment controls when Set is hidden.
            expect(pendingCard.querySelector(".ilx-count-quick")).not.toBe(null);
            expect(quickButton("+1")).not.toBe(undefined);
            expect(quickButton("+5")).not.toBe(undefined);

            // Moving away from on-hand restores the action.
            quickButton("+1").click();
            await animationFrame();
            expect(component.state.lines[0].counted).toBe(6);
            expect(setToOnHand(pendingCard)).not.toBe(null);
        });

        test("quantity controls use whole steps and preserve manual decimals", () => {
            const countScreen = screen(CycleCountCountScreen);
            countScreen.state = {lines: [], highlightedQuantId: null};
            const decimalLine = {
                quant_id: 4,
                counted: 16.25,
                theoretical_qty: 16,
                rounding: 0.01,
                tracking: "none",
            };
            expect(countScreen.quantityStep(decimalLine)).toBe(1);
            countScreen.adjustCounted(decimalLine, countScreen.quantityStep(decimalLine));
            expect(decimalLine.counted).toBe(17.25);
            countScreen.adjustCounted(decimalLine, -countScreen.quantityStep(decimalLine));
            expect(decimalLine.counted).toBe(16.25);
            countScreen.adjustCounted(decimalLine, 5);
            expect(decimalLine.counted).toBe(21.25);

            const serialLine = {
                quant_id: 5,
                counted: 0,
                theoretical_qty: 1,
                rounding: 1,
                tracking: "serial",
            };
            countScreen.adjustCounted(serialLine, 1);
            countScreen.adjustCounted(serialLine, 1);
            expect(serialLine.counted).toBe(1);

            // Manual precision remains accepted; the explicit buttons still
            // move this manually entered decimal count by one whole unit.
            countScreen.setCounted(decimalLine, "16.75");
            expect(decimalLine.counted).toBe(16.75);
            countScreen.adjustCounted(decimalLine, -1);
            expect(decimalLine.counted).toBe(15.75);

            countScreen.state.lines = [
                decimalLine,
                serialLine,
                {...decimalLine, quant_id: 6, counted: null},
            ];
            expect(countScreen.progressPercent).toBe(67);
        });
    });
});
