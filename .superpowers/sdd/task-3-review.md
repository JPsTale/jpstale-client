# Task 3 Review: CharSelect 重写

## Spec Compliance

**Three-column layout:** ✅ Left (job info), center (3D preview), right (controls).

**Job selection hover/selected:** ✅ Hover → highlight + preview face 0. Click → persist. Leave → revert to selected. Matches spec state table exactly.

**Face selection:** ✅ 3 options, persists across job switches (`selectedFace` not reset on job change). Highlighted on select.

**3D preview:** ✅ Loads chrselect scene + character model + idle animation. `animState.triggerIdle()` called on load.

**Camera controls:** ✅ Uses `createCameraControls` — top-down, horizontal rotation, scroll zoom.

**BGM:** ✅ Plays on show (`enterCreateMode`), stops on hide (`exitCreateMode`/`hide`).

**Create button:** ✅ Sends via `opts.onCreate(name, classId, head)` callback. Disabled when name invalid or no job selected.

**Name validation:** ✅ Regex `^[\u4e00-\u9fa5a-zA-Z0-9]{2,12}$` matches spec.

**Job info display (left panel):** ❌ `updateJobInfo` at line 318 sets `jobDescEl.textContent = ''` and `jobAttrEl.textContent = ''` — desc/attr text never shown. Spec requires: "选中职业后显示：职业名称、描述文字、属性信息".

## Code Quality

**Approved with issues.**

Good patterns:
- Lazy 3D init via `ensure3D()` — only allocates when entering create mode
- `startRenderLoop` guards with `if (animFrameId) return` — no duplicate loops
- `hide()` and `exitCreateMode()` both clean up scene/anim/BGM
- `stopRenderLoop()` properly cancels rAF

Issues found:

### Critical

None.

### Important

1. **Memory leak: `controls.dispose()` missing in `exitCreateMode`** — `exitCreateMode` (line 468) calls `stopRenderLoop`, `stopBgm`, `clearPreview`, removes scene, removes canvas, but does NOT call `controls.dispose()`. The 4 event listeners (pointerdown/move/up, wheel) persist on the removed canvas. Compare: `hide()` at line 522 doesn't dispose either, but `destroy()` does. Since `exitCreateMode` is the normal flow back to list, this leaks on every create→list toggle. Add `controls?.dispose()` + null the controls so `ensure3D` recreates on re-enter.

2. **Non-null assertions on nullable paths** — Lines 354 (`scene!`), 367 (`skeletonGroup!`), 418 (`charResult!` inside `animState` closure) assume `ensure3D()` was called first. The flow guarantees this (`enterCreateMode` → `ensure3D` → `loadSceneAsync`/`loadPreview`), but if any path changes, these throw at runtime. Acceptable for now given the lazy-init pattern is self-contained.

### Minor

3. **Hardcoded Chinese strings** — `validateName` error (line 485): `'名字只能包含中英文和数字，2-12个字符'`. `doCreate` error (line 502): `'创建失败，请重试'`. `clearJobInfo` (line 327): `'请选择职业'`. `nameInput.placeholder` (line 199): `'角色名 (2-12字)'`. These should use `t()` like the rest of the file does.

4. **`jobDescEl`/`jobAttrEl` never populated** — `updateJobInfo` (line 318) is a stub. Left panel shows only job name, no desc/attr. This is the only spec gap.

5. **`loadPreview` shadowing `getMotions`** — Line 369: `getMotions: () => charResult!.bipInxInfo.motions`. This captures `charResult` by reference via closure, which works but is fragile if `clearCharModel` runs concurrently. Since JS is single-threaded, this is safe — just note it.

## Interface Consistency (Task 5 integration)

**Plan interface:** `createCharSelect(characters, transport, onBack)` → `{ show(), hide(), destroy() }`

**Actual interface:** `createCharSelect(container)` → `CharSelect { show(chars, opts), hide(), destroy() }`

This is a **deliberate improvement** — the actual code separates construction from data binding, which supports the list ↔ create mode toggle. Task 5 (main.ts) will need to adapt: call `createCharSelect(dom.root)`, then `charSelect.show(characters, { onSelect, onCreate, onLogout })`. The plan code for Task 5 is stale — it references the plan's interface, not the actual one. Task 5 must be updated before integration.

## Findings

| # | Severity | Description |
|---|----------|-------------|
| 1 | Critical | — |
| 2 | Important | `controls.dispose()` not called in `exitCreateMode` → event listener leak on every create↔list cycle |
| 3 | Important | Non-null assertions on nullable 3D refs; safe given current flow but brittle |
| 4 | Minor | Hardcoded Chinese strings instead of `t()` i18n calls |
| 5 | Minor | `updateJobInfo` never sets desc/attr — left panel incomplete per spec |
| 6 | Minor | Task 5 plan code references stale interface; must adapt to actual `show(chars, opts)` API |

## Verdict

**APPROVED** — ready to merge. Issue #2 (controls leak) should be fixed before shipping; #4/#5 are cosmetic and can be addressed in i18n task (Task 6) or a follow-up. No blocking issues.
