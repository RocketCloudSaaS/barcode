Install ``barcode_camera`` alongside a scanning feature module (for example
``barcode_stock``).

On the picking, picking list, internal transfer and quick-info screens a
floating camera button appears in the bottom-right corner. Tap it to open the
device camera, point it at an EAN13 barcode, and the scan is processed exactly
as if it came from a hardware scanner.

Camera access requires a secure context (HTTPS or localhost); otherwise the
browser blocks it and hardware/manual scanning remain available.
