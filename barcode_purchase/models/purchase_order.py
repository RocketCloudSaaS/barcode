# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo import Command, api, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare


class PurchaseOrder(models.Model):
    _inherit = "purchase.order"

    @api.model
    def _barcode_purchase_prepare_lines(self, lines):
        """Validate the scanned lines and resolve their products.

        Returns a list of ``(product, qty, price_unit, lot_name)`` tuples, one per
        scanned line and in the same order: each becomes an order line of its
        own, so a lot scanned on it keeps a receipt move of its own too.
        """
        prepared = []
        for line in lines or []:
            product = (
                self.env["product.product"].browse(line.get("product_id")).exists()
            )
            if not product:
                raise UserError(
                    self.env._("One of the scanned products no longer exists.")
                )
            if not product.purchase_ok:
                raise UserError(
                    self.env._(
                        "%(name)s cannot be purchased.", name=product.display_name
                    )
                )
            qty = float(line.get("qty") or 0)
            if (
                float_compare(qty, 0, precision_rounding=product.uom_po_id.rounding)
                <= 0
            ):
                raise UserError(
                    self.env._(
                        "The quantity to order of %(name)s must be positive.",
                        name=product.display_name,
                    )
                )
            price_unit = line.get("price_unit")
            prepared.append(
                (
                    product,
                    qty,
                    None if price_unit in (None, False, "") else float(price_unit),
                    (line.get("lot_name") or "").strip() or False,
                )
            )
        if not prepared:
            raise UserError(self.env._("Add at least one product to the order."))
        return prepared

    @api.model
    def _barcode_purchase_destination(self, location_id, company):
        """The location the receipt is sent to: an internal location the
        company may use. None when the operator chose none."""
        if not location_id:
            return None
        Location = self.env["stock.location"]
        location = Location.search(
            [("id", "=", location_id), ("usage", "=", "internal")]
            + Location._check_company_domain(company),
            limit=1,
        )
        if not location:
            raise UserError(self.env._("The selected destination is not valid."))
        return location

    def _barcode_purchase_place_lots(self, lot_names):
        """Write the lots read from the labels on the receipt, each on a move
        line of its own order line's move. Returns the lots that found no free
        move line, for the operator to enter by hand."""
        unplaced = []
        for order_line, lot_name in zip(self.order_line, lot_names, strict=True):
            if not lot_name:
                continue
            move_line = order_line.move_ids.move_line_ids.filtered(
                lambda ml: not ml.lot_id and not ml.lot_name
            )[:1]
            if not move_line:
                unplaced.append(f"{order_line.product_id.display_name} ({lot_name})")
                continue
            move_line.lot_name = lot_name
        return unplaced

    @api.model
    def action_barcode_purchase(
        self,
        partner_id,
        lines,
        confirm=False,
        location_dest_id=False,
        user_id=False,
        partner_ref=False,
    ):
        """Create the purchase order the scanner drafted, and confirm it when
        asked -- all in one transaction, so a failure leaves no half-made order.

        ``lines`` are ``{product_id, qty, price_unit, lot_name}``; a missing
        ``price_unit`` lets Odoo price the line from the vendor's prices. On a
        confirmed order the receipt goes to ``location_dest_id`` when given, and
        the lots read from GS1 labels are written on it.

        A lot-tracked product without a lot does not hold the order back: a
        vendor's lot is usually unknown until the goods turn up, and it belongs
        on the receipt. Those products are returned in ``missing_lots``.
        """
        partner = self.env["res.partner"].browse(partner_id).exists()
        if not partner:
            raise UserError(self.env._("The selected vendor no longer exists."))
        prepared = self._barcode_purchase_prepare_lines(lines)
        company = self.env.company
        destination = self._barcode_purchase_destination(location_dest_id, company)
        order_lines = []
        for product, qty, price_unit, _lot_name in prepared:
            vals = {"product_id": product.id, "product_qty": qty}
            if price_unit is not None:
                vals["price_unit"] = price_unit
            order_lines.append(Command.create(vals))
        order = self.create(
            {
                "partner_id": partner.id,
                "partner_ref": partner_ref or False,
                "user_id": user_id or self.env.user.id,
                "company_id": company.id,
                "order_line": order_lines,
            }
        )
        unplaced = []
        missing = []
        if confirm:
            order.button_confirm()
            receipts = order.picking_ids.filtered(
                lambda p: p.state not in ("done", "cancel")
            )
            if destination and receipts:
                receipts.location_dest_id = destination
            unplaced = order._barcode_purchase_place_lots(
                [lot_name for _product, _qty, _price, lot_name in prepared]
            )
            missing = [
                product.display_name
                for product, _qty, _price, lot_name in prepared
                if product.tracking != "none" and not lot_name
            ]
        return {
            "id": order.id,
            "name": order.name,
            "state": order.state,
            "missing_lots": missing,
            "unplaced_lots": unplaced,
        }
