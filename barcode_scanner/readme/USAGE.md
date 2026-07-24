``barcode_scanner`` is a framework and is not useful on its own: install a
feature module such as ``barcode_stock`` to get actual operations.

To build your own feature module, register your pieces into the framework
registries — no change to the base module is required.

Register a screen:

```js
import {barcodeScreens} from "@barcode_scanner/js/registries";

barcodeScreens.add("my_screen", {component: MyScreen});
```

Register a scan handler (tried in ``sequence`` order; the first that returns a
truthy value consumes the scan):

```js
import {barcodeScanHandlers} from "@barcode_scanner/js/registries";

barcodeScanHandlers.add("my_handler", {
    async handle(barcode, parsed, {api, navigate, notify}) {
        // return true when handled
    },
}, {sequence: 50});
```

Register a home-screen tile:

```js
import {barcodeMenuTiles} from "@barcode_scanner/js/registries";

barcodeMenuTiles.add("my_tile", {
    label: "My Screen",
    icon: "fa-cube",
    action: ({navigate}) => navigate("my_screen"),
}, {sequence: 50});
```
