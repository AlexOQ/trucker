# manual-prices.json — methodology, audit, walk queue

## SCS internal name → dealer UI label

Internal body suffixes in the trailer keys don't match what the in-game dealer screen calls them. Quick reference for walks:

| Internal suffix | Dealer label |
|---|---|
| `flatbed_w` | Wooden floor flatbed |
| `flatbed_s` | Steel floor flatbed |
| `brick` | Drop side |
| `brick_crane` | Drop side with crane |
| `container` | Floor with container pins |
| `curtain` | Curtainsider |
| `curtainp` | Curtainsider (paint) |
| `dryvan` | Dry freighter |
| `dryvan_s` | Dry freighter side door |
| `dryvan_m` | Dry freighter moving floor |
| `insulated` | Insulated |
| `insulated_s` | Insulated side door |
| `reefer` | Refrigerated |
| `reefer_s` | Refrigerated side door |
| `reefer_m` | Refrigerated moving floor |
| `wood` (log) | Wooden floor logger |
| `steel` (log) | Steel floor logger |

## Walk methodology

For each trailer key, record the **cheapest configured-trailer total** the dealer screen shows when every selectable section (chassis / body / paint / wheels / accessories) is set to its lowest-priced option. This becomes the entry's `price`.

**Important — body fees scale with chassis.** When the dealer is on a 1-axle chassis, an insulated body shows e.g. 35k; switch to a 3-axle chassis and the same insulated body shows 50k. So:

```
total(chassis, body) = chain_base + chassis_fee(chassis) + body_fee(chassis, body) + paint_min
```

`chassis_fee` is universal (same value across bodies); `body_fee` is per-chassis. The chain_base and paint_min are constants per brand/chain.

**Walking procedure per chassis:** select chassis → read every needed body's displayed price → also read the chassis-section fee (for cross-checking) → record `chassis_fee + body_fee + paint_min + chain_base = total`. To extract `chain_base` once, walk the absolute-cheapest config for the brand+chain.

Live source of truth for what's left:
```
node scripts/all-ties.cjs ets2       # tie groups, NEEDS WALK markers
node scripts/winners-table.cjs ets2  # one winner per body_type × country-band
```

## Suspect entries — assumed-identical body/chassis fees, not walked

Pre-existing entries entered assuming a sibling variant has the same price. Likely wrong post-discovery that body fees vary by chassis.

### Category A — Schmitz `curtain` / `curtainp` / `curtain_ef` / `curtain_efp`

| Prefix | Variants | Current price (all) |
|---|---|---|
| `schmitz.scs.single_2` | curtain, curtainp | 41,385 |
| `schmitz.scs.single_3` | curtain, curtainp, curtain_ef, curtain_efp | 44,385 |
| `schmitz.scs.single_3sp` | curtain, curtainp | 44,385 |
| `schmitz.scs.single_3_15` | curtain, curtainp | 49,385 |
| `schmitz.scs.double_3_2` | curtain, curtainp | 69,625 |
| `schmitz.scs.hct_3_2_3` | curtain, curtainp | 96,415 |

### Category B — paint/steel finish, alu/steel legs (asserted identical at walk time)

May be correct, but flagged because the asserted equivalence isn't independently verified:

- `scs.livestock.single_3s.str_pnt` = `str_stl` (75,570)
- `scs.livestock.single_3b.belly_pnt` = `belly_stl` (87,570)
- `schmitz.ski.ch_*_dal.*` = `ch_*_dsl.*` (16 entries, alu vs steel legs)

## Walk queue — DLC trailers (24 chassis, 33 body prices)

For DLC trailers that participate in winner-tie groups but lack walked prices.
Each row = one dealer visit when the DLC is owned.

### Wielton (4 chassis — biggest hv uplift over SCS, 4.3-9.5% across band-1)
- `wielton.curtainm.single_3` — curtain, curtain_sb (curtainside band 1)
- `wielton.drym.single_3` — drym (dryvan band 1)
- `wielton.dropsidem.single_3` — dropside1035, dropside635, dropside835 (flatbed_brck band 1)
- `wielton.strongm.ch_4_sw` — strongm (dumper ALL 36)
- `wielton.containerm.single_3_220` — container (band 1)
- `wielton.containerm.single_3_40` — container (band 1)

### Feldbinder (3 chassis — silo specialist, 25-29% uplift on silo body)
- `feldbinder.tsaadr.single_3_32` — 32_1_1, 32_4_1 (chemtank ALL 36, 2.4% uplift)
- `feldbinder.kip.single_3_60` — silo_60_3g, silo_60_3g2, silo_60_3p (silo band 1, 29.0% uplift)
- `feldbinder.eut.double_3_1_3` — silo_35_3g, silo_35_3g2, silo_35_3p (silo band 2 + FI/SE)

### Kogel (5 chassis — Russia-only haul uplift; band-1 trailers TIE with SCS)
- `kogel.cool.ch_3` — reefer (band 1, ties SCS)
- `kogel.port.ch_3_dup_220` — container
- `kogel.port.ch_3_dup_40` — container
- `kogel.port.ch_3_tri_22` — container
- `kogel.port.ch_3_tri_40` — container

### Krone (4 chassis — Russia-only uplift; band-1 trailers TIE with SCS)
- `krone.profiliner.single_3_15` — curtain (Russia, 15% uplift)
- `krone.boxliner.single_3_220` — container
- `krone.boxliner.single_3_40` — container
- `krone.coolliner.single_3` — reefer
- `krone.coolliner.single_3sa` — reefer

### Schwarzmüller (2 chassis — zero hv edges over SCS; cosmetic + price-tier only)
- `schwmuller.slidepost.single_3` — slidepost (log band 1, ties SCS)
- `schwmuller.reefer.single_3` — reefer (band 1, ties SCS)

### Tirsan (2 chassis — marginal 2.9% on curtain)
- `tirsan.scs.single_3` — would be included if walking the curtain variant; primary winner is `curtain_sb1`
- `tirsan.shg.single_3` — container
- `tirsan.sri.single_3` — reefer

### Kassbohrer (1 remaining)
- `kassbohrer.scx.hct_3s_2_3` — curtain, curtainp (FI/SE HCT steerable variant)

## DLC marginal-value analysis (haul-value uplift over best SCS)

Generated 2026-05-11. Each row: DLC trailer that beats best SCS in at least one (country, body_type) slot. Sorted by uplift% within each DLC.

| DLC | Trailer | body_type | Countries | hv uplift over SCS |
|---|---|---|---|---|
| **Wielton** | `wielton.strongm.ch_4_sw.strongm` | dumper | 36 (ALL) | 4.3% |
| Wielton | `wielton.drym.single_3.drym` | dryvan | 28 (band 1) | 6.0% |
| Wielton | `wielton.curtainm.single_3.curtain` | curtainside | 28 (band 1) | 6.0% |
| Wielton | `wielton.dropsidem.single_3.dropside1035` | flatbed_brck | 28 (band 1) | 9.5% |
| **Feldbinder** | `feldbinder.tsaadr.single_3_32.32_1_1` | chemtank | 36 (ALL) | 2.4% |
| Feldbinder | `feldbinder.eut.double_3_1_3.silo_35_3g` | silo | 8 | 0.9-25.9% |
| Feldbinder | `feldbinder.kip.single_3_60.silo_60_3g` | silo | 28 (band 1) | 29.0% |
| **Schmitz** | `schmitz.scs.double_3_2.curtain` | curtainside | 6 (band 2) | 1.9% |
| Schmitz | `schmitz.scs.single_3.curtain` | curtainside | 27 (band 1) | 2.9% |
| Schmitz | `schmitz.scs.hct_3_2_3.curtain` | curtainside | 2 (FI/SE) | 3.0% |
| Schmitz | `schmitz.sko.single_3_15.reefer` | refrigerated | 1 (Russia) | 12.1% |
| Schmitz | `schmitz.sbo.single_3_15.dryvan` | dryvan | 1 (Russia) | 12.1% |
| Schmitz | `schmitz.scs.single_3_15.curtain` | curtainside | 1 (Russia) | 14.8% |
| **Kassbohrer** | `kassbohrer.sbt.single_2_13.dryvan` | dryvan | 28 (band 1) | 2.9% |
| Kassbohrer | `kassbohrer.scs.single_3_13.curtain` | curtainside | 27 (band 1) | 2.9% |
| Kassbohrer | `kassbohrer.scx.hct_3_2_3.curtain` | curtainside | 2 (FI/SE) | 3.0% |
| Kassbohrer | `kassbohrer.scx.single_3_15.curtain` | curtainside | 1 (Russia) | 15.0% |
| **Kogel** | `kogel.cargo.ch_3_15.curtain` | curtainside | 1 (Russia) | 9.0% |
| Kogel | `kogel.cool.ch_3_15.reefer` | refrigerated | 1 (Russia) | 9.1% |
| **Krone** | `krone.dryliner.single_3_15.dryvan` | dryvan | 1 (Russia) | 11.7% |
| Krone | `krone.profiliner.single_3_15.curtain` | curtainside | 1 (Russia) | 15.0% |
| **Tirsan** | `tirsan.scs.single_3.curtain_sb1` | curtainside | 28 (band 1) | 2.9% |
| **Schwarzmüller** | (none — 0 edges) | — | — | 0% |

### Notes on tie-only contributors

These DLC trailers don't beat SCS but participate in winner-tie groups (hv equal to SCS); the cheapest walked price within the tie wins:
- Schwarzmüller: `schwmuller.reefer.single_3.reefer` (band 1), `schwmuller.slidepost.single_3.slidepost` (band 1)
- Kogel: `kogel.cool.ch_3.reefer` (band 1), `kogel.port.*.container` (band 1, band 4)
- Krone: `krone.coolliner.single_3.reefer` (band 1), `krone.boxliner.*.container` (band 1, band 4)
- Tirsan: `tirsan.shg.single_3.container`, `tirsan.sri.single_3.reefer`
- Wielton: `wielton.containerm.single_3_*.container`

These are still worth walking for data completeness once the DLC is owned — they may turn out cheaper than the current SCS pick within their tie set and thus become the optimizer's choice.

