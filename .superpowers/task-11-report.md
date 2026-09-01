# Task 11 Report: Main Entry + App Shell

## Status: DONE

## Commit
`feat: wire app entry with all panels, transport, and state machine`
commit `680bdbe`

## tsc --noEmit: PASS

## What was wired
- `src/main.ts` replaced with full app bootstrap
- All 4 panels: `LoginPanel`, `ServerSelect`, `CharSelect`, `Hud`
- Transport layer: `connect()`, `send()`, `onMessage()`, `disconnect()`
- Protocol: `loginRequest()`, `createCharacter()`, `selectCharacter()`
- State machine: `transition()` with `TransitionCtx` wired to panels
- i18n: used via panel components (not directly in main.ts)

## Message routing (ServerMessage.payload oneof)
- `loginResponse` → success: go SERVER_SELECT; failure: re-show login with error
- `characterList` → show CHAR_SELECT with character cards
- `createCharacterResult` → log failure only (server sends characterList after success)
- `playerState` → go WORLD, show HUD with hp/mp/level
- `error` → console.warn

## Flow
BOOT → LOGIN → SERVER_SELECT → CHAR_SELECT → WORLD

## Concerns
- ServerSelect is a placeholder — no server list proto message exists yet. Shows a single default server.
- `characterList` from server may not be sent automatically after login; may need an explicit request in a future task.
- `onLogout` calls `transition()` then `showPanelFor()` to re-show login with the correct hideAll cycle.
- The `Hud` only shows on `playerState` — subsequent state updates refresh the same HUD instance.
