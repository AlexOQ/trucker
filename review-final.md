## Asylum Review

**Automated review** — 0 changes required. Approve.

### Suggest

**[SUGGEST]** (confidence 0.90, roi med, effort low) **Hardcoded `€` will mis-label ATS prices once cab/paint data lands**
`src/frontend/trucks.ts:68` (list) and `src/frontend/trucks.ts:138` (detail) hardcode `€`. ATS prices are USD, and CLAUDE.md already flags the ATS reparse as the next step that populates this page. Derive once at init — `const cur = page.data.game === 'ats' ? '$' : '€'` — and thread through `renderTruckList` / `showTruckDetail`, or expose a `currencySymbol` helper from `page-init` so every page stays in sync.

<!-- reviewed-sha: 1e92cbaec3210d8a2f66dabd0ac0fdda5fb67ce4 -->
