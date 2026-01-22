---
spec: score-context
phase: tasks
total_tasks: 10
created: 2026-01-22
generated: auto
---

# Tasks: Score Context Display

## Phase 1: Make It Work (POC)

Focus: Get rank displaying in both locations. Skip styling, accept hardcoded values.

- [ ] 1.1 Add rank to rankings table
  - **Do**: In `renderRankings()`, update table cell from `${r.score.toFixed(0)}` to `#${i + 1} of ${rankings.length}`
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/index.html` (line ~178)
  - **Done when**: Rankings table shows "#1 of N" instead of raw score
  - **Verify**: Open index.html in browser, check Score column shows rank format
  - **Commit**: `feat(rankings): display rank instead of raw score in table`
  - _Requirements: FR-1, FR-2_
  - _Design: Rankings Table Changes_

- [ ] 1.2 Cache rankings for city detail lookup
  - **Do**: Add `let cachedRankings = null` at module level. Set it in `renderRankings()`. Create `getCityRank(cityId)` helper function
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/index.html` (script section)
  - **Done when**: Can call `getCityRank(cityId)` and get `{rank, total}`
  - **Verify**: Add console.log in showCity(), verify rank data available
  - **Commit**: `feat(rankings): cache rankings for city detail lookup`
  - _Requirements: FR-3_
  - _Design: Data Flow_

- [ ] 1.3 Add rank stat box to city detail view
  - **Do**: In `renderCity()`, add new stat div after existing stats showing rank
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/index.html` (line ~247)
  - **Done when**: City detail shows "Rank: #N of M" in stats row
  - **Verify**: Click a city, verify rank stat appears
  - **Commit**: `feat(city): add rank stat box to detail view`
  - _Requirements: FR-3, AC-2.1, AC-2.2_
  - _Design: City Detail View Changes_

- [ ] 1.4 POC Checkpoint
  - **Do**: Verify rank displays in both locations, updates with slider changes
  - **Done when**: Rank shows in table and detail view, responds to settings
  - **Verify**: Change sliders, verify ranks update in both views
  - **Commit**: `feat(score-context): complete POC for rank display`
  - _Requirements: FR-4_

## Phase 2: Refactoring

After POC validated, clean up code.

- [ ] 2.1 Extract rank display formatting
  - **Do**: Create `formatRank(rank, total)` function returning HTML string
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/index.html`
  - **Done when**: Both table and detail view use same format function
  - **Verify**: Visual output unchanged, code DRY
  - **Commit**: `refactor(rankings): extract rank formatting function`
  - _Design: Data Enhancement_

- [ ] 2.2 Add CSS styles for rank display
  - **Do**: Add `.rank-display`, `.rank`, `.rank-total` styles. Add `.top-tier` class for top 10%
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/css/style.css`
  - **Done when**: Rank displays with proper styling, top 10% highlighted green
  - **Verify**: Check visual appearance matches design
  - **Commit**: `style(rankings): add rank display styles`
  - _Requirements: FR-5, AC-3.1, AC-3.2_
  - _Design: CSS Additions_

- [ ] 2.3 Add raw score tooltip
  - **Do**: Add `data-tooltip` with raw score to rank display cell
  - **Files**: `/Users/alexander.olshanetsky/projects/stuff/trucker/index.html`
  - **Done when**: Hovering rank shows "Score: 2804" tooltip
  - **Verify**: Hover over rank, see tooltip with raw score
  - **Commit**: `feat(rankings): show raw score in tooltip`
  - _Requirements: FR-6_
  - _Design: Existing Patterns to Follow_

## Phase 3: Testing

- [ ] 3.1 Manual test all scenarios
  - **Do**: Test rankings table, city detail, slider updates, mobile view, tooltip
  - **Files**: N/A (manual testing)
  - **Done when**: All scenarios work correctly
  - **Verify**: Checklist: table ranks, detail rank, sliders update, mobile, tooltip
  - **Commit**: N/A (no code changes)
  - _Requirements: All ACs_

- [ ] 3.2 Test edge cases
  - **Do**: Test city with 0 cargo (should show unranked), first/last city
  - **Files**: N/A (manual testing)
  - **Done when**: Edge cases handled gracefully
  - **Verify**: Find city with no cargo, verify display
  - **Commit**: `fix(rankings): handle unranked cities gracefully` (if needed)
  - _Design: Error Handling_

## Phase 4: Quality Gates

- [ ] 4.1 Local quality check
  - **Do**: Run any existing quality checks, verify no console errors
  - **Verify**: Open browser console, no JS errors. Check responsive layout
  - **Done when**: No errors, mobile layout works
  - **Commit**: `fix(rankings): address any lint/style issues` (if needed)
  - _Requirements: NFR-1, NFR-2, NFR-3_

- [ ] 4.2 Create PR and verify
  - **Do**: Push branch, create PR referencing issue #10
  - **Verify**: PR created, changes visible in diff
  - **Done when**: PR ready for review
  - **Commit**: N/A

## Notes

- **POC shortcuts taken**: Basic inline styling before CSS refactor
- **Production TODOs**: Ensure mobile CSS doesn't hide rank column
