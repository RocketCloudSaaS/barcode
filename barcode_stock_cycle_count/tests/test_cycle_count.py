# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from unittest.mock import patch

from odoo.exceptions import UserError, ValidationError
from odoo.tests.common import TransactionCase


class TestBarcodeStockCycleCount(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.location = cls.env.ref("stock.stock_location_stock")
        cls.company = cls.env.company
        cls.product = cls.env["product.product"].create(
            {"name": "Cycle Count Product", "is_storable": True}
        )
        cls.rule = cls.env["stock.cycle.count.rule"].create(
            {"name": "Barcode test rule", "rule_type": "periodic"}
        )

    def make_count(self, state="draft", responsible=False, company=None):
        return self.env["stock.cycle.count"].create(
            {
                "location_id": self.location.id,
                "cycle_count_rule_id": self.rule.id,
                "company_id": (company or self.company).id,
                "responsible_id": responsible and responsible.id or False,
                "state": state,
            }
        )

    def make_inventory(self, count, state="in_progress", quantity=4, counted=4):
        inventory = self.env["stock.inventory"].create(
            {
                "name": "Barcode cycle inventory",
                "cycle_count_id": count.id,
                "location_ids": [(6, 0, [self.location.id])],
                "exclude_sublocation": True,
                "state": state,
            }
        )
        quant = self.env["stock.quant"].create(
            {
                "product_id": self.product.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
                "quantity": quantity,
                "inventory_quantity": counted,
                "current_inventory_id": inventory.id,
                "to_do": True,
            }
        )
        inventory.stock_quant_ids = [(6, 0, [quant.id])]
        return inventory, quant

    def test_list_scopes_current_company_and_draft_open(self):
        draft = self.make_count()
        opened = self.make_count(state="open")
        self.make_count(state="cancelled")
        result = self.env["stock.cycle.count"].barcode_get_counts()
        ids = {item["id"] for item in result["counts"]}
        self.assertIn(draft.id, ids)
        self.assertIn(opened.id, ids)

    def test_list_defaults_to_current_user_or_unassigned(self):
        assigned = self.make_count(responsible=self.env.user)
        unassigned = self.make_count()
        result = self.env["stock.cycle.count"].barcode_get_counts()
        ids = {item["id"] for item in result["counts"]}
        self.assertTrue({assigned.id, unassigned.id}.issubset(ids))

    def test_list_show_all_removes_assignment_only(self):
        user = self.env["res.users"].create(
            {"name": "Other cycle user", "login": "cycle-other"}
        )
        count = self.make_count(responsible=user)
        result = self.env["stock.cycle.count"].barcode_get_counts(show_all=True)
        self.assertIn(count.id, {item["id"] for item in result["counts"]})

    def test_cross_company_count_is_invisible(self):
        other = self.env["res.company"].create({"name": "Other cycle company"})
        location = self.env["stock.location"].create(
            {
                "name": "Other internal",
                "usage": "internal",
                "company_id": other.id,
            }
        )
        count = self.env["stock.cycle.count"].create(
            {
                "location_id": location.id,
                "cycle_count_rule_id": self.rule.id,
                "company_id": other.id,
            }
        )
        ids = {
            item["id"]
            for item in self.env["stock.cycle.count"].barcode_get_counts()["counts"]
        }
        self.assertNotIn(count.id, ids)

    def test_matching_location_advances(self):
        count = self.make_count()
        result = self.env["stock.cycle.count"].barcode_validate_location(
            count.id, self.location.id
        )
        self.assertTrue(result["valid"])

    def test_cross_company_location_rejected(self):
        other = self.env["res.company"].create({"name": "Other location company"})
        location = self.env["stock.location"].create(
            {"name": "Other location", "usage": "internal", "company_id": other.id}
        )
        count = self.make_count()
        with self.assertRaises(UserError):
            self.env["stock.cycle.count"].barcode_validate_location(
                count.id, location.id
            )

    def test_confirm_calls_oca_action_and_requires_in_progress(self):
        count = self.make_count()
        with patch.object(
            type(count), "action_create_inventory_adjustment"
        ) as create_adjustment:
            with self.assertRaises(UserError):
                self.env["stock.cycle.count"].barcode_confirm(count.id)
        create_adjustment.assert_called_once()

    def test_confirm_creates_exactly_one_linked_adjustment(self):
        count = self.make_count()
        result = self.env["stock.cycle.count"].barcode_confirm(count.id)
        count.invalidate_recordset()
        self.assertEqual(len(count.stock_adjustment_ids), 1)
        self.assertEqual(result["inventory"]["id"], count.stock_adjustment_ids.id)
        self.assertEqual(count.stock_adjustment_ids.state, "in_progress")

    def test_confirm_open_reuses_in_progress_adjustment(self):
        count = self.make_count(state="open")
        inventory, _quant = self.make_inventory(count)
        result = self.env["stock.cycle.count"].barcode_confirm(count.id)
        self.assertEqual(result["inventory"]["id"], inventory.id)
        self.assertEqual(inventory.state, "in_progress")

    def test_confirm_open_starts_draft_adjustment(self):
        count = self.make_count(state="open")
        inventory, _quant = self.make_inventory(count, state="draft")
        result = self.env["stock.cycle.count"].barcode_confirm(count.id)
        self.assertEqual(result["inventory"]["id"], inventory.id)
        self.assertEqual(inventory.state, "in_progress")

    def test_confirm_open_rejects_broken_adjustment_linkage(self):
        count = self.make_count(state="open")
        inventory, _quant = self.make_inventory(count)
        inventory.cycle_count_id = False
        with self.assertRaisesRegex(UserError, "no linked adjustment"):
            self.env["stock.cycle.count"].barcode_confirm(count.id)

    def test_confirm_failure_leaves_no_second_adjustment(self):
        count = self.make_count()
        inventory, _quant = self.make_inventory(count, state="draft")
        with patch.object(
            type(inventory),
            "action_state_to_in_progress",
            side_effect=UserError("start failed"),
        ):
            with self.assertRaises(UserError):
                self.env["stock.cycle.count"].barcode_confirm(count.id)
        self.assertEqual(len(count.stock_adjustment_ids), 1)

    def test_concurrent_in_progress_adjustment_is_surfaced_as_error(self):
        count = self.make_count()
        with patch.object(
            type(count),
            "action_create_inventory_adjustment",
            side_effect=ValidationError("An adjustment is already in progress."),
        ):
            with self.assertRaisesRegex(ValidationError, "already in progress"):
                self.env["stock.cycle.count"].barcode_confirm(count.id)

    def test_non_in_progress_result_does_not_open_count_screen(self):
        count = self.make_count()
        inventory, _quant = self.make_inventory(count, state="draft")
        with patch.object(type(inventory), "action_state_to_in_progress"):
            with self.assertRaises(UserError):
                self.env["stock.cycle.count"].barcode_confirm(count.id)
        self.assertEqual(inventory.state, "draft")

    def test_unknown_location_scan_rejected(self):
        count = self.make_count()
        with self.assertRaises(UserError):
            self.env["stock.cycle.count"].barcode_validate_location(count.id, 0)

    def test_read_uses_linked_adjustment_quant_lines(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        result = self.env["stock.inventory"].barcode_get_cycle_count_lines(inventory.id)
        self.assertEqual(result["lines"][0]["quant_id"], quant.id)

    def test_scan_matching_product_updates_line(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        result = self.env["stock.inventory"].barcode_get_cycle_count_lines(inventory.id)
        line = next(
            item for item in result["lines"] if item["product_id"] == self.product.id
        )
        self.assertEqual(line["quant_id"], quant.id)
        self.assertEqual(line["product_name"], self.product.display_name)

    def test_scan_outside_adjustment_rejected(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        outside = self.env["stock.quant"].create(
            {
                "product_id": self.product.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
                "quantity": 2,
                "current_inventory_id": inventory.id,
            }
        )
        with self.assertRaises(UserError):
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id, [{"quant_id": outside.id, "counted_qty": 1}]
            )
        self.assertEqual(quant.inventory_quantity, 4)

    def test_tracked_product_without_lot_rejected(self):
        product = self.env["product.product"].create(
            {"name": "Tracked cycle product", "is_storable": True, "tracking": "lot"}
        )
        count = self.make_count(state="open")
        inventory = self.env["stock.inventory"].create(
            {
                "name": "Tracked barcode inventory",
                "cycle_count_id": count.id,
                "location_ids": [(6, 0, [self.location.id])],
                "exclude_sublocation": True,
                "state": "in_progress",
            }
        )
        quant = self.env["stock.quant"].create(
            {
                "product_id": product.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
                "quantity": 1,
                "current_inventory_id": inventory.id,
            }
        )
        inventory.stock_quant_ids = [(6, 0, [quant.id])]
        with self.assertRaises(UserError):
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id, [{"quant_id": quant.id, "counted_qty": 1}]
            )

    def test_serial_quantity_greater_than_one_rejected(self):
        product = self.env["product.product"].create(
            {"name": "Serial cycle product", "is_storable": True, "tracking": "serial"}
        )
        lot = self.env["stock.lot"].create(
            {
                "name": "SERIAL-1",
                "product_id": product.id,
                "company_id": self.company.id,
            }
        )
        count = self.make_count(state="open")
        inventory = self.env["stock.inventory"].create(
            {
                "name": "Serial barcode inventory",
                "cycle_count_id": count.id,
                "location_ids": [(6, 0, [self.location.id])],
                "exclude_sublocation": True,
                "state": "in_progress",
            }
        )
        quant = self.env["stock.quant"].create(
            {
                "product_id": product.id,
                "lot_id": lot.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
                "quantity": 1,
                "current_inventory_id": inventory.id,
            }
        )
        inventory.stock_quant_ids = [(6, 0, [quant.id])]
        with self.assertRaises(UserError):
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id, [{"quant_id": quant.id, "counted_qty": 2}]
            )

    def test_company_and_quant_ids_revalidated(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        quant.current_inventory_id = False
        with self.assertRaises(UserError):
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id, [{"quant_id": quant.id, "counted_qty": 3}]
            )

    def test_negative_quantity_rejected(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        with self.assertRaises(UserError):
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id, [{"quant_id": quant.id, "counted_qty": -1}]
            )

    def test_zero_difference_lines_never_applied(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        with patch.object(type(quant), "action_apply_inventory") as apply:
            result = self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id,
                [{"quant_id": quant.id, "counted_qty": quant.quantity}],
                confirm_zero=True,
            )
        self.assertFalse(apply.called)
        self.assertEqual(result["applied_quant_ids"], [])
        self.assertEqual(inventory.state, "done")

    def test_apply_sends_only_non_zero_difference_lines(self):
        count = self.make_count(state="open")
        inventory, zero_quant = self.make_inventory(count)
        changed_quant = self.env["stock.quant"].create(
            {
                "product_id": self.product.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
                "quantity": 2,
                "current_inventory_id": inventory.id,
            }
        )
        inventory.stock_quant_ids = [(4, changed_quant.id)]
        with patch.object(type(zero_quant), "action_apply_inventory") as apply:
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id,
                [
                    {"quant_id": zero_quant.id, "counted_qty": 4},
                    {"quant_id": changed_quant.id, "counted_qty": 3},
                ],
            )
        self.assertEqual(apply.call_count, 1)
        self.assertEqual(apply.call_args.args[0].id, changed_quant.id)

    def test_positive_and_negative_differences_apply(self):
        count = self.make_count(state="open")
        inventory, positive = self.make_inventory(count, quantity=4, counted=4)
        negative = self.env["stock.quant"].create(
            {
                "product_id": self.product.id,
                "location_id": self.location.id,
                "company_id": self.company.id,
                "quantity": 6,
                "current_inventory_id": inventory.id,
            }
        )
        inventory.stock_quant_ids = [(4, negative.id)]
        with patch.object(type(positive), "action_apply_inventory") as apply:
            result = self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id,
                [
                    {"quant_id": positive.id, "counted_qty": 5},
                    {"quant_id": negative.id, "counted_qty": 3},
                ],
            )
        self.assertEqual(result["applied_count"], 2)
        self.assertEqual(apply.call_count, 2)

    def test_all_zero_difference_requires_confirmation(self):
        count = self.make_count(state="open")
        inventory, quant = self.make_inventory(count)
        with self.assertRaises(UserError):
            self.env["stock.inventory"].barcode_apply_cycle_count(
                inventory.id,
                [{"quant_id": quant.id, "counted_qty": quant.quantity}],
            )

    def test_empty_location_zero_confirmation_closes_without_apply(self):
        count = self.make_count(state="open")
        inventory = self.env["stock.inventory"].create(
            {
                "name": "Empty barcode cycle inventory",
                "cycle_count_id": count.id,
                "location_ids": [(6, 0, [self.location.id])],
                "exclude_sublocation": True,
                "state": "in_progress",
            }
        )
        result = self.env["stock.inventory"].barcode_close_cycle_count(
            inventory.id, confirm_zero=True
        )
        self.assertEqual(result["applied_count"], 0)
        self.assertEqual(inventory.state, "done")

    def test_close_calls_oca_done_and_cycle_is_done_with_accuracy(self):
        count = self.make_count(state="open")
        inventory, _quant = self.make_inventory(count)
        self.env["stock.inventory"].barcode_close_cycle_count(
            inventory.id, confirm_zero=True
        )
        self.assertEqual(inventory.state, "done")
        self.assertEqual(count.state, "done")
