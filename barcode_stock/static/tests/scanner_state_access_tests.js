/** @odoo-module **/

import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state.esm";

/**
 * Record every model the preload touches, answering just enough for it to
 * run through on a picking with no moves.
 */
function ormSpy(lotFields) {
    const touched = [];
    return {
        touched,
        orm: {
            searchRead: async (model) => {
                touched.push(model);
                return model === "stock.picking"
                    ? [{id: 1, name: "WH/IN/001", picking_type_id: [7, "Receipts"]}]
                    : [];
            },
            read: async (model) => {
                touched.push(model);
                return model === "stock.picking.type"
                    ? [
                          {
                              code: "incoming",
                              use_existing_lots: true,
                              use_create_lots: false,
                          },
                      ]
                    : [];
            },
            call: async (model, method) => {
                touched.push(`${model}.${method}`);
                return lotFields;
            },
        },
    };
}

QUnit.module("BarcodeStock", () => {
    QUnit.test(
        "preloading a picking stays within a stock operator's rights",
        async (assert) => {
            const {orm, touched} = ormSpy({
                expiration_date: {type: "date"},
                removal_date: {type: "date"},
            });
            const state = new BarcodeScannerState(orm);
            await state.preloadPicking(1);

            // Reading ir.module.module takes Administration rights, which the
            // operator scanning a receipt has no reason to hold.
            assert.notOk(touched.includes("ir.module.module"));
            assert.ok(touched.includes("stock.lot.fields_get"));
            assert.ok(state.hasProductExpiry);
        }
    );

    QUnit.test(
        "expiry handling stays off when the lot has no expiry fields",
        async (assert) => {
            const {orm} = ormSpy({});
            const state = new BarcodeScannerState(orm);
            await state.preloadPicking(1);
            assert.notOk(state.hasProductExpiry);
        }
    );
});
