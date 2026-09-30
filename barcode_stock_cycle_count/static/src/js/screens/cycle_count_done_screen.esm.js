import {Component} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";

export class CycleCountDoneScreen extends Component {
    setup() {
        this.store = useService("barcodeStore");
    }

    backToList() {
        this.store.navigate(
            "cycle_count_list",
            {
                showAll: this.props.params.showAll,
            },
            {clearHistory: true}
        );
    }

    static template = "barcode_stock_cycle_count.CycleCountDoneScreen";
}

barcodeScreens.add("cycle_count_done", {component: CycleCountDoneScreen});
