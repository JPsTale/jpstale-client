# Protocol Types Design

## Overview
Create type-safe wrappers around generated protobuf types for client usage.

## Key Findings from Proto File
- `jpt.base.ClientMessage` uses `$Properties` interface for construction
- Constructor: `new ClientMessage(properties?: ClientMessage.$Properties)`
- `encode()` takes `$Properties`, returns `Writer`
- `decode()` takes `Uint8Array`, returns `ClientMessage & $Shape`
- Sub-messages (e.g., `C2S_LoginRequest`) also have `$Properties` interfaces

## Proposed Functions
1. `loginRequest(username, password)` - wraps `C2S_LoginRequest`
2. `createCharacter(name, classId)` - wraps `C2S_CreateCharacter`
3. `selectCharacter(characterId)` - wraps `C2S_SelectCharacter`
4. `backToCharacterSelect()` - wraps `C2S_BackToCharacterSelect`
5. `encodeClient(msg)` - encodes ClientMessage to ArrayBuffer
6. `decodeServer(data)` - decodes ArrayBuffer to ServerMessage
7. `debugLog(msg)` - logs decoded message to console

## Open Question
Should I include additional builder functions for other message types, or keep it minimal as specified?

## Next Steps
Await user clarification, then write final design document.