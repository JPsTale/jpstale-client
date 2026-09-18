/**
 * PT 粒子的**值类型**（定值 / 区间；向量 / 颜色）—— `.part` 与 Lua（NewEffect）**共用**。
 *
 * 从 `part-script.ts` 抽出来的唯一理由：两种源语的前端与共享时间轴层
 * （`pt-timeline.ts`）都要用同一套值类型，不能各定义一份（AGENTS #15）。
 */
/** 一个可取值：定值或区间（区间在**取值那一刻**掷一次） */
export type Num = { k: 'n'; v: number } | { k: 'r'; a: number; b: number };
export type Vec3 = { x: Num; y: Num; z: Num };
export type Rgba = { r: Num; g: Num; b: Num; a: Num };
