/** @odoo-module **/

import {Component} from "@odoo/owl";

export class PickingInfoTab extends Component {}

PickingInfoTab.template = "barcode_scanner.PickingInfoTab";
PickingInfoTab.props = {
    picking: Object,
    pickingTypeCode: {type: String, optional: true},
    responsible_name: {type: String, optional: true},
    progressLabel: {type: String, optional: true},
    onOpenEmployeeSelector: Function,
};
