---
spec: coverage-tooltip
phase: requirements
created: 2026-01-22
generated: auto
---

# Requirements: coverage-tooltip

## Summary
Improve Coverage % tooltip text to clearly explain what the metric means to users.

## User Stories

### US-1: Understand coverage metric
As a user viewing trailer recommendations, I want to understand what Coverage % means so that I can make informed decisions about my trailer fleet.

**Acceptance Criteria**:
- AC-1.1: Coverage column header has a tooltip
- AC-1.2: Tooltip explains the metric in plain language
- AC-1.3: Tooltip mentions "cargo types" and "city depots"

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Coverage header shows tooltip on hover | Must | US-1 |
| FR-2 | Tooltip text explains % of cargo types coverable | Must | US-1 |
| FR-3 | Tooltip accessible via keyboard focus | Must | AC-1.1 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | Consistent styling with existing tooltips | UX |
| NFR-2 | Text fits within 250px max-width tooltip | UX |

## Out of Scope
- Dynamic tooltip showing actual X% value
- Tooltip on each row's coverage cell
- New tooltip styling or icons

## Dependencies
- Existing tooltip CSS (already implemented)
