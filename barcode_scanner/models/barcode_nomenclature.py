from odoo import api, models


class BarcodeNomenclature(models.Model):
    _inherit = "barcode.nomenclature"
    _description = "Barcode Nomenclature"

    @api.model
    def parse_barcode_scanner_barcode(self, barcode):
        nomenclature = self.env.ref("barcodes.default_barcode_nomenclature")
        parsed = nomenclature.parse_barcode(barcode)
        return {
            "type": "ean",
            "product": parsed.get("code"),
            "qty": parsed.get("value", 1),
        }
