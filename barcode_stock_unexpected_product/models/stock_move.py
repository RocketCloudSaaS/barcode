# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import fields, models


class StockMove(models.Model):
    _inherit = "stock.move"

    is_manually = fields.Boolean(
        string="Manually Added",
        help="Technical flag for moves added via scanner.",
    )
