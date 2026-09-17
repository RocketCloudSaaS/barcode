{
    "name": "Barcode Stock Picking Back to Draft",
    "version": "18.0.1.0.0",
    "category": "Inventory/Logistics",
    "summary": "Return canceled pickings to draft from Barcode",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["antoniodavid"],
    "license": "AGPL-3",
    "depends": [
        "barcode_stock",
        "stock_picking_back2draft",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_stock_picking_back2draft/static/src/xml/barcode_stock_picking_back2draft_templates.xml",
            "barcode_stock_picking_back2draft/static/src/js/picking_screen_patch.esm.js",
            "barcode_stock_picking_back2draft/static/src/js/picking_list_screen_patch.esm.js",
        ],
        "web.assets_unit_tests": [
            "barcode_stock_picking_back2draft/static/tests/**/*",
        ],
    },
    "installable": True,
    "auto_install": True,
}
