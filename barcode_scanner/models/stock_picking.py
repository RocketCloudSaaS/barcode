from odoo import _, api, models
from odoo.exceptions import UserError
from odoo.tools.float_utils import float_compare


class StockPicking(models.Model):
    _inherit = "stock.picking"
    _description = "Stock Picking"

    @api.model
    def _barcode_scanner_get_internal_picking_type(
        self, origin_location, destination_location
    ):
        picking_type_model = self.env["stock.picking.type"]
        warehouse = origin_location.warehouse_id or destination_location.warehouse_id
        domain = [
            ("code", "=", "internal"),
            ("company_id", "=", self.env.company.id),
        ]
        picking_type = picking_type_model
        if warehouse:
            picking_type = picking_type_model.search(
                domain + [("warehouse_id", "=", warehouse.id)],
                limit=1,
            )
        if not picking_type:
            picking_type = picking_type_model.search(
                domain, order="warehouse_id, id", limit=1
            )
        if not picking_type:
            sequence_code = "INTLOG"
            if warehouse and warehouse.code:
                sequence_code = f"{warehouse.code}INTL"
            picking_type = picking_type_model.create(
                {
                    "name": _("Internal Transfers"),
                    "code": "internal",
                    "sequence_code": sequence_code,
                    "company_id": self.env.company.id,
                    "warehouse_id": warehouse.id if warehouse else False,
                }
            )
        return picking_type

    @api.model
    def _barcode_scanner_prepare_internal_transfer(
        self,
        origin_location_id,
        destination_location_id,
        responsible_id,
        lines,
    ):
        if not origin_location_id:
            raise UserError(_("Origin location is required."))
        if not destination_location_id:
            raise UserError(_("Destination location is required."))
        if not lines:
            raise UserError(_("Add at least one product to transfer."))

        origin_location = self.env["stock.location"].browse(origin_location_id).exists()
        destination_location = (
            self.env["stock.location"].browse(destination_location_id).exists()
        )
        if not origin_location or not destination_location:
            raise UserError(_("The selected locations are not valid anymore."))
        if origin_location == destination_location:
            raise UserError(_("Origin and destination locations must be different."))

        responsible = self.env["res.users"]
        if responsible_id:
            responsible = self.env["res.users"].browse(responsible_id).exists()
        prepared_lines = []
        for line in lines:
            product = (
                self.env["product.product"].browse(line.get("product_id")).exists()
            )
            if not product:
                raise UserError(_("One of the selected products no longer exists."))
            qty = float(line.get("qty") or 0)
            if qty <= 0:
                raise UserError(
                    _(
                        "Quantity must be greater than zero for product %(name)s.",
                        name=product.display_name,
                    )
                )

            lot = self.env["stock.lot"]
            lot_id = line.get("lot_id")
            if product.tracking != "none":
                if not lot_id:
                    raise UserError(
                        _(
                            "Lot/Serial Number is required for product %(name)s.",
                            name=product.display_name,
                        )
                    )
                lot = self.env["stock.lot"].browse(int(lot_id)).exists()
                if not lot or lot.product_id != product:
                    raise UserError(
                        _(
                            "The selected Lot/Serial Number is invalid for product "
                            "%(name)s.",
                            name=product.display_name,
                        )
                    )
                if product.tracking == "serial" and qty != 1:
                    raise UserError(
                        _(
                            "Product %(name)s is tracked by serial number and must be "
                            "transferred one unit at a time.",
                            name=product.display_name,
                        )
                    )

            prepared_lines.append(
                {
                    "product": product,
                    "qty": qty,
                    "lot": lot,
                }
            )

        return origin_location, destination_location, responsible, prepared_lines

    @api.model
    def _barcode_scanner_collect_internal_transfer_availability(
        self, origin_location, prepared_lines
    ):
        quant_model = self.env["stock.quant"]
        availability_lines = []
        all_available = True
        for line in prepared_lines:
            product = line["product"]
            lot = line["lot"]
            available_qty = quant_model._get_available_quantity(
                product,
                origin_location,
                lot_id=lot,
                strict=False,
            )
            is_available = (
                float_compare(
                    available_qty,
                    line["qty"],
                    precision_rounding=product.uom_id.rounding,
                )
                >= 0
            )
            all_available &= is_available
            availability_lines.append(
                {
                    "product_id": product.id,
                    "product_name": product.display_name,
                    "lot_id": lot.id if lot else False,
                    "lot_name": lot.name if lot else False,
                    "required_qty": line["qty"],
                    "available_qty": available_qty,
                    "available": is_available,
                }
            )
        return {
            "available": all_available,
            "lines": availability_lines,
        }

    @api.model
    def action_barcode_scanner_check_availability(
        self,
        origin_location_id,
        destination_location_id,
        lines,
        responsible_id=False,
    ):
        (
            origin_location,
            _destination_location,
            _responsible,
            prepared_lines,
        ) = self._barcode_scanner_prepare_internal_transfer(
            origin_location_id,
            destination_location_id,
            responsible_id,
            lines,
        )
        return self._barcode_scanner_collect_internal_transfer_availability(
            origin_location,
            prepared_lines,
        )

    @api.model
    def action_barcode_scanner_internal_transfer(
        self,
        origin_location_id,
        destination_location_id,
        responsible_id,
        lines,
    ):
        (
            origin_location,
            destination_location,
            responsible,
            prepared_lines,
        ) = self._barcode_scanner_prepare_internal_transfer(
            origin_location_id,
            destination_location_id,
            responsible_id,
            lines,
        )
        availability = self._barcode_scanner_collect_internal_transfer_availability(
            origin_location,
            prepared_lines,
        )
        missing_lines = [
            line for line in availability["lines"] if not line["available"]
        ]
        if missing_lines:
            details = ", ".join(
                _(
                    "%(product)s (required: %(required)s, available: %(available)s)",
                    product=line["product_name"],
                    required=line["required_qty"],
                    available=line["available_qty"],
                )
                for line in missing_lines
            )
            raise UserError(
                _(
                    "Insufficient stock in the origin location: %(details)s",
                    details=details,
                )
            )

        picking_type = self._barcode_scanner_get_internal_picking_type(
            origin_location,
            destination_location,
        )
        picking = self.create(
            {
                "picking_type_id": picking_type.id,
                "location_id": origin_location.id,
                "location_dest_id": destination_location.id,
                "move_type": "direct",
                "user_id": responsible.id if responsible else False,
                "origin": _("Barcode Scanner Internal Transfer"),
            }
        )

        move_lines_by_move = []
        move_line_model = self.env["stock.move.line"]
        move_has_qty_picked = "qty_picked" in move_line_model._fields
        for line in prepared_lines:
            product = line["product"]
            move = self.env["stock.move"].create(
                {
                    "name": product.display_name,
                    "product_id": product.id,
                    "product_uom_qty": line["qty"],
                    "product_uom": product.uom_id.id,
                    "picking_id": picking.id,
                    "location_id": origin_location.id,
                    "location_dest_id": destination_location.id,
                    "company_id": picking.company_id.id,
                }
            )
            move_lines_by_move.append((move, line))

        picking.action_confirm()

        move_line_vals_list = []
        for move, line in move_lines_by_move:
            vals = {
                "move_id": move.id,
                "picking_id": picking.id,
                "product_id": line["product"].id,
                "product_uom_id": line["product"].uom_id.id,
                "quantity": line["qty"],
                "picked": True,
                "location_id": origin_location.id,
                "location_dest_id": destination_location.id,
                "company_id": picking.company_id.id,
                "lot_id": line["lot"].id if line["lot"] else False,
                "lot_name": line["lot"].name if line["lot"] else False,
            }
            if move_has_qty_picked:
                vals["qty_picked"] = line["qty"]
            move_line_vals_list.append(vals)
        move_line_model.create(move_line_vals_list)

        picking.with_context(skip_backorder=True).button_validate()
        return {
            "picking_id": picking.id,
            "picking_name": picking.name,
            "state": picking.state,
        }
