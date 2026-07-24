# Barcode suite — modular refactor proposal

**Date:** 2026-07-24
**Branch:** `18.0-base-refactor` (from `origin/18.0`)
**Status:** Phase 1 approved — implementation pending

## Goal

Turn `barcode_scanner` from a monolithic warehouse app into a **base scanning
framework** other modules plug into, the same way Odoo widgets self-register.
Adding a screen, a scan handler, or a home tile should be *"define it, register
it, it shows up"* — with no edits to `app.js`.

This is what unblocks the roadmap (`barcode_stock`, `barcode_inventory`,
`barcode_gs1`, `barcode_purchase`, `barcode_quality`, …): each module registers
its pieces into the base instead of patching it.

## Decisions taken

**Module map (final):**

| Module | Role |
| --- | --- |
| `barcode_scanner` | Base framework: client action shell, registries, scanner input, feedback, API, hooks. No business logic. |
| `barcode_stock` | Warehouse operations app: receipts, deliveries, internal transfers, quick info (today's `barcode_scanner` content). Depends on `barcode_scanner` + `stock`. |
| `barcode_inventory` | Inventory adjustments / stock counts. Depends on `barcode_scanner` + `stock`. |
| `barcode_camera` | Camera as a scan source (currently hooks in via `patch`; to be reworked to a registry-based scan source). |
| `barcode_gs1` | GS1 nomenclature parsing (extends the barcode parser). |
| `barcode_purchase` | Purchase-order receiving. |
| `barcode_quality` | Quality checks in the scanning flow. |

**Target architecture — three registries (Odoo `registry.category`):**

- `barcode_screens` — route name → `{component, props?}`. Screens self-register.
- `barcode_scan_handlers` — ordered handlers `{sequence, handle(barcode, parsed, ctx)}`; the first that returns `true` consumes the scan.
- `barcode_menu_tiles` — home-screen tiles `{sequence, label, icon, action}`.

**Why this matters — concrete evidence:** `barcode_camera` today hooks in with
`patch(BarcodeScannerApp.prototype, …)`, hardcodes stock route names in a
`CAMERA_ROUTES` set, and injects a floating button into `document.body` by hand
(imperative DOM outside OWL). That is the fragile, non-idiomatic pattern the
registries remove.

---

## Phase 1 — registries inside `barcode_scanner` (in place)

Introduce the registry pattern **without moving files yet**. Still one module,
still depends on `stock`, camera not involved. When done, the app behaves
**exactly as before** — internal refactor, no visible change.

### The three registries (new file `js/registries.js`)

```js
export const barcodeScreens      = registry.category("barcode_screens");
export const barcodeScanHandlers = registry.category("barcode_scan_handlers");
export const barcodeMenuTiles    = registry.category("barcode_menu_tiles");
```

**1. `barcode_screens`** — each screen self-registers in its own file, e.g. in
`screens/picking_screen.js`:

```js
barcodeScreens.add("picking", {
    component: PickingScreen,
    props: (p) => ({
        pickingId: p.pickingId,
        listParams: p.listParams ?? null,
        reloadToken: p.reloadToken ?? null,
        params: p,
    }),
});
```

The other 9 screens need only `component` (they inherit the default
`{navigate, params}`). This replaces the `screenProps` switch in `app.js`.

**2. `barcode_scan_handlers`** — replaces the hardcoded dispatch in
`screens/main_screen.js`. Each handler returns `true` if it consumes the scan:

```js
barcodeScanHandlers.add("stock_picking", {
    sequence: 20,
    async handle(barcode, parsed, ctx) {
        if (!(barcode.startsWith("WH/") || barcode.startsWith("INT/"))) return false;
        const [p] = await ctx.api.searchRead("stock.picking", [["name", "=", barcode]], ["id"]);
        if (!p) return false;
        ctx.navigate("picking", {pickingId: p.id});
        return true;
    },
});
```

The 3 current handlers (picking, product, location) go into a new file
`js/handlers/stock_scan_handlers.js` — isolated so Phase 2 just *moves the file*
to `barcode_stock`.

**3. `barcode_menu_tiles`** — replaces the 3 hardcoded buttons in the main
screen template:

```js
barcodeMenuTiles.add("warehouse_ops", {
    sequence: 10,
    label: _t("Warehouse Operations"),
    icon: "fa-home",
    iconClass: "ilx-icon-warehouse",
    action: (ctx) => ctx.navigate("warehouse_ops"),
});
```

Registered in `js/tiles/stock_menu_tiles.js` (also relocatable in Phase 2).

### File-by-file changes

| File | Change |
| --- | --- |
| `static/src/js/app.js` | Remove the 10 screen imports and `_registerRoutes()`. Import `./registries`; add getters `currentScreen` / `currentScreenProps` that resolve from the registry. The `screenProps` switch disappears. Also drop the unwired inline camera code (`shouldShowScannerFab` / `openCameraScanner` / `dispatchCameraScan`) present on `origin/18.0` — it is dead (no template references it) and camera will return as a registry-based scan source. |
| `static/src/js/router.js` | Remove `this.routes` and `registerRoute()`. `navigate()` and `popstate` resolve the screen from `barcodeScreens` (validate with `barcodeScreens.contains(name)`). Router now tracks only route name + params + history; it no longer knows about components. |
| `static/src/js/screens/main_screen.js` | Hardcoded `onBarcodeScanned` → new hook `useBarcodeDispatcher()` iterating `barcode_scan_handlers` by `sequence` until one returns `true` (none → "Barcode not recognized"). Hardcoded tiles → read from `barcode_menu_tiles`. |
| `static/src/xml/barcode_scanner_templates.xml` | `App`: `<t t-component="currentScreen.component" t-props="currentScreenProps"/>`. `MainScreen`: the 3 buttons → generic `t-foreach="menuTiles"`. |
| `__manifest__.py` | Add the new JS files to `web.assets_backend`, with `registries.js` **first** (must load before anything using it). |
| `static/src/js/store.js` | **Unchanged in Phase 1.** Dropping the `store`→`router` alias means touching all 10 screens; deferred to Phase 2 when they move anyway. |

### New files

- `js/registries.js` — the three categories.
- `js/hooks/use_barcode_dispatcher.js` — runs the scan-handler chain.
- `js/handlers/stock_scan_handlers.js` and `js/tiles/stock_menu_tiles.js` — stock registrations, isolated for a clean Phase 2 move.

> No `screens/index.js` barrel was needed: Odoo executes every module listed in
> the assets bundle at startup, so each screen self-registers just by being in
> `web.assets_backend` — the same way Odoo's own widgets register. Each screen
> gained a `barcodeScreens.add(...)` call at the bottom of its own file.

### Verification

Upgrade `barcode_scanner` and confirm **nothing changes** for the user:
navigation to the 10 screens works, home tiles render from the registry,
scanning on the home screen routes correctly (picking / product / location /
"not recognized"), and history back/forward behaves as before.

### Risks & mitigation

- **Bundle load order:** `registries.js` must load first → enforced in the manifest + barrel imports.
- **Screen props:** only `picking` has special props today; the rest use the default → low risk, identical behavior.
- **History / popstate:** current logic preserved as-is.

---

## Phase 2 — split into `barcode_scanner` (base) + `barcode_stock` *(pending detail)*

Physically extract the warehouse app. Move to `barcode_stock`: the 10 screens,
6 components, `state` + `sync` services, the 4 stock Python models
(`stock_move`, `stock_move_line`, `stock_picking`, `stock_quant` ≈ 494 lines),
`stock_location_views.xml`, and the stock parts of `security`/`data`/`demo`.
Rewrite import paths `@barcode_scanner/…` → `@barcode_stock/…`, split the two
manifests and asset bundles, split `templates.xml`. Drop the `barcode_scanner`
→ `stock` dependency; base keeps only `barcodes` + `web`. Retire the `store.js`
alias here.

## Phase 3 — verification + docs *(pending detail)*

Install both modules, smoke-test the 10 screens + camera, update `ROADMAP.md`
and the module READMEs.
