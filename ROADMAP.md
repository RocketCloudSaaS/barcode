# Roadmap

This repository hosts the **Barcode** suite for Odoo: a set of modules built
around a fast, full-screen barcode scanning experience for warehouse and
back-office operations.

The suite is designed to be **modular**: `barcode_scanner` is the core
application, and every other module is an optional add-on that extends it for a
specific area (camera input, GS1 nomenclature, inventory, stock, purchase,
quality, …). Install only what you need.

> This roadmap reflects our current intentions. Priorities and scope may change.
> Feedback and contributions are welcome — open an issue to discuss a module or
> suggest a new one.

## Status legend

| Status | Meaning |
| --- | --- |
| Available | Released and installable |
| In progress | Actively being developed |
| Planned | On the roadmap, not started yet |

## Modules

| Module | Status | Purpose |
| --- | --- | --- |
| [`barcode_scanner`](barcode_scanner) | Available | Core full-screen scanning app for warehouse operations |
| `barcode_camera` | Planned | Scan barcodes using the device camera |
| `barcode_gs1` | Planned | GS1 nomenclature support (GS1-128, application identifiers) |
| `barcode_inventory` | Planned | Inventory adjustments and stock counts by barcode |
| `barcode_stock` | Planned | Extended stock operations and warehouse flows |
| `barcode_purchase` | Planned | Purchase order receiving driven by barcode |
| `barcode_quality` | Planned | Quality checks integrated into the scanning flow |

## Details

### barcode_scanner — *core*

Full-screen barcode scanning application for warehouse operations. Covers
receipts, deliveries, internal transfers, and quick product/location lookups,
with real-time validation and audio/vibration feedback on each scan.

This is the base module every other module in the suite builds on.

### barcode_camera

Use a device's built-in camera as a barcode reader, so operators can scan
without dedicated hardware. Complements the core app for phones, tablets, and
laptops.

### barcode_gs1

Add GS1 barcode support (GS1-128 and application identifiers) on top of the
core scanner, which today focuses on EAN13. Enables parsing of structured data
such as lot/serial numbers, expiry dates, and quantities from a single scan.

### barcode_inventory

Perform inventory adjustments and cycle/stock counts directly from the scanner,
updating on-hand quantities by scanning products and locations.

### barcode_stock

Extend the scanner with additional stock operations and warehouse flows beyond
the core receipts/deliveries/internal transfers.

### barcode_purchase

Drive purchase order receiving from the scanner: match incoming goods against
purchase orders and confirm receptions by barcode.

### barcode_quality

Integrate Odoo quality checks into the scanning flow, so quality control steps
can be triggered and completed while processing operations.

## Contributing

- Found a bug or have an idea? [Open an issue](https://github.com/RocketCloudSaaS/barcode/issues).
- Want to build one of the planned modules? Comment on the related issue so we
  can coordinate.

Maintained by [Binhex](https://www.binhex.cloud) and the Odoo Community
Association (OCA).
