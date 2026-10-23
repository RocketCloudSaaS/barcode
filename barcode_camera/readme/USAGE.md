Install ``barcode_camera`` next to a feature module such as ``barcode_stock``.

On the picking list, picking, internal transfer and quick info screens a camera
button appears in the bottom-right corner. Tap it, point the camera at a
barcode, and the scan is processed as if it came from a hardware scanner. The
codes read are the ones Odoo's scanner dialog reads: EAN, UPC, Code 128,
Code 39, ITF, QR, Data Matrix and the like.

The browser only gives access to the camera in a secure context (HTTPS or
localhost). Without it the camera cannot open, and hardware or manual scanning
remain available.

A feature module offers the button on its own screens by adding their route
names to the ``barcode_camera_routes`` registry, without depending on this
module:

    registry.category("barcode_camera_routes").add("my_screen", "my_screen");
