# ETS2 Trucker Advisor

Euro Truck Simulator 2 trucking company analyzer - optimizes trailer sets per city garage.

## Project Overview

**Goal**: Recommend optimal set of 10 trailers per city to maximize income coverage.

**Core Logic**:
- Cities contain depot types (company facilities)
- Depot types export cargoes (same cargo at multiple depots = multiplied in pool)
- Cargoes have value and compatible trailer types
- Algorithm: greedy weighted set cover to find best trailer mix

## Tech Stack

**Production (GitHub Pages)**:
- **Build**: Vite (TypeScript → JavaScript bundling)
- **Static Site**: HTML/CSS + bundled JS (no backend)
- **Data**: JSON files in `/public/data/`
- **Client-Side**: TypeScript modules with fuzzy autocomplete
- **Computation**: All optimization runs in browser

**Development**:
- **Frontend**: Vite dev server with hot reload
- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL (optional, for bulk data entry only)
- **Tools**: Docker, Kysely ORM

## Data Model

**JSON Files** (in `/public/data/`):
- `cities.json`: City name, country
- `companies.json`: Depot/company types
- `cargo.json`: Cargo name, value, fragile/high_value flags, excluded
- `trailers.json`: Trailer name, ownable flag
- `city-companies.json`: Which companies in which cities (with depot counts)
- `company-cargo.json`: Which cargoes at which companies
- `cargo-trailers.json`: Which trailers compatible with which cargoes

**Data Sources**:
- `game-defs.json`: Authoritative game data — cargo values, trailer specs, company mappings, prob_coef
- `observations.json`: Observed data from save game parsing — supplements and validates game defs
- `prob_coef` (from game defs) is the authoritative spawn probability coefficient (range 0.3-2.0, most cargo at 1.0)

**Body Types**:
- 15-17 body types cover all ~359 cargo types in the game
- All trailers within a body type haul the SAME cargo set — difference is only volume/units
- Trailer tiers: Standard (1.0×), Double (1.5×), HCT (2.0×)
- Body type profiles are built dynamically from game-defs.json via `getBodyTypeProfiles()`
- Optimizer works at body-type level, not individual trailer level

**EV Formula**: `value_per_km × units × prob_coef × depotCount × tierMultiplier`

**Cargo Value Bonuses**:
- Fragile cargo: +30% value bonus
- High-value cargo: +30% value bonus
- Bonuses stack (fragile + high_value = +60%)

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
6. Outputs `public/data/game-defs.json` — single file, idempotent, includes all DLC content
7. Re-run on every game update or DLC — full reseed, no incremental merge needed

### Body Type Profiles (`getBodyTypeProfiles()`)
1. Group all ownable trailers by `body_type`
2. For each body type, collect union of all compatible cargo IDs (via `trailerCargoMap`)
3. All trailers within a body type haul the SAME cargo set — difference is only volume/capacity
4. Pick "best" standard trailer per body type: max volume, no country restriction, not double/HCT
5. Detect doubles/HCT availability by scanning trailer IDs for `double`/`bdouble`/`hct` keywords
6. Result: ~15-17 body types covering all ~359 cargo types

### Dominated Body Type Elimination (`findNonDominatedBodyTypes()`)
- Body type A is **dominated** if body type B can haul all of A's cargo plus more (A ⊂ B)
- Example: dryvan(127 cargo) ⊂ curtainside(131 cargo) → dryvan eliminated
- Only non-dominated body types enter the optimizer

### EV Calculation (`calculateBodyTypeStats()`)
For each (bodyType, tier) combination available in the city's country:

```
CargoPool = all (companyId, cargoId, depotCount) tuples for the city
           where cargo.excluded = false

For each cargo in CargoPool that this body type can haul:
  value = cargo.value × (1 + 0.3×fragile + 0.3×high_value)    // base value with bonuses
  units = max units fitting in best standard trailer for this body type
  spawnWeight = cargo.prob_coef                                 // authoritative from game defs

  contribution = value × units × depotCount × spawnWeight × tierMultiplier

bodyTypeEV = sum of all cargo contributions
```

**Tier multipliers** (separate optimizer entries per tier):
- Standard: 1.0× (available everywhere)
- Double: 1.5× (country-restricted, e.g., 8 countries)
- HCT: 2.0× (country-restricted, e.g., Finland/Sweden)

### Trailer Set Optimization (Greedy with Diminishing Returns)
Parameters: `maxTrailers` (garage slots, default 10), `diminishingFactor` (0-100, default 75)

```
1. Build CargoPool for the city
2. Filter ownable trailers valid in city's country
3. Eliminate dominated body types
4. Calculate EV for each (bodyType, tier) combo
5. Greedy selection loop (maxTrailers rounds):
   a. For each candidate body type:
      effectiveEV = bodyTypeEV × diminishingFactor^(copies_already_selected)
   b. Pick body type with highest effectiveEV
   c. Add to selected set, increment its copy count
6. Output recommendations sorted by count DESC, then score DESC
```

**diminishingFactor behavior**:
- 100 = no penalty → top body type fills all slots (dim^n = 1.0 always)
- 75 = moderate diversity → each copy scores 0.75× the previous
- 0 = max diversity → only first copy of each type selected (0^1 = 0)

### Coverage Calculation
- `coveragePct = cargoCount / totalCargoPoolSize × 100`
- Measures what % of available cargo types this body type can haul in this city

### City Ranking Score
- `score = sqrt(totalJobs × totalValue)` — geometric mean balancing job availability with cargo value
- Cities ranked by score descending

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

**Note**: Backend is only for bulk data entry. Production site runs entirely client-side from JSON files.

## Git Workflow

- Always squash-merge PRs to keep history clean

## Data Entry

Data is entered via conversation with Claude - no UI for data entry.

### Data Entry Rules

**Skip vehicle cargoes** (not in game data):
- Campervans, Cars, Luxury SUVs, Panter, Vans, Pickups

**Excluded cargoes** (mark `excluded=true`):
- Trailer delivery jobs (Feldbinder trailers, Krone trailers) - these are "drive this trailer" type jobs with no trailer choice

**City names**:
- Use proper Unicode/diacritics (Córdoba not Cordoba, Zürich not Zurich)
- Fix duplicates by migrating city_depots to accented version, delete ASCII duplicate

**Multi-type depots**:
- Create separate depot_types entries with naming: "Company Name Depot Type"
- Example: "ITCC Factory", "ITCC Scrapyard"

**SQL Pattern for bulk cargo insert**:
```sql
WITH cargo_list AS (
  SELECT LOWER(name) as cargo_name FROM (VALUES
    ('Cargo1'),('Cargo2')
  ) AS t(name)
)
INSERT INTO depot_type_cargoes (depot_type_id, cargo_type_id)
SELECT [depot_id], ct.id FROM cargo_types ct
JOIN cargo_list cl ON LOWER(ct.name) = cl.cargo_name
ON CONFLICT DO NOTHING;
```

## Project Structure

```
/src/frontend    - TypeScript source (compiled by Vite)
  main.ts        - main application entry point
  data.ts        - data loading, caching, body type profiles
  optimizer.ts   - trailer optimization algorithm (body-type-based)
  storage.ts     - localStorage wrapper
  trailers.ts    - trailers/body type browser page

/public          - static assets and HTML entry points
  /css           - stylesheets
  /data          - JSON data files (cities, cargo, trailers, etc)
  index.html     - main page (imports src/frontend/main.ts)
  cities.html    - city browser
  companies.html - company browser
  cargo.html     - cargo browser
  trailers.html  - trailer/body type browser

/public/dist     - production build output (generated by Vite)

/src             - backend code (optional, for data entry only)
  /db            - database connection, migrations, queries
  /api           - express routes for data entry
  /types         - TypeScript interfaces

/scripts         - data export/migration utilities
/docs            - tracked documentation
/analysis        - untracked, ephemeral agent outputs
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

**User Testing** (`voltagent-qa-sec:qa-expert` + Playwright):
- Target: https://alexoq.github.io/trucker
- Spawns 3 agents with randomized personas from pool
- Tests real user journeys, documents friction

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
