# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestBarcodeGs1Hoot(HttpCase):
    """Run the GS1 parser unit tests (``static/tests``) in the browser.

    The parsing itself is JS, so that suite is where it is actually covered. A
    Chrome/Chromium binary is required: without one the run is skipped, not
    passed.
    """

    def test_js(self):
        self.browser_js(
            "/web/tests?headless&loglevel=2&preset=desktop&filter=BarcodeGs1",
            "",
            "",
            login="admin",
            success_signal="[HOOT] Test suite succeeded",
            error_checker=lambda message: "[HOOT]" not in message,
        )
