---
spec: score-context
phase: requirements
created: 2026-01-22
generated: auto
---

# Requirements: Score Context Display

## Summary

Add ranking context to raw score values so users understand what "2804" means in relation to other cities.

## User Stories

### US-1: View city rank in rankings table
As a player, I want to see each city's rank position so I can quickly identify how it compares to others.

**Acceptance Criteria**:
- AC-1.1: Score column shows rank as "#47 of 368" format
- AC-1.2: Rank updates when algorithm settings change (sliders)
- AC-1.3: Format works on mobile (responsive)

### US-2: View rank in city detail view
As a player, I want to see the city's rank when viewing trailer recommendations so I know if this is a top-tier garage location.

**Acceptance Criteria**:
- AC-2.1: City detail stats section includes rank
- AC-2.2: Shows both rank position and total cities
- AC-2.3: Updates when algorithm settings change

### US-3: Quickly identify top cities
As a player, I want visual indication of top-ranked cities so I can quickly spot the best garage locations.

**Acceptance Criteria**:
- AC-3.1: Top 10% cities have visual distinction (color/badge)
- AC-3.2: Visual styling consistent with existing design

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Display rank as "#N of M" in rankings table | Must | US-1 |
| FR-2 | Replace raw score with rank display | Must | US-1 |
| FR-3 | Add rank stat box to city detail view | Must | US-2 |
| FR-4 | Recalculate ranks when settings change | Must | US-1, US-2 |
| FR-5 | Visual highlight for top 10% cities | Should | US-3 |
| FR-6 | Preserve raw score in tooltip | Should | US-1 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | Rank calculation must not add noticeable latency | Performance |
| NFR-2 | Display must work on mobile viewports | Accessibility |
| NFR-3 | Color coding must have sufficient contrast | Accessibility |

## Out of Scope

- Percentile display (rank format preferred per issue)
- Historical ranking trends
- Rank change indicators
- Backend API changes

## Dependencies

- Existing `calculateCityRankings()` function
- Existing tooltip CSS system
- Existing stat box component pattern
