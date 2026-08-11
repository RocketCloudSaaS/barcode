/** @odoo-module **/

import {Component} from "@odoo/owl";

export class PickingDoneCard extends Component {}

PickingDoneCard.template = "barcode_scanner.PickingDoneCard";
PickingDoneCard.props = {
    line: Object,
    onDelete: Function,
};
