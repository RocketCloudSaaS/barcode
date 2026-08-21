{
    "name": "Barcode Stock Purchase Origin",
    "version": "18.0.1.0.0",
    "category": "Inventory/Logistics",
    "summary": "Show and search the purchase origin on receipts and in Barcode",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["antoniodavid", "szalatyzuzanna"],
    "license": "AGPL-3",
    "depends": [
        "barcode_stock",
        "purchase_stock",
    ],
    "data": [
        "views/stock_picking_views.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_stock_purchase_origin/static/src/scss/purchase_origin.scss",
            "barcode_stock_purchase_origin/static/src/xml/barcode_templates.xml",
            "barcode_stock_purchase_origin/static/src/js/picking_list_search.js",
            "barcode_stock_purchase_origin/static/src/js/picking_list_screen.js",
        ],
        "web.assets_unit_tests": [
            "barcode_stock_purchase_origin/static/tests/**/*",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
