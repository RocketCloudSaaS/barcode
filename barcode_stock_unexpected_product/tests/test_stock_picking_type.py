# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import TransactionCase


class TestStockPickingTypeAllowInsertNewLine(TransactionCase):
    """EXP-01 and EXP-07: field definition, persistence and upgrade safety."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.picking_type_model = cls.env["stock.picking.type"]

    def test_field_exists_boolean_stored_default_false(self):
        # QA-01
        field = self.picking_type_model._fields["allow_insert_new_line"]
        self.assertEqual(field.type, "boolean")
        self.assertTrue(field.store)
        picking_type = self.picking_type_model.create(
            {
                "name": "Internal QA01",
                "code": "internal",
                "sequence_code": "TEST01",
            }
        )
        self.assertIs(picking_type.allow_insert_new_line, False)

    def test_field_value_persisted_in_database(self):
        # QA-02: the value is stored, not computed on the fly.
        picking_type = self.picking_type_model.create(
            {
                "name": "Internal QA02",
                "code": "internal",
                "sequence_code": "TEST02",
            }
        )
        self.env.cr.execute(
            "SELECT allow_insert_new_line FROM stock_picking_type WHERE id = %s",
            [picking_type.id],
        )
        self.assertIs(self.env.cr.fetchone()[0], False)

    def test_existing_internal_types_keep_false(self):
        # QA-03 / EXP-07: "Storage" keeps False, "Ship to Jobs" keeps False
        # when present, and no module data enables any type retroactively.
        storage = self.env.ref("stock.picking_type_internal")
        # Ensure isolation from previous manual changes (e.g., WH/INT/00001 set to True)
        storage.allow_insert_new_line = False
        self.assertIs(storage.allow_insert_new_line, False)
        ship_to_jobs = self.env.ref(
            "stock.picking_type_internal_ship_to_jobs", raise_if_not_found=False
        )
        if ship_to_jobs:
            self.assertIs(ship_to_jobs.allow_insert_new_line, False)
        enabled = self.picking_type_model.search([("allow_insert_new_line", "=", True)])
        self.assertFalse(enabled)
