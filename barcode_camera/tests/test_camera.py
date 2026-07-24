# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestBarcodeCamera(TransactionCase):
    def test_base_dependency_installed(self):
        base = self.env["ir.module.module"].search(
            [("name", "=", "barcode_scanner")], limit=1
        )
        self.assertTrue(base, "barcode_scanner base module must exist")
        self.assertEqual(base.state, "installed")
