# AI Driver Garage Optimization Algorithm

This document explains how the ETS2 Trucker Advisor optimizes trailer sets for AI driver garages.

## The Problem

In Euro Truck Simulator 2, AI drivers operate from city garages. When an AI driver is assigned a job, the game selects from available freight jobs at that city. The driver needs a compatible trailer to haul the cargo.

**Key insight**: AI drivers can only take jobs if they have access to a matching trailer in their garage. If your garage has 10 trailer slots, choosing the right mix of trailers maximizes how many jobs your AI drivers can accept.

## Core Concepts

### Cargo Pool

Each city has a pool of available cargo based on:
1. **Depot types** present in the city (e.g., factory, warehouse, port)
2. **Companies** operating those depots
3. **Cargo types** each company exports

If a company has multiple depots in a city, its cargo appears multiple times in the pool (more chances for that cargo to be offered as a job).

### Trailer Coverage

Each trailer type can haul specific cargo types:
- **Curtain Sider**: General goods, packaged items
- **Refrigerated**: Perishable foods, pharmaceuticals
- **Tanker**: Liquids, chemicals
- etc.

A trailer's "coverage" is the percentage of the city's cargo pool it can service.

### Value Per Job

Each cargo type has a base value (€ per km). High-value cargo (electronics, machinery) pays more than bulk goods.

### Units Per Haul (loading)

A haul's value is `unit value × units`. Units are:

```
units = min( volume units, ⌊(limit − truck tare − trailer tare) / cargo unit mass⌋ )
```

- **volume units** = `⌊trailer volume / cargo volume⌋`, already capped by the trailer's own gross
  weight limit. Def-derived and country-independent (`cargo_trailer_units` in game-defs.json).
- **limit** = the country's `mass_limit_per_axle_count` for the combination's total axle count — a
  4x2 (2-axle) truck plus the trailer's `axles`, clamped to the array. Truck tare is a fitted ~7 t
  constant (truck chassis defs carry no mass); trailer tare is its chassis + body mass.
- Cargo with an **overweight permit** (`overweight: true` in the def — 46 ETS2 cargo, e.g.
  `log_stacker`, `tractor_c`) ignores the mass limit and loads by volume.
- When the limit leaves room for **0 units** the haul is a **dead run**: the cargo still spawns on
  the board and crowds out better jobs, but earns nothing.

Measured exact on 90.1% of 28,114 ETS2 AI hauls (#340). The cap is inert for datasets that carry no
overweight flags (ATS until validated — #342), leaving units at the volume/weight baseline.

### Trailer Zones

A trailer with a non-empty `country_validity` is legal only in those countries — Finland+Sweden HCT
road-trains, ATS doubles/triples per state. It is a fleet candidate only at garages inside its zone.

## The Algorithm

Each AI driver rolls his own job board: hauls never match the player's board, and the fifth driver
loading a garage-day gets as good a job as the first (register Q24; EXP-9: uniform garages earned
1.40–2.07× their mixed twins, 4 of 4 pairs; #352). One driver's expected value does not depend on the
others, so the best fleet is `MAX_DRIVERS` (5) copies of the single best trailer.

### Scoring a trailer

For a city, every depot spawns `JOBS_PER_DEPOT` (3) jobs drawn by cargo `prob_coef`. A driver takes the
best job his trailer can haul. A trailer's score is the exact expected value of that best job,
`analyticalFirstPickEVForRep` — E[max] over one board, with haul value = unit value × units (units
axle-mass capped, see "Units Per Haul"). Deterministic: no Monte Carlo, no random seed.

### Selection (`computeOptimalFleet()`)

1. Drop dominated body types; candidates are every ownable profile valid in the country (trailer zones).
2. Score each candidate as above.
3. Fleet = `MAX_DRIVERS` × the best candidate; an exact tie goes to the cheaper trailer.
4. The next `RUNNERS_UP` (4) candidates are returned as alternatives ("Runners-up" in the city view):
   a near-tie can win on price, level or zone.

### City Rankings

Each city runs the same `computeOptimalFleet`. `score = totalFleetEV` = `MAX_DRIVERS` × the best
trailer's per-driver EV. The rankings table and the city detail view share one computed fleet.

## Assumptions

### Job Distribution

Jobs spawn per depot weighted by cargo `prob_coef`; every driver's board is an independent draw.

### AI Driver Behavior

We assume AI drivers will:
- Take the best job their trailer can haul
- Not be picky about destination
- Operate continuously when possible

### Excluded Cargo

Some "cargo" types are actually **trailer delivery jobs** (e.g., Krone trailers, Feldbinder trailers). These jobs provide a pre-assigned trailer and don't require one from your garage. They're marked `excluded: true` and don't factor into optimization.

## Limitations

1. **Static data**: Actual in-game job availability fluctuates
2. **No destination modelling**: jobs carry no destination. The game's axle-mass limit is the stricter
   of the source and destination countries; with no destination to read, the loading rule above uses
   the home (source) country alone.
3. **No driver skills**: Real earnings depend on driver level, truck efficiency
4. **Equal probability assumption**: Game may weight certain jobs higher

Despite these limitations, the algorithm provides a solid baseline for garage optimization that can be refined with in-game experience.
