/** @odoo-module **/
import {ProductSelectorScreen} from "@barcode_stock/js/screens/product_selector_screen";
import {patch} from "@web/core/utils/patch";

export function matchesProductSearch(product, search) {
    const value = String(search || "").toLowerCase();
    return [product.name, product.default_code, product.barcode].some((field) =>
        String(field || "")
            .toLowerCase()
            .includes(value)
    );
}

patch(ProductSelectorScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.state.lots = [];
        this.state.lotId = false;
    },

    async loadProducts() {
        const products = await this.inventory.searchRead(
            "product.product",
            [["is_storable", "=", true]],
            [
                "name",
                "image_128",
                "standard_price",
                "tracking",
                "default_code",
                "barcode",
                "type",
            ]
        );
        this.state.products = products.map((product) => ({
            ...product,
            image_128:
                product.image_128 && String(product.image_128).length >= 50
                    ? product.image_128
                    : false,
        }));
        this.state.loading = false;
        const preselectId = this.props.params?.preselectProduct;
        if (preselectId) {
            const product = this.state.products.find((p) => p.id === preselectId);
            if (product) {
                this.state.selectedProduct = product;
                this.state.search = product.name || "";
                this.state.lotId = false;
                this.state.lots = [];
                if (product.tracking !== "none") {
                    this.state.lots = await this.inventory.searchRead(
                        "stock.lot",
                        [["product_id", "=", product.id]],
                        ["id", "name"]
                    );
                }
            }
        }
    },

    get filteredProducts() {
        if (!this.state.search) {
            return this.state.products;
        }
        return this.state.products.filter((product) =>
            matchesProductSearch(product, this.state.search)
        );
    },

    async selectProduct(product) {
        super.selectProduct(product);
        this.state.lotId = false;
        this.state.lots = [];
        if (this.props.params?.mode === "manual_line" && product.tracking !== "none") {
            this.state.lots = await this.inventory.searchRead(
                "stock.lot",
                [["product_id", "=", product.id]],
                ["id", "name"]
            );
        }
    },

    async confirmSelection() {
        if (this.props.params?.mode !== "manual_line") {
            return super.confirmSelection(...arguments);
        }
        const product = this.state.selectedProduct;
        if (!product) {
            return;
        }
        const qty = parseInt(this.state.qty, 10) || 1;
        const lotId = this.state.lotId || false;
        try {
            await this.inventory.call(
                "stock.picking",
                "barcode_scanner_add_manual_line_to_picking",
                [
                    this.props.params.pickingId,
                    product.id,
                    qty,
                    lotId,
                    this.props.params.autoPick || false,
                ]
            );
            this.inventory.notify("Product added as pending demand.", {
                type: "success",
            });
            this.store.goBack({...this.props.params, added: true});
        } catch (error) {
            // The shared api service already showed the failure to the operator.
        }
    },
});
