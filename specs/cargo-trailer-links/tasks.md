---
spec: cargo-trailer-links
phase: tasks
total_tasks: 8
created: 2026-01-23T22:30:00Z
generated: auto
---

# Tasks: cargo-trailer-links

## Phase 1: Make It Work (POC)

Focus: Validate trailer names display correctly on cargo cards.

- [x] 1.1 Add formatTrailerNames helper function
  - **Do**: Add function after `getCargoTrailers()` (line 71) to format trailer array into display string
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/public/cargo.html`
  - **Done when**: Function returns "Hauls on: T1, T2" or "Hauls on: T1, T2, +3 more"
  - **Verify**: Open browser console, test function with sample data
  - **Commit**: `feat(cargo): add trailer name formatter`
  - _Requirements: FR-1, FR-2_
  - _Design: Component A_

- [x] 1.2 Update card HTML to include trailer info
  - **Do**: In `renderCargoList()` template (line 132-152), call `getCargoTrailers(cargo.id)`, format, add line to `.card-subtitle`
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/public/cargo.html`
  - **Done when**: Cargo cards show "Hauls on: [trailers]" below value/provider line
  - **Verify**: Load `/cargo.html`, check Helicopter card shows "Hauls on: Low Loader, Low Bed"
  - **Commit**: `feat(cargo): display trailer names on cards`
  - _Requirements: FR-1, FR-3_
  - _Design: Component B_

- [x] 1.3 POC Checkpoint
  - **Do**: Verify trailer info appears on all cargo cards, test truncation with cargo having >3 trailers
  - **Done when**: Feature works end-to-end, trailer names visible
  - **Verify**: Manual test of cargo list page
  - **Commit**: `feat(cargo): complete POC for trailer display`

## Phase 2: Refactoring

After POC validated, clean up code.

- [x] 2.1 Handle excluded cargo
  - **Do**: Add conditional check for `cargo.excluded`, skip trailer line if true
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/public/cargo.html`
  - **Done when**: Excluded cargo cards don't show trailer line
  - **Verify**: Load cargo page, check trailer delivery jobs (if any) don't show trailer info
  - **Commit**: `refactor(cargo): handle excluded cargo gracefully`
  - _Requirements: FR-4_
  - _Design: Error Handling_

- [ ] 2.2 Extract trailer display logic
  - **Do**: If needed, extract trailer formatting to reusable function, add comments
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/public/cargo.html`
  - **Done when**: Code is readable and follows existing patterns
  - **Verify**: No linting errors, code review passes
  - **Commit**: `refactor(cargo): extract trailer formatting logic`
  - _Design: Component A_

## Phase 3: Testing

- [ ] 3.1 Manual testing across browsers
  - **Do**: Test in Chrome, Firefox, Safari, mobile viewport
  - **Files**: N/A
  - **Done when**: Layout works on all viewports, no overflow issues
  - **Verify**: Visual inspection on 320px, 768px, 1024px widths
  - **Commit**: N/A (testing only)
  - _Requirements: NFR-3_

- [ ] 3.2 Test edge cases
  - **Do**: Test cargo with 0 trailers, 1 trailer, 3 trailers, >3 trailers, excluded cargo
  - **Files**: N/A
  - **Done when**: All edge cases handled gracefully
  - **Verify**: Manual test with various cargo types
  - **Commit**: N/A (testing only)

## Phase 4: Quality Gates

- [ ] 4.1 Local quality check
  - **Do**: Check for console errors, verify no performance regression
  - **Verify**: Page loads <1s, no JS errors
  - **Done when**: All checks pass
  - **Commit**: N/A

- [ ] 4.2 Verify against acceptance criteria
  - **Do**: Review AC-1.1 through AC-2.3 from requirements.md
  - **Verify**: All criteria met, screenshot evidence collected
  - **Done when**: Feature matches GitHub issue #12 expectations
  - **Commit**: N/A

## Notes

- **POC shortcuts taken**: No handling of excluded cargo initially
- **Production TODOs**: Add proper excluded cargo handling in Phase 2
