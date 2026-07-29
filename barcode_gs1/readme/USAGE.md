Install ``barcode_gs1`` alongside ``barcode_scanner`` (and a feature module such
as ``barcode_stock``). No configuration is needed — once installed, GS1
barcodes are parsed automatically wherever the app reads a scan.

A scanned GS1 barcode produces a parsed object such as:

    {
        type: "gs1",
        value: "<product code>",  // GTIN (AI 01), in the form products store
        gtin: "<GTIN>",           // the GTIN exactly as scanned (14 digits)
        productCodes: [...],      // every form the GTIN may be stored as
        lot: "<batch/lot>",       // AI 10 (falls back to the serial, AI 21)
        serial: "<serial>",       // AI 21
        expiry: "YYYY-MM-DD",     // AI 15 / 17
        qty: <number>,            // AI 30 / 37, or the net weight (AI 310n)
        ais: {"01": "...", "10": "...", ...},
    }

Both parenthesised barcodes — ``(01)09501101020917(10)LOT123(17)261231`` — and
raw FNC1-separated scans are supported.

GS1 always carries the GTIN zero-padded to 14 digits, while a product stores the
short code printed on the item. ``value`` therefore holds the padding-free form
Odoo stores (13 digits, as ``sanitize_ean`` produces), which is what the screens
match the product against; ``productCodes`` lists the other lengths a barcode may
have been stored as, longest-standing form first.

What the warehouse app does with it (with ``barcode_stock`` installed):

- the quantity — a count (AI 30/37) or a net weight (AI 310n) — is the quantity
  picked, instead of the single unit a plain product barcode represents;
- the lot or serial is looked up for the scanned product and preselected in the
  move wizard; on a receipt an unknown lot opens the create-lot flow with the
  name and, when ``product_expiry`` is installed, the expiry date prefilled;
- on a delivery or an internal transfer, a lot that is not available is reported
  instead of silently picking another one.
