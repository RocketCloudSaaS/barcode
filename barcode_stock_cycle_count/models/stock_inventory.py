# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

import math

from odoo import _, api, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare


class StockInventory(models.Model):
    _inherit = "stock.inventory"

    def _barcode_validate_inventory(self, inventory_id):
        inventory = self.browse(inventory_id).exists()
        if not inventory or (
            inventory.company_id and inventory.company_id != self.env.company
        ):
            raise UserError(_("The selected inventory adjustment is unavailable."))
        cycle = inventory.cycle_count_id.exists()
        if (
            not cycle
            or (cycle.company_id and cycle.company_id != self.env.company)
            or cycle.stock_adjustment_ids != inventory
            or inventory.state != "in_progress"
            or len(inventory.location_ids) != 1
            or inventory.location_ids != cycle.location_id
            or (
                inventory.location_ids.company_id
                and inventory.location_ids.company_id != self.env.company
            )
        ):
            raise UserError(_("The inventory adjustment is no longer valid."))
        quants = inventory.stock_quant_ids.exists()
        if len(quants.filtered(lambda quant: quant.current_inventory_id != inventory)):
            raise UserError(_("The inventory adjustment contains stale lines."))
        return inventory, cycle, quants

    @api.model
    def barcode_get_cycle_count_lines(self, inventory_id):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        lines = []
        for quant in quants:
            product = quant.product_id.exists()
            lot = quant.lot_id.exists()
            if (
                not product
                or (product.company_id and product.company_id != self.env.company)
                or (lot and lot.company_id and lot.company_id != self.env.company)
                or quant.location_id != inventory.location_ids
                or (quant.company_id and quant.company_id != self.env.company)
            ):
                raise UserError(_("The inventory adjustment contains invalid lines."))
            lines.append(
                {
                    "quant_id": quant.id,
                    "product_id": product.id,
                    "product_name": product.display_name,
                    "tracking": product.tracking,
                    "lot_id": lot.id or False,
                    "lot_name": lot.name or False,
                    "theoretical_qty": quant.quantity,
                    "counted_qty": quant.inventory_quantity,
                    "difference": quant.inventory_quantity - quant.quantity,
                    "uom": product.uom_id.name,
                    "rounding": product.uom_id.rounding,
                }
            )
        return {
            "inventory": {
                "id": inventory.id,
                "state": inventory.state,
                "cycle_count_id": cycle.id,
                "location_id": cycle.location_id.id,
                "location_name": cycle.location_id.display_name,
                "cycle_count_name": cycle.name,
            },
            "lines": lines,
        }

    def _barcode_validate_line(
        self, inventory, quant, counted_qty, lot_id=False, lot_name=False
    ):
        if (
            quant.current_inventory_id != inventory
            or quant not in inventory.stock_quant_ids
        ):
            raise UserError(_("The counted line is no longer part of this adjustment."))
        product = quant.product_id.exists()
        lot = quant.lot_id.exists()
        if (
            not product
            or (quant.company_id and quant.company_id != self.env.company)
            or quant.location_id != inventory.location_ids
            or (product.company_id and product.company_id != self.env.company)
            or (lot and lot.company_id and lot.company_id != self.env.company)
        ):
            raise UserError(_("The counted line is no longer valid."))
        try:
            counted_qty = float(counted_qty)
        except (TypeError, ValueError):
            raise UserError(_("The counted quantity is invalid.")) from None
        if not math.isfinite(counted_qty):
            raise UserError(_("The counted quantity must be finite."))
        if (
            float_compare(counted_qty, 0, precision_rounding=product.uom_id.rounding)
            < 0
        ):
            raise UserError(_("The counted quantity cannot be negative."))
        if product.tracking != "none" and not lot:
            raise UserError(_("A tracked product must retain its lot or serial."))
        if product.tracking == "none":
            if lot_id or lot_name:
                raise UserError(_("An untracked line cannot contain lot identity."))
        elif lot_id != lot.id or lot_name != lot.name:
            raise UserError(_("The counted line lot or serial does not match."))
        if product.tracking == "serial" and counted_qty not in (0, 1):
            raise UserError(_("A serial-numbered product can only be counted once."))
        return counted_qty

    def _barcode_validate_completion(self, inventory, quants, lines):
        if not isinstance(lines, list):
            raise UserError(_("Counted lines must be a list."))
        linked_ids = set(quants.ids)
        submitted_ids = set()
        validated = []
        for line in lines:
            if not isinstance(line, dict) or set(line) != {
                "quant_id",
                "counted_qty",
                "lot_id",
                "lot_name",
            }:
                raise UserError(
                    _(
                        "Each counted line must contain quant, quantity, and "
                        "authoritative identity."
                    )
                )
            quant_id = line["quant_id"]
            if quant_id in submitted_ids:
                raise UserError(_("A counted line was submitted more than once."))
            submitted_ids.add(quant_id)
            if quant_id not in linked_ids:
                raise UserError(_("One of the counted lines is not linked."))
            quant = self.env["stock.quant"].browse(quant_id).exists()
            counted_qty = self._barcode_validate_line(
                inventory,
                quant,
                line["counted_qty"],
                line["lot_id"],
                line["lot_name"],
            )
            validated.append((quant, counted_qty))
        if submitted_ids != linked_ids:
            raise UserError(_("Every linked line must be explicitly counted."))
        return validated

    @api.model
    def barcode_apply_cycle_count(self, inventory_id, lines, confirm_zero=False):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        validated = self._barcode_validate_completion(inventory, quants, lines)
        applied = []
        for quant, counted_qty in validated:
            if float_compare(
                counted_qty,
                quant.quantity,
                precision_rounding=quant.product_id.uom_id.rounding,
            ):
                quant.with_context(inventory_mode=True).write(
                    {"inventory_quantity": counted_qty}
                )
                result = quant.action_apply_inventory()
                if result:
                    raise UserError(
                        _(
                            "The inventory adjustment could not be applied "
                            "automatically. Resolve the conflict in the inventory "
                            "adjustment and try again."
                        )
                    )
                applied.append(quant.id)
        if not applied and not confirm_zero:
            raise UserError(_("Confirm the zero-difference count before closing."))
        inventory.action_state_to_done()
        return {
            "inventory_id": inventory.id,
            "cycle_count_id": cycle.id,
            "state": "done",
            "accuracy": inventory.inventory_accuracy,
            "applied_quant_ids": applied,
            "applied_count": len(applied),
        }

    @api.model
    def barcode_close_cycle_count(self, inventory_id, lines, confirm_zero=False):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        validated = self._barcode_validate_completion(inventory, quants, lines)
        for quant, counted_qty in validated:
            if float_compare(
                counted_qty,
                quant.quantity,
                precision_rounding=quant.product_id.uom_id.rounding,
            ):
                raise UserError(_("Resolve all differences before closing."))
        if not confirm_zero:
            raise UserError(_("Confirm the zero-difference count before closing."))
        inventory.action_state_to_done()
        return {
            "inventory_id": inventory.id,
            "cycle_count_id": cycle.id,
            "state": "done",
            "accuracy": inventory.inventory_accuracy,
            "applied_quant_ids": [],
            "applied_count": 0,
        }
