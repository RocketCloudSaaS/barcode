/** @odoo-module **/

import {Component} from "@odoo/owl";

export class PickingInfoTab extends Component {
    get showQualityReason() {
        const picking = this.props.picking;
        if (!picking) {
            return false;
        }
        return !picking.correct_temperature || !picking.state_of_the_van;
    }

    get qualityStateLabel() {
        return this.props.picking?.quality_check ? "Ready" : "Issue to review";
    }
}

PickingInfoTab.template = "barcode_scanner.PickingInfoTab";
PickingInfoTab.props = {
    picking: Object,
    pickingTypeCode: {type: String, optional: true},
    qualityControlEnabled: {type: Boolean, optional: true},
    responsible_name: {type: String, optional: true},
    progressLabel: {type: String, optional: true},
    onOpenEmployeeSelector: Function,
    onUpdateQualityState: Function,
    onTakePicture: Function,
    onOpenImageViewer: Function,
};
