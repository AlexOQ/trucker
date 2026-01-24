---
spec: fix-error-handling
phase: requirements
created: 2025-01-24
generated: auto
---

# Requirements: Fix Error Handling

## Summary

Add consistent error handling to storage.js and data.js functions that currently lack try-catch blocks or response validation.

## User Stories

### US-1: Graceful localStorage Recovery

As a user, I want the app to recover gracefully when localStorage contains corrupted data, so that I don't see a blank page or JavaScript error.

**Acceptance Criteria**:
- AC-1.1: getSelectedCountries() returns [] when JSON.parse fails
- AC-1.2: Console warning logged when parse fails
- AC-1.3: App continues to function normally after recovery

### US-2: Robust Data Loading

As a user, I want the app to show a clear error when data files fail to load, so that I understand what went wrong instead of seeing cryptic errors.

**Acceptance Criteria**:
- AC-2.1: loadJson() checks response.ok before parsing
- AC-2.2: Error message includes HTTP status and filename
- AC-2.3: Error propagates to init() catch block for user-friendly display

### US-3: Safe Storage Writes

As a user, I want my country selections to be saved reliably, or fail gracefully if storage is unavailable, so that the app doesn't break unexpectedly.

**Acceptance Criteria**:
- AC-3.1: setSelectedCountries() wrapped in try-catch
- AC-3.2: Console warning logged on write failure
- AC-3.3: App continues working even if storage write fails

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Wrap getSelectedCountries JSON.parse in try-catch | Must | US-1 |
| FR-2 | Return empty array on parse error in getSelectedCountries | Must | US-1 |
| FR-3 | Log warning with error details on getSelectedCountries failure | Must | US-1 |
| FR-4 | Check response.ok in loadJson before calling response.json | Must | US-2 |
| FR-5 | Throw descriptive error with status/filename on fetch failure | Must | US-2 |
| FR-6 | Wrap setSelectedCountries in try-catch | Must | US-3 |
| FR-7 | Log warning on setSelectedCountries failure | Must | US-3 |
| FR-8 | Add console.warn to empty catch block in cities.html | Should | US-1 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | Error handling must match existing loadState/saveState pattern | Consistency |
| NFR-2 | No external dependencies added | Maintainability |
| NFR-3 | No UI changes (console logging only) | Scope |

## Out of Scope

- Error toast/notification UI
- Retry logic for failed fetches
- Error reporting to external service
- Changes to other HTML files (cargo.html, companies.html)

## Dependencies

- GitHub issue #25 for context
