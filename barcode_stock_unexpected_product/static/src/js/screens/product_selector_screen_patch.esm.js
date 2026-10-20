/** @odoo-module **/

import {ProductSelectorScreen} from "@barcode_stock/js/screens/product_selector_screen.esm";
import {_t} from "@web/core/l10n/translation";
import {patch} from "@web/core/utils/patch";
import {recordImageUrl} from "@barcode_stock/js/utils/avatar.esm";

export function matchesProductSearch(product, search) {
    const value = String(search || "").toLowerCase();
    return [product.name, product.default_code, product.barcode].some((field) =>
        String(field || "")
            .toLowerCase()
            .includes(value)
    );
}

export function getManualLineInitialQuantity(params) {
    const quantity = Number.parseFloat(params?.scannedQuantity);
    return Number.isFinite(quantity) && quantity > 0 ? quantity : 1;
}

export function lotIdForName(lots, lotName) {
    const name = String(lotName || "").trim();
    if (!name) {
        return false;
    }
    const lot = (lots || []).find(
        (candidate) => String(candidate.name || "").trim() === name
    );
    return lot ? String(lot.id) : false;
}

patch(ProductSelectorScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.state.lots = [];
        this.state.lotId = false;
        if (this.props.params?.mode === "manual_line") {
            this.state.qty = getManualLineInitialQuantity(this.props.params);
        }
    },

    async loadProducts() {
        if (this.props.params?.mode !== "manual_line") {
            return super.loadProducts(...arguments);
        }
        // Odoo 17.0 has no ``is_storable``: a storable product is ``type=product``.
        const products = await this.inventory.searchRead(
            "product.product",
            [["type", "=", "product"]],
            [
                "name",
                "image_128",
                "write_date",
                "standard_price",
                "tracking",
                "default_code",
                "barcode",
                "type",
            ],
            {context: {bin_size: true}}
        );
        this.state.products = products.map((product) => ({
            ...product,
            image_url: recordImageUrl("product.product", product),
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
                this.state.lotId = lotIdForName(
                    this.state.lots,
                    this.props.params?.scannedLotName
                );
            }
        }
    },

    get filteredProducts() {
        if (this.props.params?.mode !== "manual_line") {
            return super.filteredProducts;
        }
        if (!this.state.search) {
            return this.state.products;
        }
        return this.state.products.filter((product) =>
            matchesProductSearch(product, this.state.search)
        );
    },

    onQtyInput(ev) {
        if (this.props.params?.mode !== "manual_line") {
            return super.onQtyInput(...arguments);
        }
        // The scanner can hand over a weight (2.5 kg), not just whole units.
        const value = Number.parseFloat(ev.target.value);
        this.state.qty = Number.isFinite(value) && value > 0 ? value : 1;
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
        const qty = Number.parseFloat(this.state.qty) || 1;
        const lotId = Number.parseInt(this.state.lotId, 10) || false;
        try {
            const result = await this.inventory.call(
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
            this.inventory.notify(_t("Product added as pending demand."), {
                type: "success",
            });
            // Hand the move back so the picking screen reloads and opens on
            // the tab that now holds it (same pattern as move_wizard_screen).
            this.store.goBack({
                ...this.props.params,
                reloadToken: Date.now(),
                focusMoveId: result.move_id,
            });
        } catch {
            // The shared api service already showed the failure to the operator.
        }
    },
});
