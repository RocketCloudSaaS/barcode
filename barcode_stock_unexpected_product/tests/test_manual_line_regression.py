# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestManualLineRegression(TransactionCase):
    def test_manual_line_rpc_remains_available(self):
        self.assertTrue(
            hasattr(
                self.env["stock.picking"],
                "barcode_scanner_add_manual_line_to_picking",
            )
        )
