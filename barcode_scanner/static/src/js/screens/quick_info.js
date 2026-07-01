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
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(() => {
            if (this.props.params && this.props.params.mode) {
                this.state.mode = this.props.params.mode;
            }
        });
    }

    goBack() {
        this.store.navigate("main");
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
        if (!this.state.barcode) {
            this.inventory.notify("Enter a barcode.", {type: "warning"});
            return;
        }
        try {
            const products = await this.inventory.searchRead(
                "product.product",
                [["barcode", "=", this.state.barcode]],
                ["name"]
            );
            if (products.length) {
                this.inventory.notify("Product found: " + products[0].name, {
                    type: "success",
                });
                this.state.barcode = "";
                return;
            }
            const locations = await this.inventory.searchRead(
                "stock.location",
                [["barcode", "=", this.state.barcode]],
                ["display_name"]
            );
            if (locations.length) {
                this.inventory.notify("Location found: " + locations[0].display_name, {
                    type: "success",
                });
                this.state.barcode = "";
                return;
            }
            this.inventory.notify("Barcode not found.", {type: "danger"});
        } catch (error) {
            console.error(error);
            this.inventory.notify("Search failed.", {type: "danger"});
        }
    }

    async onBarcodeScanned(barcode, parsedData) {
        if (!parsedData || !parsedData.value) {
            this.inventory.notify("Barcode not recognized.", {type: "warning"});
            return;
        }
        await this.handleEAN13(parsedData.value);
    }

    async handleEAN13(barcode) {
        const products = await this.inventory.searchRead(
            "product.product",
            [["barcode", "=", barcode]],
            ["display_name"]
        );
        if (products.length) {
            this.store.navigate("product_selector", {
                mode: "quick_info_product",
                return_mode: this.state.mode,
            });
            return;
        }
        const locations = await this.inventory.searchRead(
            "stock.location",
            [["barcode", "=", barcode]],
            ["display_name"]
        );
        if (locations.length) {
            this.store.navigate("location_selector", {
                mode: "quick_info_location",
                return_mode: this.state.mode,
            });
            return;
        }
        this.inventory.notify("Barcode not found", {type: "warning"});
    }
}

QuickInfoScreen.template = "barcode_scanner.QuickInfoScreen";
