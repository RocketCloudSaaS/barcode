/** @odoo-module **/

import {BarcodeDialog} from "@web/webclient/barcode/barcode_scanner";
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

QUnit.module("BarcodeCamera");

QUnit.test("the button joins the app through the widgets registry", (assert) => {
    assert.strictEqual(barcodeAppWidgets.get("camera_fab").component, CameraFab);
});

QUnit.test("the button shows on the warehouse screens only", (assert) => {
    for (const route of [
        "picking_list",
        "picking",
        "internal_transfer",
        "quick_info",
    ]) {
        assert.strictEqual(cameraFab({route}).fab.isVisible, true);
    }
    assert.strictEqual(cameraFab({route: "home"}).fab.isVisible, false);
    assert.strictEqual(cameraFab({route: null}).fab.isVisible, false);
});

QUnit.test("a feature module offers the button on its own screens", (assert) => {
    const routes = registry.category("barcode_camera_routes");
    assert.strictEqual(cameraFab({route: "camera_test_screen"}).fab.isVisible, false);
    routes.add("camera_test_screen", "camera_test_screen");
    try {
        assert.strictEqual(
            cameraFab({route: "camera_test_screen"}).fab.isVisible,
            true
        );
    } finally {
        routes.remove("camera_test_screen");
    }
});

QUnit.test(
    "a code the camera reads is scanned like a hardware scan",
    async (assert) => {
        const {fab, scans, dialogs} = cameraFab({
            dialog: readsCode("9501101020917"),
        });
        await fab.onScanClick();
        assert.strictEqual(dialogs[0].component, BarcodeDialog);
        assert.strictEqual(dialogs[0].props.facingMode, "environment");
        assert.deepEqual(scans, [
            {
                name: "barcode_scanned",
                payload: {
                    barcode: "9501101020917",
                    parsed: {type: "product", value: "9501101020917"},
                    source: "camera",
                },
            },
        ]);
        assert.strictEqual(fab.state.scanning, false);
    }
);

QUnit.test("a dialog closed without a code brings the button back", async (assert) => {
    // Closed by hand, or left after the browser refused the camera.
    const closed = cameraFab({
        dialog: (props, options) => options.onClose(),
    });
    await closed.fab.onScanClick();
    assert.deepEqual(closed.scans, []);
    assert.strictEqual(closed.fab.isVisible, true);
    const failed = cameraFab({
        dialog: (props) => props.onError(new Error("NotAllowedError")),
    });
    await failed.fab.onScanClick();
    assert.deepEqual(failed.scans, []);
    assert.strictEqual(failed.fab.isVisible, true);
});

QUnit.test(
    "the button hides and ignores taps while the camera is open",
    async (assert) => {
        let read = null;
        const {fab, scans, dialogs} = cameraFab({
            dialog: (props, options) => {
                read = readsCode("9501101020917").bind(null, props, options);
            },
        });
        const scanning = fab.onScanClick();
        assert.strictEqual(fab.isVisible, false);
        await fab.onScanClick();
        assert.strictEqual(dialogs.length, 1);
        read();
        await scanning;
        assert.strictEqual(scans.length, 1);
        assert.strictEqual(fab.isVisible, true);
    }
);
