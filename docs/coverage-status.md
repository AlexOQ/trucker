# Trailer & truck price coverage — ETS2 + ATS

Snapshot as of **2026-09-04** (ETS2 1.60.1.7, ATS 1.60.1.8).

## How prices are sourced

Prices are read from the game defs by `scripts/parse-game-defs.ts` and match the
dealer screen to the euro:

- **Dealer presets** (`def/vehicle/trailer_dealer`, `def/vehicle/truck_dealer`)
  list every accessory on every unit of a combination; the sum of those parts'
  `price` fields is the sticker price. Paint prices live in `@include`d settings
  files, which the parser inlines before reading.
- **Non-preset trailer configurations** (`trailer_owned/<brand>/configurations/`)
  are priced by walking from the brand's presets the way the upgrade shop does:
  keep accessories that still fit, swap chassis and body, re-count wheels per
  axle, add the new `defaults[]`, fill `require[]` with the cheapest suitable
  part. The trailer's price is the cheapest such walk.
- **Trucks** carry the exact preset prices plus `kit_price` — the required parts
  (interior, wheels, mirrors, lights…) every build pays beyond cabin, chassis,
  engine, transmission and paint — which the trucks page adds to its min-cost
  build.

Verified 2026-09-04 against nine owned ETS2 trailer combinations (SCS, Kässbohrer,
Schmitz; single, double, B-double, HCT) and a MAN TGX build: every SCS receipt
exact, the two brand-DLC receipts differing only by the owner's livery choice.

There is no hand-walked price file any more. `manual-prices.json` and its audit
doc were retired with this change.

## ETS2

508 of 514 trailer definitions priced. The 6 unpriced ids have no configuration
in the def tree (`kassbohrer.scx.*_17.*`, `krone.ecoolliner.single_3.reefer`,
`krone.edryliner.single_3.dryvan`); they are not buildable at the dealer.

Live check:
```
node scripts/winners-table.cjs ets2
node scripts/all-ties.cjs ets2
```

## ATS

Re-priced from a 1.60.1.8 install with `--prices-only`, which patches prices and
truck presets into the bundled `game-defs.json` without touching the 20-state
city set.

```
node scripts/winners-table.cjs ats
```

## Optimizer notes

- Multi-body trailer model: `optimizer.ts` picks profiles (body_type sets) rather than bare body_types, so trailers with `extra_body_types` correctly compete in multiple pools (see `OptimalFleetEntry.bodyTypes`, `bestJobProfile`).
- `multi-body-overrides.json` (ETS2 only currently) declares trailers that serve more than one body_type; the optimizer credits them across all listed slots.
- Tied-hv trailers resolve to the cheapest priced one; unpriced trailers lose ties.
