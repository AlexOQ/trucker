# Trucker Advisor (ETS2 + ATS)

Euro Truck Simulator 2 and American Truck Simulator trucking company analyzer - optimizes trailer sets per city garage. Game-aware data pipeline; same frontend serves both games via runtime toggle.

## Project Overview

**Goal**: Recommend optimal fleet of up to 5 AI drivers per city garage to maximize expected income. Supports both ETS2 (Europe) and ATS (North America); user toggles active game in the frontend.

**Core Logic**:
- Cities contain depots (company facilities), each spawning random cargo jobs
- Cargoes have value, spawn probability (prob_coef), and compatible trailer body types
- Monte Carlo simulation finds best fleet: greedy driver selection maximizing marginal EV
- City rankings run the same greedy MC picker as fleet computation (`RANKING_MC_SIMS = 500`); fleet cached on `CityRanking.fleet` and shared with the city detail view

**First-Visit UX**:
- DLC configuration banner prompts new visitors to set up owned DLCs for accurate results
- Collapsible "Getting Started" onboarding section explains what the tool does and how to use it
- Collapsible "How It Works" section explains the optimization methodology
- Onboarding state (collapsed/dismissed) persisted in localStorage

## Tech Stack

**Production (GitHub Pages)**:
- **Build**: Vite (TypeScript → JavaScript bundling)
- **Static Site**: HTML/CSS + bundled JS (no backend)
- **Data**: JSON files in `/public/data/`
- **Client-Side**: TypeScript modules with fuzzy autocomplete
- **Computation**: All optimization runs in browser via Web Worker (`optimizer-worker.ts`) with async client wrapper (`optimizer-client.ts`) and synchronous fallback if Workers are unavailable
- **Theming**: Dark/light mode toggle with CSS custom properties, persisted in localStorage, no FOUC via inline script
- **Offline**: Service worker (`sw.js`) with network-first for HTML and JSON data, cache-first for CSS/JS, stale Vite bundle eviction on SW activation
- **Export**: CSV, JSON, and clipboard export from city detail view
- **Comparison**: Side-by-side city comparison (up to 5 cities) with winner highlighting, URL-addressable via `#compare=id1,id2,...` (shareable, refresh-safe)

**Development**:
- **Frontend**: Vite dev server with hot reload
- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL (optional, for bulk data entry only)
- **Tools**: Docker, Kysely ORM

## Data Model

**JSON Data Sources** (in `/public/data/`):
- `game-defs.json`: Authoritative game data extracted from ETS2 game files — cargo definitions (value, volume, mass, fragility, prob_coef, body_types, groups), trailer specs (body_type, volume, gross_weight_limit, chain_type, country_validity, ownable, price, level_floor), company mappings (cargo_out/in, cities), city/country data, cargo-trailer unit counts, economy constants, truck specs, and DLC registry. **Query records via the CLI, don't hand-parse:** `node scripts/defs-query.cjs <cargo|companies-for-cargo|city|city-companies|cargo-search|dlc> <arg> [--game ets2|ats]` (`npm run defs-query`) — id lookups, plus `cargo-search <substr|/regex/>` (matches cargo id or name; a miss is an empty result, not an error) and `dlc [section]` (registry dump). The cargo/companies/cities sections are **id-keyed maps, not arrays**, so iterating them yields keys (the `str has no attribute get` footgun the CLI exists to kill)
- `observations.json`: Observed data from save game parsing — city-company mappings, cargo-trailer compatibility, cargo spawn frequencies, unit counts per trailer. Supplements and validates game defs but does NOT override authoritative values

**Data Loading** (`loadAllData()` in `loader.ts`):
- Loads both JSON files in parallel via fetch
- Initializes DLC registry from `game-defs.json` `dlc` section if present
- Builds entity arrays (cities, companies, cargo, trailers) from game defs as primary source, observations as fallback
- `prob_coef` (from game defs) is the authoritative spawn probability coefficient (range 0.3-2.0, most cargo at 1.0)

**Body Types**:
- 15-17 body types cover all ~359 cargo types in the game
- All trailers within a body type haul the SAME cargo set — difference is only volume/units
- Trailer configurations: trailers are first-class `(body_type, chain_type, axles)` — no synthetic tier buckets. `chain_type` values (ETS2: `single`/`double`/`b_double`/`hct`; ATS: `single`/`double`/`bdouble`/`rmdouble`/`tpdouble`/`triple`) render via `chainConfigLabel()` + `CHAIN_LABELS` and order via `CHAIN_ORDER` (all in `utils.ts`); `axles` is the authoritative per-trailer total axle count from the trailer def. The trailer browser navigates body_type → chain configuration → variants.
- Body type profiles are built dynamically from game-defs.json via `getBodyTypeProfiles()`
- Optimizer works at body-type level, not individual trailer level

**Haul Value Formula**: `unitValue × units` where `unitValue = cargo.value × (1 + 0.3×fragile + 0.3×high_value)`

**Cargo Value Bonuses**:
- Fragile cargo: +30% value bonus
- High-value cargo: +30% value bonus
- Bonuses stack (fragile + high_value = +60%)

**DLC Filtering** (`applyDLCFilter()`):
- Filters trailers by brand prefix (e.g., `feldbinder.` prefix requires Feldbinder DLC)
- Filters cargo by DLC pack or map expansion association
- Filters cities to garage-only cities not blocked by unowned map DLCs
- All browser pages apply DLC filter before displaying data

**Optional Database** (for bulk data entry):
- PostgreSQL schema mirrors JSON structure
- Export scripts generate JSON from database
- Database not needed for production deployment

## Key Algorithms

### Game Data Pipeline
1. Extract `def/` folder from ETS2 *or* ATS `.scs` archives — `scripts/scs-extract/` (handles HashFS v2 DLC archives; see its README) or any SCS Extractor
2. Run `npx tsx scripts/parse-game-defs.ts /path/to/extracted/def --game <ets2|ats>` (default `ets2`)
3. Parser reads all `.sii/.sui` files: cargo, trailers, companies, cities, countries, economy, trucks
4. Computes cargo-trailer compatibility from `body_type` matching
5. Computes units per trailer: `floor(trailer_volume / cargo_volume)`, weight-limited if `gross_weight_limit` applies
6. Generates DLC registry: trailer DLCs (by brand), cargo DLCs (by pack), map DLCs (by city membership), garage cities, cargo-DLC associations
7. Outputs `public/data/<game>/game-defs.json` (e.g. `public/data/ets2/game-defs.json`, `public/data/ats/game-defs.json`) — single file per game, idempotent, includes all DLC content
8. Re-run per game on every game update or DLC — full reseed, no incremental merge needed
9. After re-parsing, update the manual fields in `public/data/<game>/data-version.json` (`game_version`, `coverage_notes`) and run `npm run gen:data-coverage` to refresh the README table + UI footer (see README "Data Coverage"; `--check` gates this in CI)

**Manual trailer pricing**: the parser can't recover `chain_base` (per-brand/chain constant) or per-chassis `body_fee` from the dealer defs, so `mergeManualPrices()` overlays hand-walked prices from `public/data/<game>/manual-prices.json` (keyed by trailer id: `{price, source_pack, last_verified_game_version}`) — without it many trailers are left unpriced or underestimated. `--audit-walks` lists trailers needing a walk plus orphaned entries; `--diff` flags real dealer-price shifts to re-verify. Canonical methodology, live walk queue, and contribution steps: `docs/manual-prices-audit.md`.

**Diff mode**: `npx tsx scripts/parse-game-defs.ts /path/to/def --diff --game <ets2|ats>`
- Compares freshly parsed data against existing `game-defs.json` without writing
- Reports added/removed/changed entries for cargo, trailers, companies, cities
- Useful for reviewing game updates before committing new data

### Body Type Profiles (`getBodyTypeProfiles()`)
1. Group all ownable trailers by `body_type`
2. For each body type, collect union of all compatible cargo IDs (via `trailerCargoMap`)
3. All trailers within a body type haul the SAME cargo set — difference is only volume/capacity
4. Pick best trailer per body type by total haul value across all compatible cargo
5. Result: ~15-17 body types covering all ~359 cargo types. The profile records the best trailer's `bestChainType`; chain-configuration grouping/labels live in `trailers.ts` (browser) via `chain_type` directly — no tier flags.

### Dominated Body Type Elimination (`findDominatedBodyTypes()`)
- Body type A is **dominated** by B if B can haul every cargo A can with >= haul value, AND B covers strictly more cargo (or has strictly higher HV somewhere)
- Dominated body types are excluded from the optimizer
- Only non-dominated body types enter the optimizer

### Depot Cargo Model (`buildCityDepotProfiles()`)
Each depot instance in a city gets a cargo profile:
```
For each company in city:
  For each depot instance (count from city_companies):
    Build cargo pool: all non-excluded cargo the company exports
    For each cargo item:
      probCoef = cargo.prob_coef (spawn probability)
      For each compatible ownable trailer valid in city's country:
        bodyHV[bodyType] = max(unitValue × units) across trailers of that body type
    Build cumulative probability distribution (CDF) for fast MC sampling
```

### Fleet Optimization — Monte Carlo Simulation (`computeOptimalFleet()`)
Constants: `MAX_DRIVERS = 5`, `MC_SIMS = 20,000`, `JOBS_PER_DEPOT = 3`

```
Phase 1 — Greedy driver selection (up to MAX_DRIVERS rounds):
  1. Pre-filter: compute analytical first-pick EV per body type, keep top 15
  2. For each pick round:
     a. Generate MC_SIMS random job boards (JOBS_PER_DEPOT jobs per depot)
     b. Simulate existing fleet on each board (drivers pick best job, remove it)
     c. For each candidate body type, measure marginal EV on remaining boards
     d. Pick body type with highest average marginal EV
     e. Add to fleet

Phase 2 — Per-driver EV computation:
  Simulate final fleet across MC_SIMS boards to get each driver's EV

Phase 3 — Collapse:
  Group drivers by body type, output count and EV per group
```

### City Ranking Score (`calculateCityRankings()`)
- Runs `computeOptimalFleet` with a reduced sample count (`RANKING_MC_SIMS = 500`) per city
- `score = totalFleetEV` — sum of all drivers' per-driver EVs after contention/stacking
- `CityRanking.fleet` caches the full fleet; detail view reads it directly so rankings table and detail panel show identical picks
- Analytical `analyticalFirstPickEV()` still used as candidate pre-filter inside the picker (top-15) and by `dlc-value.ts` for marginal-value calculations
- Cities ranked by score descending

### Analytical E[max of N] (`analyticalFirstPickEV()`)
Multi-depot formula for ranking speed:
```
P(max across all depots ≤ H) = Π_d CDF_d(H)^JOBS_PER_DEPOT
E[max] = Σ_i hv_i × [P(max ≤ hv_i) - P(max ≤ hv_{i-1})]
```
This gives the expected value of the single best job a driver with a given body type would find.

## DLC System

Three categories of DLC content affect optimization results:

**Trailer Brand DLCs** (8 brands): Feldbinder, Kassbohrer, Kogel, Krone, Schmitz Cargobull, Schwarzmuller, Tirsan, Wielton
- Trailer ID prefix determines brand (e.g., `feldbinder.` trailers require Feldbinder DLC)
- Base game trailers use `scs.` prefix and are always available

**Cargo Pack DLCs** (9 packs): High Power Cargo, Heavy Cargo, Special Transport, Volvo Construction, JCB Equipment, Bobcat Cargo, KRONE Agriculture, Farm Machinery, Forest Machinery
- Each pack adds specific cargo IDs to the game
- Cargo-DLC mapping maintained in `CARGO_DLC_MAP` in `dlc-data.ts`

**Map Expansion DLCs** (9 maps): Going East!, Scandinavia, Vive la France!, Italia, Beyond the Baltic Sea, Road to the Black Sea, Iberia, West Balkans, Greece
- Each map adds cities (tracked in `CITY_DLC_MAP`)
- Maps also add "shadow cargo" — cargo types that only appear with the map DLC (tracked in `MAP_DLC_CARGO`)
- `GARAGE_CITIES` set tracks which cities have purchasable garages

### ATS DLC Coverage

- **Brand DLCs (ATS)**: enumerated in `ATS_TRAILER_DLCS` (`scripts/parse-game-defs.ts`); ATS uses brand-prefix matching identical to ETS2.
- **Map expansion DLCs (ATS)**: each US state shipped as a separate DLC. Mapping lives in `ATS_STATE_TO_DLC` (`Record<stateCode, string[]>`). City→DLC map built dynamically by `buildAtsCityDlcMap(cities)` from each city's `country` (state code) field — no hand-curated `ATS_CITY_DLC_MAP`.
- **Garage cities (ATS)**: enumerated in `ATS_GARAGE_CITIES`. SCS internal IDs follow a 12-char truncation rule with documented per-city exceptions (`salt_lake`, asymmetric `texarkana` / `texarkana_ar`, symmetric `kansas_ci_ks` / `kansas_ci_mo`); see comment block above `ATS_GARAGE_CITIES`.
- **Cargo pack DLCs (ATS)**: `ATS_CARGO_DLC_MAP` is populated (61 cargo across 7 packs), sourced from each pack's `def/cargo.<dlc>.sii` aggregator inside the owned `dlc_*.scs` archives and cross-checked against `game-defs.json` (#243). Special Transport (`dlc_oversize`) maps to zero cargo — all its cargo is oversize/player-only and excluded from the AI-haulable dataset. `ATS_MAP_DLC_CARGO` stays empty until a *purchasable* state map DLC is owned (only free Arizona/Nevada are installed); populate per owned state via the same archive method.
- **Trucks page (ATS)**: populated — `game-defs.json` ships 19 ATS trucks with full engines/transmissions/chassis/cabins/paints, and `computeMinCost` yields a build for all 19, so `trucks.html` renders them. (The #252 limitation was ETS2-only at the time; the donated ATS data already includes trucks. Component prices are def-sourced — no walks.) Component names render via `displayName()` from `@@token@@` refs for both games — a cosmetic, non-ATS-specific gap, not a data hole.
- **Company names (ATS)**: localized via the def `name` field — ETS2 on reparse (#267), ATS via a targeted backfill (#289, `scripts/backfill-company-names.cjs`, which mirrors `buildCompanyNameMap`'s rules over `def/company/*.sui`). 197 of 217 ATS companies are localized; the ~20 without a base def (mostly `aport_*` airports) keep mechanical title-case. On a future full ATS reparse, `buildCompanyNameMap` populates names natively and the backfill retires.
- **ATS def dump scope**: the donated ATS dump carries all trailer, cargo, and company defs (brand/pack DLC content included) — only **cities from unowned map DLCs are missing**, which is the single reason a *full* ATS reparse trips the `GARAGE_CITIES` drift guard. Everything-but-cities is therefore recoverable from the dump without a full reparse, via targeted backfills keyed by id (the #267 names / #250 axles / #289 names pattern).

**DLC Filtering Pipeline**:
1. User toggles DLC ownership on the DLCs page (stored in localStorage)
2. On page load, `applyDLCFilter()` removes unowned trailers, cargo, and cities
3. All pages (rankings, city detail, browsers) operate on filtered data

**Marginal Value Calculator** (`dlc-value.ts`):
- For each unowned DLC, computes the fleet EV delta if the player owned it
- Uses analytical city rankings (fast) — evaluates each DLC by adding it hypothetically and re-ranking
- Map DLCs show both "shadow cargo" improvement at existing garages and potential new garage cities
- Results sorted by total EV delta descending

**DLC Data Initialization**:
- Hardcoded fallbacks in `dlc-data.ts` used until game-defs.json loads
- `initDlcData()` overrides with live data from `game-defs.json` `dlc` section
- DLC registry generated by `parse-game-defs.ts` from game file analysis

## Commands

**Frontend Development**:
```bash
npm install              # Install dependencies
npm run dev:frontend     # Start Vite dev server (http://localhost:5173)
npm run build:frontend   # Build for production (outputs to public/dist/)
npm run preview          # Preview production build locally
npm run test             # Run test suite
npm run lint             # TypeScript type checking
```

**Production Site**:
- Deployed to GitHub Pages: https://alexoq.github.io/trucker
- CI builds via `npm run build:frontend` and deploys `public/dist/` folder
- Base path: `/trucker/` (configured in vite.config.ts)

**Backend (Optional - Data Entry Only)**:
```bash
docker compose up -d     # Start PostgreSQL
npm run migrate          # Run database migrations
npm run dev              # Start Express server (http://localhost:3000)
npm run export           # Export database to JSON files
```

**Data Pipeline**:
```bash
npm run parse-saves       # Parse ETS2 save game files into observations.json (ETS2 only; ATS save parsing not implemented)
```

**Note**: Backend is only for bulk data entry. Production site runs entirely client-side from JSON files.

## Git Workflow

- Always squash-merge PRs to keep history clean

## Data Entry

Primary data source is `game-defs.json` generated by the parser. Manual data entry via the optional database is only needed for supplementary data not in game files.

### Data Entry Rules

**Skip vehicle cargoes** (not in game data):
- Campervans, Cars, Luxury SUVs, Panter, Vans, Pickups

**Excluded cargoes** (mark `excluded=true`):
- Trailer delivery jobs (Feldbinder trailers, Krone trailers) - these are "drive this trailer" type jobs with no trailer choice

**City names**:
- Use proper Unicode/diacritics (Córdoba not Cordoba, Zürich not Zurich)

## Project Structure

```
/src/frontend       - TypeScript source (compiled by Vite)
  main.ts           - rankings page orchestrator: routing, DLC banner, onboarding
  rankings-view.ts  - rankings table rendering, search, filters, garage stars
  city-detail-view.ts - city detail panel with fleet recommendations, export, and garage toggle
  comparison-view.ts - side-by-side city comparison with winner highlighting
  comparison-state.ts - comparison selection state, compare bar, URL hash encoding, announceStatus
  data.ts           - barrel re-export from sub-modules (backward compatibility)
  types.ts          - TypeScript interfaces (City, Company, Cargo, Trailer, etc.)
  loader.ts         - loadAllData(), entity builders, JSON fetching
  lookups.ts        - buildLookups(), lookup Maps/Sets for efficient access
  dlc-filter.ts     - applyDLCFilter(), getBlockedCities()
  trailer-profiles.ts - trailer earning profiles, depot profiles, city scoring
  body-types.ts     - getBodyTypeProfiles(), findDominatedBodyTypes(), chassis merging
  utils.ts          - normalize(), titleCase(), trailerTotalHV(), formatTrailerSpec(), escapeHtml()
  optimizer.ts      - Monte Carlo fleet optimizer and analytical city rankings
  optimizer-worker.ts - Web Worker for non-blocking optimizer computation
  optimizer-client.ts - async wrapper with sync fallback for optimizer
  page-init.ts      - shared initPageData() for all browser pages
  clipboard.ts      - shared copyToClipboard() utility
  storage.ts        - localStorage wrapper, re-exports DLC registries from dlc-data, theme management (getTheme/setTheme/toggleTheme)
  dlc-data.ts       - DLC registry (trailer/cargo/map DLCs), GARAGE_CITIES, CITY_DLC_MAP
  dlc-value.ts      - DLC marginal value calculator (EV delta for unowned DLCs)
  dlcs.ts           - DLC settings page: toggle ownership, run marginal value analysis
  cities.ts         - city browser page with company/depot info
  companies.ts      - company browser page with city/cargo info
  cargo.ts          - cargo browser page with provider/trailer info
  trailers.ts       - trailer/body type browser: body types → chain configurations → variants
  trucks.ts         - trucks browser: cheapest-config-per-truck rankings + detail view
  trucks-cost.ts    - pure min-cost calc: cheapest (cabin, chassis) pair + cheapest engine/transmission/paint
  __tests__/        - test suite
    data.test.ts    - data loading and lookup tests
    body-types.test.ts - body type profile and domination tests
    dlc-filter.test.ts - DLC filtering tests
    optimizer.test.ts - optimizer algorithm tests
    optimizer-client.test.ts - worker client tests
    storage.test.ts - storage/state management tests
    dlc-value.test.ts - DLC marginal value tests
    trailer-profiles.test.ts - trailer profile tests
    trucks-cost.test.ts - min-cost truck builder tests
    theme-functions.test.ts - theme getTheme/setTheme/toggleTheme tests
    view-module-functions.test.ts - view module pure function tests
    utils.test.ts   - utility function tests

/public             - static assets and HTML entry points
  /css              - stylesheets
  /data             - JSON data files (game-defs.json, observations.json)
  sw.js             - service worker for offline caching
  index.html        - main page: rankings + city detail (imports src/frontend/main.ts)
  cities.html       - city browser
  companies.html    - company browser
  cargo.html        - cargo browser
  trailers.html     - trailer/body type browser
  dlcs.html         - DLC settings and marginal value calculator

/public/dist        - production build output (generated by Vite)

/src                - backend code (optional, for data entry only)
  /db               - database connection, migrations, queries
  /api              - express routes for data entry
  /types            - TypeScript interfaces

/scripts            - data pipeline and analysis utilities
  parse-game-defs.ts - Game definition parser, game-aware (ETS2 or ATS); generates public/data/<game>/game-defs.json
/docs               - tracked documentation
```
