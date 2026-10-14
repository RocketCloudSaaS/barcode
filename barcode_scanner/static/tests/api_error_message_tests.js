/** @odoo-module **/

import {errorMessage} from "@barcode_scanner/js/api.esm";

QUnit.module("BarcodeScanner");

QUnit.test("shows the server message for user-facing exceptions", (assert) => {
    for (const name of [
        "odoo.exceptions.UserError",
        "odoo.exceptions.ValidationError",
        "odoo.exceptions.AccessError",
        "odoo.exceptions.MissingError",
    ]) {
        assert.strictEqual(
            errorMessage({data: {name, message: "Not enough stock."}}, "fallback"),
            "Not enough stock."
        );
    }
});

QUnit.test(
    "falls back for internal errors, without leaking the traceback",
    (assert) => {
        assert.strictEqual(
            errorMessage(
                {
                    message: "Odoo Server Error",
                    data: {
                        name: "builtins.ValueError",
                        message: "bad value",
                        debug: "Traceback (most recent call last): ...",
                    },
                },
                "fallback"
            ),
            "fallback"
        );
    }
);

QUnit.test("falls back for AccessDenied, without leaking auth detail", (assert) => {
    assert.strictEqual(
        errorMessage(
            {
                data: {
                    name: "odoo.exceptions.AccessDenied",
                    message: "Session expired",
                },
            },
            "fallback"
        ),
        "fallback"
    );
});

QUnit.test(
    "falls back when the envelope is missing or the message is empty",
    (assert) => {
        assert.strictEqual(errorMessage(null, "fallback"), "fallback");
        assert.strictEqual(errorMessage({}, "fallback"), "fallback");
        assert.strictEqual(
            errorMessage(
                {data: {name: "odoo.exceptions.UserError", message: ""}},
                "fallback"
            ),
            "fallback"
        );
        assert.strictEqual(
            errorMessage({data: {name: "odoo.exceptions.UserError"}}, "fallback"),
            "fallback"
        );
    }
);
