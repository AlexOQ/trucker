---
spec: cargo-trailer-links
phase: requirements
created: 2026-01-23T22:30:00Z
generated: auto
---

# Requirements: cargo-trailer-links

## Summary
Display compatible trailer names on cargo cards so users can identify trailer requirements without opening detail view.

## User Stories

### US-1: View trailer compatibility on cargo card
As a truck company manager, I want to see which trailers haul each cargo on the cargo list, so that I know trailer requirements without clicking into details.

**Acceptance Criteria**:
- AC-1.1: Cargo card shows trailer names below value/provider line
- AC-1.2: Format: "Hauls on: Trailer1, Trailer2, Trailer3"
- AC-1.3: Up to 3 trailers shown, overflow shows "+N more"
- AC-1.4: Excluded cargo shows nothing or handled gracefully

### US-2: Maintain existing card layout
As a user, I want cargo cards to remain scannable and consistent, so that the interface doesn't become cluttered.

**Acceptance Criteria**:
- AC-2.1: Trailer info appears as additional line in subtitle area
- AC-2.2: Existing spacing and card height preserved
- AC-2.3: Responsive layout maintained on mobile

## Functional Requirements

| ID | Requirement | Priority | Source |
|----|-------------|----------|--------|
| FR-1 | Display trailer names on cargo cards | Must | US-1 |
| FR-2 | Show max 3 trailers, truncate with "+N more" | Must | US-1 |
| FR-3 | Use existing `getCargoTrailers()` function | Must | US-1 |
| FR-4 | Handle excluded cargo gracefully | Should | US-1 |
| FR-5 | Maintain existing card styling and layout | Must | US-2 |

## Non-Functional Requirements

| ID | Requirement | Category |
|----|-------------|----------|
| NFR-1 | No additional API calls, use cached data | Performance |
| NFR-2 | Consistent with existing card subtitle format | UX |
| NFR-3 | Works on mobile viewport (320px+) | Responsive |

## Out of Scope
- Clickable trailer names (no filtering implemented)
- Dedicated Trailers page
- Trailer detail view
- Sorting/filtering by trailer type

## Dependencies
- Existing frontend data loading (`data.js`)
- Existing `getCargoTrailers()` function in `cargo.html`
- Existing CSS classes (`.card-subtitle`)
