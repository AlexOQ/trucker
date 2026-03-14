# Agent Workflow System

Multi-agent development workflow with centralized PM coordination and phase-aware state tracking.

## Quick Reference

| Command | What It Does |
|---------|--------------|
| `status` | Show current phase, what's done, what's pending |
| `run user testing` | QA personas + UX research agents test prod → `analysis/user-testing.md` |
| `perform QA work` | Review closed issues, test local dev → `analysis/qa-review.md` |
| `run architect review` | Major codebase improvements → `analysis/arch-review.md` |
| `audit documentation` | Scan all doc sources → `analysis/docs-review.md` |
| `PM review` | Read analysis/, create GitHub issues, set priorities |
| `start development` | Pull from queue, run ralph-specum flow in worktrees |
| `merge and cleanup` | Squash-merge PRs, remove worktrees, pull main, transition to analysis |

## State Machine

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│                           COMPLETE WORKFLOW CYCLE                                   │
├───────────────────────────────────────────────────────────────────────────────────┤
│                                                                                     │
│   ┌──────────┐     ┌──────────┐     ┌──────────┐     ┌──────────┐                 │
│   │ ANALYSIS │ ──▶ │    PM    │ ──▶ │   DEV    │ ──▶ │  MERGE   │ ──┐            │
│   │  PHASE   │     │  REVIEW  │     │  PHASE   │     │  PHASE   │   │            │
│   └──────────┘     └──────────┘     └──────────┘     └──────────┘   │            │
│        ▲                                                             │            │
│        │                                                             │            │
│        └─────────────────────────────────────────────────────────────┘            │
│                                                                                     │
│   ANALYSIS PHASE:                                                                  │
│        ├── User Testing (prod)                                                     │
│        ├── QA Review (local dev)                                                   │
│        ├── Architect Review (codebase)                                             │
│        └── Documentation Audit (all sources)                                       │
│                                                                                     │
│   MERGE PHASE:                                                                     │
│        ├── Squash-merge all open PRs                                               │
│        ├── Force-remove worktrees                                                  │
│        ├── Delete local feature branches                                           │
│        ├── Pull main with merged changes                                           │
│        ├── Move unblocked issues to queue                                          │
│        └── Reset analysisComplete flags                                            │
│                                                                                     │
└───────────────────────────────────────────────────────────────────────────────────┘
```

## State Tracking

**State File**: `analysis/.state.json`

**Principle**: State file tracks ONLY current cycle progress. GitHub is source of truth for issues, priorities, and blockers.

```json
{
  "currentPhase": "analysis|pm-review|development|merge",
  "priorityLevel": "P1",
  "lastTransition": "2024-01-15T10:30:00Z",
  "analysisComplete": {
    "userTesting": false,
    "qaReview": false,
    "architectReview": false,
    "documentationAudit": false
  },
  "developmentQueue": [
    {"issue": 123, "title": "Add feature X", "priority": "P1"}
  ],
  "completedThisCycle": [120, 121],
  "openPRs": [130, 131],
  "notes": "Optional context"
}
```

**Fields**:
- `developmentQueue`: Max 5 unblocked issues selected for this cycle
- `completedThisCycle`: Issues with PRs created this cycle
- `openPRs`: PRs awaiting merge
- `notes`: Brief context for next session

**What's NOT in state** (tracked in GitHub instead):
- All open issues → `gh issue list --state open`
- Issue priorities → Labels on GitHub
- Issue dependencies → References in issue bodies

**Note**: `blockedIssues` IS tracked in state for cycle management. GitHub issue bodies also reference blockers with "blocked by #XX" for cross-cycle visibility.

**State Transitions**:
- `analysis` → `pm-review`: When all required analyses complete
- `pm-review` → `development`: When PM selects development batch (max 5 issues)
- `development` → `merge`: When developmentQueue empty, openPRs populated
- `merge` → `analysis`: After PRs merged, worktrees cleaned, state reset

---

## Required Permissions

Background agents cannot prompt for permissions interactively. Add these to `~/.claude/settings.local.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(cd * && git:*)",
      "Bash(npm:*)",
      "Bash(cd * && npm:*)",
      "Bash(gh:*)",
      "Bash(cd * && gh:*)",
      "Bash(npx:*)",
      "Bash(cd * && npx:*)",
      "Bash(vitest:*)",
      "Bash(ls:*)",
      "Bash(pwd:*)",
      "Bash(mkdir:*)",
      "Bash(echo:*)",
      "Bash(sleep:*)",
      "Bash(tail:*)",
      "Bash(head:*)",
      "Bash(pkill:*)",
      "Bash(cat:*)",
      "Read(/Users/<username>/projects/**)",
      "Write(/Users/<username>/projects/**)",
      "Edit(/Users/<username>/projects/**)",
      "Glob(/Users/<username>/projects/**)",
      "Grep(/Users/<username>/projects/**)"
    ]
  }
}
```

**Why These Permissions**:
- `git`: Worktree creation, branch management, commits, pushes
- `npm/npx`: Installing dependencies, running scripts, test runners
- `gh`: Creating PRs, listing issues, GitHub API operations
- `vitest`: Running test suites
- `ls/pwd/mkdir`: Directory operations for worktrees
- `tail/head/cat`: Reading output files from background agents
- `pkill`: Killing stuck background processes
- File operations: Reading/writing code in project directories

**Common Errors Without Permissions**:
```
Permission to use Bash/Read has been auto-denied (prompts unavailable)
```
This occurs when background agents (`run_in_background: true`) try to use tools without pre-approved permissions.

---

## Known Limitations

### Background Agents Don't Inherit Permissions

**Issue**: Task subagents spawned with `run_in_background: true` do NOT inherit permissions from `settings.local.json`. Even with correctly configured permission patterns, background agents receive "Permission denied (prompts unavailable)" errors.

**Root Cause**: Under investigation. The permissions in `settings.local.json` apply to the main session only. Background Task agents run in a restricted context that doesn't inherit these settings.

**Attempted Solutions That Don't Work**:
- Adding explicit path patterns (e.g., `Read(/path/to/trucker-*/**)`)
- Session restart after adding permissions
- Different glob pattern syntax

**Current Workaround**: Use **foreground Task agents** with `model: sonnet` instead of background agents:

```
# DON'T: Background agents (can't prompt for permissions)
Task(subagent_type=ralph-specum, run_in_background=true, ...)

# DO: Foreground agents (CAN prompt for permissions)
Task(subagent_type=ralph-specum:plan-synthesizer, model=sonnet, run_in_background=false, ...)
```

**Why Foreground Agents Work**:
- `run_in_background: false` (or omitted) → Agent runs synchronously
- Synchronous agents CAN prompt for permissions interactively
- User approves permissions once, agent continues

**Model Cost Optimization**:
- Main session (opus): Coordinator only - status, spawning, PM decisions
- Development agents (sonnet): Foreground tasks doing file work
- This preserves opus tokens for high-value decisions

**Impact**:
- Development is sequential (one agent at a time)
- Permissions work correctly via interactive prompts
- Significant token cost savings (sonnet vs opus for file operations)

**TODO**: Investigate how to properly grant permissions to background Task subagents for parallel execution.

---

## Model Configuration

| Role | Model | Rationale |
|------|-------|-----------|
| Main Session | `opus` | Coordinator - status, spawning, high-level decisions |
| PM Agent | `opus` | Complex synthesis, prioritization decisions |
| User Testing (Playwright) | `sonnet` | Browser-based functional testing |
| User Testing (Code-Level) | `sonnet` x2 | UX audit via code/CSS/HTML analysis |
| QA Agent | `sonnet` | Code review, test analysis |
| Architect Agent | `sonnet` | Pattern analysis |
| Documentation Agent | `sonnet` | Content review |
| Development Agent | `sonnet` | Code generation, spec execution |

**Cost Optimization Pattern**:
- Main session stays as lightweight coordinator (opus)
- All file operations delegated to foreground Task agents (sonnet)
- PM decisions use opus for quality, everything else uses sonnet

When invoking via Task tool, set `model` parameter:
```
Task tool:
  subagent_type: ralph-specum:plan-synthesizer
  model: sonnet
  run_in_background: false  # Foreground = can prompt for permissions
  prompt: ...
```

---

## Agent Definitions

### PM Agent (Coordinator)

**Invoke**: `voltagent-biz:product-manager`
**Model**: `opus`

**Core Principle**: GitHub is the source of truth. State file only tracks current cycle progress.

**Workflow** (in order):
1. **Fetch ALL open issues**: `gh issue list --state open --json number,title,labels,body`
2. **Review existing issues first** - check priorities, blockers, duplicates
3. **Read analysis/*.md files** - synthesize new findings
4. **Update existing issues** if findings relate to them (comment, re-label, close as duplicate)
5. **Create new issues only** for genuinely new work not covered by existing issues
6. **Select development batch** - up to 5 unblocked issues for this cycle

**GitHub as Source of Truth**:
- Blocked issues: Use "blocked by #XX" in issue body, not state file
- Priorities: Labels `priority:P0|P1|P2|P3`
- Dependencies: Reference other issues in body
- Status: Open/closed state

**Issue Selection Criteria** (for development batch):
1. P0 issues first (blockers)
2. P1 issues that are unblocked
3. Quick wins (small effort, high impact)
4. Maximum 5 issues per cycle
5. Consider dependency chains - don't select if blocker is also in batch

**Labels**:
- Priority: `priority:P0|P1|P2|P3`
- Type: `type:bug|feature|tech-debt|ux`
- Source: `source:user-testing|qa|architect|docs`

**Output Format**:
```
## Existing Issues Review
| # | Title | Priority | Status | Action |
|---|-------|----------|--------|--------|

## New Issues Created
| # | Title | Priority | Rationale |
|---|-------|----------|-----------|

## Development Batch (this cycle)
| # | Title | Priority | Effort |
|---|-------|----------|--------|
[max 5 unblocked issues]

## Deferred
[Issues not in this batch with reasoning]
```

**State Updates**:
- Set `developmentQueue` with selected batch (max 5)
- Set `completedThisCycle` to []
- Issues with unresolved dependencies go to `blockedIssues` in state
- Transition to "development"

---

### User Testing Agent Stack

**Target**: Production deployment (https://alexoq.github.io/trucker)

**Architecture**: 3 agents run in **parallel** (all background), each assigned 5-6
randomly selected features from the most recent development cycle's closed PRs.

| Agent | Type | Persona | Method |
|-------|------|---------|--------|
| Playwright Agent | `voltagent-qa-sec:qa-expert` | Mobile user (390x844) | Browser automation via Playwright |
| Code-Level Agent A | `voltagent-qa-sec:qa-expert` | Accessibility/keyboard user | Code/CSS/HTML analysis (no browser) |
| Code-Level Agent B | `voltagent-qa-sec:qa-expert` | Power user with all DLCs | Code/CSS/HTML analysis (no browser) |

**Model**: `sonnet` (all three agents)

#### Feature Assignment

The coordinator randomly distributes testable user-facing features from `completedThisCycle`
across the 3 agents. Each agent gets 5-6 features with no overlap. Internal refactors,
documentation-only changes, and test-only PRs are excluded from the pool.

Example feature pool (from a typical cycle):
- Mobile layout fixes, touch targets
- Accessibility/ARIA improvements
- Score tier colors and percentiles
- Column sorting, search feedback
- Dark/light mode toggle
- City comparison view
- Service worker / offline support
- CSV/JSON export, Copy Fleet
- DLC banner, onboarding section
- Garage star toggle

#### Playwright Agent

**Invoke**: `voltagent-qa-sec:qa-expert` + Playwright
**Persona**: Randomly selected from persona pool (see below)
**Scope**: 5-6 assigned features only — do NOT test the entire app

**Workflow**:
1. Navigate prod URL via Playwright at assigned viewport size
2. Test each assigned feature with a focused user journey
3. Document friction points, bugs, regressions
4. Rate severity (P0-P3) with specific CSS/HTML/JS references

#### Code-Level Agents (x2)

**Invoke**: `voltagent-qa-sec:qa-expert` (NO Playwright)
**Persona**: Randomly selected from persona pool
**Scope**: 5-6 assigned features only

**Workflow**:
1. Read the relevant source files (HTML, CSS, TypeScript) for each assigned feature
2. Analyze from the persona's perspective: would this work for them?
3. Check accessibility (ARIA, keyboard, contrast), responsive CSS, edge cases
4. Cross-reference with other pages for consistency
5. Document findings with file:line references and severity ratings

**Key advantage**: ~3x faster than Playwright. Catches CSS bugs, missing ARIA,
edge cases, and inconsistencies without browser overhead. Misses runtime/visual
bugs — that's what the single Playwright agent covers.

#### Persona Pool (randomly select 1 per agent)

```yaml
casual_trucker:
  name: "Mike"
  viewport: "1440x900"
  experience: "Plays ETS2 casually, 50 hours"
  focus: "Quick answers, obvious UI, no deep optimization"

mobile_user:
  name: "Sofia"
  viewport: "390x844"
  experience: "200 hours, checks on phone during breaks"
  focus: "Touch targets, responsive layout, fast reference"

accessibility_user:
  name: "Dana"
  viewport: "1280x720"
  experience: "Relies on keyboard + screen reader"
  focus: "ARIA, keyboard nav, focus management, contrast"

power_user:
  name: "Elena"
  viewport: "1920x1080"
  experience: "500+ hours, all DLCs, 10+ garages"
  focus: "Data accuracy, export, comparison, filtering"

new_player:
  name: "Jake"
  viewport: "1366x768"
  experience: "Just started ETS2, 5 hours"
  focus: "Terminology confusion, onboarding, guidance"

data_enthusiast:
  name: "Raj"
  viewport: "1920x1080"
  experience: "300 hours, loves spreadsheets"
  focus: "Export data, verify calculations, inspect numbers"
```

#### Output

All 3 agents write to `analysis/user-testing.md`. Each agent writes a clearly
labeled section: `## Playwright Agent: [Persona Name]`, `## Code-Level Agent A: [Persona Name]`,
`## Code-Level Agent B: [Persona Name]`. The coordinator merges any conflicts.

At the end, include a `## Cross-Agent Summary` section with deduplicated findings
sorted by severity.

---

### QA Agent (White Box)

**Invoke**: `pr-review-toolkit:code-reviewer` + `pr-review-toolkit:pr-test-analyzer`
**Model**: `sonnet`

**Target**: Local dev server (localhost:5173)

**Context Sources**:
- Recently closed GitHub issues (last cycle)
- Recent commits on main
- Current codebase state

**Output**: `analysis/qa-review.md`

**Workflow**:
1. Pull recently closed issues via `gh issue list --state closed --limit 20`
2. Review related code changes
3. Run test suite, analyze coverage
4. Check for regressions, edge cases
5. Test against local dev server
6. Document findings with code references

**Review Dimensions**:
- Code correctness
- Test coverage gaps
- Error handling
- Performance concerns
- Security considerations
- Silent failures (uses `pr-review-toolkit:silent-failure-hunter`)

---

### Architect Agent

**Invoke**: `ralph-specum:architect-reviewer`
**Model**: `sonnet`

**Scope**: Major codebase-level improvements

**Trigger Considerations**:
- Framework migrations (when beneficial)
- Major refactoring for upcoming features
- Technical debt reaching critical mass
- Performance architecture issues
- Scalability concerns

**Output**: `analysis/arch-review.md`

**Workflow**:
1. Analyze codebase structure and patterns
2. Identify architectural pain points
3. Evaluate framework/library alternatives (if relevant)
4. Propose refactoring strategies
5. Estimate effort vs benefit
6. Flag blocking issues for upcoming work

**Review Dimensions**:
- Code organization and modularity
- Dependency health and updates
- Performance architecture
- Scalability patterns
- Developer experience
- Alignment with project roadmap

---

### Documentation Agent

**Invoke**: `voltagent-dev-exp:documentation-engineer`
**Model**: `sonnet`

**Sources** (multi-location):
- GitHub issues (descriptions, comments)
- GitHub PRs (descriptions, review comments)
- Code comments and docstrings
- README and docs/ files
- Self-documenting code patterns

**Output**: `analysis/docs-review.md`

**Workflow**:
1. Scan all documentation sources
2. Check for accuracy (does doc match code?)
3. Identify duplicates and conflicts
4. Find gaps in documentation
5. Verify examples still work
6. Flag stale or misleading content

**Review Dimensions**:
- Accuracy (truth)
- Completeness (coverage)
- Freshness (up-to-date)
- Consistency (no conflicts)
- Discoverability (can users find it?)

---

### Development Agent

**Invoke**: `ralph-specum:spec-executor` with `--quick` flag
**Model**: `sonnet`

**Execution Pattern**:
1. Create git worktree per issue: `git worktree add ../trucker-<issue-slug> -b feat/<issue-slug>`
2. Run ralph-specum with `--quick` flag (skips interactive phases, auto-generates specs)
3. Agent works autonomously: generates specs, executes tasks, commits
4. **Clean up specs before PR**: `rm -rf specs/` (specs are ephemeral, not committed)
5. Agent creates PR with "Closes #XX" in body

**The `--quick` Flag**:
- Skips goal interview (non-interactive)
- Auto-generates: research.md, requirements.md, design.md, tasks.md (in worktree only)
- Executes all tasks sequentially
- Commits after each task
- **Deletes specs/ before final push** (specs/ is gitignored)
- Pushes and creates PR at end

**Agent Invocation**:
```
Task tool:
  subagent_type: ralph-specum:spec-executor
  model: sonnet
  prompt: |
    Complete issue #XX: <title>

    Worktree: /path/to/worktree
    Branch: feat/<issue-slug>

    <issue body with acceptance criteria>

    End with PR: gh pr create --body "...Closes #XX"
  run_in_background: true  # requires pre-approved permissions
```

**Integration**:
- Pulls work from `developmentQueue` in state
- References GitHub issues for requirements
- PR body includes "Closes #XX" to auto-close issue on merge
- State tracks `openPRs` for pending merges

---

### Merge Agent

**Invoke**: User command `merge and cleanup`

**Trigger**: When `developmentQueue` is empty and `openPRs` has items

**Workflow** (order matters!):
```bash
# 1. Check mergeability of all open PRs
gh pr list --state open --json number,headRefName,mergeable,mergeStateStatus

# 2. For each conflicting PR (mergeable=CONFLICTING): rebase in worktree
#    Skip if worktree missing or conflict too complex (close PR, keep issue open)
cd /path/to/worktree
git fetch origin
git rebase origin/main
# If rebase fails with complex conflicts:
#   - git rebase --abort
#   - gh pr close <num> --comment "Conflicts too complex, needs reimplementation"
#   - Continue with other PRs
# If rebase succeeds:
git push --force-with-lease origin <branch>

# 3. Squash-merge all mergeable PRs (WITHOUT --delete-branch)
gh pr list --state open --json number -q '.[].number' | while read pr; do
  gh pr merge $pr --squash
done

# 4. Force-remove worktrees FIRST (before branch deletion)
git worktree list | grep -v "main\|master" | awk '{print $1}' | while read path; do
  git worktree remove --force "$path"
done

# 5. Delete local feature branches (now safe - no worktrees using them)
git branch | grep "feat/" | xargs -r git branch -D

# 6. Pull main with merged changes
git pull origin main

# 7. Clean analysis folder (keep .state.json)
rm -f analysis/*.md

# 8. Update state to fresh cycle
```

**Why this order**:
- Check mergeability FIRST - PRs may have conflicts from other merged PRs
- Rebase conflicting PRs before attempting merge
- If rebase fails (complex conflicts): close PR, keep issue open for next cycle
- `gh pr merge --delete-branch` fails if worktree uses the branch
- Must remove worktrees before deleting branches
- `--squash` without `--delete-branch` merges PR, leaves branch for manual cleanup

**State Updates After Merge**:
```json
{
  "currentPhase": "analysis",
  "openPRs": [],
  "blockedIssues": [],
  "completedThisCycle": [25, 26, 27],
  "analysisComplete": {
    "userTesting": false,
    "qaReview": false,
    "architectReview": false,
    "documentationAudit": false
  }
}
```

**What Gets Reset**:
- `openPRs`: cleared (all merged)
- `analysisComplete`: all false (new cycle)
- Analysis files: deleted (stale data)

**What Gets Preserved**:
- `completedThisCycle`: kept (PM needs this for issue prioritization)
- `developmentQueue`: kept (may have unblocked issues)

**Note**: `completedThisCycle` is reset by PM when transitioning to development phase.

**Common Errors and Handling**:

| Error | Cause | Solution |
|-------|-------|----------|
| `Pull Request is not mergeable` | PR has conflicts with main | Rebase in worktree, push, retry |
| `mergeable: CONFLICTING` | Other PRs merged first, causing conflicts | Rebase each conflicting PR before merge |
| `Could not apply <commit>` | Rebase conflict too complex | Abort rebase, close PR, keep issue open |
| `failed to delete local branch` | Worktree still using branch | Force-remove worktree first |
| `contains modified or untracked files` | Spec files in worktree | Use `--force` flag |
| `local changes would be overwritten` | Uncommitted local changes | `git checkout` conflicting files |

---

## Directory Structure

```
analysis/                    # Untracked, ephemeral
├── .state.json             # Current phase and progress
├── user-testing.md         # Latest user testing results
├── qa-review.md            # Latest QA findings
├── arch-review.md          # Latest architecture review
└── docs-review.md          # Latest documentation audit

specs/                       # Untracked, ephemeral (generated in worktrees, deleted before PR)
├── [feature-name]/
│   ├── research.md
│   ├── requirements.md
│   ├── design.md
│   └── tasks.md

docs/                        # Tracked, permanent
├── AGENT-WORKFLOW.md       # This file
└── ...
```

**Git Configuration** (in `.gitignore`):
```
analysis/
specs/
```

---

## Complete Workflow Example

```
CYCLE START
│
├── ANALYSIS PHASE
│   ├── User: "run user testing"
│   │   ├── QA: 3 persona agents test functionality
│   │   └── UX: Design/layout analysis → analysis/user-testing.md
│   ├── User: "perform QA work"
│   │   └── Review code, run tests → analysis/qa-review.md
│   ├── User: "run architect review"
│   │   └── Analyze codebase → analysis/arch-review.md
│   └── User: "audit documentation"
│       └── Scan all sources → analysis/docs-review.md
│
├── PM REVIEW PHASE
│   └── User: "PM review"
│       ├── Read analysis/*.md
│       ├── Create/update GitHub issues
│       ├── Set priorities (P1, P2)
│       ├── Move unblocked to queue
│       └── State: pm-review → development
│
├── DEVELOPMENT PHASE
│   └── User: "start development"
│       ├── Create worktrees for each issue
│       ├── Run up to 3 parallel agents
│       ├── Each agent: specs → code → PR
│       └── State tracks openPRs
│
├── MERGE PHASE
│   └── User: "merge and cleanup"
│       ├── Squash-merge all PRs
│       ├── Force-remove worktrees
│       ├── Delete feature branches
│       ├── Pull main
│       ├── Move unblocked issues to queue
│       └── State: merge → analysis
│
└── CYCLE REPEATS
```

---

## Status Command

**Invoke**: `status`

**Behavior**:
1. Check if `analysis/.state.json` exists
2. If missing: report "No state tracked. Run analysis agents to establish current state."
3. If exists: report current phase, completed analyses, pending work, development queue

**Output Example**:
```
Phase: development
Priority: P1

Analysis Status:
  ✅ User Testing (2 days ago)
  ✅ QA Review (2 days ago)
  ❌ Architect Review (not run)
  ✅ Documentation Audit (2 days ago)

Development Queue:
  🔄 #42 - Add country filter to rankings
  ⏳ #43 - Improve mobile responsiveness
  ⏳ #44 - Fix cargo value display

Open PRs:
  🔀 #50 - feat/country-filter
  🔀 #51 - feat/mobile-responsive

Blocked Issues:
  🚧 #45 - Blocked by #42

Completed This Cycle:
  ✅ #40 - Add search to rankings
  ✅ #41 - Compatible trailer display
```

## State Recovery

If `analysis/` directory is missing or empty:
1. Run each analysis agent in order to reconstruct understanding
2. PM reviews findings and rebuilds state
3. System resumes normal operation

This is by design - state is ephemeral and reconstructible.
