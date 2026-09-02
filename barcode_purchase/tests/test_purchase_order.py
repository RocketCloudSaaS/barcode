# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestBarcodePurchase(TransactionCase):
    """barcode_purchase ships no Python model: the scanner writes only native
    purchase.order fields. These assert the module installed and that the native
    fields it relies on are present."""

    def test_security_group_present(self):
        group = self.env.ref(
            "barcode_purchase.group_barcode_purchase_user",
            raise_if_not_found=False,
        )
        self.assertTrue(group, "the Barcode Purchase User group must exist")

    def test_native_fields_present(self):
        """The scanner sets user_id (buyer) and partner_ref (vendor reference);
        both are native purchase.order fields, so no custom model is needed."""
        fields = self.env["purchase.order"]._fields
        self.assertIn("user_id", fields)
        self.assertIn("partner_ref", fields)
