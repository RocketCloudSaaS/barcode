This module exposes the purchase order origin on incoming receipts and in the
Barcode picking list.

It adds a read-only `purchase_origin` field on `stock.picking`, related to the
purchase order origin. The value is shown on the incoming Receipt transfer
view, below the transfer name in the Barcode picking list for incoming
transfers, and is included in the Barcode picking search.
