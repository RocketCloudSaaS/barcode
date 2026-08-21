# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import fields, models


class StockPicking(models.Model):
    _inherit = "stock.picking"

    purchase_origin = fields.Char(
        related="purchase_id.origin",
        readonly=True,
        store=False,
        string="Purchase Origin",
    )
