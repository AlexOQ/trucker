# Routing rules — Iron Horizon Freight

Operational rule set for the copilot's job-recommendation logic. Loaded on `copilot me`. House-rule layer above this in `~/.claude/projects/.../memory/playthrough_house_rules.md` (Volvo-only, max-coverage trailers, etc.). Detailed per-job invocation protocol in `copilot.md`.

This file is the *what to optimize for*. Update when the user adds a new consideration.

---

## R1 — Real /km, not board /km

Board EUR/km is computed on **land distance only**. Ferry distance is invisible.

**How to apply**: before ranking jobs, recompute `pay / (land_km + ferry_km)`. If a ferry is involved, subtract its toll from pay first: `(pay − ferry_cost) / (land_km + ferry_km)`. The result is "net real /km". Board /km is decoration.

## R2 — Direction bias (target-garage rush phase)

We're physically driving toward the next garage city (currently **Helsinki**, then Pori, then Gothenburg). Until remote-garage-purchase unlocks, we accept some pay-efficiency loss in exchange for proximity progress.

**How to apply**: within **±10% net real /km** of the top option, prefer the job that ends closer to the current target garage. Outside that band, pure /km wins.

Deactivates automatically once remote-purchase unlocks. **Trigger condition** (user-confirmed 2026-05-21): after 3 garages owned (Helsinki + Pori + Gothenburg = full rush set), Howie transitions to remote-purchase mode and can buy/expand garages from anywhere on the map. **Phase B framework**: post-rush focus becomes dual — achievements (counter progression) + income — while garage purchases happen passively between jobs as cash flow allows.

## R3 — Verification rotation per job

Every job hits one of: cargo / pickup depot / drop depot / trailer-body / city-DLC / prob_coef sanity. Rotate the dimension across jobs so we cover the verification surface without re-checking the same thing repeatedly.

State of the rotation tracked in `state.md` (last-verified + next-up).

## R4 — Cargo-walking coverage protocol

User-defined 2026-05-19. Goal: build the verification truth set for `game-defs.json` by walking depots and cargoes.

Each encounter (board appearance, delivery) → cross-check against `public/data/ets2/game-defs.json` and update `cargo-walk.md`:
1. City exists in `cities`
2. Company in `companies` AND in `city_companies[city]`
3. Cargo fields (mass, value, fragility, flags, body_types) match the def
4. Source company's `cargo_out` includes the offered cargo
5. Destination company's `cargo_in` includes the delivered cargo
6. Pay formula matches base + L<n> prof + LD r<n> + skill bonuses − damage

Discrepancies surface as rows in the open-questions table — never silently overwrite.

Long-term: the accumulated tracker becomes the navigation tool once remote-garage-purchase is unlocked (no more physical scouting).

## R5 — Rare-cargo bias (within /km tolerance)

User-defined 2026-05-19. The 363 cargo defs aren't equal — some have <20 source companies (rare), others have 100+ (ubiquitous). Walking rares first compresses the verification surface efficiently.

**How to apply**: when evaluating a board, mark each offered cargo as **rare** if its source-company count ≤ ~30 in `cargo-walk.md`'s priority list (excluding ADR-locked cargoes Howie can't see yet). Within **±5% net real /km** of the top option, prefer a rare-cargo pick over a common one. Rare-walk bias is weaker than direction bias (R2) — direction wins ties; rare-walk wins very-close ties.

Combined ordering across R2/R4/R5/R10 lives in **R10's priority ranking** (single source of truth).

## R6 — Hub-company priority

User-defined 2026-05-19. A small set of companies (NCH, Norse Rail, Balkan Loco, RT Log, DFH, Dunavia, Nordic Ports) appear in many rare-cargo source lists. Visiting their cities yields high rare-walk density per leg. See the **Hub companies** table in `cargo-walk.md` for the city map.

**How to apply**:
- Once at a hub city, prefer picking up from the hub company (its cargo_out has the highest rare-walk density).
- When choosing among future garages, weight hub-adjacency (Helsinki ↔ Tallinn NCH ferry = highest single rare-walk gateway in the game).

## R7 — Quiet between jobs

User-defined. Stay silent between job-start and job-finish events unless:
- A decision needs Howie's input.
- An anomaly (under-pay, distance mismatch, parser disagreement, board RNG outlier) is worth surfacing.
- A parser/repo bug becomes evident — flag inline, file issue if needed.
- A cash-flow threshold gets crossed (loan capacity, garage-affordable, target-truck affordable).
- Skill point earned that affects the planned skill-pick priority.

No "what's next" prompts, no recap of the state file, no "let me think about it…" filler.

## R8 — Parser-bug awareness

Known parser issues to NOT trust blindly:
- **`fragile` field** (#269) — derived from `fragility >= 0.5`, wrong. Real gate is `fragility >= 0.75` (best current hypothesis). Always cross-check against in-game `[fragile]` tag, not the parser flag. Track confirmed-vs-not in `cargo-flags.md`.
- **Trailer tier flags** (#250) — `hasDoubles`/`hasBDoubles`/`hasHCT` use ID-keyword scanning; misses ATS triple/rmdouble. Use `tierFromChainType()` instead for ETS2 → tier mapping.
- **ATS cargo-DLC mapping** is empty stub (PR #242). Affects only ATS marginal-value calc, not ETS2.

When in doubt, prefer the source-data fields (`fragility`, `adr_class`, `valuable`, `chain_type`) over the parser-derived flags.

## R10 — Achievements priority (TOP-LEVEL)

User-defined 2026-05-19, hardened 2026-05-19. Achievements always win. Helsinki rush, rare-walk, pay/km — all subordinate. Tracker in `achievements.md`.

**Priority ranking** (revised 2026-05-21 — user codified post-delivery board-scan order):
```
1. Chain-in-progress next-stage cargo → take, override everything (protect chain integrity)
2. Single-leg achievement-advancing job → take (Cattle Drive, Whatever Floats, Sailor-per-marina, HC unique, etc.)
3. Mid-chain BUT no next-stage cargo on board → ASK to sleep for board reroll. Never take a filler that breaks the chain.
4. Phase A garage-rush direction (first 3 garages only — Helsinki/Pori/Gothenburg) — within ±10% net /km, target-ward wins
5. Cargo-walk gap-fill (R4) — board offers unchecked cargo, OR target depot has unchecked cargo_in entries (lots at the start, will dwindle) → take to fill the verification truth set
6. Within ±5% net /km AND walks rare-tier cargo (R5) → rare wins (subset of #5 with explicit rarity bias)
7. Otherwise top net real /km
8. QJ board as escape hatch — when current city board offers nothing useful AND a QJ search-bar filter hits a chain/achievement target (teleport-style, plenty of jobs/countries)
```

**How to apply**:

- **Every board, check every offered job against `achievements.md`.** If any job advances an open achievement, surface it prominently as "TAKE THIS — advances <achievement>".
- For **single-leg achievements** (Cattle Drive, Whatever Floats Your Boat, Michelangelo, Captain, Sailor-per-marina, etc.): take when offered. Pay/km loss is acceptable — these are one-shot pop-ups.
- For **chain achievements** (Going Camping, Orient Express, Holiday Coastline, Iberian Pilgrimage, Above the Arctic Circle, Along the Black Sea, Grand Tour, Industry Standard, Concrete Jungle, etc.):
  - **Start the chain when stage 1 cargo appears** — even mid-rush. Surface it as "STAGE 1 OF <chain> AVAILABLE, want to commit?" so user knows it's a multi-leg trip.
  - Once chain is started: **chain-in-progress next-stage cargo OVERRIDES everything else** including other achievements. Side-jobs reset (Going Camping) or break (Orient Express, etc.) the chain.
  - When chain-in-progress board doesn't show next-stage cargo: **sleep (refresh board) or deadhead-drive to a backup hub** — NEVER take a filler job.
- **Counter-increment** chain progress per delivery; surface state on next interaction ("Iberian Pilgrimage 2/3 — Pamplona left").

**Why** (user's framing): the rush is short-term, achievements are permanent. Helsinki garage isn't going anywhere — it'll still be there after the chain detour. Achievements ARE going somewhere — if you skip stage 1 when it appears, the window may not reopen for many game days.

**Active chain status tracker** (update inline):
- Going Camping: ⬜ not started (uninterrupted-5, sources must be in West Balkans)
- Orient Express: ⬜ not started (uninterrupted-6)
- Above the Arctic Circle: ⬜ not started (sequential-3, perfect-only)
- Holiday Coastline: ⬜ 0/3 (sequential-3, loose — QJ between legs does NOT reset)
- Iberian Pilgrimage: ⬜ 0/3 (interruptible)
- Along the Black Sea: ⬜ 0/4 (any order, perfect-only)
- Grand Tour: ⬜ 0/5 (any order, perfect-only)
- Industry Standard: ⬜ 0/24 (2 deliveries × 12 specific factories; quick jobs count)
- Concrete Jungle: ⬜ 0/10
- Turkish Delight: ⬜ 0/3 (interruptible, ≥2500km each)
- Exclave Transit: ⬜ 0/5 (from Kaliningrad to Russia)

**Quick jobs as a tool**: count for Industry Standard, Holiday Coastline, and (logically) Heavy Cargo + Special Transport. **Going Camping is strict-uninterrupted** (any wrong-cargo delivery resets). Holiday Coastline is loose (QJ between legs OK). Orient Express + Above the Arctic Circle — empirical, treat as strict until proven.

**QJ market is global** — board shows offers from anywhere on the map. Tactic: search-bar filter (cargo / destination / tag) at any QJ board to find the achievement-bound subset. Volvo-only does NOT apply to QJ rentals (see house-rules memory).

## R9 — Skill-point recommendations

Live priority order, **re-ordered 2026-05-19** after R10 (achievement priority) went in. Achievement-gating skills float to the top.

**Completed**:
1. LD r1–r4 ✅
2. Eco r1 ✅
3. Fragile r1 ✅
4. HV r1 ✅
5. **ADR Class 3** (flammable liquids — diesel/petrol/kerosene/LPG) ✅ at L8

**Achievements unlocked by ADR Class 3**: **Gas Must Flow** (diesel/LPG/petrol to French truck stops), **Taste the Sun** (assuming "any ADR" interpretation — verify on first attempt), and the entire chemical-tanker rare-cargo tier at NCH / Norse Rail / Balkan Loco hub companies (acid, sulfuric, hydrochlor, sodchlor, sodium-family — 12-src globally rare).

**Next picks**:
6. **JIT r1** — settles the empirical "time-variant add-vs-roll" question (user-flagged 2026-05-18) AND unlocks the "important" cargo pool. No tracked achievement is JIT-gated, but pool widening has rare-walk value.
7. **ADR Class 7** (radioactive) OR equivalent ADR class required for **Go Nuclear** — verify which class is gate on first nuclear-plant offer. Could be Class 7 strictly, could be any class.
8. **JIT r2** — unlocks "urgent" cargo pool. Modest pay multiplier; another pool widen.
9. **Eco r2** — compounding fuel savings on every km. Universal ROI.
10. **Remaining ADR classes** (1 explosives, 2 gases, 4 flammable solids, 6 toxic, 8 corrosive — whichever subset ETS2 exposes) — unlocks more chemical-pool rare cargo at hub companies. Each class = ~5-10 additional rare cargoes.
11. **LD r5+** — extends distance brackets (3500km+, 4500km+, etc.) but no tracked achievement gates on it (Turkish Delight 2500km legs are within r4 already). Diminishing returns.
12. **Fragile r2+, HV r2+** — pure +5%/rank revenue tuning on already-unlocked pools. Lowest priority.

**Decision logic**: when a skill point lands, work down the list. If a tracked achievement becomes gated on a specific skill not yet in the order, promote it. Cargo-pool-unlock skills always beat bonus-tuning picks.

## R11 — Job-length slider as a meta-tool

User-defined 2026-05-21. ETS2 in-game setting controls average job length 50%–250%. Tune per phase + per active achievement target.

**Phase A (now — garage rush + LD r5 grind)**: default or high slider. Long jobs grow LD skill faster, larger gross/job for cash, more efficient miles per game-day.

**Phase B (post-3-garages, remote-purchase unlocked)**: drop slider to **50%** as the default for count-based achievement farming. Pure-count achievements (Industry Standard 24, Bigger the Better 10, Concrete Jungle 10, Like a Farmer 4, Iberian Pilgrimage 3, Mass-to-don 3-consec, No Pain No Gain 5-consec) accelerate proportionally to job count. Shorter jobs = same counter increment, less time.

**Special sessions**: bump slider to **250%** for **Turkish Delight** farming — 3 × ≥2500km from Istanbul jobs only surface reliably at high slider + LD r4+. Hold high slider until Turkish Delight cleared, then revert.

**Slider-neutral achievements**: HC Pack uniques (cargo-pool gated, not count or distance), chain achievements with specific named routes (Holiday Coastline, Above the Arctic Circle, Orient Express, Iberian Pilgrimage routes). Slider doesn't accelerate these.

**How to apply**: when entering a focused achievement session, surface the slider recommendation at session start ("recommend slider 50% — IS farming"). Default phase A: leave alone.

---

## Update protocol

Add new rules as **R<n>** with: rule body, "How to apply", "Why" (when non-obvious). Renumber only if a rule is deleted. Cross-link to `cargo-walk.md` / `cargo-flags.md` / memory files where relevant.

Last updated: 2026-05-21.
