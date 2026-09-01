# Tasks 7, 8, 9 — UI Panel Implementation

**Date:** 2026-08-31
**Status:** Done

## Files Created

| File | Task | Lines |
|------|------|-------|
| `src/ui/LoginPanel.ts` | Task 7 — LoginPanel DOM overlay | 48 |
| `src/ui/ServerSelect.ts` | Task 8 — ServerSelect DOM overlay | 35 |
| `src/ui/Hud.ts` | Task 9 — Hud placeholder | 27 |

## Typecheck

`npx tsc --noEmit` — **passed** (no output = no errors).

## Commits

| Commit | Message |
|--------|---------|
| `3e779c3` | feat: add LoginPanel DOM overlay |
| `9d4e91a` | feat: add ServerSelect DOM overlay |
| `04ab4d2` | feat: add Hud placeholder |

## Implementation Notes

- All panels use DOM API directly (no framework dependency).
- `LoginPanel` and `ServerSelect` import `t()` from `../i18n/index.js` for locale support.
- `Hud` is a pure text placeholder — no i18n needed yet.
- Each panel follows the same interface pattern: `show()`, `hide()`, `destroy()`.
- LoginPanel handles Enter key on password field for submit.
- ServerSelect re-renders server list on each `show()` call (no stale state).
