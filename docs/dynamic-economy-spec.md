# Dynamic economy daemon — spec

**Scope: separate deliverable.** Advisor stays a mod-free calculator and this daemon ships independently of it. The only coupling is read-only: the daemon consumes `public/data/<game>/game-defs.json` and the depot profiles from `trailer-profiles.ts` as its baseline load volumes. Nothing here changes Advisor's build, data, or UI.

Goal: player deliveries move freight rates. Haul into a market and outbound rates there soften; starve an industry and it stops shipping.

## 1. What the engine actually permits

Verified against ETS2 1.60.1.7 defs (`def.scs`, `base_map.scs`, all 80+ `dlc_*.scs`) and a decrypted 1.88 MB `game.sii` autosave.

**There is no mod scripting API.** Defs are read at process start, the save at load, and the economy then runs entirely in memory. Sleeping, job-board refresh and quick travel touch no disk. Every lever below is gated on one of those two reads.

| Record | Fields | Consequence |
|---|---|---|
| `cargo_def` — `def/company/<c>/{in,out}/<cargo>.sii`, 44,935 units | `cargo` only | Company↔cargo is pure set membership. No price, no probability, no city. |
| `company_def` — `def/company/<c>/editor/*.sii`, 1,465 units | `city`, `prefab` | The only per-(company, city) def record carries no economic field. |
| `cargo_data` — `def/cargo/*.sui`, 321 priced | `unit_reward_per_km`, `prob_coef` (7 live) | Rate is global per cargo. `acetylene` is 0.266 €/km everywhere. |
| `country_data` — `def/country/*.sui` | `fuel_price` | One float per country (`germany` = 2.273). |
| `economy_data` — `def/economy_data.sii` | `fixed_revenue: 600`, `revenue_coef_per_km: 0.9`, `delivery_window_coef[] = 1.0 / 1.15 / 1.4` | Global. `fixed_revenue` is the game's short-haul premium. |
| `job_offer_data` — save, 13 fields | `target`, `expiration_time`, `urgency`, `shortest_distance_km`, `ferry_time`, `ferry_price`, `cargo`, `company_truck`, `trailer_variant`, `trailer_definition`, `units_count`, `fill_ratio`, `trailer_place` | **No price field.** Pay is derived at display time. |
| `company` — save, 8 fields | `permanent_data`, `job_offer`, `cargo_offer_seeds`, `state`, … | Each depot instance owns its own offer array. This is the per-depot granularity the def layer refuses. |

Pay, reconstructed: `fixed_revenue + unit_reward_per_km × shortest_distance_km × revenue_coef_per_km × delivery_window_coef[urgency]`, before skill bonuses.

Three usable levers, and only three:

1. **`urgency`** (save, per offer) — selects `delivery_window_coef`. A per-depot pay multiplier of 1.0 / 1.15 / 1.4 with no side effects. The only local price control that exists.
2. **`job_offer` array** (save, per depot) — insert/delete offers. Controls what spawns where.
3. **`unit_reward_per_km` / `fuel_price`** (def, global) — see §2 for why the daemon does not touch these.

`shortest_distance_km` is the only other per-offer numeric feeding pay and is **unusable**: it also drives the displayed distance, so faking a rate through it is visible on the job board.

## 2. Architecture

**The daemon writes only the save.** Static rate balance is delegated to an existing mod ([Realistic Economy by Quper](https://steamcommunity.com/sharedfiles/filedetails/?id=3318908089) — rebalances rates, fuel, fines, garage costs, loans). If the daemon also wrote defs it would collide with that mod on the same files, and def writes require a full game restart.

Consequences, all of them good:

- One tick: main menu → Continue (~20 s), no process restart.
- No mod conflict, and the player's chosen economy mod stays authoritative for baseline rates.
- No def emitter to write or to re-derive on every SCS update.

Prerequisite: `uset g_save_format "2"` in `config.cfg`. The game then reads and writes plaintext `SiiNunit` saves and the daemon needs no AES/zlib/BSII handling at all. Default is `"0"` (binary + `ScsC`-encrypted).

```
[session]  player hauls
   ↓
[tick]     player bounces to main menu
   ↓
[read]     economy.delivery_log → append to ledger, evict past 50
[model]    §3 → rateMult per city
[write]    per depot: set urgency on each job_offer, thin/pad the offer array
   ↓
[resume]   Continue → market has moved
```

## 3. Market model

Real spot rates are set per market by **load-to-truck ratio**, not per commodity. Delivering into a city means one more truck competing for outbound freight there, so outbound rates soften. Commodity gluts barely move real rates; capacity imbalance moves everything. The rolling delivery window is therefore a truck-position ledger, not a cargo tally.

```
trucks(c)   = Σ over ledger entries terminating in c of 0.5 ^ (game_days_since / HALF_LIFE)
loads(c)    = baseline outbound offer volume for c        # from Advisor's depot profiles
LTR(c)      = loads(c) / (1 + trucks(c))
rateMult(c) = clamp( (LTR(c) / LTR_base) ^ ELASTICITY, FLOOR, CEIL )
```

| Constant | Value | Rationale |
|---|---|---|
| `WINDOW` | 50 deliveries | Storage cap. Decay governs behaviour, not this. |
| `HALF_LIFE` | 3 game days | ≈3 sessions at ~4 player jobs / 2 h session. |
| `ELASTICITY` | 0.35 | Convex but damped, matching observed spot-rate response to LTR. |
| `FLOOR` | 0.70 | Carrier operating-cost floor — capacity exits below it in reality, so lanes must not die permanently. |
| `CEIL` | 1.40 | Matches the maximum the engine can express (`delivery_window_coef[2]`). |

### Mapping `rateMult` onto `urgency`

Three discrete steps is what the engine gives, and it reads correctly in-game:

| `rateMult` | `urgency` | coef | In-game reading |
|---|---|---|---|
| > 1.20 | 2 | 1.40 | Tight market — hard deadlines, premium pay |
| 1.05 – 1.20 | 1 | 1.15 | Normal |
| < 1.05 | 0 | 1.00 | Saturated — easy windows, base pay |

A capacity crunch producing urgent freight on tight windows is not a workaround; that is what a crunch is.

### Secondary effects

- **Offer count.** Thin the `job_offer` array at saturated depots and pad it at hot ones, so competition is visible as fewer choices rather than only as lower pay.
- **Chain gating.** Delete a cargo's offers at a depot whose inputs have not been delivered; restore them when fed. Binary and player-legible ("Agrominta stopped shipping produce") where a probability nudge would be invisible. The chains must be **authored** — `cargo_in` in the shipped defs is near-complete bipartite (all 363 cargo have both a producer and consumer; 274/276 companies have non-empty `cargo_in`), so it encodes return-trip plausibility, not industry logic. Budget ~30–50 hand-written recipes.
- **Fuel.** If a future version drifts `fuel_price`, drift rates with it. Real rates carry a fuel surcharge indexed to diesel; ETS2 models fuel as pure cost, so moving it alone is a margin tax, not realism.

## 4. Deliberately out of scope

- **AI driver deliveries do not move the market.** Player-only, by decision — it keeps the player the economic agent and matches the load-to-truck framing, where the player is one truck.
- **Def writing.** Owned by the player's economy mod (§2).
- **Advisor changes.** If Advisor ever wants to display live market state it reads the daemon's output file; the dependency never runs the other way.

## 5. Unverified — resolve before building

| Question | Why it matters |
|---|---|
| Does main menu → Continue re-read `game.sii` from disk? | The entire tick depends on it. ~2 min to test. |
| Does rewriting `job_offer` invalidate an in-progress job or trip an economy reset? | GDC Logistics warns to start a new profile after def changes; the save path may be safer or may not be. |
| `cargo_offer_seeds` (u32 array, per company) semantics | If offer generation is seeded per depot, biasing seeds could replace hand-authoring offers entirely. |
| Does the game validate the `ScsC` HMAC at offset 4? | Moot under `g_save_format "2"`; blocks any re-encrypting variant. |
| ATS parity | Same struct layout expected, unconfirmed. |

## 6. Prior art

Nothing does feedback. [Realistic Economy (Quper)](https://steamcommunity.com/sharedfiles/filedetails/?id=3318908089) is a static rebalance; its "weekly diesel updates" are the author republishing the mod. [GDC Logistics](https://steamcommunity.com/sharedfiles/filedetails/?id=2927412321) advertises a seasonal "Dynamic Freight Market", but no def field in the entire tree can express a value conditional on date — not in `cargo_data`, not in `economy_data`, not in any of the 44,935 `cargo_def` units — so that variation is author-pushed rather than computed in-game. Deduced from the def tree; the store pages were not reachable to confirm.

The [Telemetry SDK](https://github.com/RenCloud/scs-sdk-plugin) is read-only and reports the player's truck only. It is not required by this design — `economy.delivery_log` in the save carries what the ledger needs.
