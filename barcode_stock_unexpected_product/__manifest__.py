{
    "name": "Barcode Stock Unexpected Product",
    "version": "18.0.1.1.0",
    "category": "Inventory/Logistics",
    "summary": "Allow adding unexpected products to transfers via scanner",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["antoniodavid"],
    "license": "AGPL-3",
    "depends": ["barcode_stock"],
    "data": ["views/stock_picking_type_views.xml"],
    "assets": {
        "web.assets_backend": [
            "barcode_stock_unexpected_product/static/src/js/services/barcode_scanner_state_patch.js",
            "barcode_stock_unexpected_product/static/src/js/components/picking_move_list_patch.js",
            "barcode_stock_unexpected_product/static/src/js/screens/picking_screen_patch.js",
            "barcode_stock_unexpected_product/static/src/js/screens/internal_transfer_screen_patch.js",
            "barcode_stock_unexpected_product/static/src/js/screens/product_selector_screen_patch.js",
            "barcode_stock_unexpected_product/static/src/xml/barcode_stock_unexpected_product_templates.xml",
        ],
        "web.assets_unit_tests": [
            "barcode_stock_unexpected_product/static/tests/manual_line.test.js",
        ],
    },
    "installable": True,
    "auto_install": False,
}
