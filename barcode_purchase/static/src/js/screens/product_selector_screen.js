/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";
import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {
    barcodeMatchDomain,
    barcodeMatchAnyDomain,
} from "@barcode_purchase/js/utils/scan_match";
import {recordImageUrl} from "@barcode_purchase/js/utils/avatar";

/**
 * Pick a product to add to the purchase order. Scanning a product barcode adds
 * it straight away (carrying the GS1 lot/quantity when present); otherwise the
 * operator taps one from the list. Returns to the purchase screen with the
 * updated draft lines.
 */
export class PurchaseProductSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            products: [],
            search: "",
            loading: true,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            await this.loadProducts();
        });
    }

    async onBarcodeScanned(barcode, parsedData) {
        const candidates = [
            ...(parsedData?.productCodes || []),
            parsedData?.value,
            barcode,
        ];
        const domain = barcodeMatchAnyDomain(candidates);
        const products = domain
            ? await this.inventory.searchRead(
                  "product.product",
                  domain,
                  ["display_name", "standard_price", "tracking", "default_code"]
              )
            : [];
        if (products.length) {
            const lotName = parsedData?.lot || parsedData?.serial || null;
            const qty = parsedData?.qty || parsedData?.quantity || 1;
            this.confirmSelection(products[0], lotName, qty);
            return;
        }
        this.state.search = parsedData?.value || barcode;
    }

    async loadProducts() {
        // Odoo 18: purchasable goods are type "consu".
        // `bin_size` keeps the images themselves off the wire -- see
        // recordImageUrl.
        this.state.products = await this.inventory.searchRead(
            "product.product",
            [["type", "=", "consu"], ["purchase_ok", "=", true]],
            [
                "display_name",
                "image_128",
                "standard_price",
                "tracking",
                "default_code",
                "write_date",
            ],
            {context: {bin_size: true}}
        );
        this.state.products = this.state.products.map((p) => {
            p.image_url = recordImageUrl("product.product", p);
            return p;
        });
        this.state.loading = false;
    }

    /**
     * Should the image fail anyway -- no session, no network, a filestore that
     * lost the file -- fall back to the initial rather than leave a broken
     * image in the list.
     */
    onImageError(record) {
        record.image_url = false;
    }

    get filteredProducts() {
        if (!this.state.search) {
            return this.state.products;
        }
        const s = this.state.search.toLowerCase();
        return this.state.products.filter(
            (p) =>
                p.display_name.toLowerCase().includes(s) ||
                (p.default_code && p.default_code.toLowerCase().includes(s))
        );
    }

    confirmSelection(product, lotName = null, qty = 1) {
        const lines = JSON.parse(JSON.stringify(this.props.params?.lines || []));
        const existing = lines.find(
            (l) => l.product_id === product.id && l.lot_name === lotName
        );
        if (existing) {
            existing.qty += qty;
        } else {
            lines.push({
                product_id: product.id,
                product_name: product.display_name,
                default_code: product.default_code || null,
                qty: qty,
                price_unit: product.standard_price || 0,
                lot_name: lotName,
                tracking: product.tracking || "none",
            });
        }
        this.store.navigate("purchase", {...this.props.params, lines});
    }

    goBack() {
        this.store.navigate("purchase", {...this.props.params});
    }

    static template = "barcode_purchase.PurchaseProductSelectorScreen";
}

barcodeScreens.add("purchase_product_selector", {
    component: PurchaseProductSelectorScreen,
});
