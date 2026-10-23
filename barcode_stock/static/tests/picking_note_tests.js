/** @odoo-module **/

import {PickingInfoTab} from "@barcode_stock/js/components/picking_info_tab.esm";

QUnit.module("BarcodeStock", () => {
    QUnit.test("a typed note is escaped before it is stored as HTML", (assert) => {
        const tab = Object.create(PickingInfoTab.prototype);
        const picking = {note: ""};
        tab.props = {picking};

        tab.onNoteInput({target: {value: "  pick 5 < 10 & check  "}});
        assert.strictEqual(picking.note, "<p>pick 5 &lt; 10 &amp; check</p>");

        // What the operator typed is what they read back.
        tab.props = {picking};
        assert.strictEqual(tab.notePlainText, "pick 5 < 10 & check");

        // Markup an operator could type is stored as text, never as tags.
        tab.onNoteInput({target: {value: "<b>bold</b>"}});
        assert.strictEqual(picking.note, "<p>&lt;b&gt;bold&lt;/b&gt;</p>");
        assert.strictEqual(tab.notePlainText, "<b>bold</b>");

        // An emptied field clears the note instead of storing "<p></p>".
        tab.onNoteInput({target: {value: "   "}});
        assert.strictEqual(picking.note, "");
    });
});
