# JWST Image Explorer

James Webb Space Telescope imagery in WorldWide Telescope: a searchable gallery of
286 Webb images placed on the sky, crossfading between them; a 3D view that puts
each image at its true distance; a guided tour; same-target compare mode; and a
museum kiosk mode. Built for INTUITIVE® Planetarium with the CosmicDS toolkit.

Live site: https://astrodavid10.github.io/jwst-viewer/

## Stack

Vue 3 + Vue CLI 5, Yarn 4 (`node-modules` linker), Node 22,
`@wwtelescope/engine` **7.40.0** with `engine-pinia` 0.16, `@cosmicds/vue-toolkit` 0.2,
Vuetify 3 (only `<v-app>`), Font Awesome 6 SVG icons, Less.

The engine's pinch-zoom clamp is removed by a `yarn patch`
(`.yarn/patches/@wwtelescope-engine-*.patch`), applied on every install. When
upgrading the engine, regenerate it with `yarn patch @wwtelescope/engine` and re-check
the private engine members `src/wwt-hacks.ts` overrides (`LayerManager._draw`,
`_drawSkyOverlays`, `Grids.drawCosmos3D`, `Grids.drawGalaxyImage`, the view movers).

## Commands

```bash
yarn install --immutable
yarn serve          # dev server on http://localhost:8080
yarn lint
yarn typecheck      # vue-tsc
yarn build          # production build into dist/ (no source maps)
yarn check:dist     # fails on .map/.tsbuildinfo in dist or dist over budget
yarn test           # Playwright smoke suite against dist/ (build first)
yarn stats          # catalog counts + distance/type coverage
```

`ALLOW_ALL_HOSTS=1 yarn serve` disables the dev server's host check (BrowserStack,
LAN devices). Leave it off otherwise.

## Deploy settings

Every push to `main` builds and publishes to GitHub Pages
(`.github/workflows/deploy.yml`), with `VUE_APP_PUBLIC_URL` set to the Pages URL.

For other hosts, set the canonical public URL at build time, for example in `.env.production.local`
(git-ignored) or the CI environment:

```
VUE_APP_PUBLIC_URL=https://example.org/path/to/jwst/
```

It is used for the kiosk take-home QR code and the absolute `og:image` / `og:url` social
preview tags. Without it the kiosk shows a staff warning badge, because a QR derived
from `localhost` or a LAN address can't work on a visitor's phone.

## URL parameters

| Parameter | Effect |
|---|---|
| `?image=<name>` | Open on that image (name match ignores case and quote style). Kept in sync while browsing; the Share button copies it. |
| `?mode=3d` | Start in the 3D view. |
| `?kiosk=1` | Museum mode: no intro, external links become QR codes, idle → attract loop, nightly 3 AM reload. |
| `?kioskIdle=<s>` / `?kiosk3dEvery=<n>` | Kiosk testing overrides. |
| `?kioskStats=1` | Staff usage-stats panel (anonymous, local to the device). |
| `?tileq=<1..8>` | Override the tile-quality multiplier (default: 4 on desktop, 2 on phones/touch). |
| `?debug=1` | Install console hooks (`window.jwstApp`, `window.WWTControl`, `__gxRebuild`, …). |

## Tests

`tests/smoke.spec.ts` covers boot, the default survey, gallery selection and URL sync,
`?image=` deep links, the error card on a failed catalog load, the guided tour, compare
mode, 2D/3D switching, kiosk idle → attract, the stats panel, an axe accessibility scan
and an end-to-end 3D marker hover. Headless Chromium renders WWT through SwiftShader,
including 3D, slowly.

### Manual 3D checklist (on real hardware before a release)

- Toggle 3D: the Milky Way backdrop and coloured markers appear without a hitch;
  constellation lines fade in when switched on.
- Hover (mouse) a marker: label with thumbnail. Tap (touch) a marker: label with
  "Tap again to open"; a second tap flies to it.
- From a marker's description, "View in 2D" arrives gently on the image.
- Zoom far out: markers fade toward a floor and the SDSS galaxy cosmos fades in.
- Kiosk: let it idle through a 3D interlude (`?kiosk=1&kioskIdle=10&kiosk3dEvery=1`).

## Updating the catalog

New imagery comes from the esawebb.org feed processed in
[wwt-core-catalogs](https://github.com/astrodavid10/wwt-core-catalogs) (`feeds/jwst`).
Append the new Places to `public/jwst.wtml` (and the identical root `jwst.wtml`), add a
distance and a type for each new name in `src/jwstDistances.ts` / `src/jwstTypes.ts`,
then run `yarn stats` (expects 0 missing) and the usual lint/build/test.

## Optional assets

`optional-assets/cosmosweb/` holds the COSMOS-Web galaxy field (menu item disabled).
It is kept out of `public/` so it doesn't ship; copy it to `public/cosmosweb/` and
re-enable the menu item in `jwst-viewer.vue` to bring the feature back.
