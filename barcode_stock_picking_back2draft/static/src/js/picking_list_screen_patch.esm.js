import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";
import {patch} from "@web/core/utils/patch";

patch(PickingListScreen.prototype, {
    async loadPickings() {
        await super.loadPickings();
        const {type, warehouseId} = this.props.params || {};
        if (!warehouseId || !type) {
            return;
        }
        const canceled = await this.inventory.searchRead(
            "stock.picking",
            [
                ["picking_type_id.warehouse_id", "=", warehouseId],
                ["picking_type_id.code", "=", type],
                ["state", "=", "cancel"],
            ],
            ["name", "partner_id", "scheduled_date", "state"],
            {order: "scheduled_date asc"}
        );
        if (!canceled.length) {
            return;
        }
        this.state.moveStatsByPickingId = {
            ...this.state.moveStatsByPickingId,
            ...(await this.loadMoveStats(canceled)),
        };
        this.state.pickings = [...this.state.pickings, ...canceled].sort((a, b) =>
            (a.scheduled_date || "").localeCompare(b.scheduled_date || "")
        );
        this.computeGroups();
    },
});
