# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

import base64
import binascii

from odoo import _, api, models
from odoo.exceptions import UserError


class QcInspection(models.Model):
    _inherit = "qc.inspection"

    def _barcode_scanner_read_lines(self):
        """Serialise an inspection's questions for the scanner UI."""
        self.ensure_one()
        lines = []
        for line in self.inspection_lines:
            lines.append(
                {
                    "id": line.id,
                    "name": line.name,
                    "question_type": line.question_type,
                    "notes": line.notes or "",
                    "min_value": line.min_value,
                    "max_value": line.max_value,
                    "uom_name": line.test_uom_id.display_name or "",
                    "possible_values": [
                        {"id": value.id, "name": value.name, "ok": value.ok}
                        for value in line.possible_ql_values
                    ],
                }
            )
        return lines

    def _barcode_scanner_read(self):
        self.ensure_one()
        return {
            "inspection_id": self.id,
            "inspection_name": self.name,
            "product_name": self.product_id.display_name or "",
            "lot_name": self.lot_id.name or "",
            "test_name": self.test.display_name or "",
            "state": self.state,
            "success": self.success,
            "photo_count": self.env["ir.attachment"].search_count(
                [("res_model", "=", self._name), ("res_id", "=", self.id)]
            ),
            "lines": self._barcode_scanner_read_lines(),
        }

    @api.model
    def action_barcode_scanner_submit(self, inspection_id, answers):
        """Record the operator's answers and confirm the inspection.

        ``answers`` is a list of ``{line_id, qualitative_value_id}`` for
        qualitative questions and ``{line_id, quantitative_value}`` for
        quantitative ones. Returns the resulting inspection state.
        """
        inspection = self.browse(inspection_id).exists()
        if not inspection:
            raise UserError(_("The inspection no longer exists."))
        if inspection.state not in ("ready", "waiting"):
            raise UserError(
                _("This inspection cannot be edited in its current state.")
            )

        answers_by_line = {answer["line_id"]: answer for answer in answers}
        for line in inspection.inspection_lines:
            answer = answers_by_line.get(line.id)
            if answer is None:
                continue
            if line.question_type == "qualitative":
                line.qualitative_value = answer.get("qualitative_value_id") or False
            else:
                line.uom_id = line.test_uom_id.id
                line.quantitative_value = answer.get("quantitative_value") or 0.0

        inspection.action_confirm()
        return inspection._barcode_scanner_read()

    @api.model
    def action_barcode_scanner_attach_photo(self, inspection_id, filename, datas):
        """Attach a photo as evidence to an inspection.

        ``datas`` is the base64-encoded image content coming from the scanner.
        The attachment is linked to the inspection so it shows in its chatter.
        """
        inspection = self.browse(inspection_id).exists()
        if not inspection:
            raise UserError(_("The inspection no longer exists."))
        try:
            base64.b64decode(datas or "", validate=True)
        except (binascii.Error, ValueError) as err:
            raise UserError(_("The photo could not be read.")) from err
        try:
            self.env["ir.attachment"].create(
                {
                    "name": filename or _("Quality evidence"),
                    "datas": datas,
                    "res_model": inspection._name,
                    "res_id": inspection.id,
                }
            )
        except OSError as err:
            # A truncated or corrupt image trips Odoo's image post-processing.
            raise UserError(_("The photo could not be saved.")) from err
        return {
            "inspection_id": inspection.id,
            "photo_count": self.env["ir.attachment"].search_count(
                [("res_model", "=", inspection._name), ("res_id", "=", inspection.id)]
            ),
        }
