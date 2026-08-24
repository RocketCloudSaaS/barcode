/** @odoo-module **/

import {patch} from "@web/core/utils/patch";
import {InternalTransferScreen} from "@barcode_stock/js/screens/internal_transfer_screen";

patch(InternalTransferScreen.prototype, {
    async isInsertNewLineAllowed() {
        const origin = this.state.origin_location?.id;
        const destination = this.state.destination_location?.id;
        if (!origin || !destination) {
            return true;
        }
        const result = await this.inventory.call(
            "stock.picking",
            "barcode_scanner_check_insert_new_line_allowed",
            [origin, destination]
        );
        if (result?.allowed === false) {
            this.notification.add(
                result.error || "Adding a new product line is not allowed.",
                {type: "warning"}
            );
            return false;
        }
        return true;
    },

    async addLine(product, lotId, lotName, qty) {
        const existing = this.state.lines.find(
            (l) => l.product_id === product.id && l.lot_id === lotId
        );
        if (existing) {
            existing.qty += qty;
            return;
        }
        if (!(await this.isInsertNewLineAllowed())) {
            return;
        }
        return super.addLine(...arguments);
    },
});
