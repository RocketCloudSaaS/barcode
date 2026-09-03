# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestManualLineRegression(TransactionCase):
    def test_standard_scanner_method_remains_picked(self):
        self.assertTrue(
            hasattr(self.env["stock.picking"], "barcode_scanner_add_line_to_picking")
        )
        self.assertTrue(
            hasattr(
                self.env["stock.picking"],
                "barcode_scanner_add_manual_line_to_picking",
            )
        )
