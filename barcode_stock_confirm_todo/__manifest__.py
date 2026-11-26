{
    "name": "Barcode Stock Confirm To Do",
    "version": "18.0.1.0.0",
    "category": "Inventory/Logistics",
    "summary": "Return to the To Do tab after Confirm move in Barcode Stock",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["antoniodavid"],
    "license": "AGPL-3",
    "depends": [
        "barcode_stock",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_stock_confirm_todo/static/src/js/todo_after_confirm.esm.js",
        ],
        "web.assets_unit_tests": [
            "barcode_stock_confirm_todo/static/tests/todo_after_confirm.test.js",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
