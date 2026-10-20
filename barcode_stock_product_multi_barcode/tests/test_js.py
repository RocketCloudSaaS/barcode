# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import HttpCase, tagged

from odoo.addons.web.tests.test_js import qunit_error_checker


@tagged("post_install", "-at_install")
class TestBarcodeStockProductMultiBarcodeJs(HttpCase):
    """Run the module's JS unit tests (``static/tests``) in the browser.

    A Chrome/Chromium binary is required: without one the run is skipped, not
    passed.
    """

    def test_js(self):
        self.browser_js(
            "/web/tests?mod=barcode_stock_product_multi_barcode&filter=ProductMultiBarcode",
            "",
            "",
            login="admin",
            timeout=1800,
            error_checker=qunit_error_checker,
        )
