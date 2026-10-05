import {registry} from "@web/core/registry";

/**
 * Offer the device camera on the scrap screens too. This only adds route names
 * to a registry that barcode_camera reads; there is no dependency on
 * barcode_camera -- when it is not installed these entries are simply inert.
 */
const cameraRoutes = registry.category("barcode_camera_routes");

cameraRoutes.add("scrap_location", "scrap_location");
cameraRoutes.add("scrap", "scrap");
cameraRoutes.add("scrap_product_selector", "scrap_product_selector");
