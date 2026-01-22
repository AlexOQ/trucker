---
spec: score-context
phase: design
created: 2026-01-22
generated: auto
---

# Design: Score Context Display

## Overview

Frontend-only enhancement adding rank context to score display. Leverages existing sorted array - rank is array index + 1.

## Architecture

```
calculateCityRankings()
        |
        v
    rankings[]  <-- already sorted by score
        |
        v
  renderRankings()  -->  Add rank, totalCities to each row
        |
        v
  showCity()  -->  Look up city rank from cached rankings
```

## Components

### Data Enhancement

**Approach**: Add `rank` and `totalCities` to ranking data at render time

```javascript
// In renderRankings()
const totalCities = rankings.length
rankings.map((r, i) => ({
  ...r,
  rank: i + 1,
  totalCities,
  percentile: Math.round((1 - i / totalCities) * 100)
}))
```

### Rankings Table Changes

**Current** (index.html:178):
```html
<td class="score">${r.score.toFixed(0)}</td>
```

**New**:
```html
<td class="score rank-display" data-percentile="${percentile}">
  <span class="rank">#${rank}</span>
  <span class="rank-total">of ${totalCities}</span>
</td>
```

### City Detail View Changes

**Add new stat box** after existing stats (index.html:247):
```html
<div class="stat">
  <div class="stat-value">#${rank}</div>
  <div class="stat-label">of ${totalCities} cities</div>
</div>
```

### CSS Additions

```css
/* Rank display */
.rank-display {
  white-space: nowrap;
}

.rank {
  font-weight: bold;
  color: #f39c12;
}

.rank-total {
  color: #888;
  font-size: 0.85em;
  margin-left: 0.25em;
}

/* Top 10% highlight */
.rank-display[data-percentile="90"],
.rank-display[data-percentile="91"],
/* ... up to 100 */
.rank-display.top-tier .rank {
  color: #2ecc71;
}

/* Simpler: class-based */
.rank-display.top-tier .rank {
  color: #2ecc71;
}
```

## Data Flow

1. `renderRankings()` receives sorted rankings array
2. Maps array adding `rank = index + 1`, `totalCities = length`
3. Renders table with rank display
4. Stores rankings in module-level variable for city detail lookup
5. `renderCity()` looks up rank from stored rankings by cityId

## Technical Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Rank format | "#47/368", "#47 of 368", "47th" | "#47 of 368" | Most readable, matches issue request |
| Top tier threshold | 10%, 25%, 5% | 10% | Standard "top tier" convention |
| Store rankings | Recalculate vs cache | Cache in module var | Already calculated, avoid redundant work |
| Score tooltip | Show raw score | Yes, on hover | Preserves detailed info for power users |

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| `index.html` | Modify | Update table render, add stat box |
| `css/style.css` | Modify | Add rank display styles |

## Error Handling

| Error | Handling | User Impact |
|-------|----------|-------------|
| No rankings data | Show "-" for rank | Graceful fallback |
| City not in rankings | Show "Unranked" | Edge case for cities with no cargo data |

## Existing Patterns to Follow

- Tooltip pattern: `data-tooltip` attr + `.tooltip` class (css/style.css:581)
- Stat box pattern: `.stat`, `.stat-value`, `.stat-label` (index.html:231-248)
- Score styling: `.score` class with `#e74c3c` color (css/style.css:323-326)
- Mobile responsive: CSS hides columns with `@media (max-width: 600px)`
