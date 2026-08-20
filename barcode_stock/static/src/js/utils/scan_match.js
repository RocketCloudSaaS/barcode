/** @odoo-module **/

/**
 * A physical reader can deliver a barcode with surrounding whitespace (a
 * keyboard-wedge prefix/suffix) or in a different letter case than what is
 * stored, so a raw `["barcode", "=", value]` match misses it while a manual
 * copy/paste of the same code works -- the exact asymmetry reported on
 * location scans in internal transfers. Build a tolerant match instead: trim
 * the value and compare case-insensitively with `=ilike`.
 *
 * `=ilike` treats `_` and `%` as SQL wildcards, so escape them (and the escape
 * character itself) to keep the match exact -- a stray wildcard in a barcode
 * could otherwise select the WRONG product or location.
 *
 * Returns a single-leaf domain ready for searchRead, or null when the scanned
 * value is empty so the caller can treat it as "no match".
 */
export function barcodeMatchDomain(value, field = "barcode") {
    const term = String(value ?? "").trim();
    if (!term) {
        return null;
    }
    const escaped = term.replace(/([\\%_])/g, "\\$1");
    return [[field, "=ilike", escaped]];
}
