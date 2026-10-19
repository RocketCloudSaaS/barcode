import {Component, onWillStart, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {barcodeMatchAnyDomain} from "@barcode_scanner/js/utils/scan_match.esm";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {formatFloat} from "@web/core/utils/numbers";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";
import {useService} from "@web/core/utils/hooks";

/**
 * Only storable products have stock to count. A service, a non-storable
 * consumable or a combo has no quant, and Odoo refuses to create one when the
 * adjustment is applied, so they are kept out of the count from the start.
 */
export const COUNTABLE_PRODUCTS = [["is_storable", "=", true]];

/**
 * What the operator is told when the product scanned has no stock to count.
 *
 * @param {Object} product the product scanned
 * @returns {String} the message
 */
export function notStorableMessage(product) {
    return _t("%(name)s is not a storable product: it has no stock to count.", {
        name: product.display_name,
    });
}

/**
 * Count step of an inventory adjustment. Shows the stock the location holds,
 * one line per product and lot; the operator counts by scanning (a GS1 label
 * also brings its lot/serial and piece count), by adding a product from the
 * "+" product selector -- like the back office, so a product not yet in the
 * location can be added -- and by typing the counted quantity. Lot/serial
 * tracked lines without a lot get a lot field (suggesting the product's lots;
 * the server finds or creates the lot by name). Applying builds and closes a
 * stock_inventory adjustment.
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
            lot_fixed: line.tracking !== "none" && Boolean(line.lot_name),
            lot_options: [],
            counted: null,
            isNew: false,
        }));
        this.state.loading = false;
    }

    // --- scanning -------------------------------------------------------------

    async onBarcodeScanned(barcode, parsed) {
        if (this.waitForApply()) {
            return;
        }
        const product = await this.findScannedProduct(barcode, parsed);
        // The count may have been applied while the product was looked up.
        if (!product || this.waitForApply()) {
            return;
        }
        const lotName = parsed?.lot || parsed?.serial || null;
        const qty = this.scannedQuantity(parsed, product.uom_id?.[0]);
        await this.addOrIncrement(product, lotName, qty);
    }

    /**
     * Whether the count is on its way to the server, telling the operator so:
     * a scan now would show up as counted without being so, then vanish with
     * the screen.
     *
     * @returns {Boolean} whether the scan must wait
     */
    waitForApply() {
        if (!this.state.applying) {
            return false;
        }
        this.inventory.notify(_t("Wait until the count is applied to scan again."), {
            type: "warning",
        });
        return true;
    }

    /**
     * The product a scan names, matched the same tolerant, all-candidates way
     * the other screens do: a GS1 GTIN has several equivalent variant forms,
     * and the parser's value can differ from the raw scan. When it names none
     * that can be counted, the operator is told why and null comes back.
     *
     * @param {String} barcode the raw scan
     * @param {Object} [parsed] what the parsers read from it
     * @returns {Promise<Object|null>} the product to count, if any
     */
    async findScannedProduct(barcode, parsed) {
        const candidates = [
            ...(parsed?.productCodes || []),
            parsed?.gtin,
            parsed?.value,
            barcode,
        ];
        const domain = barcodeMatchAnyDomain(candidates);
        const products = domain
            ? await this.inventory.searchRead("product.product", domain, [
                  "id",
                  "display_name",
                  "tracking",
                  "uom_id",
                  "is_storable",
              ])
            : [];
        if (!products.length) {
            this.inventory.notify(
                _t("No product matches “%(code)s”.", {code: parsed?.value || barcode}),
                {type: "warning"}
            );
            return null;
        }
        // Say why a scanned service or consumable is refused, rather than
        // "no match" for a product the operator can see in the catalogue.
        const product = products.find((p) => p.is_storable);
        if (!product) {
            this.inventory.notify(notStorableMessage(products[0]), {type: "warning"});
            return null;
        }
        return product;
    }

    /**
     * How much of the product a scan stands for: the piece count the barcode
     * states (a GS1 count, AI 30/37), or one unit.
     *
     * `productUomId` is the unit the product is stocked in. This base reading
     * ignores it, as barcode_stock's does; it is the seam a module that reads
     * richer barcodes patches, to turn a GS1 net weight into the product's unit.
     */
    // eslint-disable-next-line no-unused-vars
    scannedQuantity(scan, productUomId) {
        return parseFloat(scan?.qty ?? scan?.quantity ?? 0) || 1;
    }

    // --- add a product from the "+" selector ----------------------------------

    addProduct() {
        if (this.state.applying) {
            return;
        }
        this.store.navigate("inventory_product_selector", {
            locationId: this.state.locationId,
            locationName: this.state.locationName,
            lines: this.state.lines.map((l) => ({...l})),
            // Keep out of the "+" picker only the untracked products already
            // listed (those can have a single line). Lot/serial-tracked
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
        const tracking = product.tracking || "none";
        const key = this.lineKey(product.id, lotName);
        const line = this.state.lines.find(
            (l) => this.lineKey(l.product_id, l.lot_name) === key
        );
        if (line) {
            this.countAgain(line, product, lotName, qty);
            return;
        }
        const newLine = {
            _id: ++this._seq,
            product_id: product.id,
            product_name: product.display_name,
            tracking,
            lot_id: false,
            lot_name: lotName || "",
            theoretical_qty: 0,
            uom: product.uom_id?.[1] || "",
            lot_fixed: tracking !== "none" && Boolean(lotName),
            lot_options: [],
            counted: qty ? String(tracking === "serial" ? 1 : qty) : null,
            isNew: true,
        };
        // Put a freshly scanned/added product at the TOP, where the operator is
        // looking, instead of appending it out of sight at the bottom.
        this.state.lines.unshift(newLine);
        this.flashLine(newLine);
        if (this.needsLotInput(newLine)) {
            await this.loadLotOptions(newLine);
        }
    }

    /**
     * A product and lot already listed is scanned or picked again: add what it
     * stands for to its line -- a serial number only ever counts one unit --
     * and show the operator which line that is.
     *
     * @param {Object} line the line of that product and lot
     * @param {Object} product the product scanned or picked
     * @param {String|null} lotName the lot/serial number read, if any
     * @param {Number} qty the quantity the scan stands for; 0 when picked
     */
    countAgain(line, product, lotName, qty) {
        const serial = product.tracking === "serial";
        if (qty && serial && this.isCounted(line)) {
            // A serial number is one unit: reading it again counts nothing.
            this.inventory.notify(this.serialCountedMessage(product, lotName), {
                type: "warning",
            });
        } else if (qty) {
            line.counted = serial ? "1" : String((parseFloat(line.counted) || 0) + qty);
        }
        // The line may be far down a long list: flag it so the operator sees
        // what the scan just changed, and bring it into view.
        this.flashLine(line);
    }

    serialCountedMessage(product, lotName) {
        if (lotName) {
            return _t("Serial number %(lot)s is already counted.", {lot: lotName});
        }
        return _t(
            "%(name)s is already counted: set its serial number before counting another one.",
            {name: product.display_name}
        );
    }

    /**
     * Draw the operator's eye to the line a scan just added or changed: mark it
     * highlighted for a moment and scroll it into view. Purely visual; it never
     * changes the counted data.
     *
     * @param {Object} line the count line to highlight
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

    /**
     * Suggest the lots the server would take for this line: its company's and
     * the shared ones, so that no suggestion becomes a new lot once applied.
     *
     * @param {Object} line the count line that needs its lot
     */
    async loadLotOptions(line) {
        line.lot_options = await this.inventory.call(
            "stock.inventory",
            "action_barcode_lot_names",
            [this.state.locationId, line.product_id]
        );
    }

    // While the count is applied, the lines stay as they were sent.

    setLotName(line, value) {
        if (!this.state.applying) {
            line.lot_name = value;
        }
    }

    needsLotInput(line) {
        return line.tracking !== "none" && !line.lot_fixed;
    }

    // --- quantities -----------------------------------------------------------

    setCounted(line, value) {
        if (!this.state.applying) {
            line.counted = value === "" ? null : value;
        }
    }

    isCounted(line) {
        return line.counted !== null && line.counted !== "";
    }

    diff(line) {
        if (!this.isCounted(line)) {
            return null;
        }
        return (parseFloat(line.counted) || 0) - line.theoretical_qty;
    }

    /**
     * How a difference reads on the line: its sign, and nothing after the
     * decimal point that is not there (`+2`, `-0.5`, `0`).
     *
     * @param {Number} value the difference between the count and the stock
     * @returns {String} the difference to show
     */
    formatDiff(value) {
        const text = this.formatQty(value);
        return value > 0 ? `+${text}` : text;
    }

    formatQty(value) {
        return formatFloat(value, {trailingZeros: false});
    }

    diffClass(line) {
        const diff = this.diff(line);
        if (diff > 0) {
            return "ilx-inv-diff-up";
        }
        return diff < 0 ? "ilx-inv-diff-down" : "ilx-inv-diff-none";
    }

    removeLine(line) {
        if (this.state.applying) {
            return;
        }
        const index = this.state.lines.indexOf(line);
        if (index !== -1) {
            this.state.lines.splice(index, 1);
        }
    }

    get countedLines() {
        return this.state.lines.filter((l) => this.isCounted(l));
    }

    // --- apply ----------------------------------------------------------------

    async apply() {
        if (this.state.applying) {
            return;
        }
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
