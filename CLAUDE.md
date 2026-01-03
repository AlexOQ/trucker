# ETS2 Trucker Advisor

Euro Truck Simulator 2 trucking company analyzer - optimizes trailer sets per city garage.

## Project Overview

**Goal**: Recommend optimal set of 10 trailers per city to maximize income coverage.

**Core Logic**:
- Cities contain depots
- Depots export cargoes (same cargo at multiple depots = multiplied in pool)
- Cargoes have value and compatible trailer types
- Algorithm: greedy weighted set cover to find best trailer mix

## Tech Stack

- **Runtime**: Node.js + TypeScript
- **Database**: PostgreSQL (Docker)
- **Web**: Express + vanilla frontend (fuzzy autocomplete)
- **ORM**: Kysely (type-safe query builder)

## Database Schema

```sql
cities (id SERIAL, name TEXT, country TEXT)
depots (id SERIAL, city_id INT, company_name TEXT)
cargo_types (id SERIAL, name TEXT, value INT)
trailer_types (id SERIAL, name TEXT)
depot_cargoes (depot_id INT, cargo_type_id INT)
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

## Data Entry

Data is entered via conversation with Claude - no UI for data entry.
User provides: cities, depots, cargoes, trailers, relationships, values.

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
