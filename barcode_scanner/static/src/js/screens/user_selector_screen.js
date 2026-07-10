/** @odoo-module **/

import {Component, onWillStart, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";

const DEFAULT_RETURN_ROUTE = "internal_transfer";

export class UserSelectorScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this.state = useState({
            users: [],
            search: "",
            loading: true,
            selectedUser: this.props.params?.responsible || null,
        });

        useBarcodeHandler({
            onScan: (barcode) => {
                this.state.search = barcode;
            },
        });

        onWillStart(async () => {
            await this.loadUsers();
        });
    }

    get _returnRoute() {
        return this.props.params?.returnRoute || DEFAULT_RETURN_ROUTE;
    }

    get _returnParams() {
        return {...(this.props.params?.returnParams || {})};
    }

    async loadUsers() {
        let users = await this.inventory.searchRead(
            "res.users",
            [["share", "=", false]],
            ["name", "login", "image_128"]
        );

        users = users.map((user) => {
            if (
                !user.image_128 ||
                user.image_128 === "False" ||
                user.image_128 === "false" ||
                String(user.image_128).length < 50
            ) {
                user.image_128 = false;
            }
            return user;
        });

        this.state.users = users;
        this.state.loading = false;
    }

    get filteredUsers() {
        if (!this.state.search) {
            return this.state.users;
        }
        const s = this.state.search.toLowerCase();
        return this.state.users.filter(
            (user) =>
                user.name.toLowerCase().includes(s) ||
                (user.login && user.login.toLowerCase().includes(s))
        );
    }

    selectUser(user) {
        this.state.selectedUser = user;
    }

    confirmSelection() {
        const user = this.state.selectedUser;
        if (!user) {
            return;
        }
        this.store.goBack({
            ...this._returnParams,
            responsible: {id: user.id, name: user.name},
        });
    }

    goBack() {
        this.store.goBack();
    }
}

UserSelectorScreen.template = "barcode_scanner.UserSelectorScreen";
