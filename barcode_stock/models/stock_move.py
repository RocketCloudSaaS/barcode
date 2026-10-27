# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, fields, models
from odoo.exceptions import UserError
from odoo.tools import float_compare, float_is_zero


class StockMove(models.Model):
    _inherit = "stock.move"

    qty_done_total = fields.Float(
        compute="_compute_qty_progress",
        string="Done",
        store=False,
    )
    qty_remaining = fields.Float(
        compute="_compute_qty_progress",
        string="Remaining Quantity",
        store=False,
    )
    is_fully_picked = fields.Boolean(
        compute="_compute_qty_progress",
        string="Fully Picked",
        store=False,
    )

    def _reset_qty_progress(self):
        for move in self:
            move.qty_done_total = 0
            move.qty_remaining = 0
            move.is_fully_picked = False

    @api.depends("move_line_ids.qty_picked", "picking_id.state")
    def _compute_qty_progress(self):
        if self.env.context.get("install_mode"):
            self._reset_qty_progress()
            return
        ready_moves = self.filtered(lambda m: m.picking_id.state == "assigned")
        if not ready_moves:
            self._reset_qty_progress()
            return
        data = self.env["stock.move.line"]._read_group(
            [("move_id", "in", ready_moves.ids)],
            ["move_id"],
            ["qty_picked:sum"],
        )
        sums = {move.id: qty_picked for move, qty_picked in data}
        for move in self:
            done = sums.get(move.id, 0.0)
            move.qty_done_total = done
            move.qty_remaining = move.product_uom_qty - done
            move.is_fully_picked = move.qty_remaining <= 0

    def barcode_pick_lot(self, lot_id, quantity, location_id=False):
        """Pick a lot the move's reservation does not carry, the way Odoo
        reserves it rather than by rewriting another lot's line: under the
        move's source (or the one the operator chose), following the removal
        strategy, one line per shelf, package and owner the lot lies in. As
        much of the other lots' reservation as the lot replaces is released
        first, and the lines are marked picked.

        Stock of the lot other moves hold is picked too, from where it lies:
        Odoo frees their reservation on validation. What is over the lot's
        stock goes on the last line; with no stock at all, the lot is only
        picked from a source the operator chose.
        """
        self.ensure_one()
        lot = self.env["stock.lot"].browse(lot_id)
        source = (
            self.env["stock.location"].browse(location_id)
            if location_id
            else self.location_id
        )
        self._barcode_release_other_lots(lot, quantity)
        held_before = {line: line.quantity_product_uom for line in self.move_line_ids}
        picked_before = {line: line.qty_picked for line in self.move_line_ids}
        taken = self._update_reserved_quantity(
            quantity, source, lot_id=lot, strict=False
        )
        # What this reservation put on each line, new or not.
        uom = self.product_id.uom_id
        picks = {}
        for line in self.move_line_ids.filtered(lambda line: line.lot_id == lot):
            reserved = line.quantity_product_uom - held_before.get(line, 0)
            if float_compare(reserved, 0, precision_rounding=uom.rounding) > 0:
                picks[line] = reserved
        lines = self.env["stock.move.line"].concat(*picks)
        for line in self._barcode_held_lot_lines(lot, quantity - taken, source, lines):
            picks[line] = line.quantity_product_uom
        if not picks:
            line = self._barcode_chosen_source_line(lot, quantity, source, location_id)
            picks[line] = quantity
        last = list(picks)[-1]
        over = quantity - sum(picks.values())
        for line, picked in picks.items():
            picked += over if line == last else 0
            line.qty_picked = picked_before.get(line, 0) + uom._compute_quantity(
                picked, line.product_uom_id
            )
        self._recompute_state()
        return True

    def _barcode_release_other_lots(self, lot, quantity):
        """Release, from the other lots' lines nothing was picked on, what the
        move would hold over its demand once ``quantity`` of ``lot`` is
        reserved, the last lines first."""
        rounding = self.product_id.uom_id.rounding
        excess = (
            sum(self.move_line_ids.mapped("quantity_product_uom"))
            + quantity
            - self.product_qty
        )
        others = self.move_line_ids.filtered(
            lambda line: line.lot_id != lot and not line.picked
        ).sorted("id", reverse=True)
        for line in others:
            if float_compare(excess, 0, precision_rounding=rounding) <= 0:
                break
            held = line.quantity_product_uom
            release = min(held, excess)
            excess -= release
            if float_is_zero(held - release, precision_rounding=rounding):
                line.unlink()
            else:
                line.quantity = self.product_id.uom_id._compute_quantity(
                    held - release, line.product_uom_id
                )

    def _barcode_held_lot_lines(self, lot, rest, source, lines):
        """Lines for what is left to pick of a lot whose stock other moves
        hold: from its quants under the source, in the order of the removal
        strategy, up to what each holds beyond what ``lines`` already take."""
        rounding = self.product_id.uom_id.rounding
        if float_compare(rest, 0, precision_rounding=rounding) <= 0:
            return self.env["stock.move.line"]
        ours = {}
        for line in lines:
            key = (line.location_id, line.package_id, line.owner_id)
            ours[key] = ours.get(key, 0) + line.quantity_product_uom
        vals_list = []
        quants = self.env["stock.quant"]._gather(self.product_id, source, lot_id=lot)
        for quant in quants.filtered(lambda quant: quant.lot_id == lot):
            key = (quant.location_id, quant.package_id, quant.owner_id)
            take = min(rest, quant.quantity - ours.get(key, 0))
            if float_compare(take, 0, precision_rounding=rounding) <= 0:
                continue
            vals_list.append(
                self._prepare_move_line_vals(quantity=take, reserved_quant=quant)
            )
            rest -= take
            if float_is_zero(rest, precision_rounding=rounding):
                break
        return self.env["stock.move.line"].create(vals_list)

    def _barcode_chosen_source_line(self, lot, quantity, source, chosen):
        """A line for a lot with no stock under the source: only from a source
        the operator chose."""
        if not chosen:
            raise UserError(
                _(
                    "Lot %(lot)s has no stock in %(location)s.",
                    lot=lot.name,
                    location=source.display_name,
                )
            )
        vals = self._prepare_move_line_vals(quantity=quantity)
        vals.update(lot_id=lot.id, location_id=source.id)
        return self.env["stock.move.line"].create(vals)
