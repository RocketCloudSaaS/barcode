/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {barcodeMatchDomain} from "@barcode_stock/js/utils/scan_match";

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
        const domain = barcodeMatchDomain(barcode);
        const locations = domain
            ? await this.inventory.searchRead(
                  "stock.location",
                  domain,
                  ["id", "display_name", "usage"]
              )
            : [];
        if (locations.length) {
            this.state.selectedLocation = locations[0];
            this.confirmSelection();
            return;
        }
        // No location carries this barcode: filter the list by it and say so,
        // instead of silently doing nothing.
        this.state.search = barcode;
        this.inventory.notify(
            _t("No location matches “%(code)s”.", {code: barcode}),
            {type: "warning"}
        );
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

        if (this.props.params.mode === "quick_info_location") {
            this.store.goBack({
                result: location,
                result_type: "location",
            });
            return;
        }

        this.store.goBack({
            ...this.props.params,
            [this.props.params.type]: location,
        });
    }

    updateSearch(ev) {
        this.state.search = ev.target.value;
    }

    goBack() {
        this.store.goBack();
    }
}

LocationSelectorScreen.template = "barcode_scanner.LocationSelectorScreen";

barcodeScreens.add("location_selector", {component: LocationSelectorScreen});
