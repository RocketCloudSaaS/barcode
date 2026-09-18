# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from odoo.tests.common import HttpCase, tagged


@tagged("post_install", "-at_install")
class TestBarcodeStockCycleCountJs(HttpCase):
    """Run the cycle-count HOOT suite in the browser."""

    def test_js(self):
        self.browser_js(
            "/web/tests?headless&loglevel=2&preset=desktop&filter=BarcodeStockCycleCount",
            "",
            "",
            login="admin",
            success_signal="[HOOT] Test suite succeeded",
            error_checker=lambda message: "[HOOT]" not in message,
        )
