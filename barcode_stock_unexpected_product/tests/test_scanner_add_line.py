# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestBarcodeScannerAddLineToPicking(TransactionCase):
    """EXP-04/05/06: adding a new/unlisted product line to an existing picking
    is gated on the real operation type flag
    (``picking.picking_type_id.allow_insert_new_line``)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        cls.stock_location = cls.env.ref("stock.stock_location_stock")

    def _internal_type(self, warehouse, allow):
        picking_type = self.env["stock.picking.type"].search(
            [
                ("warehouse_id", "=", warehouse.id),
                ("code", "=", "internal"),
            ],
            limit=1,
        )
        picking_type.allow_insert_new_line = allow
        return picking_type

    def _destination(self, origin):
        return self.env["stock.location"].create(
            {
                "name": f"Add Line Buffer of {origin.name}",
                "usage": "internal",
                "location_id": origin.location_id.id,
                "company_id": self.company.id,
            }
        )

    def _product(self, name):
        return self.env["product.product"].create({"name": name, "is_storable": True})

    def _picking(self, picking_type, origin, destination):
        return self.env["stock.picking"].create(
            {
                "picking_type_id": picking_type.id,
                "location_id": origin.id,
                "location_dest_id": destination.id,
            }
        )

    def test_internal_flag_true_adds_move_and_line(self):
        warehouse = self.env["stock.warehouse"].create(
            {"name": "Add WH True", "code": "ADDT"}
        )
        picking_type = self._internal_type(warehouse, allow=True)
        origin = warehouse.lot_stock_id
        destination = self._destination(origin)
        product = self._product("Add Line Allowed")
        self.env["stock.quant"]._update_available_quantity(product, origin, 10)
        picking = self._picking(picking_type, origin, destination)

        result = self.env["stock.picking"]._barcode_scanner_add_line_to_picking(
            picking.id, product.id, 3
        )
        move = self.env["stock.move"].browse(result["move_id"])
        move_line = self.env["stock.move.line"].browse(result["move_line_id"])
        self.assertEqual(move.picking_id, picking)
        self.assertEqual(move.product_id, product)
        self.assertEqual(move.product_uom_qty, 3)
        self.assertEqual(move_line.picking_id, picking)
        self.assertEqual(move_line.product_id, product)
        self.assertEqual(move_line.quantity, 3)
        self.assertTrue(move_line.picked)

    def test_internal_flag_false_blocks(self):
        warehouse = self.env["stock.warehouse"].create(
            {"name": "Add WH False", "code": "ADDF"}
        )
        picking_type = self._internal_type(warehouse, allow=False)
        origin = warehouse.lot_stock_id
        destination = self._destination(origin)
        product = self._product("Add Line Blocked")
        self.env["stock.quant"]._update_available_quantity(product, origin, 10)
        picking = self._picking(picking_type, origin, destination)

        with self.assertRaises(UserError) as err:
            self.env["stock.picking"]._barcode_scanner_add_line_to_picking(
                picking.id, product.id, 1
            )
        self.assertIn("not allowed", str(err.exception))
        self.assertFalse(picking.move_ids)

    def test_incoming_and_outgoing_block_even_if_flag_set(self):
        for xmlid in ("stock.picking_type_in", "stock.picking_type_out"):
            with self.subTest(picking_type=xmlid):
                picking_type = self.env.ref(xmlid)
                picking_type.allow_insert_new_line = True
                picking = self.env["stock.picking"].create(
                    {
                        "picking_type_id": picking_type.id,
                        "location_id": (
                            picking_type.default_location_src_id or self.stock_location
                        ).id,
                        "location_dest_id": (
                            picking_type.default_location_dest_id or self.stock_location
                        ).id,
                    }
                )
                product = self._product(f"Inert Product {xmlid}")
                with self.assertRaises(UserError) as err:
                    self.env["stock.picking"]._barcode_scanner_add_line_to_picking(
                        picking.id, product.id, 1
                    )
                self.assertIn("not allowed", str(err.exception))
                self.assertFalse(picking.move_ids)
