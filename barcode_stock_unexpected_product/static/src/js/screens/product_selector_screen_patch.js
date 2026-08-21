/** @odoo-module **/
import {ProductSelectorScreen} from "@barcode_stock/js/screens/product_selector_screen";
import {patch} from "@web/core/utils/patch";
patch(ProductSelectorScreen.prototype, {
    async confirmSelection() {
        // Gate unexpected product add via same check - if this screen is used to add new product to picking, ensure it's allowed
        // For now, just call super - the server gate in barcode_scanner_add_line_to_picking will enforce
        return super.confirmSelection(...arguments);
    },
});
