import { jpt } from "./proto/base_message.js";

export function loginRequest(username: string, password: string): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        loginRequest: { username, password },
    });
}

export function createCharacter(name: string, classId: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        createCharacter: { name, classId },
    });
}

export function selectCharacter(characterId: number | Long): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        selectCharacter: { characterId },
    });
}

export function backToCharacterSelect(): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        backToCharacterSelect: {},
    });
}

export function encodeClient(msg: jpt.base.ClientMessage.$Properties): ArrayBuffer {
    return jpt.base.ClientMessage.encode(msg).finish().buffer as ArrayBuffer;
}

export function decodeServer(data: ArrayBuffer | Uint8Array): jpt.base.ServerMessage {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    return jpt.base.ServerMessage.decode(buf);
}

export function debugLog(msg: jpt.base.ServerMessage): void {
    console.log(JSON.stringify(jpt.base.ServerMessage.toObject(msg)));
}
