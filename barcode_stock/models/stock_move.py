# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import api, fields, models


class StockMove(models.Model):
    _inherit = "stock.move"
    _description = "Stock Move"

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
        data = self.env["stock.move.line"].read_group(
            [("move_id", "in", ready_moves.ids)],
            ["qty_picked:sum"],
            ["move_id"],
        )
        sums = {d["move_id"][0]: d["qty_picked"] for d in data}
        for move in self:
            done = sums.get(move.id, 0.0)
            move.qty_done_total = done
            move.qty_remaining = move.product_uom_qty - done
            move.is_fully_picked = move.qty_remaining <= 0

    def _upsert_move_line(self, vals):
        self.ensure_one()
        StockMoveLine = self.env["stock.move.line"]
        domain = [("move_id", "=", self.id)]
        identifying_fields = [
            "product_id",
            "lot_id",
            "package_id",
            "result_package_id",
            "location_id",
            "location_dest_id",
        ]
        for field in identifying_fields:
            if field in vals:
                domain.append((field, "=", vals[field]))
        move_line = StockMoveLine.search(domain, limit=1, order="id desc")
        if move_line:
            move_line.write(vals)
            return move_line
        vals.setdefault("move_id", self.id)
        return StockMoveLine.create(vals)
