# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import HttpCase, tagged


def qunit_error_checker(message):
    """Keep the run alive on individual QUnit failures.

    Mirror of the 17.0 core checker (``addons/web/tests/test_js.py``), which is
    not importable: individual failures do not abort the run, while the final
    failure tally does.
    """
    if "QUnit test failed:" in message:
        return False
    if "tests failed." in message:
        return True
    return True


@tagged("post_install", "-at_install")
class TestBarcodeScannerJs(HttpCase):
    """Run the module's JS unit tests (``static/tests``) in the browser.

    A Chrome/Chromium binary is required: without one the run is skipped, not
    passed.
    """

    def test_js(self):
        self.browser_js(
            "/web/tests?headless&loglevel=2&preset=desktop&filter=BarcodeScanner",
            "",
            "",
            login="admin",
            timeout=120,
            error_checker=qunit_error_checker,
        )
