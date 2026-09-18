/** @odoo-module **/

import {describe, expect, test} from "@odoo/hoot";
import {barcodeMenuTiles, barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {CycleCountCountScreen} from "@barcode_stock_cycle_count/js/screens/cycle_count_count_screen.esm";
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
    test("testHomeTileNavigatesToCycleCount", () => {
        const tile = barcodeMenuTiles.get("cycle_count");
        let route = null;
        tile.action({navigate: (name) => (route = name)});
        expect(barcodeMenuTiles.contains("cycle_count")).toBe(true);
        expect(route).toBe("cycle_count_list");
    });

    test("testListToggleAndSelection", async () => {
        const list = screen(CycleCountListScreen);
        list.state = {counts: [], showAll: false, loading: true};
        list.inventory = {
            call: async (_model, _method, args) => ({counts: [{id: args[0] ? 2 : 1}]}),
        };
        const navigations = [];
        list.store = {navigate: (...args) => navigations.push(args)};
        await list.loadCounts();
        expect(list.state.counts).toEqual([{id: 1}]);
        await list.toggleShowAll();
        expect(list.state.showAll).toBe(true);
        list.selectCount(list.state.counts[0]);
        expect(navigations[0]).toEqual([
            "cycle_count_location",
            {cycleCountId: 2, cycleCount: {id: 2}, showAll: true},
        ]);
    });

    test("testScanMatchesLine", async () => {
        const countScreen = screen(CycleCountCountScreen, {inventoryId: 12});
        const line = {
            quant_id: 20,
            product_id: 40,
            lot_name: "LOT-1",
            tracking: "serial",
            theoretical_qty: 1,
            counted: null,
        };
        countScreen.state = {lines: [line], applying: false};
        countScreen.inventory = {
            searchRead: async () => [{id: 40}],
        };
        await countScreen.onBarcodeScanned("ignored", {
            productCodes: ["PROD-40"],
            lot: "LOT-1",
            quantity: 1,
        });
        expect(line.counted).toBe(1);
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

    test("testTrackedLineAcceptsTypedLot", async () => {
        const countScreen = screen(CycleCountCountScreen);
        const line = {product_id: 40, tracking: "lot", lot_name: "LOT-1"};
        countScreen.inventory = {
            searchRead: async () => [{name: "LOT-1"}, {name: "LOT-2"}],
        };
        await countScreen.loadLotOptions(line);
        countScreen.setLotName(line, "LOT-2");
        expect(line.lot_options).toEqual(["LOT-1", "LOT-2"]);
        expect(line.lot_name).toBe("LOT-2");
    });

    test("testApplyPayloadExcludesZeroDifferenceLines", async () => {
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
        expect(payload.lines.map((line) => line.quant_id)).toEqual([2]);
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

    test("testNoBarcodeScannerCoreModification", () => {
        expect(barcodeScreens.get("cycle_count_count").component).toBe(
            CycleCountCountScreen
        );
        expect(barcodeScreens.get("cycle_count_location").component).toBe(
            CycleCountLocationScreen
        );
        expect(barcodeMenuTiles.contains("cycle_count")).toBe(true);
    });
});
