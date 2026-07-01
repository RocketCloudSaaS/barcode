from odoo import fields, models


class ResCompany(models.Model):
    _inherit = "res.company"
    _description = "Company"

    barcode_hex_input = fields.Boolean(
        string="Barcode Hex Input Mode",
        default=False,
        help=(
            "Enable this if your barcode scanner outputs the full barcode as a "
            "hexadecimal string. "
            "The barcode will be decoded from hex before parsing."
        ),
    )
