# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import Command, api, models
from odoo.exceptions import AccessError, UserError
from odoo.tools.float_utils import float_compare, float_is_zero, float_round


def _exact_ilike(value):
    """A pattern for ``=ilike`` that matches ``value`` exactly, in any case:
    ``%`` and ``_`` are wildcards there, so they are escaped."""
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


class StockInventory(models.Model):
    _inherit = "stock.inventory"

    @api.model
    def _barcode_count_location(self, location_id):
        location = self.env["stock.location"].browse(location_id).exists()
        if not location or location.usage != "internal":
            raise UserError(self.env._("The selected location is no longer valid."))
        return location

    @api.model
    def _barcode_count_domain(self, location):
        """The quants a count from the scanner covers: the stock at the location
        itself, outside packages and not owned by a partner.

        The scanner shows one line per product and lot, so it cannot tell apart
        what sits in a package or belongs to someone else; those quants are
        neither shown nor changed. Sublocations are counted on their own.
        """
        return [
            ("location_id", "=", location.id),
            ("package_id", "=", False),
            ("owner_id", "=", False),
        ]

    @api.model
    def action_barcode_location_lines(self, location_id):
        """Return the stock a location holds as count lines, one per product
        and lot, so the scanner can show it before the operator counts.

        This is a plain read: no inventory adjustment is created yet. It is only
        built when the operator applies the count (``action_barcode_apply_count``),
        so backing out of the screen leaves no adjustment in progress.
        """
        location = self._barcode_count_location(location_id)
        groups = self.env["stock.quant"]._read_group(
            self._barcode_count_domain(location),
            ["product_id", "lot_id"],
            ["quantity:sum"],
        )
        lines = []
        for product, lot, quantity in groups:
            rounding = product.uom_id.rounding
            if float_is_zero(quantity, precision_rounding=rounding):
                continue
            lines.append(
                {
                    "product_id": product.id,
                    "product_name": product.display_name,
                    "tracking": product.tracking,
                    "lot_id": lot.id,
                    "lot_name": lot.name or False,
                    "theoretical_qty": float_round(
                        quantity, precision_rounding=rounding
                    ),
                    "uom": product.uom_id.name,
                }
            )
        return {
            "location_id": location.id,
            "location_name": location.display_name,
            "lines": lines,
        }

    @api.model
    def _barcode_resolve_lot(self, product, lot_name, company):
        """Find the lot/serial a name stands for, or create it.

        The scan carries a lot *name* (from a GS1 label or typed in), never a
        database id. Lots that differ only in case are distinct lots, so the
        name is matched exactly first; in another case it is only taken when it
        names a single lot.

        A new lot is created in ``company`` -- the company of the location being
        counted -- unless the product belongs to a company. A shared product
        counted in another company's location would otherwise get a lot in the
        wrong company, and Odoo would refuse the adjustment.
        """
        lot_company = product.company_id or company
        Lot = self.env["stock.lot"]
        domain = [
            ("product_id", "=", product.id),
            ("company_id", "in", [lot_company.id, False]),
        ]
        lot = Lot.search(domain + [("name", "=", lot_name)], limit=1)
        if not lot:
            lot = Lot.search(
                domain + [("name", "=ilike", _exact_ilike(lot_name))], limit=2
            )
        if len(lot) > 1:
            raise UserError(
                self.env._(
                    "Several lots/serial numbers of %(name)s match %(lot)s: type "
                    "it exactly as it is written.",
                    lot=lot_name,
                    name=product.display_name,
                )
            )
        return lot or Lot.create(
            {
                "name": lot_name,
                "product_id": product.id,
                "company_id": lot_company.id,
            }
        )

    @api.model
    def _barcode_prepare_count_lines(self, lines, location):
        """Validate the scanned count lines and resolve their products and lots.

        Returns the counted quantity per ``(product, lot)``: lines naming the
        same lot of a product add up, as they count the same stock. Raises a
        ``UserError`` the scanner shows to the operator when a line cannot be
        applied (a product gone or not stocked, a negative quantity, a tracked
        product without its lot, a serial number counted as more than one).
        """
        company = location.company_id or self.env.company
        counts = {}
        for line in lines or []:
            product = (
                self.env["product.product"].browse(line.get("product_id")).exists()
            )
            if not product:
                raise UserError(
                    self.env._("One of the scanned products no longer exists.")
                )
            # Checked here so the operator gets this message instead of Odoo's
            # quant error when the adjustment is applied.
            if not product.is_storable:
                raise UserError(
                    self.env._(
                        "%(name)s is not a storable product: it has no stock to "
                        "count.",
                        name=product.display_name,
                    )
                )
            counted = float(line.get("counted_qty") or 0)
            rounding = product.uom_id.rounding
            if float_compare(counted, 0, precision_rounding=rounding) < 0:
                raise UserError(
                    self.env._(
                        "The counted quantity for %(name)s cannot be negative.",
                        name=product.display_name,
                    )
                )
            lot = self.env["stock.lot"]
            if product.tracking != "none":
                lot_name = (line.get("lot_name") or "").strip()
                if not lot_name:
                    raise UserError(
                        self.env._(
                            "Product %(name)s is tracked: scan or type its "
                            "lot/serial number before counting it.",
                            name=product.display_name,
                        )
                    )
                lot = self._barcode_resolve_lot(product, lot_name, company)
            counts[product, lot] = counts.get((product, lot), 0) + counted
        if not counts:
            raise UserError(
                self.env._("Scan at least one product to adjust before applying.")
            )
        for (product, lot), counted in counts.items():
            if product.tracking == "serial" and counted not in (0, 1):
                raise UserError(
                    self.env._(
                        "Serial number %(lot)s of %(name)s can only be counted "
                        "once.",
                        lot=lot.name,
                        name=product.display_name,
                    )
                )
        return counts

    @api.model
    def action_barcode_apply_count(self, location_id, lines):
        """Apply the operator's count as an inventory adjustment of one location.

        Builds a ``stock.inventory`` adjustment (OCA ``stock_inventory``) of
        exactly the counted products at that location, sets the counted
        quantity on each one's stock -- creating it when the location had none
        -- and applies it through Odoo's own ``action_apply_inventory``. The
        adjustment is then closed, so every count from the scanner leaves one
        adjustment record with its own moves.

        Applying inventory quantities is restricted by Odoo to inventory
        administrators (``stock.group_stock_manager``).
        """
        if not self.env.user.has_group("stock.group_stock_manager"):
            raise AccessError(
                self.env._("Only inventory administrators can apply a count.")
            )
        location = self._barcode_count_location(location_id)
        counts = self._barcode_prepare_count_lines(lines, location)
        products = self.env["product.product"].union(*(p for p, _lot in counts))
        group = self.create(
            {
                "name": self.env._(
                    "Barcode count: %(location)s", location=location.display_name
                ),
                "company_id": (location.company_id or self.env.company).id,
                "location_ids": [Command.set(location.ids)],
                "exclude_sublocation": True,
                "product_selection": "manual",
                "product_ids": [Command.set(products.ids)],
                "responsible_id": self.env.user.id,
            }
        )
        # Every counted product and lot needs its stock at the location before
        # the adjustment starts, so that the adjustment takes it in and the move
        # applying the count is recorded on it.
        Quant = self.env["stock.quant"]
        quants_by_key = {}
        for product, lot in counts:
            quants = Quant.search(
                self._barcode_count_domain(location)
                + [("product_id", "=", product.id), ("lot_id", "=", lot.id)]
            )
            quants_by_key[product, lot] = quants or Quant.create(
                {
                    "product_id": product.id,
                    "location_id": location.id,
                    "lot_id": lot.id,
                }
            )
        group.action_state_to_in_progress()
        counted_quants = Quant
        for key, quants in quants_by_key.items():
            # Should the stock of a product and lot be split over several quants,
            # the count goes on the first one and the others are emptied.
            quants[:1].inventory_quantity = counts[key]
            quants[1:].inventory_quantity = 0
            counted_quants |= quants
        counted_quants.action_apply_inventory()
        group.action_state_to_done()
        return {
            "group_id": group.id,
            "group_name": group.name,
            "adjusted": len(counts),
            "move_count": len(group.stock_move_ids),
        }
