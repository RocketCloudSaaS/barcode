This module adds **GS1 barcode parsing** to the Barcode suite.

It registers a GS1 parser into the `barcode_scanner` base — through the
`barcode_parsers` registry, without patching the base. Scanned GS1-128
barcodes, whether written with parenthesised application identifiers
(`(01)...(10)...`) or as raw FNC1-separated data, are decoded into structured
fields: GTIN (AI 01), batch/lot (10), serial (21), production/best-before/expiry
dates (11/13/15/16/17), count (30/37), net weight and other measures
(310n–360n, with the variable weight used as the quantity) and SSCC (00).

Every screen then receives the parsed data alongside the raw scan, so a single
GS1 scan can identify the product and fill lot, expiry and quantity at once.
Non-GS1 codes fall through to the base EAN13 parser, so the module is safe to
install next to the rest of the suite.
