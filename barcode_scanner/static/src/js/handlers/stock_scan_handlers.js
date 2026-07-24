/** @odoo-module **/

import {barcodeScanHandlers} from "@barcode_scanner/js/registries";

/**
 * Home-screen scan recognition for stock. Isolated in its own file so it can be
 * moved to `barcode_stock` untouched in phase 2.
 */

barcodeScanHandlers.add(
    "stock_picking",
    {
        async handle(barcode, parsed, {api, navigate}) {
            if (!(barcode.startsWith("WH/") || barcode.startsWith("INT/"))) {
                return false;
            }
            const pickings = await api.searchRead(
                "stock.picking",
                [["name", "=", barcode]],
                ["id"]
            );
            if (!pickings.length) {
                return false;
            }
            navigate("picking", {pickingId: pickings[0].id});
            return true;
        },
    },
    {sequence: 10}
);

barcodeScanHandlers.add(
    "product",
    {
        async handle(barcode, parsed, {api, navigate}) {
            const productCode = parsed?.value || barcode;
            const products = await api.searchRead(
                "product.product",
                [["barcode", "=", productCode]],
                ["id", "display_name"]
            );
            if (!products.length) {
                return false;
            }
            navigate("quick_info", {result: products[0], result_type: "product"});
            return true;
        },
    },
    {sequence: 20}
);

barcodeScanHandlers.add(
    "location",
    {
        async handle(barcode, parsed, {api, navigate}) {
            const locations = await api.searchRead(
                "stock.location",
                [["barcode", "=", barcode]],
                ["id", "display_name"]
            );
            if (!locations.length) {
                return false;
            }
            navigate("quick_info", {result: locations[0], result_type: "location"});
            return true;
        },
    },
    {sequence: 30}
);
