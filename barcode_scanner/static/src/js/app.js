/** @odoo-module **/

import {Component, useState} from "@odoo/owl";
import {registry} from "@web/core/registry";
import {useService} from "@web/core/utils/hooks";

import "@barcode_scanner/js/services/feedback_service";
import "@barcode_scanner/js/services/barcode_scanner_state";
import "@barcode_scanner/js/services/barcode_scanner_sync";

import {barcodeScreens} from "@barcode_scanner/js/registries";

export class BarcodeScannerApp extends Component {
    setup() {
        this.barcode = useService("barcodeScannerBarcode");
        this.feedback = useState(useService("barcodeScannerFeedback"));
        this.barcodeScannerState = useState(useService("barcodeScannerState"));
        this.dialog = useService("dialog");
        this.router = useState(useService("barcodeRouter"));
        if (!this.router.currentRoute) {
            this.router.navigate("main");
        }
    }

    get currentScreen() {
        const name = this.router.currentRoute?.name;
        return name ? barcodeScreens.get(name, null) : null;
    }

    get currentScreenProps() {
        const entry = this.currentScreen;
        const params = this.router.routeParams || {};
        const navigate = this.router.navigate.bind(this.router);
        const extra = entry && entry.props ? entry.props(params) : {params};
        return {navigate, ...extra};
    }
}

BarcodeScannerApp.template = "barcode_scanner.App";

registry.category("actions").add("barcode_scanner_app", BarcodeScannerApp);
