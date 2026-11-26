This module extends `barcode_stock` so the picking screen lands on the tab
that still holds work. A "Confirm move" that completes the move -- and a scan
that completes it -- used to send the operator to the "Done" tab; on an order
with many lines that meant selecting "To Do" again after every line.

The tab now follows the work: "To Do" while anything is still to pick, "Done"
only when the whole picking is picked. A completed move stays one tap away on
the Done tab, and a picking without moves keeps the tab it opened on.
