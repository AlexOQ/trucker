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

- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL (Docker, port 5433, user/pass: trucker/trucker)
- **Web**: Express + vanilla frontend (fuzzy autocomplete)
- **ORM**: Kysely (type-safe query builder)

## Database Schema

```sql
cities (id SERIAL, name TEXT, country TEXT)
depot_types (id SERIAL, name TEXT)
cargo_types (id SERIAL, name TEXT, value NUMERIC, excluded BOOLEAN)
trailer_types (id SERIAL, name TEXT, ownable BOOLEAN)

-- Junction tables
city_depots (city_id INT, depot_type_id INT, count INT)
depot_type_cargoes (depot_type_id INT, cargo_type_id INT)
cargo_trailers (cargo_type_id INT, trailer_type_id INT)
```

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

```bash
# Start postgres
docker compose up -d

# Run migrations
npm run migrate

# Start dev server
npm run dev
```

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
/src
  /db          - database connection, migrations, queries
  /api         - express routes
  /algorithm   - trailer optimization logic
  /types       - TypeScript interfaces
/public        - frontend assets
/migrations    - SQL migration files
/analysis      - untracked, ephemeral agent outputs
/docs          - tracked documentation
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
