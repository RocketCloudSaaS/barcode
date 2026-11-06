/** @odoo-module **/

import {BarcodeScannerFeedbackService} from "@barcode_scanner/js/services/feedback_service.esm";

function makeFeedback(notifications) {
    const feedback = new BarcodeScannerFeedbackService({
        add: (...args) => notifications.push(args),
    });
    feedback.enabled = {audio: false, vibration: false, flash: false};
    return feedback;
}

QUnit.module("BarcodeScanner");

QUnit.test("error feedback uses the danger notification type", (assert) => {
    const notifications = [];
    const feedback = makeFeedback(notifications);
    const message = "Unable to apply the cycle count";

    feedback.error({message, notify: true});

    assert.deepEqual(notifications, [[message, {type: "danger"}]]);
    feedback.destroy();
});

QUnit.test("feedback levels map to valid Odoo notification types", (assert) => {
    const cases = [
        ["success", "success"],
        ["warning", "warning"],
        ["info", "info"],
        ["error", "danger"],
    ];
    for (const [level, type] of cases) {
        const notifications = [];
        const feedback = makeFeedback(notifications);
        feedback[level]({message: level, notify: true});
        assert.deepEqual(notifications, [[level, {type}]]);
        feedback.destroy();
    }
});
