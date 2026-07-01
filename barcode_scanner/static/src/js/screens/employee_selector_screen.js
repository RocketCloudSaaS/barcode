/** @odoo-module **/

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";

const DEFAULT_RETURN_ROUTE = "picking";

export class EmployeeSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            employees: [],
            search: "",
            loading: true,
            selectedEmployee: null,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            await this.loadEmployees();
        });
    }

    get _returnRoute() {
        return this.props.params?.returnRoute || DEFAULT_RETURN_ROUTE;
    }

    get _returnParams() {
        return {...(this.props.params?.returnParams || {})};
    }

    get _backCompatPickingId() {
        return this.props.pickingId || this.props.params?.pickingId || null;
    }

    async onBarcodeScanned(barcode) {
        const employees = await this.inventory.searchRead(
            "hr.employee",
            [["barcode", "=", barcode]],
            ["name", "image_128", "job_title", "department_id"]
        );
        if (employees.length) {
            this.state.selectedEmployee = employees[0];
            this.confirmSelection();
            return;
        }
        this.state.search = barcode;
    }

    async loadEmployees() {
        let employees = await this.inventory.searchRead(
            "hr.employee",
            [],
            ["name", "image_128", "job_title", "department_id"]
        );

        employees = employees.map((emp) => {
            if (
                !emp.image_128 ||
                emp.image_128 === "False" ||
                emp.image_128 === "false" ||
                String(emp.image_128).length < 50
            ) {
                emp.image_128 = false;
            }
            return emp;
        });

        this.state.employees = employees;
        this.state.loading = false;
    }

    get filteredEmployees() {
        if (!this.state.search) {
            return this.state.employees;
        }
        const s = this.state.search.toLowerCase();
        return this.state.employees.filter(
            (emp) =>
                emp.name.toLowerCase().includes(s) ||
                (emp.department_id && emp.department_id[1].toLowerCase().includes(s)) ||
                (emp.job_title && emp.job_title.toLowerCase().includes(s))
        );
    }

    get recentEmployees() {
        return this.state.employees.slice(0, 3);
    }

    formatRecentName(fullName) {
        if (!fullName) return "";
        const parts = fullName.split(" ");
        if (parts.length === 1) return parts[0];
        return `${parts[0]} ${parts[1].charAt(0)}.`;
    }

    getEmployeeStatus(emp) {
        if (emp.name === "Sarah Jenkins") return "red";
        if (emp.id % 3 === 0) return "orange";
        return "green";
    }

    selectEmployee(emp) {
        this.state.selectedEmployee = emp;
    }

    confirmSelection() {
        const emp = this.state.selectedEmployee;
        if (!emp) return;

        const params = {
            ...this._returnParams,
            employee: emp,
            selectedEmployee: emp,
        };
        if (this._returnRoute === "picking" && !params.pickingId) {
            params.pickingId = this._backCompatPickingId;
        }
        this.store.navigate(this._returnRoute, params, {replace: true});
    }

    goBack() {
        const params = {...this._returnParams};
        if (this._returnRoute === "picking" && !params.pickingId) {
            params.pickingId = this._backCompatPickingId;
        }
        this.store.navigate(this._returnRoute, params, {replace: true});
    }
}

EmployeeSelectorScreen.template = "barcode_scanner.EmployeeSelectorScreen";
