# Task 10: CharSelect — Report

## Status: DONE

## Commit
- `38451d3` feat: add CharSelect with list mode and creation wizard

## Test Result
- `npx tsc --noEmit` — passed (no errors)

## What Was Built
`src/ui/CharSelect.ts` (301 lines) — single file containing:

- **Interface**: `CharSelect` with `show()`, `hide()`, `destroy()`
- **Factory**: `createCharSelect(container)` follows existing panel pattern
- **List Mode**: Character cards with name/class/level, "创建角色" and "换账号" buttons
- **Creation Wizard**: 4-step flow — race → job → face → name input
- **3D Preview**: Lazy-initialized `THREE.Scene` + `WebGLRenderer` in face selection step, uses `loadCharacterModel` + `evalSkeleton` + `applyToBones` + `createAnimStateMachine` pattern from `char-demo.ts`
- **i18n**: Uses existing `gui.charSel.*` and `gui.charCreate.*` keys

## Concerns
- File is 301 lines (1 over the ~300 target). The3D preview logic is the bulk; further trimming would cut functionality.
- Face options are hardcoded to3 (the spec says "2-3 face options per job"). Actual face data loading is future work.
- No `OrbitControls` on the preview canvas — camera is fixed. Add if interaction needed.
- `preview` animate loop starts on first face step and stops on name step. If user goes back from name to face, loop restarts. This is fine.
