# Agent Workflow System

Multi-agent development workflow with centralized PM coordination and phase-aware state tracking.

## Quick Reference

| Command | What It Does |
|---------|--------------|
| `status` | Show current phase, what's done, what's pending |
| `run user testing` | 3 persona agents test prod, output → `analysis/user-testing.md` |
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
  "blockedIssues": [
    {"issue": 125, "title": "Refactor Y", "priority": "P2", "blockedBy": [123], "reason": "Needs feature X first"}
  ],
  "completedThisCycle": [120, 121],
  "openPRs": [130, 131],
  "notes": "Optional context for PM"
}
```

**Queue Rules**:
- `developmentQueue`: Only **unblocked** issues ready for immediate work
- `blockedIssues`: Issues waiting on other work to complete
- `openPRs`: PRs created but not yet merged
- PM moves issues from `blockedIssues` → `developmentQueue` when blocking PRs are **merged** (not just opened)

**Unblocked Definition**: A blocked issue becomes unblocked when ALL issues in its `blockedBy` array have their PRs merged to main.

**State Transitions**:
- `analysis` → `pm-review`: When all required analyses complete
- `pm-review` → `development`: When PM creates/prioritizes issues
- `development` → `merge`: When all issues have open PRs (developmentQueue empty, openPRs populated)
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

**Current Workaround**: Develop issues sequentially in the main session instead of parallel background agents:

```
# Instead of spawning 3 parallel background agents:
# Task(subagent_type=ralph-specum, run_in_background=true, ...)

# Use sequential in-session development:
# 1. Create worktree for issue
# 2. Run ralph-specum skill directly (foreground)
# 3. Complete PR
# 4. Repeat for next issue
```

**Impact**:
- Development phase takes longer (sequential vs parallel)
- Main session is occupied during development
- All permissions work correctly in foreground

**TODO**: Investigate how to properly grant permissions to background Task subagents.

---

## Model Configuration

| Agent | Model | Rationale |
|-------|-------|-----------|
| PM Agent | `opus` | Complex synthesis, prioritization decisions |
| User Testing | `sonnet` | Structured testing workflows |
| QA Agent | `sonnet` | Code review, test analysis |
| Architect Agent | `sonnet` | Pattern analysis |
| Documentation Agent | `sonnet` | Content review |
| Development Agent | `sonnet` | Code generation, spec execution |

When invoking via Task tool, set `model` parameter:
```
Task tool:
  subagent_type: voltagent-biz:product-manager
  model: opus
  prompt: ...
```

---

## Agent Definitions

### PM Agent (Coordinator)

**Invoke**: `voltagent-biz:product-manager`
**Model**: `opus`

**Responsibilities**:
- Read all `analysis/*.md` files
- Synthesize findings into actionable items
- Create/update GitHub issues with labels and priorities
- Manage issue lifecycle (open, close, comment, re-prioritize)
- Determine phase transitions
- Track what's been done vs what's pending

**State Awareness**:
- Reads `analysis/.state.json` on startup
- Updates state after decisions
- Knows to check GitHub for recently closed issues
- Understands priority levels and their meaning

**GitHub Integration**:
- Labels: `priority:P0|P1|P2|P3`, `type:bug|feature|tech-debt|ux`, `source:user-testing|qa|architect|docs`
- Comments: Links to analysis files, decision rationale
- Milestones: Priority level groupings

**Decision Framework**:
```
IF analysisComplete.all == true:
  → Review analysis/*.md
  → Create/update GitHub issues
  → Check blockedIssues for unblocked items (blockedBy all in completedThisCycle)
  → Move unblocked issues to developmentQueue
  → Add new blocked issues to blockedIssues (NOT developmentQueue)
  → Set developmentQueue with only ready-to-work items
  → Reset completedThisCycle to []
  → Transition to "development"

IF currentPhase == "development" AND developmentQueue.empty:
  → Check if blockedIssues has items that are now unblocked
  → If yes: move to developmentQueue, continue development
  → If no: Transition to "merge" phase

ON PR CREATION:
  → Add PR number to openPRs
  → Issue stays in completedThisCycle (work done, awaiting merge)

ON PR MERGE:
  → Remove from openPRs
  → Check blockedIssues for items blocked by this issue
  → Move newly unblocked items to developmentQueue
```

**Blocked Issue Rules**:
- Issues with dependencies go to `blockedIssues`, never `developmentQueue`
- Each blocked issue tracks: `blockedBy` (array of issue numbers), `reason` (human-readable)
- When all `blockedBy` issues appear in `completedThisCycle`, issue becomes unblocked
- PM reviews blockers during each PM review phase

---

### User Testing Agent (Black Box)

**Invoke**: `voltagent-qa-sec:qa-expert` + Playwright
**Model**: `sonnet`

**Target**: Production deployment (https://alexoq.github.io/trucker)

**Spawns**: 3 parallel agents with randomized personas

**Persona Pool** (randomly select 3):
```yaml
casual_trucker:
  name: "Mike"
  experience: "Plays ETS2 casually, 50 hours"
  goals: "Quick answers, no deep optimization"
  behavior: "Skims UI, clicks obvious buttons first"
  frustration_triggers: "Too much data, slow loads"

hardcore_optimizer:
  name: "Elena"
  experience: "500+ hours, runs virtual trucking company"
  goals: "Maximize profit per km, perfect trailer sets"
  behavior: "Explores every option, compares numbers"
  frustration_triggers: "Missing data, incorrect calculations"

new_player:
  name: "Jake"
  experience: "Just started ETS2, 5 hours"
  goals: "Understand what trailers even do"
  behavior: "Confused by terminology, needs guidance"
  frustration_triggers: "Jargon, assumes prior knowledge"

mobile_user:
  name: "Sofia"
  experience: "200 hours, checks app on phone during breaks"
  goals: "Quick reference while playing"
  behavior: "Taps, expects responsive design"
  frustration_triggers: "Desktop-only UI, tiny buttons"

data_enthusiast:
  name: "Raj"
  experience: "300 hours, loves spreadsheets"
  goals: "Export data, verify calculations"
  behavior: "Inspects network requests, checks numbers"
  frustration_triggers: "No export, opaque algorithms"

multiplayer_coordinator:
  name: "Viktor"
  experience: "400 hours, TruckersMP convoy leader"
  goals: "Coordinate trailer choices for group"
  behavior: "Shares links, screenshots results"
  frustration_triggers: "Can't share/bookmark, no URL params"

achievement_hunter:
  name: "Yuki"
  experience: "800 hours, 100% achievements"
  goals: "Cover all cargo types, complete collection"
  behavior: "Checks coverage gaps, wants completeness"
  frustration_triggers: "No 'what am I missing' view"

dlc_collector:
  name: "Hans"
  experience: "600 hours, owns all map DLCs"
  goals: "Optimize routes across all regions"
  behavior: "Filters by country, compares regions"
  frustration_triggers: "No region filtering, mixed results"

returning_player:
  name: "Carlos"
  experience: "200 hours, 2 year break, back now"
  goals: "Catch up on what changed"
  behavior: "Remembers old UI, confused by new"
  frustration_triggers: "No changelog, different workflow"

streamer:
  name: "Twitch_TruckerTom"
  experience: "1000+ hours, content creator"
  goals: "Show off tool to audience"
  behavior: "Needs visual clarity, talks through actions"
  frustration_triggers: "Ugly UI, confusing to explain"

impatient_gamer:
  name: "Zoe"
  experience: "100 hours, plays many games"
  goals: "Get answer in 10 seconds, back to game"
  behavior: "Types fast, expects instant results"
  frustration_triggers: "Any friction, any loading"
```

**Output**: `analysis/user-testing.md`

**Workflow**:
1. Read `.state.json` to understand current focus
2. Navigate prod URL via Playwright
3. Each persona performs typical user journeys
4. Document friction points, confusion, bugs
5. Rate severity and provide recommendations

---

### QA Agent (White Box)

**Invoke**: `pr-review-toolkit:code-reviewer` + `pr-review-toolkit:pr-test-analyzer`
**Model**: `sonnet`

**Target**: Local dev server (localhost:3000)

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

**Parallel Execution Pattern**:
1. Create git worktree per issue: `git worktree add ../trucker-<issue-slug> -b feat/<issue-slug>`
2. Run ralph-specum with `--quick` flag (skips interactive phases, auto-generates specs)
3. Agent works autonomously: generates specs, executes tasks, commits
4. Agent creates PR with "Closes #XX" in body
5. Up to 3 agents run in parallel (background) for unblocked issues

**The `--quick` Flag**:
- Skips goal interview (non-interactive)
- Auto-generates: research.md, requirements.md, design.md, tasks.md
- Executes all tasks sequentially
- Commits after each task
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

**Workflow**:
```bash
# 1. Squash-merge all open PRs
for pr in $(cat openPRs); do
  gh pr merge $pr --squash --delete-branch
done

# 2. Force-remove worktrees (may have uncommitted spec files)
git worktree list | grep -v "main\|master" | while read path rest; do
  git worktree remove --force "$path"
done

# 3. Delete local feature branches
git branch | grep "feat/" | xargs git branch -D

# 4. Pull main with merged changes
git checkout main
git pull origin main

# 5. Clean analysis folder (keep .state.json)
rm -f analysis/user-testing.md
rm -f analysis/qa-review.md
rm -f analysis/arch-review.md
rm -f analysis/docs-review.md

# 6. Update state
```

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

specs/                       # Tracked, permanent
├── [feature-name]/
│   ├── research.md
│   ├── requirements.md
│   ├── design.md
│   └── tasks.md

docs/                        # Tracked, permanent
├── AGENT-WORKFLOW.md       # This file
└── ...
```

**Git Configuration** (add to `.gitignore`):
```
analysis/
```

---

## Complete Workflow Example

```
CYCLE START
│
├── ANALYSIS PHASE
│   ├── User: "run user testing"
│   │   └── 3 persona agents test prod → analysis/user-testing.md
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
