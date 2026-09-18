import {_t} from "@web/core/l10n/translation";
import {barcodeMenuTiles} from "@barcode_scanner/js/registries.esm";

barcodeMenuTiles.add(
    "cycle_count",
    {
        label: _t("Cycle Count"),
        icon: "fa-refresh",
        iconClass: "ilx-icon-cycle",
        action: ({navigate}) => navigate("cycle_count_list"),
    },
    {sequence: 45}
);
