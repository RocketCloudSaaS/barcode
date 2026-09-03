# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestManualLineTracking(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.origin = cls.env.ref("stock.stock_location_stock")
        cls.destination = cls.env["stock.location"].create(
            {
                "name": "Manual tracking destination",
                "usage": "internal",
                "location_id": cls.origin.location_id.id,
                "company_id": cls.env.company.id,
            }
        )
        cls.picking_type = cls.env.ref("stock.picking_type_internal")
        cls.picking_type.allow_insert_new_line = True

    def _picking(self):
        return self.env["stock.picking"].create(
            {
                "picking_type_id": self.picking_type.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
            }
        )

    def test_lot_is_required_and_serial_quantity_is_one(self):
        product = self.env["product.product"].create(
            {
                "name": "Tracked manual product",
                "is_storable": True,
                "tracking": "serial",
            }
        )
        lot = self.env["stock.lot"].create(
            {"name": "MANUAL-SERIAL-1", "product_id": product.id}
        )
        self.env["stock.quant"]._update_available_quantity(
            product, self.origin, 1, lot_id=lot
        )
        picking = self._picking()
        model = self.env["stock.picking"]
        with self.assertRaises(UserError):
            model.barcode_scanner_add_manual_line_to_picking(picking.id, product.id, 1)
        with self.assertRaises(UserError):
            model.barcode_scanner_add_manual_line_to_picking(
                picking.id, product.id, 2, lot.id
            )
        result = model.barcode_scanner_add_manual_line_to_picking(
            picking.id, product.id, 1, lot.id
        )
        line = self.env["stock.move"].browse(result["move_id"]).move_line_ids
        self.assertEqual(line.lot_id, lot)
        self.assertEqual(line.quantity, 1)
        self.assertEqual(line.qty_picked, 0)

    def test_lot_must_match_product(self):
        product = self.env["product.product"].create(
            {"name": "Lot manual product", "is_storable": True, "tracking": "lot"}
        )
        other = self.env["product.product"].create(
            {"name": "Other lot product", "is_storable": True}
        )
        lot = self.env["stock.lot"].create(
            {"name": "WRONG-PRODUCT", "product_id": other.id}
        )
        self.env["stock.quant"]._update_available_quantity(product, self.origin, 1)
        picking = self._picking()
        with self.assertRaises(UserError):
            self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
                picking.id, product.id, 1, lot.id
            )
