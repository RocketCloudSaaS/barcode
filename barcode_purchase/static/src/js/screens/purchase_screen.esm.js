import {
    barcodeMatchAnyDomain,
    barcodeMatchDomain,
} from "@barcode_scanner/js/utils/scan_match.esm";
import {Component, useState} from "@odoo/owl";
import {_t} from "@web/core/l10n/translation";
import {barcodeScreens} from "@barcode_scanner/js/registries.esm";
import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler.esm";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory.esm";
import {useService} from "@web/core/utils/hooks";

// The products the scanner offers for an order: goods that can be purchased.
export const PURCHASABLE_PRODUCTS = [
    ["type", "=", "consu"],
    ["purchase_ok", "=", true],
];

// What a product search reads: enough to draw a line and price it.
export const PRODUCT_FIELDS = [
    "display_name",
    "default_code",
    "standard_price",
    "tracking",
    "uom_po_id",
];

/**
 * Create a purchase order from the scanner: pick a vendor, a destination
 * location and a buyer, scan or add the products (a GS1 label carries its own
 * lot and piece count), then create the order and -- if asked -- confirm it,
 * which raises the incoming picking. The server does all of it in one call.
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
        if (params.addProduct) {
            // Back from the product selector with the product picked there.
            this.addPicked(params.addProduct);
        }

        useBarcodeHandler({
            onScan: async (barcode, parsedData) => {
                await this.onBarcodeScanned(barcode, parsedData);
            },
        });
    }

    async onBarcodeScanned(barcode, parsedData) {
        if (this.state.saving) {
            // The order is on its way to the server: a scan now would show up
            // on it without being so, then vanish with the screen.
            this.inventory.notify(_t("Wait until the order is saved to scan again."), {
                type: "warning",
            });
            return;
        }
        // A scanned location barcode sets the destination; anything else is
        // resolved as a product to add to the order.
        const locationDomain = barcodeMatchDomain(barcode);
        const locations = locationDomain
            ? await this.inventory.searchRead(
                  "stock.location",
                  [["usage", "=", "internal"], ...locationDomain],
                  ["display_name"]
              )
            : [];
        if (locations.length) {
            this.state.destinationLocation = {
                id: locations[0].id,
                display_name: locations[0].display_name,
            };
            this.inventory.notify(
                _t("Destination location selected: %(name)s", {
                    name: locations[0].display_name,
                }),
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
                  [...PURCHASABLE_PRODUCTS, ...productDomain],
                  PRODUCT_FIELDS
              )
            : [];
        if (!products.length) {
            this.inventory.notify(_t("Product not found."), {type: "warning"});
            return;
        }
        this.addPicked({product: products[0], parsed: parsedData || null});
    }

    /**
     * Add a product scanned here or picked in the product selector, with the
     * lot and the quantity its barcode states.
     *
     * @param {{product: Object, parsed: (Object|null)}} picked
     */
    addPicked({product, parsed}) {
        const lotName = parsed?.lot || parsed?.serial || null;
        const qty = this.scannedQuantity(parsed, product.uom_po_id?.[0]);
        this.addLine(product, lotName, qty);
    }

    /**
     * How much of the product a scan stands for: the piece count the barcode
     * states (a GS1 count, AI 30/37), or one unit.
     *
     * `productUomId` is the unit the product is purchased in. This base reading
     * ignores it, as barcode_stock's does; it is the seam a module that reads
     * richer barcodes patches, to turn a GS1 net weight into that unit.
     */
    // eslint-disable-next-line no-unused-vars
    scannedQuantity(scan, productUomId) {
        return parseFloat(scan?.qty ?? scan?.quantity ?? 0) || 1;
    }

    /**
     * One line per product and lot: scanning them again adds to it.
     */
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
        this.state.saving = true;
        try {
            const result = await this.inventory.call(
                "purchase.order",
                "action_barcode_purchase",
                [
                    this.state.supplier.id,
                    this.state.lines.map((line) => ({
                        product_id: line.product_id,
                        qty: parseFloat(line.qty) || 0,
                        price_unit: line.price_unit,
                        lot_name: line.lot_name || false,
                    })),
                ],
                {
                    confirm: this.state.autoValidate,
                    location_dest_id: this.state.destinationLocation?.id || false,
                    user_id: this.state.buyer?.id || false,
                    partner_ref: this.state.vendorRef || false,
                }
            );
            this.notifyOutcome(result);
            this.store.navigate("main");
        } catch {
            // The API wrapper already surfaced the server error to the operator,
            // and nothing was written: the whole order is one transaction.
        } finally {
            this.state.saving = false;
        }
    }

    /**
     * Say what actually happened, by order number and by the state the server
     * ended up in. A confirmation does not always confirm: with two-step
     * validation the order lands on "To Approve" and raises no receipt.
     *
     * @param {{name: String, state: String, missing_lots: String[], unplaced_lots: String[]}} result
     */
    notifyOutcome({name, state, missing_lots, unplaced_lots}) {
        if (unplaced_lots?.length) {
            this.inventory.notify(
                _t("Set these lots on the receipt by hand: %(lots)s", {
                    lots: unplaced_lots.join(", "),
                }),
                {type: "warning"}
            );
        }
        if (["purchase", "done"].includes(state)) {
            if (missing_lots?.length) {
                this.inventory.notify(
                    _t(
                        "%(name)s confirmed -- set the lot/serial of %(products)s on the receipt.",
                        {name, products: missing_lots.join(", ")}
                    ),
                    {type: "warning"}
                );
                return;
            }
            this.inventory.notify(_t("Purchase order %(name)s confirmed.", {name}), {
                type: "success",
            });
            return;
        }
        if (state === "to approve") {
            this.inventory.notify(
                _t("Purchase order %(name)s created -- it is waiting for approval.", {
                    name,
                }),
                {type: "warning"}
            );
            return;
        }
        this.inventory.notify(
            this.state.autoValidate
                ? _t("Purchase order %(name)s was created but is still a draft.", {
                      name,
                  })
                : _t("Purchase order %(name)s saved as a draft.", {name}),
            {type: this.state.autoValidate ? "warning" : "success"}
        );
    }

    static template = "barcode_purchase.PurchaseScreen";
}

barcodeScreens.add("purchase", {component: PurchaseScreen});
