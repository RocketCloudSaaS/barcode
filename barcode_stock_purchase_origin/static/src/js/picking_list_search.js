/** @odoo-module **/

/**
 * Append a picking's purchase origin to its (already normalized) search text.
 * An empty or absent origin contributes no term, so pickings without a
 * purchase order never match on an origin they cannot have.
 *
 * @param {String} searchText normalized base search text of the picking
 * @param {Object} picking picking record as returned by searchRead
 * @returns {String} base text, extended with the normalized origin when set
 */
export function appendPurchaseOriginToSearchText(searchText, picking) {
    const origin = (picking.purchase_origin || "").toString().trim().toLowerCase();
    return origin ? `${searchText} ${origin}` : searchText;
}
