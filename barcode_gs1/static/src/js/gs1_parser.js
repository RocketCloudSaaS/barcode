/** @odoo-module **/

import {barcodeParsers} from "@barcode_scanner/js/registries";

// GS1 Application Identifiers we understand, with their value lengths.
const FIXED_LENGTH_AIS = {
    "01": 14, // GTIN
    15: 6, // Best-before date (YYMMDD)
    17: 6, // Expiration date (YYMMDD)
};

const VARIABLE_LENGTH_AIS = {
    10: 20, // Batch / lot number
    21: 20, // Serial number
    30: 8, // Variable count
    37: 8, // Count of trade items
};

const GS1_SEPARATOR = String.fromCharCode(29); // FNC1 (<GS>, 0x1D)

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

function findVariableBoundary(barcode, start, maxLength) {
    // A variable-length value ends at the FNC1 separator, or heuristically at
    // the next recognised AI when no separator is present.
    const separatorIndex = barcode.indexOf(GS1_SEPARATOR, start);
    if (separatorIndex !== -1 && separatorIndex - start <= maxLength) {
        return separatorIndex;
    }
    const maxIndex = Math.min(barcode.length, start + maxLength);
    for (let index = start + 1; index < maxIndex; index++) {
        const ai = barcode.slice(index, index + 2);
        if (!(ai in FIXED_LENGTH_AIS) && !(ai in VARIABLE_LENGTH_AIS)) {
            continue;
        }
        if (
            ai in FIXED_LENGTH_AIS &&
            index + 2 + FIXED_LENGTH_AIS[ai] > barcode.length
        ) {
            continue;
        }
        return index;
    }
    return maxIndex;
}

function parseParenthesizedGS1(barcode) {
    const tokenRegex = /\((\d{2})\)([^()]+)/g;
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
        const ai = barcode.slice(index, index + 2);
        if (ai in FIXED_LENGTH_AIS) {
            const valueStart = index + 2;
            const valueEnd = valueStart + FIXED_LENGTH_AIS[ai];
            tokens.push({ai, value: barcode.slice(valueStart, valueEnd)});
            index = valueEnd;
            continue;
        }
        if (ai in VARIABLE_LENGTH_AIS) {
            const valueStart = index + 2;
            const valueEnd = findVariableBoundary(
                barcode,
                valueStart,
                VARIABLE_LENGTH_AIS[ai]
            );
            tokens.push({ai, value: barcode.slice(valueStart, valueEnd)});
            index = valueEnd;
            continue;
        }
        break;
    }
    return tokens;
}

/**
 * True if the (normalized) barcode looks like GS1 data: it starts with the GTIN
 * AI "01" or contains parenthesised AIs.
 */
export function isGS1Barcode(barcode) {
    const normalized = normalizeBarcode(barcode);
    if (normalized.includes("(") || normalized.includes(GS1_SEPARATOR)) {
        return true;
    }
    // Raw GS1 begins with the GTIN AI (01); require it to be longer than a
    // plain EAN13 so genuine EAN13 codes starting with "01" fall through to the
    // base EAN13 parser instead of being misread as GS1.
    return normalized.startsWith("01") && normalized.length > 13;
}

/**
 * Decode a GS1 barcode into structured fields. `value` mirrors the GTIN so the
 * result is compatible with the base parser convention (screens/handlers read
 * `parsed.value` for the product code).
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
        lot: null,
        serial: null,
        expiration: null,
        expiry: null,
        qty: 1,
        quantity: 1,
        errors: [],
    };

    for (const token of tokens) {
        parsed.ais[token.ai] = token.value;
        switch (token.ai) {
            case "01":
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
            case "15":
            case "17": {
                const expiration = toISODate(token.value);
                if (expiration) {
                    parsed.expiration = expiration;
                    parsed.expiry = expiration;
                } else {
                    parsed.errors.push(`Invalid GS1 date for AI ${token.ai}`);
                }
                break;
            }
            case "30":
            case "37": {
                const quantity = parseFloat(token.value);
                if (Number.isFinite(quantity)) {
                    parsed.qty = quantity;
                    parsed.quantity = quantity;
                } else {
                    parsed.errors.push(`Invalid GS1 quantity for AI ${token.ai}`);
                }
                break;
            }
        }
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
