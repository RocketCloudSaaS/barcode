This module adds a **camera scan source** to the Barcode suite.

It registers a floating action button into the `barcode_scanner` app — through
the `barcode_app_widgets` registry, without patching the base — that opens the
device camera to scan an EAN13 barcode and feeds the result into the same event
bus the hardware scanner uses. The active screen then handles it identically,
so operators can scan without a dedicated hardware scanner.
