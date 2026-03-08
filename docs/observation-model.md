# Observation-Based City Ranking Model

How the advisor recommends optimal garage locations and trailer sets.

## Data Pipeline

### Save Game Parsing (`scripts/parse-saves.cjs`)

Parses ETS2 save files to extract job market data. Maintains a **rolling 20-save window** — older saves drop naturally as new ones arrive, so the data survives game updates without manual intervention.

**Process**:
1. Reads all `.sii` files from the configured saves directory
2. Keeps the 20 most recent saves (by filename timestamp)
3. Re-parses all retained saves on each run for clean aggregation
4. Outputs `public/data/observations.json`

**Extracted data**:
- `city_companies`: which companies exist in which cities (depot counts)
- `city_job_count`: total observed jobs per city
- `city_body_type_frequency`: jobs per body type per city
- `body_type_avg_value`: average cargo value by body type (from game-defs)
- `city_cargo_frequency`, `city_trailer_frequency`: granular breakdowns

### Variant → Body Type Mapping

Save files use internal variant IDs (e.g., `scs_curt_a`, `scs_lowbed_4`) that don't match game-defs trailer IDs. A hard-coded `VARIANT_BODY_TYPE` map bridges 37 variants to 20 body types.

This is the correct granularity — ETS2 matches owned trailers to jobs by **body type**, not variant. All lowbed variants serve the same cargo pool.

## Ranking Model

### Question Answered

> "Where should I buy a garage to maximize income with 5 AI drivers?"

### Core Assumptions

- **5 drivers** independently seek jobs each cycle
- **10 trailer slots** per garage
- Each driver takes ONE job, consuming a physical trailer
- Job types follow observed city-specific distributions

### Binomial Contention Model

Each driver independently "rolls" against the city's job market. The probability that a random job matches body type B equals the observed frequency of B in that city.

**Key formulas**:
- Demand for body type B ~ **Binomial(5, p_B)** where p_B = observed frequency
- Expected drivers served with m copies: **E[min(X, m)]** for X ~ Binomial(5, p_B)
- Expected income from body type B: **E[min(X, m)] × avgValue_B**

### Diminishing Returns

The marginal value of the mth copy of a body type:

```
marginal(m) = avgValue × P(demand ≥ m | Binomial(5, p))
```

Since P(demand ≥ m+1) < P(demand ≥ m), each additional copy is worth strictly less. This naturally balances diversification vs. concentration.

**Example** — curtainside with p=0.15, avgValue=0.66:
| Copy | P(demand ≥ m) | Marginal Value |
|------|---------------|----------------|
| 1st  | 0.556         | 0.37           |
| 2nd  | 0.165         | 0.11           |
| 3rd  | 0.027         | 0.02           |

The 3rd curtainsider is almost worthless — most of the time 0 or 1 curtainside job appears.

### Greedy Allocation

To fill 10 trailer slots optimally:
1. Compute marginal value for each body type at current copy count
2. Pick the body type with highest marginal value
3. Add one copy, repeat until 10 slots filled

### City Score

**E[income/cycle]** = sum over all body types of E[min(demand, copies)] × avgValue, using the optimal 10-trailer allocation. Cities are ranked by this score.

## Observed Body Type Economics

From parsed save data (sorted by avg value per job):

| Body Type | Avg Value | % of Jobs | Character |
|-----------|-----------|-----------|-----------|
| lowboy    | 23.10     | 2.8%      | Rare, extremely valuable |
| lowbed    | 14.60     | 10.4%     | Common AND valuable — best ROI |
| flatbed   | 6.48      | 10.4%     | Good value, common |
| brick     | 2.64      | 0.5%      | Rare niche |
| log       | 1.96      | 2.9%      | Moderate niche |
| gastank   | 1.06      | 1.9%      | Niche |
| dryvan    | 0.64      | 23.4%     | Most common, low value |
| curtainside | 0.66    | 14.4%     | Common, low value |
| container | 0.49      | 11.1%     | Common, lowest value |

The optimizer naturally gravitates toward lowbed and flatbed: high value × decent frequency beats high-frequency low-value body types.

## Fallback Path

When no observation data exists for a city, the optimizer falls back to **game-defs theoretical pools**: cargo-trailer compatibility matrices weighted by depot counts and spawn coefficients. This provides reasonable estimates but observation data is always preferred since it reflects actual game behavior.

## Key Findings

- Jobs correlate strongly with depot count: **r=0.91**, ~2.7 jobs/depot
- City trailer distributions differ meaningfully: **KL divergence avg 1.62**
  - Port Sagunt: 40% car_transporter
  - Fier: 43% gastank
  - Most cities: ~25% dryvan, ~15% curtainside baseline
