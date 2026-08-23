# ATS — trailer legality and weight limits by state

ATS reuses ETS2's `country_validity` field, with US states in place of countries. 140 of 562 trailers are state-restricted; the rest are legal everywhere. Canonical data is `country_validity` in `public/data/ats/game-defs.json` — this doc is the derived reading of it. Verified against a 1.60.1.8 install, 2026-08-23.

The optimizer already honours it (`optimizer.ts:193`, `:565`): a trailer is only offered at a depot whose city sits in a state the trailer is valid in.

## The five restriction sets

Every restricted trailer falls into one of five sets. `chain_type` predicts the set almost exactly.

| chain type | # | legal in | body types |
|---|--:|---|---|
| `bdouble` | 22 | ID MT NV OR UT WA WY | container, curtainside, dryvan, dumper, flatbed, fueltank, gastank, hopper, insulated, refrigerated, silo |
| `rmdouble` | 21 | CO ID MT NV OK OR UT WA WY | as above, + foodtank, − gastank |
| `tpdouble` | 24 | CO ID MT NV OK UT | as `rmdouble` |
| `triple` | 14 | CO ID MT NV OK OR UT | curtainside, dryvan, flatbed, foodtank, fueltank, hopper, insulated, refrigerated |
| `single` (53 ft axle variants) | 59 | everywhere **except CA and IL** | container, curtainside, dropdeck, dryvan, flatbed, insulated, refrigerated |

Unrestricted: the other 380 `single`, all 30 `double` (18 genuine STAA doubles + 12 articulated lowboys), and 12 `lowboy` `triple`.

The 53 ft set is **not** a blanket length law, and this is easy to get wrong. Most 53-footers are unrestricted: `scs.box.single_53`, `single_53f`, `single_53_3`, `single_53_4` and `single_53_4s` are all legal everywhere. Only particular axle-position variants are gated — the `r`, `sp` and `4o` suffixes — and their defs are otherwise **byte-identical** to an unrestricted sibling:

```
scs.box.single_53.dryvan     16.1544 m  2 axles  112.56 m³  27,200 kg   (no country_validity)
scs.box.single_53r.dryvan    16.1544 m  2 axles  112.56 m³  27,200 kg   18 states
```

Same volume, weight, length and axle count — the restriction is cosmetic axle placement, not capacity. So California and Illinois lose *variants*, not capability.

### `chain_type` counts chassis units, not trailers

This matters for reading the table above. Every `double`/`triple` value means "2 or 3 chassis in the chain", which is usually a road train but is not always one. `scs.lowboy` is the sole exception: its configurations are named `tr_articulated_3axle` … `tr_articulated_9axle` — a jeep dolly, one lowboy, and a spreader. That is a single-trailer heavy-haul rig, not an LCV.

| family | config name | what it is |
|---|---|---|
| everything except `scs.lowboy` | `tr_double_staa`, `tr_double_staa_pup`, `tr_b_double`, `tr_rm_double`, `tr_tp_double`, `tr_triple`, `tr_triple_pup` | genuine multi-trailer combinations |
| `scs.lowboy` `double_*` | `tr_articulated_3/4/5axle` | jeep + lowboy |
| `scs.lowboy` `triple_*` | `tr_articulated_6/7/8/9axle` | jeep + lowboy + spreader |

So the 12 unrestricted `lowboy` `triple` trailers carrying no `country_validity` is **correct, not a data gap**: a jeep-and-spreader heavy-haul rig is a permit load legal in every state, unlike a triple road train. Same for the 12 `lowboy` `double`. No data change warranted.

The UI used to label these "Double"/"Triple", which read as a road train. `chainConfigLabel()` now takes the body type and renders lowboy rigs as "Jeep dolly" and "Jeep dolly + spreader"; `formatTrailerSpec()` renders them "Articulated", matching the defs' own `tr_articulated_Naxle`.

## States by tier

`rmdouble` legality is the dividing line: the nine LCV (Longer Combination Vehicle) states are exactly the nine whose country def declares axle-mass entries beyond the federal three.

| tier | states | owned | trailers | max volume |
|---|---|---|--:|--:|
| **Full LCV** | Nevada, Idaho, Utah, Montana | ✅ all 4 | 562 | 191 m³ |
| **LCV, no bdouble** | Colorado, Oklahoma | ✅ both | 540 | 191 m³ |
| **LCV, no tpdouble** | Oregon | ✅ | 538 | 172 m³ |
| **LCV, doubles only** | Washington, Wyoming | ✅ both | 524 | 153 m³ |
| **Standard** | Arizona, New Mexico, Texas, Arkansas | ✅ all 4 | 481 | 115 m³ |
| **Standard** | Kansas, Nebraska, Iowa, Louisiana, Missouri | ❌ none | 481 | 115 m³ |
| **Standard, no 53 ft** | California | ✅ | 422 | 115 m³ |
| **Standard, no 53 ft** | Illinois | ❌ | 422 | 115 m³ |

All 9 LCV states are owned. Of the 6 unowned states, 5 are plain Standard and one (Illinois) is the most restricted tier in the game — so **no unowned state would add any trailer capability**. Map DLCs for those states buy cities and routes, nothing else.

The trailer counts above overstate the CA/IL penalty. Of the 140 restricted trailers, **57 have an unrestricted twin with identical body type, chain type, volume, weight limit and axle count** — all of them `single`, the axle variants above. Only **83 represent real capability**, and every one is an LCV combination:

| chain type | restricted | has identical twin | real capability |
|---|--:|--:|--:|
| `single` | 59 | 57 | 2 |
| `bdouble` | 22 | 0 | 22 |
| `rmdouble` | 21 | 0 | 21 |
| `tpdouble` | 24 | 0 | 24 |
| `triple` | 14 | 0 | 14 |

So California is **not** meaningfully worse than Texas, Arizona or Arkansas — all four are simply "no LCV". The regional story in ATS is entirely the LCV/non-LCV split; the CA/IL 53 ft rule costs nothing an optimizer would notice.

## Peak volume per body type, by tier

Volume drives units per haul (`floor(trailer_volume / cargo_volume)`, weight-capped), so this is the table that moves EV.

| body type | CA / IL | Standard | WA / WY | OR | CO / OK | NV / ID / UT / MT | gain |
|---|--:|--:|--:|--:|--:|--:|--:|
| `bulkfeed` | 53 | 53 | 53 | 53 | 53 | 53 | — |
| `chemtank` | 37 | 37 | 37 | 37 | 37 | 37 | — |
| `chipvan` | 115 | 115 | 115 | 115 | 115 | 115 | — |
| `container` | 106 | 106 | 120 | 120 | 160 | 160 | **+51%** |
| `curtainside` | 115 | 115 | 153 | 172 | 191 | 191 | **+66%** |
| `dropdeck` | 113 | 113 | 113 | 113 | 113 | 113 | — |
| `dryvan` | 115 | 115 | 153 | 172 | 191 | 191 | **+66%** |
| `dumper` | 31 | 31 | 41 | 41 | 37 | 41 | **+32%** |
| `flatbed` | 115 | 115 | 153 | 172 | 191 | 191 | **+66%** |
| `foodtank` | 37 | 37 | 42 | 53 | 53 | 53 | **+43%** |
| `fueltank` | 36 | 36 | 45 | 53 | 55 | 55 | **+53%** |
| `gastank` | 55 | 55 | 61 | 61 | 55 | 61 | **+11%** |
| `hopper` | 73 | 73 | 88 | 109 | 109 | 109 | **+49%** |
| `insulated` | 105 | 105 | 137 | 158 | 169 | 169 | **+61%** |
| `livestock` | 115 | 115 | 115 | 115 | 115 | 115 | — |
| `log` | 77 | 77 | 77 | 77 | 77 | 77 | — |
| `lowboy` | 72 | 72 | 72 | 72 | 72 | 72 | — |
| `refrigerated` | 105 | 105 | 137 | 158 | 169 | 169 | **+61%** |
| `silo` | 51 | 51 | 59 | 59 | 79 | 79 | **+55%** |

Seven body types have no LCV variant at all — `bulkfeed`, `chemtank`, `chipvan`, `dropdeck`, `livestock`, `log`, `lowboy`. A garage specialising in those is indifferent to state. `lowboy` is flat for a different reason than the rest: its multi-chassis configs are articulated heavy-haul rigs whose deck volume is a constant 72 m³ regardless of how many axles are under them, so capacity scales in weight, not volume.

Tiers are **not** strictly ordered. CO/OK lose `bdouble`, so they trail WA/WY on `dumper` (37 vs 41) and `gastank` (55 vs 61) while beating them everywhere else. The CA/IL column is identical to Standard throughout — as the twin analysis above predicts, those two states lose nothing an optimizer can measure.

## Per-state weight caps — present in the game files, absent from `game-defs.json`

`def/country/<state>.sui` carries `mass_limit_per_axle_count[]` — whole-combination GVW caps indexed from 2 axles upward, last entry applying to all higher counts. The parser reads `name` only, so `game-defs.json`'s `countries` section holds nothing else.

| state | cap (kg) | cap (lb) | state | cap (kg) | cap (lb) |
|---|--:|--:|---|--:|--:|
| Montana | 59,447.9 | 131,060 | Wyoming | 53,070.4 | 117,000 |
| Nevada | 58,513.5 | 129,000 | Colorado | 49,895.2 | 110,000 |
| Utah | 58,513.5 | 129,000 | Idaho / Oregon / Washington | 47,854.0 | 105,500 |
| Oklahoma | 40,823.4 | 90,000 | New Mexico | 39,490.4 | 87,061 |
| All 10 others | 36,287.4 | 80,000 | | | |

New Mexico is the only non-LCV state above the federal 80,000 lb — its whole ladder is raised (43,200 / 64,800 / 87,061 lb, against the federal 40,000 / 60,000 / 80,000).

These caps sit *below* some trailers' own `gross_weight_limit`, and the optimizer caps units on the trailer's own limit only (`parse-game-defs.ts:1418`) — so where the state cap is tighter, units and therefore EV are overstated.

Discounting `lowboy` (heavy haul runs on permits, which is precisely what these caps do not cover), the conflict is narrow and concentrated in the low-cap LCV states:

| state | cap | trailers over | worst excess |
|---|--:|--:|--:|
| Oklahoma | 40,823 | 57 | +14,677 kg |
| Idaho | 47,854 | 36 | +7,646 kg |
| Colorado | 49,895 | 15 | +5,605 kg |
| Oregon | 47,854 | 14 | +2,146 kg |
| all Standard states | 36,287 | 1–2 | +2,013 kg |
| NV · UT · MT · WY · WA | — | 0 | — |

Oklahoma is the sharp case: chain-legal for `rmdouble`, `tpdouble` and `triple`, but capped at 90,000 lb — well under what those trailers are rated to carry. Nevada, Utah, Montana, Wyoming and Washington have no conflict at all, so their LCV advantage is real as modelled.

**Unverified in game**: whether ATS enforces these caps on AI-driver freight at all. Measure before modelling — tracked as Q44 in `docs/game-data-questions.md`, which also carries the ETS2 half (Finland reaches 105,000 kg) and the body types where weight already binds.

## Caveats

**`chain_type: triple` on a lowboy is not a road train.** Resolved from the defs — see the table above. No data change warranted, and the 31% `lowboy` haul-value contribution these rigs make is legitimate.

**`ATS_COUNTRY_DISPLAY_NAMES`** was empty until 2026-08-23, so the trailer browser rendered state validity as raw ids (`new_mexico`). Now populated for all 20 states.
