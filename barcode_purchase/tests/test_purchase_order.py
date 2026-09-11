# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase, tagged


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


@tagged("post_install", "-at_install")
class TestBarcodePurchaseReceipt(TransactionCase):
    """The receipt fields the scanner writes on come from `purchase_stock`, which
    is loaded after this module -- so these run post-install."""

    def test_each_order_line_keeps_its_own_move(self):
        """The scanner writes every scanned lot on a move line of its own order
        line's move, so two lots of the same product must not share a move.
        `purchase_stock` keeps `purchase_line_id` out of the move merge -- assert
        it, because the whole lot mapping rests on it."""
        stock_move = self.env["stock.move"]
        if "purchase_line_id" not in stock_move._fields:
            self.skipTest("purchase_stock is not installed")
        product = self.env["product.product"].create(
            {
                "name": "Barcode lot-tracked product",
                "is_storable": True,
                "tracking": "lot",
            }
        )
        order = self.env["purchase.order"].create(
            {
                "partner_id": self.env["res.partner"].create({"name": "Vendor"}).id,
                "order_line": [
                    (0, 0, {"product_id": product.id, "product_qty": 1}),
                    (0, 0, {"product_id": product.id, "product_qty": 1}),
                ],
            }
        )
        order.button_confirm()

        moves = order.picking_ids.move_ids
        self.assertEqual(len(order.order_line), 2)
        self.assertEqual(len(moves), 2, "each order line must keep its own move")
        self.assertEqual(moves.purchase_line_id, order.order_line)
        for move in moves:
            self.assertTrue(
                move.move_line_ids, "each move needs a move line to hold the lot"
            )
        self.assertFalse(
            moves[0].move_line_ids & moves[1].move_line_ids,
            "two order lines must not share a move line",
        )
