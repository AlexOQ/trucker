---
spec: fix-error-handling
phase: design
created: 2025-01-24
generated: auto
---

# Design: Fix Error Handling

## Overview

Apply existing error handling patterns from loadState/saveState to country filter functions and add response validation to loadJson.

## Components

### Component A: getSelectedCountries Fix

**Purpose**: Prevent app crash when localStorage contains corrupted country filter data

**Current Code** (storage.js:163-166):
```javascript
export function getSelectedCountries() {
  const saved = localStorage.getItem('ets2-selected-countries')
  return saved ? JSON.parse(saved) : []
}
```

**Fixed Code**:
```javascript
export function getSelectedCountries() {
  try {
    const saved = localStorage.getItem('ets2-selected-countries')
    if (saved) {
      return JSON.parse(saved)
    }
  } catch (e) {
    console.warn('Failed to load selected countries from localStorage:', e)
  }
  return []
}
```

### Component B: setSelectedCountries Fix

**Purpose**: Prevent silent failure when localStorage write fails

**Current Code** (storage.js:171-173):
```javascript
export function setSelectedCountries(countries) {
  localStorage.setItem('ets2-selected-countries', JSON.stringify(countries))
}
```

**Fixed Code**:
```javascript
export function setSelectedCountries(countries) {
  try {
    localStorage.setItem('ets2-selected-countries', JSON.stringify(countries))
  } catch (e) {
    console.warn('Failed to save selected countries to localStorage:', e)
  }
}
```

### Component C: loadJson Fix

**Purpose**: Provide clear error messages when JSON data files fail to load

**Current Code** (data.js:8-16):
```javascript
async function loadJson(filename) {
  if (dataCache[filename]) {
    return dataCache[filename]
  }
  const response = await fetch(`data/${filename}`)
  const data = await response.json()
  dataCache[filename] = data
  return data
}
```

**Fixed Code**:
```javascript
async function loadJson(filename) {
  if (dataCache[filename]) {
    return dataCache[filename]
  }
  const response = await fetch(`data/${filename}`)
  if (!response.ok) {
    throw new Error(`Failed to load ${filename}: HTTP ${response.status}`)
  }
  const data = await response.json()
  dataCache[filename] = data
  return data
}
```

### Component D: Empty Catch Block Fix

**Purpose**: Log warnings instead of silently swallowing errors

**Current Code** (cities.html:54-58):
```javascript
function getCollapsedCountries() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []
  } catch { return [] }
}
```

**Fixed Code**:
```javascript
function getCollapsedCountries() {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSE_KEY)) || []
  } catch (e) {
    console.warn('Failed to load collapsed countries from localStorage:', e)
    return []
  }
}
```

## File Structure

| File | Action | Purpose |
|------|--------|---------|
| public/js/storage.js | Modify | Fix getSelectedCountries and setSelectedCountries |
| public/js/data.js | Modify | Add response.ok check to loadJson |
| public/cities.html | Modify | Add console.warn to empty catch block |

## Error Handling

| Error | Handling | User Impact |
|-------|----------|-------------|
| Corrupted localStorage JSON | Return default, log warning | Filter resets to "all" |
| localStorage full/disabled | Log warning, continue | Selection not persisted |
| HTTP 404/500 on data file | Throw with status code | Init shows error message |

## Existing Patterns to Follow

Pattern from storage.js:24-43 (loadState):
- Wrap risky operations in try-catch
- Log warning with context: `console.warn('Failed to [action]:', e)`
- Return sensible default value from catch block
