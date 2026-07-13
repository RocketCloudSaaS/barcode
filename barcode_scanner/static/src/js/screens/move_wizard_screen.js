/** @odoo-module **/

import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {Component, onMounted, onWillStart, onWillUnmount, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {user} from "@web/core/user";

export class MoveWizardScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.barcodeScannerState = useService("barcodeScannerState");
        this.barcodeScannerSync = useService("barcodeScannerSync");
        this.feedback = useService("barcodeScannerFeedback");
        this.onLotChange = this.onLotChange.bind(this);
        this.setMode = this.setMode.bind(this);
        this.confirmPick = this.confirmPick.bind(this);
        this.goBack = this.goBack.bind(this);
        this.adjustQty = this.adjustQty.bind(this);
        this.setQty = this.setQty.bind(this);
        this.fulfillRemaining = this.fulfillRemaining.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);

        this.state = useState({
            move: null,
            moveLines: [],
            selectedLotId: this.props.params?.defaultLot
                ? String(this.props.params.defaultLot)
                : null,
            qtyPicked: this.props.params?.defaultQty || 1,
            loading: true,
            tracking: "none",
            mode:
                this.props.params?.createLot && this.isIncoming ? "create_lot" : "pick",
            newLotName: this.props.params?.lotName || "",
            newLotExpirationDate: this.props.params?.expiration || "",
            lots: [],
            useExistingLots: true,
            useCreateLots: true,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            await this.loadData();
        });

        onMounted(() => {
            document.addEventListener("keydown", this.onKeyDown);
        });

        onWillUnmount(() => {
            document.removeEventListener("keydown", this.onKeyDown);
        });
    }

    async onBarcodeScanned(barcode, parsedData) {
        const scanValue = parsedData?.value || barcode;
        if (!scanValue) return;

        const product = this.barcodeScannerState.getProductByBarcode(scanValue);
        if (product) {
            if (product.id === this.state.move?.product_id?.[0]) {
                this.adjustQty(1);
                this.feedback.success();
            } else {
                this.onProductScanned(product);
            }
            return;
        }
    }

    get isIncoming() {
        return this.props.params?.pickingTypeCode === "incoming";
    }

    get moveId() {
        return this.props.params?.moveId;
    }

    get pickingId() {
        return this.props.params?.pickingId;
    }

    get listParams() {
        return this.props.params?.listParams || null;
    }

    get demandQty() {
        return this.state.move?.quantity || this.state.move?.product_uom_qty || 0;
    }

    get doneQty() {
        return Math.max(this.demandQty - this.remainingQty, 0);
    }

    get remainingQty() {
        return this.barcodeScannerState.getRemainingQty(this.moveId);
    }

    get canDecrement() {
        if (this.isSerial) return false;
        return (this.state.qtyPicked || 0) > 0;
    }

    get canIncrement() {
        if (this.isSerial) {
            return this.state.qtyPicked < 1 && !this.selectedLotIdNumber;
        }
        return this.state.qtyPicked < this.remainingQty;
    }

    get canFulfill() {
        if (this.isSerial) return false;
        return this.remainingQty - (this.state.qtyPicked || 0) > 1;
    }

    get fulfillIncrement() {
        return Math.max(this.remainingQty - (this.state.qtyPicked || 0), 0);
    }

    get isTracked() {
        return this.state.tracking !== "none";
    }

    get hasLotGroup() {
        return user.hasGroup("stock.group_production_lot");
    }

    get isSerial() {
        return this.state.tracking === "serial";
    }

    get canCreateLot() {
        return this.isIncoming && this.isTracked && this.state.useCreateLots;
    }

    get canUseExistingLot() {
        return this.isTracked && this.state.useExistingLots;
    }

    get selectedLotIdNumber() {
        const lotId = parseInt(this.state.selectedLotId, 10);
        return Number.isNaN(lotId) ? null : lotId;
    }

    get selectedLot() {
        return (
            this.state.lots.find((lot) => lot.id === this.selectedLotIdNumber) || null
        );
    }

    get realLots() {
        return (this.state.lots || []).filter((lot) => lot.id > 0);
    }

    get headerEyebrow() {
        return this.isIncoming ? _t("Reception task") : _t("Picking task");
    }

    get headerSubtitle() {
        if (this.state.mode === "create_lot") {
            return _t("Create the lot first, then confirm the move in one pass.");
        }
        if (this.isTracked) {
            return _t("Select the correct lot or serial and confirm the quantity.");
        }
        return _t("Confirm the quantity and return to the picking queue.");
    }

    get trackingLabel() {
        const labels = {
            none: _t("No tracking"),
            lot: _t("Lot tracked"),
            serial: _t("Serial tracked"),
        };
        return labels[this.state.tracking] || _t("Tracking");
    }

    get lotFieldLabel() {
        return this.isSerial ? _t("Serial number") : _t("Lot number");
    }

    get quantityHelper() {
        if (this.isSerial) {
            return _t("Serial-tracked products can only process one unit.");
        }
        return `${this.remainingQty} ${_t("remaining to process")}`;
    }

    get confirmLabel() {
        return this.state.mode === "create_lot"
            ? _t("Create lot & confirm")
            : _t("Confirm move");
    }

    get backLabel() {
        return this.state.mode === "create_lot" ? _t("Back to pick") : _t("Back");
    }

    get modeDescription() {
        return this.state.mode === "create_lot"
            ? _t("Register a new lot before assigning the picked quantity.")
            : _t("Use an existing lot or serial already available for this product.");
    }

    get selectedLotExpirationLabel() {
        return this.selectedLot?.expiration_date || _t("No expiration date");
    }

    get selectedLotQtyLabel() {
        const qty = this.selectedLot?.product_qty;
        if (qty === undefined || qty === null || qty === false) {
            return _t("Qty unavailable");
        }
        return `${qty} ${_t("on hand")}`;
    }

    get quantityInputMax() {
        return this.isSerial ? 1 : undefined;
    }

    get todayDate() {
        return new Date().toISOString().split("T")[0];
    }

    getTodayStart() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        return today;
    }

    isLotExpired(lot) {
        if (!lot?.expiration_date) {
            return false;
        }
        const expiration = new Date(lot.expiration_date);
        expiration.setHours(0, 0, 0, 0);
        return expiration < this.getTodayStart();
    }

    setMode(mode) {
        if (mode === "create_lot" && !this.canCreateLot) {
            return;
        }
        this.state.mode = mode;
    }

    adjustQty(delta) {
        if (this.state.loading) return;
        const next = (parseFloat(this.state.qtyPicked) || 0) + delta;
        if (this.isSerial) {
            this.state.qtyPicked = Math.max(0, Math.min(1, next));
        } else {
            this.state.qtyPicked = Math.max(0, Math.min(this.remainingQty, next));
        }
        this.state._lastInputSource = "tap";
    }

    setQty(value) {
        const qty = parseFloat(value);
        if (Number.isNaN(qty) || qty < 0) {
            this.state.qtyPicked = 0;
            return;
        }
        const max = this.isSerial ? 1 : this.remainingQty;
        this.state.qtyPicked = Math.min(qty, max);
        this.state._lastInputSource = "tap";
    }

    fulfillRemaining() {
        if (!this.canFulfill) return;
        this.state.qtyPicked = this.remainingQty;
        this.state._lastInputSource = "tap";
        this.feedback.success({
            message: _t("Remaining quantity applied"),
            notify: true,
        });
    }

    onProductScanned(product) {
        if (!product) return;
        const moveProductId = this.state.move?.product_id?.[0];
        if (product.id === moveProductId) {
            this.feedback.success();
            return;
        }
        this.inventory.notify(
            _t(
                "Scanned product doesn't match this move (%(expected)s expected, got %(got)s)",
                {
                    expected: this.state.move?.product_id?.[1] || "",
                    got: product.display_name,
                }
            ),
            {type: "warning"}
        );
        this.feedback.warning();
    }

    onKeyDown(ev) {
        if (ev.target?.matches?.("input,textarea,[contenteditable]")) {
            return;
        }
        if (ev.key === "ArrowUp") {
            ev.preventDefault();
            this.adjustQty(1);
        } else if (ev.key === "ArrowDown") {
            ev.preventDefault();
            this.adjustQty(-1);
        } else if (ev.key === "f" || ev.key === "F") {
            if (this.canFulfill) {
                ev.preventDefault();
                this.fulfillRemaining();
            }
        }
    }

    onLotChange(ev) {
        this.state.selectedLotId = ev.target.value || null;
    }

    async loadData() {
        if (
            !this.barcodeScannerState.ready ||
            this.barcodeScannerState.activePickingId !== this.pickingId
        ) {
            await this.barcodeScannerState.preloadPicking(this.pickingId);
        }
        const moveId = this.moveId;
        const move = this.barcodeScannerState.getMove(moveId);
        const product = this.barcodeScannerState.getProduct(move.product_id[0]);
        const moveLines = this.barcodeScannerState.getMoveLinesForMove(moveId);

        this.state.useExistingLots = this.barcodeScannerState.useExistingLots;
        this.state.useCreateLots = this.barcodeScannerState.useCreateLots;

        let lots = this.barcodeScannerState.getLotsForProduct(move.product_id[0], {
            onlyAvailable: !this.isIncoming,
            excludeExpired: false,
        });

        if (!this.state.useExistingLots) {
            lots = [];
        }

        const defaultLotId = this.selectedLotIdNumber;
        if (defaultLotId && !lots.some((lot) => lot.id === defaultLotId)) {
            const defaultLot = this.barcodeScannerState.lotsById[defaultLotId];
            if (defaultLot) {
                lots = [defaultLot, ...lots];
            }
        }

        this.state.move = move;
        this.state.moveLines = moveLines;
        this.state.tracking = product.tracking;

        if (this.isTracked && this.isIncoming) {
            if (this.state.useCreateLots && !this.state.useExistingLots) {
                this.state.mode = "create_lot";
            } else if (this.state.useExistingLots && !this.state.useCreateLots) {
                this.state.mode = "pick";
            }
        }
        this.state.lots = lots || [];
        this.state.loading = false;
    }

    async ensureLotCreated() {
        if (!this.state.newLotName) {
            this.inventory.notify(_t("Lot name required"), {type: "danger"});
            return null;
        }
        if (
            this.isSerial &&
            this.state.lots.some(
                (lot) => lot.name?.toLowerCase() === this.state.newLotName.toLowerCase()
            )
        ) {
            this.inventory.notify(_t("Serial already exists for this product."), {
                type: "danger",
            });
            return null;
        }
        const lot = this.barcodeScannerState.stageLotCreate({
            productId: this.state.move.product_id[0],
            name: this.state.newLotName,
            expirationDate: this.state.newLotExpirationDate || false,
        });
        this.state.lots = [
            ...this.state.lots.filter((item) => item.id !== lot.id),
            lot,
        ];
        this.state.selectedLotId = String(lot.id);
        return lot;
    }

    async confirmPick() {
        if (this.state.mode === "create_lot" && !this.isIncoming) {
            this.inventory.notify(_t("Lots can only be created in receptions"), {
                type: "danger",
            });
            return;
        }
        if (this.state.mode === "create_lot" && !this.state.selectedLotId) {
            const lot = await this.ensureLotCreated();
            if (!lot) {
                return;
            }
        }
        if (!this.state.qtyPicked || this.state.qtyPicked <= 0) {
            this.inventory.notify(_t("Invalid quantity"), {type: "danger"});
            return;
        }
        if (
            this.state.tracking === "serial" &&
            parseFloat(this.state.qtyPicked) !== 1
        ) {
            this.inventory.notify(
                _t("Serial-tracked products must have a quantity of 1."),
                {type: "danger"}
            );
            return;
        }
        if (
            this.state.tracking !== "none" &&
            (this.canUseExistingLot || this.canCreateLot) &&
            !this.selectedLotIdNumber &&
            this.state.mode !== "create_lot"
        ) {
            this.inventory.notify(_t("Please select a lot"), {type: "danger"});
            return;
        }

        const guardrailError = this.barcodeScannerSync.validateConfirmMovePayload({
            productId: this.state.move.product_id[0],
            lotId: this.selectedLotIdNumber || false,
            lotName: this.selectedLot
                ? this.selectedLot.name
                : this.state.newLotName || false,
            qtyPicked: this.state.qtyPicked,
            createLot: this.state.mode === "create_lot",
            expirationDate: this.state.newLotExpirationDate || false,
            moveId: this.moveId,
        });
        if (guardrailError) {
            this.inventory.notify(guardrailError.message, {type: "danger"});
            return;
        }
        const lot = this.selectedLot;
        if (this.isLotExpired(lot)) {
            this.inventory.notify(_t("Lot expired"), {type: "danger"});
            return;
        }

        await this.barcodeScannerSync.confirmMove({
            moveId: this.moveId,
            pickingId: this.pickingId,
            productId: this.state.move.product_id[0],
            qtyPicked: this.state.qtyPicked,
            lotId: this.selectedLotIdNumber || false,
            lotName: lot ? lot.name : this.state.newLotName || false,
            createLot: this.state.mode === "create_lot",
            expirationDate: this.state.newLotExpirationDate || false,
            locationId: this.state.move.location_id[0],
            locationDestId: this.state.move.location_dest_id[0],
        });
        this.store.navigate(
            "picking",
            {
                pickingId: this.pickingId,
                listParams: this.listParams,
                reloadToken: Date.now(),
            },
            {replace: true}
        );
    }

    async goBack() {
        if (this.state.mode === "create_lot") {
            this.setMode("pick");
            return;
        }

        this.store.navigate(
            "picking",
            {
                pickingId: this.pickingId,
                listParams: this.listParams,
                reloadToken: Date.now(),
            },
            {replace: true}
        );
    }

    toggleCreateLot() {
        this.setMode(this.state.mode === "pick" ? "create_lot" : "pick");
    }
}

MoveWizardScreen.template = "barcode_scanner.MoveWizardScreen";
MoveWizardScreen.props = {
    params: {type: Object, optional: true},
    navigate: {type: Function, optional: true},
};
