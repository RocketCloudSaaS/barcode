from odoo.exceptions import UserError
from odoo.tests.common import TransactionCase


class TestBarcodeScannerInventory(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.stock_location = cls.env.ref("stock.stock_location_stock")
        cls.product_lot = cls.env["product.product"].create(
            {
                "name": "Lot Product",
                "is_storable": True,
                "tracking": "lot",
            }
        )

    def test_inventory_adjustment_lot_required(self):
        quant = self.env["stock.quant"].create(
            {
                "product_id": self.product_lot.id,
                "location_id": self.stock_location.id,
                "quantity": 0,
            }
        )
        quant.inventory_quantity = 5
        with self.assertRaises(UserError):
            quant.action_apply_inventory()

    def test_inventory_adjustment_non_tracked(self):
        product = self.env["product.product"].create(
            {
                "name": "Non-Tracked Product",
                "is_storable": True,
            }
        )
        self.env["stock.quant"]._update_available_quantity(
            product, self.stock_location, 10
        )
        quant = self.env["stock.quant"].search(
            [
                ("product_id", "=", product.id),
                ("location_id", "=", self.stock_location.id),
            ]
        )
        self.assertTrue(quant)
        quant.inventory_quantity = 15
        quant.action_apply_inventory()
        self.assertEqual(
            self.env["stock.quant"]._get_available_quantity(
                product, self.stock_location
            ),
            15,
        )
