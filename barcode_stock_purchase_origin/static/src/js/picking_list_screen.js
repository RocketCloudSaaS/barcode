/** @odoo-module **/

import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen";
import {appendPurchaseOriginToSearchText} from "./picking_list_search";
import {barcodeScreens} from "@barcode_scanner/js/registries";

/**
 * PickingListScreen extended with the purchase origin: the origin is loaded
 * with the pickings (for the origin line on incoming receipts) and included in
 * the picking search text.
 *
 * Registered over the base entry on purpose: `barcodeScreens.add` overwrites
 * and this module depends on barcode_stock, so it loads after the base screen.
 */
export class PurchaseOriginPickingListScreen extends PickingListScreen {
    async loadPickings() {
        const type = this.props.params?.type;
        const warehouseId = this.props.params?.warehouseId;
        const domain = [
            ["picking_type_id.warehouse_id", "=", warehouseId],
            ["picking_type_id.code", "=", type],
            ["state", "not in", ["done", "cancel"]],
        ];
        const fields = [
            "name",
            "partner_id",
            "scheduled_date",
            "state",
            "picking_type_code",
            "purchase_origin",
        ];
        const result = await this.inventory.searchRead(
            "stock.picking",
            domain,
            fields,
            {
                order: "scheduled_date asc",
            }
        );
        this.state.moveStatsByPickingId = await this.loadMoveStats(result);
        this.state.pickings = result;
        this.state.collapsedGroups = {};
        this.computeGroups();
        this.state.loading = false;
    }

    getPickingSearchText(picking) {
        return appendPurchaseOriginToSearchText(
            super.getPickingSearchText(picking),
            picking
        );
    }
}

barcodeScreens.add(
    "picking_list",
    {component: PurchaseOriginPickingListScreen},
    {force: true}
);
