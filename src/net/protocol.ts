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

/** 属性分配（服务端权威）：stat 为 strength/spirit/talent/agility/health/undo */
export function allocateStat(stat: string, points = 1): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        allocateStat: { stat, points },
    });
}

/** 背包移动/换格（含背包↔仓库）：toLocation+toSlot 为画布目标 */
export function inventoryMove(uid: number, toLocation: number, toSlot: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        inventoryMove: { uid, toLocation, toSlot },
    });
}

/** 穿装备：背包物品 uid → 装备槽(1~13) */
export function equipItem(uid: number, equipSlot: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        equipItem: { uid, equipSlot },
    });
}

/** 脱装备：装备槽(1~13) → 背包 */
export function unequipItem(equipSlot: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        unequipItem: { equipSlot },
    });
}

/** 丢弃（软删） */
export function dropItem(uid: number, count = 1): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        dropItem: { uid, count },
    });
}

/** W 键武器切换（主装备 slot1/2 ↔ 备用武器槽） */
export function switchWeapon(): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ switchWeapon: {} });
}

/** 技能释放（服务端权威）。
 *  skillId 占位：当前传 SKILLS[职业] 列表下标（0-19），由服务端当普攻处理；
 *  接入真实技能时改为服务端技能表（skilldata.skillid）的技能 id。
 *  targetId=0 表示无显式目标（buff/自施法）；targetPosition 供地面技能后续使用。 */
export function useSkill(skillId: number, targetId = 0, targetPosition?: jpt.base.Position.$Properties): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        useSkill: { skillId, targetId, ...(targetPosition ? { targetPosition } : {}) },
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
