# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, models
from odoo.exceptions import UserError


class StockPicking(models.Model):
    _inherit = "stock.picking"

    @api.model
    def action_barcode_scanner_quality_inspections(self, picking_id):
        """Return the quality inspections generated for a reception, so the
        scanner can run them from a Quality tab during the reception.

        Only executable/finished inspections are returned (a ``plan`` inspection
        is not runnable until the picking is done); each carries its questions
        and current pass/fail state.
        """
        picking = self.browse(picking_id).exists()
        if not picking:
            raise UserError(_("The picking is no longer valid."))
        inspections = picking.qc_inspections_ids.filtered(
            lambda i: i.state != "canceled"
        )
        return {
            "picking_id": picking.id,
            "inspections": [
                inspection._barcode_scanner_read() for inspection in inspections
            ],
        }
