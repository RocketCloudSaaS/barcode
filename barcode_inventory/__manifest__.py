{
    "name": "Barcode Inventory",
    "version": "18.0.1.0.0",
    "category": "Inventory/Inventory",
    "summary": "Inventory adjustments and stock counts by barcode, on top of "
    "stock_inventory",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["szalatyzuzanna"],
    "license": "AGPL-3",
    "depends": [
        "barcode_scanner",
        "stock_inventory",
    ],
    "data": [
        "security/security.xml",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_inventory/static/src/xml/inventory_templates.xml",
            "barcode_inventory/static/src/js/screens/inventory_location_screen.js",
            "barcode_inventory/static/src/js/screens/inventory_count_screen.js",
            "barcode_inventory/static/src/js/tiles/inventory_menu_tiles.js",
        ],
    },
    "installable": True,
    "application": False,
    "auto_install": False,
}
