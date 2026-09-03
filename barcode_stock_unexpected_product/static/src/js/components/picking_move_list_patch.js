/** @odoo-module **/
import {PickingMoveList} from "@barcode_stock/js/components/picking_move_list";
import {PickingMoveCard} from "@barcode_stock/js/components/picking_move_card";

PickingMoveList.props = {
    ...PickingMoveList.props,
    onDeleteManual: {type: Function, optional: true},
};

PickingMoveCard.props = {
    ...PickingMoveCard.props,
    onDeleteManual: {type: Function, optional: true},
};
