/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";

// Remember the operator's warehouse choice for the length of the session, so
// entering a picking list and coming back (which re-runs loadData) no longer
// resets it to the active company's default.
const WAREHOUSE_STORAGE_KEY = "barcode.warehouse_ops.selected_id";

function readStoredWarehouseId() {
    try {
        const value = sessionStorage.getItem(WAREHOUSE_STORAGE_KEY);
        return value ? parseInt(value, 10) : null;
    } catch {
        return null;
    }
}

function storeWarehouseId(id) {
    try {
        if (id) {
            sessionStorage.setItem(WAREHOUSE_STORAGE_KEY, String(id));
        }
    } catch {
        // sessionStorage blocked (locked-down webview/private mode): silently
        // fall back to the default preselect, no persistence.
    }
}

export class WarehouseOps extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.company = useService("company");
        this.state = useState({
            warehouses: [],
            selectedWarehouseId: null,
        });

        this.openPickings = (type) => {
            const warehouseId = this.state.selectedWarehouseId;
            if (!warehouseId) return;
            this.store.navigate("picking_list", {
                warehouseId: warehouseId,
                type: type,
            });
        };

        onWillStart(async () => {
            await this.loadData();
        });
    }

    async loadData() {
        // Only the companies the operator is actually working in (the
        // multi-company switcher selection), not every warehouse configured in
        // the database.
        const allowedCompanyIds = this.company.activeCompanyIds;
        const domain = allowedCompanyIds.length
            ? [["company_id", "in", allowedCompanyIds]]
            : [];
        const warehouses = await this.inventory.searchRead(
            "stock.warehouse",
            domain,
            ["name", "company_id"]
        );
        const pickingTypes = await this.inventory.searchRead(
            "stock.picking.type",
            [],
            ["warehouse_id", "code"]
        );
        const counts = await this.inventory.readGroup(
            "stock.picking",
            [["state", "not in", ["done", "cancel"]]],
            ["picking_type_id"],
            ["picking_type_id"]
        );
        const countMap = {};
        for (const c of counts) {
            countMap[c.picking_type_id[0]] = c.picking_type_id_count;
        }
        const warehouseMap = {};
        for (const pt of pickingTypes) {
            const warehouseId = pt.warehouse_id?.[0];
            if (!warehouseId) continue;
            if (!warehouseMap[warehouseId]) {
                warehouseMap[warehouseId] = {
                    incoming: 0,
                    internal: 0,
                    outgoing: 0,
                };
            }
            const count = countMap[pt.id] || 0;
            warehouseMap[warehouseId][pt.code] += count;
        }
        this.state.warehouses = warehouses.map((w) => ({
            id: w.id,
            name: w.name,
            companyId: w.company_id?.[0] || null,
            receipts: warehouseMap[w.id]?.incoming || 0,
            internal: warehouseMap[w.id]?.internal || 0,
            delivery: warehouseMap[w.id]?.outgoing || 0,
        }));
        if (this.state.warehouses.length) {
            // Keep the operator's own pick across navigation within the session;
            // only fall back to the active company's warehouse (never just the
            // first, which was rarely theirs) when there is no valid stored one.
            const storedId = readStoredWarehouseId();
            const stored = this.state.warehouses.find((w) => w.id === storedId);
            if (stored) {
                this.state.selectedWarehouseId = stored.id;
            } else {
                const currentCompanyId = this.company.currentCompany?.id;
                const active = this.state.warehouses.find(
                    (w) => w.companyId === currentCompanyId
                );
                this.state.selectedWarehouseId = (
                    active || this.state.warehouses[0]
                ).id;
            }
        }
    }

    get selectedWarehouse() {
        return this.state.warehouses.find(
            (w) => w.id === this.state.selectedWarehouseId
        );
    }

    goBack() {
        this.store.goBack();
    }

    selectWarehouse(ev) {
        this.state.selectedWarehouseId = parseInt(ev.target.value);
        storeWarehouseId(this.state.selectedWarehouseId);
    }

    static template = "barcode_scanner.WarehouseOps";
}

barcodeScreens.add("warehouse_ops", {component: WarehouseOps});
