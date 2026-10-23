/** @odoo-module **/

import {gtinVariants, isGS1Barcode, parseGs1} from "@barcode_gs1/js/gs1_parser.esm";
import {
    compileGs1Nomenclature,
    getGs1Nomenclature,
    hasValidCheckDigit,
    loadGs1Nomenclature,
    setGs1Nomenclature,
} from "@barcode_gs1/js/gs1_nomenclature.esm";
import {parseBarcode} from "@barcode_scanner/js/barcode_parser.esm";

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

const KG = [13, "kg"];

function loadNomenclature(rules, separator = "(Alt029|#|\\x1D)") {
    setGs1Nomenclature(
        compileGs1Nomenclature(
            {id: 1, name: "Default GS1 Nomenclature", gs1_separator_fnc1: separator},
            rules
        )
    );
}

// The source tests asserted a subset of the parsed fields; QUnit's `deepEqual`
// compares the whole object. Project the parsed result onto exactly the keys the
// source test asserted, so no assertion is weakened or grows a key it never
// checked.
function project(source, keys) {
    const projected = {};
    for (const key of keys) {
        projected[key] = source[key];
    }
    return projected;
}

QUnit.module("BarcodeGs1", function (hooks) {
    // The nomenclature is cached for the whole session; each test starts from
    // the built-in identifiers unless it loads its own rules.
    hooks.afterEach(function () {
        setGs1Nomenclature(null);
    });

    QUnit.test(
        "a parenthesised barcode decodes the GTIN, the lot and the expiry",
        function (assert) {
            const parsed = parseGs1("(01)09501101020917(10)LOT123(17)261231");
            assert.deepEqual(
                project(parsed, [
                    "type",
                    "value",
                    "gtin",
                    "lot",
                    "expiration",
                    "expiry",
                    "qty",
                    "errors",
                ]),
                {
                    type: "gs1",
                    value: "9501101020917",
                    gtin: "09501101020917",
                    lot: "LOT123",
                    expiration: "2026-12-31",
                    expiry: "2026-12-31",
                    qty: null,
                    errors: [],
                }
            );
        }
    );

    QUnit.test(
        "a raw FNC1-separated barcode decodes the same fields",
        function (assert) {
            const parsed = parseGs1(`0109501101020917${GS}10LOT123${GS}17261231`);
            assert.deepEqual(project(parsed, ["value", "lot", "expiry", "errors"]), {
                value: "9501101020917",
                lot: "LOT123",
                expiry: "2026-12-31",
                errors: [],
            });
        }
    );

    QUnit.test(
        "a variable-length value runs to the end when it is the last element",
        function (assert) {
            // GS1 needs no separator after the last element, and recommends putting
            // the variable-length ones there: digits inside the value that look
            // like an identifier must not cut it short.
            let parsed = parseGs1("0109501101020917215830192");
            assert.deepEqual(
                project(parsed, ["serial", "lot", "count", "qty", "errors"]),
                {
                    serial: "5830192",
                    lot: "5830192",
                    count: null,
                    qty: null,
                    errors: [],
                }
            );
            parsed = parseGs1("0109501101020917214711000123");
            assert.deepEqual(project(parsed, ["serial", "productionDate", "errors"]), {
                serial: "4711000123",
                productionDate: null,
                errors: [],
            });
            parsed = parseGs1("010950110102091710A3712");
            assert.deepEqual(project(parsed, ["lot", "count", "qty", "errors"]), {
                lot: "A3712",
                count: null,
                qty: null,
                errors: [],
            });
            parsed = parseGs1("01095011010209171020241130");
            assert.deepEqual(project(parsed, ["lot", "errors"]), {
                lot: "20241130",
                errors: [],
            });
            parsed = parseGs1("01095011010209171726123110LOT123");
            assert.deepEqual(project(parsed, ["lot", "expiry", "errors"]), {
                lot: "LOT123",
                expiry: "2026-12-31",
                errors: [],
            });
        }
    );

    QUnit.test(
        "a value too long to be one ends at the next element that reads cleanly",
        function (assert) {
            // Longer than a lot may be, so a separator was dropped: the lot ends
            // where a real date starts, and the count after it is read as well.
            let parsed = parseGs1("010950110102091710LOT12345678172612313005");
            assert.deepEqual(
                project(parsed, ["lot", "expiry", "count", "qty", "errors"]),
                {
                    lot: "LOT12345678",
                    expiry: "2026-12-31",
                    count: 5,
                    qty: 5,
                    errors: [],
                }
            );
            // "17991399" looks like an expiry date but is not one (month 13): the
            // lot is not cut there.
            parsed = parseGs1("010950110102091710AB17991399CD172612313005");
            assert.deepEqual(project(parsed, ["lot", "expiry", "count", "errors"]), {
                lot: "AB17991399CD",
                expiry: "2026-12-31",
                count: 5,
                errors: [],
            });
        }
    );

    QUnit.test(
        "a long alphanumeric run without separators is read in linear time",
        function (assert) {
            // Every "10" in the run could open another lot, so finding where each
            // value ends looks ahead again and again: without remembering what
            // each position matched, this 80-character scan takes about 25 s.
            const parsed = parseGs1("]C110" + "A10".repeat(25));
            assert.strictEqual(parsed.lot, "A10A10A10A10A10A10A1");
            assert.ok(parsed.errors.includes("Missing GTIN (AI 01)"));
        }
    );

    QUnit.test(
        "a count (AI 30) is the quantity and a serial (AI 21) doubles as the lot",
        function (assert) {
            const parsed = parseGs1("(01)09501101020917(21)SN9(30)12");
            assert.deepEqual(project(parsed, ["serial", "lot", "qty", "quantity"]), {
                serial: "SN9",
                lot: "SN9",
                qty: 12,
                quantity: 12,
            });
        }
    );

    QUnit.test(
        "a net weight (AI 310n) is decoded with its decimals, not as the quantity",
        function (assert) {
            // Whether a weight is the quantity depends on the unit the product is
            // stocked in, which the parser does not know: 1.25 kg is not 1.25 units.
            const parsed = parseGs1("(01)09501101020917(3103)001250");
            assert.deepEqual(project(parsed, ["weight", "count", "qty", "quantity"]), {
                weight: 1.25,
                count: null,
                qty: null,
                quantity: null,
            });
        }
    );

    QUnit.test("a count next to the weight is the quantity", function (assert) {
        const parsed = parseGs1("(01)09501101020917(3103)001250(30)4");
        assert.deepEqual(project(parsed, ["weight", "qty"]), {
            weight: 1.25,
            qty: 4,
        });
    });

    QUnit.test(
        "the gross weight of the pack never stands for the goods",
        function (assert) {
            // Odoo ships the net weight (310n) with its unit, and no rule for the
            // gross weight (330n): the built-in identifier reads it, unitless.
            loadNomenclature([
                ODOO_RULES[1],
                {...ODOO_RULES[7], associated_uom_id: KG},
            ]);
            const net = {ai: "3103", value: 2.497, uom: {id: 13, name: "kg"}};
            const gross = {ai: "3303", value: 2.7, uom: null};
            // Net and gross, in either order: the net weight is the goods'.
            for (const label of [
                "(01)09501101020917(3103)002497(3303)002700",
                "(01)09501101020917(3303)002700(3103)002497",
            ]) {
                assert.deepEqual(project(parseGs1(label), ["weight", "weightUom"]), {
                    weight: 2.497,
                    weightUom: {id: 13, name: "kg"},
                });
            }
            assert.deepEqual(
                parseGs1("(01)09501101020917(3103)002497(3303)002700").measures,
                [net, gross]
            );
            // A gross weight alone is listed, but is no measure of the goods.
            assert.deepEqual(
                project(parseGs1("(01)09501101020917(3303)002700"), [
                    "weight",
                    "weightUom",
                    "measures",
                ]),
                {weight: null, weightUom: null, measures: [gross]}
            );
        }
    );

    QUnit.test(
        "every measure is listed, the first one with a unit stands for the goods",
        function (assert) {
            loadNomenclature([
                ODOO_RULES[1],
                {...ODOO_RULES[7], associated_uom_id: KG},
                {
                    name: "Net volume, litres",
                    sequence: 25,
                    pattern: "(315[0-5])(\\d{6})",
                    type: "quantity",
                    gs1_content_type: "measure",
                    gs1_decimal_usage: true,
                    associated_uom_id: [11, "L"],
                },
            ]);
            // A width with no rule (so no unit), a net weight and a net volume.
            const parsed = parseGs1(
                "(01)09501101020917(3122)000300(3103)002497(3152)000250"
            );
            assert.deepEqual(parsed.measures, [
                {ai: "3122", value: 3, uom: null},
                {ai: "3103", value: 2.497, uom: {id: 13, name: "kg"}},
                {ai: "3152", value: 2.5, uom: {id: 11, name: "L"}},
            ]);
            assert.deepEqual(project(parsed, ["weight", "weightUom"]), {
                weight: 2.497,
                weightUom: {id: 13, name: "kg"},
            });
        }
    );

    QUnit.test("DD=00 in a date means the last day of the month", function (assert) {
        const parsed = parseGs1("(01)09501101020917(15)261200");
        assert.deepEqual(project(parsed, ["expiry", "useDate", "errors"]), {
            expiry: "2026-12-31",
            useDate: "2026-12-31",
            errors: [],
        });
    });

    QUnit.test(
        "an expiration date (17) wins over a best-before date (15)",
        function (assert) {
            const parsed = parseGs1("(01)09501101020917(15)261200(17)270101");
            assert.deepEqual(project(parsed, ["expiry", "useDate", "errors"]), {
                expiry: "2027-01-01",
                useDate: "2026-12-31",
                errors: [],
            });
        }
    );

    QUnit.test(
        "production (11) and pack (13) dates are decoded on their own fields",
        function (assert) {
            const parsed = parseGs1("(01)09501101020917(11)260115(13)260116");
            assert.deepEqual(
                project(parsed, ["productionDate", "packDate", "expiry", "errors"]),
                {
                    productionDate: "2026-01-15",
                    packDate: "2026-01-16",
                    expiry: null,
                    errors: [],
                }
            );
        }
    );

    QUnit.test(
        "an impossible date is reported instead of silently accepted",
        function (assert) {
            const parsed = parseGs1("(01)09501101020917(17)260230");
            assert.strictEqual(parsed.expiry, null);
            assert.deepEqual(parsed.errors, ["Invalid GS1 date for AI 17"]);
        }
    );

    QUnit.test("a symbology identifier is stripped before parsing", function (assert) {
        const parsed = parseGs1("]C10109501101020917");
        assert.deepEqual(project(parsed, ["value", "errors"]), {
            value: "9501101020917",
            errors: [],
        });
    });

    QUnit.test(
        "an SSCC-only label is decoded but reports the missing GTIN",
        function (assert) {
            const parsed = parseGs1("(00)123456789012345675");
            assert.deepEqual(project(parsed, ["sscc", "value", "errors"]), {
                sscc: "123456789012345675",
                value: null,
                errors: ["Missing GTIN (AI 01)"],
            });
        }
    );

    QUnit.test(
        "a GLN identifies the physical location it was scanned for",
        function (assert) {
            const parsed = parseGs1("(414)9501101020917");
            assert.deepEqual(project(parsed, ["location", "errors"]), {
                location: "9501101020917",
                errors: ["Missing GTIN (AI 01)"],
            });
        }
    );

    QUnit.test("a misread GTIN is refused by its check digit", function (assert) {
        // Same barcode as above with the last digit off by one.
        const parsed = parseGs1("(01)09501101020916(10)LOT123");
        assert.deepEqual(project(parsed, ["gtin", "value", "lot", "errors"]), {
            gtin: null,
            value: null,
            lot: "LOT123",
            errors: ["Invalid GS1 check digit for AI 01"],
        });
    });

    QUnit.test("a misread SSCC or GLN is refused too", function (assert) {
        let parsed = parseGs1("(00)123456789012345678");
        assert.deepEqual(project(parsed, ["sscc", "errors"]), {
            sscc: null,
            errors: ["Invalid GS1 check digit for AI 00", "Missing GTIN (AI 01)"],
        });
        parsed = parseGs1("(414)9501101020916");
        assert.deepEqual(project(parsed, ["location", "errors"]), {
            location: null,
            errors: ["Invalid GS1 check digit for AI 414", "Missing GTIN (AI 01)"],
        });
    });

    QUnit.test(
        "the check digit is the GS1 modulo 10 of the zero-padded identifier",
        function (assert) {
            assert.strictEqual(hasValidCheckDigit("09501101020917"), true);
            assert.strictEqual(hasValidCheckDigit("09501101020916"), false);
            assert.strictEqual(hasValidCheckDigit("123456789012345675"), true);
            assert.strictEqual(hasValidCheckDigit("123456789012345678"), false);
        }
    );

    QUnit.test(
        "the GTIN resolves to the shortest form a product stores",
        function (assert) {
            // GS1 pads the GTIN to 14 digits; products hold the code printed on the
            // item, which Odoo stores as an EAN13 (`sanitize_ean`).
            assert.deepEqual(gtinVariants("09501101020917"), [
                "9501101020917",
                "09501101020917",
            ]);
            // A UPC-A: 13 digits first, the shorter forms still offered.
            assert.deepEqual(gtinVariants("00012345678905"), [
                "0012345678905",
                "00012345678905",
                "012345678905",
                "12345678905",
            ]);
            // A genuine ITF-14 has no padding to strip.
            assert.deepEqual(gtinVariants("10012345678902"), ["10012345678902"]);
        }
    );

    QUnit.test(
        "only GS1 data is claimed, so other codes reach the base parser",
        function (assert) {
            assert.strictEqual(isGS1Barcode("9501101020917"), false);
            assert.strictEqual(parseGs1("9501101020917"), null);
            // 01... but too short to be anything but an EAN13.
            assert.strictEqual(parseGs1("0123456789012"), null);
            assert.strictEqual(isGS1Barcode("(01)09501101020917"), true);
            // An ITF-14 with indicator digit 0 starts with "01" too, but no
            // application identifier reads out of it: it is a plain code.
            assert.strictEqual(parseGs1("01234567890128"), null);
            // A parenthesis is not an application identifier.
            assert.strictEqual(isGS1Barcode("PAL(3)-A"), false);
            assert.strictEqual(parseGs1("PAL(3)-A"), null);
        }
    );

    QUnit.test(
        "a parenthesised value its rule does not accept is reported, not read",
        function (assert) {
            let parsed = parseGs1("(01)09501101020917(30)12abc");
            assert.deepEqual(project(parsed, ["count", "qty", "errors"]), {
                count: null,
                qty: null,
                errors: ["Invalid GS1 value for AI 30"],
            });
            parsed = parseGs1("(01)09501101020917(10)ABCDEFGHIJKLMNOPQRSTUVWXYZ");
            assert.deepEqual(project(parsed, ["lot", "errors"]), {
                lot: null,
                errors: ["Invalid GS1 value for AI 10"],
            });
            // A GTIN is always 14 digits.
            parsed = parseGs1("(01)9501101020917");
            assert.deepEqual(project(parsed, ["gtin", "errors"]), {
                gtin: null,
                errors: ["Invalid GS1 value for AI 01"],
            });
        }
    );

    QUnit.test("what cannot be parsed is reported whole", function (assert) {
        const parsed = parseGs1(`0109501101020917${GS}ZZ${GS}YY${GS}XX`);
        assert.deepEqual(parsed.errors, ['Unparsed GS1 data "ZZYYXX"']);
    });

    QUnit.test(
        "a nomenclature that cannot be read leaves the built-in identifiers",
        async function (assert) {
            loadNomenclature(ODOO_RULES);
            const offline = () => Promise.reject(new Error("offline"));
            const orm = {read: offline, searchRead: offline};
            assert.strictEqual(await loadGs1Nomenclature(orm, 1), null);
            assert.strictEqual(getGs1Nomenclature(), null);
            const parsed = parseGs1("(01)09501101020917(11)260115");
            assert.deepEqual(project(parsed, ["productionDate", "errors"]), {
                productionDate: "2026-01-15",
                errors: [],
            });
        }
    );

    QUnit.test(
        "the parser is registered ahead of the built-in EAN13 fallback",
        function (assert) {
            assert.strictEqual(
                parseBarcode("(01)09501101020917(10)LOT123").type,
                "gs1"
            );
            assert.strictEqual(parseBarcode("9501101020917").type, "ean13");
        }
    );

    QUnit.test("Odoo's own GS1 rules decode the same fields", function (assert) {
        loadNomenclature(ODOO_RULES);
        let parsed = parseGs1("(01)09501101020917(10)LOT123(17)261231");
        assert.deepEqual(project(parsed, ["value", "lot", "expiry", "qty", "errors"]), {
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            qty: null,
            errors: [],
        });
        parsed = parseGs1(`0109501101020917${GS}10LOT123${GS}17261231`);
        assert.deepEqual(project(parsed, ["value", "lot", "expiry", "errors"]), {
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            errors: [],
        });
        parsed = parseGs1("01095011010209171726123110LOT123");
        assert.deepEqual(project(parsed, ["value", "lot", "expiry", "errors"]), {
            value: "9501101020917",
            lot: "LOT123",
            expiry: "2026-12-31",
            errors: [],
        });
        parsed = parseGs1("(01)09501101020917(3103)001250");
        assert.deepEqual(project(parsed, ["weight", "qty", "errors"]), {
            weight: 1.25,
            qty: null,
            errors: [],
        });
        parsed = parseGs1("(01)09501101020916");
        assert.deepEqual(project(parsed, ["gtin", "errors"]), {
            gtin: null,
            errors: ["Invalid GS1 check digit for AI 01"],
        });
    });

    QUnit.test(
        "the nomenclature's own separator characters are accepted",
        function (assert) {
            // A scanner that cannot emit FNC1 is configured to send "#" instead.
            loadNomenclature(ODOO_RULES);
            const parsed = parseGs1("0109501101020917#10LOT123#17261231");
            assert.deepEqual(project(parsed, ["value", "lot", "expiry", "errors"]), {
                value: "9501101020917",
                lot: "LOT123",
                expiry: "2026-12-31",
                errors: [],
            });
            // A code that merely contains one of those characters is not GS1 data.
            assert.strictEqual(isGS1Barcode("ABC#123"), false);
            assert.strictEqual(parseGs1("ABC#123"), null);
        }
    );

    QUnit.test(
        "an AI the nomenclature does not define still parses",
        function (assert) {
            // Odoo ships no rule for a production date (AI 11): without the
            // built-in fallback it would cut the rest of the barcode short.
            loadNomenclature(ODOO_RULES);
            let parsed = parseGs1("(01)09501101020917(11)260115(10)LOT9");
            assert.deepEqual(project(parsed, ["productionDate", "lot", "errors"]), {
                productionDate: "2026-01-15",
                lot: "LOT9",
                errors: [],
            });
            parsed = parseGs1(`0109501101020917${GS}2012${GS}10LOT9`);
            assert.deepEqual(project(parsed, ["lot", "errors"]), {
                lot: "LOT9",
                errors: [],
            });
        }
    );

    QUnit.test(
        "labels off real pallets decode the same in every form",
        function (assert) {
            // Cured guanciale, 2 pieces of 2.497 kg: (01)(3103)(10)(30)(15).
            const guanciale = {
                value: "98003948002568",
                lot: "534343",
                weight: 2.497,
                count: 2,
                qty: 2,
                expiry: "2026-10-06",
                errors: [],
            };
            const guancialeKeys = [
                "value",
                "lot",
                "weight",
                "count",
                "qty",
                "expiry",
                "errors",
            ];
            assert.deepEqual(
                project(
                    parseGs1(
                        "(01)98003948002568(3103)002497(10)534343(30)02(15)261006"
                    ),
                    guancialeKeys
                ),
                guanciale
            );
            assert.deepEqual(
                project(
                    parseGs1(
                        `0198003948002568310300249710534343${GS}3002${GS}15261006`
                    ),
                    guancialeKeys
                ),
                guanciale
            );
            // With the separators dropped there is no telling where the lot ends:
            // GS1 reads it to the end. A scanner that cannot send FNC1 is set to
            // send the nomenclature's separator instead.
            assert.deepEqual(
                project(parseGs1("0198003948002568310300249710534343300215261006"), [
                    "lot",
                    "count",
                    "expiry",
                ]),
                {lot: "534343300215261006", count: null, expiry: null}
            );

            // Hard cheese, 4.324 kg, no count: the lot closes the barcode.
            const cheese = {
                value: "98436038190867",
                lot: "L0892611",
                weight: 4.324,
                qty: null,
                expiry: "2026-09-26",
                errors: [],
            };
            const cheeseKeys = ["value", "lot", "weight", "qty", "expiry", "errors"];
            assert.deepEqual(
                project(
                    parseGs1("(01)98436038190867(15)260926(3103)004324(10)L0892611"),
                    cheeseKeys
                ),
                cheese
            );
            // "L0892611" contains "92", a company-internal identifier: breaking
            // there would truncate the lot to "L08".
            assert.deepEqual(
                project(
                    parseGs1("019843603819086715260926310300432410L0892611"),
                    cheeseKeys
                ),
                cheese
            );

            // Gorgonzola, weight only on the upper barcode.
            assert.deepEqual(
                project(parseGs1("(01)98017024009181(3102)000309"), [
                    "value",
                    "weight",
                    "qty",
                    "errors",
                ]),
                {
                    value: "98017024009181",
                    weight: 3.09,
                    qty: null,
                    errors: [],
                }
            );
            // ... and the tracking data on a second one, which carries no GTIN. A
            // GS1-128 scan announces itself with the "]C1" symbology identifier,
            // which is what makes this half a GS1 barcode rather than a plain code.
            assert.deepEqual(
                project(parseGs1("]C115260613" + "1026104005" + GS + "37002"), [
                    "lot",
                    "count",
                    "expiry",
                    "errors",
                ]),
                {
                    lot: "26104005",
                    count: 2,
                    expiry: "2026-06-13",
                    errors: ["Missing GTIN (AI 01)"],
                }
            );
            assert.strictEqual(isGS1Barcode("]C1152606131026104005"), true);
        }
    );

    QUnit.test(
        "an amount payable (AI 39xn) is decoded, with its currency",
        function (assert) {
            let parsed = parseGs1("(01)09501101020917(3922)000150");
            assert.deepEqual(project(parsed, ["price", "currency", "errors"]), {
                price: 1.5,
                currency: null,
                errors: [],
            });
            // AI 391n and 393n open with the ISO 4217 numeric code (978 = EUR).
            parsed = parseGs1("(01)09501101020917(3932)978000150");
            assert.deepEqual(project(parsed, ["price", "currency", "errors"]), {
                price: 1.5,
                currency: "978",
                errors: [],
            });
            parsed = parseGs1("01095011010209173922000150");
            assert.deepEqual(project(parsed, ["price", "errors"]), {
                price: 1.5,
                errors: [],
            });
        }
    );

    QUnit.test(
        "a rule configured as a weighted product is a measure, not the quantity",
        function (assert) {
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
            let parsed = parseGs1("(01)09501101020917(3103)001250");
            assert.deepEqual(project(parsed, ["weight", "qty", "quantity", "errors"]), {
                weight: 1.25,
                qty: null,
                quantity: null,
                errors: [],
            });
            // A counted quantity is the quantity.
            parsed = parseGs1("(01)09501101020917(3103)001250(30)4");
            assert.deepEqual(project(parsed, ["weight", "qty", "errors"]), {
                weight: 1.25,
                qty: 4,
                errors: [],
            });
        }
    );

    QUnit.test(
        "a rule configured in Odoo wins over the built-in identifier",
        function (assert) {
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
            const parsed = parseGs1("(01)09501101020917(91)ABC123");
            assert.deepEqual(project(parsed, ["value", "lot", "errors"]), {
                value: "9501101020917",
                lot: "ABC123",
                errors: [],
            });
        }
    );

    QUnit.test(
        "an AI 02 contained GTIN does not replace the trade item GTIN",
        function (assert) {
            const parsed = parseGs1("(01)09501101020917(02)09501101020924");
            assert.deepEqual(project(parsed, ["gtin", "value", "errors"]), {
                gtin: "09501101020917",
                value: "9501101020917",
                errors: [],
            });
            assert.deepEqual(parsed.ais, {
                "01": "09501101020917",
                "02": "09501101020924",
            });
        }
    );

    QUnit.test(
        "a sell-by date (16) populates the use date, and expiry only when no 17 is present",
        function (assert) {
            let parsed = parseGs1("(01)09501101020917(15)261200(16)261231");
            assert.deepEqual(project(parsed, ["useDate", "expiry", "errors"]), {
                useDate: "2026-12-31",
                expiry: "2026-12-31",
                errors: [],
            });
            parsed = parseGs1("(01)09501101020917(16)261231(17)270101");
            assert.deepEqual(project(parsed, ["useDate", "expiry", "errors"]), {
                useDate: "2026-12-31",
                expiry: "2027-01-01",
                errors: [],
            });
        }
    );

    QUnit.test(
        "destination GLNs (410/413) map to the destination location, 414 to the location",
        function (assert) {
            let parsed = parseGs1("(410)9501101020917");
            assert.deepEqual(project(parsed, ["locationDest", "location", "errors"]), {
                locationDest: "9501101020917",
                location: null,
                errors: ["Missing GTIN (AI 01)"],
            });
            parsed = parseGs1("(413)9501101020917");
            assert.deepEqual(project(parsed, ["locationDest", "location", "errors"]), {
                locationDest: "9501101020917",
                location: null,
                errors: ["Missing GTIN (AI 01)"],
            });
            parsed = parseGs1("(414)9501101020917");
            assert.deepEqual(project(parsed, ["location", "locationDest", "errors"]), {
                location: "9501101020917",
                locationDest: null,
                errors: ["Missing GTIN (AI 01)"],
            });
        }
    );

    QUnit.test(
        "every GS1 symbology identifier is stripped and claimed as GS1",
        function (assert) {
            for (const identifier of ["]C1", "]e0", "]d2", "]Q3", "]J1"]) {
                const barcode = `${identifier}0109501101020917`;
                const parsed = parseGs1(barcode);
                assert.deepEqual(project(parsed, ["value", "errors"]), {
                    value: "9501101020917",
                    errors: [],
                });
                assert.strictEqual(isGS1Barcode(barcode), true);
            }
        }
    );
});
