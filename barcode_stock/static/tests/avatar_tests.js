/** @odoo-module **/

import {recordImageUrl} from "@barcode_stock/js/utils/avatar.esm";

QUnit.module("BarcodeStock", () => {
    QUnit.test("a record with an image yields a versioned /web/image URL", (assert) => {
        const record = {
            id: 7,
            image_128: "1000",
            write_date: "2026-10-19 10:00:00",
        };
        const value = recordImageUrl("res.users", record);
        assert.ok(value.includes("/web/image"));
        assert.ok(value.includes("model=res.users"));
        assert.ok(value.includes("field=image_128"));
        assert.ok(value.includes("id=7"));
        assert.ok(value.includes("unique="));
    });

    QUnit.test("a record without an image yields false", (assert) => {
        assert.strictEqual(
            recordImageUrl("res.users", {id: 7, image_128: false, write_date: "x"}),
            false
        );
        assert.strictEqual(
            recordImageUrl("res.users", {id: 8, write_date: "x"}),
            false
        );
    });
});
