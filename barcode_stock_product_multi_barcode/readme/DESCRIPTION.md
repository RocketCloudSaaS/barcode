This module is the bridge between **multiple product barcodes** and the
**warehouse app**: it makes every barcode a product carries resolve to the same
move inside a picking.

`product_multi_barcode` lets a product hold several barcodes (its main one plus
alternates). `barcode_stock` only indexes the main barcode and the packagings,
so scanning an alternate barcode inside a picking is rejected even though the
product is on the move. This module loads the alternate barcodes of the products
in the current picking and indexes them, so a scan of any of them matches the
same move.

It installs itself as soon as both ``barcode_stock`` and
``product_multi_barcode`` are installed, and neither needs the other without it.
