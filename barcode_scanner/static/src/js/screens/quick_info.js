/** @odoo-module **/

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";

export class QuickInfoScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            barcode: "",
            result: null,
            resultType: null,
            resultDetails: null,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            if (this.props.params && this.props.params.mode) {
                this.state.mode = this.props.params.mode;
            }
            if (this.props.params && this.props.params.result) {
                await this.loadResult(this.props.params.result, this.props.params.result_type);
            }
        });
    }

    async loadResult(result, resultType) {
        this.state.result = result;
        this.state.resultType = resultType;
        if (resultType === "product") {
            const products = await this.inventory.searchRead(
                "product.product",
                [["id", "=", result.id]],
                ["name", "default_code", "barcode", "standard_price", "list_price", "tracking", "type", "image_128"]
            );
            this.state.resultDetails = products.length ? products[0] : null;
        } else if (resultType === "location") {
            const locations = await this.inventory.searchRead(
                "stock.location",
                [["id", "=", result.id]],
                ["display_name", "barcode", "usage"]
            );
            this.state.resultDetails = locations.length ? locations[0] : null;
        }
    }

    goBack() {
        if (this.state.resultDetails) {
            this.state.result = null;
            this.state.resultDetails = null;
            this.state.resultType = null;
            return;
        }
        this.store.goBack();
    }

    openProductSelector() {
        this.store.navigate("product_selector", {
            mode: "quick_info_product",
            return_mode: this.state.mode,
        });
    }

    openLocationSelector() {
        this.store.navigate("location_selector", {
            mode: "quick_info_location",
            return_mode: this.state.mode,
        });
    }

    addDigit(digit) {
        this.state.barcode += digit;
    }

    deleteDigit() {
        this.state.barcode = this.state.barcode.slice(0, -1);
    }

    onInputKeydown(ev) {
        if (ev.key === "Enter") {
            this.searchBarcode();
        }
    }

    async searchBarcode() {
        const barcode = this.state.barcode;
        if (!barcode) {
            this.inventory.notify("Enter a barcode.", {type: "warning"});
            return;
        }
        await this.lookupAndShow(barcode);
    }

    async onBarcodeScanned(barcode, parsedData) {
        const scanValue = parsedData?.value || barcode;
        if (!scanValue) {
            this.inventory.notify("Barcode not recognized.", {type: "warning"});
            return;
        }
        this.state.barcode = "";
        await this.lookupAndShow(scanValue);
    }

    async lookupAndShow(barcode) {
        try {
            const products = await this.inventory.searchRead(
                "product.product",
                [["barcode", "=", barcode]],
                ["display_name"]
            );
            if (products.length) {
                this.state.barcode = "";
                await this.loadResult(products[0], "product");
                return;
            }
            const locations = await this.inventory.searchRead(
                "stock.location",
                [["barcode", "=", barcode]],
                ["display_name"]
            );
            if (locations.length) {
                this.state.barcode = "";
                await this.loadResult(locations[0], "location");
                return;
            }
            this.inventory.notify("Barcode not found.", {type: "danger"});
        } catch (error) {
            console.error(error);
            this.inventory.notify("Search failed.", {type: "danger"});
        }
    }
}

QuickInfoScreen.template = "barcode_scanner.QuickInfoScreen";
