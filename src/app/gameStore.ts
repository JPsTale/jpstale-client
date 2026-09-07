// 框架无关的游戏状态 store。
// 单向流动：网络层/主循环（低层）通过 setter 写入，React 面板层（高层）只读渲染。
// 用 useSyncExternalStore 桥接（见 ui/react/*）：getGameSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

export type OpenPanel = 'charStatus' | 'skills';

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

export interface GameSnapshot {
  character: GameCharacter | null;
  player: GamePlayer | null;
  openPanels: readonly OpenPanel[];
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
    openPanels: [],
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