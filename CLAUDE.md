# ETS2 Trucker Advisor

Euro Truck Simulator 2 trucking company analyzer - optimizes trailer sets per city garage.

## Project Overview

**Goal**: Recommend optimal fleet of up to 5 AI drivers per city garage to maximize expected income.

**Core Logic**:
- Cities contain depots (company facilities), each spawning random cargo jobs
- Cargoes have value, spawn probability (prob_coef), and compatible trailer body types
- Monte Carlo simulation finds best fleet: greedy driver selection maximizing marginal EV
- City rankings use analytical E[max of N] formula for speed (no MC needed per city)

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
- **Offline**: Service worker (`sw.js`) with cache-first for static assets, network-first for HTML
- **Export**: CSV, JSON, and clipboard export from city detail view
- **Comparison**: Side-by-side city comparison (up to 5 cities) with winner highlighting

**Development**:
- **Frontend**: Vite dev server with hot reload
- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL (optional, for bulk data entry only)
- **Tools**: Docker, Kysely ORM

## Data Model

**JSON Data Sources** (in `/public/data/`):
- `game-defs.json`: Authoritative game data extracted from ETS2 game files — cargo definitions (value, volume, mass, fragility, prob_coef, body_types, groups), trailer specs (body_type, volume, gross_weight_limit, chain_type, country_validity, ownable), company mappings (cargo_out/in, cities), city/country data, cargo-trailer unit counts, economy constants, truck specs, and DLC registry
- `observations.json`: Observed data from save game parsing — city-company mappings, cargo-trailer compatibility, cargo spawn frequencies, unit counts per trailer. Supplements and validates game defs but does NOT override authoritative values

**Data Loading** (`loadAllData()` in `loader.ts`):
- Loads both JSON files in parallel via fetch
- Initializes DLC registry from `game-defs.json` `dlc` section if present
- Builds entity arrays (cities, companies, cargo, trailers) from game defs as primary source, observations as fallback
- `prob_coef` (from game defs) is the authoritative spawn probability coefficient (range 0.3-2.0, most cargo at 1.0)

**Body Types**:
- 15-17 body types cover all ~359 cargo types in the game
- All trailers within a body type haul the SAME cargo set — difference is only volume/units
- Trailer tiers: Standard, Double, HCT (identified by trailer ID keywords)
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
1. Extract ETS2 `def/` folder from game `.scs` archives (SCS Extractor)
2. Run `npx tsx scripts/parse-game-defs.ts /path/to/extracted/def`
3. Parser reads all `.sii/.sui` files: cargo, trailers, companies, cities, countries, economy, trucks
4. Computes cargo-trailer compatibility from `body_type` matching
5. Computes units per trailer: `floor(trailer_volume / cargo_volume)`, weight-limited if `gross_weight_limit` applies
6. Generates DLC registry: trailer DLCs (by brand), cargo DLCs (by pack), map DLCs (by city membership), garage cities, cargo-DLC associations
7. Outputs `public/data/game-defs.json` — single file, idempotent, includes all DLC content
8. Re-run on every game update or DLC — full reseed, no incremental merge needed

**Diff mode**: `npx tsx scripts/parse-game-defs.ts /path/to/def --diff`
- Compares freshly parsed data against existing `game-defs.json` without writing
- Reports added/removed/changed entries for cargo, trailers, companies, cities
- Useful for reviewing game updates before committing new data

### Body Type Profiles (`getBodyTypeProfiles()`)
1. Group all ownable trailers by `body_type`
2. For each body type, collect union of all compatible cargo IDs (via `trailerCargoMap`)
3. All trailers within a body type haul the SAME cargo set — difference is only volume/capacity
4. Pick best trailer per body type by total haul value across all compatible cargo
5. Detect doubles/HCT availability by scanning trailer IDs for `double`/`bdouble`/`hct` keywords
6. Result: ~15-17 body types covering all ~359 cargo types

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
- Uses analytical E[max of N] formula (`analyticalFirstPickEV()`) — no MC needed
- For each non-dominated body type: compute expected value of the best job across all depots
- `score = sum of top RANKING_DRIVERS (5) body type EVs`
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
npm run parse-saves       # Parse ETS2 save game files into observations.json
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
  city-detail-view.ts - city detail panel with fleet recommendations and export
  comparison-view.ts - side-by-side city comparison with winner highlighting
  data.ts           - barrel re-export from sub-modules (backward compatibility)
  types.ts          - TypeScript interfaces (City, Company, Cargo, Trailer, etc.)
  loader.ts         - loadAllData(), entity builders, JSON fetching
  lookups.ts        - buildLookups(), lookup Maps/Sets for efficient access
  dlc-filter.ts     - applyDLCFilter(), getBlockedCities()
  trailer-profiles.ts - trailer earning profiles, depot profiles, city scoring
  body-types.ts     - getBodyTypeProfiles(), findDominatedBodyTypes(), chassis merging
  utils.ts          - normalize(), titleCase(), trailerTotalHV(), formatTrailerSpec()
  optimizer.ts      - Monte Carlo fleet optimizer and analytical city rankings
  optimizer-worker.ts - Web Worker for non-blocking optimizer computation
  optimizer-client.ts - async wrapper with sync fallback for optimizer
  page-init.ts      - shared initPageData() for all browser pages
  clipboard.ts      - shared copyToClipboard() utility
  storage.ts        - localStorage wrapper, re-exports DLC registries from dlc-data
  dlc-data.ts       - DLC registry (trailer/cargo/map DLCs), GARAGE_CITIES, CITY_DLC_MAP
  dlc-value.ts      - DLC marginal value calculator (EV delta for unowned DLCs)
  dlcs.ts           - DLC settings page: toggle ownership, run marginal value analysis
  cities.ts         - city browser page with company/depot info
  companies.ts      - company browser page with city/cargo info
  cargo.ts          - cargo browser page with provider/trailer info
  trailers.ts       - trailer/body type browser: body types → tiers → variants
  __tests__/        - test suite
    data.test.ts    - data loading and lookup tests
    body-types.test.ts - body type profile and domination tests
    dlc-filter.test.ts - DLC filtering tests
    optimizer.test.ts - optimizer algorithm tests
    optimizer-client.test.ts - worker client tests
    storage.test.ts - storage/state management tests
    dlc-value.test.ts - DLC marginal value tests
    trailer-profiles.test.ts - trailer profile tests
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
  parse-game-defs.ts - ETS2 game definition parser (generates game-defs.json)
/docs               - tracked documentation
/analysis           - untracked, ephemeral agent outputs
```

## Agent Workflow System

See `docs/AGENT-WORKFLOW.md` for full details.

### State Tracking

- State file: `analysis/.state.json`
- If `analysis/` missing: run analysis agents to reconstruct state
- Phases: `analysis` → `pm-review` → `development` → `merge` → (repeat)

### Command Recognition

| User Says | Agent Action |
|-----------|--------------|
| `status` | Read state, report phase/progress/queue/openPRs |
| `run user testing` | Spawn 3 persona agents against prod (alexoq.github.io/trucker), output → `analysis/user-testing.md` |
| `perform QA work` | Pull closed issues, test local dev, output → `analysis/qa-review.md` |
| `run architect review` | Analyze codebase for major improvements → `analysis/arch-review.md` |
| `audit documentation` | Scan all sources (issues/PRs/code/docs) → `analysis/docs-review.md` |
| `analyze saves` | Parse save game files, extract observations, update game data → `analysis/save-analysis.md` |
| `PM review` | Read `analysis/*.md`, create/update GitHub issues, transition state |
| `start development` | Pull from queue, run ralph-specum spec-driven flow in worktrees |
| `merge and cleanup` | Squash-merge PRs, remove worktrees, pull main, transition to analysis |

### Agent Behaviors

**All agents**:
- Check `analysis/.state.json` on startup
- Update state on completion
- Write structured output to `analysis/` directory

**User Testing** (3 parallel agents, `voltagent-qa-sec:qa-expert`):
- Target: https://alexoq.github.io/trucker
- 1 Playwright agent (browser-based, mobile persona) + 2 code-level agents (no browser)
- Each agent gets 5-6 randomly assigned features from recently closed PRs (no overlap)
- Code-level agents audit HTML/CSS/JS for UX issues ~3x faster than Playwright
- All write to `analysis/user-testing.md` with labeled sections

**QA** (`pr-review-toolkit:code-reviewer`):
- Target: local dev server (`npm run dev:frontend` on http://localhost:5173)
- Pulls recently closed issues via `gh issue list --state closed`
- Reviews code changes, runs tests, checks regressions

**Architect** (`ralph-specum:architect-reviewer`):
- Scope: major improvements only (framework changes, major refactors, upcoming blockers)
- Not for small fixes

**Save Analysis** (`voltagent-data-ai:data-engineer`):
- Purpose: Parse ETS2 save game files to extract observed job data and fill gaps in game-defs.json
- Input: User provides save game file paths (typically `game.sii` files)
- Scripts: Use/create scripts in `/scripts/` for parsing (e.g., `parse-saves.cjs`, `inspect-save.cjs`)
- Output: `analysis/save-analysis.md` with findings, `public/data/observations.json` updated
- Data extracted: city↔company mappings, company↔cargo mappings, cargo↔trailer compatibility, cargo unit counts per trailer, cargo spawn frequencies
- Validation: Cross-reference extracted data against `game-defs.json` to find discrepancies
- Priority data gaps: cargo_trailer_units (how many units fit per trailer — game defs compute from volume, saves confirm actual counts), new DLC cities/companies not yet in game defs
- Does NOT replace game-defs.json values — observations supplement and validate authoritative game data
- Key principle: `prob_coef` from game defs is authoritative for spawn probability; observations only used for validation and gap-filling

**Documentation** (`voltagent-dev-exp:documentation-engineer`):
- Sources: GitHub issues, PRs, comments, code, docs/
- Checks: accuracy, duplicates, staleness

**PM** (`voltagent-biz:product-manager`):
- Reads all `analysis/*.md` files
- Creates/updates GitHub issues with labels
- Labels: `priority:P0|P1|P2`, `type:bug|feature|ux`
- Manages development queue in state
- **Blocked issues**: Issues with dependencies go to `blockedIssues`, NOT `developmentQueue`
- Moves issues from `blockedIssues` → `developmentQueue` when blockers complete

**Development** (`ralph-specum` with `--quick`):
- Each issue runs in separate git worktree: `git worktree add ../trucker-<slug> -b feat/<slug>`
- `--quick` flag: skips interactive phases, auto-generates specs, executes non-interactively
- Ends with PR containing "Closes #XX" in body
- Up to 3 parallel background agents for unblocked issues (requires pre-approved permissions)
- Blocked issues wait until blocking PRs are **merged** (not just opened)

**Merge and Cleanup**:
- Squash-merge all open PRs: `gh pr merge <num> --squash --delete-branch`
- Force-remove worktrees: `git worktree remove --force <path>`
- Delete local feature branches
- Pull main with merged changes
- Clean analysis folder: delete `*.md` files (keep `.state.json`)
- Move unblocked issues from `blockedIssues` → `developmentQueue`
- Reset `analysisComplete` flags, transition to analysis
- Note: `completedThisCycle` preserved for PM, reset when PM transitions to development
