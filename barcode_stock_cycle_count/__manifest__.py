# Copyright 2026 Binhex
# License AGPL-3.0 or later (https://www.gnu.org/licenses/agpl).
{
    "name": "Barcode Stock Cycle Count",
    "version": "18.0.1.0.0",
    "category": "Inventory/Inventory",
    "summary": "Execute stock cycle counts from Barcode",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "license": "AGPL-3",
    "depends": ["barcode_scanner", "stock_cycle_count"],
    "data": [
        "security/security.xml",
        "security/ir.model.access.csv",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_stock_cycle_count/static/src/scss/cycle_count.scss",
            "barcode_stock_cycle_count/static/src/xml/cycle_count_templates.xml",
            "barcode_stock_cycle_count/static/src/js/camera_routes.esm.js",
            "barcode_stock_cycle_count/static/src/js/screens/cycle_count_list_screen.esm.js",
            "barcode_stock_cycle_count/static/src/js/screens/cycle_count_location_screen.esm.js",
            "barcode_stock_cycle_count/static/src/js/screens/cycle_count_count_screen.esm.js",
            "barcode_stock_cycle_count/static/src/js/screens/cycle_count_done_screen.esm.js",
            "barcode_stock_cycle_count/static/src/js/tiles/cycle_count_menu_tile.esm.js",
        ],
        "web.assets_unit_tests": [
            "barcode_stock_cycle_count/static/tests/**/*",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": True,
}
