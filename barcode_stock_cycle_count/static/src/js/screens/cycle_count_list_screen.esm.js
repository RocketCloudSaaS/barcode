import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";

export class CycleCountListScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.feedback = useService("barcodeScannerFeedback");
        this.state = useState({
            counts: [],
            showAll: false,
            loading: true,
            error: false,
        });
        useBarcodeHandler({
            onScan: async () => {
                this.feedback.warning({
                    message: _t("Select a cycle count from the list."),
                    notify: true,
                });
            },
        });
        onWillStart(() => {
            this.state.showAll = Boolean(this.props.params?.showAll);
            return this.loadCounts();
        });
    }

    async loadCounts() {
        try {
            const result = await this.inventory.call(
                "stock.cycle.count",
                "barcode_get_counts",
                [this.state.showAll]
            );
            this.state.counts = result.counts || [];
            this.state.error = false;
        } catch (error) {
            this.state.error = true;
            this.feedback.error({message: error.message, notify: true});
        } finally {
            this.state.loading = false;
        }
    }

    async toggleShowAll() {
        this.state.showAll = !this.state.showAll;
        this.state.loading = true;
        await this.loadCounts();
    }

    selectCount(count) {
        this.store.navigate("cycle_count_location", {
            cycleCountId: count.id,
            cycleCount: count,
            showAll: this.state.showAll,
        });
    }

    goBack() {
        this.store.goBack();
    }

    static template = "barcode_stock_cycle_count.CycleCountListScreen";
}

barcodeScreens.add("cycle_count_list", {component: CycleCountListScreen});
