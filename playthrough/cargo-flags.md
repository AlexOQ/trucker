# Cargo flag tracking — game-observed vs parser-derived

Companion to [GH issue #269](https://github.com/AlexOQ/trucker/issues/269). When Howie sees a cargo on a job board, note whether it carries the in-game `[fragile]` / `[HV]` / `[urgent]` / `[important]` tag and add a row here. Builds the empirical truth set for fixing the parser.

## Working threshold hypothesis

`fragility >= 0.75` for the real in-game [fragile] tag. The parser's `fragility >= 0.5` over-flags ~146 cargoes that aren't actually fragile-gated. No 0.75–0.79 cargo observed yet to refine the cutoff.

**Parser flag accuracy summary:**
- `fragile` field — **WRONG** (over-flags by ~146 cargoes)
- `high_value` field — **CORRECT** (matches in-game [HV] tag in all observations) → use directly
- `adr_class` field — presumed correct, not yet board-tested

Data points so far (4):

| Cargo | fragility | parser fragile | parser HV | in-game [fragile] | in-game [HV] | Verdict |
|---|---|---|---|---|---|---|
| mtl_coil | 0.6 | true | false | **NO** | NO | Parser fragile WRONG; HV correct |
| shock_absorb | 0.69 | true | false | **NO** | NO | Parser fragile WRONG; HV correct |
| packag_food | 0.8 | true | false | **YES** | NO | Parser correct on both |
| disc_harrows | 0.6 | true | **true** | **NO** | **YES** | Parser fragile WRONG; HV correct ✓ first HV board observation |

## Confirmed FRAGILE (in-game tag observed)

| Cargo ID | fragility | Source job |
|----------|-----------|------------|
| `packag_food` | 0.8 | Linköping (Freyr) → Gävle 2026-05-19 — **delivered: Fragile r1 paid +4.67% (433/9276 base) + 22% XP — skill firing confirmed** |

## Confirmed NOT FRAGILE (appeared on board, no in-game tag, parser says fragile=true)

| Cargo ID | fragility | Source job |
|----------|-----------|------------|
| `mtl_coil` | 0.6 | Kiel board 2026-05-18 (job offered without [fragile], user confirmed not gated) |
| `shock_absorb` | 0.69 | Plovdiv board 2026-05-17 (Job 1 alternative, no [fragile] tag) |
| `disc_harrows` | 0.6 | Dombås (Renar) board 2026-05-19 — showed [HV] only, no [fragile]. Parser fragile=true (WRONG), HV=true (correct). |

## Confirmed HIGH VALUE (in-game [HV] tag observed)

| Cargo ID | Source job | Parser HV |
|----------|------------|-----------|
| `disc_harrows` | Dombås (Renar) board 2026-05-19 — first observed HV board offering after HV r1 unlocked | true ✓ |

## Confirmed NOT FRAGILE (parser also says fragile=false — control group)

These are cargoes seen on boards where parser says `fragile=false` and game shows no tag — agreement, no parser bug. Listed for completeness.

`post_packag`, `atl_cod_flt`, `caviar`, `chicken_meat`, `canned_tuna`, `alu_ingot`, `used_plast`, `desinfection`, `vent_tube`, `scrap_metals`, `plastic_gra`

## Workflow

When a new job appears on the board:
1. Note cargo name + in-game flag (or no flag).
2. Look up cargo ID + parser flags in `public/data/ets2/game-defs.json`.
3. If the in-game flag and parser flag disagree, add a row here.
4. Periodically dump consolidated findings into a comment on issue #269.
