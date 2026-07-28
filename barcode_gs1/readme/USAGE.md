Install ``barcode_gs1`` alongside ``barcode_scanner`` (and a feature module such
as ``barcode_stock``). No configuration is needed — once installed, GS1
barcodes are parsed automatically wherever the app reads a scan.

A scanned GS1 barcode produces a parsed object such as:

    {
        type: "gs1",
        value: "<GTIN>",       // product code (AI 01)
        gtin: "<GTIN>",
        lot: "<batch/lot>",    // AI 10 (falls back to the serial, AI 21)
        serial: "<serial>",    // AI 21
        expiry: "YYYY-MM-DD",  // AI 15 / 17
        qty: <number>,         // AI 30 / 37
        ais: {"01": "...", "10": "...", ...},
    }

Both parenthesised barcodes — ``(01)09501101020917(10)LOT123(17)261231`` — and
raw FNC1-separated scans are supported.
