// 框架无关的游戏状态 store。
// 单向流动：网络层/主循环（低层）通过 setter 写入，React 面板层（高层）只读渲染。
// 用 useSyncExternalStore 桥接（见 ui/react/*）：getGameSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

import { HELD_SLOT, LOC, POTION_SLOT_BASE, isHeldItem } from '../game/itemLocations.js';
import { itemDefById } from '../game/data/itemDefs.js';
import { isTwoHandWeaponClass } from '../game/itemClass.js';
import { playItemSound, playItemDropSound } from '../audio/item-sounds.js';

export type OpenPanel = 'charStatus' | 'skills' | 'inventory' | 'shop' | 'worldmap' | 'craft' | 'clan';

// 技能绑定（拳位 / F1~F8）**不在这里定义标识**：身份是**数字 `skillId`**
// （`SkillBindings`，见下），图标/职业由 `game/skillIdentity.ts` 反查。
// ⚠ 早先这里是 `{classDir, iconFile}` 且存在**全局 localStorage**（`pt.fistBindings`/`pt.quickBindings`）——
// 于是"换个角色进去看到的还是上一个角色的绑定、HUD 还画出别职业的技能图标"。两条都已在 2026-09-24 删掉。

/** 一条已学技能（`S2C_SkillList` 下发；未学的技能**不下发**）。 */
export interface LearnedSkillState {
  point: number;    // 技能等级 1..10（已学的必然 ≥1）
  mastery: number;  // **派生后的**熟练度 0..10000（服务端 SkillRules.useSkillMastery）
  /** 该技能此刻的冷却时长（毫秒）—— **服务端算好下发**（`SkillRules.cooldownMs`）。
   *  0 = 服务端说“算不出 CD”（如 5 转：三份源码定义表里都没有 RequireMastery）⇒ 客户端不记 CD。 */
  cdMs: number;
}

/**
 * 已学技能表 + 两个技能点池 —— **服务端下发的唯一真值**（`S2C_SkillList`，只发本人）。
 * `null` = 这张表**还没到**（≠ 什么都没学）：等级一律按"未学"处理，不猜（AGENTS #12）。
 */
export interface SkillListState {
  learned: Readonly<Record<number, LearnedSkillState>>;   // skillId → 等级/熟练度
  skillPoint: number;          // 1–3 转池剩余点
  specialSkillPoint: number;   // 4 转池剩余点
  /** 最近一次被拒的技能操作原因码（`skill.op.*` / `skill.bind.*`，来自 S2C_Error）。面板就地显示；下次成功推送不清除 */
  lastErrorKey: string | null;
  /**
   * 面板数据（服务端算好）：学**下一级**的等级门槛/金币，以及"伤害加成百分比"区间
   * （`powerPct*` = 当前显示等级，`nextPowerPct*` = 下一级；0/0 = 该技能不是"攻击力×百分比"模型）。
   * 键 = skillId；无价目表的槽不在键里。
   */
  learnInfo: Readonly<Record<number, {
    nextReqLevel: number; nextGold: number;
    powerPctMin: number; powerPctMax: number; nextPowerPctMin: number; nextPowerPctMax: number;
  }>>;
}

/** 建会结果（`S2C_ClanCreateResult` 的客户端形态）。 */
export interface ClanCreateResult {
  ok: boolean;
  /** 失败时的 i18n key（服务端只发 key，成功时为空串） */
  errorKey: string;
  clanName: string;
  iconId: number;
}

export interface GameCharacter {
  playerId: number;
  name: string;
  job: number;
  level: number;
  exp: number;
  nextExp: number;
  /** 本级起点的**累计**经验（服务端 expForLevel(level)）：本级进度 = exp - levelExp */
  levelExp: number;
  gold: number;
  strength: number;
  spirit: number;
  talent: number;
  agility: number;
  health: number;
  statePoint: number;
  skillPoint: number;          // 1–3 转池剩余点（与 `SkillListState.skillPoint` 同源：服务端 `free(Pool.ONE)`）
  specialSkillPoint: number;   // 4 转池剩余点（同上 `free(Pool.FOUR)`；**5 转不属任何池**，别读成"T5 的点"）
  rank: number;                // 转职阶级（原版 ChangeJob：0=1转…3=4转；服务端 JobService 按等级 20/40/60 推进）
  /** 公会名（空串 = 无公会）。初始态来自 S2C_CharacterStatus；建会/退会后的增量走 S2C_ClanUpdate。 */
  clanName: string;
  /** 公会图标编号（clandb.cl.miconcnt 转字符串）；空串 = 无。与 clanName 同源。 */
  clanMark: string;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sp: number;
  maxSp: number;
  attackMin: number;
  attackMax: number;
  attackRating: number;
  defense: number;
  absorption: number;
  moveSpeed: number;
  walkSpeed: number;
  runSpeed: number;
  attackSpeed: number;
  critical: number;
  block: number;
  avoid: number;
  shootingRange: number;
  maxWeight: number;
  currentWeight: number;
  resBionic: number;
  resPoison: number;
  resFire: number;
  resLightning: number;
  resIce: number;
  regenHp: number;
  regenMp: number;
  regenStm: number;
}

export interface GamePlayer {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  sp: number;
  maxSp: number;
  exp: number;
  nextExp: number;
  walkSpeed: number;
  runSpeed: number;
}

/**
 * 物品实例（对齐服务端 S2C ItemProto 动态字段）。
 * 静态定义（图标/占格/名）查 itemDefs.ts（itemlistId/itemCode），此处只存实例动态值。
 * location: 0=装备栏(1~13 槽) 1=副装备栏 10=背包页(12×12, slot=y*12+x) 30=仓库页(9×9) -1=手持中
 */
export interface GameItem {
  uid: number;
  itemlistId: number;
  itemCode: number;
  location: number;
  slot: number;
  count: number;
  durability: number;
  durabilityMax: number;
  damageMin: number;
  damageMax: number;
  attackRating: number;
  defence: number;
  blockRating: number;   // 0.1 精度
  absorb: number;        // 0.1 精度
  speed: number;         // 0.1 精度
  resBionic: number;
  resFire: number;
  resIce: number;
  resLightning: number;
  resPoison: number;
  resEarth: number;
  resWater: number;
  resWind: number;
  increaseLife: number;
  increaseMana: number;
  increaseStamina: number;
  reqLevel: number;
  reqStrength: number;
  reqSpirit: number;
  reqTalent: number;
  reqAgility: number;
  reqHealth: number;
  price: number;
  jobCodeMask: number;
  agingLevel: number;
  /** 原版 ItemKindCode：1 = 合成物、2 = 锻造物…（0 = 普通） */
  kindCode: number;
  /** 合成/锻造**效果位掩码**（原版 ItemKindMask）：被强化过的那几行据此上色 */
  craftMask: number;
  /**
   * 合成配方的**效果清单**（服务端下发 `key`+值，**不发文案**）—— 客户端用 `t(key)` 查 `mixe.*`
   * 拼出"配方显示名"（i18n 自动；用户 2026-09-22："后端下发名字不合适"）。
   */
  mixEffects: readonly { key: string; value: number; flat: boolean }[];
  /** 锻造熟练度进度（原版 `ItemAgingCount[0]/[1]`）：客户端只用来画进度条 */
  agingExp: number;
  agingExpMax: number;
  /** 合成**配方 id**（= gamedb.mixlist.mixuniqueid）：配方名/配色的来源 */
  mixUniqueId: number;
  /** 合成/锻造校验和（原版 ItemAgingProtect[0]）：只读，供诊断 */
  agingProtect: number;
  critical: number;
  range: number;
  attackSpeed: number;
  manaRegen: number;        // 0.1 精度
  lifeRegen: number;        // 0.1 精度
  staminaRegen: number;     // 0.1 精度
  // 职业特效（sITEM_SPECIAL / userdb.item.spec_*，0.1 精度同前缀规则）
  specAbsorb: number;
  specDefence: number;
  specSpeed: number;
  specBlockRating: number;
  specAttackSpeed: number;
  specCritical: number;
  specShootingRange: number;
  specMagicMastery: number;
  specResBionic: number;
  specResEarth: number;
  specResFire: number;
  specResIce: number;
  specResLighting: number;
  specResPoison: number;
  specResWater: number;
  specResWind: number;
  specLevMana: number;
  specLevLife: number;
  specLevAttackRating: number;
  specLevDamageMax: number;
  specLevResBionic: number;
  specLevResEarth: number;
  specLevResFire: number;
  specLevResIce: number;
  specLevResLighting: number;
  specLevResPoison: number;
  specLevResWater: number;
  specLevResWind: number;
  specPerManaRegen: number; // 0.01 精度
  specPerLifeRegen: number;
  specPerStaminaRegen: number;
}

/**
 * 生效中的 buff（力量石这一类持续效果）—— **服务端权威**。
 *
 * 由 `S2C_BuffState` 整表下发（生效 / 刷新 / 到期 / 任何一次状态推送都会重发）。
 * 客户端只做两件事：按 `剩余/总时长` 画圆环、归零就不再绘制。**不自行判断 buff 是否生效**。
 *
 * `at` = **收到这条推送的本地时刻**：服务端的 `remaining_ms` 是拿服务端时钟算的，
 * 用本地时钟直接相减会带上两端时钟差，故存下接收时刻当基准（形状同 `Player.forceOrbUntil`）。
 */
export interface BuffEntry {
  itemCode: number;
  itemlistId: number;
  remainingMs: number;
  totalMs: number;
  stack: number;
  at: number;
}

/** 队友身上的一个 buff（形状与 BuffEntry 一致——图标/倒计时渲染复用同一套；独立命名免混淆） */
export interface PartyBuffEntry {
  itemCode: number;
  itemlistId: number;
  remainingMs: number;
  totalMs: number;
  stack: number;
  /** 本地接收时刻（倒计时基准） */
  at: number;
}

/**
 * 队伍成员一行（左侧队伍组件 + 大地图标记共用）。
 * ⚠ 动态字段 `hp/level/…` 可能还没被增量包带到（刚进队）——`at === 0` 表示"只有名单、没有数值"，
 * 显示层按**显式的未知**处理（血条空、等级不画），**不许编默认值**（AGENTS #12）。
 */
export interface PartyMemberView {
  id: number;
  name: string;
  classId: number;
  leader: boolean;
  level: number;
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  mapId: number;
  x: number;
  z: number;
  buffs: readonly PartyBuffEntry[];
  /** 最近一次动态数据到达时刻（Date.now()）；0 = 尚无动态数据 */
  at: number;
}

/** 全量名单（S2C_PartyUpdate）：partyId + 模式（0=Normal 1=Hunt）+ 静态身份，队长在首位 */
export interface PartyRoster {
  partyId: number;
  mode: number;
  members: readonly PartyMemberView[];
}

/** 物品容器快照（uid → 实例 索引，渲染时按 location/slot 排布）。 */
export interface GameInventory {
  items: GameItem[];      // 全部活物品（背包+仓库+装备+备用武器）
  gold: number;
}

export interface GameSnapshot {
  character: GameCharacter | null;
  player: GamePlayer | null;
  inventory: GameInventory | null;
  openPanels: readonly OpenPanel[];
  systemMenuOpen: boolean;
  /**
   * 手上拿着的道具（原版 MouseItem）——**交互状态**，不是物品数据。
   * 放在这里是为了让 HUD 的药水槽也能接收"从背包拿起的那瓶药水"（原版：左键拿起 → 点药水槽放下）。
   */
  heldUid: number | null;
  /**
   * 鼠标悬停的**位置**（来源 + 屏幕坐标）。**全局**：背包/装备栏/HUD 药水槽共用一份，
   *  `ItemInfo` 由 PanelsRoot 全局渲染 —— 面板关着时也要能显示（HUD 药水槽就是这样）。
   *
   * ⚠ 存的是**位置**不是 uid：换装/换格/合并会改变某个位置上放的是哪件，
   * 若存 uid，信息框就会一直停在**原来那件**上（用户 2026-09-14：换装后 hover 信息没更新）。
   * 存位置 ⇒ 渲染时按当前物品表现查 ⇒ 位置上换了什么就显示什么。
   */
  hoverSpot: { src: HoverSource; x: number; y: number } | null;
  /** NPC 商店：打开中的商店（entityId = NPC 运行时实体 id）与卖出模式（null = 没开） */
  shop: { entityId: number; items: ShopItem[]; sellMode: boolean } | null;
  /** 生效中的 buff（左上角图标条；见 BuffEntry） */
  buffs: readonly BuffEntry[];
  /**
   * 队伍（docs/组队系统-源码分析.md §8）。null = 未组队；成员全空 = 解散（服务端发空名单作清窗信号）。
   * 静态身份（名字/职业/队长位）来自全量名单 `S2C_PartyUpdate`，动态数值（血/蓝/等级/坐标/buff）
   * 来自 500ms 增量 `S2C_PartyPlayUpdate`——**不含自己**（自己的血/坐标本地权威）。
   */
  party: PartyRoster | null;
  /** 收到的组队邀请（弹窗用）；接受/拒绝/超时后置 null。拒绝不回包（原版同）。 */
  partyInvite: { inviterId: number; inviterName: string } | null;
  /**
   * 打造窗口（合成/锻造/力量石）—— 由 **NPC 交互**触发，`modes` 是**服务端**说这个 NPC 提供哪几档。
   * 客户端**不**按 NPC 名字/模型判断能做什么（那会在改名时静默失效，AGENTS #24）。
   */
  craft: { entityId: number; modes: readonly number[] } | null;
  /**
   * 合成**预览**（服务端算好的 before/after）—— 客户端只显示，不做任何算术。
   * 材料一变就置 null（"待服务端回话"），避免把上一次的结果留在界面上当成本次的结果。
   */
  craftPreview: CraftPreview | null;
  /**
   * 建会结果（`S2C_ClanCreateResult`）—— 由 WS 异步到达，公会面板订阅它刷新。
   * 读数据（详情/排名）不走这里：那是请求-响应，面板自己用 REST 拉（`net/rest.ts`）。
   */
  clanCreate: ClanCreateResult | null;
  /**
   * 收到的**公会邀请**（弹窗用）；接受/拒绝/超时后置 null。形状与语义照 partyInvite
   * （60s TTL 由弹窗组件起计时，与服务端 INVITE_TTL_MS 同长）。
   */
  clanInviteAsk: { inviterId: number; inviterName: string; clanName: string } | null;
  /** 已学技能表（`S2C_SkillList`；null = 还没收到，面板据此**不点亮**任何技能） */
  skillList: SkillListState | null;
  /**
   * 技能绑定表（`S2C_SkillBindings`）—— **服务端权威、按角色存 props**。
   *
   * `null` = **这条消息还没到**（≠ 没绑过）：面板/ HUD 一律按"未知"处理（不可绑、不画图标、并上报），
   * 绝不拿本地残留或默认值顶上（AGENTS #12）。**没有任何本地持久化**：绑定跨角色串台就是因为
   * 早先存在全局 localStorage 里（`pt.fistBindings`/`pt.quickBindings`，2026-09-24 已删）。
   */
  skillBindings: SkillBindings | null;
}

/**
 * 绑定表快照。值 = **数字 `skillId`**，`0` = 该位置**没有绑定**
 * （拳位 0 = 普通攻击拳，就是原版 `pLeftSkill/pRightSkill == NULL` 的状态；快捷 0 = 该 F 键没绑东西）。
 *
 * ⚠ 身份**只有 skillId**：图标文件名/职业目录都是客户端资产命名，存它们会在改名时静默错位
 * （AGENTS #24）—— 图标一律由 `skillRowBySkillId` 反查（`game/skillIdentity.ts`，单一定义）。
 */
export interface SkillBindings {
  fistLeft: number;
  fistRight: number;
  /** 定长 8，**下标 0 = F1**；0 = 未绑。 */
  quick: readonly number[];
}

function loadInitial(): GameSnapshot {
  return {
    character: null,
    player: null,
    inventory: null,
    openPanels: [],
    systemMenuOpen: false,
    heldUid: null,
    hoverSpot: null,
    shop: null,
    buffs: [],
    party: null,
    partyInvite: null,
    craft: null,
    craftPreview: null,
    clanCreate: null,
    clanInviteAsk: null,
    skillList: null,
    skillBindings: null,
  };
}

/** 预览里的一项效果（数都是服务端算的；`key` 是文案 key，见服务端 `MixEffect.keyOf`）。 */
export interface CraftPreviewEffect {
  bit: number;
  key: string;
  value: number;
  flat: boolean;
  before: number;
  after: number;
  intField: boolean;
}

/** 合成预览结果（`matched=false` 时只带 `reasonKey`）。 */
export interface CraftPreview {
  matched: boolean;
  reasonKey: string;
  recipeName: string;
  effects: readonly CraftPreviewEffect[];
}

/** 记下服务端下发的合成预览（材料/目标一变就由面板置 null 再重新请求）。 */
export function setCraftPreview(pv: CraftPreview | null): void {
  commit({ craftPreview: pv });
}

/** 服务端说"这个 NPC 提供打造服务" → 记下来并打开面板（实际打开动作在 bridge 里）。 */
export function setCraftOpen(entityId: number, modes: readonly number[]): void {
  commit({ craft: { entityId, modes } });
}

/** 建会结果入库（`S2C_ClanCreateResult`）；面板据此刷新或显示失败原因。 */
export function setClanCreateResult(r: ClanCreateResult): void {
  commit({ clanCreate: r });
}

/** 收到公会邀请（S2C_ClanInviteAsk）。同一目标只留最新一份（服务端新邀请顶旧的）。 */
export function setClanInviteAsk(ask: { inviterId: number; inviterName: string; clanName: string } | null): void {
  commit({ clanInviteAsk: ask });
}

/** 自机的公会显示变更（S2C_ClanUpdate 且 playerId == 自己 / characterStatus 初始态）：面板读这里。 */
export function setSelfClan(clanName: string, clanMark = ''): void {
  const c = snapshot.character;
  if (!c || (c.clanName === clanName && c.clanMark === clanMark)) return;
  commit({ character: { ...c, clanName, clanMark } });
}

/** 关闭打造窗口（面板关闭时调用；下次交互会重新收到服务端的档位）。 */
export function closeCraft(): void {
  if (snapshot.craft === null) return;
  commit({ craft: null });
}

/** 整表替换 buff 列表（服务端每次下发都是完整列表，不做增量合并）。 */
export function setBuffs(list: readonly BuffEntry[]): void {
  // 内容相同就不提交（S2C_BuffState 会跟着每次状态推送重发，避免无谓重渲染）
  const cur = snapshot.buffs;
  if (cur.length === list.length && cur.every((b, i) => sameBuff(b, list[i]))) return;
  commit({ buffs: list });
}

function sameBuff(a: BuffEntry, b: BuffEntry): boolean {
  return a.itemCode === b.itemCode && a.remainingMs === b.remainingMs
    && a.totalMs === b.totalMs && a.stack === b.stack;
}

// ==================== 队伍（组队系统，docs/组队系统-源码分析.md §8） ====================

/** 整表替换队伍名单（成员变动时服务端发全量；members 为空 = 解散/清窗信号）。 */
export function setPartyRoster(partyId: number, mode: number, members: readonly PartyMemberView[]): void {
  if (members.length === 0) {
    if (snapshot.party === null && snapshot.partyInvite === null) return;
    commit({ party: null, partyInvite: null });
    return;
  }
  const cur = snapshot.party;
  if (cur && cur.partyId === partyId && cur.mode === mode && cur.members.length === members.length
    && cur.members.every((m, i) => sameMember(m, members[i]))) {
    return;
  }
  commit({ party: { partyId, mode, members } });
}

/** 500ms 动态数据合并进现有名单（按 id 匹配；名单未到时丢弃——名单才是权威）。 */
export function setPartyPlay(
  list: readonly (Omit<PartyMemberView, 'name' | 'classId' | 'leader'>)[],
): void {
  const cur = snapshot.party;
  if (!cur) return;
  let changed = false;
  const merged = cur.members.map((m) => {
    const u = list.find((x) => x.id === m.id);
    if (!u) return m;
    changed = true;
    return { ...m, ...u };
  });
  if (!changed) return;
  commit({ party: { ...cur, members: merged } });
}

/** 收到组队邀请（弹窗用；同一邀请人重复邀请覆盖即可） */
export function setPartyInvite(inviterId: number, inviterName: string): void {
  const cur = snapshot.partyInvite;
  if (cur && cur.inviterId === inviterId && cur.inviterName === inviterName) return;
  commit({ partyInvite: { inviterId, inviterName } });
}

export function clearPartyInvite(): void {
  if (snapshot.partyInvite === null) return;
  commit({ partyInvite: null });
}

function sameMember(a: PartyMemberView, b: PartyMemberView): boolean {
  return a.id === b.id && a.name === b.name && a.classId === b.classId && a.leader === b.leader
    && a.hp === b.hp && a.maxHp === b.maxHp && a.level === b.level && a.mapId === b.mapId
    && a.x === b.x && a.z === b.z && a.buffs.length === b.buffs.length
    && a.buffs.every((x, i) => x.itemCode === b.buffs[i].itemCode && x.remainingMs === b.buffs[i].remainingMs);
}

/** 整表替换已学技能表（服务端每次下发都是完整表；未学的技能不在键里 = 明确的"未学"）。 */
export function setSkillList(v: SkillListState | null): void {
  commit({ skillList: v });
}

/** 技能表的**部分更新**（当前只有 lastErrorKey）：表未到（null）时不新建，静默忽略 */
export function patchSkillList(patch: (cur: SkillListState) => SkillListState | null): void {
  const cur = getGameSnapshot().skillList;
  if (!cur) return;
  const next = patch(cur);
  if (next !== cur) commit({ skillList: next });
}

/**
 * 整表替换技能绑定（`S2C_SkillBindings`）—— **服务端下发的唯一写入处**。
 *
 * ⚠ 除了这里，**没有任何别的地方会改** `skillBindings`：本地的绑定动作（装备到拳位、录 F 键）
 * 一律**只发 `C2S_SetSkillBinding` 然后等回推**（与 `CharStatusPanel`/学技能同一口径）——
 * 不做乐观更新，也就没有"本地以为绑上了、服务端其实拒了"这种对不上的状态。
 *
 * `null` = 该消息还没到（显式未知）；`v` 必为服务端原样下发的值（含 0 = 未绑）。
 */
export function setSkillBindings(v: SkillBindings | null): void {
  commit({ skillBindings: v });
}

/**
 * 清掉**按角色的服务端权威表**（已学技能表 + 绑定表）—— 进图（`enterGame`）时调一次。
 *
 * <p>为什么必须有这一步：`enterGame` 到"服务端补发技能表/绑定表"之间有**一个窗口**，
 * 若不在这里清，"换角色进去"的头几帧 HUD 画的还是**上一个角色**的拳位图标（用户 2026-09-24 的症状）。
 * 清成 `null` = **显式未知**（不画 / 不可绑），随后服务端在选角那批里重发（`sendSkillTables`）。
 * ⚠ 不是"恢复到默认值"的那种兜底 —— 它把状态变成"不知道"，而不是变成另一个值。
 */
export function clearCharacterTables(): void {
  if (snapshot.skillList === null && snapshot.skillBindings === null) return;
  commit({ skillList: null, skillBindings: null });
}

let snapshot: GameSnapshot = loadInitial();
const listeners = new Set<() => void>();

/**
 * 药水快捷槽（ITEMSLOT 11/12/13）里的物品 uid；idx 0..2 对应数字键 1/2/3。
 * 数字键使用药水走的就是这里：拿到 uid → `sendUseItem(uid)`，
 * 效果与校验全在服务端（handleUseItem 已允许"药水槽来源"）。
 */
export function potionUidInSlot(idx: number): number | null {
  const slot = 11 + idx;
  const items = getGameSnapshot().inventory?.items ?? [];
  const it = items.find((x) => x.location === 0 && x.slot === slot);
  return it ? it.uid : null;
}

/** 按 uid 找物品（**任意位置**，含装备栏/鼠标位/仓库）。找不到返回 null。 */
export function itemByUid(uid: number): GameItem | null {
  const items = getGameSnapshot().inventory?.items ?? [];
  return items.find((x) => x.uid === uid) ?? null;
}

export function getGameSnapshot(): GameSnapshot {
  return snapshot;
}

/** 悬停的**来源**：指一个位置，而不是一件物品。 */
export type HoverSource =
  | { kind: 'bag'; cell: number }      // 背包格（按足迹覆盖判定里面那件）
  | { kind: 'equip'; slot: number }    // 装备槽 1~13（含"双手武器占副手格"的镜像）
  | { kind: 'potion'; idx: number }    // HUD 药水槽 0~2（ITEMSLOT 11~13）
  // 按 **uid** 悬停（打造窗口的格子）：那里的东西是"对背包里某件的引用"，不占任何格子，
  // 所以位置类来源表达不了它 —— 只有 uid 是稳定的身份。
  | { kind: 'item'; uid: number };

/** 悬停物品信息（**全局唯一来源**）：背包格 / 装备槽 / HUD 药水槽都调这里。 */
export function setHoverSpot(src: HoverSource, x: number, y: number): void {
  const cur = snapshot.hoverSpot;
  if (cur && sameHoverSource(cur.src, src) && cur.x === x && cur.y === y) return;   // 同一处原地移动 → 不重复提交
  commit({ hoverSpot: { src, x, y } });
}

export function clearHoverItem(): void {
  if (snapshot.hoverSpot === null) return;
  commit({ hoverSpot: null });
}

function sameHoverSource(a: HoverSource, b: HoverSource): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'bag' && b.kind === 'bag') return a.cell === b.cell;
  if (a.kind === 'equip' && b.kind === 'equip') return a.slot === b.slot;
  if (a.kind === 'potion' && b.kind === 'potion') return a.idx === b.idx;
  if (a.kind === 'item' && b.kind === 'item') return a.uid === b.uid;
  return false;
}

/**
 * 装备栏某槽**当前显示的那件** —— 含"双手武器占两只手"的镜像（原版：双手武器在槽1 时
 * `sInven[1].ItemIndex` 也指向它 ⇒ 副手格显示同一件）。**唯一实现**：渲染（`EquipColumn.eq`）、
 * 悬停解析、点击拿起三方共用，别再各写一份（见 AGENTS #15）。
 */
export function equippedItemAt(items: readonly GameItem[], slot: number): GameItem | undefined {
  const own = items.find((x) => x.location === LOC.EQUIP && x.slot === slot);
  if (own) return own;
  if (slot === 1 || slot === 2) {
    const other = items.find((x) => x.location === LOC.EQUIP && x.slot === (slot === 1 ? 2 : 1));
    if (other) {
      const cls = itemDefById(other.itemlistId)?.class;
      if (cls != null && isTwoHandWeaponClass(cls)) return other;
    }
  }
  return undefined;
}

/**
 * 当前悬停位置上的**物品对象** —— 悬停判据的唯一实现（`ItemInfoLayer`、回归脚本共用）。
 *
 * 按**来源**（背包格 / 装备槽 / 药水槽）现查物品表，而不是记住某件物品：
 * 位置上的东西被换掉（换装、换格、合并、被消耗）时，这里自动解析到**当前**那一件
 * （用户 2026-09-14：换装后信息框还停在换下去的那件上）；位置上空了就返回 null，信息框收起。
 */
export function hoveredItemOf(snap: GameSnapshot = snapshot): GameItem | null {
  const h = snap.hoverSpot;
  if (!h) return null;
  const items = snap.inventory?.items ?? [];
  const src = h.src;
  if (src.kind === 'equip') {
    return equippedItemAt(items, src.slot) ?? null;
  }
  if (src.kind === 'potion') {
    return items.find((x) => x.location === LOC.EQUIP && x.slot === POTION_SLOT_BASE + src.idx) ?? null;
  }
  if (src.kind === 'item') {
    return items.find((x) => x.uid === src.uid) ?? null;
  }
  // 背包格：按**足迹覆盖**判定（与服务端画布同一规则：锚格 + 该件的 w×h）
  const cx = src.cell % LOC.BAG_W;
  const cy = Math.floor(src.cell / LOC.BAG_W);
  return items.find((it) => {
    if (it.location !== LOC.BAG) return false;
    const def = itemDefById(it.itemlistId);
    const ax = it.slot % LOC.BAG_W;
    const ay = Math.floor(it.slot / LOC.BAG_W);
    return cx >= ax && cx < ax + (def?.w ?? 1) && cy >= ay && cy < ay + (def?.h ?? 1);
  }) ?? null;
}

/** 拿起/放下手持道具（null=空手）。走 commit 同一套通知，ItemPanel 与 HUD 一起刷新。 */
export function setHeldUid(uid: number | null): void {
  if (snapshot.heldUid === uid) return;
  commit({ heldUid: uid });
}

/**
 * UI 命中区注册表：**由 UI 自己声明"这一块归我"**（HUD 的按钮与药水槽等）。
 * 用途：背包里拿起道具后"点面板外 = 丢弃"，但 HUD 是 `pointer-events:none` 的覆盖层，
 * 点它会**穿透到 3D 画布**上 —— 只看"是否点在 canvas 上"就会把点药水槽误判成丢弃。
 * 所以丢弃前先问一句"这是不是某个 UI 的交互区"。
 */
const uiHitTests = new Set<(x: number, y: number) => boolean>();

export function registerUiHitTest(fn: (x: number, y: number) => boolean): void {
  uiHitTests.add(fn);
}

/** 屏幕坐标是否落在任一 UI 交互区内 */
export function isOverUi(clientX: number, clientY: number): boolean {
  for (const fn of uiHitTests) {
    try {
      if (fn(clientX, clientY)) return true;
    } catch { /* 单个测试失败不影响其它 */ }
  }
  return false;
}


/**
 * 拿起中的物品对象；没拿着返回 null。
 *
 * **判据只有一个**：物品在**鼠标位**（`isHeldItem` = 装备栏 `slot = -1`）。服务端 `TakeToHand`
 * 把它放在这里，客户端 `localToHeld` 是同一件事的乐观版本 —— "拿起"恒等于"物品离开原容器进鼠标位"，
 * 所以它不会"既在槽里又在手上"，也不存在"背包里那件其实拿着"的第二种表示。
 *
 * ⚠ **装备位（EQUIP/1-13）与药水槽（EQUIP/11-13）不算手持**：那是"已经放下去了"。
 * 曾把判据放宽到"物品还在就行"，结果刚放进药水槽的那瓶被当成手上那件丢到了地上
 * （用户 2026-09-13 实测）；收紧成"只在背包"又让"从装备槽拿起"失效（2026-09-14 实测）。
 */
export function heldItemOf(snap: GameSnapshot = snapshot): GameItem | null {
  const uid = snap.heldUid;
  if (uid == null) return null;
  const it = (snap.inventory?.items ?? []).find((x) => x.uid === uid);
  return it && isHeldItem(it) ? it : null;   // **唯一来源**：服务端鼠标位（装备栏 slot = -1）
}

/**
 * 由**服务端权威的物品表**同步"手持"状态 —— "手上那件"= 物品表里位于鼠标位的那一件。
 *
 * 所以"重登还原手上拿着的东西"不需要客户端记任何东西：服务端把物品放在
 * `(装备栏, slot = -1)`，客户端在进图快照/单件推送时照它恢复（用户 2026-09-14 定）。
 * ⚠ 这也让 `heldUid` 只有一个真值来源：物品在哪，手就在哪（拿起的乐观更新先改物品位置，这里跟着走）。
 */
function syncHeldFromItems(items: GameItem[]): void {
  const onMouse = items.find((x) => isHeldItem(x)) ?? null;
  const want = onMouse ? onMouse.uid : null;
  if ((snapshot.heldUid ?? null) === want) return;
  commit({ heldUid: want });
}

/**
 * 当前"手上拿着"的物品 uid —— 判据见 `heldItemOf`。
 * 原版放下条件 = 源物品 `Flag` 归零（`sinInvenTory.cpp:4624`），
 * 即"物品还在不在（且还能被搬）"，而不是"这次操作做完了"。
 */
export function getHeldUid(): number | null {
  const it = heldItemOf();
  return it ? it.uid : null;
}

/**
 * 乐观更新的**快照与回滚** —— 原版 `ChangeInvenItem` 里 `BackUpPosi` 的等价物。
 *
 * 背景：界面在**点击瞬间**就改（乐观更新，手感才跟原版一样快），但服务端可能拒绝
 * （等级/槽位/负重/禁丢……）。服务端拒绝时它自己什么都没做，所以客户端必须把界面
 * **恢复成点击之前**，否则会出现"我这边看着成了、实际没成"。
 *
 * 三条路径共用这一份（穿装备换手 / 丢到地面 / 放入药水槽），不再各写一套：
 *   ① 操作前 `beginOptimistic(涉及到的物品)` —— 存**整件物品对象**（location/slot/count 都要能还原，
 *      因为药水槽是拆堆放、丢弃是整件移除）；
 *   ② 服务端拒绝（`pt:equipFail`）→ `rollbackOptimistic()` 按快照覆盖回去；
 *   ③ 超时（`OPTIMISTIC_TIMEOUT_MS`）→ 快照失效**不再回滚**：懒检查，不设定时器。
 *      成功的操作不需要"结束"动作（界面已是乐观后的样子），所以只靠超时区分"过期"即可。
 */
const OPTIMISTIC_TIMEOUT_MS = 3000;
let optimisticSnapshot: { items: GameItem[]; at: number } | null = null;

/** 乐观更新前调用：记下这些物品的当前状态，供失败时恢复 */
export function beginOptimistic(items: GameItem[]): void {
  optimisticSnapshot = { items: items.map((x) => ({ ...x })), at: Date.now() };
}

/** 服务端拒绝：按快照恢复（过期快照丢弃，避免用陈旧状态回滚） */
export function rollbackOptimistic(): boolean {
  const p = optimisticSnapshot;
  optimisticSnapshot = null;
  if (!p) return false;
  const age = Date.now() - p.at;
  if (age > OPTIMISTIC_TIMEOUT_MS) {
    console.warn('[bag] 乐观操作已过期 ' + age + 'ms，不再回滚（避免用陈旧状态覆盖）');
    return false;
  }
  const cur = snapshot.inventory;
  if (!cur) return false;
  const byUid = new Map(cur.items.map((x) => [x.uid, x]));
  for (const old of p.items) byUid.set(old.uid, old);   // 整件覆盖：location / slot / count 一起还原
  const items = [...byUid.values()];
  silently(() => commit({ inventory: { ...cur, items } }));   // 回滚 = 事情没发生，不该出声（失败音另有入口）
  syncHeldFromItems(items);   // 回滚后"手在哪"由物品表决定（拿起的乐观更新被撤销 → 自动放手）
  return true;
}

export function subscribeGame(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/**
 * 静默范围：整包替换（进图快照）与回滚**不是"放进容器"**，不该出声 ——
 * 前者是"把整个背包贴上来"（逐件都会看起来像新出现），后者是把乐观更新撤回（事情没发生）。
 * 包一层显式的作用域，比在每个入口写条件更难漏。
 */
let suppressPlacementSound = false;
function silently<T>(fn: () => T): T {
  const prev = suppressPlacementSound;
  suppressPlacementSound = true;
  try {
    return fn();
  } finally {
    suppressPlacementSound = prev;
  }
}

/**
 * **物品动作的词汇表**（用户 2026-09-14 定）：`GET_ITEM`（拿起/取出→鼠标位）、
 * `PUT_ITEM`（放进容器：背包格 / 药水槽 / 装备槽 / **仓库 30** / 未来的邮箱…）、
 * `THROW_ITEM`（丢出：玩家动作 `throwItem` / 服务端通知 `applyItemRemoved` —— 两个操作码）。
 * **发声只在三个动作各自的入口里，判定只有一处** ——
 * 规则只看 `(location, slot)` 的变化，**与是哪个容器无关**，所以新增容器（仓库、邮箱）
 * 不需要写任何音效代码：只要它的 UI 调既有的 store 变更函数即可。
 *
 * **"放进容器"这件事本身有声音** —— 唯一判定（用户 2026-09-14 明确要求）：
 * "无论是放进背包、放进药水槽、放进装备槽，无论是鼠标操作、拾取操作（服务器发来消息），
 *  都应该执行相同的逻辑，即播放对应音效。"
 *
 * 所以判定放在 `commit` 这一层：凡是物品的 `(location, slot)` 变了、或表里**新出现**一件，
 * 就播**该物品自己**的 SoundIndex（原版所有落点都是 `sinPlaySound(pItem->SoundIndex)`）。
 * 只改数量不算（喝药/堆叠计数）—— 那不是"放进"。
 *
 * 放在这里而不是各 UI 处理器里，是因为**同一个事件有多条来源**：鼠标操作走本地乐观更新，
 * 拾取/自动进药水槽/换装回背包走服务端推送。分开写就会出现"鼠标放下有声音、拾取进背包没有"
 * （用户实测报的正是这个），而且两处判定迟早会漂移。
 *
 * 重复播放在所难免（本地乐观 + 服务端确认各一次），这正是原版的听感 ——
 * `sinPlaySound` 只是重启同一个 buffer（AGENTS #22），我们这一层也有同文件冷却（`sfx.start`）。
 */
function notifyPlacedItems(before: readonly GameItem[], after: readonly GameItem[]): void {
  if (suppressPlacementSound) return;
  const prevByUid = new Map(before.map((x) => [x.uid, x]));
  // ⚠ 本函数有**两处**播放入口（落点变化 / 数量变多）—— 一次操作若同时命中两处就会响两声
  //   （用户 2026-09-14 实测过一次）。日志各带前缀，出问题时可据此一行定位是哪一处。
  for (const it of after) {
    const prev = prevByUid.get(it.uid);
    if (prev && prev.location === it.location && prev.slot === it.slot) continue;   // 没换位置（只改数量等）
    if (prev && isHeldItem(prev) && isHeldItem(it)) continue;                       // 鼠标位内换位：不是"放进"
    console.log('[sfx:item] 落点变化 → uid=' + it.uid + ' listId=' + it.itemlistId
      + (prev ? ' ' + prev.location + '/' + prev.slot + '→' + it.location + '/' + it.slot : '（新件）'));
    playItemSound(itemDefById(it.itemlistId)?.sound);
  }
  // ② **某堆变多 = 一次"放进"**，与来源无关：手上那件并进去、从地上捡起来并进去、服务端发进来。
  //    （原版 `AutoSetPotion` / `LastSetInvenItem` 的合并分支都 `sinPlaySound(pItem->SoundIndex)`。）
  //    这条覆盖了"捡药水合并进药水槽" —— 那里客户端表里**没有"消失的源"**可依据（源是地面物），
  //    所以从前那版"看有谁消失"的判据根本触发不到（用户 2026-09-14 实测：合并进药水槽没声音）。
  //    反向不受影响：丢弃是"某件消失但没人变多"（另有 `playItemDropSound`）、喝药是**变少**、清空同理。
  for (const it of after) {
    const prev = prevByUid.get(it.uid);
    if (prev != null && it.count > prev.count) {
      console.log('[sfx:item] 数量变多 → uid=' + it.uid + ' listId=' + it.itemlistId
        + ' ' + prev.count + '→' + it.count);
      playItemSound(itemDefById(it.itemlistId)?.sound);
    }
  }
}

function commit(patch: Partial<GameSnapshot>): void {
  const beforeItems = snapshot.inventory?.items;
  const beforeGold = snapshot.inventory?.gold;
  snapshot = { ...snapshot, ...patch };
  if (patch.inventory && beforeItems && patch.inventory.items !== beforeItems) {
    notifyPlacedItems(beforeItems, patch.inventory.items);
  }
  // **钱到手 → 金币音**（原版 `sinPlusMoney` 之后 `sinPlaySound(SIN_SOUND_COIN)`）。
  // 与"放进容器"的音是两件事：这里是**收钱**那一刻（拾取金币、卖物成交、任务奖励），
  // 而"金币增加"的路径有多条（`S2C_GoldChange` / `playerState` / `characterStatus` / 进图快照），
  // 所以判定放在 `commit` 这一层，和物品落点一样**只有一处**；进图快照走 `silently()` 不会响。
  // **花钱不出声**（买入/死亡扣钱）—— 原版买物的声音是"物品落格"那一下（物品自带音）。
  if (!suppressPlacementSound && beforeGold !== undefined
      && patch.inventory?.gold !== undefined && patch.inventory.gold > beforeGold) {
    playItemSound(18);   // SIN_SOUND_COIN
  }
  for (const l of [...listeners]) l();
}

// —— NPC 商店 ——

/** 一行商品（服务端下发；名字与码都带着，客户端没有本地定义也能显示）。 */
export interface ShopItem {
  itemlistId: number;
  code: string;
  name: string;
  price: number;
  /** 0=武器 1=防具 2=杂货（对应 npclist 的三列；一个 NPC 可以同时是武器店+防具店） */
  kind: number;
}

/**
 * 当前打开的商店（null = 没开）。`sellMode` 是原版的"点 Sell 按钮后光标变卖出光标"：
 * 打开它以后，**点自己背包里的物品**就是卖出（`ItemPanel` 据此改行为）。
 */
export function setShop(entityId: number, items: ShopItem[]): void {
  commit({ shop: { entityId, items, sellMode: false } });
}

export function clearShop(): void {
  if (snapshot.shop === null) return;
  commit({ shop: null });
}

/** 卖出模式开关（原版 SIN_CURSOR_SELL 的等价物）。 */
export function setShopSellMode(on: boolean): void {
  const s = snapshot.shop;
  if (!s || s.sellMode === on) return;
  commit({ shop: { ...s, sellMode: on } });
}

export function setGameCharacter(c: GameCharacter): void {
  commit({ character: c });
}

export function setGamePlayer(p: GamePlayer): void {
  commit({ player: p });
}

// —— 物品容器 ——

export function setInventory(inv: GameInventory): void {
  silently(() => commit({ inventory: inv }));   // 整包替换：不是"放进容器"，逐件都会像新出现
  syncHeldFromItems(inv.items);   // 进图快照：还原"重登时手上还拿着的那件"
}

/** 单件 upsert：uid 相同则替换（位置/属性可能变），否则新增。 */
export function upsertInventoryItem(it: GameItem): void {
  const cur = snapshot.inventory;
  if (!cur) {
    commit({ inventory: { items: [it], gold: 0 } });
    return;
  }
  const idx = cur.items.findIndex((x) => x.uid === it.uid);
  const items = idx >= 0 ? cur.items.map((x, i) => (i === idx ? it : x)) : [...cur.items, it];
  commit({ inventory: { ...cur, items } });
  syncHeldFromItems(items);   // 服务端推来的位置才是权威：它说在鼠标位就是在手上，说不在就放手
}

/**
 * 内部：把一件从表里摘掉（两个操作**共用**的实现，不重复写）。
 * 注意它**不发声** —— 声音属于"哪个操作"，见下面两个公开入口。
 */
function removeItemLocal(uid: number): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  const items = cur.items.filter((x) => x.uid !== uid);
  commit({ inventory: { ...cur, items } });
  // 物品没了 ⇒ "手上那件"可能正是它（典型：源堆被并进药水槽后服务端 softDelete 并推 ItemRemove）。
  // `heldItemOf` 是**派生读**（查表）所以界面不会显示幽灵，但 `snapshot.heldUid` 是存下来的字段，
  // 不同步就会留着一个死 uid —— 后续任何直接读该字段的代码都会按"手上还有东西"处理。
  syncHeldFromItems(items);
}

/**
 * `THROW_ITEM`（**玩家自己的动作**）：把物品丢出容器/丢到地面 → 播**丢弃音**
 * （原版 `ThrowInvenItemToField`）。这是"玩家主动丢"这一个操作码。
 *
 * ⚠ 与下面 `applyItemRemoved` **是两个操作**，不是同一个函数加参数（用户 2026-09-14：
 * "服务器主动移除应该是没声音的，并且我觉得它应该和玩家自己 removeItem 不是一个操作码，我不喜欢用 reason"）：
 * 区分它们的依据是**动作本身**（谁发起的），而不是给同一个动作挂一个"原因"字段 ——
 * 以后商店"卖给 NPC"、仓库"丢出"等也都是各自的操作，各自决定声音。
 */
export function throwItem(uid: number): void {
  removeItemLocal(uid);
  playItemDropSound();
}

/**
 * **服务端通知的移除**（`S2C_ItemRemove` / `S2C_ItemRemovedUids`）：这件在服务端已经没了。
 * **不出声** —— 服务器主动移除（喝掉最后一瓶、被合并、扫地、GM 删除）不该像玩家丢东西那样响
 * （用户 2026-09-14 定）。玩家自己丢的那条走 `throwItem`，在客户端**本地**就已经响过。
 */
export function applyItemRemoved(uid: number): void {
  removeItemLocal(uid);
}

/** 本地即时背包换格（客户端网格权威，随即上报布局；服务端只落库不重建）。
 *  toLocation 目标容器（默认背包页），支持跨容器（背包↔仓库）。 */
export function localBagMove(uid: number, toSlot: number, toLocation = 10): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  const items = cur.items.map((x) => (x.uid === uid ? { ...x, location: toLocation, slot: toSlot } : x));
  commit({ inventory: { ...cur, items } });
}

/** 本地即时卸下装备到指定背包格（随后上报 BagLayout；服务端落库并刷新属性/外观） */
export function localUnequipToBag(uid: number, toSlot: number): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  const items = cur.items.map((x) => (x.uid === uid ? { ...x, location: 10, slot: toSlot } : x));
  commit({ inventory: { ...cur, items } });
}

/** 本地即时装入装备槽（点击瞬间背包即刻消失；随 EquipItem 上报，服务端校验/落库） */
export function localEquipItem(uid: number, slot: number): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  const items = cur.items.map((x) => (x.uid === uid ? { ...x, location: 0, slot } : x));
  commit({ inventory: { ...cur, items } });
}

/**
 * 本地把物品从当前落点抽离为"手持"（location=-1 各视图均不渲染，随 BagLayout/EquipItem 上报落点）。
 *
 * `splitCount > 0` 且小于现有量时为**拆分**：原格只减数量、位置不动；
 * 拆出去的那份**不做本地乐观件**（服务端会新建一行并推送）。
 *
 * ⚠ 曾经这里造过一个 **uid 取负的客户端临时件**，那是错的（用户 2026-09-14 实测）：
 * 服务端的每条操作都按 uid 查物品（`applyBagLayout` / `equipItem` 都是 `byUid(uid)`），
 * **负 uid 查不到** ⇒ 放进背包格时服务端**静默拒绝**（而客户端已经乐观落格，于是留下一个
 * 刷新后才消失的幽灵）；放进药水槽时走 `EquipItem` 被回滚，所以"放不进去"。
 * 两条路表现不同，只是因为一条乐观、一条回滚 —— 根因是同一个：**客户端不该造服务端不认识的 uid**。
 *
 * 代价：拆分后有一小段"手上暂时没有东西"的空档（服务端推送到达即恢复，通常几十毫秒）。
 * 这是刻意的取舍 —— 宁可短暂没有视觉反馈，也不要一个操作不了的幽灵。
 *
 * @return true = 已按拆分处理（调用方应发带 count 的 TakeToHand）；false = 走整堆旧路径
 */
export function localToHeld(uid: number, splitCount = 0): boolean {
  const cur = snapshot.inventory;
  if (!cur) return false;
  const src = cur.items.find((x) => x.uid === uid);
  if (!src) return false;

  if (splitCount > 0 && splitCount < src.count) {
    const items = cur.items.map((x) => (x.uid === uid ? { ...x, count: x.count - splitCount } : x));
    commit({ inventory: { ...cur, items } });
    // 不造临时件 ⇒ 手上此刻为空（原件的 uid 已不代表手上那份）。服务端推送新件后自动接管。
    clearHeld();
    return true;
  }

  // 乐观版本的服务端 `TakeToHand`：物品移到"装备栏的 -1 号槽"（鼠标位）
  const items = cur.items.map((x) => (x.uid === uid ? { ...x, location: LOC.EQUIP, slot: HELD_SLOT } : x));
  commit({ inventory: { ...cur, items } });
  syncHeldFromItems(items);
  return false;
}

/** 清空"手持"（拆分后手上那份归服务端新建的行；在它推送到达前，客户端不应认为手上有东西） */
function clearHeld(): void {
  if (snapshot.heldUid != null) commit({ heldUid: null });
}

/** 本地即时药水合并：src 并入 dst（随即上报 StackMerge） */
export function localStackMerge(srcUid: number, dstUid: number): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  const src = cur.items.find((x) => x.uid === srcUid);
  const dst = cur.items.find((x) => x.uid === dstUid);
  if (!src || !dst) return;
  commit({
    inventory: {
      ...cur,
      items: cur.items
        .filter((x) => x.uid !== srcUid)
        .map((x) => (x.uid === dstUid ? { ...x, count: x.count + src.count } : x)),
    },
  });
}

/** 金币变更。 */
export function setInventoryGold(gold: number): void {
  const cur = snapshot.inventory;
  if (!cur) {
    commit({ inventory: { items: [], gold } });
    return;
  }
  commit({ inventory: { ...cur, gold } });
}

// 面板不再互斥：原版共用窗口底部区域才需互斥，本客户端面板可自由拖动，
// 因此改为"打开中面板的集合"，各面板独立开关、互不影响。
export function openPanel(p: OpenPanel): void {
  if (snapshot.openPanels.includes(p)) return;
  commit({ openPanels: [...snapshot.openPanels, p] });
}

export function closePanel(p: OpenPanel): void {
  if (!snapshot.openPanels.includes(p)) return;
  // 关掉打造窗口时一并清掉它的档位/引用 —— 下次交互由服务端重新给（不留下"上一家 NPC 的窗口"）
  if (p === 'craft') {
    commit({ openPanels: snapshot.openPanels.filter((x) => x !== p), craft: null, craftPreview: null });
    return;
  }
  // 公会面板同理：结果不留到下次（下次建会是新的一次尝试）
  if (p === 'clan') {
    commit({ openPanels: snapshot.openPanels.filter((x) => x !== p), clanCreate: null });
    return;
  }
  commit({ openPanels: snapshot.openPanels.filter((x) => x !== p) });
}

export function togglePanel(p: OpenPanel): void {
  if (snapshot.openPanels.includes(p)) {
    closePanel(p);
  } else {
    openPanel(p);
  }
}

export function closeAllPanels(): void {
  if (snapshot.openPanels.length === 0) return;
  commit({ openPanels: [] });
}

// —— 系统菜单（X 键）：模态，独占（打开时收起所有面板）——
export function openSystemMenu(): void {
  // 静默失效是这个项目反复踩的坑（AGENTS #19）：面板开没开、被谁挡住，日志里要能看见
  console.log('[ui] openSystemMenu: 当前 openPanels=', snapshot.openPanels.length,
    'systemMenuOpen=', snapshot.systemMenuOpen);
  if (snapshot.systemMenuOpen) return;
  if (snapshot.openPanels.length > 0) commit({ openPanels: [], systemMenuOpen: true });
  else commit({ systemMenuOpen: true });
}

export function closeSystemMenu(): void {
  if (!snapshot.systemMenuOpen) return;
  commit({ systemMenuOpen: false });
}

export function toggleSystemMenu(): void {
  if (snapshot.systemMenuOpen) {
    closeSystemMenu();
  } else {
    openSystemMenu();
  }
}

// —— 拳位装备 / F1~F8 快捷绑定 ——
// **本文件不再有改绑定的入口**：绑定是服务端权威（`characterinfo.props`），
// 装备/解绑一律走 `net/bridge.sendSkillBinding` 发包，等 `S2C_SkillBindings` 回推（见 `setSkillBindings`）。
// 语义与原版一致：装备某技能到拳位 = 战斗中左/右键自动释放该技能；未绑（0）= 普通攻击。
// "这个绑定此刻该怎么解释"（画哪张图标 / 该不该放技能 / 按 F 键装到哪只拳）见 `game/skillBinding.ts`。