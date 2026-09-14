// 框架无关的游戏状态 store。
// 单向流动：网络层/主循环（低层）通过 setter 写入，React 面板层（高层）只读渲染。
// 用 useSyncExternalStore 桥接（见 ui/react/*）：getGameSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

import { HELD_SLOT, LOC, POTION_SLOT_BASE, isHeldItem } from '../game/itemLocations.js';
import { itemDefById } from '../game/data/itemDefs.js';
import { isTwoHandWeaponClass } from '../game/itemClass.js';
import { playItemSound, playItemDropSound } from '../audio/item-sounds.js';

export type OpenPanel = 'charStatus' | 'skills' | 'inventory' | 'shop';

// 拳位装备：标识一个技能（用职业目录+图标文件，跨职业唯一稳定）。
// iconFile === 'skill_normal'（无 .bmp）表示普通攻击。
export interface FistBinding {
  classDir: string;    // CLASS_DIR 职业目录（fighter/mecha/...）
  iconFile: string;    // skillData iconFile 的文件名（不含 .bmp），普攻='skill_normal'
}

/** F1~F8 快捷绑定：按下时把某技能切到对应拳（自动切换，无需开面板）。 */
export interface QuickBinding {
  classDir: string;
  iconFile: string;    // 同 FistBinding；可含普攻
  target: 'left' | 'right';
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
  skillPoint: number;          // 普通技能点（学习 T1-T4 技能）
  specialSkillPoint: number;   // 特殊技能点（学习 T5 技能）
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
  /** 当前装备到左右拳的技能（null=普通攻击；拳位默认普通攻击） */
  fistBindings: { left: FistBinding | null; right: FistBinding | null };
  /** F1~F8 快捷绑定（length 8，index 0=F1）；按下 F 键自动把技能切到 target 拳 */
  quickBindings: readonly (QuickBinding | null)[];
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
  /** NPC 商店：打开中的商店与卖出模式（null = 没开） */
  shop: { npcId: number; items: ShopItem[]; sellMode: boolean } | null;
}

const LS_FISTS = 'pt.fistBindings';
const LS_QUICK = 'pt.quickBindings';

function loadJSON<T>(key: string): T | null {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : null;
  } catch { return null; }
}

function loadInitial(): GameSnapshot {
  const fb = loadJSON<{ left: FistBinding | null; right: FistBinding | null }>(LS_FISTS);
  const qb = loadJSON<(QuickBinding | null)[]>(LS_QUICK);
  return {
    character: null,
    player: null,
    inventory: null,
    openPanels: [],
    systemMenuOpen: false,
    fistBindings: {
      left: fb?.left ?? null,
      right: fb?.right ?? null,
    },
    quickBindings: Array.isArray(qb) && qb.length === 8 ? qb : new Array(8).fill(null),
    heldUid: null,
    hoverSpot: null,
    shop: null,
  };
}

let snapshot: GameSnapshot = loadInitial();
const listeners = new Set<() => void>();

function persist(): void {
  try {
    localStorage.setItem(LS_FISTS, JSON.stringify(snapshot.fistBindings));
    localStorage.setItem(LS_QUICK, JSON.stringify(snapshot.quickBindings));
  } catch { /* 隐私模式等写入失败忽略 */ }
}

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

export function getGameSnapshot(): GameSnapshot {
  return snapshot;
}

/** 悬停的**来源**：指一个位置，而不是一件物品。 */
export type HoverSource =
  | { kind: 'bag'; cell: number }      // 背包格（按足迹覆盖判定里面那件）
  | { kind: 'equip'; slot: number }    // 装备槽 1~13（含"双手武器占副手格"的镜像）
  | { kind: 'potion'; idx: number };   // HUD 药水槽 0~2（ITEMSLOT 11~13）

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
  for (const it of after) {
    const prev = prevByUid.get(it.uid);
    if (prev && prev.location === it.location && prev.slot === it.slot) continue;   // 没换位置（只改数量等）
    if (prev && isHeldItem(prev) && isHeldItem(it)) continue;                       // 鼠标位内换位：不是"放进"
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
  persist();
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
export function setShop(npcId: number, items: ShopItem[]): void {
  commit({ shop: { npcId, items, sellMode: false } });
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

/** 本地把物品从当前落点抽离为"手持"（location=-1 各视图均不渲染，随 BagLayout/EquipItem 上报落点） */
export function localToHeld(uid: number): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  // 乐观版本的服务端 `TakeToHand`：物品移到"装备栏的 -1 号槽"（鼠标位）
  const items = cur.items.map((x) => (x.uid === uid ? { ...x, location: LOC.EQUIP, slot: HELD_SLOT } : x));
  commit({ inventory: { ...cur, items } });
  syncHeldFromItems(items);
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

// —— 拳位装备 / F1~F8 快捷绑定（持久化到 localStorage） ——
// 语义与原版一致：装备某技能到拳位 = 战斗中左/右键自动释放该技能。
// null 拳位 = 普通攻击（原版普攻格/恢复普攻）。

export function equipFist(target: 'left' | 'right', bind: FistBinding | null): void {
  if (bind && snapshot.fistBindings[target] && snapshot.fistBindings[target]!.classDir === bind.classDir
    && snapshot.fistBindings[target]!.iconFile === bind.iconFile) return;
  commit({ fistBindings: { ...snapshot.fistBindings, [target]: bind } });
}

/** 记录 F1~F8 快捷绑定（index 0=F1）；同 F 键旧绑定被覆盖（原版同一 F 键只能绑一个）。 */
export function setQuickBinding(index: number, qb: QuickBinding | null): void {
  if (index < 0 || index > 7) return;
  const arr = [...snapshot.quickBindings];
  arr[index] = qb;
  commit({ quickBindings: arr });
}

/**
 * 按下 F1~F8：把该键绑定的技能自动切到对应拳（无需开面板）。
 * @returns 是否命中绑定（命中即切换）
 */
export function pressQuickBinding(index: number): boolean {
  if (index < 0 || index > 7) return false;
  const qb = snapshot.quickBindings[index];
  if (!qb) return false;
  equipFist(qb.target, { classDir: qb.classDir, iconFile: qb.iconFile });
  return true;
}