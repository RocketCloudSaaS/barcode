/** @odoo-module **/

import {PickingDoneCard} from "@barcode_stock/js/components/picking_done_card.esm";
import {PickingDoneList} from "@barcode_stock/js/components/picking_done_list.esm";
import {PickingMoveCard} from "@barcode_stock/js/components/picking_move_card.esm";
import {PickingMoveList} from "@barcode_stock/js/components/picking_move_list.esm";

PickingMoveList.props = {
    ...PickingMoveList.props,
    onDeleteManual: {type: Function, optional: true},
};

PickingMoveCard.props = {
    ...PickingMoveCard.props,
    onDeleteManual: {type: Function, optional: true},
};

PickingDoneList.props = {
    ...PickingDoneList.props,
    onDeleteManual: {type: Function, optional: true},
};

PickingDoneCard.props = {
    ...PickingDoneCard.props,
    onDeleteManual: {type: Function, optional: true},
};
