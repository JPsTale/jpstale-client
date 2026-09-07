// 框架无关的游戏状态 store。
// 单向流动：网络层/主循环（低层）通过 setter 写入，React 面板层（高层）只读渲染。
// 用 useSyncExternalStore 桥接（见 ui/react/*）：getGameSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

export type OpenPanel = 'charStatus' | 'skills' | null;

/** 技能快捷栏：12 格（F1-F12），值 = SKILLS[职业] 列表下标（0-19），null = 空。
 *  暂存内存（单角色、职业固定）；接入存档/多角色时再持久化。 */
export type SkillBar = Array<number | null>;

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
  openPanel: OpenPanel;
  skillBar: SkillBar;
}

let snapshot: GameSnapshot = { character: null, player: null, openPanel: null, skillBar: Array(12).fill(null) };
const listeners = new Set<() => void>();

export function getGameSnapshot(): GameSnapshot {
  return snapshot;
}

export function subscribeGame(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function commit(patch: Partial<GameSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  for (const l of [...listeners]) l();
}

export function setGameCharacter(c: GameCharacter): void {
  commit({ character: c });
}

export function setGamePlayer(p: GamePlayer): void {
  commit({ player: p });
}

export function setOpenPanel(p: OpenPanel): void {
  commit({ openPanel: p });
}

/** 绑定/清空快捷栏某格：slot 0-11，idx = SKILLS[职业] 下标 0-19 或 null */
export function setSkillBarSlot(slot: number, idx: number | null): void {
  if (slot < 0 || slot >= 12) return;
  const next = [...snapshot.skillBar];
  next[slot] = idx;
  commit({ skillBar: next });
}