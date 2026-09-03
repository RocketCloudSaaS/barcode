# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestManualLineAvailability(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.origin = cls.env.ref("stock.stock_location_stock")
        cls.destination = cls.env["stock.location"].create(
            {
                "name": "Manual availability destination",
                "usage": "internal",
                "location_id": cls.origin.location_id.id,
                "company_id": cls.env.company.id,
            }
        )
        cls.picking_type = cls.env.ref("stock.picking_type_internal")
        cls.picking_type.allow_insert_new_line = True

    def test_insufficient_stock_does_not_create_move(self):
        product = self.env["product.product"].create(
            {"name": "Unavailable manual product", "is_storable": True}
        )
        picking = self.env["stock.picking"].create(
            {
                "picking_type_id": self.picking_type.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
            }
        )
        with self.assertRaises(UserError):
            self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
                picking.id, product.id, 1
            )
        self.assertFalse(picking.move_ids)

    def test_invalid_quantity_does_not_create_move(self):
        product = self.env["product.product"].create(
            {"name": "Invalid quantity product", "is_storable": True}
        )
        picking = self.env["stock.picking"].create(
            {
                "picking_type_id": self.picking_type.id,
                "location_id": self.origin.id,
                "location_dest_id": self.destination.id,
            }
        )
        with self.assertRaises(UserError):
            self.env["stock.picking"].barcode_scanner_add_manual_line_to_picking(
                picking.id, product.id, 0
            )
        self.assertFalse(picking.move_ids)
