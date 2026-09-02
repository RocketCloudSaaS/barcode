From the Barcode app home screen, tap **Purchase Orders**.

## Raise an order

1. **Pick the vendor.** Scanning a partner barcode selects it straight away;
   otherwise choose one from the searchable list of suppliers.
2. Optionally set the **destination location** (only the destinations of
   incoming operation types are offered) and the **buyer** (Odoo's native
   purchase-order responsible user), and type a **vendor reference**.
3. **Add the products.** Scan each product: a plain barcode adds one unit, and a
   GS1 label also reads its **lot/serial** and its **quantity**. You can also tap
   **"+"** to search and add a product, and edit the quantity and unit price on
   each line.
4. Tap **Confirm Order** to create and confirm the purchase order, or **Save
   Draft** to create it without confirming.

## Automatic validation

With **Validate automatically** ticked, the order is confirmed on create, which
raises the incoming picking; the scanned destination and any scanned lots are
written onto that picking. If a lot/serial-tracked product still has no lot, the
order is left as a **draft** instead (a receipt would be blocked without the
lot), and the screen says which product needs one.

Creating and confirming a purchase order requires **Purchase** rights (the module
ships a *Barcode Purchase User* group that grants them).
