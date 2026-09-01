# Task 3 — Memory Leak Fix: controls.dispose() not called

## Issue

`controls.dispose()` (which removes 4 pointer event listeners: pointerdown, pointermove, pointerup, wheel) was only called in `destroy()`. On every `exitCreateMode()` or `hide()` toggle, the old controls object leaked its event listeners.

## Changes

**`src/ui/CharSelect.ts`**

1. **`exitCreateMode()`** — Added `controls?.dispose(); controls = null;` and `canvas = null` before DOM removal. Nulling canvas ensures `ensure3D()` fully reinitializes on next create mode entry.

2. **`hide()`** — Added `controls?.dispose(); controls = null;` and `canvas = null` for the same leak on full hide.

3. **`ensure3D()`** — Added guard: if canvas exists but controls was disposed, recreates controls. (Defensive — with canvas=null after dispose this path shouldn't trigger, but covers edge cases.)

## Verification

```
npx tsc --noEmit
```

Result: Clean (only pre-existing unused import warning in `src/main.ts`).
