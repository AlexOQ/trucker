---
spec: extract-js
phase: research
created: 2026-01-24
generated: auto
---

# Research: extract-js

## Executive Summary
Feasible. 685 lines inline script in index.html blocks testing + reuse. Extract to ES6 modules following existing pattern (data.js, optimizer.js, storage.js).

## Codebase Analysis

### Existing Patterns
- **ES6 modules**: `public/js/data.js`, `optimizer.js`, `storage.js` use export/import
- **Module structure**: Single responsibility per file
- **Import convention**: ES6 modules with ?v=X cache busting

### Dependencies
- Existing modules: data.js (loadAllData, buildLookups), optimizer.js (optimizeTrailerSet, calculateCityRankings), storage.js (settings/garages/filters)
- No external libraries, vanilla JS only

### Constraints
- Must preserve all functionality: search, sliders, navigation, country filter, garage toggle, hash routing
- Breaking change: older browsers without ES6 module support (acceptable per modern stack)

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Clear module boundaries, no circular dependencies |
| Effort Estimate | S | Single file extraction, ~4 hours |
| Risk Level | Low | Functionality preserved, testable extraction |

## Recommendations
1. Extract to 2 modules: app.js (UI logic), rankings.js (view rendering)
2. Keep minimal bootstrap in index.html (init only)
3. Follow existing import pattern with cache busting
