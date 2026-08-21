# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, fields, models
from odoo.exceptions import ValidationError


class StockMoveLine(models.Model):
    _inherit = "stock.move.line"

    is_manually = fields.Boolean(
        related="move_id.is_manually", store=False, readonly=True
    )

    @api.model_create_multi
    def create(self, vals_list):
        lines = super().create(vals_list)
        for line in lines:
            move = line.move_id
            if move.is_manually:
                total = sum(move.move_line_ids.mapped("quantity")) or sum(
                    move.move_line_ids.mapped("qty_picked")
                )
                if total and move.product_uom_qty != total:
                    move.product_uom_qty = total
        return lines

    def write(self, vals):
        res = super().write(vals)
        if "quantity" in vals or "qty_picked" in vals:
            for line in self:
                move = line.move_id
                if move.is_manually:
                    total = sum(move.move_line_ids.mapped("quantity")) or sum(
                        move.move_line_ids.mapped("qty_picked")
                    )
                    if total and move.product_uom_qty != total:
                        move.product_uom_qty = total
        return res

    @api.constrains("quantity", "product_id", "lot_id")
    def _check_serial_quantity(self):
        for line in self:
            if line.product_id.tracking == "serial" and line.quantity > 1:
                raise ValidationError(
                    _(
                        "The quantity for product %(product)s (tracked by serial) "
                        "cannot exceed 1.",
                        product=line.product_id.display_name,
                    )
                )
