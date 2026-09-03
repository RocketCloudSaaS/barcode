# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestManualLinePending(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.origin = cls.env.ref("stock.stock_location_stock")
        cls.destination = cls.env["stock.location"].create(
            {
                "name": "Manual pending destination",
                "usage": "internal",
                "location_id": cls.origin.location_id.id,
                "company_id": cls.env.company.id,
            }
        )
        cls.picking_type = cls.env.ref("stock.picking_type_internal")
        cls._picking_type_allow_insert_new_line = cls.picking_type.allow_insert_new_line
        cls.picking_type.allow_insert_new_line = True
        cls.product = cls.env["product.product"].create(
            {"name": "Manual pending product", "is_storable": True}
        )
        cls.env["stock.quant"]._update_available_quantity(cls.product, cls.origin, 5000)

    @classmethod
    def tearDownClass(cls):
        cls.picking_type.write(
            {"allow_insert_new_line": cls._picking_type_allow_insert_new_line}
        )
        super().tearDownClass()

    def test_bulk_add_creates_pending_demand(self):
        picking = self.env["stock.picking"].create(
            {
                "picking_type_id": self.picking_type.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
            }
        )
        result = self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
            picking.id, self.product.id, 2000
        )
        move = self.env["stock.move"].browse(result["move_id"])
        self.assertEqual(move.product_uom_qty, 2000)
        self.assertFalse(move.picked)
        self.assertTrue(move.move_line_ids)
        self.assertEqual(sum(move.move_line_ids.mapped("quantity")), 2000)
        self.assertEqual(sum(move.move_line_ids.mapped("qty_picked")), 0)
        self.assertFalse(any(move.move_line_ids.mapped("picked")))

    def test_repeated_add_merges_pending_move(self):
        picking = self.env["stock.picking"].create(
            {
                "picking_type_id": self.picking_type.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
            }
        )
        model = self.env["stock.picking"]
        first = model.barcode_scanner_add_manual_line_to_picking(
            picking.id, self.product.id, 2
        )
        second = model.barcode_scanner_add_manual_line_to_picking(
            picking.id, self.product.id, 3
        )
        self.assertEqual(first["move_id"], second["move_id"])
        move = self.env["stock.move"].browse(first["move_id"])
        self.assertEqual(move.product_uom_qty, 5)
        self.assertEqual(sum(move.move_line_ids.mapped("quantity")), 5)
