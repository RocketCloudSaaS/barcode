# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.exceptions import AccessError, UserError
from odoo.tests.common import TransactionCase, new_test_user


class TestBarcodePurchase(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.PO = cls.env["purchase.order"]
        cls.vendor = cls.env["res.partner"].create({"name": "Barcode Vendor"})
        Product = cls.env["product.product"]
        cls.product = Product.create(
            {"name": "PO Untracked", "is_storable": True, "standard_price": 3}
        )
        cls.lot_product = Product.create(
            {"name": "PO Lot", "is_storable": True, "tracking": "lot"}
        )
        cls.serial_product = Product.create(
            {"name": "PO Serial", "is_storable": True, "tracking": "serial"}
        )
        warehouse = cls.env["stock.warehouse"].search(
            [("company_id", "=", cls.env.company.id)], limit=1
        )
        cls.shelf = cls.env["stock.location"].create(
            {
                "name": "Barcode PO Shelf",
                "usage": "internal",
                "location_id": warehouse.lot_stock_id.id,
            }
        )
        cls.buyer = new_test_user(
            cls.env, login="barcode_po_buyer", groups="purchase.group_purchase_user"
        )

    def _order(self, result):
        return self.PO.browse(result["id"])

    def test_draft_order(self):
        result = self.PO.action_barcode_purchase(
            self.vendor.id,
            [{"product_id": self.product.id, "qty": 2, "price_unit": 5}],
            user_id=self.buyer.id,
            partner_ref="VENDOR-REF",
        )
        order = self._order(result)
        self.assertEqual(result["state"], "draft")
        self.assertEqual(result["name"], order.name)
        self.assertEqual(order.partner_id, self.vendor)
        self.assertEqual(order.partner_ref, "VENDOR-REF")
        self.assertEqual(order.user_id, self.buyer)
        self.assertEqual(order.order_line.product_qty, 2)
        self.assertEqual(order.order_line.price_unit, 5)
        self.assertFalse(order.picking_ids)

    def test_vendor_price_without_a_price(self):
        self.env["product.supplierinfo"].create(
            {
                "partner_id": self.vendor.id,
                "product_tmpl_id": self.product.product_tmpl_id.id,
                "price": 7,
            }
        )
        by_dozen = self.env["product.product"].create(
            {
                "name": "PO By Dozen",
                "is_storable": True,
                "standard_price": 3,
                "uom_po_id": self.env.ref("uom.product_uom_dozen").id,
            }
        )
        lines = [
            {"product_id": self.product.id, "qty": 1, "price_unit": None},
            {"product_id": by_dozen.id, "qty": 1},
            # A price typed as 0 (a free sample) is kept, not replaced.
            {"product_id": self.product.id, "qty": 1, "price_unit": 0},
        ]
        order = self._order(self.PO.action_barcode_purchase(self.vendor.id, lines))
        # The vendor's price, and a dozen at 12 times the unit cost, in dozens.
        self.assertEqual(order.order_line.mapped("price_unit"), [7, 36, 0])
        self.assertEqual(
            order.order_line[1].product_uom, self.env.ref("uom.product_uom_dozen")
        )
        # The scanner is shown the very prices the order takes.
        self.assertEqual(
            self.PO.barcode_purchase_prices(
                self.vendor.id,
                [
                    {"product_id": self.product.id, "qty": 1},
                    {"product_id": by_dozen.id, "qty": 1},
                    {"product_id": 0, "qty": 1},
                ],
            ),
            [7, 36, None],
        )
        self.assertEqual(
            self.PO.barcode_purchase_prices(0, [{"product_id": self.product.id}]),
            [None],
        )

    def test_confirmed_order_receives_where_and_with_the_lots_scanned(self):
        result = self.PO.action_barcode_purchase(
            self.vendor.id,
            [
                {"product_id": self.lot_product.id, "qty": 1, "lot_name": "LOT-A"},
                {"product_id": self.lot_product.id, "qty": 2, "lot_name": "LOT-B"},
                {"product_id": self.serial_product.id, "qty": 1, "lot_name": "SN-1"},
                {"product_id": self.product.id, "qty": 1},
            ],
            confirm=True,
            location_dest_id=self.shelf.id,
        )
        order = self._order(result)
        self.assertEqual(result["state"], "purchase")
        self.assertEqual(result["missing_lots"], [])
        self.assertEqual(result["unplaced_lots"], [])
        receipt = order.picking_ids
        self.assertEqual(receipt.location_dest_id, self.shelf)
        self.assertEqual(receipt.move_ids.location_dest_id, self.shelf)
        # Every lot sits on the move of its own order line.
        for order_line, lot_name in zip(
            order.order_line, ["LOT-A", "LOT-B", "SN-1", False], strict=True
        ):
            self.assertEqual(
                order_line.move_ids.move_line_ids.mapped("lot_name")[:1],
                [lot_name] if lot_name else [False],
            )

    def test_a_tracked_product_without_its_lot_does_not_hold_the_order(self):
        result = self.PO.action_barcode_purchase(
            self.vendor.id,
            [{"product_id": self.lot_product.id, "qty": 1}],
            confirm=True,
        )
        self.assertEqual(result["state"], "purchase")
        self.assertEqual(result["missing_lots"], [self.lot_product.display_name])

    def test_a_lot_with_no_free_line_is_reported(self):
        result = self.PO.action_barcode_purchase(
            self.vendor.id,
            [{"product_id": self.lot_product.id, "qty": 1, "lot_name": "LOT-A"}],
            confirm=True,
        )
        order = self._order(result)
        self.assertEqual(
            order._barcode_purchase_place_lots(["LOT-X"]),
            [f"{self.lot_product.display_name} (LOT-X)"],
        )

    def test_lots_without_a_receipt_are_reported(self):
        lines = [{"product_id": self.lot_product.id, "qty": 1, "lot_name": "LOT-A"}]
        # A draft raises no receipt: the lots read have nowhere to go yet.
        draft = self.PO.action_barcode_purchase(self.vendor.id, lines)
        self.assertEqual(
            draft["pending_lots"], [f"{self.lot_product.display_name} (LOT-A)"]
        )
        self.assertEqual(draft["unplaced_lots"], [])
        self.assertEqual(draft["missing_lots"], [])
        # Nor does an order waiting for approval.
        self.env.company.write(
            {"po_double_validation": "two_step", "po_double_validation_amount": 0}
        )
        waiting = self.PO.with_user(self.buyer).action_barcode_purchase(
            self.vendor.id, [dict(lines[0], price_unit=10)], confirm=True
        )
        self.assertEqual(waiting["state"], "to approve")
        self.assertEqual(waiting["pending_lots"], draft["pending_lots"])
        self.assertEqual(waiting["unplaced_lots"], [])

    def test_two_step_approval(self):
        self.env.company.write(
            {"po_double_validation": "two_step", "po_double_validation_amount": 0}
        )
        result = self.PO.with_user(self.buyer).action_barcode_purchase(
            self.vendor.id,
            [{"product_id": self.product.id, "qty": 1, "price_unit": 10}],
            confirm=True,
        )
        self.assertEqual(result["state"], "to approve")
        self.assertFalse(self._order(result).picking_ids)

    def test_validation(self):
        not_purchasable = self.env["product.product"].create(
            {"name": "PO Not Purchasable", "purchase_ok": False}
        )
        customers = self.env.ref("stock.stock_location_customers")
        cases = [
            (self.vendor.id, [], {}),
            (0, [{"product_id": self.product.id, "qty": 1}], {}),
            (self.vendor.id, [{"product_id": 0, "qty": 1}], {}),
            (self.vendor.id, [{"product_id": self.product.id, "qty": 0}], {}),
            (self.vendor.id, [{"product_id": not_purchasable.id, "qty": 1}], {}),
            (
                self.vendor.id,
                [{"product_id": self.product.id, "qty": 1}],
                {"location_dest_id": customers.id},
            ),
        ]
        for partner_id, lines, kwargs in cases:
            with self.subTest(lines=lines, kwargs=kwargs):
                with self.assertRaises(UserError):
                    self.PO.action_barcode_purchase(partner_id, lines, **kwargs)
        self.assertFalse(self.PO.search([("partner_id", "=", self.vendor.id)]))

    def test_purchase_rights_are_required(self):
        operator = new_test_user(
            self.env, login="barcode_po_operator", groups="stock.group_stock_user"
        )
        with self.assertRaises(AccessError):
            self.PO.with_user(operator).action_barcode_purchase(
                self.vendor.id, [{"product_id": self.product.id, "qty": 1}]
            )

    def test_each_order_line_keeps_its_own_move(self):
        """Two lots of the same product land on two order lines: purchase_stock
        keeps `purchase_line_id` out of the move merge, so each keeps a move,
        and a move line, of its own. The lot mapping rests on it."""
        result = self.PO.action_barcode_purchase(
            self.vendor.id,
            [
                {"product_id": self.lot_product.id, "qty": 1, "lot_name": "LOT-A"},
                {"product_id": self.lot_product.id, "qty": 1, "lot_name": "LOT-B"},
            ],
            confirm=True,
        )
        order = self._order(result)
        moves = order.picking_ids.move_ids
        self.assertEqual(len(moves), 2)
        self.assertEqual(moves.purchase_line_id, order.order_line)
        self.assertFalse(moves[0].move_line_ids & moves[1].move_line_ids)
