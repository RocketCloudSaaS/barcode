/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";
import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";

/**
 * Pick the vendor for a purchase order. Scanning a partner barcode selects it
 * straight away; otherwise the operator taps one from the list. Returns to the
 * purchase screen with the draft params intact.
 */
export class SupplierSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            suppliers: [],
            search: "",
            loading: true,
            selectedSupplier: null,
        });

        useBarcodeHandler({
            onScan: async (barcode) => {
                await this.onBarcodeScanned(barcode);
            },
        });

        onWillStart(async () => {
            await this.loadSuppliers();
        });
    }

    async onBarcodeScanned(barcode) {
        const suppliers = await this.inventory.searchRead(
            "res.partner",
            [["barcode", "=", barcode]],
            ["name", "image_128", "city", "country_id"]
        );
        if (suppliers.length) {
            this.state.selectedSupplier = this._sanitize(suppliers[0]);
            this.confirmSelection();
            return;
        }
        this.state.search = barcode;
    }

    _sanitize(partner) {
        if (
            !partner.image_128 ||
            String(partner.image_128).length < 50
        ) {
            partner.image_128 = false;
        }
        return partner;
    }

    async loadSuppliers() {
        const suppliers = await this.inventory.searchRead(
            "res.partner",
            [["supplier_rank", ">", 0]],
            ["name", "image_128", "city", "country_id"]
        );
        this.state.suppliers = suppliers.map((s) => this._sanitize(s));
        this.state.loading = false;
    }

    get filteredSuppliers() {
        if (!this.state.search) {
            return this.state.suppliers;
        }
        const s = this.state.search.toLowerCase();
        return this.state.suppliers.filter(
            (sup) =>
                sup.name.toLowerCase().includes(s) ||
                (sup.city && sup.city.toLowerCase().includes(s))
        );
    }

    selectSupplier(supplier) {
        this.state.selectedSupplier = supplier;
    }

    confirmSelection() {
        if (!this.state.selectedSupplier) {
            return;
        }
        this.store.navigate("purchase", {
            ...this.props.params,
            supplier: {
                id: this.state.selectedSupplier.id,
                name: this.state.selectedSupplier.name,
            },
        });
    }

    goBack() {
        this.store.navigate("purchase", {...this.props.params});
    }

    static template = "barcode_purchase.SupplierSelectorScreen";
}

barcodeScreens.add("purchase_supplier_selector", {
    component: SupplierSelectorScreen,
});
