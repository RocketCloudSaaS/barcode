# Backport analysis — Barcode suite 18.0 → 17.0

**Date:** 2026-07-31
**Scope:** move the suite (`barcode_scanner`, `barcode_stock`, `barcode_camera`,
`barcode_gs1`, `barcode_gs1_stock`) from 18.0 back to 17.0.
**Method:** findings verified against a real Odoo 17.0 checkout, not from memory.

> A backport (going one version back) is comparatively smooth here: 17.0 and
> 18.0 both run OWL 2 and share almost all of the `@web/core` surface this suite
> uses. There is **no showstopper** — every risk below has a known fix.

## Compatible as-is in 17.0 (verified)

- All `@web/core` imports the suite uses exist unchanged in 17.0: `registry`,
  `utils/hooks`, `utils/reactive`, `utils/patch`, `utils/concurrency`,
  `l10n/translation`, `confirmation_dialog/confirmation_dialog`,
  `browser/browser`.
- `deserializeDateTime` (`@web/core/l10n/dates`) — present. The timezone fix on
  the picking list backports untouched.
- `BarcodeParser` and `get_barcode_check_digit` (`@barcodes/js/barcode_parser`)
  — present. The GS1 parser depends on nothing 18-only.
- `barcodes_gs1_nomenclature` module — present.
- Camera scan: `scanBarcode(env, facingMode)` exists with the **same signature**;
  only the import path differs (see below).

## Changes required

| Topic | 18.0 | 17.0 | Files touched |
| --- | --- | --- | --- |
| Camera scan | `import {scanBarcode} from "@web/core/barcode/barcode_dialog"` | `import {scanBarcode} from "@web/webclient/barcode/barcode_scanner"` (same signature) | `barcode_camera/…/camera_fab.js`, `barcode_stock/…/screens/picking_list_screen.js`, `barcode_stock/…/screens/move_wizard_screen.js` |
| Current user | `import {user} from "@web/core/user"` (`user.tz`, `user.hasGroup`) | no such module → `useService("user")`; tz from `session.user_context` | `barcode_scanner/…/screens/main_screen.js` (tz), `barcode_stock/…/screens/move_wizard_screen.js` (`hasGroup`) |
| Storable product | `is_storable` (2 uses) | field does not exist → `type` / `detailed_type == 'product'` | `barcode_stock` |
| JS tests | **hoot** (457 lines in `barcode_gs1`, 74 in `barcode_gs1_stock`) | hoot is not in 17.0 → port to **QUnit** or drop | `barcode_gs1/…/tests`, `barcode_gs1_stock/…/tests` |
| Manifests | `"version": "18.0.x"` | `"version": "17.0.x"` | all `__manifest__.py` |

## External prerequisite

- `stock_move_line_qty_picked` (OCA) provides the `qty_picked` field (27 uses in
  `barcode_stock`). It is **not** core — the 17.0 version of that OCA module must
  be available on the target instance.

## Effort estimate per addon

| Addon | Estimate | Main work |
| --- | --- | --- |
| `barcode_gs1_stock` | ~0.5 day | tiny bridge; hoot→QUnit tests |
| `barcode_camera` | ~0.5 day | one import-path change for `scanBarcode` |
| `barcode_scanner` | ~1–1.5 days | `user`→service; other imports already OK; SCSS is portable |
| `barcode_gs1` | ~1.5–2 days | parser is fine; the bulk is porting the hoot test suite to QUnit |
| `barcode_stock` | ~3–4.5 days | `is_storable`→`type`, `user.hasGroup`→service, camera path, ~10 OWL screens/components, ~1.9k lines of XML, re-test the picking / lot / serial flows |

**Total: ~6.5–9 developer-days**, with `barcode_stock` about half of it and a
spike of effort on the GS1 tests (hoot does not exist in 17.0).

## Suggested order

1. Half-day spike: confirm the external `stock_move_line_qty_picked` 17.0 dep and
   the `user`/camera/`is_storable` swaps on a throwaway branch before committing
   to the estimate.
2. `barcode_scanner` (base) → `barcode_camera` → `barcode_stock` →
   `barcode_gs1` → `barcode_gs1_stock`, following the dependency order.
