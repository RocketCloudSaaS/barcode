# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import _, api, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare


class StockScrap(models.Model):
    _inherit = "stock.scrap"

    @api.model
    def _barcode_scrap_location(self, location_id):
        location = self.env["stock.location"].browse(location_id).exists()
        if not location or location.usage != "internal":
            raise UserError(_("The selected location is no longer valid."))
        return location

    @api.model
    def action_barcode_scrap_location_stock(self, location_id):
        """Return what a location holds, per product and lot.

        The scanner shows it next to each line (how much there is to scrap) and
        offers only the lots actually stored there. Like the availability check
        of a scrap, it counts the location itself, not its children.
        """
        location = self._barcode_scrap_location(location_id)
        quants = self.env["stock.quant"].search(
            [("location_id", "=", location.id), ("quantity", ">", 0)]
        )
        return {
            "location_id": location.id,
            "location_name": location.display_name,
            "stock": [
                {
                    "product_id": quant.product_id.id,
                    "lot_id": quant.lot_id.id or False,
                    "lot_name": quant.lot_id.name or False,
                    "quantity": quant.quantity,
                }
                for quant in quants
            ],
        }

    @api.model
    def _barcode_scrap_resolve_lot(self, product, line, location):
        """Find the lot/serial a scanned line names.

        The line carries either the id of a lot picked among the location's
        stock or a lot name read from a GS1 label or typed in. A scrap only makes
        sense for a lot that exists, so an unknown name is refused instead of
        creating a new lot.
        """
        Lot = self.env["stock.lot"]
        if line.get("lot_id"):
            lot = Lot.browse(line["lot_id"]).exists()
            if lot and lot.product_id == product:
                return lot
            raise UserError(
                _(
                    "The lot/serial number chosen for %(name)s is no longer valid.",
                    name=product.display_name,
                )
            )
        lot_name = (line.get("lot_name") or "").strip()
        if not lot_name:
            return Lot
        company = product.company_id or location.company_id or self.env.company
        lot = Lot.search(
            [
                ("product_id", "=", product.id),
                ("name", "=ilike", lot_name),
                ("company_id", "in", [company.id, False]),
            ],
            limit=1,
        )
        if not lot:
            raise UserError(
                _(
                    "There is no lot/serial number %(lot)s for %(name)s.",
                    lot=lot_name,
                    name=product.display_name,
                )
            )
        return lot

    @api.model
    def _barcode_scrap_prepare_lines(self, lines, location):
        """Validate the scanned lines and resolve their products and lots.

        Returns a list of ``(product, lot, qty)`` tuples, the quantity in the
        product's unit of measure. Lines naming the same product and lot are
        merged into one, so the availability check sees the whole quantity
        asked for that stock. Raises a ``UserError`` the scanner shows to the
        operator when a line cannot be scrapped as it stands.
        """
        merged = {}
        for line in lines or []:
            product = (
                self.env["product.product"].browse(line.get("product_id")).exists()
            )
            if not product:
                raise UserError(_("One of the scanned products no longer exists."))
            qty = float(line.get("qty") or 0)
            if float_compare(qty, 0, precision_rounding=product.uom_id.rounding) <= 0:
                raise UserError(
                    _(
                        "The quantity to scrap for %(name)s must be positive.",
                        name=product.display_name,
                    )
                )
            lot = self.env["stock.lot"]
            if product.tracking != "none":
                lot = self._barcode_scrap_resolve_lot(product, line, location)
                if not lot:
                    raise UserError(
                        _(
                            "Product %(name)s is tracked: scan or choose its "
                            "lot/serial number before scrapping it.",
                            name=product.display_name,
                        )
                    )
            key = (product.id, lot.id)
            if key in merged:
                merged[key][2] += qty
            else:
                merged[key] = [product, lot, qty]
        if not merged:
            raise UserError(_("Scan at least one product to scrap."))
        for product, lot, qty in merged.values():
            if (
                product.tracking == "serial"
                and float_compare(qty, 1, precision_rounding=product.uom_id.rounding)
                != 0
            ):
                raise UserError(
                    _(
                        "Serial number %(lot)s of %(name)s can only be scrapped "
                        "once, one unit.",
                        lot=lot.name,
                        name=product.display_name,
                    )
                )
        return [tuple(entry) for entry in merged.values()]

    @api.model
    def action_barcode_scrap(
        self, location_id, lines, reason_tag_ids=None, force=False
    ):
        """Scrap the scanned lines from one location and validate them at once.

        One ``stock.scrap`` is created per line, carrying the chosen scrap
        reasons, and validated on the spot.

        When a line asks for more than the location holds, nothing is written
        unless ``force`` is set: the lines short of stock are returned so the
        scanner can ask the operator to confirm. That is the choice the back
        office offers through its insufficient-quantity wizard, and confirming
        does what that wizard does -- the scrap is done regardless.
        """
        location = self._barcode_scrap_location(location_id)
        prepared = self._barcode_scrap_prepare_lines(lines, location)
        reasons = (
            self.env["stock.scrap.reason.tag"].browse(reason_tag_ids or []).exists()
        )
        company = location.company_id or self.env.company
        vals_list = [
            {
                "product_id": product.id,
                "product_uom_id": product.uom_id.id,
                "scrap_qty": qty,
                "lot_id": lot.id,
                "location_id": location.id,
                "company_id": company.id,
                "scrap_reason_tag_ids": [(6, 0, reasons.ids)],
            }
            for product, lot, qty in prepared
        ]

        if not force:
            insufficient = []
            for vals, (product, lot, qty) in zip(vals_list, prepared, strict=True):
                # A virtual scrap runs the very same availability check that
                # validating a real one does, without writing anything.
                if self.new(vals).check_available_qty():
                    continue
                available = product.with_context(
                    location=location.id, lot_id=lot.id, strict=True
                ).qty_available
                insufficient.append(
                    {
                        "product_name": product.display_name,
                        "lot_name": lot.name or False,
                        "requested": qty,
                        "available": available,
                        "uom": product.uom_id.name,
                    }
                )
            if insufficient:
                return {"done": False, "insufficient": insufficient}

        scraps = self.create(vals_list)
        for scrap in scraps:
            if force and not scrap.check_available_qty():
                # The operator confirmed scrapping more than the location holds,
                # which is what the insufficient-quantity wizard does.
                scrap.do_scrap()
                continue
            if isinstance(scrap.action_validate(), dict):
                # The stock moved after it was checked: never scrap more than
                # there is without the operator confirming it.
                raise UserError(
                    _(
                        "The stock of %(name)s changed while scrapping. "
                        "Please try again.",
                        name=scrap.product_id.display_name,
                    )
                )
        return {
            "done": True,
            "count": len(scraps),
            "names": scraps.mapped("name"),
        }
