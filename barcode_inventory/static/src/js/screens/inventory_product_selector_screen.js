/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {barcodeMatchDomain} from "@barcode_scanner/js/utils/scan_match";

/**
 * Product selector for the inventory count, opened from the count screen's "+"
 * -- like the back office, so a product not yet in the location can be added by
 * searching (or scanning) it. It carries the count in progress through the
 * navigation params and hands the picked product back to the count screen.
 */
export class InventoryProductSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            search: "",
            results: [],
            loading: true,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            await this.search();
        });
    }

    async search() {
        const term = this.state.search;
        const exclude = this.props.params?.excludeProductIds || [];
        const domain = [];
        if (term) {
            domain.push("|", ["name", "ilike", term], ["barcode", "ilike", term]);
        }
        if (exclude.length) {
            // Hide products already in the location (already shown as count lines).
            domain.push(["id", "not in", exclude]);
        }
        this.state.results = await this.inventory.searchRead(
            "product.product",
            domain,
            ["id", "display_name", "tracking", "uom_id"],
            {limit: 50}
        );
        this.state.loading = false;
    }

    onSearchInput(ev) {
        this.state.search = ev.target.value;
        this.search();
    }

    async onBarcodeScanned(barcode, parsed) {
        const code = parsed?.gtin || parsed?.value || barcode;
        const domain = barcodeMatchDomain(code);
        const products = domain
            ? await this.inventory.searchRead(
                  "product.product",
                  domain,
                  ["id", "display_name", "tracking", "uom_id"]
              )
            : [];
        if (!products.length) {
            this.inventory.notify(_t("No product matches “%(code)s”.", {code}), {
                type: "warning",
            });
            return;
        }
        this.pickProduct(products[0]);
    }

    pickProduct(product) {
        this.store.goBack({
            locationId: this.props.params?.locationId,
            locationName: this.props.params?.locationName,
            lines: this.props.params?.lines || [],
            addProduct: {
                id: product.id,
                display_name: product.display_name,
                tracking: product.tracking,
                uom_id: product.uom_id,
            },
        });
    }

    goBack() {
        // Return without adding, keeping the count in progress intact.
        this.store.goBack({
            locationId: this.props.params?.locationId,
            locationName: this.props.params?.locationName,
            lines: this.props.params?.lines || [],
        });
    }

    static template = "barcode_inventory.InventoryProductSelectorScreen";
}

barcodeScreens.add("inventory_product_selector", {
    component: InventoryProductSelectorScreen,
});
