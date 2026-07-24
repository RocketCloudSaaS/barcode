# Roadmap

This repository hosts the **Barcode** suite for Odoo: a set of modules built
around a fast, full-screen barcode scanning experience for warehouse and
back-office operations.

The suite is designed to be **modular**: `barcode_scanner` is the base
framework — the scanning engine every other module plugs into — and each
feature module is an optional add-on for a specific area (warehouse, inventory,
camera input, GS1 nomenclature, purchase, quality, …). Modules register their
screens, scan handlers and menu tiles into the base instead of patching it, so
you install only what you need.

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
| [`barcode_scanner`](barcode_scanner) | Available | Base scanning framework: client action, registries, scanner input, feedback, API, hooks |
| [`barcode_stock`](barcode_stock) | Available | Warehouse operations app: receipts, deliveries, internal transfers, quick info |
| `barcode_inventory` | Planned | Inventory adjustments and stock counts by barcode |
| [`barcode_camera`](barcode_camera) | Available | Scan barcodes using the device camera |
| `barcode_gs1` | Planned | GS1 nomenclature support (GS1-128, application identifiers) |
| `barcode_purchase` | Planned | Purchase order receiving driven by barcode |
| `barcode_quality` | Planned | Quality checks integrated into the scanning flow |

## Details

### barcode_scanner — *base framework*

The scanning engine every other module builds on: the full-screen client
action shell, the registries that let modules plug in screens, scan handlers
and menu tiles, the barcode input service, real-time feedback (audio/vibration),
the ORM/API wrapper, and the shared hooks. It carries no business logic of its
own — install a feature module on top to get actual operations.

### barcode_stock — *warehouse operations*

The warehouse application: receipts (incoming), deliveries (outgoing), internal
transfers, and quick product/location lookups, with real-time validation on
each scan. This is what most users think of as "the barcode app"; it registers
its screens and handlers into `barcode_scanner`.

### barcode_inventory

Perform inventory adjustments and cycle/stock counts directly from the scanner,
updating on-hand quantities by scanning products and locations.

### barcode_camera

Use a device's built-in camera as a barcode reader, so operators can scan
without dedicated hardware. Complements the app for phones, tablets, and
laptops.

### barcode_gs1

Add GS1 barcode support (GS1-128 and application identifiers) on top of the
base scanner, which today focuses on EAN13. Enables parsing of structured data
such as lot/serial numbers, expiry dates, and quantities from a single scan.

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
