---
spec: fix-error-handling
phase: research
created: 2025-01-24
generated: auto
---

# Research: Fix Error Handling

## Executive Summary

Fix goal confirmed. 4 error handling gaps identified in storage.js and data.js. Pattern exists in codebase (loadState/saveState) - apply consistently to missing locations.

## Codebase Analysis

### Existing Patterns (Good Examples)

**storage.js:24-43** - `loadState()`:
```javascript
try {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    const parsed = JSON.parse(stored)
    // ...
  }
} catch (e) {
  console.warn('Failed to load state from localStorage:', e)
}
return { ...defaultState }
```

**storage.js:48-54** - `saveState()`:
```javascript
try {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
} catch (e) {
  console.warn('Failed to save state to localStorage:', e)
}
```

### Missing Error Handling (Issues)

| Location | Function | Issue | Risk |
|----------|----------|-------|------|
| storage.js:163-166 | `getSelectedCountries()` | No try-catch around JSON.parse | App crash on corrupted data |
| storage.js:171-173 | `setSelectedCountries()` | No try-catch around setItem | Fails silently if storage full |
| data.js:8-16 | `loadJson()` | No response.ok check | Cryptic JSON parse error on 404 |
| cities.html:56-57 | `getCollapsedCountries()` | Empty catch block | Swallows errors silently |

### Dependencies

- Browser localStorage API
- Fetch API for JSON loading
- No external libraries involved

### Constraints

- Vanilla JavaScript (no TypeScript in public/)
- Must maintain backwards compatibility with existing localStorage data
- Console warnings only (no UI error toasts)

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Simple patterns to apply |
| Effort Estimate | S | 4 small changes |
| Risk Level | Low | Additive changes only |

## Recommendations

1. Apply existing loadState/saveState pattern to country functions
2. Add response.ok check before JSON parse in loadJson
3. Add console.warn to empty catch block in cities.html
