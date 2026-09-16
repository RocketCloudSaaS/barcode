import {PickingScreen} from "@barcode_stock/js/screens/picking_screen.esm";
import {QualityTab} from "@barcode_stock_quality/js/components/quality_tab.esm";

/**
 * Make the reception's PickingScreen aware of the Quality tab without patching
 * barcode_stock's source: register the tab component so the inherited template
 * can render a "Quality" tab for incoming pickings.
 */
PickingScreen.components = {
    ...PickingScreen.components,
    QualityTab,
};
