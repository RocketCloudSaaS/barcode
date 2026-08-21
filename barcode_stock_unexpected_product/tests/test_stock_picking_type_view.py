# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from lxml import etree

from odoo.tests.common import TransactionCase


class TestStockPickingTypeBarcodeView(TransactionCase):
    """EXP-02/EXP-03: the "Barcode" section renders only for internal types."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        view = cls.env.ref("barcode_stock_unexpected_product.view_picking_type_form_inherit_barcode")
        cls.arch = etree.fromstring(
            cls.env["stock.picking.type"].get_view(view_id=view.id, view_type="form")[
                "arch"
            ]
        )

    def test_barcode_page_inside_notebook(self):
        # T-04 / QA-05: the page exists, is titled "Barcode" and lives inside
        # the notebook of the operation type form.
        page = self.arch.xpath("//page[@name='barcode']")
        self.assertEqual(len(page), 1)
        self.assertEqual(page[0].get("string"), "Barcode")
        self.assertEqual(page[0].getparent().tag, "notebook")

    def test_barcode_page_invisible_for_non_internal_codes(self):
        # T-03 / QA-04: for incoming/outgoing codes the page (and its field)
        # is not rendered; visibility is bound to code == 'internal'.
        page = self.arch.xpath("//page[@name='barcode']")[0]
        self.assertEqual(page.get("invisible"), "code != 'internal'")
        fields = page.xpath(".//field[@name='allow_insert_new_line']")
        self.assertEqual(len(fields), 1)
