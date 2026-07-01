from odoo import _, models
from odoo.exceptions import UserError


class StockQuant(models.Model):
    _inherit = "stock.quant"
    _description = "Stock Quant"

    def action_apply_inventory(self):
        for quant in self:
            if quant.product_id.tracking in ("lot", "serial") and not quant.lot_id:
                raise UserError(
                    _(
                        "A lot/serial number is required for product %(product)s "
                        "before applying the inventory adjustment.",
                        product=quant.product_id.display_name,
                    )
                )
        return super().action_apply_inventory()

    def action_apply_inventory_from_scanner(self):
        if not self:
            raise UserError(_("No inventory lines to apply."))
        return self._apply_inventory()
