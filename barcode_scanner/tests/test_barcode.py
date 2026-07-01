from odoo.tests.common import TransactionCase


class TestBarcodeScannerEAN13(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.nomenclature = cls.env["barcode.nomenclature"].create(
            {
                "name": "Test EAN13 Nomenclature",
            }
        )
        cls.rule = cls.env["barcode.rule"].create(
            {
                "name": "EAN13",
                "barcode_nomenclature_id": cls.nomenclature.id,
                "type": "alias",
                "encoding": "ean13",
                "pattern": "..............",
                "alias": "product.product",
            }
        )
        cls.product = cls.env["product.product"].create(
            {
                "name": "Test EAN13 Product",
                "is_storable": True,
                "barcode": "5901234123457",
            }
        )

    def test_ean13_decode_returns_product(self):
        result = self.env["barcode.nomenclature"].search(
            [("id", "=", self.nomenclature.id)]
        ).parse_barcode("5901234123457")
        self.assertTrue(result)
        self.assertEqual(result["alias"], "product.product")

    def test_ean13_resolve_product(self):
        product = self.env["product.product"].search(
            [("barcode", "=", "5901234123457")]
        )
        self.assertTrue(product)
        self.assertEqual(product.id, self.product.id)

    def test_ean13_invalid_barcode_returns_no_result(self):
        product = self.env["product.product"].search(
            [("barcode", "=", "0000000000000")]
        )
        self.assertFalse(product)

    def test_ean13_barcode_checksum_validation(self):
        barcode = "5901234123457"
        digits = [int(d) for d in barcode[:-1]]
        check = int(barcode[-1])
        total = sum(
            d * 3 if i % 2 == 0 else d
            for i, d in enumerate(digits)
        )
        expected_check = (10 - (total % 10)) % 10
        self.assertEqual(check, expected_check)
