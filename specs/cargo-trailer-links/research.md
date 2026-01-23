---
spec: cargo-trailer-links
phase: research
created: 2026-01-23T22:30:00Z
generated: auto
---

# Research: cargo-trailer-links

## Executive Summary
Adding trailer info to cargo cards is feasible with minimal changes. Backend query exists, frontend data available. UX improvement addresses visibility gap where users see valuable cargo but don't know compatibility.

## Codebase Analysis

### Existing Patterns
- **Data Loading**: `/public/js/data.js` loads all entities, builds lookup maps
- **Cargo Display**: `/public/cargo.html` renders cards with value, providers
- **Trailer Query**: `getCargoTrailers(cargoId)` already implemented (lines 63-70)
- **Detail View**: Shows full trailer table, but not on card view

### Dependencies
- **Backend**: `src/db/queries.ts::getTrailersForCargo` (line 29-36)
- **Frontend**: Existing `lookups.cargoTrailerMap`, `lookups.trailersById`
- **Styling**: `/public/css/style.css` has `.card-subtitle`, `.tags` classes

### Constraints
- **Read-only**: Display only, no interaction beyond existing detail view link
- **Performance**: Trailers fetched at load time, no additional API calls
- **Responsive**: Must work with existing card grid layout
- **Consistency**: Follow existing card pattern (provider count format)

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Data already fetched, function exists |
| Effort Estimate | S | <2h - one function call, one line of HTML |
| Risk Level | Low | No schema changes, minimal UI change |

## Recommendations
1. Add trailer name list to card subtitle (matches provider format)
2. Limit display to 3 trailers, show "+N more" for overflow
3. Use existing `getCargoTrailers()` function from detail view logic
4. Handle excluded cargo (show nothing or "No Trailer")
