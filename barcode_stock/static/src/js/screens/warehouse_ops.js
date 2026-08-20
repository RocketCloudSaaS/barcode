/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";

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
            // Preselect the warehouse of the active company, not just the first
            // in the list (which was rarely the operator's own).
            const currentCompanyId = this.company.currentCompany?.id;
            const active = this.state.warehouses.find(
                (w) => w.companyId === currentCompanyId
            );
            this.state.selectedWarehouseId = (active || this.state.warehouses[0]).id;
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
    }

    static template = "barcode_scanner.WarehouseOps";
}

barcodeScreens.add("warehouse_ops", {component: WarehouseOps});
