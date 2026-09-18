import {
    Component,
    onWillStart,
    useEffect,
    useExternalListener,
    useState,
} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {user} from "@web/core/user";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";

const SESSION_VIEWS = {};
// Fixed key for this screen's entry in SESSION_VIEWS and in
// `res.users.barcode_default_filters`.
const DEFAULT_FILTER_KEY = "cycle_count";
const GROUP_ORDER = ["state", "deadline"];
const FILTER_ORDER = ["state", "assignment", "deadline"];
const FILTER_DEFAULTS = {state: "all", assignment: "all", deadline: null};
const FILTER_LABELS = {
    state: _t("State"),
    assignment: _t("Assignment"),
    deadline: _t("Deadline"),
};

export class CycleCountListScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.feedback = useService("barcodeScannerFeedback");
        this.openingCount = false;
        // Full `res.users.barcode_default_filters` map, kept non-reactive so a
        // write preserves other operations' entries.
        this.allDefaults = {};
        this.groupLabels = {state: _t("State"), deadline: _t("Deadline")};
        this.filterLabels = FILTER_LABELS;
        this.groupOrder = GROUP_ORDER;
        this.state = useState({
            counts: [],
            groupedCounts: {all: []},
            loading: true,
            error: null,
            search: "",
            showAll: false,
            groupByLevels: [],
            collapsedGroups: {},
            activeFilters: [],
            filterValues: {state: "all", assignment: "all", deadline: null},
            savedDefault: null,
            openMenu: null,
        });
        useExternalListener(document, "click", () => this.closeMenu());
        useBarcodeHandler({onScan: (value) => this.onBarcodeScanned(value)});
        onWillStart(async () => {
            await this.loadDefaultFilter();
            await this.loadCounts(Boolean(this.props.params?.showAll));
        });
        useEffect(
            () => {
                this.computeGroups();
                this.persistSessionView();
            },
            () => [
                this.state.counts,
                this.state.search,
                this.state.groupByLevels,
                this.state.activeFilters,
                this.state.filterValues.state,
                this.state.filterValues.assignment,
                this.state.filterValues.deadline,
            ]
        );
    }

    normalizeSearchValue(value) {
        return String(value || "")
            .trim()
            .toLowerCase();
    }

    async loadCounts(showAll = this.state.showAll) {
        this.state.loading = true;
        this.state.error = null;
        try {
            const result = await this.inventory.call(
                "stock.cycle.count",
                "barcode_get_counts",
                [showAll]
            );
            this.state.counts = Array.isArray(result?.counts) ? result.counts : [];
            this.state.showAll = showAll;
        } catch (error) {
            this.state.counts = [];
            this.state.groupedCounts = {all: []};
            this.state.error = error;
            this.feedback.error({message: error.message, notify: true});
        } finally {
            this.state.loading = false;
        }
    }

    getMatchingCounts(query = "") {
        const search = this.normalizeSearchValue(query);
        return this.state.counts.filter((count) => {
            if (
                search &&
                ![count.name, count.location_name].some((value) =>
                    this.normalizeSearchValue(value).includes(search)
                )
            ) {
                return false;
            }
            return this.state.activeFilters.every((filter) => {
                const value = this.state.filterValues[filter];
                if (filter === "state") return value === "all" || count.state === value;
                if (filter === "assignment")
                    return this.matchesAssignment(count, value);
                return this.matchesDeadline(count, value);
            });
        });
    }

    getScanMatches(value) {
        const normalized = this.normalizeSearchValue(value);
        if (!normalized) return [];
        return [
            ...new Map(
                this.getMatchingCounts("")
                    .filter((count) =>
                        [count.name, count.location_name].some(
                            (field) => this.normalizeSearchValue(field) === normalized
                        )
                    )
                    .map((count) => [count.id, count])
            ).values(),
        ];
    }

    async onBarcodeScanned(value) {
        const scan = String(value || "").trim();
        if (!scan || this.state.loading || this.openingCount) return;
        this.state.search = scan;
        const matches = this.getScanMatches(scan);
        if (!matches.length) {
            this.feedback.warning({
                message: _t("No cycle count matched the scan."),
                notify: true,
            });
        } else if (matches.length > 1) {
            this.feedback.info({
                message: _t("Scan matched multiple cycle counts."),
                notify: true,
            });
        } else {
            this.feedback.success({
                message: _t("Cycle count opened from scan."),
                notify: true,
            });
            this.selectCount(matches[0]);
        }
    }

    selectCount(count) {
        if (!count?.id || this.openingCount) return;
        this.openingCount = true;
        if (
            count.state === "open" &&
            count.inventory_id &&
            count.inventory_state === "in_progress"
        ) {
            // Resume only an active linked adjustment. A draft adjustment must
            // go through the location gate so Confirm and start can activate it.
            this.store.navigate("cycle_count_count", {
                cycleCountId: count.id,
                cycleCount: count,
                inventoryId: count.inventory_id,
                expectedLocationId: count.location_id,
                expectedLocationName: count.location_name,
                showAll: this.state.showAll,
            });
            return;
        }
        this.store.navigate("cycle_count_location", {
            cycleCountId: count.id,
            cycleCount: count,
            showAll: this.state.showAll,
        });
    }

    onCountCardKeydown(ev, count) {
        if (ev.key === "Enter") {
            ev.preventDefault();
            this.selectCount(count);
        } else if (ev.key === " ") {
            ev.preventDefault();
        }
    }

    onCountCardKeyup(ev, count) {
        if (ev.key !== " ") return;
        ev.preventDefault();
        this.selectCount(count);
    }

    async setAssignment(value) {
        this.setFilterValue("assignment", value);
        await this.loadCounts(value === "all");
    }

    goBack() {
        this.store.goBack();
    }

    parseDeadline(value) {
        const match = String(value || "").match(/^(\d{4}-\d{2}-\d{2})/);
        if (!match) return null;
        const date = new Date(`${match[1]}T00:00:00Z`);
        return Number.isNaN(date.getTime()) ||
            date.toISOString().slice(0, 10) !== match[1]
            ? null
            : match[1];
    }

    todayInUserTimezone() {
        const formatter = new Intl.DateTimeFormat("en-CA", {
            timeZone: user.tz || "UTC",
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
        });
        return formatter.format(new Date());
    }

    matchesState(count, value) {
        return value === "all" || count.state === value;
    }

    matchesAssignment(count, value) {
        if (value === "all") return true;
        if (value === "mine") return count.responsible_id === user.userId;
        return value === "unassigned" && !count.responsible_id;
    }

    matchesDeadline(count, value) {
        if (!value) return true;
        const deadline = this.parseDeadline(count.date_deadline);
        if (!deadline) return false;
        const today = this.todayInUserTimezone();
        if (value === "overdue") return deadline < today;
        if (value === "today") return deadline === today;
        if (value === "week") {
            const end = new Date(`${today}T00:00:00Z`);
            end.setUTCDate(end.getUTCDate() + 6);
            return deadline >= today && deadline <= end.toISOString().slice(0, 10);
        }
        return value.startsWith("custom:") && deadline === value.slice(7);
    }

    deadlineLabel(count) {
        const deadline = this.parseDeadline(count.date_deadline);
        if (!deadline) return _t("No deadline");
        if (deadline < this.todayInUserTimezone()) return _t("Overdue");
        if (deadline === this.todayInUserTimezone()) return _t("Today");
        return deadline;
    }

    getGroupKey(count, level) {
        if (level === "state")
            return count.state === "draft" ? _t("Planned") : _t("Execution");
        const deadline = this.parseDeadline(count.date_deadline);
        if (!deadline) return _t("No deadline");
        const today = this.todayInUserTimezone();
        if (deadline < today) return _t("Overdue");
        if (deadline === today) return _t("Today");
        const end = new Date(`${today}T00:00:00Z`);
        end.setUTCDate(end.getUTCDate() + 6);
        return deadline <= end.toISOString().slice(0, 10)
            ? _t("This week")
            : _t("Future");
    }

    groupRecursively(records, levels) {
        if (!levels.length) return records;
        const groups = {};
        for (const record of records) {
            const key = this.getGroupKey(record, levels[0]);
            (groups[key] ||= []).push(record);
        }
        for (const key of Object.keys(groups))
            groups[key] = this.groupRecursively(groups[key], levels.slice(1));
        return groups;
    }

    get filteredCounts() {
        return this.getMatchingCounts(this.state.search);
    }

    computeGroups() {
        this.state.groupedCounts = this.groupRecursively(
            this.filteredCounts,
            this.state.groupByLevels
        );
        if (!this.state.groupByLevels.length)
            this.state.groupedCounts = {all: this.filteredCounts};
    }

    countGroupEntries(groupNode) {
        return Array.isArray(groupNode)
            ? groupNode.length
            : Object.values(groupNode).reduce(
                  (n, group) => n + this.countGroupEntries(group),
                  0
              );
    }

    sortedGroupKeys(groups) {
        const order = [
            "Overdue",
            "Today",
            "This week",
            "Future",
            "No deadline",
            "Planned",
            "Execution",
            "all",
        ];
        return Object.keys(groups).sort(
            (a, b) => order.indexOf(a) - order.indexOf(b) || a.localeCompare(b)
        );
    }

    toggleGroup(path) {
        this.state.collapsedGroups[path] = !this.state.collapsedGroups[path];
    }

    toggleMenu(name) {
        this.state.openMenu = this.state.openMenu === name ? null : name;
    }

    closeMenu() {
        this.state.openMenu = null;
    }

    addFilter(filter) {
        if (!filter || this.state.activeFilters.includes(filter)) return;
        this.state.activeFilters = [...this.state.activeFilters, filter];
    }

    setFilterValue(filter, value) {
        if (value === "all" || value === null) {
            this.removeFilter(filter);
            return;
        }
        this.addFilter(filter);
        this.state.filterValues[filter] = value;
    }

    setCustomDate(value) {
        this.setFilterValue("deadline", value ? `custom:${value}` : null);
    }

    removeFilter(filter) {
        this.state.activeFilters = this.state.activeFilters.filter(
            (item) => item !== filter
        );
        this.state.filterValues[filter] = FILTER_DEFAULTS[filter];
    }

    toggleGroupLevel(level) {
        this.state.groupByLevels = GROUP_ORDER.filter((item) =>
            item === level
                ? !this.state.groupByLevels.includes(level)
                : this.state.groupByLevels.includes(item)
        );
    }

    removeGroup(level) {
        this.state.groupByLevels = this.state.groupByLevels.filter(
            (item) => item !== level
        );
    }

    clearFilters() {
        this.state.search = "";
        this.state.activeFilters = [];
        this.state.filterValues = {...FILTER_DEFAULTS};
    }

    normalizeView(view) {
        const activeFilters = FILTER_ORDER.filter((filter) =>
            (view?.activeFilters || []).includes(filter)
        );
        const values = {...FILTER_DEFAULTS};
        for (const filter of activeFilters) {
            const value = view.filterValues?.[filter];
            const valid =
                filter === "state"
                    ? ["draft", "open"]
                    : filter === "assignment"
                    ? ["mine", "unassigned"]
                    : ["overdue", "today", "week"];
            if (
                filter === "deadline" &&
                typeof value === "string" &&
                /^custom:\d{4}-\d{2}-\d{2}$/.test(value)
            )
                values[filter] = value;
            else if (valid.includes(value)) values[filter] = value;
            else activeFilters.splice(activeFilters.indexOf(filter), 1);
        }
        return {
            activeFilters,
            filterValues: values,
            search: this.normalizeSearchValue(view?.search),
            groupByLevels: GROUP_ORDER.filter((level) =>
                (view?.groupByLevels || []).includes(level)
            ),
            collapsedGroups:
                view?.collapsedGroups && typeof view.collapsedGroups === "object"
                    ? {...view.collapsedGroups}
                    : {},
        };
    }

    applyView(view) {
        const normalized = this.normalizeView(view);
        this.state.activeFilters = normalized.activeFilters;
        this.state.filterValues = normalized.filterValues;
        this.state.search = normalized.search;
        this.state.groupByLevels = normalized.groupByLevels;
        this.state.collapsedGroups = normalized.collapsedGroups;
    }

    /** Comparable, filters-only form: active filters and their normalized values. */
    normalizeFilterConfig(view) {
        const normalized = this.normalizeView(view);
        const filterValues = {};
        for (const filter of normalized.activeFilters) {
            filterValues[filter] = normalized.filterValues[filter];
        }
        return {activeFilters: normalized.activeFilters, filterValues};
    }

    applyFilterConfig(config) {
        const normalized = this.normalizeFilterConfig(config);
        this.state.activeFilters = [...normalized.activeFilters];
        this.state.filterValues = {...FILTER_DEFAULTS, ...normalized.filterValues};
    }

    /** Read the user's saved defaults; a read failure falls back to no default. */
    async loadDefaultFilter() {
        let stored = {};
        try {
            const [record] = await this.inventory.read(
                "res.users",
                [user.userId],
                ["barcode_default_filters"]
            );
            stored = record?.barcode_default_filters || {};
        } catch {
            stored = {};
        }
        this.allDefaults = stored && typeof stored === "object" ? stored : {};
        const config = this.allDefaults[DEFAULT_FILTER_KEY];
        if (config && Array.isArray(config.activeFilters)) {
            // Keep the saved default for the ★ state regardless of what we show.
            this.state.savedDefault = this.normalizeFilterConfig(config);
        }
        // What to show, in priority order: the session view the user was working
        // with wins over the saved default; otherwise the saved default applies
        // before display; otherwise the built-in empty view.
        const session = SESSION_VIEWS[DEFAULT_FILTER_KEY];
        if (session) {
            this.applyView(session);
        } else if (config && Array.isArray(config.activeFilters)) {
            this.applyFilterConfig(config);
        } else {
            this.applyView({});
        }
    }

    persistSessionView() {
        SESSION_VIEWS[DEFAULT_FILTER_KEY] = this.normalizeView(this.state);
    }

    get currentFilterConfig() {
        return this.normalizeFilterConfig({
            activeFilters: this.state.activeFilters,
            filterValues: this.state.filterValues,
        });
    }

    get isCurrentFilterDefault() {
        if (!this.state.savedDefault) {
            return false;
        }
        return (
            JSON.stringify(this.currentFilterConfig) ===
            JSON.stringify(this.normalizeFilterConfig(this.state.savedDefault))
        );
    }

    async persistDefaultFilters() {
        await this.inventory.write("res.users", [user.userId], {
            barcode_default_filters: this.allDefaults,
        });
    }

    /** Star: save the current filter as the default; the filled ★ removes it. */
    async toggleDefaultFilter() {
        if (this.isCurrentFilterDefault) {
            delete this.allDefaults[DEFAULT_FILTER_KEY];
            this.state.savedDefault = null;
            await this.persistDefaultFilters();
        } else if (!this.state.activeFilters.length) {
            this.feedback.warning({
                message: _t("Add a filter first, then save it as the default."),
                notify: true,
            });
        } else {
            this.allDefaults[DEFAULT_FILTER_KEY] = this.currentFilterConfig;
            this.state.savedDefault = this.currentFilterConfig;
            await this.persistDefaultFilters();
        }
    }

    get summaryCards() {
        return [
            {
                key: "total",
                label: _t("Total"),
                value: this.state.counts.length,
                tone: "default",
            },
            {
                key: "planned",
                label: _t("Planned"),
                value: this.state.counts.filter((c) => c.state === "draft").length,
                tone: "warning",
            },
            {
                key: "execution",
                label: _t("Execution"),
                value: this.state.counts.filter((c) => c.state === "open").length,
                tone: "success",
            },
            {
                key: "overdue",
                label: _t("Overdue"),
                value: this.state.counts.filter((c) =>
                    this.matchesDeadline(c, "overdue")
                ).length,
                tone: "danger",
            },
        ];
    }

    get headerSubtitle() {
        return this.state.loading
            ? _t("Loading cycle counts...")
            : `${this.filteredCounts.length}/${this.state.counts.length} ${_t(
                  "visible"
              )}`;
    }

    getStateLabel(count) {
        return count.state === "draft" ? _t("Planned") : _t("Execution");
    }
    getStateBadgeClass(count) {
        return `ilx-state-pill ilx-state-pill--${count.state || "default"}`;
    }
    getCountLocation(count) {
        return count.location_name || _t("No location");
    }
    getCountAssignee(count) {
        return count.responsible_name || _t("Unassigned");
    }
    getDeadlineLabel(count) {
        return this.deadlineLabel(count);
    }
    getDeadlineMetaClass(count) {
        return this.matchesDeadline(count, "overdue") ? "ilx-cycle-count-overdue" : "";
    }
}

CycleCountListScreen.template = "barcode_stock_cycle_count.CycleCountListScreen";
barcodeScreens.add("cycle_count_list", {component: CycleCountListScreen});
