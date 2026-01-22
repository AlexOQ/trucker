---
spec: score-context
phase: research
created: 2026-01-22
generated: auto
---

# Research: Score Context Display

## Executive Summary

Feature adds ranking/percentile context to raw score values. Low complexity, frontend-only change. Scores already sorted in `calculateCityRankings()` - rank is simply array index + 1.

## Codebase Analysis

### Existing Patterns

| Pattern | Location | Relevance |
|---------|----------|-----------|
| Rankings calculation | `js/optimizer.js:215-244` | `calculateCityRankings()` returns sorted array - rank = index + 1 |
| Score display (table) | `index.html:178` | `<td class="score">${r.score.toFixed(0)}</td>` |
| Tooltip system | `css/style.css:581-665` | `.tooltip` class with `data-tooltip` attr |
| Stats display | `index.html:231-248` | City detail view stat boxes |
| Value formatting | `index.html:176` | `€${r.totalValue.toLocaleString()}` pattern |

### Score Calculation Flow

1. `calculateCityRankings()` iterates all cities
2. For each city: `score = Math.sqrt(jobs * value)` (geometric mean)
3. Array sorted by score descending: `rankings.sort((a, b) => b.score - a.score)`
4. Returns array where **rank = index + 1**

### Display Locations

| Location | File | Current Display | Change Needed |
|----------|------|-----------------|---------------|
| Rankings table | `index.html:169-180` | Raw score in last column | Add rank/total or percentile |
| City detail view | `index.html:225-280` | Score not shown in stats | Could add as stat box |

### Dependencies

- Pure frontend JS, no backend changes needed
- Data already available: rankings array length = total cities
- No new npm packages required

### Constraints

- Mobile responsive CSS hides some columns
- Tooltip already explains score meaning
- Must not break existing sorting functionality

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Rank is trivially derived from sorted array index |
| Effort Estimate | S | ~2-3 hours implementation |
| Risk Level | Low | Frontend-only, no data model changes |

## Recommendations

1. Pass `rank` and `totalCities` to render function
2. Display as "Rank #47 of 368" format (clearer than percentile)
3. Add to both rankings table and city detail stats
4. Consider color coding for top 10%, top 25%
