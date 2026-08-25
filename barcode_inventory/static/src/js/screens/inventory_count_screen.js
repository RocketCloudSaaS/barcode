/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {barcodeMatchDomain} from "@barcode_scanner/js/utils/scan_match";

/**
 * Count step of an inventory adjustment. Shows the location's current on-hand
 * stock as theoretical lines; the operator counts by scanning (GS1 lot/serial
 * and quantity are used when present), by searching a product by hand -- like
 * the back office, so a product not yet in the location can be added -- and by
 * typing the counted quantity. Lot/serial-tracked lines expose a lot field
 * (autocompleting existing lots; the server resolves or creates it by name).
 * Applying builds and closes a stock_inventory adjustment group server-side.
 */
export class InventoryCountScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.store = useService("barcodeStore");
        this._seq = 0;
        this.state = useState({
            locationId: null,
            locationName: "",
            lines: [],
            loading: true,
            applying: false,
            productSearch: "",
            productResults: [],
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            this.state.locationId = this.props.params?.locationId || null;
            this.state.locationName = this.props.params?.locationName || "";
            await this.loadLines();
        });
    }

    lineKey(productId, lotName) {
        return `${productId}|${lotName || ""}`;
    }

    async loadLines() {
        if (!this.state.locationId) {
            this.state.loading = false;
            return;
        }
        const data = await this.inventory.call(
            "stock.inventory",
            "action_barcode_location_lines",
            [this.state.locationId]
        );
        this.state.lines = (data.lines || []).map((line) => ({
            _id: ++this._seq,
            ...line,
            // Stock already here has its lot resolved; the operator just counts.
            lot_fixed: line.tracking !== "none" && !!line.lot_name,
            lot_options: [],
            counted: null,
            isNew: false,
        }));
        this.state.loading = false;
    }

    // --- scanning -------------------------------------------------------------

    async onBarcodeScanned(barcode, parsed) {
        const code = parsed?.gtin || parsed?.value || barcode;
        const domain = barcodeMatchDomain(code);
        const products = domain
            ? await this.inventory.searchRead(
                  "product.product",
                  domain,
                  ["id", "display_name", "tracking", "uom_id"]
              )
            : [];
        if (!products.length) {
            this.inventory.notify(_t("No product matches “%(code)s”.", {code}), {
                type: "warning",
            });
            return;
        }
        const product = products[0];
        const lotName = parsed?.lot || parsed?.serial || null;
        const qty = parseFloat(parsed?.quantity ?? parsed?.qty) || 1;
        await this.addOrIncrement(product, lotName, qty);
    }

    // --- manual product search (like the back office) -------------------------

    async searchProducts(ev) {
        const term = ev.target.value;
        this.state.productSearch = term;
        if (!term || term.length < 2) {
            this.state.productResults = [];
            return;
        }
        this.state.productResults = await this.inventory.searchRead(
            "product.product",
            ["|", ["name", "ilike", term], ["barcode", "ilike", term]],
            ["id", "display_name", "tracking", "uom_id"],
            {limit: 20}
        );
    }

    async addManualProduct(product) {
        this.state.productSearch = "";
        this.state.productResults = [];
        // Manual add carries no lot; a tracked product gets an editable lot line.
        await this.addOrIncrement(product, null, 0, {focusLot: true});
    }

    // --- shared add/increment -------------------------------------------------

    async addOrIncrement(product, lotName, qty, options = {}) {
        const key = this.lineKey(product.id, lotName);
        const line = this.state.lines.find(
            (l) => this.lineKey(l.product_id, l.lot_name) === key
        );
        if (line) {
            if (qty) {
                line.counted = String((parseFloat(line.counted) || 0) + qty);
            }
            return;
        }
        const tracking = product.tracking || "none";
        const newLine = {
            _id: ++this._seq,
            product_id: product.id,
            product_name: product.display_name,
            tracking,
            lot_id: false,
            lot_name: lotName || "",
            theoretical_qty: 0,
            uom: product.uom_id?.[1] || "",
            lot_fixed: tracking !== "none" && !!lotName,
            lot_options: [],
            counted: qty ? String(qty) : null,
            isNew: true,
        };
        this.state.lines.push(newLine);
        if (tracking !== "none" && !newLine.lot_fixed) {
            await this.loadLotOptions(newLine);
        }
    }

    // --- lot handling ---------------------------------------------------------

    async loadLotOptions(line) {
        const lots = await this.inventory.searchRead(
            "stock.lot",
            [["product_id", "=", line.product_id]],
            ["name"]
        );
        line.lot_options = lots.map((l) => l.name);
    }

    setLotName(line, value) {
        line.lot_name = value;
    }

    needsLotInput(line) {
        return line.tracking !== "none" && !line.lot_fixed;
    }

    setCounted(line, value) {
        line.counted = value === "" ? null : value;
    }

    diff(line) {
        if (line.counted === null || line.counted === "") {
            return null;
        }
        return (parseFloat(line.counted) || 0) - line.theoretical_qty;
    }

    removeLine(line) {
        const index = this.state.lines.indexOf(line);
        if (index !== -1) {
            this.state.lines.splice(index, 1);
        }
    }

    get countedLines() {
        return this.state.lines.filter(
            (l) => l.counted !== null && l.counted !== ""
        );
    }

    async apply() {
        const counted = this.countedLines;
        if (!counted.length) {
            this.inventory.notify(_t("Count at least one product before applying."), {
                type: "warning",
            });
            return;
        }
        const missingLot = counted.find(
            (l) => l.tracking !== "none" && !String(l.lot_name || "").trim()
        );
        if (missingLot) {
            this.inventory.notify(
                _t("Set the lot/serial for %(name)s before applying.", {
                    name: missingLot.product_name,
                }),
                {type: "warning"}
            );
            return;
        }
        this.state.applying = true;
        try {
            const result = await this.inventory.call(
                "stock.inventory",
                "action_barcode_apply_count",
                [
                    this.state.locationId,
                    counted.map((l) => ({
                        product_id: l.product_id,
                        lot_name: l.lot_name || "",
                        counted_qty: parseFloat(l.counted) || 0,
                    })),
                ]
            );
            this.inventory.notify(
                _t("Inventory adjusted: %(n)s product(s).", {n: result.adjusted}),
                {type: "success"}
            );
            this.store.navigate("main", {}, {clearHistory: true});
        } catch {
            // The API wrapper already surfaced the server error to the operator.
            this.state.applying = false;
        }
    }

    goBack() {
        this.store.goBack();
    }

    static template = "barcode_inventory.InventoryCountScreen";
}

barcodeScreens.add("inventory_count", {component: InventoryCountScreen});
