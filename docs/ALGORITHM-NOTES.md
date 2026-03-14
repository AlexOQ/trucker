# Algorithm Notes

Living document tracking known simplifications, missing data, and potential improvements to the optimization model.

## Current Model Summary

The optimizer maximizes expected fleet income by Monte Carlo simulation of job boards. Each depot spawns random cargo weighted by `prob_coef`, drivers pick the best job they can haul, and the greedy algorithm selects body types that maximize marginal EV across 20K simulations.

**What we model**: cargo value, fragile/high-value bonuses, unit capacity per trailer, spawn probability, inter-driver job competition.

**What we don't model**: distance-based income bonuses.

---

## Known Gap: Distance Bonus Tiers

### The Problem

ETS2 applies a distance bonus to job income in tiers — longer hauls pay proportionally more. The current model uses raw `cargo.value × bonus × units` which is the base job value before distance multipliers.

This is fine **if** all body types have roughly equal access to long-distance routes. But they don't.

### Geographic Route Constraints

Some trailer types have hard geographic boundaries:

- **HCT trailers**: Legal only in Finland and Sweden. An HCT driver in Helsinki can only haul within FI/SE — max route distance is geographically bounded to ~1500km.
- **Double trailers**: Legal in Scandinavia + some EU routes. A double in Sweden can reach Germany, but a double in Spain is bounded to Iberia.
- **Standard trailers**: No restrictions. A standard curtainside in Helsinki can haul to Portugal if the job exists.

### Why This Matters

A standard trailer with access to a 2500km haul may earn more *after distance bonus* than an HCT trailer with higher base capacity but only 800km routes available. The current model would rank the HCT higher because it ignores the distance multiplier entirely.

Concrete example:
- HCT in Helsinki: high units, but jobs capped at ~FI/SE distances → lower distance bonus tier
- Standard in Helsinki: fewer units, but jobs can go to Germany/Spain → higher distance bonus tier
- The standard driver might actually earn more on average

### Blast Radius Assessment

**Where this matters most**:
- Cities near geographic boundaries of restricted trailer zones (Helsinki, Stockholm, Nordic cities generally)
- Any city where HCT or doubles are viable — the optimizer may overvalue them relative to standards
- Rankings could have Nordic cities slightly inflated if HCT/double body types dominate their top-5 fleet picks

**Where this matters least**:
- Central European cities with standard-only fleets — no restricted trailers in the mix
- Cities where the same body types dominate regardless of distance (e.g., if curtainside standard wins everywhere anyway)

### Long Distance Skill — Distance Caps (confirmed from game files)

The `long_dist` skill level directly caps the maximum job distance available to a driver (player or AI):

| Skill Level | Max Distance | Revenue Bonus |
|------------|-------------|---------------|
| 0 (untrained) | 400 km | +0% |
| 1 | 650 km | +5% |
| 2 | 1,000 km | +10% |
| 3 | 1,600 km | +15% |
| 4 | 2,500 km | +20% |
| 5 | 4,000 km | +25% |
| 6 (max) | Unlimited | +30% |

Source: `def/economy_data.sii` (`skill_distance[0..5]` array), extracted 2026-03-07.

**Note**: Community wikis ([Truck Simulator Wiki](https://truck-simulator.fandom.com/wiki/Skills), Steam) report much lower values (250/350/550/850/1100/1500). These are **outdated** — the actual game file has significantly higher caps. The game file values were verified from a fresh extraction of ETS2 v1.53 def folder.

**This is the most impactful missing factor in the model.** The skill doesn't just add a revenue bonus — it gates which jobs exist on the board. A long_dist=1 driver literally cannot see any job over 650km. The distance cap is far more significant than the 5%-per-level revenue bonus because revenue scales linearly with distance.

### Two Independent Distance Constraints

Job distance for an AI driver is capped by **whichever is more restrictive**:

1. **Skill cap**: long_dist level sets hard max (see table above)
2. **Geographic cap**: trailer country_validity limits destination cities, which limits practical max distance

For standard trailers (no country restriction), the skill cap is the only constraint.
For HCT/doubles, both constraints apply — the binding one depends on driver skill and garage location.

Examples at long_dist=6 (skill uncapped):
- HCT in Helsinki: geographically capped at ~800km (FI/SE only)
- Double in Stockholm: geographically could reach Spain (~3000km) but practical routes may cluster shorter
- Standard in Helsinki: uncapped, can reach anywhere

Examples at long_dist=2 (550km skill cap):
- Any trailer from anywhere: capped at 550km regardless of country_validity

### What Data We'd Need

1. ~~**Distance bonus tier table**~~ → FOUND: linear via `driver_revenue_coef_per_km` (0.67), plus skill-level percentage bonus (5% per level)
2. ~~**Skill distance caps**~~ → FOUND: see table above
3. **Job distance distribution per city**: What's the average/max distance for jobs from a given city when the driver has max long_dist skill? This determines the geographic constraint independent of skill.
4. **Country validity → reachable city set mapping**: Which destination cities are available for each trailer's country restriction — computable from existing data.

### Empirical Evidence (Save Game Analysis — 2026-03-14)

Two garages compared from save game `game_20260309_latest.sii`:

**Istanbul** — 5 standard drivers (no doubles/HCT available in Turkey):
- Skills: long_dist 2-3 → max distance cap **550-850 km**
- 46 deliveries, total revenue 2,308,923
- Avg distance: **1,284 km**, avg revenue/delivery: **50,194**
- Avg $/km: **39.1**
- Distance range: 500–3500 km, with 16 deliveries in the 1500-2000km band at **45.8 $/km**
- Note: deliveries exceeding 850km suggest some drivers leveled up to long_dist 4-5 during the observation period

**Stockholm** — 5 drivers (4 with doubles/HCT via slave_trailer):
- Skills: long_dist 1-2 → max distance cap **650-1,000 km** (corrected from community wiki values)
- 59 deliveries, total revenue 990,466
- Avg distance: **546 km**, avg revenue/delivery: **16,788**
- Avg $/km: **30.7**
- Distance range: 130–650 km — **well within long_dist=2 cap of 1,000km**. The 650km max is NOT a skill cap — it's a **geographic/country_validity constraint** (doubles/HCT limited to Nordic + a few countries)

**Key findings**:

1. **Stockholm's 650km cap is a GEOGRAPHIC cap, not a skill cap.** With corrected skill distances (long_dist=2 → 1,000km cap), the Stockholm drivers could see jobs up to 1,000km, but actual max was 650km. This confirms the **country_validity constraint** is the binding one for doubles/HCT in Stockholm — destinations are limited to nearby valid countries.

2. **Istanbul's longer routes are skill-constrained.** Long_dist 2-3 → 1,000-1,600km caps. Observed max 3,500km suggests some drivers leveled up to 4+ (2,500km cap) during the observation period.

3. **Revenue per delivery is 3x**: Istanbul 50k vs Stockholm 17k. This is explained by the combination of: (a) Stockholm drivers using doubles/HCT with geographic caps at ~650km, and (b) Istanbul standard drivers having unlimited geographic reach with 1,000-1,600km skill caps.

4. **The revenue formula**: `payout ≈ fixed_revenue(600) + cargo_base_rate × driver_revenue_coef_per_km(0.67) × distance × (1 + 0.05 × long_dist_level)`. Distance is the dominant variable — doubling distance roughly doubles revenue.

### Trailer Country Validity Zones (from game-defs.json)

| Tier | Country Validity | Max Practical Range |
|------|-----------------|-------------------|
| HCT | Finland, Sweden only | ~600-800km |
| Double/B-double | DK, FI, DE, NL, NO, PT, ES, SE (8 countries) | ~650km observed (Stockholm), likely 1500km+ from central DE |
| Standard | All countries (no restriction) | Unlimited (3500km+ observed) |

Note: 185 of 514 trailers (36%) have country_validity restrictions. All restricted trailers are doubles or HCT.

### Economy Constants (from def/economy_data.sii, extracted 2026-03-07)

```
# Revenue
revenue_per_km_base: 15              (global base rate for all jobs)
fixed_revenue: 600                   (flat base per job, all job types)
revenue_coef_per_km: 0.9             (player freight market rate)
cargo_market_revenue_coef_per_km: 1.0 (player cargo market rate)
driver_revenue_coef_per_km: 0.67     (AI driver freight rate — 74% of player)
driver_cargo_market_revenue_coef_per_km: 0.70  (AI driver cargo market rate)

# Delivery
delivery_window_coefs: [1.0, 1.15, 1.4]  (easy/medium/hard revenue multiplier)
simulation_avg_speed: 62.0 km/h           (used for AI driver time simulation)

# Skill bonuses (each +5% per level, 6 levels, max +30%)
reward_bonus_long_dist: [0.05 × 6]
reward_bonus_fragile: [0.05 × 6]
reward_bonus_valuable: [0.05 × 6]
reward_bonus_urgent: [0.05 × 6]
reward_bonus_level: 0.015                 (per driver level)

# AI driver costs
minimal_driver_salary: 350               (fixed pay per trip — player cost)
fuel_cost_per_km: (1.5, 2.0)             (range for fuel simulation)
driver_maintenance_cost: (1.8, 3.0)      (maintenance + insurance, €/km)
driver_hire_cost: 1500                    (one-time hiring fee)
driver_max_cargo_damage: 6.0%            (decreases with skill)

# Job generation
no_cargo_prob: 0.1                       (10% empty slot probability)
driver_no_return_job_prob: 0.1           (10% deadhead rate, decreases with skill)
driver_skilled_job_prob: 0.8             (80% chance job matches driver skills)
cargo_validity_min: 180 min              (3h min job availability)
cargo_validity_max: 1800 min             (30h max job availability)
```

**No cargo has min/max_distance constraints** — all 359 cargo types have min_distance=0, max_distance=0. Distance constraints come purely from trailer country_validity limiting destination cities.

### AI Driver Job Mechanics (confirmed)

AI drivers operate on a **round-trip model**, not continuous chains:

1. Pick up outbound job at home city → deliver to destination
2. Look for a return job back to home city
3. If no return found, **deadhead home empty**

Source: [SCS Forums](https://forum.scssoft.com/viewtopic.php?t=263727), [Steam community](https://steamcommunity.com/app/227300/discussions/0/864958451540999846/)

This means every job is a round trip: `total_time = 2 × distance / speed + overhead`. Average revenue per cycle is `outbound_pay + P_return × return_pay`.

Drivers tend to pick jobs to the **farthest reachable destination** within their skill cap (community consensus leans this way, not definitively confirmed by SCS).

### Game Job Generation Pipeline (from economy_data.sii and modding docs, 2026-03-14)

#### Source: `def/economy_data.sii`

Parameters we extract:
```
fixed_revenue: 600          (flat base per job — same for all job types in current version)
revenue_coef_per_km: 0.9    (player freight market rate)
driver_revenue_coef_per_km: 0.67  (AI driver rate — 74% of player)
cargo_market_revenue_coef_per_km: 1.0  (player cargo market rate)
```

**Parameters we DON'T extract yet** (verified from actual def/economy_data.sii, 2026-03-07):
```
driver_no_return_job_prob: 0.1    ← 10% base deadhead rate, DECREASES with skill
driver_skilled_job_prob: 0.8      ← 80% chance job matches driver's specialized skills
no_cargo_prob: 0.1                ← 10% chance any job slot stays empty
driver_cargo_market_revenue_coef_per_km: 0.70  ← AI cargo market rate (vs 0.67 freight)
driver_max_cargo_damage: 6.0%     ← max damage, decreases with skill
simulation_avg_speed: 62.0        ← km/h, used for AI driver time simulation
revenue_per_km_base: 15           ← global base rate for all job types
minimal_driver_salary: 350        ← fixed driver salary cost per trip
fuel_cost_per_km: (1.5, 2.0)     ← driver fuel cost simulation
driver_maintenance_cost: (1.8, 3.0) ← maintenance + insurance, €/km
skill_distance[0..5]: [400, 650, 1000, 1600, 2500, 4000]  ← distance caps per skill level
```

**Critical correction**: Previously assumed ~50% deadhead rate. Actual `driver_no_return_job_prob` = **0.1 (10%)**, decreasing with skill. At max skill, deadheading is rare. This makes the throughput model even more favorable — nearly every round trip earns on both legs.

**Critical correction 2**: Community wikis reported skill distance caps of [250, 350, 550, 850, 1100, 1500]. Actual game file values are **[400, 650, 1000, 1600, 2500, 4000]** — roughly 2x higher at every level. This significantly changes the Stockholm save game analysis: long_dist=2 drivers can see jobs up to 1000km (not 550km), which is consistent with the observed 648km max in the save data.

Source: `def/economy_data.sii` extracted from ETS2 v1.53 game archives (2026-03-07)

#### Job Slot Generation (per depot)

1. **Job slots per depot are NOT a constant.** Determined by physical trailer spawn points in the company's 3D prefab model. Ranges from **1 to 11** per depot. Our optimizer uses `JOBS_PER_DEPOT = 3` as approximation.
2. For each slot, roll `no_cargo_prob` (10%) — if hit, slot stays empty
3. Select cargo from company's `cargo_out` list via weighted random draw (weights = `prob_coef`)
4. Select compatible trailer + chain combination for the cargo's `body_types`
5. Select destination from valid receiving companies (those with the cargo in `cargo_in`) **randomly** within driver's distance range — **no supply/demand weighting**
6. Set urgency level (Easy/Medium/Hard with delivery_window multipliers)

Source: [SCS Modding Wiki: cargo_data](https://modding.scssoft.com/wiki/Documentation/Engine/Units/cargo_data), [Steam discussions](https://steamcommunity.com/app/227300/discussions/0/3763353492964544878/)

#### AI Driver Job Selection (least documented area)

1. Driver at home garage city, jobs generated at city's depots
2. Filtered by driver skills:
   - Long Distance skill sets max distance (400-4000km by level, unlimited at 6)
   - ADR skill gates hazardous cargo
   - `driver_skilled_job_prob` (0.8) = probability job matches a specialized skill
3. Selection among qualified jobs: **community evidence suggests preference for longest/most profitable route**, not random. Forum: *"drivers currently seem to prefer the longest possible route available."*
4. Revenue calculated at `driver_revenue_coef_per_km` (0.67x base rate)

Sources: [SCS Forum: Hired driver management](https://forum.scssoft.com/viewtopic.php?t=288609), [SCS Forum: Maximize AI driver profits](https://forum.scssoft.com/viewtopic.php?t=201679)

#### Revenue Formula (complete, from Truck Simulator Wiki)

```
Total = Fixed_Reward + Base_Reward × (1 + skill_bonuses)

Base_Reward = units × unit_reward_per_km × distance × job_type_coef
  where job_type_coef = 0.67 (AI driver) | 0.9 (freight) | 1.0 (cargo market)

Skill bonuses (each 5% per level, max 30%):
  + long_dist bonus:  base × 0.05 × long_dist_level
  + fragile bonus:    base × 0.05 × fragile_level    (if cargo is fragile)
  + valuable bonus:   base × 0.05 × valuable_level   (if cargo is valuable)
  + urgency bonus:    base × 0.05 × urgent_level     (if urgent delivery)
  + level bonus:      base × 0.015 × driver_level    (caps around level 67)
```

Source: [Truck Simulator Wiki: Economy](https://trucksimulator.wiki.gg/wiki/Economy)

#### Key Modding References

| Tool | Purpose | URL |
|------|---------|-----|
| SCS Modding Wiki | Official game data docs | [modding.scssoft.com](https://modding.scssoft.com/wiki/Documentation/Engine/Game_data) |
| ETS2Sync-Helper-4 | Save game job parser (C++) | [GitHub](https://github.com/DaviMedrade/ETS2Sync-Helper-4) |
| Virtual Speditor | Save-game job editor | [SCS Forum](https://forum.scssoft.com/viewtopic.php?t=199114) |
| Mods Studio 2 | Visual cargo mod editor | [mods.studio](https://www.mods.studio/docs/references/scs-cargo) |

### Throughput Model — Why Per-Job Analysis Is Wrong

The initial distance analysis (see Quantified Error section below) compared per-job revenue: "a standard job at 2000km earns more than an HCT job at 600km." But that's the wrong comparison. The correct metric is **revenue per unit time**:

```
revenue_per_hour = (outbound_pay + P_return × return_pay) / (2 × D / speed + overhead)
```

Since `pay ≈ 600 + rate × D` and `time ≈ 2D/speed + O`:
- Both revenue and time scale linearly with distance → **distance largely cancels out**
- What survives: `rate` (cargo_value × units × 0.67) — **HCT's 2x unit advantage holds**
- Secondary effects:
  - `fixed_revenue (600)` collected ~1.9× per round trip (with 90% return rate) → slightly favors short routes (HCT)
  - `overhead` per cycle → slightly favors long routes (amortized over more km)
  - `deadhead penalty` → only ~10% of trips (not 50% as previously assumed) → minimal effect

Updated with `driver_no_return_job_prob = 0.1`: P_return ≈ 0.9, so `avg_revenue ≈ outbound + 0.9 × return`. Net result: the throughput model **favors HCT** because unit count dominates, the return job is almost guaranteed, and shorter routes collect the fixed_revenue bonus more frequently.

### Blast Radius — Final Assessment

#### The model is approximately correct

The unit-based optimization (`cargo.value × bonus × units`) is a reasonable proxy for revenue per hour because distance cancels in the throughput equation. HCT's higher unit count translates to higher throughput despite shorter routes. The deadhead penalty and fixed revenue collection both slightly favor shorter routes, which if anything makes HCT slightly *better* than the model predicts.

#### Remaining uncertainties

1. **~~Return job availability~~**: ~~The 50% return rate is a global average.~~ **RESOLVED**: `driver_no_return_job_prob = 0.1` (10% base deadhead, decreasing with skill). At max skill, deadheading is rare for all trailer types. This uncertainty is now minor — the 90%+ return rate means return job availability doesn't significantly differentiate HCT from standard.

2. **Destination selection within the zone**: Community evidence suggests AI drivers prefer the **farthest available** route, not random. Since pay and time both scale with distance, this still mostly cancels in throughput terms. But it means HCT drivers systematically pick ~600km routes while standard drivers pick ~2000km+ routes — the distance difference is real but throughput-neutral.

3. **Overhead per job**: If loading/unloading + route setup is significant (say 2+ game hours), short-route drivers waste more time on overhead per km. This slightly favors standard. But ETS2 AI driver overhead appears to be small relative to travel time.

4. **Job slots per depot**: Our optimizer uses `JOBS_PER_DEPOT = 3` but actual game uses physical trailer spawn points (1-11 per company prefab). This affects the density of the job board but shouldn't systematically bias one trailer tier over another.

5. **`no_cargo_prob = 0.1`**: 10% of job slots are empty. We don't model this — our MC sim always fills every slot. Effect is minor: reduces overall EV by ~10% equally across all body types.

#### What should change

**Nothing in the optimizer.** The current unit-based model is a reasonable approximation for revenue per hour. The distance asymmetry is real but largely offset by throughput effects.

**Consider adding a disclaimer** on the trailers page that HCT/double "Total HV" numbers aren't directly comparable to standard Total HV due to geographic constraints — but fleet recommendations account for this implicitly through the throughput model.

#### Gap: Long Distance Skill Not Modeled

The optimizer assumes max skill (long_dist=6, unlimited distance). This is the correct assumption for endgame optimization. Not modeling skill progression for new garages is a deliberate simplification, not a bug.

### Quantified Error (computed 2026-03-14)

Using haversine distances × 1.3 road factor for all 341 game cities, computing average destination distance per trailer tier from each origin:

**HCT (FI/SE only) — model is catastrophically wrong:**

| Origin | Std avg dist | HCT avg dist | HCT/Std | Model says HCT is | Reality |
|--------|-------------|-------------|---------|-------------------|---------|
| Helsinki | 2,288 km | 556 km | 24% | 2.0x better | **0.49x** (std wins) |
| Stockholm | 2,013 km | 368 km | 18% | 2.0x better | **0.37x** (std wins) |
| Tampere | 2,381 km | 523 km | 22% | 2.0x better | **0.44x** (std wins) |
| Göteborg | 1,805 km | 657 km | 36% | 2.0x better | **0.73x** (std wins) |

HCT destinations average only 18-36% of the distance that standard trailers can reach. Even with 2x the units, HCT earns roughly **half** what a standard earns. The model overestimates HCT value by **64-82%**. Standard is the correct recommendation for all FI/SE cities.

**Doubles (8 countries) — model is essentially correct:**

| Origin | Std avg dist | Dbl avg dist | Dbl/Std | Model overestimate |
|--------|-------------|-------------|---------|-------------------|
| Helsinki | 2,288 km | 2,415 km | 106% | -6% (model underestimates) |
| Stockholm | 2,013 km | 2,017 km | 100% | 0% |
| Hamburg | 1,488 km | 1,488 km | 100% | 0% |
| Amsterdam | 1,513 km | 1,445 km | 95% | 5% |
| Barcelona | 1,789 km | 1,688 km | 94% | 6% |
| Lisboa | 2,654 km | 2,100 km | 79% | **21%** |

Doubles have near-parity distance for most cities because the 8 valid countries are spread across Europe. The exception is **Lisboa** — Portugal is at the western edge, so double destinations cluster closer while standard destinations include everything east to Turkey/Greece. The 21% overestimate for Lisboa doubles is moderate but real.

**Counterintuitive result for Nordic doubles:** From Helsinki/Stockholm, double destinations actually average *slightly further* than standard destinations. This is because the double-valid countries (DE, NL, NO, ES, PT) are mostly far from Scandinavia, while standard adds many closer eastern European cities. Doubles are correctly valued or slightly undervalued by the model for Nordic cities.

### Conclusion

| Trailer Tier | Affected Cities | Model Error | Action Needed |
|-------------|-----------------|-------------|---------------|
| **HCT** | FI/SE cities (27 cities) | **64-82% overestimate** — recommends wrong tier | Yes — should never recommend HCT over standard |
| **Double** | Most cities | 0-6% — negligible | No |
| **Double (Lisboa)** | Lisboa, possibly other PT edge cities | ~21% overestimate | Low priority |
| **Standard** | All other cities | 0% — no distortion | No |

The blast radius is **narrow but severe**: 27 Finnish/Swedish cities have HCT available, and the model is recommending a tier that earns roughly half of what standard earns. The fix is straightforward — either exclude HCT from optimizer consideration, or apply a distance discount factor of ~0.2-0.3x to HCT body types in FI/SE cities.

### Potential Approaches

- **Quick approximation**: Compute average distance-to-all-reachable-cities per trailer type per origin city, apply as a linear revenue multiplier. Data exists: we have city+country mappings and trailer country_validity.
- **Proper fix**: Model destination cities explicitly in the MC simulation. When generating a job, pick a destination city (weighted somehow), compute distance, multiply revenue by `driver_revenue_coef_per_km × distance`. This needs a destination selection model we don't have.
- **Validation shortcut**: Compare our optimizer's fleet recommendations for Stockholm/Helsinki against what a "smarter" model would recommend. If HCT is being picked over standard curtainside, the model is provably wrong for those cities.
- **Community validation**: Check ETS2 community forums/wikis for AI driver income data or distance mechanics confirmation.

### Open Questions

1. ~~**How does the game select job destinations for AI drivers?**~~ **ANSWERED**: Destinations are selected **randomly** among valid receiving companies within the driver's distance range. No supply/demand weighting. The Stockholm 650km cap is a **geographic/country_validity constraint**, not a skill cap. With corrected distances (long_dist=2 → 1,000km), skill allows 1,000km but geographic boundary limits to ~650km.

2. ~~**Do doubles from Hamburg reach further than doubles from Stockholm?**~~ **ANSWERED**: Yes, position-dependent. The distance analysis shows doubles from Hamburg have near-parity with standard (100%), while Lisboa doubles are 79% of standard distance. But since throughput cancels distance, this doesn't affect fleet recommendations.

3. ~~**Is the long_dist skill bonus applied on top of the distance multiplier, or is it a flat bonus?**~~ **ANSWERED**: Multiplicative on base reward. `bonus = base_reward × 0.05 × skill_level`. At level 6: +30% on top of distance-scaled base. Source: [Truck Simulator Wiki: Economy](https://trucksimulator.wiki.gg/wiki/Economy)

4. **Should we add a "distance penalty" factor to restricted trailers?** Per throughput analysis: **no**. Distance cancels in revenue/hour. The unit-based model is a valid approximation.

5. **Should we extract `driver_no_return_job_prob` and other missing economy params?** Yes — the parser should be updated to extract from `economy_data.sii`: `driver_no_return_job_prob`, `driver_skilled_job_prob`, `no_cargo_prob`, `driver_cargo_market_revenue_coef_per_km`, `simulation_avg_speed`, `revenue_per_km_base`, `skill_distance[]`, `minimal_driver_salary`, `fuel_cost_per_km`, `driver_maintenance_cost`. The raw file is available at `~/Downloads/def.zip`.

6. **How many job slots do real depots have?** Our `JOBS_PER_DEPOT = 3` is a rough approximation. Actual slot counts are in the 3D prefab models (1-11 per depot). Could be extracted from `.scs` archives if needed, but unlikely to bias fleet recommendations.
