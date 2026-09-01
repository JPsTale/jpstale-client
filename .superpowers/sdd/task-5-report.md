# Task 5 Report: main.ts 集成

## Status: DONE

## What was implemented

Integrated the CharSelect component's character creation flow into main.ts:

1. **CharSelect interface updated** (`src/ui/CharSelect.ts:19`): Added `handleCreateResult(success, error?)` to the `CharSelect` interface and implementation. On success, exits create mode and returns to list. On failure, shows error message and re-enables the create button.

2. **CharSelect.show() smart refresh** (`src/ui/CharSelect.ts:519`): When `show()` is called while in create mode, it exits create mode first. This ensures the character list updates properly when the server sends an updated `characterList` after successful creation.

3. **createCharacterResult handler** (`src/main.ts:131-139`): On success, relies on the server's automatic `characterList` push to refresh the list. On failure, calls `charSelectPanel.handleCreateResult()` to show the error in the UI.

4. **Cleaned up unused imports** (`src/main.ts:2`): Removed unused `getToken` import.

## Flow

1. User clicks "创建角色" in character list → CharSelect enters create mode internally
2. User selects job, face, enters name → clicks "创建" → `onCreate` callback fires → sends `createCharacter` message
3. Server responds with `createCharacterResult`:
   - **Success**: server sends updated `characterList` → `showPanelFor(CHAR_SELECT, chars)` → `charSelectPanel.show()` exits create mode, shows updated list
   - **Failure**: `handleCreateResult(false, error)` shows error in CharSelect UI

## Files changed

- `src/ui/CharSelect.ts` — Added `handleCreateResult` to interface and implementation, smart `show()` refresh
- `src/main.ts` — Updated `createCharacterResult` handler, cleaned unused imports

## Test results

- `npx tsc --noEmit`: 0 errors

## Concerns

- The `CHAR_CREATE` screen in State.ts is unused — CharSelect handles both list and create modes internally. This is fine; the state machine allows `CHAR_SELECT → WORLD` directly.
- Error codes from server are numeric; the handler shows them as raw codes. A mapping to user-friendly messages would improve UX but wasn't requested.
