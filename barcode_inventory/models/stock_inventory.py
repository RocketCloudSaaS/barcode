# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare


class StockInventory(models.Model):
    _inherit = "stock.inventory"

    @api.model
    def action_barcode_location_lines(self, location_id):
        """Return the current on-hand stock of a location as count lines, so the
        scanner can show theoretical quantities before the operator counts.

        This is a plain read: no inventory adjustment group is created yet. The
        group is only built when the operator applies the count
        (``action_barcode_apply_count``), so backing out of the screen leaves no
        dangling adjustment in progress.
        """
        location = self.env["stock.location"].browse(location_id).exists()
        if not location:
            raise UserError(_("The selected location is no longer valid."))
        quants = self.env["stock.quant"].search(
            [
                ("location_id", "=", location.id),
                ("quantity", "!=", 0),
            ]
        )
        lines = []
        for quant in quants:
            product = quant.product_id
            lines.append(
                {
                    "product_id": product.id,
                    "product_name": product.display_name,
                    "tracking": product.tracking,
                    "lot_id": quant.lot_id.id or False,
                    "lot_name": quant.lot_id.name or False,
                    "theoretical_qty": quant.quantity,
                    "uom": product.uom_id.name,
                }
            )
        return {
            "location_id": location.id,
            "location_name": location.display_name,
            "lines": lines,
        }

    @api.model
    def _barcode_resolve_lot(self, product, lot_name, company=None):
        """Find an existing lot/serial by name for the product, or create one.

        The scan carries a lot *name* (from a GS1 label or typed in), never a
        database id, so resolution and creation happen server-side where the
        access rights and the name+product uniqueness live.

        The lot is created in ``company`` -- the company of the location being
        counted -- not in the operator's current company. A shared product
        (``company_id`` unset) counted in another company's location would
        otherwise get a lot in the wrong company and Odoo rejects the adjustment
        with an "Incompatible companies" error.
        """
        lot_name = (lot_name or "").strip()
        if not lot_name:
            return self.env["stock.lot"]
        lot_company = product.company_id or company or self.env.company
        Lot = self.env["stock.lot"]
        lot = Lot.search(
            [
                ("product_id", "=", product.id),
                ("name", "=ilike", lot_name),
                ("company_id", "in", [lot_company.id, False]),
            ],
            limit=1,
        )
        if lot:
            return lot
        return Lot.create(
            {
                "name": lot_name,
                "product_id": product.id,
                "company_id": lot_company.id,
            }
        )

    @api.model
    def _barcode_prepare_count_lines(self, lines, location=None):
        """Validate the scanned count lines and resolve products and lots.

        Returns a list of ``(product, lot, counted_qty)`` tuples. Raises a
        ``UserError`` the scanner surfaces to the operator when a line is not
        applicable (unknown product, missing lot on a tracked product, a serial
        counted as more than one unit). Lots are resolved/created in the
        location's company (see ``_barcode_resolve_lot``).
        """
        company = location.company_id if location else None
        prepared = []
        for line in lines or []:
            product = (
                self.env["product.product"].browse(line.get("product_id")).exists()
            )
            if not product:
                raise UserError(_("One of the scanned products no longer exists."))
            counted = float(line.get("counted_qty") or 0)
            if float_compare(counted, 0, precision_rounding=product.uom_id.rounding) < 0:
                raise UserError(
                    _(
                        "The counted quantity for %(name)s cannot be negative.",
                        name=product.display_name,
                    )
                )
            lot = self.env["stock.lot"]
            if product.tracking != "none":
                lot = self._barcode_resolve_lot(
                    product, line.get("lot_name"), company=company
                )
                if not lot:
                    raise UserError(
                        _(
                            "Product %(name)s is tracked: scan or type its "
                            "lot/serial number before counting it.",
                            name=product.display_name,
                        )
                    )
                if product.tracking == "serial" and counted not in (0, 1):
                    raise UserError(
                        _(
                            "Product %(name)s is tracked by serial number and can "
                            "only be counted one unit at a time.",
                            name=product.display_name,
                        )
                    )
            prepared.append((product, lot, counted))
        if not prepared:
            raise UserError(_("Scan at least one product to adjust before applying."))
        return prepared

    @api.model
    def action_barcode_apply_count(self, location_id, lines, reason=""):
        """Apply the operator's count as an inventory adjustment for one location.

        Builds a ``stock.inventory`` adjustment group (OCA ``stock_inventory``)
        scoped to exactly the counted products, sets the counted quantity on each
        quant -- creating the quant when the product had no stock there yet -- and
        applies it through Odoo's native ``action_apply_inventory``. The group is
        then closed, so every barcode adjustment leaves one traceable, auditable
        adjustment record with its own move lines.

        Applying inventory quantities is gated by Odoo to
        ``stock.group_stock_manager``; the operator must hold Inventory
        administrator rights (see the module's Barcode Inventory User group).
        """
        location = self.env["stock.location"].browse(location_id).exists()
        if not location:
            raise UserError(_("The selected location is no longer valid."))

        prepared = self._barcode_prepare_count_lines(lines, location=location)

        name = _("Barcode count: %(loc)s", loc=location.display_name)
        if reason:
            name = "%s (%s)" % (name, reason)
        # Same flow as the back office: create the adjustment group, begin it,
        # set the counted quantities and apply. No special mail handling -- the
        # standard flow keeps its creation chatter note and sends no email.
        group = self.create(
            {
                "name": name,
                "location_ids": [(6, 0, [location.id])],
                "product_selection": "manual",
                "product_ids": [(6, 0, [p.id for p, _lot, _qty in prepared])],
                "responsible_id": self.env.user.id,
            }
        )
        group.action_state_to_in_progress()

        Quant = self.env["stock.quant"]
        counted_quants = Quant.browse()
        for product, lot, counted in prepared:
            quant = group.stock_quant_ids.filtered(
                lambda q: q.product_id.id == product.id
                and q.location_id.id == location.id
                and q.lot_id.id == (lot.id if lot else False)
            )[:1]
            if not quant:
                # New product/lot for this location: create the quant inside the
                # group's context so stock_inventory links it to the adjustment.
                quant = Quant.with_context(
                    active_model="stock.inventory", active_id=group.id
                ).create(
                    {
                        "product_id": product.id,
                        "location_id": location.id,
                        "lot_id": lot.id if lot else False,
                    }
                )
            quant.inventory_quantity = counted
            counted_quants |= quant

        counted_quants.action_apply_inventory()
        group.action_state_to_done()

        return {
            "group_id": group.id,
            "group_name": group.name,
            "adjusted": len(prepared),
            "move_count": len(group.stock_move_ids),
        }
