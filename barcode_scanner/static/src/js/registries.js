/** @odoo-module **/

import {registry} from "@web/core/registry";

/**
 * Registries that make the Barcode Scanner app extensible, the same way Odoo
 * widgets self-register. Feature modules add their pieces here instead of
 * patching the base app.
 *
 * - barcode_screens: route name -> {component, props?(routeParams)}
 * - barcode_scan_handlers: {handle(barcode, parsed, ctx)}; registered with a
 *   `sequence` option, tried in order until one returns a truthy value.
 * - barcode_menu_tiles: home-screen tiles {label, icon, iconClass, action(ctx)}
 *   registered with a `sequence` option.
 * - barcode_app_widgets: {component} overlay widgets rendered in the app shell
 *   (e.g. a floating action button); each renders itself and wires its own
 *   services.
 */
export const barcodeScreens = registry.category("barcode_screens");
export const barcodeScanHandlers = registry.category("barcode_scan_handlers");
export const barcodeMenuTiles = registry.category("barcode_menu_tiles");
export const barcodeAppWidgets = registry.category("barcode_app_widgets");
