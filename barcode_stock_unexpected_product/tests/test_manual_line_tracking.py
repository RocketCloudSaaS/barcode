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
        cls._picking_type_allow_insert_new_line = cls.picking_type.allow_insert_new_line
        cls.picking_type.allow_insert_new_line = True

    @classmethod
    def tearDownClass(cls):
        cls.picking_type.write(
            {
                "allow_insert_new_line": cls._picking_type_allow_insert_new_line,
            }
        )
        super().tearDownClass()

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

    def test_string_lot_id_with_multiple_digits_is_resolved(self):
        product = self.env["product.product"].create(
            {
                "name": "String lot manual product",
                "is_storable": True,
                "tracking": "lot",
            }
        )
        Lot = self.env["stock.lot"]
        lot = False
        for index in range(10):
            lot = Lot.create({"name": f"STRING-LOT-{index}", "product_id": product.id})
            if lot.id > 9:
                break
        self.assertGreater(lot.id, 9)
        self.env["stock.quant"]._update_available_quantity(
            product, self.origin, 1, lot_id=lot
        )
        picking = self._picking()

        result = self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
            picking.id, product.id, 1, str(lot.id)
        )

        line = self.env["stock.move"].browse(result["move_id"]).move_line_ids
        self.assertEqual(line.lot_id, lot)

    def test_auto_pick_sets_qty_picked_and_delete_unreserves(self):
        product = self.env["product.product"].create(
            {"name": "Auto-picked manual product", "is_storable": True}
        )
        quant_model = self.env["stock.quant"]
        quant_model._update_available_quantity(product, self.origin, 5)
        available_before = quant_model._get_available_quantity(
            product, self.origin, strict=True
        )
        picking = self._picking()

        result = self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
            picking.id, product.id, 2, auto_pick=True
        )
        move = self.env["stock.move"].browse(result["move_id"])
        self.assertTrue(result["picked"])
        self.assertEqual(sum(move.move_line_ids.mapped("quantity")), 2)
        self.assertEqual(sum(move.move_line_ids.mapped("qty_picked")), 2)
        self.assertEqual(
            quant_model._get_available_quantity(product, self.origin, strict=True),
            available_before - 2,
        )

        deleted = self.env["stock.picking"].barcode_scanner_delete_manual_line(move.id)

        self.assertEqual(deleted, {"deleted": True, "move_id": move.id})
        self.assertFalse(move.exists())
        self.assertEqual(
            quant_model._get_available_quantity(product, self.origin, strict=True),
            available_before,
        )

    def test_delete_rejects_non_manual_move(self):
        product = self.env["product.product"].create(
            {"name": "Regular move product", "is_storable": True}
        )
        picking = self._picking()
        move = self.env["stock.move"].create(
            {
                "name": product.display_name,
                "product_id": product.id,
                "product_uom_qty": 1,
                "product_uom": product.uom_id.id,
                "picking_id": picking.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
                "company_id": self.env.company.id,
                "is_manually": False,
            }
        )

        with self.assertRaises(UserError):
            self.env["stock.picking"].barcode_scanner_delete_manual_line(move.id)

        self.assertTrue(move.exists())

    def test_delete_rejects_completed_picking(self):
        product = self.env["product.product"].create(
            {"name": "Completed manual product", "is_storable": True}
        )
        self.env["stock.quant"]._update_available_quantity(product, self.origin, 1)
        picking = self._picking()
        result = self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
            picking.id, product.id, 1, auto_pick=True
        )
        move = self.env["stock.move"].browse(result["move_id"])
        picking.with_context(skip_backorder=True).button_validate()
        self.assertEqual(picking.state, "done")

        with self.assertRaises(UserError):
            self.env["stock.picking"].barcode_scanner_delete_manual_line(move.id)

        self.assertTrue(move.exists())
