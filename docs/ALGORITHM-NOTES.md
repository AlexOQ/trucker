# Algorithm Notes

Living document: known simplifications in the optimization model, game-mechanics reference data, and what remains to verify.

## Model Summary

The optimizer maximizes expected fleet income by Monte Carlo simulation of job boards. Each depot spawns random cargo weighted by `prob_coef`, drivers pick the best job they can haul, and the greedy algorithm selects body types maximizing marginal EV across 20K simulations.

**Modeled**: cargo value, fragile/high-value bonuses, unit capacity per trailer, spawn probability, inter-driver job competition.

**Deliberately not modeled**:
- **Distance** — per-hour income reduces to pay/km, which is what HV scores; see The Distance Question below.
- **Skill progression** — max skills assumed (long_dist=6, unlimited distance); correct for endgame optimization.

The player's decision surface is origin city + body types. The model only needs ordinal correctness across those choices; absolute EVs are upper-bound cardinals.

## The Distance Question

**Status (2026-06-07): resolved as approximately correct; one open verification (duty cycle).**

Game pay scales linearly with distance (`pay ≈ fixed_revenue(600) + units × rate × 0.67 × D`) while the model's HV score has no distance term. Whether that's a bug depends on the frame.

### Per-hour: distance cancels

```
revenue_per_hour = (outbound_pay + P_return × return_pay) / (2 × D / speed + overhead)
```

Pay and cycle time both scale with D, so D cancels; what survives is `rate = cargo_value × units × 0.67` — exactly what the optimizer maximizes. Secondary terms, none of which reorder candidates:

- `fixed_revenue` (600/job) collected ~1.9× per round trip (90% return rate) → slightly favors short routes
- Deadhead (`driver_no_return_job_prob = 0.1`, decreasing with skill) → flat ~5% of km unpaid, body-type-independent
- Per-km fuel/maintenance costs → identical per hour across body types (same `simulation_avg_speed`)
- Urgency multipliers, skill bonuses → body-type-independent

### Per-job asymmetry (data, computed 2026-03-14)

Per-*trip* pay is not income — these ratios cancel per-hour — but the distance data is real and drives the duty-cycle question. Haversine × 1.3 road factor across all 341 cities, average destination distance per trailer tier:

**HCT (FI/SE only):**

| Origin | Std avg dist | HCT avg dist | HCT/Std | Per-hour model says | Per-job pay ratio |
|--------|-------------|-------------|---------|--------------------|-------------------|
| Helsinki | 2,288 km | 556 km | 24% | 2.0x | 0.49x |
| Stockholm | 2,013 km | 368 km | 18% | 2.0x | 0.37x |
| Tampere | 2,381 km | 523 km | 22% | 2.0x | 0.44x |
| Göteborg | 1,805 km | 657 km | 36% | 2.0x | 0.73x |

**Doubles (8 countries):**

| Origin | Std avg dist | Dbl avg dist | Dbl/Std |
|--------|-------------|-------------|---------|
| Helsinki | 2,288 km | 2,415 km | 106% |
| Stockholm | 2,013 km | 2,017 km | 100% |
| Hamburg | 1,488 km | 1,488 km | 100% |
| Amsterdam | 1,513 km | 1,445 km | 95% |
| Barcelona | 1,789 km | 1,688 km | 94% |
| Lisboa | 2,654 km | 2,100 km | 79% |

Doubles have near-parity everywhere; Lisboa is the only notable edge (PT at the western boundary). Counterintuitively, Nordic double destinations average slightly *further* than standard — the double-valid countries (DE, NL, NO, ES, PT) are mostly far from Scandinavia.

### Empirical evidence (save `game_20260309_latest.sii`, analyzed 2026-03-14)

| Garage (5 drivers) | Trailers | long_dist | Deliveries | Revenue | Avg dist | Rev/delivery | $/km | Dist range |
|---|---|---|---|---|---|---|---|---|
| Istanbul | standard | 2–3 (→4–5) | 46 | 2.31M | 1,284 km | 50.2k | 39.1 | 500–3,500 |
| Stockholm | 4× doubles/HCT | 1–2 | 59 | 990k | 546 km | 16.8k | 30.7 | 130–650 |

- Stockholm's 650 km max is a **geographic cap**, not a skill cap (long_dist=2 allows 1,000 km) — country_validity binds for doubles/HCT there
- Istanbul's 3,500 km max implies drivers leveled to long_dist 4+ mid-window
- 3x revenue/delivery gap matches linear-distance payout
- Delivery counts feed the duty-cycle question below

### Open verification — duty cycle

The per-hour cancellation assumes a short-route driver completes proportionally more trips per game-hour (no large per-trip overhead). Supporting: long-term in-game observation shows AI drivers near-always loaded with top-of-board cargo, rarely idle or empty. Contrary: in the save comparison above, Stockholm routes are 2.35x shorter but logged only 1.28x the deliveries (pure distance-scaling predicts ~108, not 59) — confounded by garage purchase dates, skill levels, and unequal observation windows. Decisive measurement: one save, equal window, deliveries-per-game-day regressed on average route distance; the save delivery log already contains the needed timestamps.

### Verdict

| Trailer tier | Per-job pay vs standard | Per-hour verdict | Action |
|---|---|---|---|
| **HCT** (FI/SE, 27 cities) | 0.37–0.73x (distance-capped) | ~2x — units advantage survives | None, pending duty-cycle check |
| **Double** | 0.79–1.06x (Lisboa at low end) | Correctly valued | None |
| **Standard** | baseline | baseline | None |

### Contingency (only if the duty-cycle check fails)

- **Quick approximation**: average distance-to-reachable-cities per trailer type per origin, applied as a linear revenue multiplier — computable from existing city/country + country_validity data
- **Proper fix**: model destination cities in the MC (pick destination, compute distance, scale revenue) — needs a per-city job distance distribution we don't have
- **Validation shortcut**: compare Stockholm/Helsinki recommendations against a distance-aware model; if rankings agree, no fix needed

## Game Mechanics Reference

Single source for game-file facts. Extracted from ETS2 v1.53 `def/economy_data.sii` (2026-03-07) unless noted.

### Economy constants

```
# Revenue
revenue_per_km_base: 15 †            (global base rate for all jobs)
fixed_revenue: 600                   (flat base per job, all job types)
revenue_coef_per_km: 0.9             (player freight market rate)
cargo_market_revenue_coef_per_km: 1.0 (player cargo market rate)
driver_revenue_coef_per_km: 0.67     (AI driver freight rate — 74% of player)
driver_cargo_market_revenue_coef_per_km: 0.70 † (AI driver cargo market rate)

# Delivery
delivery_window_coefs: [1.0, 1.15, 1.4]  (easy/medium/hard revenue multiplier)
simulation_avg_speed: 62.0 km/h †        (AI driver time simulation)

# Skill bonuses (each +5% per level, 6 levels, max +30%)
reward_bonus_long_dist / fragile / valuable / urgent: 0.05 per level
reward_bonus_level: 0.015                (per driver level, caps ~level 67)
skill_distance[0..5]: [400, 650, 1000, 1600, 2500, 4000] † (km caps; level 6 = unlimited)

# AI driver costs
minimal_driver_salary: 350 †             (fixed pay per trip — player cost)
fuel_cost_per_km: (1.5, 2.0) †
driver_maintenance_cost: (1.8, 3.0) †    (maintenance + insurance, €/km)
driver_hire_cost: 1500                   (one-time hiring fee)
driver_max_cargo_damage: 6.0% †          (decreases with skill)

# Job generation
no_cargo_prob: 0.1 †                     (10% empty slot probability)
driver_no_return_job_prob: 0.1 †         (10% deadhead rate, decreases with skill)
driver_skilled_job_prob: 0.8 †           (80% chance job matches driver skills)
cargo_validity_min/max: 180 / 1800 min   (job availability window)
```

† = not yet extracted by `parse-game-defs.ts` (raw file at `~/Downloads/def.zip`).

**Community sources are wrong on two of these**: wikis report skill distance caps of 250/350/550/850/1100/1500 ([fandom](https://truck-simulator.fandom.com/wiki/Skills)) — actual values are ~2x higher; community lore assumes ~50% deadhead rate — actual is 10%, decreasing with skill.

### Distance constraints

Job distance is capped by whichever is more restrictive:

1. **Skill cap** — `skill_distance` above. The cap gates which jobs *exist on the board* (a long_dist=1 driver cannot see any job over 650 km) — far more significant than the 5%/level revenue bonus.
2. **Geographic cap** — trailer `country_validity` limits destination cities. 185 of 514 trailers (36%) are restricted, all doubles/HCT:

| Tier | Country validity | Max practical range |
|------|-----------------|---------------------|
| HCT | FI, SE only | ~600–800 km |
| Double/B-double | DK, FI, DE, NL, NO, PT, ES, SE | ~650 km observed (Stockholm), likely 1,500 km+ from central DE |
| Standard | unrestricted | unlimited (3,500 km+ observed) |

No cargo has min/max_distance constraints (all 359 cargo types at 0/0) — distance limits come purely from trailer country_validity.

### AI driver job mechanics

- **Round-trip model, not chains**: outbound job from home city → attempt a return job → deadhead home if none (10% base, less with skill). Cycle time `= 2 × D / speed + overhead`; cycle revenue `= outbound + P_return × return`. Sources: [SCS Forums](https://forum.scssoft.com/viewtopic.php?t=263727), [Steam](https://steamcommunity.com/app/227300/discussions/0/864958451540999846/)
- **Job selection**: community evidence says drivers prefer the longest/farthest qualifying route. Sources: [SCS Forum t=288609](https://forum.scssoft.com/viewtopic.php?t=288609), [t=201679](https://forum.scssoft.com/viewtopic.php?t=201679)
- **Destination selection**: random among valid receiving companies within distance range — no supply/demand weighting
- Skill filtering: long_dist caps distance, ADR gates hazardous cargo, `driver_skilled_job_prob` (0.8) for specialized-skill matching
- Revenue at `driver_revenue_coef_per_km` (0.67x base)

### Job generation (per depot)

1. Slot count is **not constant** — determined by physical trailer spawn points in the company's 3D prefab (1–11 per depot). Optimizer approximates with `JOBS_PER_DEPOT = 3`.
2. Per slot: roll `no_cargo_prob` (10% empty)
3. Cargo drawn from company `cargo_out` weighted by `prob_coef`
4. Compatible trailer + chain selected for the cargo's `body_types`
5. Destination drawn randomly from valid receivers within distance range
6. Urgency assigned (easy/medium/hard, `delivery_window_coefs`)

Sources: [SCS Modding Wiki: cargo_data](https://modding.scssoft.com/wiki/Documentation/Engine/Units/cargo_data), [Steam](https://steamcommunity.com/app/227300/discussions/0/3763353492964544878/)

### Revenue formula

```
Total = fixed_revenue + Base × (1 + skill_bonuses)
Base  = units × unit_reward_per_km × distance × job_type_coef
        job_type_coef = 0.67 (AI driver) | 0.9 (freight) | 1.0 (cargo market)
skill_bonuses = 0.05 × level each for long_dist / fragile / valuable / urgent
              + 0.015 × driver_level
```

Save-game payouts match this formula. Source: [Truck Simulator Wiki: Economy](https://trucksimulator.wiki.gg/wiki/Economy)

## Remaining Minor Gaps

- `no_cargo_prob = 0.1` not modeled — uniform ~10% EV haircut, no reordering
- `JOBS_PER_DEPOT = 3` vs actual 1–11 physical spawn points — affects board density, no systematic tier bias; extractable from `.scs` prefabs if ever needed
- Parser should extract the †-marked economy constants above
- Trailers page: HCT/double "Total HV" isn't directly comparable to standard per-trip — consider a disclaimer; fleet recommendations already account for it via the throughput model

## References

| Tool | Purpose | URL |
|------|---------|-----|
| SCS Modding Wiki | Official game data docs | [modding.scssoft.com](https://modding.scssoft.com/wiki/Documentation/Engine/Game_data) |
| ETS2Sync-Helper-4 | Save game job parser (C++) | [GitHub](https://github.com/DaviMedrade/ETS2Sync-Helper-4) |
| Virtual Speditor | Save-game job editor | [SCS Forum](https://forum.scssoft.com/viewtopic.php?t=199114) |
| Mods Studio 2 | Visual cargo mod editor | [mods.studio](https://www.mods.studio/docs/references/scs-cargo) |
