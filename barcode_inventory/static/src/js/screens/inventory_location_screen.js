/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {barcodeMatchDomain} from "@barcode_stock/js/utils/scan_match";

/**
 * First step of an inventory adjustment: pick or scan the internal location to
 * count. Scanning a location barcode jumps straight into the count; otherwise
 * the operator picks one from the searchable list.
 */
export class InventoryLocationScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            locations: [],
            search: "",
            loading: true,
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

    async loadLocations() {
        this.state.locations = await this.inventory.searchRead(
            "stock.location",
            [["usage", "=", "internal"]],
            ["id", "display_name"]
        );
        this.state.loading = false;
    }

    async onBarcodeScanned(barcode, parsedData) {
        const code = parsedData?.value || barcode;
        const domain = barcodeMatchDomain(code);
        const locations = domain
            ? await this.inventory.searchRead(
                  "stock.location",
                  [...domain, ["usage", "=", "internal"]],
                  ["id", "display_name"]
              )
            : [];
        if (locations.length) {
            this.selectLocation(locations[0]);
            return;
        }
        this.state.search = code;
        this.inventory.notify(
            _t("No internal location matches “%(code)s”.", {code}),
            {type: "warning"}
        );
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

    selectLocation(location) {
        this.store.navigate("inventory_count", {
            locationId: location.id,
            locationName: location.display_name,
        });
    }

    goBack() {
        this.store.goBack();
    }

    static template = "barcode_inventory.InventoryLocationScreen";
}

barcodeScreens.add("inventory_location", {component: InventoryLocationScreen});
