# Task 3: Protocol Types — Report

## Status: Complete

## What was created
`src/net/protocol.ts` — thin wrappers around generated protobuf types for the 4 auth-related client messages.

## API
- `loginRequest(username, password)` — C2S_LoginRequest
- `createCharacter(name, classId)` — C2S_CreateCharacter
- `selectCharacter(characterId)` — C2S_SelectCharacter
- `backToCharacterSelect()` — C2S_BackToCharacterSelect
- `encodeClient(msg)` — ClientMessage → ArrayBuffer
- `decodeServer(data)` — ArrayBuffer | Uint8Array → ServerMessage
- `debugLog(msg)` — console.log decoded ServerMessage as JSON

## Type check
`npx tsc --noEmit` — passed clean.

## Commit
`d0b1386` — `feat: add protocol type wrappers for auth messages`
