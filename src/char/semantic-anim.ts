/**
 * 语义动画描述的运行时入口。
 *
 * 语义条目（sidecar）是"取代运行时 .inx 解析"的那份数据；本模块只负责
 * **按 jobId 取到对应的条目**，匹配逻辑一律走 `anim-match.pickSemanticMotion`（唯一实现）。
 *
 * 覆盖范围：玩家 8 个动作组（m1~m8，实测 animSet 与模型 1:1）。
 * 怪物/NPC 尚未迁移 → 返回空数组，调用方回退旧的 idcode/类型匹配路径。
 */
import { JOB_DATA } from '../render/char-loader.js';
import type { SemanticEntry } from './anim-match.js';
import m1 from '../game/data/semantic/m1.json';
import m2 from '../game/data/semantic/m2.json';
import m3 from '../game/data/semantic/m3.json';
import m4 from '../game/data/semantic/m4.json';
import m5 from '../game/data/semantic/m5.json';
import m6 from '../game/data/semantic/m6.json';
import m7 from '../game/data/semantic/m7.json';
import m8 from '../game/data/semantic/m8.json';

const BY_GROUP: Record<string, SemanticEntry[]> = {
  m1: (m1 as unknown as { animations: SemanticEntry[] }).animations,
  m2: (m2 as unknown as { animations: SemanticEntry[] }).animations,
  m3: (m3 as unknown as { animations: SemanticEntry[] }).animations,
  m4: (m4 as unknown as { animations: SemanticEntry[] }).animations,
  m5: (m5 as unknown as { animations: SemanticEntry[] }).animations,
  m6: (m6 as unknown as { animations: SemanticEntry[] }).animations,
  m7: (m7 as unknown as { animations: SemanticEntry[] }).animations,
  m8: (m8 as unknown as { animations: SemanticEntry[] }).animations,
};

/** jobId → 动作组（由 JOB_DATA 的 bipInx 推出，如 char/tmabcd/m8bip.inx → m8） */
const GROUP_BY_JOB: Record<number, string> = {};
for (const [id, job] of Object.entries(JOB_DATA)) {
  const mt = /(m\d+)bip\.inx$/i.exec(job.bipInx);
  if (mt) GROUP_BY_JOB[Number(id)] = mt[1]!.toLowerCase();
}

/** 该职业的语义条目；无（怪物/NPC 或未迁移的职业）返回空数组 */
export function semanticEntriesForJob(jobId: number): SemanticEntry[] {
  const g = GROUP_BY_JOB[jobId];
  return g ? (BY_GROUP[g] ?? []) : [];
}
