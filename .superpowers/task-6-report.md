# Task 6: i18n — Locale Files

**Status:** ✅ Complete  
**Commit:** `bd5e40f` — feat: add i18n with zh/en JSON locales and runtime switching  
**TypeCheck:** `npx tsc --noEmit` — passed (no errors)

## Files Created
- `src/locales/zh.json` — Chinese translations
- `src/locales/en.json` — English translations
- `src/i18n/index.ts` — `t()`, `setLocale()`, `getLocale()` exports

## Notes
- Locale auto-detected from `navigator.language`, fallback to `zh`
- Persisted to `localStorage('locale')`
- `t()` supports dot-path keys and `{param}` interpolation
