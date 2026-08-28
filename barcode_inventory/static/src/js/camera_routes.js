/** @odoo-module **/

import {registry} from "@web/core/registry";

/**
 * Offer the device camera on the inventory screens too. This only adds route
 * names to a registry that barcode_camera reads; there is no dependency on
 * barcode_camera -- when it is not installed these entries are simply inert.
 */
const cameraRoutes = registry.category("barcode_camera_routes");

cameraRoutes.add("inventory_location", "inventory_location");
cameraRoutes.add("inventory_count", "inventory_count");
cameraRoutes.add("inventory_product_selector", "inventory_product_selector");
