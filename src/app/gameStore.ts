// 框架无关的游戏状态 store。
// 单向流动：网络层/主循环（低层）通过 setter 写入，React 面板层（高层）只读渲染。
// 用 useSyncExternalStore 桥接（见 ui/react/*）：getGameSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

export type OpenPanel = 'charStatus' | 'skills' | 'inventory';

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

export function getGameSnapshot(): GameSnapshot {
  return snapshot;
}

export function subscribeGame(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function commit(patch: Partial<GameSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  persist();
  for (const l of [...listeners]) l();
}

export function setGameCharacter(c: GameCharacter): void {
  commit({ character: c });
}

export function setGamePlayer(p: GamePlayer): void {
  commit({ player: p });
}

// —— 物品容器 ——

export function setInventory(inv: GameInventory): void {
  commit({ inventory: inv });
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
}

/** 移除单件（丢弃/软删）。 */
export function removeInventoryItem(uid: number): void {
  const cur = snapshot.inventory;
  if (!cur) return;
  commit({ inventory: { ...cur, items: cur.items.filter((x) => x.uid !== uid) } });
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
  const items = cur.items.map((x) => (x.uid === uid ? { ...x, location: -1, slot: -1 } : x));
  commit({ inventory: { ...cur, items } });
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