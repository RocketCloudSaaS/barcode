# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from werkzeug.urls import url_quote_plus

from odoo.tests.common import HttpCase, tagged

from odoo.addons.web.tests.test_js import qunit_error_checker


@tagged("post_install", "-at_install")
class TestBarcodeStockJs(HttpCase):
    """Run the module's JS unit tests (``static/tests``) in the browser.

    A Chrome/Chromium binary is required: without one the run is skipped, not
    passed.
    """

    def test_js(self):
        # 17.0 core pattern: select the module with ``mod`` and pass the QUnit
        # filter as ``/<url-encoded regex>/``. The transpiler wraps each test
        # file in a QUnit module named after the addon, so the full test name
        # is ``barcode_stock > BarcodeStock: <test>``; anchoring it keeps the
        # sibling BarcodeStock* suites out of this run.
        filter_param = url_quote_plus(r"^barcode_stock > BarcodeStock: .*$")
        self.browser_js(
            f"/web/tests?mod=barcode_stock&filter=/{filter_param}/",
            "",
            "",
            login="admin",
            timeout=1800,
            error_checker=qunit_error_checker,
        )
