import { jpt } from "./proto/base_message.js";

export function loginRequest(username: string, password: string): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        loginRequest: { username, password },
    });
}

export function createCharacter(name: string, classId: number, head = 0): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        createCharacter: { name, classId, head },
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

/** 移动上报（客户端位置上权威）：angle=弧度(0=+Z北)，mode=0 IDLE/1 WALK/2 RUN，x/y/z=世界位置。
 *  anim=动画状态覆盖（0=按 mode 推导；掉落 FALLDOWN=0x70/FALLSTAND=0x71/FALLDAMAGE=0x72）。 */
export function playerMove(angle: number, mode: number, x: number, y: number, z: number, anim = 0): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        playerMove: { position: { x, y, z }, angle, mode, timestamp: Date.now(), animState: anim },
    });
}

export function ping(): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        ping: { timestamp: Date.now() },
    });
}

export function encodeClient(msg: jpt.base.ClientMessage.$Properties): Uint8Array {
    return jpt.base.ClientMessage.encode(msg).finish();
}

export function decodeServer(data: ArrayBuffer | Uint8Array): jpt.base.ServerMessage {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    return jpt.base.ServerMessage.decode(buf);
}

export function debugLog(msg: jpt.base.ServerMessage): void {
    console.log(JSON.stringify(jpt.base.ServerMessage.toObject(msg)));
}
