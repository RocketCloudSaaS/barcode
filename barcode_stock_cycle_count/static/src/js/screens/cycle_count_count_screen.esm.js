import {Component, onWillStart, useState} from "@odoo/owl";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";
import {barcodeMatchAnyDomain} from "@barcode_scanner/js/utils/scan_match.esm";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";

export class CycleCountCountScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.dialog = useService("dialog");
        this.feedback = useService("barcodeScannerFeedback");
        this.state = useState({
            lines: [],
            loading: true,
            applying: false,
            error: false,
        });
        useBarcodeHandler({
            onScan: (barcode, parsed) => this.onBarcodeScanned(barcode, parsed),
        });
        onWillStart(() => this.loadLines());
    }

    async loadLines() {
        try {
            const result = await this.inventory.call(
                "stock.inventory",
                "barcode_get_cycle_count_lines",
                [this.props.params.inventoryId]
            );
            this.state.lines = (result.lines || []).map((line) => ({
                ...line,
                lot_options: [],
                counted: null,
            }));
            await Promise.all(
                this.state.lines
                    .filter((line) => line.tracking !== "none")
                    .map((line) => this.loadLotOptions(line))
            );
            this.state.error = false;
        } catch (error) {
            this.state.error = true;
            this.feedback.error({message: error.message, notify: true});
        } finally {
            this.state.loading = false;
        }
    }

    async loadLotOptions(line) {
        const lots = await this.inventory.searchRead(
            "stock.lot",
            [["product_id", "=", line.product_id]],
            ["name"]
        );
        line.lot_options = lots.map((lot) => lot.name);
    }

    setLotName(line, value) {
        line.lot_name = value;
    }

    async onBarcodeScanned(barcode, parsed) {
        const candidates = [
            ...(parsed?.productCodes || []),
            parsed?.gtin,
            parsed?.value,
            barcode,
        ];
        const domain = barcodeMatchAnyDomain(candidates);
        const products = domain
            ? await this.inventory.searchRead("product.product", domain, ["id"])
            : [];
        const product = products[0];
        const lotName = parsed?.lot || parsed?.serial || null;
        const line = this.state.lines.find(
            (item) =>
                item.product_id === product?.id &&
                (!lotName || item.lot_name === lotName)
        );
        if (!line) {
            this.feedback.warning({
                message: _t("Product is not part of this count."),
                notify: true,
            });
            return;
        }
        this.setCounted(
            line,
            (parseFloat(line.counted) || 0) +
                (parseFloat(parsed?.quantity ?? parsed?.qty) || 1)
        );
    }

    setCounted(line, value) {
        const quantity = value === "" ? null : Number(value);
        if (quantity !== null && (!Number.isFinite(quantity) || quantity < 0)) {
            this.feedback.warning({
                message: _t("Quantity cannot be negative."),
                notify: true,
            });
            return;
        }
        if (line.tracking === "serial" && quantity > 1) {
            this.feedback.warning({
                message: _t("A serial number can only be counted once."),
                notify: true,
            });
            return;
        }
        line.counted = quantity;
    }

    difference(line) {
        if (line.counted === null) return null;
        const difference = line.counted - line.theoretical_qty;
        const rounding = Number(line.rounding) || 0;
        return rounding && Math.abs(difference) < rounding / 2 ? 0 : difference;
    }

    get countedLines() {
        return this.state.lines.filter((line) => line.counted !== null);
    }

    async apply() {
        const lines = this.countedLines;
        const missingLot = lines.find(
            (line) => line.tracking !== "none" && !line.lot_id
        );
        if (missingLot) {
            this.feedback.warning({
                message: _t("A tracked product must retain its lot or serial."),
                notify: true,
            });
            return;
        }
        if (!lines.length || lines.every((line) => !this.difference(line))) {
            this.confirmZero();
            return;
        }
        await this.callApply(
            lines.filter((line) => this.difference(line)),
            false
        );
    }

    confirmZero() {
        this.dialog.add(ConfirmationDialog, {
            title: _t("No differences"),
            body: _t("Close this cycle count without applying inventory?"),
            confirm: () => this.callClose(),
        });
    }

    async callApply(lines, confirmZero) {
        this.state.applying = true;
        try {
            const result = await this.inventory.call(
                "stock.inventory",
                "barcode_apply_cycle_count",
                [
                    this.props.params.inventoryId,
                    lines.map((line) => ({
                        quant_id: line.quant_id,
                        counted_qty: line.counted,
                    })),
                    confirmZero,
                ]
            );
            this.openDone(result);
        } catch (error) {
            this.state.applying = false;
            this.feedback.error({message: error.message, notify: true});
        }
    }

    async callClose() {
        this.state.applying = true;
        try {
            this.openDone(
                await this.inventory.call(
                    "stock.inventory",
                    "barcode_close_cycle_count",
                    [this.props.params.inventoryId, true]
                )
            );
        } catch (error) {
            this.state.applying = false;
            this.feedback.error({message: error.message, notify: true});
        }
    }

    openDone(result) {
        this.feedback.success({message: _t("Cycle count completed."), notify: true});
        this.store.navigate("cycle_count_done", {
            cycleCountId: result.cycle_count_id,
            cycleCount: this.props.params.cycleCount,
            inventoryId: result.inventory_id,
            appliedCount: result.applied_count,
            accuracy: result.accuracy,
        });
    }

    goBack() {
        this.store.goBack();
    }
    static template = "barcode_stock_cycle_count.CycleCountCountScreen";
}

barcodeScreens.add("cycle_count_count", {component: CycleCountCountScreen});
