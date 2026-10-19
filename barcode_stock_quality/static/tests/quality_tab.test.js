import {beforeEach, describe, expect, test} from "@odoo/hoot";
import {patchTranslations, patchWithCleanup} from "@web/../tests/web_test_helpers";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {QualityTab} from "@barcode_stock_quality/js/components/quality_tab.esm";
import {getTemplate} from "@web/core/templates";
import {user} from "@web/core/user";

const QUALITATIVE = {
    id: 1,
    name: "Packaging intact",
    question_type: "qualitative",
    qualitative_value_name: "Yes",
    possible_values: [
        {id: 11, name: "Yes", ok: true},
        {id: 12, name: "No", ok: false},
    ],
};
const QUANTITATIVE = {
    id: 2,
    name: "Temperature",
    question_type: "quantitative",
    quantitative_value: 3.5,
    uom_name: "°C",
};

function inspection(values = {}) {
    return {
        inspection_id: 7,
        inspection_name: "QC/0007",
        test_name: "Reception check",
        state: "ready",
        photo_count: 0,
        lines: [QUALITATIVE, QUANTITATIVE],
        ...values,
    };
}

/**
 * A Quality tab without mounting it. What it tells the operator lands in
 * `notes` and what it asks the server in `calls`, answered with `answer` (or
 * failing when it is an Error).
 *
 * @param {Object} [options] the inspections shown and the server's answer
 * @returns {Object} the tab and what its fakes recorded
 */
function qualityTab({inspections = [inspection()], answer = {}} = {}) {
    const tab = Object.create(QualityTab.prototype);
    const notes = [];
    const calls = [];
    tab.props = {pickingId: 5};
    tab.state = {
        inspections,
        answers: {},
        loading: false,
        busyId: null,
        canInspect: true,
    };
    tab.inventory = {
        notify: (message, options) =>
            notes.push({message: String(message), ...options}),
        call: async (model, method, args) => {
            calls.push({model, method, args});
            if (answer instanceof Error) {
                throw answer;
            }
            return answer;
        },
    };
    return {tab, notes, calls};
}

describe("BarcodeStockQuality", () => {
    beforeEach(() => patchTranslations());

    test("only Quality Control users get the reception's inspections", async () => {
        patchWithCleanup(user, {hasGroup: async () => false});
        const {tab, calls} = qualityTab({inspections: []});
        await tab.loadTab();
        expect(tab.state).toMatchObject({canInspect: false, loading: false});
        expect(calls).toEqual([]);
    });

    test("a Quality Control user gets them", async () => {
        patchWithCleanup(user, {hasGroup: async () => true});
        const {tab, calls} = qualityTab({
            inspections: [],
            answer: {inspections: [inspection()]},
        });
        await tab.loadTab();
        expect(calls).toEqual([
            {
                model: "stock.picking",
                method: "action_barcode_scanner_quality_inspections",
                args: [5],
            },
        ]);
        expect(tab.state.inspections.length).toBe(1);
        expect(tab.state.loading).toBe(false);
    });

    test("a failed load leaves the tab usable", async () => {
        const {tab, notes} = qualityTab({answer: new Error("offline")});
        await tab.loadInspections();
        expect(tab.state.loading).toBe(false);
        // The API wrapper tells the operator: nothing is said twice.
        expect(notes).toEqual([]);
    });

    test("answers are kept per inspection; a blank measure is no answer", () => {
        const {tab} = qualityTab();
        const current = tab.state.inspections[0];
        expect(tab.allAnswered(current)).toBe(false);
        tab.setQualitative(current, QUALITATIVE, 11);
        expect(tab.isChosen(current, QUALITATIVE, 11)).toBe(true);
        expect(tab.isChosen(current, QUALITATIVE, 12)).toBe(false);
        tab.onQuantitative(current, QUANTITATIVE, {target: {value: " 3.5 "}});
        expect(tab.allAnswered(current)).toBe(true);
        expect(tab.answersFor(current)[2]).toEqual({
            line_id: 2,
            quantitative_value: 3.5,
        });
        for (const value of ["", "warm", "Infinity"]) {
            tab.onQuantitative(current, QUANTITATIVE, {target: {value}});
            expect(tab.answersFor(current)[2]).toBe(undefined);
            expect(tab.allAnswered(current)).toBe(false);
        }
    });

    test("confirming sends the answers and says how it went", async () => {
        const passed = inspection({state: "success", success: true});
        const {tab, calls, notes} = qualityTab({answer: passed});
        tab.state.inspections[0].photo_count = 2;
        const current = tab.state.inspections[0];
        tab.setQualitative(current, QUALITATIVE, 11);
        tab.onQuantitative(current, QUANTITATIVE, {target: {value: "2"}});
        await tab.submit(current);
        expect(calls[0]).toEqual({
            model: "qc.inspection",
            method: "action_barcode_scanner_submit",
            args: [
                7,
                [
                    {line_id: 1, qualitative_value_id: 11},
                    {line_id: 2, quantitative_value: 2},
                ],
            ],
        });
        // The inspection is shown as it now stands, its photos still counted.
        expect(tab.state.inspections[0]).toMatchObject({
            state: "success",
            photo_count: 2,
        });
        expect(notes).toEqual([
            {message: "Inspection QC/0007 passed.", type: "success"},
        ]);
        expect(tab.state.busyId).toBe(null);
    });

    test("a failed inspection is said so", async () => {
        const {tab, notes} = qualityTab({
            answer: inspection({state: "waiting", success: false}),
        });
        const current = tab.state.inspections[0];
        tab.setQualitative(current, QUALITATIVE, 12);
        tab.onQuantitative(current, QUANTITATIVE, {target: {value: "9"}});
        await tab.submit(current);
        expect(notes).toEqual([
            {message: "Inspection QC/0007 failed.", type: "warning"},
        ]);
    });

    test("nothing is sent before every answer, or while busy", async () => {
        const {tab, calls} = qualityTab();
        const current = tab.state.inspections[0];
        await tab.submit(current);
        tab.setQualitative(current, QUALITATIVE, 11);
        tab.onQuantitative(current, QUANTITATIVE, {target: {value: "1"}});
        tab.state.busyId = 9;
        await tab.submit(current);
        await tab.reset(current);
        expect(calls).toEqual([]);
    });

    test("a refused confirmation leaves the tab usable", async () => {
        const {tab, notes} = qualityTab({answer: new Error("refused")});
        const current = tab.state.inspections[0];
        tab.setQualitative(current, QUALITATIVE, 11);
        tab.onQuantitative(current, QUANTITATIVE, {target: {value: "1"}});
        await tab.submit(current);
        await tab.reset(current);
        expect(tab.state.busyId).toBe(null);
        expect(notes).toEqual([]);
    });

    test("back to draft forgets the answers given", async () => {
        const {tab, calls, notes} = qualityTab({answer: inspection()});
        const current = tab.state.inspections[0];
        current.state = "success";
        tab.setQualitative(current, QUALITATIVE, 11);
        expect(tab.canReset(current)).toBe(true);
        expect(tab.isEditable(current)).toBe(false);
        // A rejection by a supervisor is shown, not reopened.
        const rejected = inspection({state: "failed"});
        expect(tab.isConfirmed(rejected)).toBe(true);
        expect(tab.canReset(rejected)).toBe(false);
        await tab.reset(current);
        expect(calls[0].method).toBe("action_barcode_scanner_reset");
        expect(tab.state.answers[7]).toBe(undefined);
        expect(tab.state.inspections[0].state).toBe("ready");
        expect(notes).toEqual([
            {message: "Inspection QC/0007 is back to draft.", type: "info"},
        ]);
    });

    test("a confirmed answer reads with its unit", () => {
        const {tab} = qualityTab();
        expect(tab.answerLabel(QUALITATIVE)).toBe("Yes");
        expect(tab.answerLabel(QUANTITATIVE)).toBe("3.5 °C");
        expect(tab.answerLabel({...QUANTITATIVE, uom_name: ""})).toBe("3.5");
    });

    test("a photo is read, sent and counted", async () => {
        const {tab, calls, notes} = qualityTab({answer: {photo_count: 1}});
        const current = tab.state.inspections[0];
        tab.readPhoto = async () => ({name: "box.jpg", datas: "QUJD"});
        const target = {files: [{name: "box.png"}], value: "C:\\box.png"};
        await tab.onPhotoSelected(current, {target});
        expect(target.value).toBe("");
        expect(calls[0]).toEqual({
            model: "qc.inspection",
            method: "action_barcode_scanner_attach_photo",
            args: [7, "box.jpg", "QUJD"],
        });
        expect(current.photo_count).toBe(1);
        expect(notes).toEqual([{message: "Photo attached.", type: "success"}]);
        // No file chosen: nothing happens.
        await tab.onPhotoSelected(current, {target: {files: [], value: ""}});
        expect(calls.length).toBe(1);
    });

    test("a photo that cannot be read is not sent", async () => {
        const {tab, calls, notes} = qualityTab();
        tab.readPhoto = async () => {
            throw new Error("unreadable");
        };
        await tab.onPhotoSelected(tab.state.inspections[0], {
            target: {files: [{name: "box.png"}], value: ""},
        });
        expect(calls).toEqual([]);
        expect(notes).toEqual([
            {message: "The photo could not be read.", type: "danger"},
        ]);
        expect(tab.state.busyId).toBe(null);
    });

    test("a refused photo leaves the tab usable", async () => {
        const {tab, notes} = qualityTab({answer: new Error("refused")});
        tab.readPhoto = async () => ({name: "box.jpg", datas: "QUJD"});
        await tab.onPhotoSelected(tab.state.inspections[0], {
            target: {files: [{name: "box.png"}], value: ""},
        });
        expect(tab.state.busyId).toBe(null);
        expect(notes).toEqual([]);
    });

    test("a file that is not an image is sent as it is", async () => {
        const {tab} = qualityTab();
        const file = new File(["hello"], "notes.txt", {type: "text/plain"});
        expect(await tab.readPhoto(file)).toEqual({
            name: "notes.txt",
            datas: "aGVsbG8=",
        });
    });

    test("the reception screen has the Quality tab", () => {
        expect(PickingScreen.components.QualityTab).toBe(QualityTab);
        const html = getTemplate("barcode_scanner.PickingScreen").outerHTML;
        expect(html).toInclude("QualityTab");
        expect(html).toInclude("this.setTab('quality')");
        expect(getTemplate("barcode_stock_quality.QualityTab").outerHTML).toInclude(
            "state.canInspect"
        );
    });
});
