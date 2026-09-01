# Task 4: App State — CHAR_CREATE Screen

**Status:** Done

**Commit:** `74b90b9` — `feat: add CHAR_CREATE screen to app state machine`

**Files changed:**
- `src/app/State.ts` — added `CHAR_CREATE` to enum, `showCharCreate` to `TransitionCtx`, valid transitions, switch case
- `src/main.ts` — added `showCharCreate` stub to ctx (full integration deferred to Task 5)

**Transitions added:**
- `CHAR_SELECT → CHAR_CREATE` (user clicks create button)
- `CHAR_CREATE → CHAR_SELECT` (cancel or success)

**Typecheck:** pass (only pre-existing unused `getToken` warning in main.ts)
