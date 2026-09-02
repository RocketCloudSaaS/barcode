/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";
import {Component, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {
    barcodeMatchDomain,
    barcodeMatchAnyDomain,
} from "@barcode_scanner/js/utils/scan_match";

/**
 * Create a purchase order from the scanner: pick a vendor, a destination
 * location and a buyer, scan or add the products (a GS1 label
 * carries its own lot and quantity), then create the order and -- if asked --
 * confirm it, which raises the incoming picking.
 *
 * The selections round-trip through the selector screens: each returns here via
 * navigate("purchase", {...}), so the whole draft lives in the route params
 * while the operator moves between screens.
 */
export class PurchaseScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        const params = this.props.params || {};
        this.state = useState({
            supplier: params.supplier || null,
            destinationLocation: params.destinationLocation || null,
            buyer: params.buyer || null,
            vendorRef: params.vendorRef || "",
            lines: JSON.parse(JSON.stringify(params.lines || [])),
            // On by default: the scanner flow is meant to raise a confirmed
            // order in one go (which generates the incoming picking); untick it
            // to keep the order as a draft RFQ instead.
            autoValidate: params.autoValidate ?? true,
            saving: false,
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });
    }

    async onBarcodeScanned(barcode, parsedData) {
        // A scanned location barcode sets the destination; anything else is
        // resolved as a product to add to the order.
        const locationDomain = barcodeMatchDomain(barcode);
        const locations = locationDomain
            ? await this.inventory.searchRead(
                  "stock.location",
                  locationDomain,
                  ["display_name"]
              )
            : [];
        if (locations.length) {
            this.state.destinationLocation = {
                id: locations[0].id,
                display_name: locations[0].display_name,
            };
            this.inventory.notify(
                _t("Destination location selected: ") + locations[0].display_name,
                {type: "success"}
            );
            return;
        }
        await this.addScannedProduct(barcode, parsedData);
    }

    async addScannedProduct(barcode, parsedData) {
        const candidates = [
            ...(parsedData?.productCodes || []),
            parsedData?.value,
            barcode,
        ];
        const productDomain = barcodeMatchAnyDomain(candidates);
        const products = productDomain
            ? await this.inventory.searchRead(
                  "product.product",
                  productDomain,
                  ["display_name", "default_code", "standard_price", "tracking"]
              )
            : [];
        if (!products.length) {
            this.inventory.notify(_t("Product not found."), {type: "warning"});
            return;
        }
        const lotName = parsedData?.lot || parsedData?.serial || null;
        const qty = parsedData?.qty || parsedData?.quantity || 1;
        this.addLine(products[0], lotName, qty);
    }

    addLine(product, lotName, qty) {
        const existing = this.state.lines.find(
            (l) => l.product_id === product.id && l.lot_name === lotName
        );
        if (existing) {
            existing.qty += qty;
            return;
        }
        this.state.lines.push({
            product_id: product.id,
            product_name: product.display_name,
            default_code: product.default_code || null,
            qty: qty,
            price_unit: product.standard_price || 0,
            lot_name: lotName,
            tracking: product.tracking || "none",
        });
    }

    removeLine(line) {
        this.state.lines = this.state.lines.filter(
            (l) => !(l.product_id === line.product_id && l.lot_name === line.lot_name)
        );
    }

    // --- Navigation to the selector screens (the draft rides along as params) ---

    get _draftParams() {
        return {
            supplier: this.state.supplier,
            destinationLocation: this.state.destinationLocation,
            buyer: this.state.buyer,
            vendorRef: this.state.vendorRef,
            lines: this.state.lines,
            autoValidate: this.state.autoValidate,
        };
    }

    selectSupplier() {
        this.store.navigate("purchase_supplier_selector", {...this._draftParams});
    }

    selectDestinationLocation() {
        this.store.navigate("purchase_location_selector", {...this._draftParams});
    }

    selectBuyer() {
        this.store.navigate("purchase_buyer_selector", {
            returnRoute: "purchase",
            returnParams: {...this._draftParams},
        });
    }

    addProduct() {
        this.store.navigate("purchase_product_selector", {...this._draftParams});
    }

    goBack() {
        this.store.navigate("main");
    }

    // --- Create the order ---

    async saveDraft() {
        this.state.autoValidate = false;
        await this.createPurchase();
    }

    /**
     * Products tracked by lot/serial can't be received without a lot. When the
     * operator asked to auto-confirm but a tracked line has no lot yet, we still
     * create the order but leave it in draft and say why, instead of confirming
     * an order that can't be received.
     */
    _trackedLinesMissingLot() {
        return this.state.lines.filter(
            (line) => line.tracking !== "none" && !line.lot_name
        );
    }

    _formatDatePlanned() {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        return (
            now.getFullYear() +
            "-" +
            pad(now.getMonth() + 1) +
            "-" +
            pad(now.getDate()) +
            " " +
            pad(now.getHours()) +
            ":" +
            pad(now.getMinutes()) +
            ":" +
            pad(now.getSeconds())
        );
    }

    async createPurchase() {
        if (this.state.saving) {
            return;
        }
        if (!this.state.supplier) {
            this.inventory.notify(_t("Please select a supplier."), {type: "warning"});
            return;
        }
        if (!this.state.lines.length) {
            this.inventory.notify(_t("Please add at least one product."), {
                type: "warning",
            });
            return;
        }
        const datePlanned = this._formatDatePlanned();
        const values = {
            partner_id: this.state.supplier.id,
            partner_ref: this.state.vendorRef || false,
            user_id: this.state.buyer?.id || false,
            order_line: this.state.lines.map((line) => [
                0,
                0,
                {
                    product_id: line.product_id,
                    name: line.product_name,
                    product_qty: line.qty,
                    price_unit: line.price_unit || 0,
                    date_planned: datePlanned,
                },
            ]),
        };

        this.state.saving = true;
        try {
            const poIds = await this.inventory.create("purchase.order", [values]);
            const poId = poIds[0];

            // Move the scanned destination and lots onto the incoming picking
            // once it exists, then optionally confirm.
            const missingLot = this._trackedLinesMissingLot();
            const confirm = this.state.autoValidate && !missingLot.length;
            if (this.state.autoValidate && missingLot.length) {
                const names = missingLot.map((l) => l.product_name).join(", ");
                this.inventory.notify(
                    _t("Order saved as draft: a lot/serial is needed first for ") +
                        names,
                    {type: "warning"}
                );
            }
            if (confirm) {
                await this.inventory.call("purchase.order", "button_confirm", [poId]);
                await this._applyDestinationAndLots(poId);
            }

            this.inventory.notify(_t("Purchase order created successfully."), {
                type: "success",
            });
            this.store.navigate("main");
        } catch (error) {
            console.error(error);
            this.inventory.notify(_t("Purchase order could not be created."), {
                type: "danger",
            });
        } finally {
            this.state.saving = false;
        }
    }

    /**
     * After confirmation the incoming picking exists. Write the scanned
     * destination on it and drop the scanned lots onto the matching move lines,
     * so a GS1 receipt lands complete instead of losing its lot -- the gap the
     * reference implementation left open.
     */
    async _applyDestinationAndLots(poId) {
        const [po] = await this.inventory.read("purchase.order", [poId], [
            "picking_ids",
        ]);
        const pickingIds = po?.picking_ids || [];
        if (!pickingIds.length) {
            return;
        }
        if (this.state.destinationLocation) {
            await this.inventory.write("stock.picking", pickingIds, {
                location_dest_id: this.state.destinationLocation.id,
            });
        }
        const linesWithLot = this.state.lines.filter((l) => l.lot_name);
        if (!linesWithLot.length) {
            return;
        }
        const moveLines = await this.inventory.searchRead(
            "stock.move.line",
            [["picking_id", "in", pickingIds]],
            ["product_id"]
        );
        for (const line of linesWithLot) {
            const target = moveLines.find(
                (ml) => ml.product_id && ml.product_id[0] === line.product_id
            );
            if (target) {
                await this.inventory.write("stock.move.line", [target.id], {
                    lot_name: line.lot_name,
                });
            }
        }
    }

    static template = "barcode_purchase.PurchaseScreen";
}

barcodeScreens.add("purchase", {component: PurchaseScreen});
