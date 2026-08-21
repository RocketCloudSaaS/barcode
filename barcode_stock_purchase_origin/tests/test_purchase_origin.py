# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

import os

from lxml import etree

from odoo import fields
from odoo.tests.common import TransactionCase


class TestPurchaseOrigin(TransactionCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.vendor = cls.env["res.partner"].create({"name": "Origin Vendor"})
        cls.product = cls.env["product.product"].create(
            {"name": "Origin Product", "is_storable": True}
        )

    def _create_incoming_picking(self, origin=False):
        """Confirm a PO and return the incoming picking it generates."""
        purchase = self.env["purchase.order"].create(
            {"partner_id": self.vendor.id, "origin": origin}
        )
        self.env["purchase.order.line"].create(
            {
                "order_id": purchase.id,
                "product_id": self.product.id,
                "product_qty": 1,
                "price_unit": 10.0,
                "date_planned": fields.Datetime.now(),
            }
        )
        purchase.button_confirm()
        picking = purchase.picking_ids.filtered(
            lambda p: p.picking_type_code == "incoming"
        )
        self.assertTrue(picking)
        return purchase, picking[:1]

    def test_purchase_origin_related_to_po_origin(self):
        purchase, picking = self._create_incoming_picking("PO-ORIGIN-QA-001")
        self.assertEqual(picking.purchase_origin, "PO-ORIGIN-QA-001")
        self.assertEqual(picking.purchase_origin, purchase.origin)

    def test_purchase_origin_empty_without_po_origin(self):
        _, picking = self._create_incoming_picking(False)
        self.assertFalse(picking.purchase_origin)

    def test_purchase_origin_empty_without_purchase_order(self):
        picking = self.env["stock.picking"].create(
            {
                "picking_type_id": self.env.ref("stock.picking_type_in").id,
                "location_id": self.env.ref("stock.stock_location_suppliers").id,
                "location_dest_id": self.env.ref("stock.stock_location_stock").id,
                "partner_id": self.vendor.id,
            }
        )
        self.assertFalse(picking.purchase_id)
        self.assertFalse(picking.purchase_origin)

    def test_purchase_origin_follows_po_origin_change(self):
        purchase, picking = self._create_incoming_picking("PO-ORIGIN-OLD")
        purchase.origin = "PO-ORIGIN-NEW"
        picking.invalidate_recordset()
        self.assertEqual(picking.purchase_origin, "PO-ORIGIN-NEW")

    def test_receipt_form_arch_contains_purchase_origin(self):
        view = self.env.ref(
            "barcode_stock_purchase_origin.view_picking_form_purchase_origin"
        )
        arch = etree.fromstring(view.arch)
        field = arch.xpath("//field[@name='purchase_origin']")
        self.assertTrue(field)
        self.assertEqual(field[0].get("invisible"), "picking_type_code != 'incoming'")
        xpath_node = arch.xpath("//xpath")[0]
        self.assertEqual(xpath_node.get("expr"), "//field[@name='origin']")
        self.assertEqual(xpath_node.get("position"), "after")

    def test_group_renderer_template_wiring(self):
        template_path = os.path.join(
            os.path.dirname(__file__),
            "..",
            "static",
            "src",
            "xml",
            "barcode_templates.xml",
        )
        with open(template_path) as template_file:
            template = etree.parse(template_file)
        node = template.xpath(
            "//*[local-name()='template'][@id='picking_origin_group_renderer']"
        )[0]
        self.assertEqual(node.get("inherit_id"), "barcode_scanner.GroupRenderer")
        self.assertEqual(node.get("t-inherit-mode"), "extension")
        xpath_node = node.xpath("./*[local-name()='xpath']")[0]
        self.assertEqual(
            xpath_node.get("expr"), "//span[hasclass('ilx-kw-picking-code')]"
        )
        self.assertEqual(xpath_node.get("position"), "after")
        content = etree.tostring(node, encoding="unicode")
        self.assertIn(
            "p.picking_type_code === 'incoming' and p.purchase_origin", content
        )
