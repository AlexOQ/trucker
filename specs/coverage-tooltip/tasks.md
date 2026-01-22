---
spec: coverage-tooltip
phase: tasks
total_tasks: 3
created: 2026-01-22
generated: auto
---

# Tasks: coverage-tooltip

## Phase 1: Make It Work (POC)

- [x] 1.1 Update Coverage tooltip text
  - **Do**: Change data-tooltip attribute on Coverage th element, add tabindex="0"
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker/index.html
  - **Done when**: Tooltip shows new explanatory text on hover
  - **Verify**: Open browser, hover Coverage header, see new tooltip
  - **Commit**: `feat(ui): improve coverage tooltip explanation`
  - _Requirements: FR-1, FR-2_
  - _Design: Single Change_

## Phase 2: Validation

- [x] 2.1 Verify keyboard accessibility
  - **Do**: Tab to Coverage header, confirm tooltip appears on focus
  - **Files**: N/A (manual test)
  - **Done when**: Tooltip visible when element focused via keyboard
  - **Verify**: Tab through page, focus Coverage header, tooltip appears
  - **Commit**: N/A (verification only)
  - _Requirements: FR-3_

## Phase 3: Quality Gates

- [ ] 3.1 Visual consistency check
  - **Do**: Compare tooltip styling with existing algorithm slider tooltips
  - **Files**: N/A (manual test)
  - **Done when**: Styling matches existing tooltips
  - **Verify**: Side-by-side comparison with Scoring Balance tooltip
  - **Commit**: N/A (verification only)
  - _Requirements: NFR-1_

## Notes

- **POC shortcuts taken**: None needed - single line change
- **Production TODOs**: None - feature complete after 1.1
