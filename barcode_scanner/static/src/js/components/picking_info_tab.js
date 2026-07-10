/** @odoo-module **/

import {Component, markup} from "@odoo/owl";

export class PickingInfoTab extends Component {
    get noteMarkup() {
        const note = this.props.picking?.note;
        return note ? markup(note) : false;
    }

    onSelectResponsible() {
        this.props.onSelectResponsible?.();
    }
}

PickingInfoTab.template = "barcode_scanner.PickingInfoTab";
PickingInfoTab.props = {
    picking: Object,
    pickingTypeCode: {type: String, optional: true},
    progressLabel: {type: String, optional: true},
    onSelectResponsible: {type: Function, optional: true},
};
