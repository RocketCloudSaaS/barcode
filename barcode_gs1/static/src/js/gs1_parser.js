/** @odoo-module **/

import {barcodeParsers} from "@barcode_scanner/js/registries";

// Fixed-length GS1 Application Identifiers -> value length (the AI value, not
// counting the AI itself).
const FIXED_LENGTH_AIS = {
    "00": 18, // SSCC (logistic unit)
    "01": 14, // GTIN
    "02": 14, // GTIN of contained trade items
    11: 6, // Production date (YYMMDD)
    13: 6, // Packaging date
    15: 6, // Best-before date
    16: 6, // Sell-by date
    17: 6, // Expiration date
    20: 2, // Product variant
};

// Variable-length AIs -> maximum value length (ended by FNC1 or the next AI).
const VARIABLE_LENGTH_AIS = {
    10: 20, // Batch / lot number
    21: 20, // Serial number
    22: 20, // Consumer product variant
    30: 8, // Variable count
    37: 8, // Count of trade items
    90: 30, // Internal
    91: 30,
    92: 30,
    93: 30,
};

const GS1_SEPARATOR = String.fromCharCode(29); // FNC1 (<GS>, 0x1D)
const DATE_AIS = new Set(["11", "13", "15", "16", "17"]);
const EXPIRY_AIS = new Set(["15", "16", "17"]);

// Measure AIs (net weight, length, volume, ...) are 4 digits in the 31xx-36xx
// range, carry a 6-digit value, and the last AI digit is the decimal count.
function measureDecimals(ai) {
    return /^3[1-6]\d\d$/.test(ai) ? parseInt(ai[3], 10) : null;
}

function toISODate(value) {
    if (!/^\d{6}$/.test(value)) {
        return null;
    }
    const year = 2000 + parseInt(value.slice(0, 2), 10);
    const month = parseInt(value.slice(2, 4), 10);
    let day = parseInt(value.slice(4, 6), 10);
    if (month < 1 || month > 12) {
        return null;
    }
    if (day === 0) {
        // GS1 allows DD = 00, meaning the last day of the month.
        day = new Date(year, month, 0).getDate();
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

function normalizeBarcode(barcode) {
    const value = String(barcode || "").trim();
    // Strip a leading symbology identifier such as "]C1" / "]d2".
    if (/^\][A-Za-z0-9]{2}/.test(value)) {
        return value.slice(3);
    }
    return value;
}

// Identify the AI starting at `index`; returns {ai, valueLength} or null.
// valueLength is null for variable-length AIs.
function matchAi(barcode, index) {
    const ai4 = barcode.slice(index, index + 4);
    if (measureDecimals(ai4) !== null) {
        return {ai: ai4, valueLength: 6};
    }
    const ai2 = barcode.slice(index, index + 2);
    if (ai2 in FIXED_LENGTH_AIS) {
        return {ai: ai2, valueLength: FIXED_LENGTH_AIS[ai2]};
    }
    if (ai2 in VARIABLE_LENGTH_AIS) {
        return {ai: ai2, valueLength: null};
    }
    return null;
}

function findVariableBoundary(barcode, start, maxLength) {
    const separatorIndex = barcode.indexOf(GS1_SEPARATOR, start);
    if (separatorIndex !== -1 && separatorIndex - start <= maxLength) {
        return separatorIndex;
    }
    // No separator: heuristically stop at the next recognised AI.
    const maxIndex = Math.min(barcode.length, start + maxLength);
    for (let index = start + 1; index < maxIndex; index++) {
        const match = matchAi(barcode, index);
        if (!match) {
            continue;
        }
        if (
            match.valueLength !== null &&
            index + match.ai.length + match.valueLength > barcode.length
        ) {
            continue;
        }
        return index;
    }
    return maxIndex;
}

function parseParenthesizedGS1(barcode) {
    const tokenRegex = /\((\d{2,4})\)([^()]+)/g;
    const tokens = [];
    let match = null;
    while ((match = tokenRegex.exec(barcode)) !== null) {
        tokens.push({ai: match[1], value: match[2].trim()});
    }
    return tokens;
}

function parseRawGS1(barcode) {
    const tokens = [];
    let index = 0;
    while (index < barcode.length) {
        if (barcode[index] === GS1_SEPARATOR) {
            index += 1;
            continue;
        }
        const match = matchAi(barcode, index);
        if (!match) {
            break;
        }
        const valueStart = index + match.ai.length;
        let valueEnd;
        if (match.valueLength !== null) {
            valueEnd = valueStart + match.valueLength;
        } else {
            valueEnd = findVariableBoundary(barcode, valueStart, 20);
        }
        tokens.push({ai: match.ai, value: barcode.slice(valueStart, valueEnd)});
        index = valueEnd;
    }
    return tokens;
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
 * Decode a GS1 barcode into structured fields. `value` mirrors the GTIN so the
 * result stays compatible with the base parser convention (screens/handlers
 * read `parsed.value` for the product code).
 */
export function parseGS1Barcode(barcode) {
    const normalized = normalizeBarcode(barcode);
    const tokens = normalized.includes("(")
        ? parseParenthesizedGS1(normalized)
        : parseRawGS1(normalized);

    const parsed = {
        type: "gs1",
        barcode: normalized,
        value: null,
        ais: {},
        gtin: null,
        product: null,
        sscc: null,
        lot: null,
        serial: null,
        expiration: null,
        expiry: null,
        weight: null,
        qty: 1,
        quantity: 1,
        errors: [],
    };
    let hasCount = false;

    for (const token of tokens) {
        parsed.ais[token.ai] = token.value;

        const decimals = measureDecimals(token.ai);
        if (decimals !== null) {
            const raw = parseInt(token.value, 10);
            if (Number.isFinite(raw)) {
                parsed.weight = raw / Math.pow(10, decimals);
            } else {
                parsed.errors.push(`Invalid GS1 measure for AI ${token.ai}`);
            }
            continue;
        }

        if (DATE_AIS.has(token.ai)) {
            const date = toISODate(token.value);
            if (!date) {
                parsed.errors.push(`Invalid GS1 date for AI ${token.ai}`);
            } else if (EXPIRY_AIS.has(token.ai)) {
                parsed.expiration = date;
                parsed.expiry = date;
            }
            continue;
        }

        switch (token.ai) {
            case "00":
                parsed.sscc = token.value;
                break;
            case "01":
            case "02":
                parsed.gtin = token.value;
                parsed.product = token.value;
                parsed.value = token.value;
                break;
            case "10":
                parsed.lot = token.value;
                break;
            case "21":
                parsed.serial = token.value;
                if (!parsed.lot) {
                    parsed.lot = token.value;
                }
                break;
            case "30":
            case "37": {
                const quantity = parseFloat(token.value);
                if (Number.isFinite(quantity)) {
                    parsed.qty = quantity;
                    parsed.quantity = quantity;
                    hasCount = true;
                } else {
                    parsed.errors.push(`Invalid GS1 quantity for AI ${token.ai}`);
                }
                break;
            }
        }
    }

    // For variable-weight items with no explicit count, the net weight is the
    // quantity to handle.
    if (parsed.weight !== null && !hasCount) {
        parsed.qty = parsed.weight;
        parsed.quantity = parsed.weight;
    }

    if (!parsed.product) {
        parsed.errors.push("Missing GTIN (AI 01)");
    }

    return parsed;
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
