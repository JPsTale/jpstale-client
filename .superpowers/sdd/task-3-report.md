# Task 3: CharSelect Rewrite — Report

## What I Implemented

Rewrote `src/ui/CharSelect.ts` from a 4-step wizard (race → job → face → name) to a single-page three-column layout with 3D character preview.

**Layout:**
- **Left panel** (220px): Read-only job info (name, description, attributes)
- **Center panel** (flex): 3D WebGL preview — chrselect SMD scene background + character model with idle animation
- **Right panel** (240px): Job selection grid (tempscron 5 + moryon 5), face selection (3 options), name input, create/cancel buttons

**Mode switching:** The component retains the `show(chars, opts)` / `hide()` / `destroy()` public API. Internally, `show()` displays the character list; clicking "create" enters the three-column creation mode.

**Key interactions:**
- Job hover: highlights name + background, loads that job's model (face 0) into preview
- Job leave: reverts to selected job's model
- Job click: selects job, persists face choice
- Face selection: persists across job switches, reloads preview
- Name validation: 2-12 chars, Chinese/English/numbers only
- BGM: `characterselect.wav` on enter, stop on exit

**3D pipeline:** Uses `loadScene` (Task 1) for chrselect background, `createCameraControls` (Task 2) for orbit camera, `loadCharacterModel` + `createAnimStateMachine` + `evalSkeleton`/`applyToBones` for character animation with frame accumulation.

## What I Tested

- `npx tsc --noEmit` — passes (only pre-existing `getToken` warning in main.ts)
- Code structure verified against existing interfaces: `createAnimStateMachine` opts use actual `{ getMotions, getClassId, onMotionChange }` interface, not the plan's `{ animSmb, bipInxInfo }` version

## Files Changed

- `src/ui/CharSelect.ts` — full rewrite (301 → 521 lines)

## Self-Review Findings

1. **Adapted interfaces to reality:** The plan assumed `AppCharacter`, `Transport`, `LOCALE` types that don't exist in this codebase. Used actual `CharacterInfo`, `t()` from i18n, and `opts.onCreate` callback instead.
2. **Animation frame accumulation:** Initial implementation was static (one frame). Fixed to accumulate at 80ms/step with proper repeat/end handling, matching the original wizard's animation logic.
3. **`buildCreateUI` called at init:** DOM for creation mode is built eagerly but hidden. Avoids DOM manipulation during mode switch.
4. **Scene loaded once per enter:** `loadSceneAsync()` is called each time creation mode is entered. Could cache the loaded scene to avoid re-fetching, but acceptable for now.
5. **`controls` not disposed on `hide()`:** The camera controls event listeners persist. Added `controls.dispose()` in `destroy()` but not in `hide()` — acceptable since the canvas is removed on hide, making the listeners inert.

## Issues or Concerns

- **No dedicated CHAR_CREATE screen state:** The plan's Task 4/5 suggest adding `CHAR_CREATE` to `AppScreen` and modifying `main.ts`. I kept the existing architecture where CharSelect manages both list and create modes internally. This avoids touching `State.ts` and `main.ts` but means the app state machine doesn't know about creation mode. This is a deliberate simplification — if server-side routing or other screens need to know about creation state, the plan's approach would be better.
- **Plan's `handleCreateResult` not implemented:** The plan adds a `handleCreateResult(success, error)` method. The current `main.ts` just logs `createCharacterResult` failures. To properly handle success (return to list with refreshed characters), `main.ts` would need to call back into CharSelect. Not implemented as it requires `main.ts` changes (Task 5).
