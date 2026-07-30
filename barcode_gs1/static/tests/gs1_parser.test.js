/** @odoo-module **/

import {afterEach, describe, expect, test} from "@odoo/hoot";
import {gtinVariants, isGS1Barcode, parseGs1} from "@barcode_gs1/js/gs1_parser";
import {
    compileGs1Nomenclature,
    hasValidCheckDigit,
    setGs1Nomenclature,
} from "@barcode_gs1/js/gs1_nomenclature";
import {parseBarcode} from "@barcode_scanner/js/barcode_parser";

// FNC1 (<GS>, 0x1D), the separator a scanner sends between variable-length AIs.
const GS = String.fromCharCode(29);
// The characters GS1 allows in an alphanumeric value.
const ALPHA = '[!"%-/0-9:-?A-Z_a-z]';

// The GS1 rules Odoo ships in `barcodes_gs1_nomenclature`, trimmed to what
// these tests exercise.
const ODOO_RULES = [
    {
        name: "SSCC",
        sequence: 1,
        pattern: "(00)(\\d{18})",
        type: "package",
        gs1_content_type: "identifier",
    },
    {
        name: "GTIN",
        sequence: 2,
        pattern: "(01)(\\d{14})",
        type: "product",
        gs1_content_type: "identifier",
    },
    {
        name: "Physical location GLN",
        sequence: 6,
        pattern: "(414)(\\d{13})",
        type: "location",
        gs1_content_type: "identifier",
    },
    {
        name: "Batch or lot number",
        sequence: 10,
        pattern: `(10)(${ALPHA}{0,20})`,
        type: "lot",
        gs1_content_type: "alpha",
    },
    {
        name: "Serial number",
        sequence: 11,
        pattern: `(21)(${ALPHA}{0,20})`,
        type: "lot",
        gs1_content_type: "alpha",
    },
    {
        name: "Expiration date",
        sequence: 15,
        pattern: "(17)(\\d{6})",
        type: "expiration_date",
        gs1_content_type: "date",
    },
    {
        name: "Variable count of items",
        sequence: 20,
        pattern: "(30)(\\d{0,8})",
        type: "quantity",
        gs1_content_type: "measure",
        gs1_decimal_usage: false,
    },
    {
        name: "Net weight, kilograms",
        sequence: 21,
        pattern: "(310[0-5])(\\d{6})",
        type: "quantity",
        gs1_content_type: "measure",
        gs1_decimal_usage: true,
    },
];

function loadNomenclature(rules, separator = "(Alt029|#|\\x1D)") {
    setGs1Nomenclature(
        compileGs1Nomenclature(
            {id: 1, name: "Default GS1 Nomenclature", gs1_separator_fnc1: separator},
            rules
        )
    );
}

describe("BarcodeGs1", () => {
    // The nomenclature is cached for the whole session; each test starts from
    // the built-in identifiers unless it loads its own rules.
    afterEach(() => setGs1Nomenclature(null));

    test("a parenthesised barcode decodes the GTIN, the lot and the expiry", () => {
        expect(parseGs1("(01)09501101020917(10)LOT123(17)261231")).toMatchObject({
            type: "gs1",
            value: "9501101020917",
            gtin: "09501101020917",
            lot: "LOT123",
            expiration: "2026-12-31",
            expiry: "2026-12-31",
            qty: 1,
            errors: [],
        });
    });

    test("a raw FNC1-separated barcode decodes the same fields", () => {
        expect(parseGs1(`0109501101020917${GS}10LOT123${GS}17261231`)).toMatchObject({
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            errors: [],
        });
    });

    test("variable-length AIs end at the next AI when no separator is sent", () => {
        expect(parseGs1("010950110102091710LOT12317261231")).toMatchObject({
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            errors: [],
        });
    });

    test("a count (AI 30) is the quantity and a serial (AI 21) doubles as the lot", () => {
        expect(parseGs1("(01)09501101020917(21)SN9(30)12")).toMatchObject({
            serial: "SN9",
            lot: "SN9",
            qty: 12,
            quantity: 12,
        });
    });

    test("a net weight (AI 310n) is decoded with its decimals and used as the quantity", () => {
        expect(parseGs1("(01)09501101020917(3103)001250")).toMatchObject({
            weight: 1.25,
            qty: 1.25,
            quantity: 1.25,
        });
    });

    test("an explicit count wins over the weight", () => {
        expect(parseGs1("(01)09501101020917(3103)001250(30)4")).toMatchObject({
            weight: 1.25,
            qty: 4,
        });
    });

    test("DD=00 in a date means the last day of the month", () => {
        expect(parseGs1("(01)09501101020917(15)261200")).toMatchObject({
            expiry: "2026-12-31",
            useDate: "2026-12-31",
            errors: [],
        });
    });

    test("an expiration date (17) wins over a best-before date (15)", () => {
        expect(parseGs1("(01)09501101020917(15)261200(17)270101")).toMatchObject({
            expiry: "2027-01-01",
            useDate: "2026-12-31",
            errors: [],
        });
    });

    test("production (11) and pack (13) dates are decoded on their own fields", () => {
        expect(parseGs1("(01)09501101020917(11)260115(13)260116")).toMatchObject({
            productionDate: "2026-01-15",
            packDate: "2026-01-16",
            expiry: null,
            errors: [],
        });
    });

    test("an impossible date is reported instead of silently accepted", () => {
        const parsed = parseGs1("(01)09501101020917(17)260230");
        expect(parsed.expiry).toBe(null);
        expect(parsed.errors).toEqual(["Invalid GS1 date for AI 17"]);
    });

    test("a symbology identifier is stripped before parsing", () => {
        expect(parseGs1("]C10109501101020917")).toMatchObject({
            value: "9501101020917",
            errors: [],
        });
    });

    test("an SSCC-only label is decoded but reports the missing GTIN", () => {
        expect(parseGs1("(00)123456789012345675")).toMatchObject({
            sscc: "123456789012345675",
            value: null,
            errors: ["Missing GTIN (AI 01)"],
        });
    });

    test("a GLN identifies the physical location it was scanned for", () => {
        expect(parseGs1("(414)9501101020917")).toMatchObject({
            location: "9501101020917",
            errors: ["Missing GTIN (AI 01)"],
        });
    });

    test("a misread GTIN is refused by its check digit", () => {
        // Same barcode as above with the last digit off by one.
        expect(parseGs1("(01)09501101020916(10)LOT123")).toMatchObject({
            gtin: null,
            value: null,
            lot: "LOT123",
            errors: ["Invalid GS1 check digit for AI 01"],
        });
    });

    test("a misread SSCC or GLN is refused too", () => {
        expect(parseGs1("(00)123456789012345678")).toMatchObject({
            sscc: null,
            errors: ["Invalid GS1 check digit for AI 00", "Missing GTIN (AI 01)"],
        });
        expect(parseGs1("(414)9501101020916")).toMatchObject({
            location: null,
            errors: ["Invalid GS1 check digit for AI 414", "Missing GTIN (AI 01)"],
        });
    });

    test("the check digit is the GS1 modulo 10 of the zero-padded identifier", () => {
        expect(hasValidCheckDigit("09501101020917")).toBe(true);
        expect(hasValidCheckDigit("09501101020916")).toBe(false);
        expect(hasValidCheckDigit("123456789012345675")).toBe(true);
        expect(hasValidCheckDigit("123456789012345678")).toBe(false);
    });

    test("the GTIN resolves to the shortest form a product stores", () => {
        // GS1 pads the GTIN to 14 digits; products hold the code printed on the
        // item, which Odoo stores as an EAN13 (`sanitize_ean`).
        expect(gtinVariants("09501101020917")).toEqual([
            "9501101020917",
            "09501101020917",
        ]);
        // A UPC-A: 13 digits first, the shorter forms still offered.
        expect(gtinVariants("00012345678905")).toEqual([
            "0012345678905",
            "00012345678905",
            "012345678905",
            "12345678905",
        ]);
        // A genuine ITF-14 has no padding to strip.
        expect(gtinVariants("10012345678902")).toEqual(["10012345678902"]);
    });

    test("only GS1 data is claimed, so other codes reach the base parser", () => {
        expect(isGS1Barcode("9501101020917")).toBe(false);
        expect(parseGs1("9501101020917")).toBe(null);
        // 01... but too short to be anything but an EAN13.
        expect(parseGs1("0123456789012")).toBe(null);
        expect(isGS1Barcode("(01)09501101020917")).toBe(true);
    });

    test("the parser is registered ahead of the built-in EAN13 fallback", () => {
        expect(parseBarcode("(01)09501101020917(10)LOT123").type).toBe("gs1");
        expect(parseBarcode("9501101020917").type).toBe("ean13");
    });

    test("Odoo's own GS1 rules decode the same fields", () => {
        loadNomenclature(ODOO_RULES);
        expect(parseGs1("(01)09501101020917(10)LOT123(17)261231")).toMatchObject({
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            qty: 1,
            errors: [],
        });
        expect(parseGs1(`0109501101020917${GS}10LOT123${GS}17261231`)).toMatchObject({
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            errors: [],
        });
        expect(parseGs1("010950110102091710LOT12317261231")).toMatchObject({
            value: "9501101020917",
            lot: "LOT123",
            errors: [],
        });
        expect(parseGs1("(01)09501101020917(3103)001250")).toMatchObject({
            weight: 1.25,
            qty: 1.25,
            errors: [],
        });
        expect(parseGs1("(01)09501101020916")).toMatchObject({
            gtin: null,
            errors: ["Invalid GS1 check digit for AI 01"],
        });
    });

    test("the nomenclature's own separator characters are accepted", () => {
        // A scanner that cannot emit FNC1 is configured to send "#" instead.
        loadNomenclature(ODOO_RULES);
        expect(parseGs1("0109501101020917#10LOT123#17261231")).toMatchObject({
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            errors: [],
        });
        // A code that merely contains one of those characters is not GS1 data.
        expect(isGS1Barcode("ABC#123")).toBe(false);
        expect(parseGs1("ABC#123")).toBe(null);
    });

    test("an AI the nomenclature does not define still parses", () => {
        // Odoo ships no rule for a production date (AI 11): without the
        // built-in fallback it would cut the rest of the barcode short.
        loadNomenclature(ODOO_RULES);
        expect(parseGs1("(01)09501101020917(11)260115(10)LOT9")).toMatchObject({
            productionDate: "2026-01-15",
            lot: "LOT9",
            errors: [],
        });
        expect(parseGs1(`0109501101020917${GS}2012${GS}10LOT9`)).toMatchObject({
            lot: "LOT9",
            errors: [],
        });
    });

    test("an amount payable (AI 39xn) is decoded, with its currency", () => {
        expect(parseGs1("(01)09501101020917(3922)000150")).toMatchObject({
            price: 1.5,
            currency: null,
            errors: [],
        });
        // AI 391n and 393n open with the ISO 4217 numeric code (978 = EUR).
        expect(parseGs1("(01)09501101020917(3932)978000150")).toMatchObject({
            price: 1.5,
            currency: "978",
            errors: [],
        });
        expect(parseGs1("01095011010209173922000150")).toMatchObject({
            price: 1.5,
            errors: [],
        });
    });

    test("a rule configured as a weighted product is the quantity", () => {
        loadNomenclature(
            [
                ODOO_RULES[1],
                {
                    name: "Net weight",
                    sequence: 2,
                    pattern: "(310[0-5])(\\d{6})",
                    type: "weight",
                    gs1_content_type: "measure",
                    gs1_decimal_usage: true,
                },
                ODOO_RULES[6],
            ],
            false
        );
        expect(parseGs1("(01)09501101020917(3103)001250")).toMatchObject({
            weight: 1.25,
            qty: 1.25,
            quantity: 1.25,
            errors: [],
        });
        // A counted quantity still wins over the weight.
        expect(parseGs1("(01)09501101020917(3103)001250(30)4")).toMatchObject({
            weight: 1.25,
            qty: 4,
            errors: [],
        });
    });

    test("a rule configured in Odoo wins over the built-in identifier", () => {
        // AI 91 is company-internal: here it is configured to carry the lot.
        loadNomenclature(
            [
                ODOO_RULES[1],
                {
                    name: "Internal lot",
                    sequence: 2,
                    pattern: "(91)([A-Z0-9]{0,10})",
                    type: "lot",
                    gs1_content_type: "alpha",
                },
            ],
            false
        );
        expect(parseGs1("(01)09501101020917(91)ABC123")).toMatchObject({
            value: "9501101020917",
            lot: "ABC123",
            errors: [],
        });
    });
});
