/**
 * Tolerant barcode matching, kept local to barcode_purchase.
 *
 * The scanner core ships an equivalent helper, but it sits in a different module
 * across branches (barcode_scanner on some, barcode_stock on others), and this
 * module must not depend on barcode_stock -- so it carries its own copy and
 * stays installable next to the core alone.
 *
 * A physical reader can deliver a barcode with surrounding whitespace or in a
 * different letter case than what is stored, so a raw `["barcode", "=", value]`
 * misses it. Match with a trimmed, case-insensitive `=ilike` instead, escaping
 * the SQL wildcards `_` `%` (and the escape char) so the match stays exact.
 *
 * Returns a searchRead-ready domain, or null when there is nothing to match.
 */
export function barcodeMatchDomain(value, field = "barcode") {
    const term = String(value ?? "").trim();
    if (!term) {
        return null;
    }
    const escaped = term.replace(/([\\%_])/g, "\\$1");
    return [[field, "=ilike", escaped]];
}

/**
 * Match ANY of several candidate codes the same tolerant way -- a GS1 GTIN has
 * several equivalent forms and the product's stored barcode may be any one of
 * them. ORs a tolerant leaf per unique, non-empty candidate.
 */
export function barcodeMatchAnyDomain(values, field = "barcode") {
    const terms = [];
    for (const v of [].concat(values ?? [])) {
        const term = String(v ?? "").trim();
        if (term && !terms.includes(term)) {
            terms.push(term);
        }
    }
    if (!terms.length) {
        return null;
    }
    const leaves = terms.map((t) => [field, "=ilike", t.replace(/([\\%_])/g, "\\$1")]);
    return Array(leaves.length - 1).fill("|").concat(leaves);
}
