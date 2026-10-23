# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import fields, models


class StockPickingType(models.Model):
    _inherit = "stock.picking.type"

    allow_insert_new_line = fields.Boolean(
        string="Allow Adding New Product Lines from the Scanner",
        default=False,
        help="Allow the Barcode scanner to add a new/unlisted product line to "
        "this internal transfer. Incoming and outgoing operation types never "
        "allow new lines.",
    )
