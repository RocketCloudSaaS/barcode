/** @odoo-module **/

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";

export class LocationSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            locations: [],
            search: "",
            loading: true,
            selectedLocation: null,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            await this.loadLocations();
        });
    }

    async onBarcodeScanned(barcode) {
        const locations = await this.inventory.searchRead(
            "stock.location",
            [["barcode", "=", barcode]],
            ["id", "display_name", "usage"]
        );
        if (locations.length) {
            this.state.selectedLocation = locations[0];
            this.confirmSelection();
            return;
        }
        this.state.search = barcode;
    }

    async loadLocations() {
        let domain = [["usage", "=", "internal"]];
        this.state.locations = await this.inventory.searchRead(
            "stock.location",
            domain,
            ["id", "display_name", "usage"]
        );
        this.state.loading = false;
    }

    get filteredLocations() {
        if (!this.state.search) {
            return this.state.locations;
        }
        const search = this.state.search.toLowerCase();
        return this.state.locations.filter((loc) =>
            loc.display_name.toLowerCase().includes(search)
        );
    }

    selectLocation(loc) {
        this.state.selectedLocation = loc;
    }

    confirmSelection() {
        const location = this.state.selectedLocation;
        if (!location) return;

        this.store.navigate("internal_transfer", {
            ...this.props.params,
            [this.props.params.type]: location,
        });
    }

    updateSearch(ev) {
        this.state.search = ev.target.value;
    }

    goBack() {
        this.store.navigate("internal_transfer", {
            ...this.props.params,
        });
    }
}

LocationSelectorScreen.template = "barcode_scanner.LocationSelectorScreen";
