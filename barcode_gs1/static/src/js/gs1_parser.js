/** @odoo-module **/

import {barcodeParsers} from "@barcode_scanner/js/registries";
import {
    compileGs1Rule,
    getGs1Nomenclature,
    hasValidCheckDigit,
} from "@barcode_gs1/js/gs1_nomenclature";

const GS1_SEPARATOR = String.fromCharCode(29); // FNC1 (<GS>, 0x1D)

// The characters GS1 allows in an alphanumeric value, as Odoo's own rules
// spell them out.
const ALPHA = '[!"%-/0-9:-?A-Z_a-z]';

/**
 * Built-in application identifiers, written as `barcode.rule` patterns so they
 * compile exactly like the ones read from the nomenclature.
 *
 * They are the fallback: the parser prefers the configured GS1 nomenclature and
 * only reaches for these while it is still loading, when no GS1 nomenclature is
 * configured, or for an identifier the nomenclature does not define (Odoo ships
 * no rule for a production date, for instance) — otherwise an unknown AI in the
 * middle of a barcode would cut the rest of the scan short.
 */
const BUILTIN_RULE_DEFS = [
    {
        name: "SSCC",
        pattern: "(00)(\\d{18})",
        type: "package",
        gs1_content_type: "identifier",
    },
    {
        name: "GTIN",
        pattern: "(01)(\\d{14})",
        type: "product",
        gs1_content_type: "identifier",
    },
    {
        name: "GTIN of contained trade items",
        pattern: "(02)(\\d{14})",
        type: "product",
        gs1_content_type: "identifier",
    },
    {
        name: "Batch or lot number",
        pattern: `(10)(${ALPHA}{0,20})`,
        type: "lot",
        gs1_content_type: "alpha",
    },
    {
        name: "Production date",
        pattern: "(11)(\\d{6})",
        type: "production_date",
        gs1_content_type: "date",
    },
    {
        name: "Pack date",
        pattern: "(13)(\\d{6})",
        type: "pack_date",
        gs1_content_type: "date",
    },
    {
        name: "Best before date",
        pattern: "(15)(\\d{6})",
        type: "use_date",
        gs1_content_type: "date",
    },
    {
        name: "Sell by date",
        pattern: "(16)(\\d{6})",
        type: "use_date",
        gs1_content_type: "date",
    },
    {
        name: "Expiration date",
        pattern: "(17)(\\d{6})",
        type: "expiration_date",
        gs1_content_type: "date",
    },
    {
        name: "Product variant",
        pattern: "(20)(\\d{2})",
        type: null,
        gs1_content_type: "alpha",
    },
    {
        name: "Serial number",
        pattern: `(21)(${ALPHA}{0,20})`,
        type: "lot",
        gs1_content_type: "alpha",
    },
    {
        name: "Consumer product variant",
        pattern: `(22)(${ALPHA}{0,20})`,
        type: null,
        gs1_content_type: "alpha",
    },
    {
        name: "Variable count of items",
        pattern: "(30)(\\d{0,8})",
        type: "quantity",
        gs1_content_type: "measure",
        gs1_decimal_usage: false,
    },
    {
        name: "Measure (weight, length, volume, ...)",
        pattern: "(3[1-6]\\d[0-5])(\\d{6})",
        type: "quantity",
        gs1_content_type: "measure",
        gs1_decimal_usage: true,
    },
    {
        name: "Count of trade items",
        pattern: "(37)(\\d{0,8})",
        type: "quantity",
        gs1_content_type: "measure",
        gs1_decimal_usage: false,
    },
    {
        name: "Ship to / Deliver to GLN",
        pattern: "(410)(\\d{13})",
        type: "location_dest",
        gs1_content_type: "identifier",
    },
    {
        name: "Ship for / Deliver for GLN",
        pattern: "(413)(\\d{13})",
        type: "location_dest",
        gs1_content_type: "identifier",
    },
    {
        name: "Physical location GLN",
        pattern: "(414)(\\d{13})",
        type: "location",
        gs1_content_type: "identifier",
    },
    {
        name: "Package type",
        pattern: `(91)(${ALPHA}{0,90})`,
        type: "package_type",
        gs1_content_type: "alpha",
    },
    {
        name: "Company internal information",
        pattern: `(9[0-3])(${ALPHA}{0,30})`,
        type: null,
        gs1_content_type: "alpha",
    },
];

const BUILTIN_RULES = BUILTIN_RULE_DEFS.map(compileGs1Rule).filter(Boolean);

/**
 * The rules to parse with: the configured GS1 nomenclature first — so an
 * administrator's rule always wins — then the built-in identifiers.
 */
function activeRules() {
    const nomenclature = getGs1Nomenclature();
    return nomenclature ? [...nomenclature.rules, ...BUILTIN_RULES] : BUILTIN_RULES;
}

/**
 * The year a 2-digit GS1 year refers to, per section 7.12 of the GS1 General
 * Specifications: the closest year within -49/+50 of the current one.
 */
function gs1Year(twoDigitYear) {
    const now = new Date();
    const difference = twoDigitYear - (now.getFullYear() % 100);
    let century = Math.floor(now.getFullYear() / 100);
    if (difference >= 51 && difference <= 99) {
        century -= 1;
    } else if (difference >= -99 && difference <= -50) {
        century += 1;
    }
    return century * 100 + twoDigitYear;
}

function toISODate(value) {
    if (!/^\d{6}$/.test(value)) {
        return null;
    }
    const year = gs1Year(parseInt(value.slice(0, 2), 10));
    const month = parseInt(value.slice(2, 4), 10);
    let day = parseInt(value.slice(4, 6), 10);
    if (month < 1 || month > 12) {
        return null;
    }
    if (day === 0) {
        // GS1 allows DD = 00, meaning the last day of the month.
        day = new Date(Date.UTC(year, month, 0)).getUTCDate();
    }
    const candidate = new Date(Date.UTC(year, month - 1, day));
    if (
        candidate.getUTCFullYear() !== year ||
        candidate.getUTCMonth() !== month - 1 ||
        candidate.getUTCDate() !== day
    ) {
        return null;
    }
    return `${year.toString().padStart(4, "0")}-${month
        .toString()
        .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/**
 * Every form of a GTIN that a product barcode may hold, in priority order.
 *
 * GS1 always carries the GTIN zero-padded to 14 digits, while products store
 * the short code printed on the item (EAN13, UPC-A, EAN8). Stripping the
 * padding is therefore part of reading a GS1 scan, not of matching a product.
 */
export function gtinVariants(gtin) {
    const digits = String(gtin || "").replace(/\D/g, "");
    if (!digits) {
        return [];
    }
    const significant = digits.replace(/^0+/, "") || "0";
    const variants = [];
    // 13 first: Odoo's `sanitize_ean` stores barcodes as EAN13, so a UPC-A is
    // held as a 13-digit code too. The other lengths cover codes stored raw.
    for (const length of [13, 14, 12, 8]) {
        if (significant.length <= length) {
            variants.push(significant.padStart(length, "0"));
        }
    }
    variants.push(digits, significant);
    return [...new Set(variants)];
}

/**
 * The GTIN form to match a product against: the EAN13-length code when the GTIN
 * fits in one, otherwise the 14-digit code as scanned (a genuine ITF-14).
 */
export function gtinToProductCode(gtin) {
    return gtinVariants(gtin)[0] || null;
}

function normalizeBarcode(barcode) {
    let value = String(barcode || "").trim();
    // Strip a leading symbology identifier such as "]C1" / "]d2".
    if (/^\][A-Za-z0-9]{2}/.test(value)) {
        value = value.slice(3);
    }
    if (value.startsWith(GS1_SEPARATOR)) {
        value = value.slice(1);
    }
    return value;
}

/**
 * The nomenclature may declare its own separator characters, since a scanner
 * that cannot emit FNC1 often sends "#" instead. This runs once the barcode is
 * known to be GS1, never before: a product code that happens to contain such a
 * character must not start looking like GS1 data because of it.
 */
function applyAlternativeSeparators(barcode) {
    const separator = getGs1Nomenclature()?.separator;
    if (!separator) {
        return barcode;
    }
    try {
        return barcode.replace(new RegExp(separator, "g"), GS1_SEPARATOR);
    } catch {
        // An invalid separator regex in the nomenclature: leave the scan as is.
        return barcode;
    }
}

/** The rule that defines `ai`, or null. */
function ruleForAi(ai, rules) {
    for (const rule of rules) {
        const match = rule.aiRegex.exec(ai);
        if (match && match[0].length === ai.length) {
            return rule;
        }
    }
    return null;
}

/**
 * Where a variable-length value ends: at the FNC1 separator, or — when the
 * scanner sends none — heuristically at the next application identifier.
 */
function findVariableEnd(barcode, start, maxLength, rules) {
    const separatorIndex = barcode.indexOf(GS1_SEPARATOR, start);
    if (separatorIndex !== -1 && separatorIndex - start <= maxLength) {
        return separatorIndex;
    }
    const maxIndex = Math.min(barcode.length, start + maxLength);
    for (let index = start + 1; index < maxIndex; index++) {
        if (matchRule(barcode, index, rules)) {
            return index;
        }
    }
    return maxIndex;
}

/** The first rule that matches at `index`, with the value it captures. */
function matchRule(barcode, index, rules) {
    const rest = barcode.slice(index);
    for (const rule of rules) {
        const aiMatch = rule.aiRegex.exec(rest);
        if (!aiMatch) {
            continue;
        }
        const ai = aiMatch[0];
        const valueStart = index + ai.length;
        let valueEnd = null;
        if (rule.fixedLength) {
            valueEnd = valueStart + rule.fixedLength;
            if (valueEnd > barcode.length) {
                continue;
            }
        } else {
            const maxLength = rule.maxLength || 20;
            valueEnd = findVariableEnd(barcode, valueStart, maxLength, rules);
        }
        const value = barcode.slice(valueStart, valueEnd);
        if (!rule.fullRegex.test(ai + value)) {
            continue;
        }
        return {rule, ai, value, end: valueEnd};
    }
    return null;
}

function parseParenthesizedGS1(barcode, rules) {
    const tokenRegex = /\((\d{2,4})\)([^()]*)/g;
    const tokens = [];
    let match = null;
    while ((match = tokenRegex.exec(barcode)) !== null) {
        const ai = match[1];
        tokens.push({rule: ruleForAi(ai, rules), ai, value: match[2].trim()});
    }
    return {tokens, rest: ""};
}

function parseRawGS1(barcode, rules) {
    const tokens = [];
    let index = 0;
    while (index < barcode.length) {
        if (barcode[index] === GS1_SEPARATOR) {
            index += 1;
            continue;
        }
        const match = matchRule(barcode, index, rules);
        if (!match) {
            break;
        }
        tokens.push({rule: match.rule, ai: match.ai, value: match.value});
        index = match.end;
    }
    return {tokens, rest: barcode.slice(index).replace(GS1_SEPARATOR, "")};
}

/**
 * Read a token's value the way its rule says to: a numeric identifier is only
 * accepted when its check digit is right, a date becomes an ISO date, and a
 * measure gets its decimal point from the last digit of the AI.
 */
function readValue(token) {
    const {rule, ai, value} = token;
    switch (rule && rule.contentType) {
        case "identifier":
            if (!hasValidCheckDigit(value)) {
                return {error: `Invalid GS1 check digit for AI ${ai}`};
            }
            return {value};
        case "date": {
            const date = toISODate(value);
            return date ? {value: date} : {error: `Invalid GS1 date for AI ${ai}`};
        }
        case "measure": {
            const decimals = rule.decimalUsage ? parseInt(ai.slice(-1), 10) : 0;
            const digits = parseInt(value, 10);
            if (!Number.isFinite(digits)) {
                return {error: `Invalid GS1 measure for AI ${ai}`};
            }
            return {value: decimals > 0 ? digits / Math.pow(10, decimals) : digits};
        }
        default:
            return {value};
    }
}

/**
 * Decode a GS1 barcode into structured fields.
 *
 * The result follows the conventions the app already reads: `value`/`product`
 * hold the product code (screens and scan handlers look the product up with
 * it), `qty`/`quantity` the quantity to handle — the counted or weighed amount
 * when the barcode carries one, a single unit otherwise — and
 * `lot`/`serial`/`expiration` the tracking data. A GS1 scan therefore flows
 * through the existing screens without them knowing anything about GS1.
 *
 * What each application identifier means comes from Odoo's GS1 nomenclature
 * when one is configured, so a rule added in Settings is honoured here too.
 */
export function parseGS1Barcode(barcode) {
    const normalized = applyAlternativeSeparators(normalizeBarcode(barcode));
    const rules = activeRules();
    const {tokens, rest} = normalized.includes("(")
        ? parseParenthesizedGS1(normalized, rules)
        : parseRawGS1(normalized, rules);

    const parsed = {
        type: "gs1",
        barcode: normalized,
        value: null,
        ais: {},
        gtin: null,
        product: null,
        productCodes: [],
        sscc: null,
        packageType: null,
        lot: null,
        serial: null,
        expiration: null,
        expiry: null,
        useDate: null,
        packDate: null,
        productionDate: null,
        location: null,
        locationDest: null,
        weight: null,
        qty: 1,
        quantity: 1,
        errors: [],
    };
    let hasCount = false;
    let hasExpiration = false;
    let rejectedGtin = false;

    for (const token of tokens) {
        parsed.ais[token.ai] = token.value;
        if (!token.rule) {
            parsed.errors.push(`Unknown GS1 application identifier ${token.ai}`);
            continue;
        }
        const read = readValue(token);
        if (read.error) {
            parsed.errors.push(read.error);
            rejectedGtin = rejectedGtin || token.rule.type === "product";
            continue;
        }
        const value = read.value;

        switch (token.rule.type) {
            case "product":
                // The trade item (AI 01) wins over the items it contains (02).
                parsed.gtin = parsed.gtin || value;
                break;
            case "package":
                parsed.sscc = value;
                break;
            case "package_type":
                parsed.packageType = value;
                break;
            case "lot":
                if (token.ai === "21") {
                    parsed.serial = value;
                    parsed.lot = parsed.lot || value;
                } else {
                    parsed.lot = value;
                }
                break;
            case "quantity":
                if (token.rule.decimalUsage) {
                    parsed.weight = value;
                    if (!hasCount) {
                        parsed.qty = value;
                        parsed.quantity = value;
                    }
                } else {
                    parsed.qty = value;
                    parsed.quantity = value;
                    hasCount = true;
                }
                break;
            case "expiration_date":
                parsed.expiration = value;
                parsed.expiry = value;
                hasExpiration = true;
                break;
            case "use_date":
                parsed.useDate = value;
                if (!hasExpiration) {
                    parsed.expiration = value;
                    parsed.expiry = value;
                }
                break;
            case "pack_date":
                parsed.packDate = value;
                break;
            case "production_date":
                parsed.productionDate = value;
                break;
            case "location":
                parsed.location = value;
                break;
            case "location_dest":
                parsed.locationDest = value;
                break;
        }
    }

    if (rest) {
        parsed.errors.push(`Unparsed GS1 data "${rest}"`);
    }
    if (parsed.gtin) {
        parsed.productCodes = gtinVariants(parsed.gtin);
        [parsed.value] = parsed.productCodes;
        parsed.product = parsed.value;
    } else if (!rejectedGtin) {
        parsed.errors.push("Missing GTIN (AI 01)");
    }

    return parsed;
}

/**
 * True if the (normalized) barcode looks like GS1 data: parenthesised AIs, an
 * FNC1 separator, or a raw string starting with the GTIN AI (01) that is longer
 * than a plain EAN13 (so genuine EAN13 codes fall through to the base parser).
 */
export function isGS1Barcode(barcode) {
    const normalized = normalizeBarcode(barcode);
    if (normalized.includes("(") || normalized.includes(GS1_SEPARATOR)) {
        return true;
    }
    return normalized.startsWith("01") && normalized.length > 13;
}

/**
 * Registered barcode parser. Only claims GS1 data; returns null otherwise so
 * the base EAN13 fallback (and any other parser) can handle the scan.
 */
export function parseGs1(barcode) {
    if (!isGS1Barcode(barcode)) {
        return null;
    }
    return parseGS1Barcode(barcode);
}

barcodeParsers.add("gs1", parseGs1, {sequence: 10});
