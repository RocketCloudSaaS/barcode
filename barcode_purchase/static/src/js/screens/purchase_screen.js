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
} from "@barcode_purchase/js/utils/scan_match";

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
     * Lines of a lot/serial-tracked product the operator could not give a lot
     * for. The order is confirmed anyway: a vendor's lot or serial is usually
     * unknown until the goods turn up, and it belongs on the receipt, not on the
     * order -- the screen has no way to type one either, only a GS1 label
     * carries it. The receipt still cannot be validated until somebody enters
     * it, so these lines get named in the message.
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
        let poId = null;
        try {
            const poIds = await this.inventory.create("purchase.order", [values]);
            poId = poIds[0];

            // Confirm when asked, then move the scanned destination and lots
            // onto the picking the confirmation raised.
            const missingLot = this.state.autoValidate
                ? this._trackedLinesMissingLot()
                : [];
            if (this.state.autoValidate) {
                await this.inventory.call("purchase.order", "button_confirm", [poId]);
                await this._applyDestinationAndLots(poId);
            }
            await this._notifyOutcome(poId, missingLot);
            this.store.navigate("main");
        } catch (error) {
            console.error(error);
            // The order may well exist and only the confirmation have failed:
            // say so, so the operator goes looking for it in the back office
            // instead of raising the same order twice.
            const message = poId
                ? _t("The order was created but not confirmed. Check it in Purchase.")
                : _t("Purchase order could not be created.");
            this.inventory.notify(message, {type: "danger"});
        } finally {
            this.state.saving = false;
        }
    }

    /**
     * Say what actually happened, by order number and by the state the server
     * ended up in. A confirmation does not always confirm: with two-step
     * validation the order lands on "To Approve" and raises no receipt. The old
     * single "created successfully" made every outcome look identical, so nobody
     * could tell a confirmed order from one still waiting in the back office.
     */
    async _notifyOutcome(poId, missingLot) {
        const [po] = await this.inventory.read("purchase.order", [poId], [
            "name",
            "state",
        ]);
        const name = po?.name || "";
        const pending = missingLot.map((line) => line.product_name).join(", ");
        if (["purchase", "done"].includes(po?.state)) {
            if (pending) {
                this.inventory.notify(
                    _t(
                        "%s confirmed -- set the lot/serial of %s on the receipt.",
                        name,
                        pending
                    ),
                    {type: "warning"}
                );
                return;
            }
            this.inventory.notify(_t("Purchase order %s confirmed.", name), {
                type: "success",
            });
            return;
        }
        if (po?.state === "to approve") {
            this.inventory.notify(
                _t("Purchase order %s created -- it is waiting for approval.", name),
                {type: "warning"}
            );
            return;
        }
        this.inventory.notify(
            this.state.autoValidate
                ? _t("Purchase order %s was created but is still a draft.", name)
                : _t("Purchase order %s saved as a draft.", name),
            {type: this.state.autoValidate ? "warning" : "success"}
        );
    }

    /**
     * After confirmation the incoming picking exists. Write the scanned
     * destination on it and drop the scanned lots onto the matching move lines,
     * so a GS1 receipt lands complete instead of losing its lot -- the gap the
     * reference implementation left open.
     *
     * Every scanned line became its own purchase order line, and purchase_stock
     * keeps `purchase_line_id` out of the move merge, so each order line has its
     * own move: the lots are routed through it and no move line is written twice.
     * Matching by product alone sent every lot of a product to that product's
     * first move line, so scanning two lots or serials of the same product kept
     * only the last one.
     */
    async _applyDestinationAndLots(poId) {
        const [po] = await this.inventory.read("purchase.order", [poId], [
            "picking_ids",
            "order_line",
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
        if (!this.state.lines.some((line) => line.lot_name)) {
            return;
        }
        const orderLineIds = await this._orderLineIdPerScannedLine(po.order_line || []);
        const moves = await this.inventory.searchRead(
            "stock.move",
            [["picking_id", "in", pickingIds]],
            ["product_id", "purchase_line_id", "move_line_ids"]
        );
        const written = new Set();
        const missed = [];
        for (const [index, line] of this.state.lines.entries()) {
            if (!line.lot_name) {
                continue;
            }
            const moveLineId = this._freeMoveLineFor(
                moves,
                orderLineIds[index],
                line.product_id,
                written
            );
            if (!moveLineId) {
                missed.push(`${line.product_name} (${line.lot_name})`);
                continue;
            }
            written.add(moveLineId);
            await this.inventory.write("stock.move.line", [moveLineId], {
                lot_name: line.lot_name,
            });
        }
        // Rather than overwrite a lot that is already on the receipt, say which
        // ones the operator still has to enter there by hand.
        if (missed.length) {
            this.inventory.notify(
                _t("Set these lots on the receipt by hand: ") + missed.join(", "),
                {type: "warning"}
            );
        }
    }

    /**
     * The order lines were created from `state.lines` in order, so the k-th
     * order line of a product is the k-th scanned line of that product -- an
     * order inside a product that id ordering preserves whatever `_order` does.
     * Returns the order line id for each scanned line, by position.
     */
    async _orderLineIdPerScannedLine(orderLineIds) {
        const perProduct = new Map();
        if (orderLineIds.length) {
            const orderLines = await this.inventory.read(
                "purchase.order.line",
                orderLineIds,
                ["product_id"]
            );
            for (const orderLine of [...orderLines].sort((a, b) => a.id - b.id)) {
                const productId = orderLine.product_id && orderLine.product_id[0];
                if (!perProduct.has(productId)) {
                    perProduct.set(productId, []);
                }
                perProduct.get(productId).push(orderLine.id);
            }
        }
        return this.state.lines.map(
            (line) => perProduct.get(line.product_id)?.shift() || null
        );
    }

    /**
     * A free move line of the order line's own move -- falling back to the
     * product's moves when there is no `purchase_line_id` to go by, and never a
     * move line another scanned lot already claimed.
     */
    _freeMoveLineFor(moves, orderLineId, productId, written) {
        const ownMoves = orderLineId
            ? moves.filter(
                  (move) =>
                      move.purchase_line_id &&
                      move.purchase_line_id[0] === orderLineId
              )
            : [];
        const candidates = ownMoves.length
            ? ownMoves
            : moves.filter(
                  (move) => move.product_id && move.product_id[0] === productId
              );
        for (const move of candidates) {
            const free = (move.move_line_ids || []).find((id) => !written.has(id));
            if (free) {
                return free;
            }
        }
        return null;
    }

    static template = "barcode_purchase.PurchaseScreen";
}

barcodeScreens.add("purchase", {component: PurchaseScreen});
