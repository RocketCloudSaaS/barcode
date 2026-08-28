/** @odoo-module **/

import {barcodeScreens} from "@barcode_scanner/js/registries";

import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {useService} from "@web/core/utils/hooks";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {barcodeMatchAnyDomain} from "@barcode_stock/js/utils/scan_match";

/**
 * Count step of an inventory adjustment. Shows the location's current on-hand
 * stock as theoretical lines; the operator counts by scanning (GS1 lot/serial
 * and quantity are used when present), by adding a product from the "+" product
 * selector -- like the back office, so a product not yet in the location can be
 * added -- and by typing the counted quantity. Lot/serial-tracked lines expose
 * a lot field (autocompleting existing lots; the server resolves or creates it
 * by name). Applying builds and closes a stock_inventory adjustment group.
 *
 * The count in progress survives the round-trip to the product selector: it is
 * carried through the navigation params and restored on the way back.
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
        });

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });

        onWillStart(async () => {
            const params = this.props.params || {};
            this.state.locationId = params.locationId || null;
            this.state.locationName = params.locationName || "";
            if (Array.isArray(params.lines)) {
                // Coming back from the product selector: restore the count.
                this.state.lines = params.lines.map((l) => ({...l}));
                this._seq = this.state.lines.reduce(
                    (max, l) => Math.max(max, l._id || 0),
                    0
                );
                this.state.loading = false;
                if (params.addProduct) {
                    await this.addOrIncrement(params.addProduct, null, 0);
                }
            } else {
                await this.loadLines();
            }
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
        // Match the product the same tolerant, all-candidates way the picking and
        // transfer screens do: a GS1 GTIN has several equivalent variant forms,
        // and the parser's value can differ from the raw scan, so try every
        // candidate (variants, gtin, value) AND the raw barcode.
        const candidates = [
            ...(parsed?.productCodes || []),
            parsed?.gtin,
            parsed?.value,
            barcode,
        ];
        const domain = barcodeMatchAnyDomain(candidates);
        const products = domain
            ? await this.inventory.searchRead(
                  "product.product",
                  domain,
                  ["id", "display_name", "tracking", "uom_id"]
              )
            : [];
        if (!products.length) {
            this.inventory.notify(
                _t("No product matches “%(code)s”.", {code: parsed?.value || barcode}),
                {type: "warning"}
            );
            return;
        }
        const product = products[0];
        const lotName = parsed?.lot || parsed?.serial || null;
        const qty = parseFloat(parsed?.quantity ?? parsed?.qty) || 1;
        await this.addOrIncrement(product, lotName, qty);
    }

    // --- add a product from the "+" selector ----------------------------------

    addProduct() {
        this.store.navigate("inventory_product_selector", {
            locationId: this.state.locationId,
            locationName: this.state.locationName,
            lines: this.state.lines.map((l) => ({...l})),
            // Keep out of the "+" picker only the untracked products already
            // counted (those can have a single line). Lot/serial-tracked
            // products stay pickable: the operator legitimately needs several
            // lines for the same product, one per lot/serial number.
            excludeProductIds: [
                ...new Set(
                    this.state.lines
                        .filter((l) => (l.tracking || "none") === "none")
                        .map((l) => l.product_id)
                ),
            ],
        });
    }

    // --- shared add/increment -------------------------------------------------

    async addOrIncrement(product, lotName, qty) {
        const key = this.lineKey(product.id, lotName);
        const line = this.state.lines.find(
            (l) => this.lineKey(l.product_id, l.lot_name) === key
        );
        if (line) {
            if (qty) {
                line.counted = String((parseFloat(line.counted) || 0) + qty);
            }
            // The scanned line may be far down a long list: flag it so the
            // operator sees what the scan just changed, and bring it into view.
            this.flashLine(line);
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
        // Put a freshly scanned/added product at the TOP, where the operator is
        // looking, instead of appending it out of sight at the bottom.
        this.state.lines.unshift(newLine);
        this.flashLine(newLine);
        if (tracking !== "none" && !newLine.lot_fixed) {
            await this.loadLotOptions(newLine);
        }
    }

    /**
     * Draw the operator's eye to the line a scan just added or changed: mark it
     * highlighted for a moment and scroll it into view. Purely visual; it never
     * changes the counted data.
     */
    flashLine(line) {
        line._flash = true;
        clearTimeout(line._flashTimer);
        line._flashTimer = setTimeout(() => {
            line._flash = false;
        }, 1500);
        // Scroll after the DOM has the (re)ordered line.
        requestAnimationFrame(() => {
            const el = document.getElementById(`inv-count-line-${line._id}`);
            if (el) {
                el.scrollIntoView({behavior: "smooth", block: "nearest"});
            }
        });
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
