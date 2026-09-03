/** @odoo-module **/

import {BarcodeScannerState} from "@barcode_stock/js/services/barcode_scanner_state";
import {patch} from "@web/core/utils/patch";

patch(BarcodeScannerState.prototype, {
    async preloadPicking() {
        // Call original to load base data, then ensure is_manually is available
        // The original loads moves without is_manually; we patch the move fetch to include it
        // Instead of duplicating the whole method, we call super and then fetch is_manually if missing
        const result = await super.preloadPicking(...arguments);
        // If moves were loaded without is_manually, fetch it
        if (this.moves.length && this.moves[0].is_manually === undefined) {
            try {
                const moveIds = this.moves.map((m) => m.id);
                const extra = await this.orm.searchRead(
                    "stock.move",
                    [["id", "in", moveIds]],
                    ["is_manually"]
                );
                const map = Object.fromEntries(extra.map((m) => [m.id, m.is_manually]));
                for (const move of this.moves) {
                    move.is_manually = map[move.id] || false;
                }
            } catch {
                // Ignore - fallback to main barcodes
            }
        }
        const pickingTypeId = this.picking?.picking_type_id?.[0];
        if (pickingTypeId) {
            const [pickingType] = await this.orm.read(
                "stock.picking.type",
                [pickingTypeId],
                ["allow_insert_new_line"]
            );
            this.pickingTypeAllowInsertNewLine =
                pickingType?.allow_insert_new_line || false;
        } else {
            this.pickingTypeAllowInsertNewLine = false;
        }
        return result;
    },

    getSnapshot() {
        return {
            ...super.getSnapshot(...arguments),
            pickingTypeAllowInsertNewLine: this.pickingTypeAllowInsertNewLine || false,
        };
    },
});
