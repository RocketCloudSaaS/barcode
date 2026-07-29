/** @odoo-module **/

import {describe, expect, test} from "@odoo/hoot";
import {gtinVariants, isGS1Barcode, parseGs1} from "@barcode_gs1/js/gs1_parser";
import {parseBarcode} from "@barcode_scanner/js/barcode_parser";

// FNC1 (<GS>, 0x1D), the separator a scanner sends between variable-length AIs.
const GS = String.fromCharCode(29);

describe("BarcodeGs1", () => {
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
        expect(parseGs1("(00)123456789012345678")).toMatchObject({
            sscc: "123456789012345678",
            value: null,
            errors: ["Missing GTIN (AI 01)"],
        });
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
});
