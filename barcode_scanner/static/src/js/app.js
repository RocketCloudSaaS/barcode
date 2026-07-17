/** @odoo-module **/

import {Component, useState} from "@odoo/owl";
import {registry} from "@web/core/registry";
import {useService} from "@web/core/utils/hooks";

import {scanBarcode} from "@web/core/barcode/barcode_dialog";

import "@barcode_scanner/js/services/feedback_service";
import "@barcode_scanner/js/services/barcode_scanner_state";
import "@barcode_scanner/js/services/barcode_scanner_sync";

import {InternalTransferScreen} from "@barcode_scanner/js/screens/internal_transfer_screen";
import {LocationSelectorScreen} from "@barcode_scanner/js/screens/location_selector_screen";
import {MainScreen} from "@barcode_scanner/js/screens/main_screen";
import {MoveWizardScreen} from "@barcode_scanner/js/screens/move_wizard_screen";
import {PickingListScreen} from "@barcode_scanner/js/screens/picking_list_screen";
import {PickingScreen} from "@barcode_scanner/js/screens/picking_screen";
import {ProductSelectorScreen} from "@barcode_scanner/js/screens/product_selector_screen";
import {QuickInfoScreen} from "@barcode_scanner/js/screens/quick_info";
import {UserSelectorScreen} from "@barcode_scanner/js/screens/user_selector_screen";
import {WarehouseOps} from "@barcode_scanner/js/screens/warehouse_ops";

export class BarcodeScannerApp extends Component {
    setup() {
        this.barcode = useService("barcodeScannerBarcode");
        this.feedback = useState(useService("barcodeScannerFeedback"));
        this.barcodeScannerState = useState(useService("barcodeScannerState"));
        this.dialog = useService("dialog");
        this.router = useState(useService("barcodeRouter"));
        this.scanner = useState({
            enabledRoutes: new Set(["picking_list", "picking", "internal_transfer"]),
        });
        this._registerRoutes();
        if (!this.router.currentRoute) {
            this.router.navigate("main");
        }
    }

    _registerRoutes() {
        this.router.registerRoute("main", {component: MainScreen});
        this.router.registerRoute("warehouse_ops", {component: WarehouseOps});
        this.router.registerRoute("picking_list", {component: PickingListScreen});
        this.router.registerRoute("picking", {component: PickingScreen});
        this.router.registerRoute("move_wizard", {component: MoveWizardScreen});
        this.router.registerRoute("internal_transfer", {
            component: InternalTransferScreen,
        });
        this.router.registerRoute("location_selector", {
            component: LocationSelectorScreen,
        });
        this.router.registerRoute("product_selector", {
            component: ProductSelectorScreen,
        });
        this.router.registerRoute("user_selector", {
            component: UserSelectorScreen,
        });
        this.router.registerRoute("quick_info", {
            component: QuickInfoScreen,
        });
    }

    get screenProps() {
        const router = this.router;
        const params = router.routeParams || {};
        const baseProps = {navigate: router.navigate.bind(router)};

        switch (router.currentRoute?.name) {
            case "picking":
                return {
                    ...baseProps,
                    pickingId: params.pickingId,
                    listParams: params.listParams || null,
                    reloadToken: params.reloadToken || null,
                    params: params,
                };
            default:
                return {
                    ...baseProps,
                    params: params,
                };
        }
    }

    get shouldShowScannerFab() {
        const routeName = this.router.currentRoute?.name;
        return this.scanner.enabledRoutes.has(routeName);
    }

    async openCameraScanner() {
        try {
            const barcode = await scanBarcode(this.env, "environment");
            if (barcode) {
                this.dispatchCameraScan({
                    barcode,
                    parsed: this.barcode.parseBarcode(barcode),
                    source: "camera",
                });
            }
        } catch (error) {
            const msg = error?.message || "";
            if (msg.includes("cancel") || msg.includes("abort")) {
                return;
            }
            this.feedback.warning({
                message: "Camera scan could not start. " + msg,
                notify: true,
            });
        }
    }

    dispatchCameraScan(payload) {
        this.barcode.bus.trigger("barcode_scanned", {
            ...payload,
            source: payload?.source || "camera",
        });
    }
}

BarcodeScannerApp.template = "barcode_scanner.App";

registry.category("actions").add("barcode_scanner_app", BarcodeScannerApp);
