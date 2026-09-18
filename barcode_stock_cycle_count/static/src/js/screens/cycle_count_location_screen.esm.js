import {Component, onWillStart, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {errorMessage} from "@barcode_scanner/js/api.esm";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {barcodeMatchDomain} from "@barcode_scanner/js/utils/scan_match.esm";

export class CycleCountLocationScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.dialog = useService("dialog");
        this.feedback = useService("barcodeScannerFeedback");
        this.state = useState({
            count: null,
            confirmed: false,
            loading: true,
            starting: false,
            startError: null,
        });
        useBarcodeHandler({
            onScan: (barcode, parsed) => this.onBarcodeScanned(barcode, parsed),
        });
        onWillStart(() => {
            this.state.count = this.props.params?.cycleCount || null;
            this.state.loading = false;
        });
    }

    async confirmStart() {
        if (this.state.starting) return;
        this.state.starting = true;
        this.state.startError = null;
        try {
            const result = await this.inventory.call(
                "stock.cycle.count",
                "barcode_confirm",
                [this.props.params.cycleCountId]
            );
            this.feedback.success({message: _t("Cycle count started."), notify: true});
            this.state.count = {
                ...this.props.params.cycleCount,
                ...result.cycle_count,
            };
            this.state.confirmed = true;
            this.state.inventoryId = result.inventory.id;
        } catch (error) {
            const message = errorMessage(
                error,
                _t("Unable to start the cycle count.")
            );
            this.state.startError = this.describeStartError(message);
            // barcodeApi already shows the safe server message as a notification.
            // Keep scanner feedback without adding a duplicate notification.
            this.feedback.error({
                message,
                notify: false,
            });
        } finally {
            this.state.starting = false;
        }
    }

    describeStartError(message) {
        const locationMarker = "using one requested Location:";
        const blockersMarker = "Blocking adjustments:";
        const locationStart = message.indexOf(locationMarker);
        const blockersStart = message.indexOf(blockersMarker);
        if (locationStart !== -1 && blockersStart > locationStart) {
            const location = message
                .slice(locationStart + locationMarker.length, blockersStart)
                .trim()
                .replace(/\.$/, "");
            const blockers = message.slice(blockersStart + blockersMarker.length).trim();
            if (location && blockers) {
                return {
                    type: "blocked",
                    title: _t("Location already in use"),
                    message: _t(
                        "Another inventory adjustment is still in progress for this location."
                    ),
                    location,
                    blockers,
                    action: _t(
                        "Complete or cancel the blocking adjustment in Inventory, then try again."
                    ),
                };
            }
        }
        return {
            type: "error",
            title: _t("The cycle count could not start"),
            message: _t("Review the message below, resolve the issue, and try again."),
            detail: message,
        };
    }

    async onBarcodeScanned(barcode, parsed) {
        if (!this.state.confirmed) return;
        const code = parsed?.value || barcode;
        const domain = barcodeMatchDomain(code);
        if (!domain) {
            this.feedback.warning({
                message: _t("Scan the expected location."),
                notify: true,
            });
            return;
        }
        let locations = [];
        try {
            locations = await this.inventory.searchRead("stock.location", domain, [
                "id",
                "display_name",
            ]);
        } catch (error) {
            this.feedback.error({message: error.message, notify: true});
            return;
        }
        if (!locations.length) {
            this.feedback.warning({
                message: _t("Unknown location barcode."),
                notify: true,
            });
            return;
        }
        try {
            await this.inventory.call(
                "stock.cycle.count",
                "barcode_validate_location",
                [this.props.params.cycleCountId, locations[0].id]
            );
            this.feedback.success({message: _t("Location confirmed."), notify: true});
            this.goToCount();
        } catch (error) {
            this.feedback.warning({message: error.message, notify: true});
        }
    }

    skipLocation() {
        this.dialog.add(ConfirmationDialog, {
            title: _t("Continue without scanning?"),
            body: _t("Continue with the planned cycle-count location?"),
            confirm: () => this.goToCount(),
        });
    }

    goToCount() {
        this.store.navigate("cycle_count_count", {
            cycleCountId: this.props.params.cycleCountId,
            cycleCount: this.state.count,
            inventoryId: this.state.inventoryId,
            expectedLocationId: this.state.count.location_id,
            expectedLocationName: this.state.count.location_name,
            showAll: this.props.params.showAll,
        });
    }

    goBack() {
        this.store.goBack();
    }

    static template = "barcode_stock_cycle_count.CycleCountLocationScreen";
}

barcodeScreens.add("cycle_count_location", {component: CycleCountLocationScreen});
