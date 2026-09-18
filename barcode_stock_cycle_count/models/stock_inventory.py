# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

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

    def _barcode_validate_line(self, inventory, quant, counted_qty):
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
        if (
            float_compare(counted_qty, 0, precision_rounding=product.uom_id.rounding)
            < 0
        ):
            raise UserError(_("The counted quantity cannot be negative."))
        if product.tracking != "none" and not lot:
            raise UserError(_("A tracked product must retain its lot or serial."))
        if product.tracking == "serial" and counted_qty not in (0, 1):
            raise UserError(_("A serial-numbered product can only be counted once."))
        return counted_qty

    @api.model
    def barcode_apply_cycle_count(self, inventory_id, lines, confirm_zero=False):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        if not isinstance(lines, list):
            raise UserError(_("Counted lines must be a list."))
        applied = []
        for line in lines:
            if not isinstance(line, dict) or set(line) != {
                "quant_id",
                "counted_qty",
            }:
                raise UserError(
                    _("Each counted line must contain only a quant and quantity.")
                )
            quant = self.env["stock.quant"].browse(line["quant_id"]).exists()
            if not quant:
                raise UserError(_("One of the counted lines no longer exists."))
            counted_qty = self._barcode_validate_line(
                inventory, quant, line["counted_qty"]
            )
            if float_compare(
                counted_qty,
                quant.quantity,
                precision_rounding=quant.product_id.uom_id.rounding,
            ):
                quant.with_context(inventory_mode=True).write(
                    {"inventory_quantity": counted_qty}
                )
                type(quant).action_apply_inventory(quant)
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
    def barcode_close_cycle_count(self, inventory_id, confirm_zero=False):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        for quant in quants:
            if float_compare(
                quant.inventory_quantity,
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
