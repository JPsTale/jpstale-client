/**
 * 动画匹配器 — 根据 (状态, 职业) 从 .inx 动画条目中筛选适用条目
 *
 * 精确匹配逻辑严格依据 exm Character.cpp。
 */

import type { MotionInfo } from './char-format.js';
import { CLASS_FLAG, motionStateName } from './char-format.js';
import { SITEM_CODE_BY_INDEX } from './sitem-weapon-index.js';
import { getWeaponTypeFromSItemIndex } from './weapon-type.js';

export function classIdToFlag(classId: number): number {
  const map: Record<number, number> = {
    1: CLASS_FLAG.Fighter, 2: CLASS_FLAG.Mechanician, 3: CLASS_FLAG.Archer,
    4: CLASS_FLAG.Pikeman, 5: CLASS_FLAG.Atalanta, 6: CLASS_FLAG.Knight,
    7: CLASS_FLAG.Magician, 8: CLASS_FLAG.Priestess, 9: CLASS_FLAG.Assassin,
    10: CLASS_FLAG.Shaman,
    // 第 11 职业 = 格斗家（0x400）。漏掉它 map[11] 为 undefined → 返回 0 →
    // matchClass 恒 false → 所有状态都匹配不到动画（检查器「动作匹配」全红的成因）。
    11: CLASS_FLAG.MartialArtist,
  };
  return map[classId] || 0;
}

function matchClass(motion: MotionInfo, classId: number): boolean {
  if (!motion.dwJobCodeBit) return true;
  const classBit = classIdToFlag(classId);
  return (motion.dwJobCodeBit & classBit) !== 0;
}

/**
 * 按武器精确匹配动画条目的 itemCodeList 白名单（对齐 pviewer anim-match.js）。
 * 空手(weaponIdCode=0/null)：白名单须含空手哨兵 0xFFFF。
 * 具体武器：SITEM_CODE_BY_INDEX[idx] === weaponIdCode 精确命中。
 */
function matchWeapon(motion: MotionInfo, weaponIdCode: number | null): boolean {
  const count = motion.itemCodeCount;
  if (count <= 0) return true;
  if (weaponIdCode == null || weaponIdCode === 0) {
    for (let i = 0; i < count && i < 52; i++) {
      if (motion.itemCodeList[i] === 0xFFFF) return true;
    }
    return false;
  }
  for (let i = 0; i < count && i < 52; i++) {
    const idx = motion.itemCodeList[i];
    if (SITEM_CODE_BY_INDEX[idx] === weaponIdCode) return true;
  }
  return false;
}

/**
 * 按武器类型匹配：动画条目白名单中是否有同类型的武器。
 * 解决新武器无精确索引（SITEM_CODE_BY_INDEX）时的匹配问题。
 */
function matchWeaponByType(motion: MotionInfo, weaponType: string | null): boolean {
  const count = motion.itemCodeCount;
  if (count <= 0) return true;
  if (weaponType == null || weaponType === 'BARE_HAND') {
    for (let i = 0; i < count && i < 52; i++) {
      if (motion.itemCodeList[i] === 0xFFFF) return true;
    }
    return false;
  }
  for (let i = 0; i < count && i < 52; i++) {
    const t = getWeaponTypeFromSItemIndex(motion.itemCodeList[i]);
    if (t === weaponType) return true;
  }
  return false;
}

/**
 * 区域位匹配（对齐 exm SetMotionFromCode：`(!MapPosition || (MapPosition & StageVillage))`）。
 * @param fieldState 区域编码：1=村庄(VILLAGE) 2=野外 3=任意（默认，等价无场景）
 *   动画条目 mapPosition：0=通用；位0(1)=仅村庄；位1(2)=仅野外。
 */
function matchMapPosition(motion: MotionInfo, fieldState: number): boolean {
  if (!motion.mapPosition) return true;
  return (motion.mapPosition & fieldState) !== 0;
}

export function findMotions(
  motions: MotionInfo[],
  state: number,
  weaponIdCode: number | null,
  classId: number,
  fieldState: number = 3,
): MotionInfo[] {
  return motions.filter(m =>
    m.state === state && matchClass(m, classId) && matchWeapon(m, weaponIdCode) && matchMapPosition(m, fieldState),
  );
}

/**
 * 按武器类型匹配（语义化）：新武器无精确索引时用类型匹配。
 * @param weaponType 'AXE'|'BOW'|...|'BARE_HAND' 等
 */
export function findMotionsByType(
  motions: MotionInfo[],
  state: number,
  weaponType: string | null,
  classId: number,
  fieldState: number = 3,
): MotionInfo[] {
  return motions.filter(m =>
    m.state === state && matchClass(m, classId) && matchWeaponByType(m, weaponType) && matchMapPosition(m, fieldState),
  );
}

/**
 * 确定性取样：同一 (seed, 列表) → 同一结果。
 *
 * 为什么必须有：变体选择原先一律 `Math.random()`，于是**同一个远端角色在不同客户端上
 * 播的是不同变体**（用户实测"其他角色的动画也不同步"）。凡是"别人也能看到的角色"，
 * 变体就必须由**所有客户端共有的输入**决定 —— 服务端下发的 seed（同一份数据 → 同一结果）。
 * 用 mulberry32 的混淆步，纯函数、无依赖。
 */
export function seededPick<T>(arr: T[], seed: number): T | null {
  if (!arr.length) return null;
  let t = ((seed >>> 0) + 0x6D2B79F5) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return arr[((t ^ (t >>> 14)) >>> 0) % arr.length]!;
}

/** 取变体：给了 seed 走确定性（跨客户端一致），否则随机（检查器等单机场景） */
export function pickMotion(candidates: MotionInfo[], seed?: number): MotionInfo | null {
  if (!candidates.length) return null;
  if (seed !== undefined) return seededPick(candidates, seed);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/* ─────────── 语义化匹配（唯一实现）───────────
 * 背景：匹配曾散在三处（本文件的类型匹配、检查器的状态面板、检查器的姿态开关），
 * 规则各不相同 → 同一把武器在不同入口给出不同动画（用户实测：1H 斧在姿态入口出 2H 动画）。
 * 现在**只有这一个函数**：读语义描述（sidecar 条目），按 (状态, 职业, 武器语义, 姿态族) 选变体。
 * 检查器与运行时都必须调它；不要再在别处复制匹配逻辑。 */

/** 语义条目（结构对齐 src/game/data/semantic/*.json 的 animations[]） */
export interface SemanticEntry {
  clip: string;
  state: string;
  frames: [number, number];
  repeat: boolean;
  events: Array<{ ord: number; frame: number }>;
  location: string;
  classes: number[];
  skill?: string;
  weapon: { all?: boolean; unarmed?: boolean; list?: Array<{ type: string; hand: string }> };
  /** 原版物品码，仅作外部参照 */
  codes: string[];
  /** 原作者的动作名（韩文），姿态族判定用（정지동작 / 서있기동작 等） */
  label?: string;
}

/** 帧区间 → 变体数组。**不能只存单条** —— 同一区间常有多条（白名单不同），
 *  只存一条会互相覆盖，导致"2H 斧查到 1H 条目"这类错（踩过两次）。 */
function indexByFrames(entries: SemanticEntry[]): Map<string, SemanticEntry[]> {
  const m = new Map<string, SemanticEntry[]>();
  for (const e of entries) {
    const k = `${e.frames[0]}-${e.frames[1]}`;
    m.set(k, [...(m.get(k) ?? []), e]);
  }
  return m;
}

/**
 * 运行时条目 → 语义条目（同帧区间按"全序里第几个同帧条目"配对）。
 *
 * 对外用途：**同步动画时带出人可读的语义 ID**（`SemanticEntry.clip`，如 `stand_unarmed.m4.10`）。
 * 条目索引（`.inx` 序号）才是跨端播放的依据，clip 用于两侧**互相校验数据是否同源** ——
 * 索引对不上时，日志里有 clip 才能立刻分辨是"顺序不同"还是"数据不同"。
 */
export function semanticEntryOfMotion<M extends { index: number; startFrame: number; endFrame: number }>(
  motions: M[],
  entries: SemanticEntry[],
  motion: M,
  byFrames?: Map<string, SemanticEntry[]>,
  pool?: M[],
): SemanticEntry | null {
  const idx = byFrames ?? indexByFrames(entries);
  const list = idx.get(`${motion.startFrame}-${motion.endFrame}`);
  if (!list?.length) return null;
  const pl = pool ?? motions.filter((m) => m.startFrame !== 0 || m.endFrame !== 0);
  let nth = 0;
  for (const om of pl) {
    if (om.index === motion.index) break;
    if (`${om.startFrame}-${om.endFrame}` === `${motion.startFrame}-${motion.endFrame}`) nth++;
  }
  return list[nth] ?? list[0] ?? null;
}

export interface PickQuery {
  /** CHRMOTION_STATE 数值 */
  state: number;
  /**
   * 语义武器类型（AXE/SWORD/…）；**null = 空手/武器已收起**。
   * 与 `location` 是同一件事的两面：原版 `village → weaponId=null`，
   * 且 `.in` 数据里**村庄条目 0 条列过武器**（village 2 条全 unarmed、field 全 list）
   * —— 所以"收械"不是"持有武器但换个姿势"，就是**空手查询**。
   * 若 location='village'，本字段被强制视为 null（见 matchesLocation 处的说明）。
   */
  weaponType: string | null;
  hand: '1H' | '2H' | null;
  classId: number;
  /**
   * 场所（`.in` 的 `*해당위치`）：村庄 = 收械态，野外 = 持械态。
   * 条目 location='any' 时两者通用 —— 实测正对应 `.in` 备注里的
   * "1. 마을에서 뛰기 또는 …무기없이 필드에서 뛰기"（空手/腕弩条目为 any）。
   */
  location?: 'village' | 'field';
  /** 在**排序结果相同**的头部候选中取一条（运行时用；检查器保持确定） */
  random?: boolean;
  /**
   * 变体种子：给了就**确定性**取（同一 seed + 同一数据 → 所有客户端同一条）。
   * 远端角色的动画必须走这条 —— 否则每个客户端各随机一套，同一角色在别人屏幕上动作不一致。
   * 缺省（检查器/单机）仍随机。
   */
  seed?: number;
}

/**
 * **命中方式** —— 决定「这条条目是否适用于当前武器」，不是"候选好坏"。
 *  `exact`            白名单明确含 (type, hand)          ← 唯一真正适用的
 *  `hand-unspecified` 列了该类型，但手别为 '?'（.in 未定）
 *  `wrong-hand`       列了该类型，但手别不符（1H 查询撞上只列 2H 的条目）
 *  `generic`          空手，或条目未给任何武器约束
 *  `all`              任意武器（.in 的 `모두`）
 *  `none`             列的是别的武器类型，且非空手 → 永不适用
 */
export type WeaponFit = 'exact' | 'hand-unspecified' | 'wrong-hand' | 'generic' | 'all' | 'none';

/** 命中方式的中文短名（界面/日志共用，勿在别处另立一张表） */
export const FIT_LABEL: Record<WeaponFit, string> = {
  exact: '明确',
  'hand-unspecified': '手未定',
  'wrong-hand': '异手',
  generic: '空手/通用',
  all: '任意武器',
  none: '不适用',
};

export interface PickCandidate<M> {
  motion: M;
  entry: SemanticEntry;
  fit: WeaponFit;
  /** 手别纯粹度：0=对该类型只列目标手别 / 1=混列两种手别 / 2=未列该类型 */
  purity: number;
}
export interface PickResult<M> {
  motion: M | null;
  entry: SemanticEntry | null;
  /** 选择依据（用于日志/诊断，不参与判定） */
  why: string;
  /** **该姿态下的正式候选**（数组顺序即排序结果；运行时取 [0]） */
  candidates: Array<PickCandidate<M>>;
  /** true = 无正式候选（该武器/状态缺条目），已回退到次优组 —— 界面须显式提示 */
  fallback: boolean;
  /** 因姿态/手别不符被排除的条目数 —— 仅供诊断 */
  excluded: number;
}

/**
 * 唯一语义匹配入口。
 * @param motions 实时动作（与 entries 同源、同序：均由同一份 .inx 顺序产生）
 * @param entries 该模型的 sidecar 条目
 */
export function pickSemanticMotion<M extends { index: number; startFrame: number; endFrame: number }>(
  motions: M[],
  entries: SemanticEntry[],
  q: PickQuery,
): PickResult<M> {
  const byFrames = indexByFrames(entries);
  const pool = motions.filter((m) => m.startFrame !== 0 || m.endFrame !== 0);
  const stateName = motionStateName(q.state);

  const entryOf = (m: M): SemanticEntry | null => semanticEntryOfMotion(motions, entries, m, byFrames, pool);

  // 村庄 = 收械态。数据依据：`.in` 里村庄条目 **0 条列过武器**（village 全 unarmed、
  // field 全 list），所以"收械"就是**空手查询**，不是"持械但换姿势"。强制置空而非
  // 依赖调用方，是因为让"空手条目去适配所有 (type,hand)"会凭空造出一个原版不存在的
  // 查询空间，并让空手动漫变成每种武器的候选杂音（用户指出）。
  const loc: 'village' | 'field' = q.location ?? 'field';
  const unarmedQuery = q.weaponType == null || loc === 'village';
  const wType = unarmedQuery ? null : q.weaponType;
  const wHand = unarmedQuery ? null : q.hand;
  const /** location 命中：'any' 两者通用（实测正对应 `.in` 备注里那条"마을에서 뛰기 또는 …무기없이 필드"） */
    matchesLocation = (e: SemanticEntry): boolean => e.location === 'any' || e.location === loc;

  /**
   * 分组：**第一组是正式候选，后面的组只在正式组为空时作回退**（并置 fallback 标记）。
   *
   * 旧版把"空手/通用"与"异手"都塞进同一个层级，于是它们虽然排在后面却**仍是可选项** ——
   * 表现就是持 1H 斧时 `run_unarmed_1h` 出现在候选里（用户实测）。
   * 持械时武器在手上，空手动画根本不适用；空手/收械时反之，武器条目不适用。
   */
  const groups: WeaponFit[][] = unarmedQuery
    ? [['generic', 'all'], ['hand-unspecified', 'exact', 'wrong-hand']]
    : [['exact', 'hand-unspecified'], ['generic', 'all'], ['wrong-hand']];
  /** 姿态/场所的中文名（why 里用） */
  const stanceText = unarmedQuery ? (loc === 'village' ? '收械(村庄)' : '空手') : `持械(${loc})`;

  const fitnessOf = (e: SemanticEntry): WeaponFit => {
    const list = e.weapon.list ?? [];
    // 空手查询下"空手"就是解 —— **先于手别判定**，因为一条条目可能兼作两者：
    // `run_unarmed_1h` = unarmed + 爪 + 腕弩三者共用。若先判手别，收械时的弩会去播
    // `run_2h_crossbow`（矩阵实测），而爪/腕弩在持械时又必须按 exact 命中它。
    if (e.weapon.unarmed && unarmedQuery) return 'generic';
    if (wType != null) {
      const same = list.filter((x) => x.type === wType);
      if (same.length && (wHand == null || same.some((x) => x.hand === wHand))) return 'exact';
      if (same.length) {
        // ⚠ **明确的手别优先于 `?`**：条目里若写了该类型的**另一只手别**，它就是在说
        // "这是那只手别的动画"，`?` 只是该条目里另有几个码手别未定。
        // 曾把"存在 `?`"一律当 `hand-unspecified`，于是**纯双手条目**（含 2H 码 + 个别 `?` 码）
        // 被判成"手未定"而留在单手候选里 —— 用户实测：单手锤能看到双手锤的站立/走/跑/攻击动画。
        // 只有**该类型的全部条目都是 `?`** 才是真正未定（那种才允许留在候选里、排后）。
        const definite = same.filter((x) => x.hand === '1H' || x.hand === '2H');
        if (definite.length) return 'wrong-hand';
        return same.some((x) => x.hand === '?') ? 'hand-unspecified' : 'wrong-hand';
      }
    }
    if (e.weapon.all) return 'all';
    if (e.weapon.unarmed || !list.length) return 'generic'; // 无语义约束也按"通用"处理
    return 'none';
  };

  // 1) 语义筛：状态 + 职业 + 场所（武器适用性留给分组，便于统计被排除项）
  const considered: Array<{ m: M; e: SemanticEntry; fit: WeaponFit }> = [];
  for (const m of pool) {
    const e = entryOf(m);
    if (!e) continue;                                    // 无语义数据 → 不在此函数里猜
    if (e.state !== stateName) continue;
    if (!matchesLocation(e)) continue;                  // 村庄/野外错配
    if (q.classId && e.classes.length && !e.classes.includes(q.classId)) continue;
    const fit = fitnessOf(e);
    if (fit === 'none') continue;                        // 别的武器类型 → 永不适用
    considered.push({ m, e, fit });
  }
  if (!considered.length) return { motion: null, entry: null, candidates: [], fallback: false, excluded: 0, why: `无候选：state=${stateName} ${stanceText} loc=${loc}` };

  // 2) 取组：正式组优先；为空才退到后续组
  let chosen: typeof considered = [];
  let usedGroup = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const g = considered.filter((c) => groups[gi]!.includes(c.fit));
    if (g.length) { chosen = g; usedGroup = gi; break; }
  }
  const fallback = usedGroup > 0;
  const excludedCount = considered.length - chosen.length;
  const excludedNote = () => {
    if (!excludedCount) return '';
    const byFit = new Map<WeaponFit, number>();
    const chosenSet = new Set(chosen);
    for (const c of considered) if (!chosenSet.has(c)) byFit.set(c.fit, (byFit.get(c.fit) ?? 0) + 1);
    return `｜已按姿态排除 ${excludedCount} 条（${[...byFit].map(([f, n]) => FIT_LABEL[f] + n).join('/')}）`;
  };

  // 3) 排序：**同组内**按 fit 细分 → 手别纯粹度 → 类型数 → 码数 → index
  //    注意：空列表**不是**"最专一" —— 第一版按 list 长度升序排，把 stand_unarmed[0类]
  //    排到了最前，结果 1H/2H 斧都选了空手条目。空手条目现在根本不在战斗候选里。
  const fitIdx = (f: WeaponFit): number => {
    const i = groups[usedGroup]!.indexOf(f);
    return i < 0 ? groups[usedGroup]!.length : i;
  };
  /**
   * **手别纯粹度**（排序键）：
   * 对目标类型，只覆盖目标手别 = 0；同时覆盖另一种手别（混列）= 1。
   * 反例（用户实测）：1H 斧的 RUN 里 `run.m1.26` 是纯 1H，而 `run~3.m1.28` 混列
   * 1H+2H —— 只按"类型数最少"排序会让混列条目胜出，于是 1H 斧播了 2H 的跑动。
   */
  const handPurity = (e: SemanticEntry): number => {
    const same = (e.weapon.list ?? []).filter((x) => x.type === wType);
    if (!same.length) return 2;
    return new Set(same.map((x) => x.hand)).size === 1 ? 0 : 1;
  };
  const pool2 = chosen;
  pool2.sort((a, b) => {
    const ra = fitIdx(a.fit), rb = fitIdx(b.fit);
    if (ra !== rb) return ra - rb;                       // 1) 命中方式
    const pa = handPurity(a.e), pb = handPurity(b.e);
    if (pa !== pb) return pa - pb;                       // 2) 手别纯粹度
    const ta = new Set((a.e.weapon.list ?? []).map((x) => x.type)).size;
    const tb = new Set((b.e.weapon.list ?? []).map((x) => x.type)).size;
    return ta - tb || (a.e.codes.length - b.e.codes.length) || (a.m.index - b.m.index);
  });

  // 运行时：在"排序键完全相同"的头部候选里取变体（原版就是随机；跨客户端一致时走 seed）
  let win = pool2[0]!;
  if (q.random) {
    const keyOf = (c: (typeof pool2)[number]) => `${fitIdx(c.fit)}|`
      + `${new Set((c.e.weapon.list ?? []).map((x) => x.type)).size}|${c.e.codes.length}`;
    const k0 = keyOf(win);
    const tied = pool2.filter((c) => keyOf(c) === k0);
    if (tied.length > 1) {
      // 给了 seed → 确定性（调用方已把"实体 + 状态"混进 seed，见 anim-state-machine.variantSeed）
      win = q.seed !== undefined
        ? seededPick(tied, q.seed)!
        : tied[Math.floor(Math.random() * tied.length)]!;
    }
  }
  const types = new Set((win.e.weapon.list ?? []).map((x) => x.type)).size;
  const purity = handPurity(win.e);
  return {
    motion: win.m,
    entry: win.e,
    candidates: pool2.map((c) => ({ motion: c.m, entry: c.e, fit: c.fit, purity: handPurity(c.e) })),
    fallback,
    excluded: excludedCount,
    why: `候选 ${pool2.length} 条`
      + `｜选 ${win.e.clip}[${FIT_LABEL[win.fit]}/`
      + `纯${purity === 0 ? '手' : purity === 1 ? '混' : '—'}/${types}类/${win.e.codes.length}码]`
      + ` ${stanceText}`
      + (fallback ? '｜**无专属条目，已回退**' : '')
      + excludedNote(),
  };
}
