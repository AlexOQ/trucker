---
spec: extract-js
phase: requirements
created: 2026-01-24
generated: auto
---

# Requirements: extract-js

## Summary
Extract 685 lines of inline JavaScript from index.html into separate ES6 modules for testability and maintainability.

## User Stories

### US-1: Extract UI logic to modules
As a developer, I want inline JavaScript moved to separate files so that I can write unit tests.

**Acceptance Criteria**:
- AC-1.1: public/js/app.js contains UI logic (sliders, search, filters, navigation)
- AC-1.2: public/js/rankings.js contains view rendering (rankings table, city detail)
- AC-1.3: index.html imports modules via script type="module"
- AC-1.4: No inline script blocks except minimal init bootstrap

### US-2: Preserve all functionality
As a user, I want the app to work exactly as before so that my workflow is uninterrupted.

**Acceptance Criteria**:
- AC-2.1: Search, sliders, country filter work identically
- AC-2.2: Hash routing (#city-19) preserved
- AC-2.3: Garage toggle and filter mode persist
- AC-2.4: Copy to clipboard works

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Extract UI event handlers to app.js | Must | US-1 |
| FR-2 | Extract view rendering to rankings.js | Must | US-1 |
| FR-3 | Preserve all existing functionality | Must | US-2 |
| FR-4 | Use ES6 module imports | Must | US-1 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | No functionality regression | Quality |
| NFR-2 | Code passes existing lint rules | Quality |

## Out of Scope
- Adding new features
- Rewriting logic
- Adding test files (separate task)

## Dependencies
- Existing modules: data.js, optimizer.js, storage.js
