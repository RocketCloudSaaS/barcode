# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, fields, models
from odoo.exceptions import UserError


class StockCycleCount(models.Model):
    _inherit = "stock.cycle.count"

    @api.model
    def barcode_get_counts(self, show_all=False):
        domain = [
            ("company_id", "=", self.env.company.id),
            ("state", "in", ["draft", "open"]),
        ]
        if not show_all:
            domain.append(("responsible_id", "in", [self.env.user.id, False]))
        counts = self.search(domain)
        state_labels = dict(self.fields_get(["state"])["state"]["selection"])
        result = []
        for count in counts:
            inventory = count.stock_adjustment_ids
            result.append(
                {
                    "id": count.id,
                    "name": count.name,
                    "state": count.state,
                    "state_label": state_labels.get(count.state, count.state),
                    "company_id": count.company_id.id,
                    "location_id": count.location_id.id,
                    "location_name": count.location_id.display_name,
                    "responsible_id": count.responsible_id.id or False,
                    "responsible_name": count.responsible_id.name or False,
                    "date_deadline": fields.Date.to_string(count.date_deadline)
                    if count.date_deadline
                    else False,
                    "inventory_id": inventory.id if len(inventory) == 1 else False,
                    "inventory_state": inventory.state
                    if len(inventory) == 1
                    else False,
                    "accuracy": inventory.inventory_accuracy
                    if len(inventory) == 1
                    else False,
                }
            )
        return {"counts": result}

    @api.model
    def barcode_confirm(self, cycle_count_id):
        count = self.browse(cycle_count_id).exists()
        if not count or (count.company_id and count.company_id != self.env.company):
            raise UserError(_("The selected cycle count is no longer available."))
        if count.state not in ("draft", "open"):
            raise UserError(_("Only planned or open cycle counts can be confirmed."))
        if not count.location_id or (
            count.location_id.company_id
            and count.location_id.company_id != count.company_id
        ):
            raise UserError(_("The cycle count location is no longer valid."))
        adjustments = count.stock_adjustment_ids.exists()
        if len(adjustments) > 1:
            raise UserError(_("The cycle count has more than one adjustment."))
        if not adjustments and count.state == "draft":
            count.action_create_inventory_adjustment()
            count = self.browse(count.id).exists()
            adjustments = count.stock_adjustment_ids.exists()
        if len(adjustments) != 1:
            raise UserError(_("The cycle count has no linked adjustment."))
        inventory = adjustments
        if (
            (inventory.company_id and inventory.company_id != self.env.company)
            or inventory.cycle_count_id != count
            or len(inventory.location_ids) != 1
            or inventory.location_ids != count.location_id
        ):
            raise UserError(_("The linked inventory adjustment is inconsistent."))
        if inventory.state == "draft":
            inventory.action_state_to_in_progress()
            inventory = self.env["stock.inventory"].browse(inventory.id).exists()
        if inventory.state != "in_progress":
            raise UserError(
                _(
                    "The inventory adjustment did not start. Refresh the cycle "
                    "count and try again."
                )
            )
        return {
            "cycle_count": {
                "id": count.id,
                "state": count.state,
                "state_label": dict(
                    self.fields_get(["state"])["state"]["selection"]
                ).get(count.state, count.state),
                "location_id": count.location_id.id,
                "location_name": count.location_id.display_name,
            },
            "inventory": {
                "id": inventory.id,
                "state": inventory.state,
                "location_id": inventory.location_ids.id,
            },
        }

    @api.model
    def barcode_validate_location(self, cycle_count_id, location_id):
        count = self.browse(cycle_count_id).exists()
        location = self.env["stock.location"].browse(location_id).exists()
        if not count or (count.company_id and count.company_id != self.env.company):
            raise UserError(_("The selected cycle count is no longer available."))
        if (
            not location
            or (location.company_id and location.company_id != self.env.company)
            or count.state not in ("draft", "open")
            or count.location_id != location
        ):
            raise UserError(_("Scan the expected cycle-count location."))
        return {
            "valid": True,
            "location": {"id": location.id, "display_name": location.display_name},
        }
