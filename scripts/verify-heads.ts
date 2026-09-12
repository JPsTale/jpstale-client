/**
 * 头部（脸 × 职业档位）可解性核对。守住两处已踩过的坑：
 *   ① **档位数**：头部 `.inx` 后缀为 `''`,`a`,`b`,`c`,`d` 共 **5 档**；
 *      曾只到 3（4 档）→ 缺第 5 档（用户实测）。
 *   ② **命名分隔符**：`-` 与 `_` 两种都有人用且**逐家族逐脸不一致**
 *      （下划线式的 104 个文件全部是后缀 `b`）；曾把下划线错当成"tier2 专属"，
 *      对只有 `-b` 的家族拼出不存在的路径 → 404 → `Offset is outside the bounds of the DataView`（用户实测）。
 * 口径：`getHeadInxCandidates()` 的候选链里**至少有一个**在资产里存在即为可解。
 * 用法：npx tsx scripts/verify-heads.ts   （PT_ASSET_ROOT 可覆盖资产根，默认 E:/JPsTale/client）
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { JOB_DATA, FACE_RANGE, TIER_RANGE, getHeadInxCandidates } from '../src/render/char-loader.js';

const ROOT = process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client';
const exists = (p: string): boolean => existsSync(resolve(ROOT, p)) || existsSync(resolve(ROOT, p.toLowerCase()));

let fail = 0;
const missing: string[] = [];
console.log(`资产根: ${ROOT}`);
console.log(`档位 ${TIER_RANGE.min}..${TIER_RANGE.max}（后缀 '',a,b,c,d）  脸 ${FACE_RANGE.min}..${FACE_RANGE.max}`);
console.log('职业\t档位 → 缺失的 (档,脸) 数\t首个缺失样本');
for (const jobId of Object.keys(JOB_DATA).map(Number).sort((a, b) => a - b)) {
  const perTier: string[] = [];
  for (let tier = TIER_RANGE.min; tier <= TIER_RANGE.max; tier++) {
    let miss = 0; let sample = '';
    for (let face = FACE_RANGE.min; face <= FACE_RANGE.max; face++) {
      const cands = getHeadInxCandidates(jobId, face, tier);
      if (!cands.some(exists)) { miss++; if (!sample) sample = `脸${face}`; }
    }
    perTier.push(`t${tier}:${miss}${sample ? `(${sample})` : ''}`);
    if (miss === FACE_RANGE.max - FACE_RANGE.min + 1) missing.push(`job${jobId} tier${tier} 整档缺失`);
  }
  console.log(`  ${jobId}\t${perTier.join('  ')}`);
}
fail += missing.length;
for (const m of missing) console.log('  ✗ ' + m);
console.log(fail ? `\n${fail} 项失败` : '\n完成（上表每档缺失数均为 0 即全解）');
