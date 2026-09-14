/**
 * 同屏怪物显示预算（**唯一实现**：WorldView 只喂候选 + 应用结果，不自己判）。
 *
 * 为什么需要（2026-09-14 实测数据）：纳维斯卡城一次 AOI 下发 222 只怪，客户端对**全部**
 * 222 只逐帧求值骨骼动画 = 16.6ms/帧（占一帧 JS 的 57%），帧时间 34.4ms ⇒ 约 28fps；
 * 而渲染侧其实早就被 three 的视锥剔除管着了（场景 518 个可见蒙皮网格，实际只提交 299 个
 * draw call）—— **"画不画"剔了，"算不算"没剔**。这里补的就是"算不算"。
 *
 * 四层，顺序刻意是**先稳后闪**（能稳定解决的，绝不靠轮换）：
 *  ① 数量预算 —— 先看 AOI 里到底有多少只：**少到没有性能压力时，一只都不裁**
 *                （用户 2026-09-14 反馈："怪本来数量就少的时候，不应该仅按距离来不显示"）
 *  ② 距离档   —— 只有在需要裁剪时才生效：玩家选的"最远显示距离"决定谁进轮换池
 *  ③ 保底     —— 名额里 60% 按距离固定（贴脸的怪永不因轮换消失）
 *  ④ 轮换     —— 剩下的名额每个时间片（默认 1s）从其余候选里重抽一批
 *               ⇒ 远处的怪不会有人"永远看不到"（用户 2026-09-14 的原话）。
 *
 * **距离与数量是两件事，不要混在一个档位里**（这是我第一版的错误）：
 *  - **距离** = 玩家的视野偏好（"我愿意看多远"）
 *  - **数量** = 自动的性能保护（"算得动多少只"）
 * 玩家把距离调到"近"却看到 900 外的怪，不是 bug —— 那是因为怪少、没有理由裁。
 *
 * 轮换**不保存任何状态**：挑选键 = `mix32(怪 id ⊕ 时间片)`，同一时间片内结果天然稳定
 * （不会每帧抖），跨时间片自动换一批 —— 纯函数，好测也好查（比"记一份随机名单"可靠）。
 *
 * 强制可见（`forced`）：鼠标选中/悬停的目标、正在攻击的目标、正在攻击我的怪、自机追踪目标。
 * **这一条是必需的，不是可选项** —— 自己在打一只 600 外的怪，档位一收紧它消失了，玩家会
 * 完全不知道发生了什么（连伤害飘字的锚点都找不到）。
 */
import { mix32 } from '../core/hash.js';
import type { DisplayRangeKey } from '../ui/display-prefs.js';

/** 一个候选：距离与"是否强制可见"由调用方算好（它才知道谁被选中、谁在打我） */
export interface VisibilityCandidate {
  id: number;
  /** 与自机的水平距离（世界单位） */
  dist: number;
  /** 强制可见：不参与距离与数量裁剪 */
  forced: boolean;
}

export interface VisibilityTier {
  key: DisplayRangeKey;
  /** 最远显示距离（世界单位）；Infinity = 不限 */
  range: number;
}

/**
 * 距离档 —— **只描述"愿意看多远"**，不再携带数量上限（数量由 capForCount 按实际怪数给）。
 * 顺序单调递增，UI 按 DISPLAY_RANGE_KEYS 的顺序呈现。
 */
export const VIS_TIERS: Record<DisplayRangeKey, VisibilityTier> = {
  near: { key: 'near', range: 400 },
  mid: { key: 'mid', range: 600 },
  far: { key: 'far', range: 800 },
  max: { key: 'max', range: Infinity },
};

/**
 * 数量预算：**按 AOI 里实际有多少只怪**自动给，玩家不需要（也不该）去调它。
 *
 * 分档依据是实测的单只成本 0.075ms（见文件头）：48 只 ≈ 3.3ms（60fps 舒适区），
 * 64 只 ≈ 4.8ms，56 只介于两者。**关键是第一档：≤64 只直接返回不限** ——
 * 没有性能压力时"按距离/数量裁剪"是纯粹的画质损失，一点好处都没有。
 *
 * 档位之间刻意做成**单调且相邻档不跳太多**（64→56→48）：阈值附近怪数上下浮动时，
 * 屏幕上最多只会少几只远处的怪，不会出现"忽多忽少"的观感。
 */
export function capForCount(count: number): number {
  if (count <= 64) return Infinity;
  if (count <= 128) return 64;
  if (count <= 256) return 56;
  return 48;
}

/**
 * 保底比例：名额里按距离**固定**的部分（近处稳定不闪），其余参与轮换。
 * 60% 是"近战怪永远在"与"远处能换到"之间的折中。
 */
const KEEP_RATIO = 0.6;

/** 轮换周期（ms）：同一周期内挑选结果稳定，跨周期换一批（用户要求"每隔 1 秒换一波"） */
export const ROTATE_PERIOD_MS = 1000;

export interface VisibilityResult {
  /** 可见的怪 id 集合；**null = 不限制**（关闭预算，全部可见） */
  visible: Set<number> | null;
  /** 被裁掉的只数（诊断用：profiler 面板要显示"隐藏了多少只"） */
  hidden: number;
  /** 当前距离档；null = 未启用 */
  tier: VisibilityTier | null;
  /** 本次实际生效的数量预算（`Infinity` = 没裁）；诊断用，不要拿它当"玩家设置" */
  cap: number;
  /** 是否发生了裁剪（区别于"没裁"）—— 只有裁剪过的那些才会轮换 */
  capped: boolean;
}

/** 时间片编号（轮换的时间粒度） */
export function visEpoch(nowMs: number): number {
  return Math.floor(nowMs / ROTATE_PERIOD_MS);
}

/** 挑选键：同一 (id, epoch) → 同一数值；不同 epoch 打散重排 */
function rotationKey(id: number, epoch: number): number {
  return mix32((id ^ Math.imul(epoch, 0x9E3779B1)) >>> 0);
}

/**
 * 选出这一时间片要显示的怪。
 *
 * @param cands  所有候选（含强制可见的）
 * @param opts.enabled false → 返回 `visible: null`（调用方恢复"全部可见"）
 * @param opts.tier  距离档（见 VIS_TIERS）—— 只在需要裁剪时才参与
 * @param opts.nowMs 当前时刻（毫秒）；用于时间片
 */
export function pickVisibleMonsters(
  cands: VisibilityCandidate[],
  opts: { enabled: boolean; tier: VisibilityTier; nowMs: number },
): VisibilityResult {
  if (!opts.enabled) {
    return { visible: null, hidden: 0, tier: null, cap: Infinity, capped: false };
  }
  const { range } = opts.tier;
  const cap = capForCount(cands.length);
  const epoch = visEpoch(opts.nowMs);

  const visible = new Set<number>();
  for (const c of cands) if (c.forced) visible.add(c.id);

  // ① 怪不多 → 一只都不裁：**距离档在这里不生效**（用户 2026-09-14 反馈"怪少时不该仅按距离不显示"）。
  //    没有性能压力时的任何裁剪都只是白丢画质。
  if (cands.length <= cap) {
    for (const c of cands) visible.add(c.id);
    return { visible, hidden: 0, tier: opts.tier, cap, capped: false };
  }

  // ② 需要裁了：先按玩家的距离档选进池子（丢掉远处一片，稳定不闪）
  const pool: VisibilityCandidate[] = [];
  for (const c of cands) {
    if (c.forced) continue;
    if (c.dist <= range) pool.push(c);
  }

  const budget = cap - visible.size; // 强制可见的已经占了名额
  if (pool.length <= budget) {
    // 距离档砍完就装得下了：全部显示，不发生轮换（这是常态，也是"不闪"的保证）
    for (const c of pool) visible.add(c.id);
    return { visible, hidden: cands.length - visible.size, tier: opts.tier, cap, capped: false };
  }

  if (budget <= 0) {
    // 名额已被强制可见的占满：其余一个都不显示
    return { visible, hidden: cands.length - visible.size, tier: opts.tier, cap, capped: true };
  }

  // ③ 保底：按距离由近到远取 KEEP 只（近处稳定，玩家在打的怪一定在）
  pool.sort((a, b) => a.dist - b.dist);
  const keep = Math.min(pool.length, Math.max(0, Math.floor(budget * KEEP_RATIO)));
  for (let i = 0; i < keep; i++) visible.add(pool[i]!.id);

  // ④ 轮换：余下名额从"剩下的候选"里按 (id, epoch) 取
  const rest = pool.slice(keep);
  rest.sort((a, b) => rotationKey(a.id, epoch) - rotationKey(b.id, epoch));
  const rotateCount = Math.min(rest.length, budget - keep);
  for (let i = 0; i < rotateCount; i++) visible.add(rest[i]!.id);

  return {
    visible,
    hidden: cands.length - visible.size,
    tier: opts.tier,
    cap,
    capped: true,
  };
}
