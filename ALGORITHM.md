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

## The Algorithm

The optimizer uses a **greedy weighted set cover** approach with three configurable parameters.

### Parameters

#### 1. Scoring Balance (0-100)
Controls the trade-off between value and coverage:
- **0** = Pure value focus (pick trailers that haul the highest-paying cargo)
- **100** = Pure coverage focus (pick trailers that can haul the most cargo types)
- **50** = Balanced (recommended starting point)

Formula:
```
valueWeight = (100 - scoringBalance) / 100
coverageWeight = scoringBalance / 100
score = valueWeight × normalizedValue + coverageWeight × coverage
```

#### 2. Garage Size (1-20)
Number of trailer slots available. Most city garages start with 3-5 slots and can be upgraded.

#### 3. Diversity Pressure (0-100)
Controls how aggressively the algorithm avoids duplicate trailers:
- **0** = No penalty for duplicates (may recommend 5 of the same trailer)
- **100** = Strong pressure for variety (forces mix of trailer types)

After each trailer selection, remaining cargo that's already covered gets a diminishing factor applied:
```
minFactor = 1 - (0.5 × strength)
coverageBonus = coverage × 0.5 × strength
factor = minFactor + coverageBonus
```

High-coverage trailers (those that can haul diverse cargo) receive a smaller penalty, making subsequent copies less heavily penalized.

### Selection Process

1. **Build the cargo pool**: Enumerate all (depot, cargo, value) tuples for the city
2. **Calculate trailer scores**: For each trailer type, compute:
   - Total value of cargo it can haul
   - Percentage of pool it covers
   - Combined score based on Scoring Balance
3. **Select best trailer**: Pick the highest-scoring trailer
4. **Apply diminishing returns**: Reduce scores for cargo types already covered
5. **Repeat**: Continue until garage is full

### City Rankings

The city ranking score uses a geometric mean to balance job availability and total value:
```
score = √(jobCount × totalValue)
```

This ensures cities need to perform well across both dimensions to rank highly:
- Many jobs = more work for AI drivers
- High total value = better earnings potential

The geometric mean prevents cities from ranking highly by excelling in just one dimension (e.g., many low-value jobs or few high-value jobs).

## Assumptions

### Job Distribution

We assume all jobs are **equally probable**. The game's actual job RNG is unknown, so we treat each cargo instance in the pool as equally likely to be offered.

### AI Driver Behavior

We assume AI drivers will:
- Take any available job they have a trailer for
- Not be picky about destination or cargo type
- Operate continuously when possible

### Excluded Cargo

Some "cargo" types are actually **trailer delivery jobs** (e.g., Krone trailers, Feldbinder trailers). These jobs provide a pre-assigned trailer and don't require one from your garage. They're marked `excluded: true` and don't factor into optimization.

## Practical Recommendations

### Starting Configuration
- **Scoring Balance: 50** - Good balance of value and flexibility
- **Diversity Pressure: 50** - Moderate variety without sacrificing optimal picks
- **Garage Size: 10** - Typical upgraded garage

### High-Value Strategy
Lower the Scoring Balance (20-30) if you prioritize earnings over job acceptance rate. Works best for cities with premium cargo (electronics, machinery).

### Coverage Strategy
Raise the Scoring Balance (70-80) if you want AI drivers to always have work, even if some jobs pay less.

### Specialized Cities
Some cities are heavily specialized (e.g., port cities with mostly containers). The algorithm will naturally recommend fewer trailer types with more copies.

## Limitations

1. **Static data**: Actual in-game job availability fluctuates
2. **No distance factoring**: We don't account for delivery destinations
3. **No driver skills**: Real earnings depend on driver level, truck efficiency
4. **Equal probability assumption**: Game may weight certain jobs higher

Despite these limitations, the algorithm provides a solid baseline for garage optimization that can be refined with in-game experience.
