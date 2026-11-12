/** @odoo-module **/

import {roundDecimals} from "@web/core/utils/numbers";

/**
 * Decimals past which a sum or a difference of quantities is float noise alone,
 * used while the decimals quantities are stored with are not known: no unit of
 * measure needs that many.
 */
const NOISE_DECIMALS = 9;

let storedDecimals = null;

/**
 * Remember the decimals a quantity is stored with: the precision of "Product
 * Unit of Measure".
 *
 * @param {Number|null} decimals the decimals, null when unknown
 */
export function setQuantityDecimals(decimals) {
    storedDecimals = Number.isInteger(decimals) ? decimals : null;
}

/**
 * A quantity worked out from others (what is left, what is done, a sum of
 * scans) as the server stores it. Adding and subtracting decimals in JavaScript
 * leaves float noise behind (100 - 87.08 is 12.920000000000002): shown as is it
 * reads as garbage, and a remainder of 1e-16 reads as something still to pick.
 * Rounded to the decimals quantities are stored with, it is the quantity Odoo
 * itself holds.
 *
 * @param {Number|String} value the quantity
 * @returns {Number} the quantity, rounded
 */
export function roundQty(value) {
    const decimals = storedDecimals ?? NOISE_DECIMALS;
    // RoundDecimals rounds half up like the server, but its scaling by a
    // negative power of ten leaves float noise of its own (0.3 comes back as
    // 0.30000000000000004); toFixed drops it without rounding the quantity to
    // another precision.
    return parseFloat(
        roundDecimals(parseFloat(value) || 0, decimals).toFixed(decimals)
    );
}
