---
spec: country-filter
phase: tasks
total_tasks: 15
created: 2026-01-23
generated: auto
---

# Tasks: Country/Region Filter

## Phase 1: Make It Work (POC)

Focus: Get country filter working end-to-end with basic UI.

- [x] 1.1 Add storage functions for country filter
  - **Do**: Add getSelectedCountries/setSelectedCountries to `/public/js/storage.js`
  - **Files**: `/public/js/storage.js`
  - **Done when**: Functions return/save array of country strings to localStorage key 'ets2-selected-countries'
  - **Verify**: Check localStorage in browser devtools
  - **Commit**: `feat(filter): add country filter storage functions`
  - _Requirements: FR-3_
  - _Design: Storage Module Extension_

- [x] 1.2 Extract unique countries from data
  - **Do**: In index.html, add function to extract unique countries from data.cities, sorted alphabetically
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: Function returns sorted array of 35 unique country strings
  - **Verify**: Console.log output shows complete country list
  - **Commit**: `feat(filter): extract unique countries from data`
  - _Requirements: FR-1_
  - _Design: Data Flow step 1_

- [x] 1.3 Add basic dropdown HTML structure
  - **Do**: Add country filter dropdown markup to index.html after search box, before existing filter toggle
  - **Files**: `/public/index.html`
  - **Done when**: Dropdown button and panel exist in DOM with hardcoded "All Countries" text
  - **Verify**: Visual inspection - elements visible but unstyled
  - **Commit**: `feat(filter): add country dropdown HTML structure`
  - _Requirements: FR-1_
  - _Design: UI Specification_

- [x] 1.4 Render country checkboxes dynamically
  - **Do**: Populate dropdown panel with checkboxes for each unique country
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: All 35 countries appear as checkboxes in dropdown
  - **Verify**: Inspect element shows all country options rendered
  - **Commit**: `feat(filter): dynamically render country checkboxes`
  - _Requirements: FR-1_
  - _Design: CountryFilter UI Component_

- [x] 1.5 Implement checkbox toggle logic
  - **Do**: Add click handlers to checkboxes that update selected countries array and save to storage
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: Clicking checkboxes updates localStorage
  - **Verify**: Check localStorage in devtools after clicking checkboxes
  - **Commit**: `feat(filter): implement checkbox selection logic`
  - _Requirements: FR-2, FR-3_
  - _Design: Data Flow step 2_

- [x] 1.6 Filter rankings by selected countries
  - **Do**: Modify renderRankings() to filter by selected countries before displaying
  - **Files**: `/public/index.html` (renderRankings function)
  - **Done when**: Selecting countries filters table to matching cities
  - **Verify**: Manual test - select Germany, see only German cities
  - **Commit**: `feat(filter): filter rankings by selected countries`
  - _Requirements: FR-2, FR-6_
  - _Design: Filter Integration_

- [x] 1.7 Add "All Countries" clear option
  - **Do**: Add checkbox for "All Countries" that clears selection and closes dropdown
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: Clicking "All Countries" clears filter and shows all cities
  - **Verify**: Manual test - select countries, click "All Countries", see full list
  - **Commit**: `feat(filter): add clear filter option`
  - _Requirements: FR-4_
  - _Design: Data Flow step 3_

- [x] 1.8 POC Checkpoint
  - **Do**: Verify country filter works end-to-end with all three filter types
  - **Done when**: Can filter by country + search + "My Garages" simultaneously
  - **Verify**: Manual test of all filter combinations
  - **Commit**: `feat(filter): complete country filter POC`

## Phase 2: Refactoring

Clean up POC code and improve UX.

- [x] 2.1 Add dropdown toggle behavior
  - **Do**: Implement show/hide dropdown on button click, close on outside click
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: Dropdown opens/closes properly, closes when clicking outside
  - **Verify**: Manual test - open dropdown, click outside, verify it closes
  - **Commit**: `refactor(filter): add dropdown toggle behavior`
  - _Design: CountryFilter UI Component_

- [x] 2.2 Update button text with selection count
  - **Do**: Update button text to show "X Countries" when filter active, "All Countries" when empty
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: Button text reflects current selection state
  - **Verify**: Select 2 countries, button shows "2 Countries"
  - **Commit**: `refactor(filter): show selection count in button`
  - _Requirements: FR-5_
  - _Design: CountryFilter UI Component_

- [x] 2.3 Restore filter state on page load
  - **Do**: Load selected countries from storage and apply filter on page init
  - **Files**: `/public/index.html` (init function)
  - **Done when**: Refreshing page maintains country filter selection
  - **Verify**: Select countries, refresh page, filter still active
  - **Commit**: `refactor(filter): restore filter state on load`
  - _Requirements: FR-3_
  - _Design: Data Flow step 1_

## Phase 3: Styling & Accessibility

Make dropdown look good and work for all users.

- [x] 3.1 Add dropdown CSS styling
  - **Do**: Create `.country-filter`, `.country-filter-btn`, `.country-dropdown`, `.country-option` styles matching design spec
  - **Files**: `/public/css/style.css`
  - **Done when**: Dropdown matches existing UI theme (dark background, orange accents)
  - **Verify**: Visual inspection - dropdown styled consistently
  - **Commit**: `style(filter): add country filter dropdown styling`
  - _Requirements: NFR-4_
  - _Design: UI Specification, Styling Tokens_

- [x] 3.2 Add keyboard navigation
  - **Do**: Implement keyboard handlers for Tab, Enter, Space, Escape, Arrow keys
  - **Files**: `/public/index.html` (inline script)
  - **Done when**: Can navigate and select countries using only keyboard
  - **Verify**: Manual keyboard test - open dropdown, navigate, select with Enter/Space
  - **Commit**: `a11y(filter): add keyboard navigation`
  - _Requirements: NFR-2, FR-7_
  - _Design: Accessibility Requirements_

- [ ] 3.3 Add ARIA attributes for screen readers
  - **Do**: Add aria-expanded, aria-label, aria-multiselectable, role attributes per design spec
  - **Files**: `/public/index.html`
  - **Done when**: All ARIA attributes present per accessibility spec
  - **Verify**: Run axe DevTools or similar accessibility checker
  - **Commit**: `a11y(filter): add ARIA attributes`
  - _Requirements: NFR-2, FR-7_
  - _Design: Accessibility Requirements_

## Phase 4: Quality Gates

- [ ] 4.1 Test responsive behavior
  - **Do**: Test dropdown on mobile (375px), tablet (768px), desktop (1920px)
  - **Verify**: DevTools responsive mode - dropdown usable at all breakpoints
  - **Done when**: Touch targets ≥44px on mobile, dropdown fits viewport
  - **Commit**: `test(filter): verify responsive behavior` (if fixes needed)
  - _Requirements: NFR-3_

- [ ] 4.2 Verify filter performance
  - **Do**: Test filter response time with all 404 cities, measure with console.time()
  - **Verify**: Filter + re-render completes in <100ms
  - **Done when**: Performance meets NFR-1 requirement
  - _Requirements: NFR-1_

## Notes

**POC shortcuts taken**:
- Dropdown styling minimal/unstyled
- No keyboard navigation
- No ARIA attributes
- Button text hardcoded

**Production TODOs** (addressed in Phase 2-3):
- Proper dropdown styling matching theme
- Keyboard accessibility (Arrow keys, Escape, Enter)
- Screen reader support (ARIA labels and roles)
- Responsive breakpoints for mobile
