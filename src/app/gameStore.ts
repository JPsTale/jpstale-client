// 框架无关的游戏状态 store。
// 单向流动：网络层/主循环（低层）通过 setter 写入，React 面板层（高层）只读渲染。
// 用 useSyncExternalStore 桥接（见 ui/react/*）：getGameSnapshot 返回稳定引用，
// 只有 commit 时才替换快照对象，避免无谓重渲染。

export type OpenPanel = 'charStatus' | null;

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
}

let snapshot: GameSnapshot = { character: null, player: null, openPanel: null };
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