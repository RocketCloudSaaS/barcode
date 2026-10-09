import {PickingListScreen} from "@barcode_stock/js/screens/picking_list_screen.esm";
import {_t} from "@web/core/l10n/translation";
import {onWillStart} from "@odoo/owl";
import {patch} from "@web/core/utils/patch";

/** Grouping level and filter key of the delivery zone. */
export const ZONE = "delivery_zone";
/** Filter value that keeps the operations without a delivery zone. */
export const NO_ZONE = "none";

/**
 * Bring `partner_delivery_zone` into the warehouse app's operation lists: the
 * delivery zone becomes a grouping level (the outermost one) and a filter --
 * which the ★ can save as the default, like the status and date ones -- and is
 * shown on each operation and matched by the search.
 *
 * Delivery orders open grouped by zone, the way a dispatcher works through
 * them; the other operation types do not, since the zone belongs to the
 * customer goods are delivered to. Any grouping the operator picks during the
 * session is kept.
 */
patch(PickingListScreen.prototype, {
    setup() {
        super.setup(...arguments);
        this.initDeliveryZone();
        this.state.deliveryZones = [];
        onWillStart(async () => {
            this.state.deliveryZones = await this.inventory.searchRead(
                "partner.delivery.zone",
                [],
                ["id", "name"]
            );
        });
    },

    /** Register the zone as a grouping level and as a filter. */
    initDeliveryZone() {
        this.groupOrder = [ZONE, ...this.groupOrder.filter((g) => g !== ZONE)];
        this.groupLabels = {...this.groupLabels, [ZONE]: _t("Delivery Zone")};
        this.filterLabels = {...this.filterLabels, [ZONE]: _t("Delivery Zone")};
        this.sessionViewRestored = false;
    },

    // --- data -----------------------------------------------------------------

    /**
     * `loadPickings` hands its freshly read operations here before showing
     * them: read their delivery zone alongside the move statistics, so the list
     * is grouped and filtered by zone from its very first render.
     *
     * @param {Object[]} pickings the operations just read, not shown yet
     * @returns {Promise<Object>} the move statistics, per operation
     */
    async loadMoveStats(pickings) {
        const [stats] = await Promise.all([
            super.loadMoveStats(...arguments),
            this.loadDeliveryZones(pickings),
        ]);
        return stats;
    },

    async loadDeliveryZones(pickings) {
        const ids = pickings.map((picking) => picking.id).filter(Boolean);
        if (!ids.length) {
            return;
        }
        const records = await this.inventory.read("stock.picking", ids, [
            "delivery_zone_id",
        ]);
        const zoneById = Object.fromEntries(
            records.map((record) => [record.id, record.delivery_zone_id])
        );
        for (const picking of pickings) {
            picking.delivery_zone_id = zoneById[picking.id] || false;
        }
    },

    getDeliveryZoneName(picking) {
        return picking.delivery_zone_id?.[1] || "";
    },

    // --- grouping -------------------------------------------------------------

    getGroupKey(picking, groupBy) {
        if (groupBy === ZONE) {
            return this.getDeliveryZoneName(picking) || _t("No zone");
        }
        return super.getGroupKey(...arguments);
    },

    /**
     * Add or remove a grouping level, keeping the zone as the outermost one.
     *
     * @param {String} group the grouping level to toggle
     */
    toggleGroupLevel(group) {
        if (this.state.groupByLevels.includes(group)) {
            this.removeGroup(group);
            return;
        }
        this.state.groupByLevels = this.groupOrder.filter(
            (level) => level === group || this.state.groupByLevels.includes(level)
        );
        this.computeGroups();
    },

    get availableGroupingOptions() {
        return this.groupOrder.filter(
            (group) => !this.state.groupByLevels.includes(group)
        );
    },

    /**
     * Restoring this session's working view keeps the operator's grouping.
     *
     * @returns {*} what the restore itself returns
     */
    applyViewState() {
        this.sessionViewRestored = true;
        return super.applyViewState(...arguments);
    },

    async loadDefaultFilter() {
        await super.loadDefaultFilter(...arguments);
        if (
            !this.sessionViewRestored &&
            this.operationType === "outgoing" &&
            !this.state.groupByLevels.length
        ) {
            this.state.groupByLevels = [ZONE];
        }
    },

    // --- filtering ------------------------------------------------------------

    getMatchingPickings() {
        const pickings = super.getMatchingPickings(...arguments);
        if (!this.state.activeFilters.includes(ZONE)) {
            return pickings;
        }
        const zone = this.state.filterValues[ZONE];
        return pickings.filter((picking) => this.matchesZoneFilter(picking, zone));
    },

    matchesZoneFilter(picking, zone) {
        const zoneId = picking.delivery_zone_id?.[0] || false;
        return zone === NO_ZONE ? !zoneId : zoneId === zone;
    },

    /** Radio options for the Delivery Zone section of the Filters menu. */
    get zoneFilterOptions() {
        return [
            {value: null, label: _t("All")},
            {value: NO_ZONE, label: _t("No zone")},
            ...this.state.deliveryZones.map((zone) => ({
                value: zone.id,
                label: zone.name,
            })),
        ];
    },

    isZoneOptionSelected(value) {
        const active = this.state.activeFilters.includes(ZONE);
        return value === null
            ? !active
            : active && this.state.filterValues[ZONE] === value;
    },

    /**
     * Pick a zone from the menu; the empty value turns the filter off.
     *
     * @param {Number|String|null} value a zone id, NO_ZONE, or null for all
     */
    setZoneFilter(value) {
        if (value === null || value === undefined) {
            this.removeFilter(ZONE);
            return;
        }
        if (!this.state.activeFilters.includes(ZONE)) {
            this.state.activeFilters = [...this.state.activeFilters, ZONE];
        }
        this.state.filterValues[ZONE] = value;
        this.computeGroups();
        // Changing the zone of an already active filter is not one of the
        // changes the list watches: remember the view explicitly.
        this.persistSessionView();
    },

    getFilterDisplayValue(filter) {
        if (filter !== ZONE) {
            return super.getFilterDisplayValue(...arguments);
        }
        const value = this.state.filterValues[ZONE];
        if (value === NO_ZONE) {
            return _t("No zone");
        }
        const zone = this.state.deliveryZones.find((z) => z.id === value);
        return zone ? zone.name : _t("Unknown zone");
    },

    // --- search ---------------------------------------------------------------

    getPickingSearchText(picking) {
        return [
            super.getPickingSearchText(...arguments),
            this.normalizeSearchValue(this.getDeliveryZoneName(picking)),
        ].join(" ");
    },
});
