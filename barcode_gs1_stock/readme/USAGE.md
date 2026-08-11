Nothing to configure: installing ``barcode_gs1`` next to ``barcode_stock`` brings
this module in, and every screen that applies a scanned quantity uses it.

When a scanned GS1 barcode carries a measure, the unit that measure is in comes
from the rule that read it (*Unit of Measure* on the barcode rule — AI 310n is
kilograms, 320n pounds, 311n metres). It is then compared with the unit the
product is stocked in:

- **same kind of unit** — the measure is the quantity, converted into the
  product's own unit: 2.497 kg on the label is 2.497 for a product in kilograms
  and 2497 for one in grams;
- **a different kind** — a weight for a product counted in units, say — the
  measure says nothing about how many to pick, so the piece count on the label
  (AI 30/37) is the quantity, and a single unit when the label states none.

Only the floating point noise of the conversion is rounded away, so the 2.497 kg
the label states does not become the 2.50 the unit's own rounding would give.

Without this module the warehouse app takes a scanned quantity as it comes, and
GS1 barcodes are still parsed — only the unit of measure is not considered.
