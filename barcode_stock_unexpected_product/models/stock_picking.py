# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, models
from odoo.exceptions import UserError


class StockPicking(models.Model):
    _inherit = "stock.picking"

    @api.model
    def _barcode_scanner_check_insert_new_line_allowed(
        self, origin_location_id, destination_location_id
    ):
        """Whether the scanner may add a new/unlisted product line for an
        internal transfer between the two locations.

        Resolves the real internal operation type the transfer will use (same
        lookup as creation) and checks its ``allow_insert_new_line`` flag.
        Never inspects category or name prefixes (T24844 regression).

        Called by the client UX guard during scanning; the authoritative gate
        re-uses the same verdict inside ``action_barcode_scanner_internal_transfer``.
        """
        origin = self.env["stock.location"].browse(origin_location_id).exists()
        destination = (
            self.env["stock.location"].browse(destination_location_id).exists()
        )
        if not origin or not destination:
            return {
                "allowed": False,
                "error": _("The selected locations are no longer valid."),
            }
        picking_type = self._barcode_scanner_get_internal_picking_type(
            origin, destination
        )
        allowed = bool(
            picking_type.code == "internal" and picking_type.allow_insert_new_line
        )
        return {
            "allowed": allowed,
            "error": "" if allowed else _("Adding a new product line from the scanner is not allowed for this operation type."),
        }

    @api.model
    def _barcode_scanner_add_line_to_picking(self, picking_id, product_id, quantity, lot_id=False, location_id=False, location_dest_id=False):
        return self.barcode_scanner_add_line_to_picking(picking_id, product_id, quantity, lot_id, location_id, location_dest_id)

    @api.model
    def barcode_scanner_add_line_to_picking(
        self,
        picking_id,
        product_id,
        quantity,
        lot_id=False,
        location_id=False,
        location_dest_id=False,
    ):
        """Add a new/unlisted product line to an existing picking from the
        scanner.

        Authoritative gate: reads the real operation type of the picking
        (``picking_type_id.code`` and ``allow_insert_new_line``), never
        category or name prefixes (T24844 regression).
        """
        picking = self.browse(picking_id).exists()
        if not picking:
            raise UserError(_("The picking no longer exists."))
        product = self.env["product.product"].browse(product_id).exists()
        if not product:
            raise UserError(_("One of the selected products no longer exists."))
        qty = float(quantity or 0)
        if qty <= 0:
            raise UserError(
                _(
                    "Quantity must be greater than zero for product %(name)s.",
                    name=product.display_name,
                )
            )

        picking_type = picking.picking_type_id
        if picking_type.code != "internal" or not picking_type.allow_insert_new_line:
            raise UserError(
                _(
                    "Adding a new product line from the scanner is not allowed "
                    "for this operation type."
                )
            )

        if not location_id:
            location_id = picking.move_ids[:1].location_id.id
        if not location_dest_id:
            location_dest_id = picking.move_ids[:1].location_dest_id.id
        if not location_id:
            location_id = picking_type.default_location_src_id.id
        if not location_dest_id:
            location_dest_id = picking_type.default_location_dest_id.id
        origin_location = self.env["stock.location"].browse(location_id).exists()
        destination_location = (
            self.env["stock.location"].browse(location_dest_id).exists()
        )
        if not origin_location or not destination_location:
            raise UserError(_("The selected locations are no longer valid."))

        lot = self.env["stock.lot"].browse(lot_id).exists() if lot_id else False

        # ponytail: manually added moves reuse existing move and keep demand synced
        existing_move = self.env["stock.move"].search(
            [
                ("picking_id", "=", picking.id),
                ("product_id", "=", product.id),
                ("is_manually", "=", True),
            ],
            limit=1,
        )
        if existing_move:
            existing_move.product_uom_qty = existing_move.product_uom_qty + qty
            move = existing_move
        else:
            move = self.env["stock.move"].create(
                {
                    "name": product.display_name,
                    "product_id": product.id,
                    "product_uom_qty": qty,
                    "product_uom": product.uom_id.id,
                    "state": picking.state,
                    "picking_id": picking.id,
                    "location_id": origin_location.id,
                    "location_dest_id": destination_location.id,
                    "company_id": picking.company_id.id,
                    "is_manually": True,
                }
            )

        move_line_model = self.env["stock.move.line"]
        vals = {
            "move_id": move.id,
            "picking_id": picking.id,
            "product_id": product.id,
            "product_uom_id": product.uom_id.id,
            "quantity": qty,
            "location_id": origin_location.id,
            "location_dest_id": destination_location.id,
            "company_id": picking.company_id.id,
            "lot_id": lot.id if lot else False,
            "lot_name": lot.name if lot else False,
        }
        if "qty_picked" in move_line_model._fields:
            vals["qty_picked"] = qty
            vals["picked"] = True
        move_line = move_line_model.create(vals)

        return {
            "move_id": move.id,
            "move_line_id": move_line.id,
            "product_id": product.id,
            "quantity": qty,
            "name": product.name,
        }

    @api.model
    def action_barcode_scanner_internal_transfer(
        self, origin_location_id, destination_location_id, responsible_id, lines
    ):
        verdict = self._barcode_scanner_check_insert_new_line_allowed(
            origin_location_id, destination_location_id
        )
        if not verdict["allowed"]:
            raise UserError(verdict["error"])
        return super().action_barcode_scanner_internal_transfer(
            origin_location_id, destination_location_id, responsible_id, lines
        )
