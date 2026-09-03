# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, models
from odoo.exceptions import UserError


class StockPicking(models.Model):
    _inherit = "stock.picking"

    @api.model
    def barcode_scanner_check_insert_new_line_allowed(
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
            "error": ""
            if allowed
            else _(
                "Adding a new product line from the scanner is not allowed "
                "for this operation type."
            ),
        }

    @api.model
    def _barcode_scanner_add_line_to_picking(
        self,
        picking_id,
        product_id,
        quantity,
        lot_id=False,
        location_id=False,
        location_dest_id=False,
    ):
        return self.barcode_scanner_add_line_to_picking(
            picking_id, product_id, quantity, lot_id, location_id, location_dest_id
        )

    @api.model
    def barcode_scanner_add_manual_line_to_picking(
        self, picking_id, product_id, quantity, lot_id=False, auto_pick=False
    ):
        """Create or reserve pending demand from the PickingScreen."""
        picking = self.browse(picking_id).exists()
        if not picking:
            raise UserError(_("The picking no longer exists."))
        if picking.state in ("done", "cancel"):
            raise UserError(_("This picking can no longer be changed."))
        picking_type = picking.picking_type_id
        if picking_type.code != "internal" or not picking_type.allow_insert_new_line:
            raise UserError(
                _(
                    "Adding a new product line from the scanner is not allowed "
                    "for this operation type."
                )
            )

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

        source = picking.location_id or picking.move_ids[:1].location_id
        destination = picking.location_dest_id or picking.move_ids[:1].location_dest_id
        source = source or picking_type.default_location_src_id
        destination = destination or picking_type.default_location_dest_id
        if not source or not destination:
            raise UserError(_("The selected locations are no longer valid."))

        # Serialize additions before checking and reserving source stock.
        self.env.cr.execute(
            "SELECT id FROM stock_picking WHERE id = %s FOR UPDATE", (picking.id,)
        )
        self.env.cr.execute(
            "SELECT id FROM stock_location WHERE id = %s FOR UPDATE", (source.id,)
        )

        lot = self.env["stock.lot"].browse(lot_id).exists() if lot_id else False
        if product.tracking != "none" and not lot:
            raise UserError(
                _("A valid lot or serial number is required for this product.")
            )
        if lot and lot.product_id != product:
            raise UserError(_("The selected lot is not valid for this product."))
        if lot and lot.company_id and lot.company_id != picking.company_id:
            raise UserError(_("The selected lot is not valid for this company."))
        if product.tracking == "serial" and qty != 1:
            raise UserError(
                _("A serial-tracked product must be added one unit per line.")
            )
        if product.tracking == "none":
            lot = False

        available = self.env["stock.quant"]._get_available_quantity(
            product, source, lot_id=lot or None, strict=False
        )
        if available < qty:
            raise UserError(
                _(
                    "There is not enough available stock for product %(name)s.",
                    name=product.display_name,
                )
            )

        Move = self.env["stock.move"]
        move = Move.search(
            [
                ("picking_id", "=", picking.id),
                ("product_id", "=", product.id),
                ("is_manually", "=", True),
                ("picked", "=", False),
            ],
            limit=1,
        )
        if move:
            move.product_uom_qty += qty
        else:
            move = Move.create(
                {
                    "name": product.display_name,
                    "product_id": product.id,
                    "product_uom_qty": qty,
                    "product_uom": product.uom_id.id,
                    "state": "confirmed",
                    "picking_id": picking.id,
                    "location_id": source.id,
                    "location_dest_id": destination.id,
                    "company_id": picking.company_id.id,
                    "is_manually": True,
                }
            )

        taken = move._update_reserved_quantity(
            qty, source, lot_id=lot or None, strict=False
        )
        if taken < qty:
            raise UserError(
                _(
                    "There is not enough available stock for product %(name)s.",
                    name=product.display_name,
                )
            )
        if auto_pick:
            self._barcode_scanner_auto_pick_manual_line(move, product, lot)
        return {
            "move_id": move.id,
            "product_id": product.id,
            "quantity": qty,
            "name": product.name,
            "picked": bool(auto_pick),
        }

    def _barcode_scanner_auto_pick_manual_line(self, move, product, lot):
        lines = move.move_line_ids.filtered(
            lambda line: line.product_id == product and (not lot or line.lot_id == lot)
        )
        for line in lines:
            line.qty_picked = line.quantity

    @api.model
    def barcode_scanner_delete_manual_line(self, move_id):
        """Delete a manually added line (is_manually) from the PickingScreen."""
        move = self.env["stock.move"].browse(move_id).exists()
        if not move:
            raise UserError(_("The move no longer exists."))
        if not move.is_manually:
            raise UserError(_("Only manually added lines can be deleted."))
        picking = move.picking_id
        if picking.state in ("done", "cancel"):
            raise UserError(_("This picking can no longer be changed."))
        if move.state == "done":
            raise UserError(_("A completed move cannot be deleted."))
        if move.quantity:
            move._do_unreserve()
        move.unlink()
        return {"deleted": True, "move_id": move_id}

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

        Superseded by ``barcode_scanner_add_manual_line_to_picking`` for new
        UI flows (pending demand); this method remains fully working for
        backward compatibility and is covered by
        ``tests/test_scanner_add_line.py`` through
        ``_barcode_scanner_add_line_to_picking``.

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
        verdict = self.barcode_scanner_check_insert_new_line_allowed(
            origin_location_id, destination_location_id
        )
        if not verdict["allowed"]:
            raise UserError(verdict["error"])
        return super().action_barcode_scanner_internal_transfer(
            origin_location_id, destination_location_id, responsible_id, lines
        )
