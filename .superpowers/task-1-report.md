# Task 1: Relocate Map Viewer Entry

## What I implemented
Moved the map viewer from `index.html` + `src/main.ts` to a dedicated `map-demo.html` + `src/maps/map-demo.ts` entry. `index.html` now serves as the app shell (placeholder for Task 11), and the map viewer is accessible at `/map-demo.html`.

## What I tested and results
- `npx tsc --noEmit` — passed with zero errors
- All imports resolve correctly (relative imports in `src/maps/map-demo.ts` use `./fore1` and `./pick` instead of `./maps/fore1` and `./maps/pick`)

## Files changed
| File | Action |
|------|--------|
| `map-demo.html` | Created — standalone map viewer HTML entry |
| `src/maps/map-demo.ts` | Created — full map viewer code (from original `src/main.ts`) |
| `src/main.ts` | Replaced — minimal placeholder for Task 11 |
| `index.html` | Replaced — app shell with `<div id="app">` |
| `vite.config.ts` | Modified — added `map-demo` to `rollupOptions.input` |

## Self-review findings
1. **Element reference adaptation**: The task spec's `map-demo.html` uses `<canvas id="c">` but the original code referenced `#app`. Changed to `document.body` in `map-demo.ts` to avoid a null reference. The `<canvas id="c">` in the HTML is unused (THREE.js creates its own canvas via `WebGLRenderer`).
2. **Import paths adjusted**: `map-demo.ts` is now inside `src/maps/`, so imports changed from `'./maps/fore1'` → `'./fore1'` and `'./maps/pick'` → `'./pick'`.
3. **No other side effects**: `char-demo.html` and `src/char/char-demo.ts` are unaffected (they have their own entry in vite config).

## Commit
- `6b35b94` — `relocate map viewer to map-demo entry, free index.html for app shell`
