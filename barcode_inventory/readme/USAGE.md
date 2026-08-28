From the Barcode app home screen, tap **Inventory Adjustment**.

## Count a location

1. **Pick or scan the location** to count. Scanning a location barcode
   jumps straight into the count; otherwise choose one from the searchable
   list of internal locations.
2. The count screen shows the location's current on-hand stock as
   theoretical lines. **Count by scanning** each product: a plain barcode
   adds one unit, and a GS1 label also reads its **lot/serial** and its
   **quantity**. You can also type the counted quantity in each line.
3. To count something not shown, tap **"+"** and scan or search the
   product. A freshly scanned or added product jumps to the top of the
   list and is highlighted, so you always see what the scan just changed.
4. Tap **Apply Adjustment** to record the count.

## Lots and serial numbers

A lot/serial-tracked product needs its lot/serial before it can be
applied — read from the GS1 label, or typed into the line (existing lots
autocomplete; a new name is created on the server). The same product can
appear on **several lines**, one per lot or serial number, so it stays
available in the **"+"** picker even after it already has a line.

## What it records

Each adjustment is applied as a
[stock_inventory](https://github.com/OCA/stock-logistics-warehouse)
adjustment group (draft → in progress → done), scoped to exactly the
counted products, using Odoo's native on-hand adjustment. Every barcode
count therefore leaves one traceable, auditable record with its own move
lines. Lots are created in the counted location's company.

Applying inventory quantities requires **Inventory administrator**
rights (the module ships a *Barcode Inventory User* group).
