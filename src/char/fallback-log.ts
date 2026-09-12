/**
 * 降级（fallback）上报通道 —— **唯一出口，杜绝静默兜底**。
 *
 * 设计原则（用户 2026-09-12 指出）：
 *   兜底本身不一定错，**静默**才是错的。静默回退把"数据缺失/未实现"伪装成"正常运行"，
 *   于是看到的现象无法判断是真还是编的（例：技能无专属动画时随机播一条技能动画，
 *   看起来完全正常）。用户的判断依据被污染，比直接报错更糟。
 *
 * 因此约定：
 *   1. 任何"退而求其次"的选择都必须调 `reportFallback()`，写明**为什么降级**。
 *   2. 能带 provenance 的（如 sheathe 的 `src` 字段）就把来源写进数据，那是更好的"显式"。
 *   3. 降级事件要能**被看见**：控制台 warn + 检查器界面 + 走查导出。
 *   4. **禁止"编造数据"式兜底**（随机动画、随机索引…）——宁可什么都不播并报错。
 */
export interface FallbackEvent {
  /** 分类：'skill' | 'anim' | 'mount' | 'head' | 'skin' | … */
  kind: string;
  /** 人类可读的原因（要能回答"为什么降级"） */
  detail: string;
  /** 发生次数（同 kind+detail 合并计数，避免刷屏） */
  count: number;
}

const events = new Map<string, FallbackEvent>();

/**
 * 上报一次降级。同 kind+detail 会累加计数。
 *
 * 控制台留痕**按对数刻度打印**：首次必打，之后只在 10 / 100 / 1000… 次时补一条（带累计次数）。
 * 原因是有些降级在正常游玩里高频发生（例：怪物/NPC 没有 semantic sidecar，
 * 每次状态切换都走"回退旧 idcode 匹配链"），逐条打印会把控制台淹掉、
 * 反而看不见真正稀有的那几条 —— 精确次数随时可用 `fallbacks()` / 检查器面板查。
 */
export function reportFallback(kind: string, detail: string): void {
  const key = `${kind}\u0000${detail}`;
  const hit = events.get(key);
  const count = hit ? ++hit.count : 1;
  if (!hit) events.set(key, { kind, detail, count: 1 });
  if (count === 1 || isLogScale(count)) {
    console.warn(`[fallback] ${kind}: ${detail}` + (count === 1 ? '' : `　（累计 ${count} 次）`));
  }
}

/** 10 的整数次幂（10、100、1000…）——控制台打印的采样点 */
function isLogScale(n: number): boolean {
  if (n < 10) return false;
  const p = Math.log10(n);
  return Math.abs(p - Math.round(p)) < 1e-9;
}

/** 当前累计的降级事件（按次数降序） */
export function fallbacks(): FallbackEvent[] {
  return [...events.values()].sort((a, b) => b.count - a.count);
}

export function clearFallbacks(): void {
  events.clear();
}

/** 单行摘要，供日志/导出用 */
export function fallbackSummary(): string {
  const list = fallbacks();
  if (!list.length) return '无降级';
  return list.map((e) => `${e.kind}×${e.count}(${e.detail})`).join('；');
}
