/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";

export class ProductSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            products: [],
            search: "",
            loading: true,
            selectedProduct: null,
            qty: 1,
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
        const searchCode = parsedData?.value || barcode;
        const products = await this.inventory.searchRead(
            "product.product",
            [["barcode", "=", searchCode]],
            ["name", "image_128", "standard_price", "tracking", "default_code", "type"]
        );
        if (products.length) {
            this.state.selectedProduct = products[0];
            this.confirmSelection();
            return;
        }
        this.state.search = searchCode;
    }

    async loadProducts() {
        const domain = [["type", "=", "consu"]];
        let products = await this.inventory.searchRead("product.product", domain, [
            "name",
            "image_128",
            "standard_price",
            "tracking",
            "default_code",
            "type",
        ]);

        products = products.map((prod) => {
            if (
                !prod.image_128 ||
                prod.image_128 === "False" ||
                prod.image_128 === "false" ||
                String(prod.image_128).length < 50
            ) {
                prod.image_128 = false;
            }
            return prod;
        });

        this.state.products = products;
        this.state.loading = false;
    }

    get filteredProducts() {
        if (!this.state.search) {
            return this.state.products;
        }
        const search = this.state.search.toLowerCase();
        return this.state.products.filter(
            (p) =>
                p.name.toLowerCase().includes(search) ||
                (p.default_code && p.default_code.toLowerCase().includes(search))
        );
    }

    selectProduct(product) {
        this.state.selectedProduct = product;
    }

    incrementQty() {
        this.state.qty = (parseInt(this.state.qty, 10) || 0) + 1;
    }

    decrementQty() {
        const current = parseInt(this.state.qty, 10) || 1;
        if (current > 1) {
            this.state.qty = current - 1;
        }
    }

    onQtyInput(ev) {
        const val = parseInt(ev.target.value, 10);
        this.state.qty = isNaN(val) || val < 1 ? 1 : val;
    }

    async confirmSelection() {
        const product = this.state.selectedProduct;
        if (!product) return;

        if (this.props.params.mode === "quick_info_product") {
            this.store.goBack({
                result: product,
                result_type: "product",
            });
            return;
        }

        const qty = parseInt(this.state.qty, 10) || 1;
        const lines = this.props.params.lines || [];
        const existing = lines.find((l) => l.product_id === product.id);
        const lots = await this.inventory.searchRead(
            "stock.lot",
            [["product_id", "=", product.id]],
            ["id", "name"]
        );
        if (existing) {
            existing.qty += qty;
        } else {
            lines.push({
                product_id: product.id,
                product_name: product.name,
                qty: qty,
                price_unit: product.standard_price || 0,
                tracking: product.tracking || "none",
                lot_id: null,
                lots: lots,
                default_code: product.default_code || "",
            });
        }
        this.store.goBack({
            ...this.props.params,
            lines: lines,
        });
    }

    updateSearch(ev) {
        this.state.search = ev.target.value;
    }

    goBack() {
        this.store.goBack();
    }
}

ProductSelectorScreen.template = "barcode_scanner.ProductSelectorScreen";

barcodeScreens.add("product_selector", {component: ProductSelectorScreen});
