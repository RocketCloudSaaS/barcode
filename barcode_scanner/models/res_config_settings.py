from odoo import fields, models


class ResConfigSettings(models.TransientModel):
    _inherit = "res.config.settings"
    _description = "Config Settings"

    barcode_hex_input = fields.Boolean(
        related="company_id.barcode_hex_input",
        readonly=False,
        string="Barcode Hex Input Mode",
    )
