import {describe, expect, test} from "@odoo/hoot";
import {BarcodeDialog} from "@web/core/barcode/barcode_dialog";
import {CameraFab} from "@barcode_camera/js/camera_fab.esm";
import {barcodeAppWidgets} from "@barcode_scanner/js/registries.esm";
import {registry} from "@web/core/registry";

/**
 * A camera button on `route`, without mounting it. `dialog` plays the part of
 * Odoo's scanner dialog: it gets the dialog's props and options and answers the
 * way the camera would. What the button feeds the scanner bus lands in `scans`.
 */
function cameraFab({route = "picking", dialog = () => undefined} = {}) {
    const fab = Object.create(CameraFab.prototype);
    const scans = [];
    const dialogs = [];
    fab.env = {
        services: {
            dialog: {
                add(component, props, options) {
                    dialogs.push({component, props});
                    dialog(props, options);
                },
            },
        },
    };
    fab.router = {currentRoute: route ? {name: route} : null};
    fab.barcode = {
        bus: {trigger: (name, payload) => scans.push({name, payload})},
        parseBarcode: (barcode) => ({type: "product", value: barcode}),
    };
    fab.state = {scanning: false};
    return {fab, scans, dialogs};
}

// What Odoo's dialog does once the camera reads a code: it closes itself, then
// hands the code over.
function readsCode(code) {
    return (props, options) => {
        options.onClose();
        props.onResult(code);
    };
}

describe("BarcodeCamera", () => {
    test("the button joins the app through the widgets registry", () => {
        expect(barcodeAppWidgets.get("camera_fab").component).toBe(CameraFab);
    });

    test("the button shows on the warehouse screens only", () => {
        for (const route of [
            "picking_list",
            "picking",
            "internal_transfer",
            "quick_info",
        ]) {
            expect(cameraFab({route}).fab.isVisible).toBe(true);
        }
        expect(cameraFab({route: "home"}).fab.isVisible).toBe(false);
        expect(cameraFab({route: null}).fab.isVisible).toBe(false);
    });

    test("a feature module offers the button on its own screens", () => {
        const routes = registry.category("barcode_camera_routes");
        expect(cameraFab({route: "camera_test_screen"}).fab.isVisible).toBe(false);
        routes.add("camera_test_screen", "camera_test_screen");
        try {
            expect(cameraFab({route: "camera_test_screen"}).fab.isVisible).toBe(true);
        } finally {
            routes.remove("camera_test_screen");
        }
    });

    test("a code the camera reads is scanned like a hardware scan", async () => {
        const {fab, scans, dialogs} = cameraFab({dialog: readsCode("9501101020917")});
        await fab.onScanClick();
        expect(dialogs[0].component).toBe(BarcodeDialog);
        expect(dialogs[0].props.facingMode).toBe("environment");
        expect(scans).toEqual([
            {
                name: "barcode_scanned",
                payload: {
                    barcode: "9501101020917",
                    parsed: {type: "product", value: "9501101020917"},
                    source: "camera",
                },
            },
        ]);
        expect(fab.state.scanning).toBe(false);
    });

    test("a dialog closed without a code brings the button back", async () => {
        // Closed by hand, or left after the browser refused the camera.
        const closed = cameraFab({dialog: (props, options) => options.onClose()});
        await closed.fab.onScanClick();
        expect(closed.scans).toEqual([]);
        expect(closed.fab.isVisible).toBe(true);
        const failed = cameraFab({
            dialog: (props) => props.onError(new Error("NotAllowedError")),
        });
        await failed.fab.onScanClick();
        expect(failed.scans).toEqual([]);
        expect(failed.fab.isVisible).toBe(true);
    });

    test("the button hides and ignores taps while the camera is open", async () => {
        let read = null;
        const {fab, scans, dialogs} = cameraFab({
            dialog: (props, options) => {
                read = readsCode("9501101020917").bind(null, props, options);
            },
        });
        const scanning = fab.onScanClick();
        expect(fab.isVisible).toBe(false);
        await fab.onScanClick();
        expect(dialogs.length).toBe(1);
        read();
        await scanning;
        expect(scans.length).toBe(1);
        expect(fab.isVisible).toBe(true);
    });
});
