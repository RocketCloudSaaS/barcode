# Barcode

<!-- /!\ Non OCA Context : Set here the badge of your runbot / runboat instance. -->
<!-- /!\ Non OCA Context : Set here the badge of your translation instance. -->

<!-- /!\ do not modify above this line -->

Core barcode scanning application for warehouse operations.

This repository hosts the **Barcode** suite: a fast, full-screen scanning
experience for warehouse and back-office operations, built as a set of modules
you compose.

- **`barcode_scanner` is the base**: the client action, the scanner input, the
  registries, the feedback and the ORM wrapper. It carries no business logic, so
  it is not useful on its own.
- **Feature modules** add the actual operations — warehouse picking, camera
  input, GS1 parsing — by registering their screens, scan handlers, menu tiles
  and parsers into the base instead of patching it.
- **Bridge modules** hold the glue where two of them have to meet (`barcode_gs1`
  and `barcode_stock` disagree on what a weight means, so `barcode_gs1_stock`
  decides). They install themselves once both sides are there, so neither module
  has to know about the other and you can install either alone.

Install the base plus whatever you actually use. See
[ROADMAP.md](ROADMAP.md) for what each module does in detail and what is planned
next.

<!-- /!\ do not modify below this line -->

<!-- prettier-ignore-start -->

[//]: # (addons)

Available addons
----------------
addon | version | maintainers | summary
--- | --- | --- | ---
[barcode_camera](barcode_camera/) | 18.0.1.0.0 | [![antoniodavid](https://github.com/antoniodavid.png?size=30px)](https://github.com/antoniodavid) [![szalatyzuzanna](https://github.com/szalatyzuzanna.png?size=30px)](https://github.com/szalatyzuzanna) | Mobile camera barcode scanner (EAN13) for the Barcode suite
[barcode_gs1](barcode_gs1/) | 18.0.1.0.0 | [![antoniodavid](https://github.com/antoniodavid.png?size=30px)](https://github.com/antoniodavid) [![szalatyzuzanna](https://github.com/szalatyzuzanna.png?size=30px)](https://github.com/szalatyzuzanna) | GS1 barcode parsing (GS1-128, application identifiers)
[barcode_gs1_stock](barcode_gs1_stock/) | 18.0.1.0.0 | [![antoniodavid](https://github.com/antoniodavid.png?size=30px)](https://github.com/antoniodavid) [![szalatyzuzanna](https://github.com/szalatyzuzanna.png?size=30px)](https://github.com/szalatyzuzanna) | Use the measure on a GS1 label as the quantity picked
[barcode_scanner](barcode_scanner/) | 18.0.1.0.0 | [![antoniodavid](https://github.com/antoniodavid.png?size=30px)](https://github.com/antoniodavid) [![szalatyzuzanna](https://github.com/szalatyzuzanna.png?size=30px)](https://github.com/szalatyzuzanna) | Base scanning framework: client action, registries, scanner input and hooks
[barcode_stock](barcode_stock/) | 18.0.1.0.0 | [![antoniodavid](https://github.com/antoniodavid.png?size=30px)](https://github.com/antoniodavid) [![szalatyzuzanna](https://github.com/szalatyzuzanna.png?size=30px)](https://github.com/szalatyzuzanna) | Warehouse operations (receipts, deliveries, internal transfers) for the Barcode suite

[//]: # (end addons)

<!-- prettier-ignore-end -->

## Licenses

This repository is licensed under [AGPL-3](LICENSE).

However, each module can have a totally different license, as long as they adhere
to RocketCloudSaaS policy. Consult each module's `__manifest__.py` file, which
contains a `license` key that explains its license.

----

Maintained by [Binhex](https://www.binhex.cloud) and the Odoo Community
Association (OCA).
