/** @odoo-module **/

import {Component, onWillStart, useEffect, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {scanBarcode} from "@web/core/barcode/barcode_dialog";

const GROUP_ORDER = ["date", "state"];
const FILTER_ORDER = ["state", "date"];
const FILTER_DEFAULTS = {state: "all", date: null};
const FILTER_LABELS = {state: _t("Status"), date: _t("Date")};

const EMPTY_MOVE_STATS = {
    skuCount: 0,
    demandQty: 0,
    doneQty: 0,
    remainingQty: 0,
};

const OPERATION_LABELS = {
    incoming: _t("Receipts"),
    internal: _t("Internal Transfers"),
    outgoing: _t("Delivery Orders"),
};

export class PickingListScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.feedback = useService("barcodeScannerFeedback");
        this.state = useState({
            pickings: [],
            moveStatsByPickingId: {},
            groupedPickings: {},
            loading: true,
            groupByLevels: [],
            collapsedGroups: {},
            search: "",
            stateLabels: {},
            activeFilters: [],
            filterValues: {state: "all", date: null},
        });
        this.groupLabels = {
            state: _t("Status"),
            date: _t("Date"),
        };
        this.filterLabels = FILTER_LABELS;

        useBarcodeHandler({
            onScan: (barcode) => this.onBarcodeScanned(barcode),
        });

        onWillStart(async () => {
            await this.loadStateLabels();
            await this.loadPickings();
        });

        this.openPicking = (id) => {
            this.store.navigate("picking", {
                pickingId: id,
                listParams: this.props.params,
            });
        };

        useEffect(
            () => {
                this.computeGroups();
                const collapsed = {};
                const groups = this.state.groupedPickings;
                const keys = Object.keys(groups);
                keys.forEach((key, index) => {
                    collapsed["root-" + key] = this.state.search ? false : index !== 0;
                });
                this.state.collapsedGroups = collapsed;
            },
            () => [
                this.state.pickings,
                this.state.groupByLevels,
                this.state.search,
                this.state.activeFilters,
                this.state.filterValues.state,
                this.state.filterValues.date,
            ]
        );
    }

    async loadPickings() {
        const type = this.props.params?.type;
        const warehouseId = this.props.params?.warehouseId;
        const domain = [
            ["picking_type_id.warehouse_id", "=", warehouseId],
            ["picking_type_id.code", "=", type],
            ["state", "not in", ["done", "cancel"]],
        ];
        const fields = [
            "name",
            "partner_id",
            "scheduled_date",
            "state",
        ];
        const result = await this.inventory.searchRead(
            "stock.picking",
            domain,
            fields,
            {
                order: "scheduled_date asc",
            }
        );
        this.state.moveStatsByPickingId = await this.loadMoveStats(result);
        this.state.pickings = result;
        this.state.collapsedGroups = {};
        this.computeGroups();
        this.state.loading = false;
    }

    async loadMoveStats(pickings) {
        const pickingIds = pickings.map((picking) => picking.id).filter(Boolean);
        if (!pickingIds.length) {
            return {};
        }
        const moves = await this.inventory.searchRead(
            "stock.move",
            [
                ["picking_id", "in", pickingIds],
                ["product_uom_qty", ">", 0],
            ],
            ["picking_id", "product_uom_qty", "qty_done_total", "quantity"]
        );
        const stats = {};
        for (const move of moves) {
            const pickingId = move.picking_id?.[0];
            if (!pickingId) {
                continue;
            }
            stats[pickingId] = stats[pickingId] || {...EMPTY_MOVE_STATS};
            stats[pickingId].skuCount += 1;
            stats[pickingId].demandQty += move.product_uom_qty || 0;
            stats[pickingId].doneQty += move.qty_done_total || 0;
            stats[pickingId].remainingQty += Math.max(
                (move.quantity || move.product_uom_qty || 0) -
                    (move.qty_done_total || 0),
                0
            );
        }
        return stats;
    }

    getGroupKey(p, groupBy) {
        if (groupBy === "state") {
            return this.state.stateLabels[p.state] || _t("Unknown");
        }
        if (groupBy === "date") {
            return p.scheduled_date
                ? this.getRelativeDayLabel(this.parseScheduledDate(p.scheduled_date))
                : _t("No date");
        }
        return _t("Other");
    }

    groupRecursively(records, levels) {
        if (!levels.length) {
            return records;
        }
        const level = levels[0];
        const rest = levels.slice(1);
        const groups = {};
        for (const r of records) {
            const key = this.getGroupKey(r, level);
            if (!groups[key]) {
                groups[key] = [];
            }
            groups[key].push(r);
        }
        for (const key in groups) {
            groups[key] = this.groupRecursively(groups[key], rest);
        }
        return groups;
    }

    goBack() {
        this.store.goBack();
    }

    get filteredPickings() {
        return this.getMatchingPickings(this.state.search);
    }

    computeGroups() {
        if (!this.state.groupByLevels.length) {
            this.state.groupedPickings = {all: this.filteredPickings};
            return;
        }
        this.state.groupedPickings = this.groupRecursively(
            this.filteredPickings,
            this.state.groupByLevels
        );
    }

    toggleGroupBy(group, ev) {
        if (ev.target.checked) {
            if (!this.state.groupByLevels.includes(group)) {
                this.state.groupByLevels = GROUP_ORDER.filter((g) =>
                    g === group
                        ? ev.target.checked
                        : this.state.groupByLevels.includes(g)
                );
            }
        } else {
            this.state.groupByLevels = this.state.groupByLevels.filter(
                (g) => g !== group
            );
        }
        this.computeGroups();
    }

    toggleGroup(path) {
        this.state.collapsedGroups[path] = !this.state.collapsedGroups[path];
    }

    addGroup(ev) {
        const value = ev.target.value;
        if (!value) {
            return;
        }
        if (!this.state.groupByLevels.includes(value)) {
            this.state.groupByLevels = GROUP_ORDER.filter(
                (group) => group === value || this.state.groupByLevels.includes(group)
            );
        }
        this.computeGroups();
        ev.target.value = "";
    }

    removeGroup(group) {
        this.state.groupByLevels = this.state.groupByLevels.filter((g) => g !== group);
        this.computeGroups();
    }

    async loadStateLabels() {
        const fields = await this.inventory.call(
            "stock.picking",
            "fields_get",
            [["state"]],
            {
                attributes: ["selection"],
            }
        );
        const selection = fields.state.selection;
        const labelsMap = {};
        for (const [key, label] of selection) {
            labelsMap[key] = label;
        }
        this.state.stateLabels = labelsMap;
    }

    get operationLabel() {
        return OPERATION_LABELS[this.props.params?.type] || _t("Pickings");
    }

    get headerSubtitle() {
        if (this.state.loading) {
            return _t("Preparing scanner-first work queue...");
        }
        return `${this.filteredPickings.length}/${this.state.pickings.length} ${_t(
            "visible"
        )} · ${this.operationLabel}`;
    }

    get summaryCards() {
        return [
            {
                key: "open",
                label: _t("Open"),
                value: this.state.pickings.length,
                tone: "default",
            },
            {
                key: "ready",
                label: _t("Ready"),
                value: this.state.pickings.filter((picking) =>
                    this.isReadyPicking(picking)
                ).length,
                tone: "success",
            },
            {
                key: "visible",
                label: _t("Visible"),
                value: this.filteredPickings.length,
                tone: "info",
            },
        ];
    }

    get availableGroupingOptions() {
        return GROUP_ORDER.filter((group) => !this.state.groupByLevels.includes(group));
    }

    normalizeSearchValue(value) {
        return (value || "").toString().trim().toLowerCase();
    }

    parseScheduledDate(value) {
        if (!value) {
            return null;
        }
        const date = new Date(value.replace(" ", "T"));
        return Number.isNaN(date.getTime()) ? null : date;
    }

    isSameDay(first, second) {
        return (
            first.getFullYear() === second.getFullYear() &&
            first.getMonth() === second.getMonth() &&
            first.getDate() === second.getDate()
        );
    }

    isReadyPicking(picking) {
        return picking.state === "assigned";
    }

    isUrgentPicking(picking) {
        const date = this.parseScheduledDate(picking.scheduled_date);
        if (!date) {
            return false;
        }
        const endOfToday = new Date();
        endOfToday.setHours(23, 59, 59, 999);
        return date <= endOfToday;
    }

    getRelativeDayLabel(date) {
        if (!date) {
            return _t("No date");
        }
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        if (this.isSameDay(date, today)) {
            return _t("Today");
        }
        if (this.isSameDay(date, tomorrow)) {
            return _t("Tomorrow");
        }
        return date.toLocaleDateString(undefined, {
            month: "short",
            day: "numeric",
        });
    }

    getTimeLabel(picking) {
        const date = this.parseScheduledDate(picking.scheduled_date);
        if (!date) {
            return _t("No time");
        }
        return date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    getScheduleSummary(picking) {
        const date = this.parseScheduledDate(picking.scheduled_date);
        if (!date) {
            return _t("No schedule");
        }
        return `${this.getRelativeDayLabel(date)}, ${this.getTimeLabel(picking)}`;
    }

    getStateLabel(picking) {
        return this.state.stateLabels[picking.state] || picking.state || _t("Unknown");
    }

    getPartnerName(picking) {
        return picking.partner_id?.[1] || _t("No customer");
    }

    getMoveStats(picking) {
        return this.state.moveStatsByPickingId[picking.id] || EMPTY_MOVE_STATS;
    }

    getSkuSummary(picking) {
        const stats = this.getMoveStats(picking);
        if (!stats.skuCount) {
            return _t("Queue ready");
        }
        return `${stats.skuCount} ${_t("SKUs to pick")}`;
    }

    getProgressLabel(picking) {
        const stats = this.getMoveStats(picking);
        if (!stats.skuCount) {
            return "";
        }
        if (stats.remainingQty <= 0) {
            return _t("Completed");
        }
        if (stats.doneQty > 0 && stats.demandQty > 0) {
            return `${Math.round((stats.doneQty / stats.demandQty) * 100)}% ${_t(
                "done"
            )}`;
        }
        return `${Math.round(stats.remainingQty)} ${_t("remaining")}`;
    }

    getStateBadgeClass(picking) {
        return `ilx-state-pill ilx-state-pill--${picking.state || "default"}`;
    }

    getPickingSearchText(picking) {
        return [
            picking.name,
            this.getPartnerName(picking),
            this.getStateLabel(picking),
            this.getScheduleSummary(picking),
        ]
            .map((value) => this.normalizeSearchValue(value))
            .join(" ");
    }

    matchesSearch(picking, search) {
        if (!search) {
            return true;
        }
        return this.getPickingSearchText(picking).includes(search);
    }

    matchesDateFilter(picking, dateFilter) {
        if (!dateFilter) {
            return true;
        }
        const pickingDate = this.parseScheduledDate(picking.scheduled_date);
        if (!pickingDate) {
            return false;
        }
        const today = new Date();
        if (dateFilter === "today") {
            return this.isSameDay(pickingDate, today);
        }
        if (dateFilter === "tomorrow") {
            const tomorrow = new Date(today);
            tomorrow.setDate(today.getDate() + 1);
            return this.isSameDay(pickingDate, tomorrow);
        }
        return true;
    }

    getMatchingPickings(query = "") {
        const search = this.normalizeSearchValue(query);
        return this.state.pickings.filter((picking) => {
            for (const filter of this.state.activeFilters) {
                const value = this.state.filterValues[filter];
                if (filter === "state" && value !== "all" && picking.state !== value) {
                    return false;
                }
                if (filter === "date" && value && !this.matchesDateFilter(picking, value)) {
                    return false;
                }
            }
            return this.matchesSearch(picking, search);
        });
    }

    getExactScanMatch(barcode) {
        const normalized = this.normalizeSearchValue(barcode);
        const exactMatches = this.state.pickings.filter(
            (picking) => this.normalizeSearchValue(picking.name) === normalized
        );
        return exactMatches.length === 1 ? exactMatches[0] : null;
    }

    async openCameraScanner() {
        try {
            const barcode = await scanBarcode(this.env, "environment");
            if (barcode) {
                this.onBarcodeScanned(barcode);
            }
        } catch (error) {
            const msg = error?.message || "";
            if (msg.includes("cancel") || msg.includes("abort")) {
            } else {
                this.feedback.error({
                    notify: true,
                    message: _t("Could not start camera: ") + msg,
                });
            }
        }
    }

    onBarcodeScanned(barcode) {
        const scanValue = (barcode || "").trim();
        if (!scanValue) {
            return;
        }
        const exactMatch = this.getExactScanMatch(scanValue);
        if (exactMatch) {
            this.feedback.success({
                notify: true,
                message: _t("Picking opened from scan."),
            });
            this.openPicking(exactMatch.id);
            return;
        }
        this.state.search = scanValue;
        const matches = this.getMatchingPickings(scanValue);
        if (matches.length === 1) {
            this.feedback.success({
                notify: true,
                message: _t("Single picking matched the scan."),
            });
            this.openPicking(matches[0].id);
            return;
        }
        if (matches.length > 1) {
            this.feedback.info({
                notify: true,
                message: _t("Scan narrowed the queue."),
            });
            return;
        }
        this.feedback.warning({
            notify: true,
            message: _t("No picking matched the scanned value."),
        });
    }

    addFilter(ev) {
        const value = ev.target.value;
        if (!value || this.state.activeFilters.includes(value)) {
            return;
        }
        this.state.activeFilters = [...this.state.activeFilters, value];
        this.state.filterValues[value] = FILTER_DEFAULTS[value];
        ev.target.value = "";
    }

    removeFilter(filter) {
        this.state.activeFilters = this.state.activeFilters.filter((f) => f !== filter);
        this.state.filterValues[filter] = FILTER_DEFAULTS[filter];
        this.computeGroups();
    }

    setFilterValue(filter, value) {
        this.state.filterValues[filter] = value;
        this.computeGroups();
    }

    getFilterDisplayValue(filter) {
        const value = this.state.filterValues[filter];
        if (filter === "state") {
            if (value === "all") {
                return _t("All");
            }
            return this.state.stateLabels[value] || value;
        }
        if (filter === "ready") {
            return value ? _t("Yes") : _t("No");
        }
        if (filter === "date") {
            if (!value) {
                return _t("All");
            }
            if (value === "today") {
                return _t("Today");
            }
            if (value === "tomorrow") {
                return _t("Tomorrow");
            }
            return value;
        }
        return "";
    }

    get availableFilterOptions() {
        return FILTER_ORDER.filter((f) => !this.state.activeFilters.includes(f));
    }

    clearFilters() {
        this.state.search = "";
        this.state.activeFilters = [];
        this.state.filterValues = {state: "all", date: null};
        this.computeGroups();
    }

    countGroupEntries(groupNode) {
        if (Array.isArray(groupNode)) {
            return groupNode.length;
        }
        return Object.values(groupNode).reduce(
            (count, childGroup) => count + this.countGroupEntries(childGroup),
            0
        );
    }

    sortedGroupKeys(groups) {
        return Object.keys(groups).sort((left, right) =>
            left.localeCompare(right, undefined, {
                numeric: true,
                sensitivity: "base",
            })
        );
    }

    getGroupLevelLabel(level) {
        return this.groupLabels[this.state.groupByLevels[level]] || _t("Group");
    }

    getGroupSummary(groupNode) {
        const count = this.countGroupEntries(groupNode);
        return `${count} ${count === 1 ? _t("picking") : _t("pickings")}`;
    }
}
PickingListScreen.template = "barcode_scanner.PickingListScreen";
