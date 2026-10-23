# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).

from werkzeug.urls import url_quote_plus

from odoo.tests.common import HttpCase, tagged

# 17.0 wraps every test file in a QUnit module named after its addon
# (`odoo/tools/js_transpiler.py:100`), so the file's own module nests under it.
QUNIT_MODULE = "barcode_purchase > BarcodePurchase"
QUNIT_TESTS = 13

# Waits for QUnit's report: an empty page, a run still going or a run that
# never started all leave it falsy, and the browser_js call then fails.
QUNIT_READY = (
    "!!(document.getElementById('qunit-testresult-display') && "
    "/tests completed/.test("
    "document.getElementById('qunit-testresult-display').textContent))"
)

# Reads the QUnit report itself: 17.0 signs a browser_js run off when `code` is
# empty, so a suite that executed no test would pass quietly. Here the run only
# reports success when it completed every test with no failure. The success
# signal itself is the page's own (``addons/web/static/tests/qunit.js`` logs
# "test successful" once QUnit ends without failure); an error logged here
# fails the run even after that signal, through ``had_failure``.
QUNIT_RESULT = """
    (() => {
        const display = document.getElementById("qunit-testresult-display");
        const text = display ? display.textContent : "";
        const completed = parseInt(
            (text.match(/(\\d+) tests? completed/) || [])[1],
            10
        );
        const failed = parseInt((text.match(/with (\\d+) failed/) || [])[1], 10);
        const failedAssertions =
            document.querySelectorAll("#qunit-tests > li.fail").length;
        if (isNaN(completed)) {
            console.error("QUnit produced no result: " + text);
        } else if (completed !== EXPECTED_TESTS) {
            console.error(
                "QUnit ran " + completed + " tests, expected EXPECTED_TESTS: " + text
            );
        } else if (failed || failedAssertions) {
            console.error("QUnit reported failures: " + text);
        } else {
            console.log("QUnit tally verified: " + text);
        }
    })();
""".replace("EXPECTED_TESTS", str(QUNIT_TESTS))


def qunit_error_checker(message):
    """Mirror of the 17.0 core checker (``addons/web/tests/test_js.py``): a
    single failing test does not abort the run, the final tally does."""
    if "tests failed." in message:
        return True
    if "QUnit test failed:" in message:
        return False
    return True


@tagged("post_install", "-at_install")
class TestBarcodePurchaseJs(HttpCase):
    """Run the module's JS unit tests (``static/tests``) in the browser.

    A Chrome/Chromium binary is required: without one the run is skipped, not
    passed.
    """

    def test_js(self):
        filter_param = url_quote_plus(r"^%s: .*$" % QUNIT_MODULE)
        self.browser_js(
            f"/web/tests?mod=barcode_purchase&filter=/{filter_param}/",
            QUNIT_RESULT,
            QUNIT_READY,
            login="admin",
            timeout=600,
            error_checker=qunit_error_checker,
        )
