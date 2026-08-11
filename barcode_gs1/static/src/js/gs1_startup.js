/** @odoo-module **/

import {barcodeStartupTasks} from "@barcode_scanner/js/registries";
import {loadGs1Nomenclature} from "@barcode_gs1/js/gs1_nomenclature";

/**
 * Read the GS1 nomenclature once, when the app starts, so the parser — which
 * runs synchronously on every scan — has the rules ready. The parser falls back
 * to its built-in identifiers if this never completes.
 */
barcodeStartupTasks.add("gs1_nomenclature", (env) =>
    loadGs1Nomenclature(env.services.orm, env.services.company?.currentCompany?.id)
);
