From the Barcode app home screen, tap **Scrap Products**.

## Scrap goods

1. **Pick or scan the location** the goods are written off from. Scanning a
   location barcode jumps straight to the scrap lines; otherwise choose one
   from the searchable list of internal locations.
2. **Scan each product** to scrap: a plain barcode adds one unit, and a GS1
   label also reads its **lot/serial** and its **quantity**. Scanning the
   same product and lot again adds to its line. Tap **"+"** to add a product
   by hand; with no search it lists what the location holds.
3. Each line shows how much of it the location holds. Adjust the quantity
   if needed.
4. Choose the **scrap reasons** (the reasons configured in Inventory, if
   any) and tap **Scrap**.

## Lots and serial numbers

A lot/serial-tracked product needs its lot/serial: read from the GS1 label,
or typed into the line, which suggests the lots stored in that location. When
the location holds a single lot of the product, it is filled in. A serial
number is scrapped one unit at a time and can only appear once.

## Not enough stock

When a line asks for more than the location holds, nothing is scrapped yet:
the scanner lists what is short and asks whether to **scrap anyway** — the
same choice the back office offers through its insufficient-quantity wizard.
