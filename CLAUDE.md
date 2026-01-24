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
- **Static Site**: HTML/CSS/JavaScript (no backend)
- **Data**: JSON files in `/public/data/`
- **Client-Side**: Vanilla JS with fuzzy autocomplete
- **Computation**: All optimization runs in browser

**Development (Optional)**:
- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL (for bulk data entry only)
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

**Cargo Value Bonuses**:
- Fragile cargo: +30% value bonus
- High-value cargo: +30% value bonus
- Bonuses stack (fragile + high_value = +60%)

**Optional Database** (for bulk data entry):
- PostgreSQL schema mirrors JSON structure
- Export scripts generate JSON from database
- Database not needed for production deployment

## Key Algorithms

### Trailer Set Optimization (Greedy)
1. Build pool: all (depot, cargo, value) tuples for city
2. For each trailer: calculate total value of cargoes it covers
3. Pick highest-value trailer, add to set
4. Reduce remaining pool value (covered cargoes partially satisfied)
5. Repeat until 10 trailers selected

### Coverage Calculation
- For each trailer in set: % of pool's cargo types it can haul

## Commands

**Production Site**:
- Deployed to GitHub Pages: https://alexoq.github.io/trucker
- No build step required (static files)

**Development (Data Entry)**:
```bash
# Optional: start postgres for bulk data entry
docker compose up -d

# Optional: run migrations
npm run migrate

# Start dev server (for data entry interface)
npm run dev
```

**Note**: Database and dev server are only for data entry. Production site runs entirely client-side from JSON files.

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
/public          - production static site (GitHub Pages)
  /css           - stylesheets
  /data          - JSON data files (cities, cargo, trailers, etc)
  /js            - client-side JavaScript (optimizer, data loader, UI)
  index.html     - main page

/src             - optional backend (data entry only)
  /db            - database connection, migrations, queries
  /api           - express routes for data entry
  /algorithm     - trailer optimization logic (reference impl)
  /types         - TypeScript interfaces

/scripts         - data export/migration utilities
/docs            - tracked documentation
/specs           - ralph-specum spec artifacts
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
- Target: local dev server (`npm run dev`)
- Pulls recently closed issues via `gh issue list --state closed`
- Reviews code changes, runs tests, checks regressions

**Architect** (`ralph-specum:architect-reviewer`):
- Scope: major improvements only (framework changes, major refactors, upcoming blockers)
- Not for small fixes

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
