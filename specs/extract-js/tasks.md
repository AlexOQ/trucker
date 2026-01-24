---
spec: extract-js
phase: tasks
total_tasks: 10
created: 2026-01-24
generated: auto
---

# Tasks: extract-js

## Phase 1: Make It Work (POC)

Focus: Validate extraction works end-to-end. Skip tests, ensure functionality preserved.

- [ ] 1.1 Create public/js/rankings.js with view rendering
  - **Do**: Extract renderRankings, renderCity, showCity, showRankings, formatRank, getCityRank, helper functions
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/rankings.js
  - **Done when**: All rendering logic in separate file with exports
  - **Verify**: File exists with export statement
  - **Commit**: `feat(ui): extract view rendering to rankings.js`
  - _Requirements: FR-2_
  - _Design: rankings.js component_

- [ ] 1.2 Create public/js/app.js with UI controller
  - **Do**: Extract init, event handlers, slider logic, filter logic, navigation, country dropdown
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/app.js
  - **Done when**: All UI logic in separate file, imports rankings.js
  - **Verify**: File exists with init export
  - **Commit**: `feat(ui): extract UI controller to app.js`
  - _Requirements: FR-1_
  - _Design: app.js component_

- [ ] 1.3 Update index.html to import app.js
  - **Do**: Remove inline script block (lines 164-849), add `<script type="module" src="js/app.js?v=3"></script>`, call app.init()
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/index.html
  - **Done when**: index.html has minimal bootstrap (import + init call), no inline script
  - **Verify**: index.html < 200 lines
  - **Commit**: `refactor(ui): move inline script to modules`
  - _Requirements: AC-1.3, AC-1.4_
  - _Design: Data flow_

- [ ] 1.4 POC Checkpoint
  - **Do**: Verify app works: npm run dev, test search, sliders, country filter, city navigation, garage toggle
  - **Done when**: All features functional in browser
  - **Verify**: Manual test of core flows
  - **Commit**: `feat(ui): complete inline JS extraction POC`

## Phase 2: Refactoring

After POC validated, clean up code.

- [ ] 2.1 Add proper module dependencies
  - **Do**: Ensure app.js imports all needed modules (rankings, data, optimizer, storage), rankings.js imports optimizer/storage
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/app.js, /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/rankings.js
  - **Done when**: All imports explicit, no undefined references
  - **Verify**: No console errors in browser
  - **Commit**: `refactor(ui): clarify module dependencies`
  - _Design: Architecture_

- [ ] 2.2 Extract shared state to module scope
  - **Do**: Move data, lookups, currentCityId, cachedRankings to app.js module scope, pass to functions as needed
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/app.js
  - **Done when**: State variables at module top, functions pure where possible
  - **Verify**: Type check passes (if applicable)
  - **Commit**: `refactor(ui): organize module state`
  - _Design: Data flow_

- [ ] 2.3 Add JSDoc comments to exported functions
  - **Do**: Document init() in app.js, renderRankings/renderCity/showCity/showRankings in rankings.js with @param/@returns
  - **Files**: /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/app.js, /Users/alexander.olshanetsky/projects/stuff/trucker-extract-js/public/js/rankings.js
  - **Done when**: All exported functions have JSDoc
  - **Verify**: Lint passes
  - **Commit**: `docs(ui): add JSDoc to module exports`
  - _Design: Documentation_

## Phase 3: Testing

- [ ] 3.1 Run existing lint
  - **Do**: npm run lint
  - **Files**: N/A
  - **Done when**: Lint passes with no errors
  - **Verify**: npm run lint exit code 0
  - **Commit**: `fix(ui): address lint issues` (if needed)

- [ ] 3.2 Manual regression testing
  - **Do**: Test all AC: search, sliders, country filter, garage toggle, hash routing, copy button
  - **Files**: N/A
  - **Done when**: All acceptance criteria verified working
  - **Verify**: Manual test checklist complete
  - **Commit**: N/A (documentation only)

## Phase 4: Quality Gates

- [ ] 4.1 Local quality check
  - **Do**: Run npm run lint, verify no console errors in browser
  - **Verify**: Lint clean, browser console clean
  - **Done when**: All checks pass
  - **Commit**: `fix(ui): final cleanup` (if needed)

- [ ] 4.2 Create PR and verify CI
  - **Do**: Push branch, create PR with `gh pr create --title "Extract inline JavaScript to modules" --body "$(cat <<'EOF'
## Summary
Extracts 685 lines of inline JavaScript from index.html to separate ES6 modules (app.js, rankings.js).

## Changes
- Created public/js/app.js (UI controller)
- Created public/js/rankings.js (view rendering)
- Updated index.html to import modules
- Preserved all existing functionality

## Test plan
- [x] Search works
- [x] Sliders update rankings/city view
- [x] Country filter works
- [x] Garage toggle persists
- [x] Hash routing preserved
- [x] Copy to clipboard works
- [x] Lint passes

Closes #45

🤖 Generated with ralph-specum
EOF
)"`
  - **Verify**: PR created, link in output
  - **Done when**: PR ready for review

## Notes

- **POC shortcuts taken**: No tests, manual verification only
- **Production TODOs**: Add unit tests for app.init, renderRankings, renderCity in future task
