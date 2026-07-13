/** @odoo-module **/

import {Component, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";
import {user} from "@web/core/user";
import {imageUrl} from "@web/core/utils/urls";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";

export class MainScreen extends Component {
    setup() {
        this.store = useState(useService("barcodeStore"));
        this.action = useService("action");
        this.inventory = useBarcodeScanner();
        this.avatarState = useState({failed: false});

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });
    }

    async onBarcodeScanned(barcode, parsedData) {
        if (barcode.startsWith("WH/") || barcode.startsWith("INT/")) {
            const pickings = await this.inventory.searchRead(
                "stock.picking",
                [["name", "=", barcode]],
                ["id"]
            );
            if (pickings.length) {
                this.store.navigate("picking", {pickingId: pickings[0].id});
                return;
            }
        }

        const productCode = parsedData?.value || barcode;
        const products = await this.inventory.searchRead(
            "product.product",
            [["barcode", "=", productCode]],
            ["id", "display_name"]
        );
        if (products.length) {
            this.store.navigate("quick_info", {
                result: products[0],
                result_type: "product",
            });
            return;
        }

        const locations = await this.inventory.searchRead(
            "stock.location",
            [["barcode", "=", barcode]],
            ["id", "display_name"]
        );
        if (locations.length) {
            this.store.navigate("quick_info", {
                result: locations[0],
                result_type: "location",
            });
            return;
        }

        this.inventory.notify("Barcode not recognized", {type: "warning"});
    }

    get greeting() {
        const tz = user.tz || "UTC";
        const hour = new Intl.DateTimeFormat("en", {
            hour: "numeric",
            hour12: false,
            timeZone: tz,
        }).format(new Date());
        const h = parseInt(hour, 10);
        if (h < 12) return "Good morning";
        if (h < 18) return "Good afternoon";
        return "Good evening";
    }

    get userName() {
        return user.name || "Operational Lead";
    }

    get userInitials() {
        const name = this.userName;
        if (name === "Operational Lead") return "OL";
        const parts = name.split(" ").filter((p) => p.length > 0);
        if (parts.length >= 2) {
            return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    }

    get avatarUrl() {
        const {partnerId, writeDate} = user;
        return imageUrl("res.partner", partnerId, "avatar_128", {unique: writeDate});
    }

    onAvatarError() {
        this.avatarState.failed = true;
    }

    get showAvatarImage() {
        return !this.avatarState.failed;
    }

    navigate = (route) => {
        this.store.navigate(route);
    };

    goHome() {
        window.location.href = "/web";
    }

    static template = "barcode_scanner.MainScreen";
}
