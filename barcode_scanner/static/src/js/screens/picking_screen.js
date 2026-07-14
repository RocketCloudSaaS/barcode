/** @odoo-module **/

import {Component, onWillStart, onWillUpdateProps, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {ConfirmationDialog} from "@web/core/confirmation_dialog/confirmation_dialog";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {PickingInfoTab} from "@barcode_scanner/js/components/picking_info_tab";
import {PickingMoveList} from "@barcode_scanner/js/components/picking_move_list";
import {PickingDoneList} from "@barcode_scanner/js/components/picking_done_list";

export class PickingScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.action = useService("action");
        this.dialog = useService("dialog");
        this.feedback = useService("barcodeScannerFeedback");
        this.barcodeScannerState = useService("barcodeScannerState");
        this.barcodeScannerSync = useService("barcodeScannerSync");
        this.setTab = this.setTab.bind(this);
        this.deleteMoveLine = this.deleteMoveLine.bind(this);
        this.openMoveWizard = this.openMoveWizard.bind(this);
        this.onBarcodeScanned = this.onBarcodeScanned.bind(this);
        useBarcodeHandler({
            onScan: (barcode, parsedData, payload) => {
                this.onBarcodeScanned(barcode, parsedData, payload);
            },
        });

        this.selectResponsible = this.selectResponsible.bind(this);

        this.state = useState({
            picking: null,
            moves: [],
            moveLines: [],
            activeTab: "todo",
            isValidating: false,
            isSaving: false,
            pickingTypeCode: null,
            highlightedMoveId: null,
            lastScan: {
                barcode: "",
                source: "",
                tone: "idle",
                message: _t("Scanner ready for this picking."),
                productName: "",
                lotName: "",
                quantity: 0,
                timestamp: null,
            },
        });

        onWillStart(async () => {
            try {
                const responsible = this.props.params?.responsible;
                if (responsible && responsible.id && this.pickingId) {
                    await this.inventory.write(
                        "stock.picking",
                        [this.pickingId],
                        {user_id: responsible.id}
                    );
                }
                await this.loadData({force: true});
                if (responsible && responsible.id) {
                    this.state.activeTab = "info";
                    this.inventory.notify(
                        `Responsible set to ${responsible.name}`,
                        {type: "success"}
                    );
                }
            } catch (error) {
                this.inventory.notify("Error loading picking: " + error, {
                    type: "danger",
                });
            }
        });

        onWillUpdateProps(async (nextProps) => {
            const currentId = this.props.pickingId || this.props.params?.pickingId;
            const nextId = nextProps.pickingId || nextProps.params?.pickingId;
            const currentReloadToken =
                this.props.reloadToken || this.props.params?.reloadToken;
            const nextReloadToken =
                nextProps.reloadToken || nextProps.params?.reloadToken;

            if (currentId !== nextId || currentReloadToken !== nextReloadToken) {
                await this.loadData({force: true});
            }
        });
    }

    get pickingId() {
        return this.props.pickingId || this.props.params?.pickingId;
    }

    get listParams() {
        return this.props.listParams || this.props.params?.listParams || null;
    }

    get operationLabel() {
        const labels = {
            incoming: _t("Receipt"),
            internal: _t("Internal Transfer"),
            outgoing: _t("Delivery Order"),
        };
        return labels[this.state.pickingTypeCode] || _t("Picking");
    }

    get doneLines() {
        return this.state.moveLines.filter((line) => (line.qty_picked || 0) > 0);
    }

    get moveStatsById() {
        const moveLineTotals = this.state.moveLines.reduce((totals, line) => {
            const moveId = line.move_id?.[0];
            if (!moveId) {
                return totals;
            }
            totals[moveId] = (totals[moveId] || 0) + (line.qty_picked || 0);
            return totals;
        }, {});

        return Object.fromEntries(
            this.state.moves.map((move) => {
                const demandQty = move.product_uom_qty || move.quantity || 0;
                const reservedQty = move.quantity || 0;
                const doneQty = moveLineTotals[move.id] || 0;
                const remainingQty = Math.max(reservedQty - doneQty, 0);
                const completion = demandQty ? Math.min(doneQty / demandQty, 1) : 0;
                return [
                    move.id,
                    {
                        demandQty,
                        doneQty,
                        remainingQty,
                        completion,
                        completionLabel: `${Math.round(completion * 100)}%`,
                    },
                ];
            })
        );
    }

    get pendingMovesCount() {
        return this.state.moves.filter(
            (move) => (this.moveStatsById[move.id]?.remainingQty || 0) > 0
        ).length;
    }

    get completedMovesCount() {
        return this.state.moves.filter(
            (move) => (this.moveStatsById[move.id]?.remainingQty || 0) <= 0
        ).length;
    }

    get progressSummary() {
        const summary = Object.values(this.moveStatsById).reduce(
            (acc, stats) => {
                acc.demandQty += stats.demandQty || 0;
                acc.doneQty += stats.doneQty || 0;
                acc.remainingQty += stats.remainingQty || 0;
                return acc;
            },
            {demandQty: 0, doneQty: 0, remainingQty: 0}
        );
        summary.percent = summary.demandQty
            ? Math.round((summary.doneQty / summary.demandQty) * 100)
            : 0;
        return summary;
    }

    get summaryCards() {
        return [
            {
                key: "pending",
                label: _t("Pending moves"),
                value: this.pendingMovesCount,
                tone: "warning",
            },
            {
                key: "done",
                label: _t("Done lines"),
                value: this.doneLines.length,
                tone: "success",
            },
            {
                key: "progress",
                label: _t("Progress"),
                value: `${this.progressSummary.percent}%`,
                tone: "info",
            },
        ];
    }

    setLastScanContext({
        barcode = "",
        source = "hardware",
        tone = "info",
        message = "",
        move = null,
        quantity = 0,
        lotName = "",
    } = {}) {
        this.state.lastScan = {
            barcode,
            source,
            tone,
            message,
            productName: move?.product_id?.[1] || "",
            lotName,
            quantity,
            timestamp: Date.now(),
        };
        this.state.highlightedMoveId = move?.id || null;
        if (move) {
            this.state.activeTab = "todo";
        }
    }

    async loadData({force = false} = {}) {
        const pickingId = this.pickingId;
        if (
            force ||
            !(
                this.barcodeScannerState.ready &&
                this.barcodeScannerState.activePickingId === pickingId
            )
        ) {
            await this.barcodeScannerState.preloadPicking(pickingId);
        }
        const snapshot = this.barcodeScannerState.getSnapshot();
        const picking = snapshot.picking || {};
        this.state.pickingTypeCode = snapshot.pickingTypeCode;
        this.state.moves = await this.buildMovesWithLots(snapshot.moves || []);
        this.state.picking = {...picking};
        this.state.moveLines = [...(snapshot.moveLines || [])];
        if (picking.scheduled_date) {
            this.state.picking.scheduled_date = picking.scheduled_date
                .replace(" ", "T")
                .slice(0, 16);
        }
    }

    setTab(tab) {
        this.state.activeTab = tab;
    }

    goBack() {
        this.store.goBack();
    }

    selectResponsible() {
        this.store.navigate("user_selector", {
            returnRoute: "picking",
            returnParams: {
                pickingId: this.pickingId,
                listParams: this.listParams,
            },
        });
    }

    async savePicking() {
        if (!this.state.picking?.id) return;
        this.state.isSaving = true;
        try {
            await this.barcodeScannerSync.stagePicking(
                {
                    scheduled_date: this.state.picking.scheduled_date || false,
                    note: this.state.picking.note || false,
                },
                {immediate: true}
            );
            this.inventory.notify("Changes saved successfully", {
                type: "success",
            });
        } catch (error) {
            this.inventory.notify("Error while saving", {
                type: "danger",
            });
        } finally {
            this.state.isSaving = false;
        }
    }

    async validatePicking() {
        if (!this.state.picking?.id) return;

        if (!this.checkAnyMoveLineWithQty()) {
            this.inventory.notify("Please add at least one product to validate.", {
                type: "danger",
            });
            return;
        }

        const guardrailErrors = this.barcodeScannerSync.validatePickingForConfirm();
        if (guardrailErrors.length > 0) {
            for (const err of guardrailErrors) {
                this.inventory.notify(err.message, {type: "danger"});
            }
            return;
        }

        this.state.isValidating = true;
        try {
            await this.savePicking();
            const action = await this.inventory.call(
                "stock.picking",
                "button_validate",
                [this.state.picking.id],
                {context: {active_ids: [this.state.picking.id]}}
            );
            if (action && action.type === "ir.actions.act_window" && action.res_model === "stock.backorder.confirmation") {
                await this.action.doAction(action, {
                    onClose: () => {
                        this.store.navigate("picking_list", this.listParams || {});
                    },
                });
            } else if (action && action.type === "ir.actions.act_window") {
                await this.action.doAction(action);
                await this.loadData({force: true});
            } else {
                await this.loadData({force: true});
            }
        } catch (error) {
            this.inventory.notify("Validation failed: " + error.message, {
                type: "danger",
            });
        } finally {
            this.state.isValidating = false;
        }
    }

    async _reloadMoves() {
        await this.loadData({force: true});
    }

    async cancelReservation() {
        this.dialog.add(ConfirmationDialog, {
            title: "Confirm cancel reservations",
            body: "Are you sure you want to cancel reservations?",
            confirm: async () => {
                try {
                    await this.inventory.write(
                        "stock.move.line",
                        this.state.moveLines.map((ml) => ml.id),
                        {qty_picked: 0}
                    );
                    await this.inventory.call("stock.picking", "do_unreserve", [
                        [this.pickingId],
                    ]);
                    this.inventory.notify("Cancel Reservation successfully", {
                        type: "success",
                    });
                } catch (error) {
                    this.inventory.notify("Cancel Reservation error: " + error, {
                        type: "error",
                    });
                }
                await this._reloadMoves();
            },
        });
    }

    async checkAvailability() {
        this.dialog.add(ConfirmationDialog, {
            title: "Confirm availability check",
            body: "Are you sure you want to check availability?",
            confirm: async () => {
                try {
                    await this.inventory.call("stock.picking", "action_assign", [
                        [this.pickingId],
                    ]);
                    this.inventory.notify("Availability check successful.", {
                        type: "success",
                    });
                    await this._reloadMoves();
                } catch (error) {
                    this.inventory.notify("Availability check error: " + error, {
                        type: "error",
                    });
                }
            },
        });
    }

    openMoveWizard(move, defaults = {}) {
        if (move.quantity === 0) {
            this.inventory.notify("This move has no quantity to process.", {
                type: "warning",
            });
            return;
        }
        this.store.navigate("move_wizard", {
            moveId: move.id,
            pickingId: this.state.picking.id,
            pickingTypeCode: this.state.pickingTypeCode,
            defaultQty: defaults.qty || 1,
            defaultLot: defaults.lot || null,
            lotName: defaults.lotName || null,
            expiration: defaults.expiration || null,
            createLot: defaults.createLot || false,
            listParams: this.listParams,
        });
    }

    async deleteMoveLine(moveLineId) {
        this.dialog.add(ConfirmationDialog, {
            title: "Confirm deletion",
            body: "Are you sure you want to delete this movement?",
            confirm: async () => {
                await this.barcodeScannerSync.resetMoveLine(moveLineId, {
                    immediate: true,
                });
                this.state.moveLines = this.state.moveLines.filter(
                    (l) => l.id !== moveLineId
                );
                await this._reloadMoves();
            },
        });
    }

    async createMoveLine(moveId, productId, qty, lotId = null) {
        const move = this.barcodeScannerState.getMove(moveId);
        const lot = lotId ? this.barcodeScannerState.lotsById[lotId] : null;
        await this.barcodeScannerSync.confirmMove({
            moveId,
            pickingId: this.state.picking.id,
            productId,
            qtyPicked: qty,
            lotId: lotId || false,
            lotName: lot?.name || false,
            locationId: move?.location_id?.[0] || false,
            locationDestId: move?.location_dest_id?.[0] || false,
        });

        await this._reloadMoves();

        this.inventory.notify("Product updated", {
            type: "success",
        });
    }

    async handleEAN13(barcode, preselectedMove = null) {
        if (preselectedMove) {
            this.setLastScanContext({
                barcode,
                tone: "success",
                message: _t("Product matched and ready to confirm."),
                move: preselectedMove,
                quantity: 1,
            });
            this.openMoveWizard(preselectedMove, {
                qty: 1,
            });
            return;
        }
        const products = await this.inventory.searchRead(
            "product.product",
            [["barcode", "=", barcode]],
            ["display_name", "tracking"]
        );
        if (!products.length) {
            this.setLastScanContext({
                barcode,
                tone: "warning",
                message: _t("Scanned product was not found."),
            });
            this.inventory.notify("Product not found", {type: "danger"});
            return;
        }
        const product = products[0];
        const move = this.state.moves.find((m) => m.product_id?.[0] === product.id);
        if (!move) {
            this.setLastScanContext({
                barcode,
                tone: "warning",
                message: _t("This product is not reserved for this picking."),
            });
            this.inventory.notify("Product not reserved", {
                type: "warning",
            });
            return;
        }
        this.setLastScanContext({
            barcode,
            tone: "success",
            message: _t("Product matched and ready to confirm."),
            move,
            quantity: 1,
        });
        this.openMoveWizard(move, {
            qty: 1,
        });
    }

    onBarcodeScanned(barcode, parsedData = null, payload = {}) {
        this.handleBarcode(barcode, parsedData, payload);
    }

    async handleBarcode(barcode, parsedData = null, payload = {}) {
        const normalized = this.barcodeScannerState.applyScanResult({
            barcode,
            ...(parsedData || {}),
        });
        const candidateMove = normalized.candidates[0] || null;
        if (!normalized.candidates.length) {
            this.setLastScanContext({
                barcode,
                source: payload?.source || "hardware",
                tone: "warning",
                message: _t("Scanned barcode is not part of the current picking."),
            });
            this.feedback.warning({
                notify: true,
                message: _t("Scanned barcode is not part of the current picking."),
            });
            return;
        }

        const productId = candidateMove.product_id?.[0];
        const tracking = this.barcodeScannerState.indexes.trackingByProductId[productId];
        if (tracking === "none") {
            const existingLine = this.state.moveLines.find(
                (line) =>
                    line.move_id?.[0] === candidateMove.id &&
                    line.product_id?.[0] === productId &&
                    (line.qty_picked || 0) > 0
            );
            if (existingLine) {
                const newQty = (existingLine.qty_picked || 0) + 1;
                await this.barcodeScannerSync.confirmMove({
                    moveId: candidateMove.id,
                    pickingId: this.state.picking.id,
                    productId,
                    qtyPicked: newQty,
                    lotId: false,
                    lotName: false,
                    locationId: candidateMove.location_id?.[0] || false,
                    locationDestId: candidateMove.location_dest_id?.[0] || false,
                });
                this.setLastScanContext({
                    barcode,
                    source: payload?.source || "hardware",
                    tone: "success",
                    message: _t("Quantity incremented to %(qty)s.", {qty: newQty}),
                    move: candidateMove,
                    quantity: newQty,
                });
                this.feedback.success({
                    notify: true,
                    message: _t("Quantity incremented to %(qty)s.", {qty: newQty}),
                });
                await this._reloadMoves();
                return;
            }
        }

        await this.handleEAN13(barcode, candidateMove);
        if (payload?.source === "camera" && candidateMove) {
            this.feedback.success();
        }
    }

    async buildMovesWithLots(moves) {
        const lotsMap = Object.fromEntries(
            Object.values(this.barcodeScannerState.lotsById).map((lot) => [
                lot.id,
                lot.name,
            ])
        );
        return moves.map((move) => ({
            ...move,
            lot_names: (move.lot_ids || []).map((id) => lotsMap[id]),
        }));
    }

    checkAnyMoveLineWithQty() {
        return this.state.moveLines.some((line) => line.qty_picked > 0);
    }
}

PickingScreen.template = "barcode_scanner.PickingScreen";
PickingScreen.components = {PickingInfoTab, PickingMoveList, PickingDoneList};
