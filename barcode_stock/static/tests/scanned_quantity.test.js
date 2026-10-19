/** @odoo-module **/

import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";

QUnit.module("BarcodeStock", () => {
    QUnit.test(
        "a scan counts as one unit unless the barcode states a quantity",
        (assert) => {
            const state = new BarcodeScannerState({});
            // A plain product barcode says nothing about how many.
            assert.strictEqual(state.scannedQuantity({value: "9501101020917"}, 13), 1);
            assert.strictEqual(state.scannedQuantity({}, null), 1);
            assert.strictEqual(state.scannedQuantity(null, null), 1);
            // A barcode that states one is taken at its word.
            assert.strictEqual(state.scannedQuantity({qty: 12}, 13), 12);
            assert.strictEqual(state.scannedQuantity({quantity: 2.5}, 13), 2.5);
            // Nonsense and zero both mean a single unit.
            assert.strictEqual(state.scannedQuantity({qty: "abc"}, 13), 1);
            assert.strictEqual(state.scannedQuantity({qty: 0}, 13), 1);
        }
    );
});
