# Barcode

<!-- /!\ Non OCA Context : Set here the badge of your runbot / runboat instance. -->
<!-- /!\ Non OCA Context : Set here the badge of your translation instance. -->

<!-- /!\ do not modify above this line -->

Barcode scanning framework for Odoo: a domain-agnostic base you build operations on.

This repository hosts the **Barcode** suite: a fast, full-screen scanning
experience built as a set of modules you compose. The base carries no domain of
its own; each feature module brings one.

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
- **Extension modules** sharpen an operation you already run (recognising a
  product's alternate barcodes, putting a product the transfer never listed on
  it) by patching the feature module they extend, so what they change stays
  optional and the base is left alone.

Install the base plus whatever you actually use. See
[ROADMAP.md](ROADMAP.md) for what each module does in detail and what is planned
next.

<!-- /!\ do not modify below this line -->

<!-- prettier-ignore-start -->

[//]: # (addons)
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
