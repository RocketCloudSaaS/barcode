/** @odoo-module **/

import {useBarcodeHandler} from "@barcode_scanner/js/hooks/use_barcode_handler";
import {useBarcodeScanner} from "@barcode_scanner/js/hooks/use_inventory";
import {Component, onWillStart, onWillUpdateProps, useState} from "@odoo/owl";
import {useService} from "@web/core/utils/hooks";

export class InternalTransferScreen extends Component {
    setup() {
        this.inventory = useBarcodeScanner();
        this.notification = useService("notification");
        const params = this.props.params || {};
        const initialLines = JSON.parse(JSON.stringify(params.lines || []));
        for (const line of initialLines) {
            if (!line.lots) {
                line.lots = [];
            }
        }
        this.state = useState({
            origin_location: params.origin_location || null,
            destination_location: params.destination_location || null,
            responsible: params.responsible || null,
            lines: initialLines,
            picking_id: null,
            isCheckingAvailability: false,
            isValidating: false,
        });
        useBarcodeHandler({
            onScan: (barcode, parsedData) => {
                this.onBarcodeScanned(barcode, parsedData);
            },
        });
        onWillStart(async () => {
            await this.loadLotsForTrackedLines();
        });
        onWillUpdateProps(async (nextProps) => {
            const nextParams = nextProps.params || {};
            const originChanged =
                nextParams.origin_location?.id !== this.state.origin_location?.id;
            this.state.origin_location = nextParams.origin_location || null;
            this.state.destination_location = nextParams.destination_location || null;
            this.state.responsible = nextParams.responsible || null;
            const nextLines = JSON.parse(JSON.stringify(nextParams.lines || []));
            for (const line of nextLines) {
                if (!line.lots) {
                    line.lots = [];
                }
            }
            this.state.lines = nextLines;
            if (
                originChanged ||
                this.state.lines.some((line) => line.tracking !== "none")
            ) {
                await this.loadLotsForTrackedLines();
            }
        });
    }

    async onBarcodeScanned(barcode, parsedData) {
        await this.handleBarcode(barcode, parsedData);
    }

    async handleBarcode(barcode, parsedData) {
        const locations = await this.inventory.searchRead(
            "stock.location",
            [["barcode", "=", barcode]],
            ["display_name"]
        );
        if (locations.length) {
            const location = locations[0];
            if (this.state.origin_location) {
                this.state.destination_location = {
                    id: location.id,
                    display_name: location.display_name,
                };
                this.notification.add(
                    "Destination location selected: " + location.display_name,
                    {type: "success"}
                );
            } else {
                this.state.origin_location = {
                    id: location.id,
                    display_name: location.display_name,
                };
                this.notification.add(
                    "Origin location selected: " + location.display_name,
                    {type: "success"}
                );
            }
            return;
        }
        if (!parsedData || !parsedData.value) {
            this.notification.add("Barcode not recognized.", {type: "warning"});
            return;
        }
        await this.handleEAN13(parsedData.value || barcode);
    }

    async handleEAN13(barcode) {
        const products = await this.inventory.searchRead("product.product", [
            ["barcode", "=", barcode],
        ]);
        if (!products.length) {
            this.notification.add("Product not found.", {
                type: "warning",
            });
            return;
        }
        const product = products[0];
        await this.addLine(product, null, null, 1);
    }

    async addLine(product, lotId, lotName, qty) {
        const existing = this.state.lines.find(
            (l) => l.product_id === product.id && l.lot_id === lotId
        );
        if (existing) {
            existing.qty += qty;
            if (existing.tracking !== "none") {
                if (!existing.lots) {
                    existing.lots = [];
                }
                if (!existing.lots.length) {
                    existing.lots = (await this.fetchLots(product.id)) || [];
                }
            }
            return;
        }
        const lots =
            product.tracking === "none" ? [] : (await this.fetchLots(product.id)) || [];
        this.state.lines.push({
            product_id: product.id,
            product_name: product.name,
            qty: qty,
            tracking: product.tracking,
            lot_id: lotId,
            lot_name: lotName,
            lots: lots,
        });
    }

    async fetchLots(productId) {
        if (!this.state.origin_location?.id) {
            return (
                (await this.inventory.searchRead(
                    "stock.lot",
                    [["product_id", "=", productId]],
                    ["id", "name"]
                )) || []
            );
        }
        const quants = await this.inventory.searchRead(
            "stock.quant",
            [
                ["product_id", "=", productId],
                ["location_id", "child_of", this.state.origin_location.id],
                ["quantity", ">", 0],
                ["lot_id", "!=", false],
            ],
            ["lot_id"]
        );
        const lotIds = [
            ...new Set(quants.map((quant) => quant.lot_id?.[0]).filter(Boolean)),
        ];
        if (!lotIds.length) {
            return [];
        }
        return (await this.inventory.read("stock.lot", lotIds, ["name"])) || [];
    }

    async loadLotsForTrackedLines() {
        for (const line of this.state.lines) {
            if (line.tracking !== "none") {
                if (!line.lots) {
                    line.lots = [];
                }
                if (!line.lots.length) {
                    line.lots = (await this.fetchLots(line.product_id)) || [];
                }
                this.updateLineLotName(line);
            }
        }
    }

    updateLineLotName(line) {
        if (!line.lot_id) {
            line.lot_name = null;
            return;
        }
        const normalizedLotId = parseInt(line.lot_id, 10);
        line.lot_id = Number.isNaN(normalizedLotId) ? line.lot_id : normalizedLotId;
        const selectedLot = (line.lots || []).find((lot) => lot.id === line.lot_id);
        if (selectedLot) {
            line.lot_name = selectedLot.name;
        }
    }

    selectOriginLocation() {
        this.props.navigate("location_selector", {
            title: "Select origin location",
            type: "origin_location",
            origin_location: this.state.origin_location,
            destination_location: this.state.destination_location,
            responsible: this.state.responsible,
            lines: this.state.lines,
        });
    }

    selectDestinationLocation() {
        this.props.navigate("location_selector", {
            title: "Select destination location",
            type: "destination_location",
            origin_location: this.state.origin_location,
            destination_location: this.state.destination_location,
            responsible: this.state.responsible,
            lines: this.state.lines,
        });
    }

    selectResponsible() {
        this.props.navigate("user_selector", {
            returnRoute: "internal_transfer",
            returnParams: {
                origin_location: this.state.origin_location,
                destination_location: this.state.destination_location,
                responsible: this.state.responsible,
                lines: this.state.lines,
            },
            responsible: this.state.responsible,
        });
    }

    addProduct() {
        this.props.navigate("product_selector", {
            origin_location: this.state.origin_location,
            destination_location: this.state.destination_location,
            responsible: this.state.responsible,
            lines: this.state.lines,
        });
    }

    removeLine(line) {
        const index = this.state.lines.indexOf(line);
        if (index !== -1) {
            this.state.lines.splice(index, 1);
        }
    }

    get normalizedLines() {
        return this.state.lines.map((line) => {
            const normalizedLotId = line.lot_id ? parseInt(line.lot_id, 10) : false;
            const lots = line.lots || [];
            const selectedLot = lots.find((lot) => lot.id === normalizedLotId);
            return {
                product_id: line.product_id,
                qty: parseFloat(line.qty) || 0,
                lot_id: normalizedLotId || false,
                lot_name: selectedLot?.name || line.lot_name || false,
            };
        });
    }

    validateForm() {
        if (!this.state.origin_location?.id) {
            this.notification.add("Please select an origin location.", {
                type: "warning",
            });
            return false;
        }
        if (!this.state.destination_location?.id) {
            this.notification.add("Please select a destination location.", {
                type: "warning",
            });
            return false;
        }
        if (this.state.origin_location.id === this.state.destination_location.id) {
            this.notification.add(
                "Origin and destination locations must be different.",
                {type: "warning"}
            );
            return false;
        }
        if (!this.state.lines.length) {
            this.notification.add("Add at least one product.", {type: "warning"});
            return false;
        }
        for (const line of this.state.lines) {
            if (!(parseFloat(line.qty) > 0)) {
                this.notification.add(
                    `Quantity must be greater than zero for ${line.product_name}.`,
                    {type: "warning"}
                );
                return false;
            }
            this.updateLineLotName(line);
            if (line.tracking !== "none" && !line.lot_id) {
                this.notification.add(
                    `Please select a lot/serial number for ${line.product_name}.`,
                    {type: "warning"}
                );
                return false;
            }
        }
        return true;
    }

    async checkAvailability() {
        if (!this.validateForm()) {
            return;
        }
        this.state.isCheckingAvailability = true;
        try {
            const result = await this.inventory.call(
                "stock.picking",
                "action_barcode_scanner_check_availability",
                [
                    this.state.origin_location.id,
                    this.state.destination_location.id,
                    this.normalizedLines,
                    this.state.responsible?.id || false,
                ]
            );
            const unavailableLines = (result.lines || []).filter(
                (line) => !line.available
            );
            if (!unavailableLines.length) {
                this.notification.add("All products are available.", {
                    type: "success",
                });
                return;
            }
            const message = unavailableLines
                .map(
                    (line) =>
                        `${line.product_name}: ${line.available_qty}/${line.required_qty}`
                )
                .join(" | ");
            this.notification.add(message, {type: "warning"});
        } catch (error) {
            const message =
                error?.data?.message || error?.message || "Availability check failed.";
            this.notification.add(message, {type: "danger"});
        } finally {
            this.state.isCheckingAvailability = false;
        }
    }

    async validateTransfer() {
        if (!this.validateForm()) {
            return;
        }
        this.state.isValidating = true;
        try {
            const result = await this.inventory.call(
                "stock.picking",
                "action_barcode_scanner_internal_transfer",
                [
                    this.state.origin_location.id,
                    this.state.destination_location.id,
                    this.state.responsible?.id || false,
                    this.normalizedLines,
                ]
            );
            this.state.picking_id = result.picking_id;
            this.notification.add(
                `Internal transfer ${result.picking_name} validated successfully.`,
                {type: "success"}
            );
            this.goBack();
        } catch (error) {
            const message =
                error?.data?.message || error?.message || "Internal transfer failed.";
            this.notification.add(message, {type: "danger"});
        } finally {
            this.state.isValidating = false;
        }
    }

    onLotChanged(line, ev) {
        line.lot_id = ev.target.value ? parseInt(ev.target.value, 10) : false;
        this.updateLineLotName(line);
    }

    goBack() {
        this.props.navigate("main");
    }
}
InternalTransferScreen.template = "barcode_scanner.InternalTransferScreen";
