From the Barcode app, open **Cycle Count**, select a planned or open count,
confirm its location, enter the counted quantities for the linked lines, and
apply or explicitly confirm a zero-difference close.

Cycle Count counts existing stock quants; scanning a product does not create a
quant. If no quant matches, or more than one quant matches the product and its
lot/serial identity, stop and do not retry from Barcode. Regularize the stock or
resolve the product, location, and lot/serial identity through the normal
Inventory flow, then retry once the matching quant exists and is unambiguous.
