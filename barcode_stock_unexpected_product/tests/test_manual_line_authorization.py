# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestManualLineAuthorization(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.env = cls.env(context=dict(cls.env.context, tracking_disable=True))
        cls.company = cls.env.company
        cls.origin = cls.env.ref("stock.stock_location_stock")
        cls.destination = cls.env["stock.location"].create(
            {
                "name": "Manual line destination",
                "usage": "internal",
                "location_id": cls.origin.location_id.id,
                "company_id": cls.company.id,
            }
        )
        cls.product = cls.env["product.product"].create(
            {"name": "Manual authorization product", "is_storable": True}
        )
        cls.env["stock.quant"]._update_available_quantity(cls.product, cls.origin, 10)

    def _picking(self, picking_type):
        return self.env["stock.picking"].create(
            {
                "picking_type_id": picking_type.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
            }
        )

    def test_permitted_internal_transfer_is_authorized(self):
        picking_type = self.env.ref("stock.picking_type_internal")
        previous = picking_type.allow_insert_new_line
        picking_type.allow_insert_new_line = True
        try:
            picking = self._picking(picking_type)
            result = self.env[
                "stock.picking"
            ].barcode_scanner_add_manual_line_to_picking(picking.id, self.product.id, 2)
            self.assertEqual(result["product_id"], self.product.id)
            self.assertEqual(
                self.env["stock.move"].browse(result["move_id"]), picking.move_ids
            )
        finally:
            picking_type.write({"allow_insert_new_line": previous})

    def test_receipt_and_delivery_are_rejected(self):
        for xmlid in ("stock.picking_type_in", "stock.picking_type_out"):
            with self.subTest(xmlid=xmlid):
                picking_type = self.env.ref(xmlid)
                previous = picking_type.allow_insert_new_line
                picking_type.allow_insert_new_line = True
                try:
                    picking = self._picking(picking_type)
                    with self.assertRaises(UserError):
                        self.env[
                            "stock.picking"
                        ].barcode_scanner_add_manual_line_to_picking(
                            picking.id, self.product.id, 1
                        )
                    self.assertFalse(picking.move_ids)
                finally:
                    picking_type.write({"allow_insert_new_line": previous})

    def test_done_picking_is_rejected(self):
        picking_type = self.env.ref("stock.picking_type_internal")
        previous = picking_type.allow_insert_new_line
        picking_type.allow_insert_new_line = True
        try:
            picking = self._picking(picking_type)
            picking.state = "done"
            with self.assertRaises(UserError):
                self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
                    picking.id, self.product.id, 1
                )
        finally:
            picking_type.write({"allow_insert_new_line": previous})
