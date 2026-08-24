{
    "name": "Barcode Camera",
    "version": "18.0.1.0.0",
    "category": "Hidden",
    "summary": "Mobile camera barcode scanner (EAN13) for the Barcode suite",
    "author": "Binhex, Odoo Community Association (OCA)",
    "website": "https://github.com/RocketCloudSaaS/barcode",
    "maintainers": ["antoniodavid", "szalatyzuzanna"],
    "license": "AGPL-3",
    "depends": [
        "barcode_scanner",
    ],
    "assets": {
        "web.assets_backend": [
            "barcode_camera/static/src/scss/barcode_camera.scss",
            "barcode_camera/static/src/xml/camera_fab.xml",
            "barcode_camera/static/src/js/camera_fab.js",
        ],
    },
    "installable": True,
    "auto_install": False,
}
