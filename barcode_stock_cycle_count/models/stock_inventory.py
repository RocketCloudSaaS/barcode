# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

import math
from datetime import datetime

from odoo import _, api, models
from odoo.exceptions import AccessError, UserError
from odoo.tools.float_utils import float_compare


class StockInventory(models.Model):
    _inherit = "stock.inventory"

    def _barcode_resolve_partial_cycle_count(self, inventory_id, for_write=False):
        unavailable = _("The selected inventory adjustment is unavailable.")
        if (
            not isinstance(inventory_id, int)
            or isinstance(inventory_id, bool)
            or inventory_id <= 0
        ):
            raise UserError(unavailable)
        try:
            self.check_access("read")
            if for_write:
                self.check_access("write")
            inventory = self.browse(inventory_id).exists()
            if not inventory:
                raise UserError(unavailable)
            inventory.check_access("read")
            if for_write:
                inventory.check_access("write")
            cycle = inventory.cycle_count_id.exists()
            if not cycle:
                raise UserError(unavailable)
            cycle.check_access("read")
            if for_write:
                cycle.check_access("write")
            inventory, cycle, quants = self._barcode_validate_inventory(inventory.id)
            quant_model = self.env["stock.quant"]
            quant_model.check_access("read")
            if for_write:
                quant_model.check_access("write")
            quants.check_access("read")
            quants.mapped("product_id").check_access("read")
            quants.mapped("lot_id").check_access("read")
        except AccessError:
            raise UserError(unavailable) from None

        in_progress_adjustments = cycle.stock_adjustment_ids.filtered(
            lambda adjustment: adjustment.state == "in_progress"
        )
        if (
            cycle.state != "open"
            or cycle.company_id != self.env.company
            or inventory.company_id != self.env.company
            or in_progress_adjustments != inventory
        ):
            raise UserError(_("The inventory adjustment is no longer valid."))
        return inventory, cycle, quants

    def _barcode_write_date_token(self, write_date):
        if not write_date:
            return False
        return write_date.isoformat(sep=" ", timespec="microseconds")

    def _barcode_partial_count_ack(self, quant):
        counted = quant.barcode_cycle_count_counted
        return {
            "quant_id": quant.id,
            "counted_qty": quant.inventory_quantity if counted else None,
            "barcode_cycle_count_counted": counted,
            "write_date": self._barcode_write_date_token(quant.write_date),
        }

    def _barcode_validate_partial_count_payload(self, line, linked_quant_ids):
        expected_keys = {
            "quant_id",
            "counted_qty",
            "lot_id",
            "lot_name",
            "write_date",
        }
        if not isinstance(line, dict) or set(line) != expected_keys:
            raise UserError(_("The counted line payload is invalid."))

        quant_id = line["quant_id"]
        if (
            not isinstance(quant_id, int)
            or isinstance(quant_id, bool)
            or quant_id <= 0
            or quant_id not in linked_quant_ids
        ):
            raise UserError(_("The counted line is no longer part of this adjustment."))
        lot_id = line["lot_id"]
        lot_name = line["lot_name"]
        if lot_id is not False and (
            not isinstance(lot_id, int) or isinstance(lot_id, bool) or lot_id <= 0
        ):
            raise UserError(_("The counted line payload is invalid."))
        if lot_name is not False and not isinstance(lot_name, str):
            raise UserError(_("The counted line payload is invalid."))

        expected_write_date = line["write_date"]
        if not isinstance(expected_write_date, str):
            raise UserError(_("The counted line revision is invalid."))
        try:
            expected_datetime = datetime.fromisoformat(expected_write_date)
        except ValueError:
            raise UserError(_("The counted line revision is invalid.")) from None
        if (
            expected_datetime.tzinfo
            or self._barcode_write_date_token(expected_datetime) != expected_write_date
        ):
            raise UserError(_("The counted line revision is invalid."))

        counted_qty = line["counted_qty"]
        if counted_qty is not None and (
            isinstance(counted_qty, bool) or not isinstance(counted_qty, int | float)
        ):
            raise UserError(_("The counted quantity is invalid."))
        if counted_qty is not None:
            try:
                counted_qty = float(counted_qty)
            except (OverflowError, ValueError):
                raise UserError(_("The counted quantity is invalid.")) from None
            if not math.isfinite(counted_qty) or counted_qty < 0:
                raise UserError(_("The counted quantity is invalid."))
        return quant_id, counted_qty, lot_id, lot_name, expected_write_date

    def _barcode_lock_partial_count_quant(self, quant):
        fields_to_refresh = [
            "write_date",
            "current_inventory_id",
            "to_do",
            "product_id",
            "location_id",
            "company_id",
            "lot_id",
            "quantity",
            "inventory_quantity",
            "barcode_cycle_count_counted",
        ]
        quant.flush_recordset(fields_to_refresh)
        self.env.cr.execute(
            "SELECT write_date FROM stock_quant WHERE id = %s FOR UPDATE",
            (quant.id,),
        )
        locked_row = self.env.cr.fetchone()
        if not locked_row:
            raise UserError(_("The counted line is no longer valid."))
        quant.invalidate_recordset(fields_to_refresh)
        return locked_row[0]

    def _barcode_validate_inventory(self, inventory_id):
        inventory = self.browse(inventory_id).exists()
        if not inventory or (
            inventory.company_id and inventory.company_id != self.env.company
        ):
            raise UserError(_("The selected inventory adjustment is unavailable."))
        cycle = inventory.cycle_count_id.exists()
        if (
            not cycle
            or (cycle.company_id and cycle.company_id != self.env.company)
            or cycle.stock_adjustment_ids != inventory
            or inventory.state != "in_progress"
            or len(inventory.location_ids) != 1
            or inventory.location_ids != cycle.location_id
            or (
                inventory.location_ids.company_id
                and inventory.location_ids.company_id != self.env.company
            )
        ):
            raise UserError(_("The inventory adjustment is no longer valid."))
        quants = inventory.stock_quant_ids.exists()
        if len(quants.filtered(lambda quant: quant.current_inventory_id != inventory)):
            raise UserError(_("The inventory adjustment contains stale lines."))
        return inventory, cycle, quants

    def _barcode_resolve_add_cycle_count_quant_records(
        self, inventory_id, product_id, lot_id
    ):
        try:
            self.check_access("read")
            inventory = self.browse(inventory_id).exists()
            if not inventory:
                raise UserError(_("The selected inventory adjustment is unavailable."))
            inventory.check_access("read")
            inventory.check_access("write")
            cycle = inventory.cycle_count_id.exists()
            if cycle:
                cycle.check_access("read")
            product_model = self.env["product.product"]
            product_model.check_access("read")
            product = product_model.browse(product_id).exists()
            if product:
                product.check_access("read")
            lot = self.env["stock.lot"]
            if lot_id is not False:
                lot.check_access("read")
                lot = lot.browse(lot_id).exists()
                if lot:
                    lot.check_access("read")
            linked_quants = inventory.stock_quant_ids.exists()
            linked_quants.check_access("read")
            linked_quants.mapped("product_id").check_access("read")
            linked_quants.mapped("lot_id").check_access("read")
            inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        except AccessError:
            raise UserError(
                _("The selected inventory adjustment is unavailable.")
            ) from None
        return inventory, cycle, product, lot, quants

    def _barcode_validate_add_cycle_count_quant_target(
        self, inventory, cycle, product, lot, lot_id
    ):
        if (
            cycle.state != "open"
            or cycle.company_id != self.env.company
            or inventory.company_id != cycle.company_id
            or inventory.location_ids.company_id != cycle.company_id
            or not inventory.exclude_sublocation
            or inventory.product_ids
        ):
            raise UserError(_("The inventory adjustment is no longer valid."))
        if (
            not product
            or not product.is_storable
            or (product.company_id and product.company_id != cycle.company_id)
        ):
            raise UserError(_("The selected product is unavailable."))
        if product.tracking == "none":
            if lot_id is not False:
                raise UserError(_("An untracked product cannot contain lot identity."))
        elif product.tracking in ("lot", "serial"):
            if (
                lot_id is False
                or not lot
                or lot.product_id != product
                or (lot.company_id and lot.company_id != cycle.company_id)
            ):
                raise UserError(_("A matching existing lot or serial is required."))
        else:
            raise UserError(_("The selected product tracking is unsupported."))

    def _barcode_find_add_cycle_count_quant(self, quant_model, domain):
        try:
            quant_model.check_access("read")
            candidate_quants = quant_model.search(domain, limit=2)
            candidate_quants.check_access("read")
            candidate_quants.check_access("write")
        except AccessError:
            raise UserError(
                _("The selected inventory adjustment is unavailable.")
            ) from None
        if not candidate_quants:
            raise UserError(
                _("No existing stock quant matches the selected product identity.")
            )
        if len(candidate_quants) > 1:
            raise UserError(
                _("Multiple existing stock quants match the selected product identity.")
            )
        return candidate_quants

    def _barcode_get_add_cycle_count_quant_line(self, inventory, quant):
        lines = self.barcode_get_cycle_count_lines(inventory.id)["lines"]
        line = next((item for item in lines if item["quant_id"] == quant.id), None)
        if not line:
            raise UserError(_("The matching stock quant is no longer valid."))
        return line

    @api.model
    def barcode_add_cycle_count_quant(self, inventory_id, product_id, lot_id=False):
        if (
            not isinstance(inventory_id, int)
            or isinstance(inventory_id, bool)
            or inventory_id <= 0
            or not isinstance(product_id, int)
            or isinstance(product_id, bool)
            or product_id <= 0
            or (
                lot_id is not False
                and (
                    not isinstance(lot_id, int)
                    or isinstance(lot_id, bool)
                    or lot_id <= 0
                )
            )
        ):
            raise UserError(_("The selected product identity is invalid."))

        (
            inventory,
            cycle,
            product,
            lot,
            quants,
        ) = self._barcode_resolve_add_cycle_count_quant_records(
            inventory_id, product_id, lot_id
        )
        self._barcode_validate_add_cycle_count_quant_target(
            inventory, cycle, product, lot, lot_id
        )

        prefill = inventory.prefill_counted_quantity
        if prefill not in ("zero", "counted"):
            raise UserError(_("The inventory adjustment prefill is invalid."))
        quant_model = self.env["stock.quant"]
        domain = [
            ("product_id", "=", product.id),
            ("location_id", "=", inventory.location_ids.id),
            ("company_id", "=", inventory.company_id.id),
            ("lot_id", "=", lot.id if lot else False),
        ]
        quant = self._barcode_find_add_cycle_count_quant(quant_model, domain)

        if quant in quants:
            if quant.current_inventory_id != inventory:
                raise UserError(_("The matching stock quant is no longer valid."))
            return self._barcode_get_add_cycle_count_quant_line(inventory, quant)
        if quant.current_inventory_id or quant.to_do:
            raise UserError(_("The matching stock quant is already in an adjustment."))

        # Recheck the unique match and ownership immediately before association.
        inventory.invalidate_recordset(["stock_quant_ids"])
        quant.invalidate_recordset(["current_inventory_id", "to_do"])
        candidate_quants = self._barcode_find_add_cycle_count_quant(
            quant_model, domain
        )
        if candidate_quants != quant:
            raise UserError(_("The matching stock quant is no longer valid."))
        if quant.current_inventory_id or quant.to_do:
            raise UserError(_("The matching stock quant is already in an adjustment."))

        counted_quantity = quant.quantity if prefill == "counted" else 0
        inventory.write({"stock_quant_ids": [(4, quant.id)]})
        quant.write(
            {
                "current_inventory_id": inventory.id,
                "to_do": True,
                "user_id": inventory.responsible_id.id,
                "inventory_date": inventory.date,
                "inventory_quantity": counted_quantity,
                "barcode_cycle_count_counted": True,
            }
        )
        return self._barcode_get_add_cycle_count_quant_line(inventory, quant)

    @api.model
    def barcode_get_cycle_count_lines(self, inventory_id):
        inventory, cycle, quants = self._barcode_resolve_partial_cycle_count(
            inventory_id
        )
        lines = []
        for quant in quants:
            product = quant.product_id.exists()
            lot = quant.lot_id.exists()
            if (
                not product
                or (product.company_id and product.company_id != self.env.company)
                or (lot and lot.company_id and lot.company_id != self.env.company)
                or quant.location_id != inventory.location_ids
                or (quant.company_id and quant.company_id != self.env.company)
            ):
                raise UserError(_("The inventory adjustment contains invalid lines."))
            counted = quant.barcode_cycle_count_counted
            counted_qty = quant.inventory_quantity if counted else None
            lines.append(
                {
                    "quant_id": quant.id,
                    "product_id": product.id,
                    "product_name": product.display_name,
                    "tracking": product.tracking,
                    "lot_id": lot.id or False,
                    "lot_name": lot.name or False,
                    "theoretical_qty": quant.quantity,
                    "counted_qty": counted_qty,
                    "barcode_cycle_count_counted": counted,
                    "difference": (
                        counted_qty - quant.quantity
                        if counted_qty is not None
                        else None
                    ),
                    "uom": product.uom_id.name,
                    "rounding": product.uom_id.rounding,
                    "write_date": self._barcode_write_date_token(quant.write_date),
                }
            )
        return {
            "inventory": {
                "id": inventory.id,
                "state": inventory.state,
                "cycle_count_id": cycle.id,
                "location_id": cycle.location_id.id,
                "location_name": cycle.location_id.display_name,
                "cycle_count_name": cycle.name,
            },
            "lines": lines,
        }

    @api.model
    def barcode_save_cycle_count_line(self, inventory_id, line):
        inventory, _cycle, quants = self._barcode_resolve_partial_cycle_count(
            inventory_id, for_write=True
        )
        (
            quant_id,
            counted_qty,
            lot_id,
            lot_name,
            expected_write_date,
        ) = self._barcode_validate_partial_count_payload(line, quants.ids)

        quant = self.env["stock.quant"].browse(quant_id).exists()
        if not quant:
            raise UserError(_("The counted line is no longer valid."))
        try:
            quant.check_access("read")
            quant.check_access("write")
            quant.product_id.check_access("read")
            quant.lot_id.check_access("read")
        except AccessError:
            raise UserError(
                _("The selected inventory adjustment is unavailable.")
            ) from None

        locked_write_date = self._barcode_lock_partial_count_quant(quant)

        if (
            quant.current_inventory_id != inventory
            or quant not in inventory.stock_quant_ids
        ):
            raise UserError(_("The counted line is no longer part of this adjustment."))
        if not quant.to_do:
            raise UserError(_("The counted line is no longer valid."))
        validation_qty = counted_qty if counted_qty is not None else 0.0
        self._barcode_validate_line(
            inventory, quant, validation_qty, lot_id=lot_id, lot_name=lot_name
        )

        current_revision = self._barcode_write_date_token(locked_write_date)
        current_counted = (
            quant.inventory_quantity if quant.barcode_cycle_count_counted else None
        )
        if expected_write_date != current_revision and current_counted != counted_qty:
            raise UserError(
                _("This counted line changed. Reload it before saving another value.")
            )
        if current_counted != counted_qty:
            values = {"barcode_cycle_count_counted": counted_qty is not None}
            if counted_qty is not None:
                values["inventory_quantity"] = counted_qty
            quant.write(values)
            quant.invalidate_recordset(
                [
                    "write_date",
                    "inventory_quantity",
                    "barcode_cycle_count_counted",
                ]
            )
        return self._barcode_partial_count_ack(quant)

    def _barcode_validate_line(
        self, inventory, quant, counted_qty, lot_id=False, lot_name=False
    ):
        if (
            quant.current_inventory_id != inventory
            or quant not in inventory.stock_quant_ids
        ):
            raise UserError(_("The counted line is no longer part of this adjustment."))
        product = quant.product_id.exists()
        lot = quant.lot_id.exists()
        if (
            not product
            or (quant.company_id and quant.company_id != self.env.company)
            or quant.location_id != inventory.location_ids
            or (product.company_id and product.company_id != self.env.company)
            or (lot and lot.company_id and lot.company_id != self.env.company)
        ):
            raise UserError(_("The counted line is no longer valid."))
        try:
            counted_qty = float(counted_qty)
        except (TypeError, ValueError):
            raise UserError(_("The counted quantity is invalid.")) from None
        if not math.isfinite(counted_qty):
            raise UserError(_("The counted quantity must be finite."))
        if (
            float_compare(counted_qty, 0, precision_rounding=product.uom_id.rounding)
            < 0
        ):
            raise UserError(_("The counted quantity cannot be negative."))
        if product.tracking != "none" and not lot:
            raise UserError(_("A tracked product must retain its lot or serial."))
        if product.tracking == "none":
            if lot_id or lot_name:
                raise UserError(_("An untracked line cannot contain lot identity."))
        elif lot_id != lot.id or lot_name != lot.name:
            raise UserError(_("The counted line lot or serial does not match."))
        if product.tracking == "serial" and counted_qty not in (0, 1):
            raise UserError(_("A serial-numbered product can only be counted once."))
        return counted_qty

    def _barcode_validate_completion(self, inventory, quants, lines):
        if not isinstance(lines, list):
            raise UserError(_("Counted lines must be a list."))
        linked_ids = set(quants.ids)
        submitted_ids = set()
        validated = []
        for line in lines:
            if not isinstance(line, dict) or set(line) != {
                "quant_id",
                "counted_qty",
                "lot_id",
                "lot_name",
            }:
                raise UserError(
                    _(
                        "Each counted line must contain quant, quantity, and "
                        "authoritative identity."
                    )
                )
            quant_id = line["quant_id"]
            if quant_id in submitted_ids:
                raise UserError(_("A counted line was submitted more than once."))
            submitted_ids.add(quant_id)
            if quant_id not in linked_ids:
                raise UserError(_("One of the counted lines is not linked."))
            quant = self.env["stock.quant"].browse(quant_id).exists()
            counted_qty = self._barcode_validate_line(
                inventory,
                quant,
                line["counted_qty"],
                line["lot_id"],
                line["lot_name"],
            )
            validated.append((quant, counted_qty))
        if submitted_ids != linked_ids:
            raise UserError(_("Every linked line must be explicitly counted."))
        return validated

    @api.model
    def barcode_apply_cycle_count(self, inventory_id, lines, confirm_zero=False):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        validated = self._barcode_validate_completion(inventory, quants, lines)
        applied = []
        for quant, counted_qty in validated:
            if float_compare(
                counted_qty,
                quant.quantity,
                precision_rounding=quant.product_id.uom_id.rounding,
            ):
                if (
                    not quant.inventory_quantity_set
                    or counted_qty != quant.inventory_quantity
                ):
                    quant.with_context(inventory_mode=True).write(
                        {"inventory_quantity": counted_qty}
                    )
                result = quant.action_apply_inventory()
                if result:
                    raise UserError(
                        _(
                            "The inventory adjustment could not be applied "
                            "automatically. Resolve the conflict in the inventory "
                            "adjustment and try again."
                        )
                    )
                applied.append(quant.id)
        if not applied and not confirm_zero:
            raise UserError(_("Confirm the zero-difference count before closing."))
        inventory.action_state_to_done()
        return {
            "inventory_id": inventory.id,
            "cycle_count_id": cycle.id,
            "state": "done",
            "accuracy": inventory.inventory_accuracy,
            "applied_quant_ids": applied,
            "applied_count": len(applied),
        }

    @api.model
    def barcode_close_cycle_count(self, inventory_id, lines, confirm_zero=False):
        inventory, cycle, quants = self._barcode_validate_inventory(inventory_id)
        validated = self._barcode_validate_completion(inventory, quants, lines)
        for quant, counted_qty in validated:
            if float_compare(
                counted_qty,
                quant.quantity,
                precision_rounding=quant.product_id.uom_id.rounding,
            ):
                raise UserError(_("Resolve all differences before closing."))
        if not confirm_zero:
            raise UserError(_("Confirm the zero-difference count before closing."))
        inventory.action_state_to_done()
        return {
            "inventory_id": inventory.id,
            "cycle_count_id": cycle.id,
            "state": "done",
            "accuracy": inventory.inventory_accuracy,
            "applied_quant_ids": [],
            "applied_count": 0,
        }
