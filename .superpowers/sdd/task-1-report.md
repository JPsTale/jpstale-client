# Task 1: 重写Hud.ts — 1280×720画布 + CSS缩放

## What I Implemented

Rewrote `src/ui/Hud.ts` with:
- Fixed 1280×720 canvas with CSS `position:fixed; inset:0`
- `fitCanvas()` for CSS-based uniform scaling to window size (letterboxed center)
- New `HudState` interface: `stm`/`maxStm` replacing `sp`/`maxSp`, added `playerName`
- `dispose()` replacing `destroy()`
- All original HUD elements preserved (bars, buttons, skill slots, etc.)

Updated `src/main.ts` to match the new interface:
- `sp`/`maxSp` → `stm`/`maxStm`
- Added `playerName: ''` field

## What I Skipped

- Actual game rendering (bars/buttons are drawn but at hardcoded coordinates from the brief — may need tuning against real PT screenshots)
- Tests (no test framework exists in the project)

## Build Result

`tsc --noEmit && vite build` — passes clean.

## Files Changed

- `src/ui/Hud.ts` — full rewrite (183 → 159 lines)
- `src/main.ts` — HudState field renames (lines 167-173, 184-188)

## Self-Review

- All spec requirements met: 1280×720 canvas, CSS scaling, new interface
- The task brief's `loadTexture` called `decodeTextureAsync(path)` directly (expects ArrayBuffer, not string) — fixed by keeping the fetch-then-decode pattern from the original code
- Texture paths and draw coordinates match the existing layout
- No over-engineering, no new dependencies
