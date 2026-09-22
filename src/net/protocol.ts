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

/** 退出登录（登出整体，服务端保存存档后回 auth.logout，客户端再断开） */
export function logout(): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        logout: {},
    });
}

/** 移动上报（客户端位置上权威）：angle=弧度(0=+Z北)，mode=0 IDLE/1 WALK/2 RUN，x/y/z=世界位置。
 *  anim=动画状态覆盖（0=按 mode 推导；掉落 FALLDOWN=0x70/FALLSTAND=0x71/FALLDAMAGE=0x72）。
 *  animIndex/animClip=本机此刻播的那一条动画（.inx 条目索引 + 语义 ID）：服务端原样透传给
 *  旁观者，旁观者直接播同一条，不再各自匹配/随机。 */
export function playerMove(angle: number, mode: number, x: number, y: number, z: number, anim = 0,
                           animIndex = 0, animClip = ''): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        playerMove: { position: { x, y, z }, angle, mode, timestamp: Date.now(), animState: anim,
                      animIndex, animClip },
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

/** 穿装备：uid 所在的容器（背包格 / 鼠标位）→ 装备槽(1~13) */
/** **换手**：手上那件 ↔ 背包里某件，原子互换（服务端一次落地，不需要"先放下再拿起"两步）。 */
/** **换手**：手上那件 ↔ 背包里某件（原子）。`toLocation/toSlot` = 手上那件的**落点锚格** ——
 *  必须带上：被撞件的锚格常常不是落点（2×4 与 2×3 只是部分重叠时两者不同，服务端按错的格校验会误判越界）。 */
export function bagSwap(handUid: number, targetUid: number, toLocation: number, toSlot: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        bagSwap: { handUid, targetUid, toLocation, toSlot },
    });
}

/** 拿起：任意容器 → 鼠标位（装备栏 slot = -1）。放下不需要配套消息（走 EquipItem/BagLayout/DropItem）。
 *  `count > 0` 且小于现有量时为**拆分**：只拿 count 个，余数留在原格（用户 2026-09-14）。 */
export function takeToHand(uid: number, count = 0): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        takeToHand: { uid, count },
    });
}

export function equipItem(uid: number, equipSlot: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        equipItem: { uid, equipSlot },
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

/** 背包布局上报（客户端网格权威，全量快照 + 单调递增 seq）：
 * 一次手势/整理后把全部物品最终落点上报；seq 单调递增，服务端丢弃 seq<=lastSeq 的乱序/重放包。
 * entries 仅含 (uid, location, slot)，count 全走服务端事件点。 */
export function bagLayout(seq: number, entries: { uid: number; location: number; slot: number }[]): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        bagLayout: { seq, entries: entries.map((e) => ({ uid: e.uid, location: e.location, slot: e.slot })) },
    });
}

/** 药水堆叠合并：src 并入 dst（服务端校验同种可叠后计数并入、src 软删） */
export function stackMerge(srcUid: number, dstUid: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ stackMerge: { srcUid, dstUid } });
}

/** 拾取地面物品。toHand=true → 服务端直接放到**手上**（鼠标位；原版背包窗口开着时就是这么做的，
 *  且**不需要背包空格**）；false → 自动进背包空格。 */
export function npcInteract(entityId: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ npcInteract: { entityId } });
}

export function shopBuy(entityId: number, itemlistId: number, count: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ shopBuy: { entityId, itemlistId, count } });
}

export function shopSell(entityId: number, uid: number, count: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ shopSell: { entityId, uid, count } });
}

export function pickupItem(groundItemId: number, toHand: boolean): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        pickupItem: { groundItemId, toHand },
    });
}

/**
 * 攻击起手（挥拳开始）：只广播开始攻击，伤害在命中帧结算。
 * `clientSeq` 用于关联服务端回下的 `S2C_AttackPlan`（B 方案：起手即裁定各段结果）；
 * `segments` = 本次动作段数（非零 eventFrame 个数），服务端据此预排并作为合法段数上限。
 */
export function attackStart(targetId: number, clientSeq: number, segments: number,
                            animIndex = 0, animClip = ''): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        attackStart: { targetId, clientSeq, segments, animIndex, animClip },
    });
}

/** 死亡后的复活选择（对应原版 sinInterFace.h 的 RESTART_FEILD/TOWN/EXIT）：
 *  1=本图最近的 startPoint（10% 本级经验 + 10% 金币）/ 2=村庄（1% 本级经验）/ 3=继续躺（等强制） */
export function respawnChoice(choice: 1 | 2 | 3): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ respawnChoice: { choice } });
}

/** 使用背包里的消耗品（右键/药水槽）：只报 uid(+数量)，效果与校验全在服务端 */
export function useItem(uid: number, quantity = 1): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ useItem: { uid, quantity } });
}

/** 脱困请求（系统菜单"脱离卡死"按钮）：不带参数，落点由服务端算（本图最近 StartPoint） */
export function unstuck(): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ unstuck: {} });
}

/** 命中帧（每段一次）：hitIndex = 段序号（0..3，对应 motion.eventFrame 第几个非零帧） */
export function attackHit(targetId: number, hitIndex: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        attackHit: { targetId, hitIndex },
    });
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

/** 聊天发送。channel 传入解析后的频道；message 为文本内容（不含前缀）。 */
export function chat(channel: jpt.base.ChatChannel, message: string, targetName = ""): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        chat: { channel, message, ...(targetName ? { targetName } : {}) },
    });
}

export type ParsedChat =
    | { type: "chat"; channel: jpt.base.ChatChannel; message: string }
    | { type: "private"; targetName: string; message: string }
    | { type: "command"; message: string };

/**
 * 聊天输入解析（对齐原版肉节记忆）：
 * - `/名字: 消息` 或 `/名字; 消息` → 私聊（CHAT_PRIVATE + targetName）
 * - `/TRADE> 消息` → 交易频道（CHAT_TRADE）
 * - `@消息` → 组队聊天（CHAT_PARTY）
 * - 其余 `/` 开头 → 命令，原样上送服务端权威解析（含 /@、//party 等）
 * - 其他文本 → 按传入的默认频道发送
 */
export function parseChatInput(input: string, defaultChannel: jpt.base.ChatChannel): ParsedChat {
    const trimmed = input.trim();
    if (trimmed.length === 0) {
        return { type: "chat", channel: defaultChannel, message: "" };
    }

    // 私聊：/名字: 消息 或 /名字; 消息
    if (trimmed.startsWith("/") && (trimmed[1] === ":" || trimmed[1] === ";")) {
        const rest = trimmed.substring(2);
        const sep = rest.indexOf(" ");
        const targetName = sep >= 0 ? rest.substring(0, sep) : rest;
        const msg = sep >= 0 ? rest.substring(sep + 1).trim() : "";
        return { type: "private", targetName, message: msg };
    }

    // 全服交易：/TRADE> 消息
    if (trimmed.startsWith("/TRADE>")) {
        return { type: "chat", channel: jpt.base.ChatChannel.CHAT_TRADE, message: trimmed.substring(7).trim() };
    }
    if (trimmed.startsWith("/trade>")) {
        return { type: "chat", channel: jpt.base.ChatChannel.CHAT_TRADE, message: trimmed.substring(7).trim() };
    }

    // 组队聊天：@消息
    if (trimmed.startsWith("@")) {
        return { type: "chat", channel: jpt.base.ChatChannel.CHAT_PARTY, message: trimmed.substring(1).trim() };
    }

    // 命令：/ 开头原样上送
    if (trimmed.startsWith("/")) {
        return { type: "command", message: trimmed };
    }

    return { type: "chat", channel: defaultChannel, message: trimmed };
}

export function encodeClient(msg: jpt.base.ClientMessage.$Properties): Uint8Array {
    return jpt.base.ClientMessage.encode(msg).finish();
}

export function decodeServer(data: ArrayBuffer | Uint8Array): jpt.base.ServerMessage {
    const buf = data instanceof ArrayBuffer ? new Uint8Array(data) : data;
    return jpt.base.ServerMessage.decode(buf);
}

export function debugLog(msg: jpt.base.ServerMessage): void {
    // 调试期默认关闭整包日志（需要时放开下行）
    // console.log(JSON.stringify(jpt.base.ServerMessage.toObject(msg)));
    void msg;
}

/**
 * 合成（Mix）：目标装备 + 投入的材料石。
 * ⚠ 落点/顺序都由**服务端**按 `gamedb.mixlist` 重新匹配（客户端不知道配方，也不该知道）。
 */
export function mixItem(targetUid: number, stoneUids: readonly number[]): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ mixItem: { targetUid, stoneUids: [...stoneUids] } });
}

/** 锻造投石：目标装备 + 一颗材料石（"一键拉满"那颗力量石走 `useItem`，不走这里）。 */
export function ageItem(targetUid: number, stoneUid: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ ageItem: { targetUid, stoneUid } });
}

/** 力量大师：材料石 → 力量石（每颗换同档一颗，规则见服务端 `ForceOrbService`）。 */
export function forceOrbItem(stoneUids: readonly number[]): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ forceOrbItem: { stoneUids: [...stoneUids] } });
}

/**
 * 合成**预览**请求：把当前投入的 uid 列表报给服务端，由服务端算好"会得到什么"再发回来。
 * （客户端不持有配方表 —— 见 `S2C_MixPreview` 的注释。）
 */
export function mixPreview(targetUid: number, stoneUids: readonly number[]): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({ mixPreview: { targetUid, stoneUids: [...stoneUids] } });
}
