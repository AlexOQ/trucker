---
spec: coverage-tooltip
phase: research
created: 2026-01-22
generated: auto
---

# Research: coverage-tooltip

## Executive Summary
Small UI enhancement. Existing tooltip pattern already implemented in codebase. Straightforward application to Coverage column header.

## Codebase Analysis

### Existing Tooltip Pattern
**File**: `css/style.css` (lines 581-665)
- Uses `.tooltip` class + `data-tooltip` attribute
- CSS `::after` pseudo-element renders tooltip text
- Supports hover + focus (keyboard accessible via `tabindex="0"`)
- Table headers use bottom positioning (lines 639-651)

**Usage in index.html**:
- Control labels: `<span class="tooltip" tabindex="0" data-tooltip="...">`
- Table headers: `<th class="tooltip" data-tooltip="...">`

### Target Location
**File**: `index.html` (line 260)
```html
<th class="tooltip" data-tooltip="% of cargo types this trailer can haul">Coverage</th>
```
Already has tooltip! But text needs improvement per issue #9.

### Current Coverage Tooltip Text
Line 260: `"% of cargo types this trailer can haul"`

**Issue**: Doesn't explain what coverage percentage means in context.

## Feasibility Assessment

| Aspect | Assessment | Notes |
|--------|------------|-------|
| Technical Viability | High | Pattern exists, single line change |
| Effort Estimate | XS | <10 min implementation |
| Risk Level | Low | No logic changes |

## Recommendations
1. Update existing tooltip text on line 260
2. Text: "This trailer can haul X% of the different cargo types available at depots in this city"
3. No CSS changes needed
