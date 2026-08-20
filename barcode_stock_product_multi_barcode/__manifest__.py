{
    "name": "Barcode Stock Product Multi Barcode",
    "version": "18.0.1.0.0",
    "category": "Inventory/Logistics",
    "summary": "Recognize alternate product barcodes in the warehouse app",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["antoniodavid", "szalatyzuzanna"],
    "license": "AGPL-3",
    "depends": [
        "barcode_stock",
        "product_multi_barcode",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_stock_product_multi_barcode/static/src/js/product_multi_barcode.js",
        ],
        "web.assets_unit_tests": [
            "barcode_stock_product_multi_barcode/static/tests/**/*",
        ],
    },
    "installable": True,
    "auto_install": True,
}
