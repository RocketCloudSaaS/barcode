/** @odoo-module **/

import {Reactive} from "@web/core/utils/reactive";
import {registry} from "@web/core/registry";

function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

function lotKey(productId, lotName) {
    return `${productId || 0}::${(lotName || "").trim().toUpperCase()}`;
}

function normalizeQty(value) {
    return parseFloat(value || 0) || 0;
}

function sameLotId(left, right) {
    return (left || false) === (right || false);
}

export class BarcodeScannerState extends Reactive {
    constructor(orm) {
        super();
        this.setup(orm);
    }

    setup(orm) {
        this.orm = orm;
        this.reset();
    }

    reset() {
        this.loading = false;
        this.ready = false;
        this.activePickingId = null;
        this.lastLoadedAt = null;
        this.lastError = null;
        this.picking = null;
        this.pickingTypeCode = null;
        this.moves = [];
        this.moveLines = [];
        this.productsById = {};
        this.lotsById = {};
        this.useExistingLots = true;
        this.useCreateLots = true;
        this.indexes = {
            movesById: {},
            moveIdsByProductId: {},
            moveLineIdsByMoveId: {},
            moveLineIdsByLotId: {},
            barcodeToProductIds: {},
            trackingByProductId: {},
            lotIdsByCompositeKey: {},
            expiredLotIds: [],
        };
        this.sync = {
            status: "idle",
            dirty: false,
            queue: [],
            lastError: null,
            lastSyncedAt: null,
        };
        this._tempIds = {
            lot: -1,
            moveLine: -1,
        };
    }

    clear() {
        this.reset();
    }

    async preloadPicking(pickingId) {
        this.loading = true;
        this.lastError = null;
        try {
            const [picking] = await this.orm.searchRead(
                "stock.picking",
                [["id", "=", pickingId]],
                [
                    "name",
                    "partner_id",
                    "scheduled_date",
                    "location_id",
                    "location_dest_id",
                    "state",
                    "picking_type_id",
                    "user_id",
                    "note",
                ]
            );
            const [type] = await this.orm.read(
                "stock.picking.type",
                [picking.picking_type_id[0]],
                ["code", "use_existing_lots", "use_create_lots"]
            );
            const moves = await this.orm.searchRead(
                "stock.move",
                [
                    ["picking_id", "=", pickingId],
                    ["product_uom_qty", ">", 0],
                ],
                [
                    "product_id",
                    "product_uom_qty",
                    "qty_done_total",
                    "qty_remaining",
                    "quantity",
                    "location_id",
                    "location_dest_id",
                    "lot_ids",
                ]
            );
            const moveLines = await this.orm.searchRead(
                "stock.move.line",
                [["picking_id", "=", pickingId]],
                [
                    "move_id",
                    "product_id",
                    "lot_id",
                    "lot_name",
                    "qty_picked",
                    "quantity",
                ]
            );

            const productIds = [
                ...new Set(
                    [...moves, ...moveLines]
                        .map((record) => record.product_id?.[0])
                        .filter(Boolean)
                ),
            ];
            const lotIds = [
                ...new Set([
                    ...moves.flatMap((move) => move.lot_ids || []),
                    ...moveLines.map((line) => line.lot_id?.[0]).filter(Boolean),
                ]),
            ];

            const products = productIds.length
                ? await this.orm.read("product.product", productIds, [
                      "barcode",
                      "display_name",
                      "tracking",
                      "uom_id",
                  ])
                : [];

            const trackedProductIds = productIds.filter(
                (pid) => products.find((p) => p.id === pid)?.tracking !== "none"
            );
            const incomingNeedsAllLots =
                type.code === "incoming" &&
                type.use_existing_lots &&
                trackedProductIds.length > 0;

            this.useExistingLots = type.use_existing_lots;
            this.useCreateLots = type.use_create_lots;

            const expiryModule = await this.orm.searchRead(
                "ir.module.module",
                [
                    ["name", "=", "product_expiry"],
                    ["state", "=", "installed"],
                ],
                ["id"]
            );
            this.hasProductExpiry = expiryModule.length > 0;

            const lotBaseFields = ["name", "product_id", "product_qty"];
            if (this.hasProductExpiry) {
                lotBaseFields.push("expiration_date", "removal_date");
            }

            const lots = lotIds.length
                ? await this.orm.read("stock.lot", lotIds, lotBaseFields)
                : [];

            if (incomingNeedsAllLots) {
                const allLots = await this.orm.searchRead(
                    "stock.lot",
                    [["product_id", "in", trackedProductIds]],
                    lotBaseFields
                );
                const existingLotIds = new Set(lots.map((l) => l.id));
                for (const lot of allLots) {
                    if (!existingLotIds.has(lot.id)) {
                        lots.push(lot);
                    }
                }
            }

            this.activePickingId = pickingId;
            this.picking = picking;
            this.pickingTypeCode = type.code;
            this.moves = moves;
            this.moveLines = moveLines;
            this.productsById = Object.fromEntries(
                products.map((product) => [product.id, product])
            );
            this.lotsById = Object.fromEntries(lots.map((lot) => [lot.id, lot]));
            this.buildIndexes();
            this.ready = true;
            this.lastLoadedAt = Date.now();
            return this.getSnapshot();
        } catch (error) {
            this.lastError = error.message || String(error);
            throw error;
        } finally {
            this.loading = false;
        }
    }

    buildIndexes() {
        const indexes = {
            movesById: {},
            moveIdsByProductId: {},
            moveLineIdsByMoveId: {},
            moveLineIdsByLotId: {},
            barcodeToProductIds: {},
            trackingByProductId: {},
            lotIdsByCompositeKey: {},
            expiredLotIds: [],
        };
        const today = todayISO();

        for (const product of Object.values(this.productsById)) {
            indexes.trackingByProductId[product.id] = product.tracking || "none";
            if (product.barcode) {
                indexes.barcodeToProductIds[product.barcode] = [
                    ...(indexes.barcodeToProductIds[product.barcode] || []),
                    product.id,
                ];
            }
        }

        for (const move of this.moves) {
            indexes.movesById[move.id] = move;
            const productId = move.product_id?.[0];
            if (productId) {
                indexes.moveIdsByProductId[productId] = [
                    ...(indexes.moveIdsByProductId[productId] || []),
                    move.id,
                ];
            }
        }

        for (const moveLine of this.moveLines) {
            const moveId = moveLine.move_id?.[0];
            const lotId = moveLine.lot_id?.[0];
            if (moveId) {
                indexes.moveLineIdsByMoveId[moveId] = [
                    ...(indexes.moveLineIdsByMoveId[moveId] || []),
                    moveLine.id,
                ];
            }
            if (lotId) {
                indexes.moveLineIdsByLotId[lotId] = [
                    ...(indexes.moveLineIdsByLotId[lotId] || []),
                    moveLine.id,
                ];
            }
        }

        for (const lot of Object.values(this.lotsById)) {
            const productId = lot.product_id?.[0];
            indexes.lotIdsByCompositeKey[lotKey(productId, lot.name)] = lot.id;
            if (lot.expiration_date && lot.expiration_date < today) {
                indexes.expiredLotIds.push(lot.id);
            }
        }

        this.indexes = indexes;
        return indexes;
    }

    getSnapshot() {
        return {
            picking: this.picking,
            pickingTypeCode: this.pickingTypeCode,
            moves: this.moves,
            moveLines: this.moveLines,
            useExistingLots: this.useExistingLots,
            useCreateLots: this.useCreateLots,
        };
    }

    nextTempId(type) {
        const nextId = this._tempIds[type] || -1;
        this._tempIds[type] = nextId - 1;
        return nextId;
    }

    markSyncPending() {
        this.sync.status = "pending";
        this.sync.dirty = this.sync.queue.length > 0;
        this.sync.lastError = null;
    }

    markSyncRunning() {
        this.sync.status = "syncing";
        this.sync.lastError = null;
    }

    markSyncDone() {
        this.sync.status = "idle";
        this.sync.dirty = this.sync.queue.length > 0;
        this.sync.lastError = null;
        this.sync.lastSyncedAt = Date.now();
    }

    markSyncFailed(error) {
        this.sync.status = "error";
        this.sync.dirty = this.sync.queue.length > 0;
        this.sync.lastError = error?.message || String(error);
    }

    enqueueSyncOperation(operation) {
        const queue = [...this.sync.queue];
        if (operation.key) {
            const existingIndex = queue.findIndex((item) => item.key === operation.key);
            if (existingIndex >= 0) {
                const existing = queue[existingIndex];
                queue[existingIndex] = {
                    ...existing,
                    ...operation,
                    values: {
                        ...(existing.values || {}),
                        ...(operation.values || {}),
                    },
                };
            } else {
                queue.push(operation);
            }
        } else {
            queue.push(operation);
        }
        this.sync.queue = queue;
        this.markSyncPending();
        return operation;
    }

    dropSyncOperation(key) {
        this.sync.queue = this.sync.queue.filter((operation) => operation.key !== key);
        this.sync.dirty = this.sync.queue.length > 0;
    }

    getMove(moveId) {
        return this.indexes.movesById[moveId] || null;
    }

    getProduct(productId) {
        return this.productsById[productId] || null;
    }

    getProductByBarcode(barcode) {
        const productIds = this.indexes.barcodeToProductIds[barcode] || [];
        const productId = productIds[0];
        return productId ? this.productsById[productId] || null : null;
    }

    getMoveLinesForMove(moveId) {
        return this.moveLines.filter((line) => line.move_id?.[0] === moveId);
    }

    getRemainingQty(moveId) {
        const move = this.getMove(moveId);
        if (!move) return 0;
        const lines = this.getMoveLinesForMove(moveId);
        const picked = lines.reduce(
            (sum, line) => sum + (parseFloat(line.qty_picked) || 0),
            0
        );
        return Math.max((parseFloat(move.quantity) || 0) - picked, 0);
    }

    getLotsForProduct(productId, {onlyAvailable = false, excludeExpired = false} = {}) {
        return Object.values(this.lotsById).filter((lot) => {
            if (lot.product_id?.[0] !== productId) {
                return false;
            }
            if (onlyAvailable && normalizeQty(lot.product_qty) <= 0) {
                return false;
            }
            if (excludeExpired && this.isLotExpired(lot.id)) {
                return false;
            }
            return true;
        });
    }

    getMoveCandidatesForBarcode(barcode) {
        const productIds = this.indexes.barcodeToProductIds[barcode] || [];
        return productIds.flatMap((productId) =>
            (this.indexes.moveIdsByProductId[productId] || []).map(
                (moveId) => this.indexes.movesById[moveId]
            )
        );
    }

    getLot(productId, lotName) {
        const lotId = this.indexes.lotIdsByCompositeKey[lotKey(productId, lotName)];
        return lotId ? this.lotsById[lotId] : null;
    }

    isLotExpired(lotId) {
        return this.indexes.expiredLotIds.includes(lotId);
    }

    stagePickingUpdate(values) {
        if (!this.picking?.id) {
            return null;
        }
        this.picking = {
            ...this.picking,
            ...values,
        };
        return this.enqueueSyncOperation({
            key: `picking:${this.picking.id}`,
            type: "picking_write",
            pickingId: this.picking.id,
            values,
        });
    }

    updateMoveLineQty(moveLineId, qtyPicked) {
        const moveLine = this.moveLines.find((line) => line.id === moveLineId);
        if (!moveLine) {
            return null;
        }
        moveLine.qty_picked = qtyPicked;
        this.enqueueSyncOperation({
            key: `move_line:${moveLineId}`,
            type: "qty_update",
            moveLineId,
            values: {qty_picked: qtyPicked},
            qtyPicked,
        });
        return moveLine;
    }

    stageLotCreate({productId, name, expirationDate = false}) {
        const existing = this.getLot(productId, name);
        if (existing) {
            return existing;
        }
        const tempId = this.nextTempId("lot");
        const lot = {
            id: tempId,
            name,
            product_id: [productId, this.productsById[productId]?.display_name || ""],
            product_qty: 0,
        };
        if (this.hasProductExpiry && expirationDate) {
            lot.expiration_date = expirationDate;
        }
        this.lotsById = {
            ...this.lotsById,
            [tempId]: lot,
        };
        this.buildIndexes();
        this.enqueueSyncOperation({
            key: `lot:${tempId}`,
            type: "lot_create",
            tempId,
            values: {
                name,
                product_id: productId,
                ...(this.hasProductExpiry && expirationDate
                    ? {expiration_date: expirationDate}
                    : {}),
            },
        });
        return lot;
    }

    replaceTemporaryLot(tempId, lot) {
        if (!this.lotsById[tempId]) {
            return;
        }
        delete this.lotsById[tempId];
        this.lotsById = {
            ...this.lotsById,
            [lot.id]: lot,
        };
        this.moveLines = this.moveLines.map((line) => {
            if (line.lot_id?.[0] === tempId) {
                return {
                    ...line,
                    lot_id: [lot.id, lot.name],
                    lot_name: lot.name,
                };
            }
            return line;
        });
        this.sync.queue = this.sync.queue.map((operation) => {
            if (operation.values?.lot_id === tempId) {
                return {
                    ...operation,
                    values: {
                        ...operation.values,
                        lot_id: lot.id,
                        lot_name: lot.name,
                    },
                };
            }
            return operation;
        });
        this.buildIndexes();
    }

    replaceTemporaryMoveLineId(tempId, moveLineId) {
        const moveLine = this.moveLines.find((line) => line.id === tempId);
        if (!moveLine) {
            return;
        }
        moveLine.id = moveLineId;
        this.buildIndexes();
    }

    stageMoveLine({
        moveId,
        pickingId,
        productId,
        qtyPicked,
        lotId = false,
        lotName = false,
        locationId = false,
        locationDestId = false,
        mode = "increment",
        extraValues = {},
    }) {
        const wantedLotName = (lotName || "").trim().toUpperCase();
        const matchingLines = this.moveLines.filter((line) => {
            if (
                line.move_id?.[0] !== moveId ||
                line.product_id?.[0] !== productId
            ) {
                return false;
            }
            if (sameLotId(line.lot_id?.[0], lotId)) {
                return true;
            }
            // Fall back to the lot NAME so a re-scan lands on the existing line
            // even when the lot resolved to a different record, instead of
            // spawning a duplicate line for the same lot.
            const lineLotName = (line.lot_name || line.lot_id?.[1] || "")
                .trim()
                .toUpperCase();
            return Boolean(wantedLotName) && lineLotName === wantedLotName;
        });
        let targetLine = matchingLines.find(
            (line) => normalizeQty(line.qty_picked) === 0
        );
        if (!targetLine && matchingLines.length) {
            [targetLine] = matchingLines;
        }
        // No line carries this lot yet: take over a reserved line that has no
        // lot assigned (same move and product, nothing picked on it) instead of
        // spawning a new line beside the untouched reservation. The scan then
        // fills the reservation — "534343: 2.5 / 10" — rather than leaving a
        // lotless reserved line dangling next to a fresh lot line.
        if (!targetLine && (lotId || wantedLotName)) {
            targetLine = this.moveLines.find(
                (line) =>
                    line.move_id?.[0] === moveId &&
                    line.product_id?.[0] === productId &&
                    !line.lot_id?.[0] &&
                    !(line.lot_name || "").trim() &&
                    normalizeQty(line.qty_picked) === 0
            );
        }

        const nextQty = targetLine
            ? mode === "set"
                ? normalizeQty(qtyPicked)
                : normalizeQty(targetLine.qty_picked) + normalizeQty(qtyPicked)
            : normalizeQty(qtyPicked);
        const values = {
            qty_picked: nextQty,
            picked: true,
            lot_id: lotId || false,
            lot_name: lotName || false,
            location_id: locationId || false,
            location_dest_id: locationDestId || false,
            ...extraValues,
        };

        if (targetLine) {
            Object.assign(targetLine, values);
            this.enqueueSyncOperation({
                key: `move_line:${targetLine.id}`,
                type: targetLine.id > 0 ? "move_line_write" : "move_line_create",
                moveLineId: targetLine.id > 0 ? targetLine.id : undefined,
                tempId: targetLine.id < 0 ? targetLine.id : undefined,
                values:
                    targetLine.id > 0
                        ? values
                        : {
                              move_id: moveId,
                              picking_id: pickingId,
                              product_id: productId,
                              ...values,
                          },
            });
            return targetLine;
        }

        const tempId = this.nextTempId("moveLine");
        const move = this.getMove(moveId);
        const product = this.getProduct(productId);
        const lot = lotId ? this.lotsById[lotId] : null;
        const moveLine = {
            id: tempId,
            move_id: [moveId, move?.product_id?.[1] || product?.display_name || ""],
            product_id: [
                productId,
                product?.display_name || move?.product_id?.[1] || "",
            ],
            lot_id: lotId ? [lotId, lot?.name || lotName || ""] : false,
            lot_name: lot?.name || lotName || false,
            quantity: normalizeQty(qtyPicked),
            ...values,
        };
        this.moveLines = [...this.moveLines, moveLine];
        this.buildIndexes();
        this.enqueueSyncOperation({
            key: `move_line:${tempId}`,
            type: "move_line_create",
            tempId,
            values: {
                move_id: moveId,
                picking_id: pickingId,
                product_id: productId,
                ...values,
            },
        });
        return moveLine;
    }

    stageMoveLineReset(moveLineId) {
        const moveLine = this.moveLines.find((line) => line.id === moveLineId);
        if (!moveLine) {
            return null;
        }
        if (moveLine.id < 0) {
            this.moveLines = this.moveLines.filter((line) => line.id !== moveLineId);
            this.dropSyncOperation(`move_line:${moveLineId}`);
            this.buildIndexes();
            return null;
        }
        moveLine.qty_picked = 0;
        this.enqueueSyncOperation({
            key: `move_line:${moveLine.id}`,
            type: "move_line_write",
            moveLineId: moveLine.id,
            values: {qty_picked: 0},
        });
        return moveLine;
    }

    /**
     * The quantity a scan means for a product: one unit, unless the barcode
     * states a quantity of its own.
     *
     * `productUomId` is the unit that quantity would be expressed in. This base
     * reading ignores it — a scanned number is taken as it comes — and it is the
     * seam a module that reads richer barcodes overrides: a GS1 label can state
     * both a piece count and a net weight, and which of the two is the quantity
     * depends on how the product is stocked.
     */
    // eslint-disable-next-line no-unused-vars
    scannedQuantity(scan, productUomId) {
        return parseFloat(scan?.qty ?? scan?.quantity ?? 0) || 1;
    }

    /**
     * Normalize a scan (raw barcode plus whatever a parser decoded from it) into
     * the data the screens act on: the product code to match, the quantity to
     * handle — one unit unless the barcode states otherwise — and the lot or
     * serial it carries, resolved to a known lot when there is one.
     */
    applyScanResult(scan) {
        const barcode = scan.product || scan.value || scan.barcode;
        const candidates = barcode ? this.getMoveCandidatesForBarcode(barcode) : [];
        const productId = candidates[0]?.product_id?.[0] || null;
        const lotName = scan.lot || scan.serial || null;
        const productUomId = this.productsById[productId]?.uom_id?.[0] || null;
        return {
            barcode: scan.barcode,
            product: barcode,
            quantity: this.scannedQuantity(scan, productUomId),
            lotName,
            lot: lotName ? this.getLot(productId, lotName) : null,
            serial: scan.serial || null,
            expiration: scan.expiration || scan.expiry || null,
            candidates,
        };
    }
}

export const barcodeScannerStateService = {
    dependencies: ["orm"],
    start(env, {orm}) {
        return new BarcodeScannerState(orm);
    },
};

registry.category("services").add("barcodeScannerState", barcodeScannerStateService);
