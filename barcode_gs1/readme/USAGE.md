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
        expiry: "YYYY-MM-DD",     // AI 17, or 15/16 when no 17 is present
        useDate: "YYYY-MM-DD",    // AI 15 / 16 (best before, sell by)
        packDate: "YYYY-MM-DD",   // AI 13
        productionDate: "...",    // AI 11
        qty: <number>,            // AI 30 / 37, or the net weight (AI 310n)
        count: <number>,          // AI 30 / 37 (pieces), kept next to the weight
        weight: <number>,         // AI 310n–360n
        weightUom: {id, name},    // the unit that measure is in, per the rule
        price: <number>,          // AI 390n–393n (amount payable)
        currency: "<ISO 4217>",   // the numeric code AI 391n / 393n carries
        sscc: "<SSCC>",           // AI 00 (logistic unit)
        location: "<GLN>",        // AI 414
        locationDest: "<GLN>",    // AI 410 / 413
        ais: {"01": "...", "10": "...", ...},
        errors: [...],            // what could not be read, e.g. a bad check digit
    }

Both parenthesised barcodes — ``(01)09501101020917(10)LOT123(17)261231`` — and
raw FNC1-separated scans are supported.

GS1 always carries the GTIN zero-padded to 14 digits, while a product stores the
short code printed on the item. ``value`` therefore holds the padding-free form
Odoo stores (13 digits, as ``sanitize_ean`` produces), which is what the screens
match the product against; ``productCodes`` lists the other lengths a barcode may
have been stored as, longest-standing form first.

## The rules come from Odoo

The application identifiers are read from a GS1 ``barcode.nomenclature``: the
one set on the company when it is a GS1 nomenclature, otherwise the first GS1
nomenclature found (the *Default GS1 Nomenclature* Odoo ships). Its GS1-128
rules are fetched once, when the barcode app opens.

So to teach the scanner a new application identifier, add a rule under
*Inventory → Configuration → Barcode Nomenclatures* — no code change. A rule
whose *Type* is one the app understands (product, lot, quantity, weighted
product, priced product, package, package type, expiration date, best before
date, pack date, location, destination location) lands on the matching field
above; the value of any other rule is still available in ``ais``.

Identifiers the nomenclature does not define keep working through the ones built
into the module, and if the nomenclature cannot be read at all the module falls
back to them entirely.

## Scanners that drop the separator

GS1 ends a variable-length value with FNC1, and a keyboard-wedge scanner often
sends nothing in its place. Odoo has a field for exactly that — *FNC1 Separator*
on the nomenclature — so configure the scanner to send one of those characters
(``#`` out of the box) and the scan is read as printed.

With no separator at all the reading is a guess, and the parser makes an
educated one: it ends a variable-length value only at a specific numeric
identifier, never inside an alphanumeric one and never at a catch-all range.
That reads a real pallet label — ``(01)…(3103)002497(10)534343(30)02(15)261006``
— exactly as printed, where a naive scan cuts the lot number in half and turns
the rest into a quantity. Two alphanumeric values in a row with nothing between
them stay ambiguous, which is why GS1 does not allow it.

## Misreads are refused

A GTIN, SSCC or GLN is only accepted when its check digit (GS1 modulo 10)
matches. A misread identifier is left empty and reported in ``errors`` instead
of resolving to the wrong product or pallet.

## In the warehouse app

What the warehouse app does with it (with ``barcode_stock`` installed):

- the quantity picked comes from the barcode instead of being a single unit: the
  piece count (AI 30/37), or the measure — a net weight, say — when the product
  is stocked in that kind of unit. Weighing that choice needs the unit the
  product is stocked in, so it lives in ``barcode_gs1_stock``, which installs
  itself as soon as both modules are there;
- the lot or serial is looked up for the scanned product and preselected in the
  move wizard; on a receipt an unknown lot opens the create-lot flow with the
  name and, when ``product_expiry`` is installed, the expiry date prefilled;
- on a delivery or an internal transfer, a lot that is not available is reported
  instead of silently picking another one.
