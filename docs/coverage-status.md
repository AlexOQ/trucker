# Manual-price coverage — ETS2 + ATS

Snapshot as of **game version 1.59** (2026-05-11).

## What "coverage" means here

Three DLC categories in ETS2/ATS, but only one needs manual data work:

| DLC type | Examples | Adds | Manual walks needed? |
|---|---|---|---|
| Map | Going East, Scandinavia, Iberia, etc. | Cities + map-tied "shadow" cargo | No — parser reads game-defs correctly |
| Cargo pack | High Power, Heavy Cargo, JCB, etc. | New cargo IDs | No — parser reads cargo defs correctly |
| Trailer brand | Feldbinder, Wielton, Kogel, etc. | New ownable trailers | **Yes** — parser misreads prices |

All map + cargo DLCs are considered data-complete as soon as their content lands in `game-defs.json`. The walk effort below is exclusively trailer-brand DLCs.

A "winner" = trailer that wins the highest-hv slot for at least one (country, body_type) pair under the all-DLC-assumed-owned model. The optimizer needs walked prices for every winner-tie member to pick correctly; this table tracks per-brand coverage of the displayed winners.

Live regeneration:
```
node scripts/winners-table.cjs ets2
node scripts/winners-table.cjs ats
```

## ETS2

| Brand | Winners | Walked | Parser-priced | MISSING | DLC required | Owned? |
|---|---|---|---|---|---|---|
| **scs** (base) | 22 | **22 ✅** | 0 | 0 | — | always |
| schmitz | 3 | **3 ✅** | 0 | 0 | Schmitz Cargobull | yes |
| kassbohrer | 3 | **3 ✅** | 0 | 0 | Kässbohrer | yes |
| wielton | 4 | 0 | 1 | 3 | Wielton | — |
| feldbinder | 3 | 0 | 0 | 3 | Feldbinder | — |
| kogel | 1 | 0 | 1 | 0 | Kögel | — |
| schwmuller | 1 | 0 | 1 | 0 | Schwarzmüller | — |
| **Totals** | **37** | **28** | **3** | **6** | | |

**SCS no-DLC fallback coverage** (the set a player with no DLC trailer packs would see): **35/35 walked ✅**. Any non-DLC player gets accurate prices across every body_type × country band.

**Tie-only DLC trailers** (don't beat SCS on hv but participate in winner-tie groups — need walked prices when DLC owned for correct tie-breaking): tracked in `manual-prices-audit.md` walk queue (24 chassis, 33 body prices).

## ATS

| Brand | Winners | Walked | Parser-priced | MISSING |
|---|---|---|---|---|
| **scs** (base) | 50 | 0 | 0 | 50 |
| lodeking | 1 | 0 | 0 | 1 |
| **Totals** | **51** | **0** | **0** | **51** |

ATS has **no walked prices yet** — `public/data/ats/manual-prices.json` does not exist. The parser-derived prices are unreliable (see `feedback_trucker_parser_prices_unreliable`); every winner needs hand-walking via the ATS dealer screen.

## Optimizer notes

- Multi-body trailer model: `optimizer.ts` picks profiles (body_type sets) rather than bare body_types, so trailers with `extra_body_types` correctly compete in multiple pools (see `OptimalFleetEntry.bodyTypes`, `bestJobProfile`).
- `multi-body-overrides.json` (ETS2 only currently) declares trailers that serve more than one body_type; the optimizer credits them across all listed slots.

## What's next

- **ETS2**: closed for owned-DLC scope. Future walks gated on Wielton / Feldbinder / Kögel / Krone / Schwarzmüller / Tirsan purchase.
- **ATS**: needs first walk session — see `manual-prices-audit.md` methodology (chain_base derivation, per-chassis body fee scaling).
