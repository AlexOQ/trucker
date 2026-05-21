# Copilot mode — Iron Horizon Freight

Invoked when the user says **"copilot me"**, **"co-pilot me"**, or resumes the playthrough mid-game.

## On invocation

1. Read `playthrough/state.md` for current cash/level/skills/location and the target rig.
2. Read the last 5 entries of `playthrough/ledger.md` to see recent jobs.
3. Read `playthrough/routing-rules.md` for the active decision logic.
4. Skim `playthrough/cargo-walk.md` open questions for unresolved discrepancies.
5. Acknowledge in one line. Don't restate the state file — the user wrote it, he knows.
6. Wait for him to report a job board / pick / completion.

## Per-job protocol

The user reports jobs in two halves: **start** (board pick → accept) and **finish** (delivery → pay).

### At job start
He'll paste/describe a job: pickup company + city, drop company + city, cargo, distance, pay, urgency.

I do:
- **Sanity-check the parsed data**. Pick *one* verification per job, rotate through:
  - cargo (value × units × bonuses → expected unit pay)
  - pickup depot (company exists in pickup city per game-defs)
  - drop depot (company accepts this cargo in this city)
  - trailer body type matches cargo
  - city DLC + country validity
  - prob_coef sanity (rare cargo getting offered = suspicious)
- **If the parser data agrees with the game**, one-line ack: "✓ <thing> checks out."
- **If it disagrees**, flag the mismatch with file:line refs and ask whether to file an issue or fix inline.
- **Direction call**: per R2 — within ±10% net /km of top, target-ward (Helsinki → Pori → Gothenburg) wins.

Output shape:
```
✓ <one verification line>
Direction: <north/wrong-way/neutral relative to target>
Recommend: take it / skip it / consider the alternative
```

### At job finish (post-delivery workflow — user-codified 2026-05-21)

He'll report actual pay, distance driven, time, late penalty, and whether a skill point was earned.

I do, **in this order**:

1. **Sanity-check pay**: `cargo.value × units × (1 + 0.3*fragile + 0.3*high_value) × distance_multiplier × skill_bonuses` (approximate; if it lines up within ~5% we're good). Flag anomalies (under-pay, over-pay, distance mismatch, suspected damage from board-vs-delivered gap).
2. **Append a ledger row** to `playthrough/ledger.md`.
3. **Skill point**: if earned, recommend next pick per R9. User applies in-game and confirms.
4. **Update `state.md`**: balance, loan outstanding, profit/7d, borrow headroom, location, L<n> if level up, last-verified rotation, achievement counters that ticked.
5. **Service-station suggestion**: if truck condition or upgrade availability warrants — surface brief check. Don't push unnecessarily; cosmetic upgrades stay deferred during Phase A.
6. **Fleet-expansion suggestion**: cash + profit/7d crossed a garage-shell or trailer-purchase or driver-hire threshold → surface it. Phase A: only at target-rush-garage cities. Phase B+: between any jobs as cash flow allows.
7. **Board scan**: wait for user to read the board, then apply R10 priority order to recommend.

## When to chime in unsolicited

Defaults per **R7** (quiet between jobs) in routing-rules. Copilot-specific additions on top of R7's exception list:

- **Direction drift**: 3 wrong-way jobs in a row when a target garage is active.
- **Multi-job pattern**: 3+ jobs showing the same under-pay / mismatch / parser disagreement → flag as systemic, not per-job noise.
