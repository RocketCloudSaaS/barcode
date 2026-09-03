# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestBarcodeScannerInsertNewLineGate(TransactionCase):
    """EXP-04/05/06: the scanner add-line gate reads the real operation type
    flag (``picking.picking_type_id.allow_insert_new_line`` by construction),
    never the operation category or name prefixes (T24844)."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.company = cls.env.company
        # Warehouse-0 pair: the internal transfer resolves to "Storage"
        # (stock.picking_type_internal), whose flag defaults to False.
        cls.stock_location = cls.env.ref("stock.stock_location_stock")
        cls.destination_location = cls.env["stock.location"].create(
            {
                "name": "Gate Buffer",
                "usage": "internal",
                "location_id": cls.stock_location.location_id.id,
                "company_id": cls.company.id,
            }
        )
        cls.product = cls.env["product.product"].create(
            {"name": "Gate Product", "is_storable": True}
        )
        cls.env["stock.quant"]._update_available_quantity(
            cls.product, cls.stock_location, 10
        )
        # Ensure the warehouse internal type for the test locations is False
        wh = cls.stock_location.warehouse_id
        if wh:
            itype = cls.env["stock.picking.type"].search(
                [("warehouse_id", "=", wh.id), ("code", "=", "internal")], limit=1
            )
            if itype:
                itype.allow_insert_new_line = False

    def _verdict(self, origin_id, destination_id):
        return self.env["stock.picking"].barcode_scanner_check_insert_new_line_allowed(
            origin_id, destination_id
        )

    def _transfer(self, origin_id, destination_id, product):
        return self.env["stock.picking"].action_barcode_scanner_internal_transfer(
            origin_id,
            destination_id,
            False,
            [{"product_id": product.id, "qty": 1, "lot_id": False}],
        )

    def _new_warehouse(self, code):
        return self.env["stock.warehouse"].create(
            {"name": f"Gate WH {code}", "code": code}
        )

    def _internal_type(self, warehouse):
        return self.env["stock.picking.type"].search(
            [
                ("warehouse_id", "=", warehouse.id),
                ("code", "=", "internal"),
            ],
            limit=1,
        )

    def _buffer_for(self, origin):
        return self.env["stock.location"].create(
            {
                "name": f"Gate Buffer of {origin.name}",
                "usage": "internal",
                "location_id": origin.location_id.id,
                "company_id": self.company.id,
            }
        )

    def _seed_stock(self, origin, qty=10):
        product = self.env["product.product"].create(
            {"name": f"Gate Product {origin.name}", "is_storable": True}
        )
        self.env["stock.quant"]._update_available_quantity(product, origin, qty)
        return product

    def test_incoming_type_flag_true_is_inert(self):
        # T-01: a Receipt operation type can never enable the add-line path;
        # the gate only honors the resolved internal type.
        incoming = self.env.ref("stock.picking_type_in")
        incoming.write({"allow_insert_new_line": True})
        verdict = self._verdict(self.stock_location.id, self.destination_location.id)
        self.assertFalse(verdict["allowed"])
        with self.assertRaises(UserError):
            self._transfer(
                self.stock_location.id, self.destination_location.id, self.product
            )

    def test_outgoing_type_flag_true_is_inert(self):
        # T-02: same for a Delivery operation type.
        outgoing = self.env.ref("stock.picking_type_out")
        outgoing.write({"allow_insert_new_line": True})
        verdict = self._verdict(self.stock_location.id, self.destination_location.id)
        self.assertFalse(verdict["allowed"])

    def test_storage_default_false_blocks(self):
        # T-05: "Storage" keeps the default False and blocks new lines.
        storage = self.env.ref("stock.picking_type_internal")
        storage.allow_insert_new_line = False
        self.assertIs(storage.allow_insert_new_line, False)
        verdict = self._verdict(self.stock_location.id, self.destination_location.id)
        self.assertFalse(verdict["allowed"])
        self.assertTrue(verdict["error"])
        with self.assertRaises(UserError) as err:
            self._transfer(
                self.stock_location.id, self.destination_location.id, self.product
            )
        self.assertIn("not allowed", str(err.exception))

    def test_ship_to_jobs_default_false_blocks(self):
        # T-06: "Ship to Jobs" (when present in the build) stays False and
        # blocks new lines.
        ship_to_jobs = self.env.ref(
            "stock.picking_type_internal_ship_to_jobs", raise_if_not_found=False
        )
        if not ship_to_jobs:
            self.skipTest(
                "stock.picking_type_internal_ship_to_jobs is not defined "
                "in this Odoo build"
            )
        self.assertIs(ship_to_jobs.allow_insert_new_line, False)
        self.assertFalse(
            self._verdict(self.stock_location.id, self.destination_location.id)[
                "allowed"
            ]
        )

    def test_internal_type_with_flag_true_allows(self):
        # T-07: an internal type with the flag enabled allows the new line.
        warehouse = self._new_warehouse("T07")
        picking_type = self._internal_type(warehouse)
        picking_type.allow_insert_new_line = True
        origin = warehouse.lot_stock_id
        destination = self._buffer_for(origin)
        product = self._seed_stock(origin)

        verdict = self._verdict(origin.id, destination.id)
        self.assertTrue(verdict["allowed"])
        self.assertEqual(verdict["error"], "")

        result = self._transfer(origin.id, destination.id, product)
        picking = self.env["stock.picking"].browse(result["picking_id"])
        self.assertEqual(picking.picking_type_id, picking_type)
        self.assertEqual(picking.state, "done")

    def test_two_internal_types_follow_their_own_flag(self):
        # T-08: no general rule — each internal type is evaluated on its own
        # flag.
        wh_allowed = self._new_warehouse("T8A")
        wh_blocked = self._new_warehouse("T8B")
        type_allowed = self._internal_type(wh_allowed)
        type_blocked = self._internal_type(wh_blocked)
        type_allowed.allow_insert_new_line = True
        type_blocked.allow_insert_new_line = False

        origin_a = wh_allowed.lot_stock_id
        dest_a = self._buffer_for(origin_a)
        product_a = self._seed_stock(origin_a)
        self.assertTrue(self._verdict(origin_a.id, dest_a.id)["allowed"])
        result = self._transfer(origin_a.id, dest_a.id, product_a)
        self.assertEqual(
            self.env["stock.picking"].browse(result["picking_id"]).picking_type_id,
            type_allowed,
        )

        origin_b = wh_blocked.lot_stock_id
        dest_b = self._buffer_for(origin_b)
        product_b = self._seed_stock(origin_b)
        self.assertFalse(self._verdict(origin_b.id, dest_b.id)["allowed"])
        with self.assertRaises(UserError):
            self._transfer(origin_b.id, dest_b.id, product_b)

    def test_new_internal_type_default_false_blocks(self):
        # T-09: an internal type created without touching the field defaults
        # to False and blocks new lines.
        warehouse = self._new_warehouse("T09")
        picking_type = self._internal_type(warehouse)
        self.assertIs(picking_type.allow_insert_new_line, False)
        origin = warehouse.lot_stock_id
        destination = self._buffer_for(origin)
        product = self._seed_stock(origin)
        self.assertFalse(self._verdict(origin.id, destination.id)["allowed"])
        with self.assertRaises(UserError):
            self._transfer(origin.id, destination.id, product)

    def test_misleading_name_or_prefix_ignored(self):
        # T-10 (T24844 regression): the gate evaluates the type's own flag,
        # never its name or prefix.
        wh_clever = self._new_warehouse("T10A")
        clever_type = self._internal_type(wh_clever)
        clever_type.name = "Receipt-looking internal operation"
        clever_type.allow_insert_new_line = True
        origin_a = wh_clever.lot_stock_id
        dest_a = self._buffer_for(origin_a)
        self.assertTrue(self._verdict(origin_a.id, dest_a.id)["allowed"])

        wh_legit = self._new_warehouse("T10B")
        legit_type = self._internal_type(wh_legit)
        legit_type.name = "Internal Transfers"
        legit_type.allow_insert_new_line = False
        origin_b = wh_legit.lot_stock_id
        dest_b = self._buffer_for(origin_b)
        product_b = self._seed_stock(origin_b)
        verdict = self._verdict(origin_b.id, dest_b.id)
        self.assertFalse(verdict["allowed"])
        self.assertEqual(
            legit_type.code,
            "internal",
            "the misleading case must still be an internal type",
        )
        with self.assertRaises(UserError):
            self._transfer(origin_b.id, dest_b.id, product_b)
