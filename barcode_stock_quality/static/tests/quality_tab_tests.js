/** @odoo-module **/

// Registers the Quality tab on the reception screen: the last test checks it.
import "@barcode_stock_quality/js/patches/picking_screen_patch.esm";
import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {QualityTab} from "@barcode_stock_quality/js/components/quality_tab.esm";

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
 * Assert that `actual` has, at least, every property of `expected`.
 *
 * @param {Object} assert the QUnit assert object
 * @param {Object} actual what to inspect
 * @param {Object} expected the properties to find, with their values
 * @param {String} message what the assertion is about
 */
function assertMatch(assert, actual, expected, message) {
    for (const [key, value] of Object.entries(expected)) {
        assert.deepEqual(actual[key], value, `${message}: ${key}`);
    }
}

/**
 * A Quality tab without mounting it. What it tells the operator lands in
 * `notes` and what it asks the server in `calls`, answered with `answer` (or
 * failing when it is an Error). Its answers live in `answers`, as the
 * reception screen keeps them.
 *
 * @param {Object} [options] the inspections shown, the server's answer and
 *   the answers kept so far
 * @returns {Object} the tab and what its fakes recorded
 */
function qualityTab({inspections = [inspection()], answer = {}, answers = {}} = {}) {
    const tab = Object.create(QualityTab.prototype);
    const notes = [];
    const calls = [];
    tab.props = {pickingId: 5, answers};
    tab.answers = answers;
    // The 17.0 user is a service: the tab is given a fake one, not mounted.
    tab.user = {hasGroup: async () => true};
    tab.state = {
        inspections,
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

QUnit.module("BarcodeStockQuality");

QUnit.test(
    "only Quality Control users get the reception's inspections",
    async (assert) => {
        const {tab, calls} = qualityTab({inspections: []});
        tab.user = {hasGroup: async () => false};
        await tab.loadTab();
        assertMatch(assert, tab.state, {canInspect: false, loading: false}, "state");
        assert.deepEqual(calls, []);
    }
);

QUnit.test("a Quality Control user gets them", async (assert) => {
    const {tab, calls} = qualityTab({
        inspections: [],
        answer: {inspections: [inspection()]},
    });
    tab.user = {hasGroup: async () => true};
    await tab.loadTab();
    assert.deepEqual(calls, [
        {
            model: "stock.picking",
            method: "action_barcode_scanner_quality_inspections",
            args: [5],
        },
    ]);
    assert.strictEqual(tab.state.inspections.length, 1);
    assert.strictEqual(tab.state.loading, false);
});

QUnit.test("a failed load leaves the tab usable", async (assert) => {
    const {tab, notes} = qualityTab({answer: new Error("offline")});
    await tab.loadInspections();
    assert.strictEqual(tab.state.loading, false);
    // The API wrapper tells the operator: nothing is said twice.
    assert.deepEqual(notes, []);
});

QUnit.test(
    "answers are kept per inspection; a blank measure is no answer",
    (assert) => {
        const {tab} = qualityTab();
        const current = tab.state.inspections[0];
        assert.strictEqual(tab.allAnswered(current), false);
        tab.setQualitative(current, QUALITATIVE, 11);
        assert.strictEqual(tab.isChosen(current, QUALITATIVE, 11), true);
        assert.strictEqual(tab.isChosen(current, QUALITATIVE, 12), false);
        tab.onQuantitative(current, QUANTITATIVE, {target: {value: " 3.5 "}});
        assert.strictEqual(tab.allAnswered(current), true);
        assert.deepEqual(tab.answersFor(current)[2], {
            line_id: 2,
            quantitative_value: 3.5,
        });
        for (const value of ["", "warm", "Infinity"]) {
            tab.onQuantitative(current, QUANTITATIVE, {target: {value}});
            assert.strictEqual(tab.answersFor(current)[2], undefined);
            assert.strictEqual(tab.allAnswered(current), false);
        }
    }
);

QUnit.test("confirming sends the answers and says how it went", async (assert) => {
    const passed = inspection({state: "success", success: true});
    const {tab, calls, notes} = qualityTab({answer: passed});
    tab.state.inspections[0].photo_count = 2;
    const current = tab.state.inspections[0];
    tab.setQualitative(current, QUALITATIVE, 11);
    tab.onQuantitative(current, QUANTITATIVE, {target: {value: "2"}});
    await tab.submit(current);
    assert.deepEqual(calls[0], {
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
    assertMatch(
        assert,
        tab.state.inspections[0],
        {state: "success", photo_count: 2},
        "updated inspection"
    );
    assert.deepEqual(notes, [{message: "Inspection QC/0007 passed.", type: "success"}]);
    assert.strictEqual(tab.state.busyId, null);
    // Confirmed, its answers are kept no more.
    assert.strictEqual(tab.answers[7], undefined);
});

QUnit.test("a failed inspection is said so", async (assert) => {
    const {tab, notes} = qualityTab({
        answer: inspection({state: "waiting", success: false}),
    });
    const current = tab.state.inspections[0];
    tab.setQualitative(current, QUALITATIVE, 12);
    tab.onQuantitative(current, QUANTITATIVE, {target: {value: "9"}});
    await tab.submit(current);
    assert.deepEqual(notes, [{message: "Inspection QC/0007 failed.", type: "warning"}]);
});

QUnit.test("nothing is sent before every answer, or while busy", async (assert) => {
    const {tab, calls} = qualityTab();
    const current = tab.state.inspections[0];
    await tab.submit(current);
    tab.setQualitative(current, QUALITATIVE, 11);
    tab.onQuantitative(current, QUANTITATIVE, {target: {value: "1"}});
    tab.state.busyId = 9;
    await tab.submit(current);
    await tab.reset(current);
    assert.deepEqual(calls, []);
});

QUnit.test("a refused confirmation leaves the tab usable", async (assert) => {
    const {tab, notes} = qualityTab({answer: new Error("refused")});
    const current = tab.state.inspections[0];
    tab.setQualitative(current, QUALITATIVE, 11);
    tab.onQuantitative(current, QUANTITATIVE, {target: {value: "1"}});
    await tab.submit(current);
    await tab.reset(current);
    assert.strictEqual(tab.state.busyId, null);
    assert.deepEqual(notes, []);
});

QUnit.test("back to draft shows the answers given, to correct them", async (assert) => {
    const reopened = inspection({
        lines: [
            {...QUALITATIVE, qualitative_value_id: 12},
            {...QUANTITATIVE, quantitative_value: 7.5},
        ],
    });
    const {tab, calls, notes} = qualityTab({answer: reopened});
    const current = tab.state.inspections[0];
    current.state = "success";
    current.can_reset = true;
    assert.strictEqual(tab.canReset(current), true);
    assert.strictEqual(tab.isEditable(current), false);
    // Which ones may be reopened is the server's call: a rejection by a
    // supervisor is shown, not reopened.
    const rejected = inspection({state: "failed", can_reset: false});
    assert.strictEqual(tab.isConfirmed(rejected), true);
    assert.strictEqual(tab.canReset(rejected), false);
    await tab.reset(current);
    assert.strictEqual(calls[0].method, "action_barcode_scanner_reset");
    const shown = tab.state.inspections[0];
    assert.strictEqual(shown.state, "ready");
    assert.strictEqual(tab.isChosen(shown, QUALITATIVE, 12), true);
    assert.strictEqual(tab.measureOf(shown, QUANTITATIVE), 7.5);
    assert.strictEqual(tab.allAnswered(shown), true);
    assert.deepEqual(notes, [
        {message: "Inspection QC/0007 is back to draft.", type: "info"},
    ]);
});

QUnit.test("the answers outlive the tab: leaving it loses none", (assert) => {
    const kept = {};
    const first = qualityTab({answers: kept}).tab;
    const current = first.state.inspections[0];
    first.setQualitative(current, QUALITATIVE, 11);
    first.onQuantitative(current, QUANTITATIVE, {target: {value: "4"}});
    // The operator looks at another tab, then comes back to a new one.
    const second = qualityTab({answers: kept}).tab;
    const again = second.state.inspections[0];
    assert.strictEqual(second.isChosen(again, QUALITATIVE, 11), true);
    assert.strictEqual(second.measureOf(again, QUANTITATIVE), 4);
    assert.strictEqual(second.measureOf(again, {...QUANTITATIVE, id: 99}), "");
});

QUnit.test("a confirmed answer reads with its unit", (assert) => {
    const {tab} = qualityTab();
    assert.strictEqual(tab.answerLabel(QUALITATIVE), "Yes");
    assert.strictEqual(tab.answerLabel(QUANTITATIVE), "3.5 °C");
    assert.strictEqual(tab.answerLabel({...QUANTITATIVE, uom_name: ""}), "3.5");
});

QUnit.test("a photo is read, sent and counted", async (assert) => {
    const {tab, calls, notes} = qualityTab({answer: {photo_count: 1}});
    const current = tab.state.inspections[0];
    tab.readPhoto = async () => ({name: "box.jpg", datas: "QUJD"});
    const target = {files: [{name: "box.png"}], value: "C:\\box.png"};
    await tab.onPhotoSelected(current, {target});
    assert.strictEqual(target.value, "");
    assert.deepEqual(calls[0], {
        model: "qc.inspection",
        method: "action_barcode_scanner_attach_photo",
        args: [7, "box.jpg", "QUJD"],
    });
    assert.strictEqual(current.photo_count, 1);
    assert.deepEqual(notes, [{message: "Photo attached.", type: "success"}]);
    // No file chosen: nothing happens.
    await tab.onPhotoSelected(current, {target: {files: [], value: ""}});
    assert.strictEqual(calls.length, 1);
});

QUnit.test("a photo that cannot be read is not sent", async (assert) => {
    const {tab, calls, notes} = qualityTab();
    tab.readPhoto = async () => {
        throw new Error("unreadable");
    };
    await tab.onPhotoSelected(tab.state.inspections[0], {
        target: {files: [{name: "box.png"}], value: ""},
    });
    assert.deepEqual(calls, []);
    assert.deepEqual(notes, [
        {message: "The photo could not be read.", type: "danger"},
    ]);
    assert.strictEqual(tab.state.busyId, null);
});

QUnit.test("a refused photo leaves the tab usable", async (assert) => {
    const {tab, notes} = qualityTab({answer: new Error("refused")});
    tab.readPhoto = async () => ({name: "box.jpg", datas: "QUJD"});
    await tab.onPhotoSelected(tab.state.inspections[0], {
        target: {files: [{name: "box.png"}], value: ""},
    });
    assert.strictEqual(tab.state.busyId, null);
    assert.deepEqual(notes, []);
});

QUnit.test("a file that is not an image is sent as it is", async (assert) => {
    const {tab} = qualityTab();
    const file = new File(["hello"], "notes.txt", {type: "text/plain"});
    assert.deepEqual(await tab.readPhoto(file), {
        name: "notes.txt",
        datas: "aGVsbG8=",
    });
});

QUnit.test("the reception screen has the Quality tab", (assert) => {
    assert.strictEqual(PickingScreen.components.QualityTab, QualityTab);
    // 17.0 has no `getTemplate` (`@web/core/templates` is 18.0-only), so the
    // rendered template cannot be read back from a QUnit test: the component
    // registration is what proves the tab is wired in.
});
