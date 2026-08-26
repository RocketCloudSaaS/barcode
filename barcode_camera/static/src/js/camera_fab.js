/** @odoo-module **/

import {Component, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {registry} from "@web/core/registry";
import {scanBarcode} from "@web/core/barcode/barcode_dialog";
import {barcodeAppWidgets} from "@barcode_scanner/js/registries";

// Routes where the camera button is offered. The built-ins cover the warehouse
// app; feature modules add their own routes into the `barcode_camera_routes`
// registry (value = route name) so the camera reaches their screens without
// this module having to know about them.
const CAMERA_ROUTES = new Set([
    "picking_list",
    "picking",
    "internal_transfer",
    "quick_info",
]);
const extraCameraRoutes = registry.category("barcode_camera_routes");

/**
 * A floating action button that opens the device camera to scan a barcode and
 * feeds it into the same event bus the hardware scanner uses, so the active
 * screen handles it identically.
 *
 * It plugs into the base app through the `barcode_app_widgets` registry — no
 * patching of BarcodeScannerApp.
 */
export class CameraFab extends Component {
    static template = "barcode_camera.CameraFab";
    static props = {};

    setup() {
        this.router = useState(useService("barcodeRouter"));
        this.barcode = useService("barcodeScannerBarcode");
        this.state = useState({scanning: false});
    }

    get isVisible() {
        const route = this.router.currentRoute?.name;
        if (!route || this.state.scanning) {
            return false;
        }
        return CAMERA_ROUTES.has(route) || extraCameraRoutes.getAll().includes(route);
    }

    async onScanClick() {
        if (this.state.scanning) {
            return;
        }
        this.state.scanning = true;
        try {
            const barcode = await scanBarcode(this.env, "environment");
            if (barcode) {
                this.barcode.bus.trigger("barcode_scanned", {
                    barcode,
                    parsed: this.barcode.parseBarcode(barcode),
                    source: "camera",
                });
            }
        } catch {
            // camera denied or cancelled — nothing to do
        } finally {
            this.state.scanning = false;
        }
    }
}

barcodeAppWidgets.add("camera_fab", {component: CameraFab});
