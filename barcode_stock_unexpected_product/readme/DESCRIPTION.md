Let the warehouse app add a product to a transfer by scanning it, even
when that product is not one of the transfer's planned move lines.

By default the scanner only accepts products already expected on the
operation. This module lifts that limit — per operation type — so an
operator scanning an unlisted product adds a new line for it on the spot,
instead of being told the barcode is not part of the operation.

This is a feature module on top of `barcode_stock`: it patches the
warehouse scan screens to allow the extra line and gates the behaviour
behind a setting on the operation type, so you enable it only where you
want it.
