# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import fields, models


class StockQuant(models.Model):
    _inherit = "stock.quant"

    barcode_cycle_count_counted = fields.Boolean(
        string="Barcode Cycle Count Entered",
        default=False,
    )
