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
```
