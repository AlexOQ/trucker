---
spec: coverage-tooltip
phase: design
created: 2026-01-22
generated: auto
---

# Design: coverage-tooltip

## Overview
Update existing tooltip text on Coverage column header. No new components needed.

## Architecture

```
index.html (line 260)
    |
    v
<th class="tooltip" data-tooltip="NEW TEXT">Coverage</th>
    |
    v
css/style.css (existing .tooltip styles)
```

## Implementation

### Single Change
**File**: `index.html`
**Line**: 260
**Current**:
```html
<th class="tooltip" data-tooltip="% of cargo types this trailer can haul">Coverage</th>
```

**New**:
```html
<th class="tooltip" tabindex="0" data-tooltip="This trailer can haul this percentage of the different cargo types available at depots in this city">Coverage</th>
```

## Technical Decisions

| Decision | Options | Choice | Rationale |
|----------|---------|--------|-----------|
| Tooltip placement | Header vs cell | Header | Consistent with other columns |
| Add tabindex | Yes/No | Yes | Keyboard accessibility (matches other tooltips) |
| Text style | Formal/Conversational | Conversational | Matches issue suggestion |

## Existing Patterns to Follow
- `th.tooltip` positioning (bottom, lines 639-651 in style.css)
- `tabindex="0"` for keyboard focus
- Other header tooltips as examples (lines 161, 259, 261-262)
