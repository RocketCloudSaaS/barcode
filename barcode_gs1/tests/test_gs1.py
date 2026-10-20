# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from werkzeug.urls import url_quote_plus

from odoo.tests.common import HttpCase, TransactionCase, new_test_user, tagged

from odoo.addons.web.tests.test_js import qunit_error_checker


# ``new_test_user`` must see every module that extends ``res.users`` (a partial
# registry during module load omits required columns such as ``web_responsive``'s),
# so this class runs once all modules are loaded, like Odoo's own profiler tests.
@tagged("post_install", "-at_install")
class TestBarcodeGs1UserAccess(TransactionCase):
    """The app reads the GS1 rules as whoever opens it.

    The Scanner menu is open to every internal user, so a plain employee must be
    able to read everything ``gs1_nomenclature.esm.js`` loads, with the same
    fields it asks for.
    """

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.employee = new_test_user(
            cls.env, login="barcode_gs1_employee", groups="base.group_user"
        )

    def test_employee_reads_the_gs1_nomenclature_and_rules(self):
        env = self.env(user=self.employee)
        company = env.company.read(["nomenclature_id"])
        self.assertIn("nomenclature_id", company[0])
        nomenclatures = env["barcode.nomenclature"].search_read(
            [("is_gs1_nomenclature", "=", True)],
            ["name", "is_gs1_nomenclature", "gs1_separator_fnc1"],
            limit=1,
        )
        self.assertTrue(nomenclatures)
        rules = env["barcode.rule"].search_read(
            [
                ("barcode_nomenclature_id", "=", nomenclatures[0]["id"]),
                ("encoding", "=", "gs1-128"),
            ],
            [
                "name",
                "sequence",
                "type",
                "pattern",
                "gs1_content_type",
                "gs1_decimal_usage",
                "associated_uom_id",
            ],
            order="sequence",
        )
        self.assertTrue(rules)
        # The unit a measure rule is expressed in is read through the rule.
        self.assertTrue(any(rule["associated_uom_id"] for rule in rules))


@tagged("post_install", "-at_install")
class TestBarcodeGs1Js(HttpCase):
    """Run the GS1 parser unit tests (``static/tests``) in the browser.

    The parsing itself is JS, so that suite is where it is actually covered. A
    Chrome/Chromium binary is required: without one the run is skipped, not
    passed.
    """

    def test_js(self):
        # 17.0 core pattern: select the module with ``mod`` and pass the QUnit
        # filter as ``/<url-encoded regex>/``. Odoo wraps each test file in a
        # QUnit module named after the addon, hence the ``barcode_gs1 > ``
        # prefix in the full test name.
        filter_param = url_quote_plus(r"^barcode_gs1 > BarcodeGs1: .*$")
        self.browser_js(
            f"/web/tests?mod=barcode_gs1&filter=/{filter_param}/",
            "",
            "",
            login="admin",
            timeout=120,
            error_checker=qunit_error_checker,
        )
