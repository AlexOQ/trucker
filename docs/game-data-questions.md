# Game Data Questions

Questions to verify once extracted game definition files are received.

## Cargo (def/cargo/)

1. [ANSWERED] Is `group[]` the array that contains `fragile` token for Fragile Cargo skill? (vs `fragility` float which is damage sensitivity)
   - **Answer**: No. `fragility` float is used: `fragile: fragility >= 0.7` (corrected from the earlier `>= 0.5` guess — the in-game [fragile] tag gate was empirically confirmed at 0.7, see #269: 0.69 cargo are untagged, 0.71 are tagged and pay the Fragile skill bonus). Default fragility is 1.0 when not specified (all 25 cargo without explicit fragility are inherently fragile). `group[]` contains tokens like `machinery`, `adr`, `oversize`, etc. but is not used for the fragile skill check.
2. [ANSWERED] Does `valuable: true` correspond to the High Value Cargo skill requirement?
   - **Answer**: Yes. Parser maps `valuable: true` directly to `high_value: true`.
3. [ANSWERED] What are all possible `body_types[]` tokens across all cargo? (curtainside, dryvan, refrigerated, flatbed, etc.)
   - **Answer**: Extracted dynamically by the parser from all cargo defs. Body types match between cargo and trailers via `body_type` field matching.
4. [OPEN] What are all possible `group[]` tokens? (machinery, adr, containers, refrigerated, liquid, fragile, construction, bulk, oversize — any others?)
5. [ANSWERED] Are `adr_class` values 1-9 matching real ADR classes, or game-specific?
   - **Answer**: Parser extracts `adr_class` as a number. Values correspond to real ADR classes (1-9).
6. [ANSWERED] Does `prob_coef` default to 1.0 when not specified? What's the range in practice?
   - **Answer**: Yes. Parser defaults to 1.0 when not specified. Range is 0.3-2.0 in practice, most cargo at 1.0.
7. [ANSWERED] What percentage of cargo has `minimum_distance` or `maximum_distance` set? What are typical values?
   - **Answer**: Parser extracts both fields (defaults to 0 when unset). Present in game defs for distance-restricted cargo.
8. [ANSWERED] Is `overweight` a separate flag from `oversize`, or are they the same thing?
   - **Answer**: Parser treats them as related: `overweight: id === 'overweight' || groups.includes('oversize')`. Both overweight cargo and oversize-group cargo are excluded from optimizer (not AI driver eligible).
9. [ANSWERED] Are there cargo definitions split across DLC .scs files, or are they all in def.scs? (Forum suggested some like "canned pork" are in dlc_east.scs)
   - **Answer**: Parser reads a single extracted `def/` folder. DLC .scs archives must be extracted alongside base def/. The parser tracks DLC cargo via `CARGO_DLC_PACKS` mapping and source file analysis.

## Trailers (def/vehicle/trailer_defs/)

10. [ANSWERED] What are all `body_type` tokens used across trailer defs? Do they exactly match the cargo `body_types[]` tokens?
    - **Answer**: Yes. Parser matches trailers to cargo by checking `cargo.body_types.includes(trailer.body_type)`.
11. [ANSWERED] What `country_validity[]` restrictions exist? Which trailers have them?
    - **Answer**: Parser extracts `country_validity` as string array. Typically restricts certain trailers (e.g., HCT) to specific countries.
12. [ANSWERED] What are the `length` values for trailers that have them? Which trailers are "long" (doubles, HCTs)?
    - **Answer**: Parser extracts `length`. Multi-unit configurations (doubles, HCTs, triples) are identified first-class via the `chain_type` and `axles` fields (#250) — no ID-keyword heuristics.
13. [ANSWERED] What is `chain_type` and what values does it take? How does it affect job generation?
    - **Answer**: Parser extracts `chain_type` (defaults to `'single'`). **ETS2 values**: `single`, `double`, `b_double`, `hct`. **ATS values**: `single`, `double`, `bdouble`, `rmdouble`, `tpdouble`, `triple`. The trailer browser groups by `chain_type` directly, labels each configuration via `chainConfigLabel()`/`CHAIN_LABELS` and orders them via `CHAIN_ORDER` (`utils.ts`); per-trailer axle totals come from the `axles` field (#250).
14. [ANSWERED] Can we compute exact unit counts as `floor(trailer_volume / cargo_volume)`? Or does the game use a different formula?
    - **Answer**: Yes. Parser computes `floor(trailer_volume / cargo_volume)` as primary method, with weight-limit cap when `gross_weight_limit` applies.
15. [ANSWERED] Do weight limits ever cap units below what volume allows? (i.e., `gross_trailer_weight_limit` minus `chassis_mass` minus `body_mass` = max cargo weight, then `max_cargo_weight / cargo_mass` might be less than volume-based units)
    - **Answer**: Yes. Parser implements this: `maxCargoWeight = gross_weight_limit - chassis_mass - body_mass`, then `weightUnits = floor(maxCargoWeight / cargo_mass)`. Final units = `min(volumeUnits, weightUnits)`.
16. [ANSWERED] Are there trailers that are NOT ownable? How is that determined — is it a flag in the trailer def or separate?
    - **Answer**: Parser reads from `def/vehicle/trailer_defs/` which are ownable. Non-ownable trailers are in `def/vehicle/trailer/` directory and are not parsed.

## Depots / Prefabs

17. [OPEN] Where is `allowed_trailer_length` defined? Is it in depot prefab data (map files) or somewhere in def/?
18. [OPEN] Is `allowed_trailer_length` per-company, per-city, or per-depot instance?
19. [OPEN] Can we extract it from .scs files, or is it baked into map binary data?

## Companies (def/company/)

20. [ANSWERED] Do `def/company/<name>/out/*.sii` files list all cargo a company ships? Is this the ground truth for our `company_cargo` map?
    - **Answer**: Yes. Parser reads `def/company/<name>/out/` directory to build `cargo_out` list. Also reads `in/` for `cargo_in`.
21. [ANSWERED] Do `def/company/<name>/editor/*.sii` files contain city placement data? Is this the ground truth for `city_companies`?
    - **Answer**: Yes. Parser reads `editor/` directory for `company_def` units with `city` property to build city-company mappings.
22. [N/A] Are company depot counts (our `city_companies[city][company] = count`) derivable from game defs, or only from save game observation?
    - **Note**: Parser derives count from editor files (typically 1 per city-company pair). Observations.json supplements with actual observed counts.

## Economy (def/economy_data.sii)

23. [ANSWERED] What is the full payment formula? We believe: `€600 + (units × unit_reward_per_km × route_km × market_coef) + bonuses`
    - **Answer**: Parser extracts `fixed_revenue` and `revenue_coef_per_km` from `economy_data.sii`. The optimizer uses `unit_reward_per_km` (per-cargo value) as the primary value metric rather than computing full route-based payments.
24. [ANSWERED] What are the `revenue_coef_per_km` values? (believed: 0.9 freight market, 1.0 cargo market, 0.67 AI drivers)
    - **Answer**: Parser extracts `revenue_coef_per_km` from economy data. Exact values come from the game file.
25. [OPEN] Are there other economy coefficients that affect job value?

## DLC Structure

26. [ANSWERED] Does each DLC .scs follow the same `def/cargo/`, `def/vehicle/`, `def/company/` structure?
    - **Answer**: Yes. All DLC content follows the same directory structure. Parser processes the unified extracted `def/` folder.
27. [ANSWERED] Do DLC cargo/trailer defs override or extend base game defs?
    - **Answer**: They extend. DLC adds new cargo/trailer IDs; doesn't override base game definitions.
28. [N/A] Is there a manifest or index that lists which DLCs are installed?
    - **Note**: Parser generates the DLC registry by analyzing trailer brand prefixes, cargo pack mappings, and city-country membership. No game manifest is read.

## Map / Route Data

29. [OPEN] Is there any route distance data extractable from game files? Or is that purely runtime pathfinding?
30. [OPEN] Are city coordinates or connections available in any extractable format?
31. [OPEN] Are city/company node positions stored in map sector files (.mbd/.base)? Can we extract x,z coordinates?
32. [OPEN] Is there a road network graph or adjacency list anywhere? Or do we need node positions + Euclidean approximation?
33. [OPEN] Does the game pre-compute route distances, or pathfind on the fly? If pre-computed, where stored?

## Trucks (def/vehicle/truck/)

36. [ANSWERED] What engine options exist per truck brand? What are the torque/HP/consumption_coef values?
    - **Answer**: Parser extracts engines from `def/vehicle/truck/<brand>/engine/` with torque, hp, consumption_coef, price, unlock level.
37. [ANSWERED] What chassis configs exist per truck? (4x2, 6x2, 6x4, 8x4) — do heavier configs unlock heavy cargo jobs?
    - **Answer**: Parser extracts chassis from `def/vehicle/truck/<brand>/chassis/` with axle config, wheel count, price, unlock level.
38. [ANSWERED] What transmission options exist? How many gears, what differential ratios?
    - **Answer**: Parser extracts transmissions from `def/vehicle/truck/<brand>/transmission/` with forward/reverse gear counts, differential ratio, retarder, price, unlock level.
39. [OPEN] Is there a direct relationship between axle config and max cargo weight in game mechanics?
40. [ANSWERED] Does `consumption_coef` scale linearly with fuel usage? What's the base consumption formula?
    - **Answer**: Parser extracts `consumption_coef` per engine. Exact formula relationship to fuel usage is a game mechanic question, but the coefficient is available.
41. [ANSWERED] Are retarders defined per truck or as universal accessories?
    - **Answer**: Per-transmission. Parser extracts `retarder` value from each transmission definition.
42. [OPEN] What fuel tank size options exist per chassis config?
43. [ANSWERED] Is there data on truck price, unlock level, or maintenance cost in the defs?
    - **Answer**: Parser extracts `price` and `unlock` for engines, transmissions, and chassis. Maintenance cost is not extracted.

## Derived Calculations (to validate)

34. [OPEN] Can we compute per-city cargo spawn probability as: `prob_coef × (reachable_destinations / total_destinations)`?
    - Where reachable = destinations accepting that cargo within min/max distance range
    - This would let us estimate spawn rates from game defs + city positions alone
35. [OPEN] How well does this calculated probability match our observed `company_cargo_frequency`?
    - If close: observations become optional validation layer
    - If divergent: game has additional hidden factors (market randomness, player level, etc.)

## In-Game Verification Queue (opened 2026-08-23)

Questions the def files cannot settle — each needs an observation from a running
game. Recorded from the ATS DLC validation pass; see `docs/ats-state-restrictions.md`
for the trailer-legality data these sit on top of.

### Both games

44. [OPEN] **Do `mass_limit_per_axle_count` caps apply to AI-driver freight?** Every
    `def/country/<x>.sui` in both games declares a whole-combination GVW ladder indexed
    by axle count, and the parser reads none of it — `game-defs.json`'s `countries`
    section holds only `name`. Units are capped on the trailer's own
    `gross_trailer_weight_limit` alone (`parse-game-defs.ts`, see Q15), so wherever a
    country cap is tighter, haul value is overstated.
    - **ATS spread**: Montana 59,447.9 kg (131,060 lb) down to the federal 36,287.4 kg
      (80,000 lb) in 10 states. Oklahoma is the sharp case — chain-legal for `rmdouble`,
      `tpdouble` and `triple` but capped at 90,000 lb.
    - **ETS2 spread**: Finland 105,000 kg at the top of a 10-rung ladder, Sweden 64,000,
      Netherlands 60,000, Germany and most others 40,000.
    - **Test where weight already binds**, or spare payload will absorb the effect:
      ATS `hopper` (384 of 385 cargo-trailer pairs weight-limited), `bulkfeed` and
      `foodtank` (100%), `flatbed` (824 pairs); ETS2 `dumper` (519 of 798) and `silo`
      (98 of 180). Run the same dense load in a high-cap and a low-cap region and
      compare the units offered.
    - **Note on indexing**: the ladder is indexed by *total combination* axles, not
      trailer axles. An 8-axle ETS2 HCT rated 84 t only fits under Finland's ladder at
      the 11-axle rung (105,000 kg) once a 3-axle tractor is counted.

### ATS

45. [OPEN] **Do the 12 `scs.lowboy.triple_*` rigs appear as ordinary depot board freight?**
    They are purchasable, carry no `country_validity` (correctly — they are
    `tr_articulated_6/7/8/9axle` jeep+lowboy+spreader heavy-haul rigs, not road trains),
    and are the `lowboy` haul-value leader by 31%. If they never spawn as AI-haulable
    board jobs the optimizer is overrating `lowboy` everywhere. Check a depot board that
    offers machinery cargo.
46. [OPEN] **Do California and Illinois actually refuse the `53r`/`53sp`/`53_4o` axle
    variants?** Data says the restriction costs nothing — all 57 have an unrestricted twin
    identical in body type, chain type, volume, weight limit and axle count. Low priority;
    confirms the twin analysis rather than changing anything.

### ETS2

47. [OPEN] **Does a B-double ever out-earn a Double on the same cargo?** Best-per-body-type
    haul values tie exactly on `container`, `dryvan`, `insulated` and `refrigerated`, and
    the Double wins `curtainside` and `silo`; `log` is the only body type where a B-double
    is the best available option, and only because no Double exists for it. On `container`
    the B-double carries 10,380 kg more usable payload for identical haul value — nothing
    in that cargo set is dense enough to use it (heaviest full load 34,800 kg against
    44,120 kg already available). Worth one board comparison to confirm pay tracks haul
    value rather than capacity.
