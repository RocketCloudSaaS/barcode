/** @odoo-module **/

import {registry} from "@web/core/registry";

/**
 * Offer the device camera on the purchase screens too. This only adds route
 * names to a registry that barcode_camera reads; there is no dependency on
 * barcode_camera -- when it is not installed these entries are simply inert.
 */
const cameraRoutes = registry.category("barcode_camera_routes");

cameraRoutes.add("purchase", "purchase");
cameraRoutes.add("purchase_supplier_selector", "purchase_supplier_selector");
cameraRoutes.add("purchase_location_selector", "purchase_location_selector");
cameraRoutes.add("purchase_product_selector", "purchase_product_selector");
