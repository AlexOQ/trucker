---
spec: fix-error-handling
phase: tasks
total_tasks: 5
created: 2025-01-24
generated: auto
---

# Tasks: Fix Error Handling

## Phase 1: Make It Work (POC)

Focus: Apply error handling fixes to all identified locations.

- [x] 1.1 Fix getSelectedCountries in storage.js
  - **Do**: Wrap JSON.parse in try-catch, return [] on error, log warning
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-fix-error-handling/public/js/storage.js
  - **Done when**: Function returns [] instead of throwing on corrupted data
  - **Verify**: Manually test by setting corrupted JSON in localStorage
  - **Commit**: `fix(storage): add error handling to getSelectedCountries`
  - _Requirements: FR-1, FR-2, FR-3_
  - _Design: Component A_

- [x] 1.2 Fix setSelectedCountries in storage.js
  - **Do**: Wrap localStorage.setItem in try-catch, log warning on failure
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-fix-error-handling/public/js/storage.js
  - **Done when**: Function logs warning instead of throwing when storage unavailable
  - **Verify**: Test by filling localStorage quota (hard to test, visual inspection OK)
  - **Commit**: `fix(storage): add error handling to setSelectedCountries`
  - _Requirements: FR-6, FR-7_
  - _Design: Component B_

- [ ] 1.3 Fix loadJson in data.js
  - **Do**: Add response.ok check after fetch, throw descriptive error if not ok
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-fix-error-handling/public/js/data.js
  - **Done when**: Failed fetch shows "Failed to load X: HTTP 404" instead of JSON parse error
  - **Verify**: Rename a data file temporarily, check error message in console
  - **Commit**: `fix(data): check response.ok before JSON parse in loadJson`
  - _Requirements: FR-4, FR-5_
  - _Design: Component C_

- [ ] 1.4 Fix empty catch block in cities.html
  - **Do**: Add console.warn with error to catch block in getCollapsedCountries
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-fix-error-handling/public/cities.html
  - **Done when**: Catch block logs warning with error details
  - **Verify**: Visual code inspection
  - **Commit**: `fix(cities): log warning in getCollapsedCountries catch block`
  - _Requirements: FR-8_
  - _Design: Component D_

## Phase 2: Verification

- [ ] 2.1 Verify all fixes and create PR
  - **Do**: Run dev server, test all pages load correctly, create PR referencing #25
  - **Files**: N/A
  - **Done when**: All pages load, PR created with issue reference
  - **Verify**: `npm run dev` and test in browser, `gh pr create`
  - **Commit**: N/A (PR only)
  - _Requirements: All_

## Notes

- **POC shortcuts taken**: None - changes are small and complete
- **Production TODOs**: None - ready for merge after verification
