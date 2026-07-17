/** @odoo-module **/

export function parseBarcode(barcode) {
    if (!/^\d{13}$/.test(barcode)) return null;
    return {type: "ean13", value: barcode};
}
