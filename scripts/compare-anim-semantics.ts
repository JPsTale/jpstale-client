/**
 * 语义化数据 vs 原版直出 —— 一致性对比
 *
 * 两条路径选同一个动作时，播放是确定性的（同一 motion 条目 + 同一帧范围 → 逐帧相同），
 * 所以"两种播放能力是否一致"等价于"两条路径的选择结果集是否一致"。
 *
 *   路径 A（现有能力 jpstale-client）：buildMotionList + findMotions/findMotionsByType
 *     —— 依赖 .inx 的 itemCodeList(sItem 索引) 与 dwJobCodeBit
 *   路径 B（纯结构化数据）：读 anim-<group>.generated.json
 *     —— 只用语义字段（武器 type/hand、职业名、状态）
 *
 * 用法：npx tsx scripts/compare-anim-semantics.ts
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { buildMotionList } from '../src/render/monster-loader.js';
import { findMotions, findMotionsByType } from '../src/char/anim-match.js';
import { getWeaponTypeFromIdCode, getHandType } from '../src/char/weapon-type.js';
import { ITEM_DEFS } from '../src/game/data/itemDefs.js';
import { CLASS_FLAG, motionStateName } from '../src/char/char-format.js';

const ASSET = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const ab = (p: string) => { const b = readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

/** 职业 id → 职业名（与 client 的 classIdToFlag 保持一致） */
const JOB_NAME: Record<number, string> = {
  1: 'Fighter', 2: 'Mechanician', 3: 'Archer', 4: 'Pikeman', 5: 'Atalanta',
  6: 'Knight', 7: 'Magician', 8: 'Priestess', 9: 'Assassin', 10: 'Shaman',
};
const GROUP: Array<[string, number[]]> = [
  ['m1', [1, 2, 6]], ['m2', [3, 5]], ['m3', [7]], ['m4', [4]],
  ['m5', [8]], ['m6', [9]], ['m7', [10]], ['m8', []],
];
const FAMILIES = [0x0040, 0x0050, 0x0060, 0x0100, 0x0110, 0x0120];

/** 测试用武器组合：每个 (type,hand) 取一个代表 + 空手 */
const WEAPONS: Array<{ label: string; idcode: number }> = [{ label: '空手', idcode: 0 }];
{
  const seen = new Set<string>();
  for (const w of ITEM_DEFS) {
    if (w.folder !== 'weapon') continue;
    const t = getWeaponTypeFromIdCode(w.code); if (!t) continue;
    const k = `${t}_${getHandType(w.class)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    WEAPONS.push({ label: k, idcode: w.code });
  }
}

interface Entry {
  id: string; state: string; frames: [number, number]; repeat: boolean;
  eventFrames: number[]; classes: string[];
  weapon: { any: boolean; unarmed: boolean; list: Array<{ type: string; hand: string }> };
  skills: string[]; location: string;
  raw: { index: number; itemCodes: number[]; skillCodes: number[]; motionFrame: number };
}

let identical = 0, onlyA = 0, onlyB = 0, bothEmpty = 0;
const diffs: string[] = [];

for (const [grp, jobs] of GROUP) {
  if (!jobs.length) continue;
  let structEntries: Entry[];
  try {
    structEntries = (JSON.parse(readFileSync(resolve(`src/game/data/anim/anim-${grp}.generated.json`), 'utf8')) as { entries: Entry[] }).entries;
  } catch { continue; }
  const bip = parseInx(ab(`${ASSET}/char/tmabcd/${grp}bip.inx`));
  const smb = parseSmb(ab(`${ASSET}/char/tmabcd/${grp}.smb`));
  const motions = buildMotionList(smb, bip);

  for (const job of jobs) {
    const name = JOB_NAME[job]!;
    for (const w of WEAPONS) {
      const wType = w.idcode ? getWeaponTypeFromIdCode(w.idcode) : null;
      const wHand = w.idcode ? getHandType(ITEM_DEFS.find((d) => d.code === w.idcode)?.class ?? 0) : '?';
      for (const state of FAMILIES) {
        // 路径 A
        const exact = findMotions(motions, state, w.idcode || null, job, 3);
        const byType = exact.length ? [] : findMotionsByType(motions, state, wType, job, 3);
        const setA = new Set([...exact, ...byType].map((m) => m.index));
        // 路径 B：只用语义字段
        const setB = new Set<number>();
        for (const e of structEntries) {
          if (e.state !== motionStateName(state)) continue;
          if (!(e.classes.includes('ALL') || e.classes.includes(name))) continue;
          const okWeapon = e.weapon.any
            || (!w.idcode ? e.weapon.unarmed : e.weapon.list.some((x) => x.type === wType && x.hand === wHand));
          if (!okWeapon) continue;
          setB.add(e.raw.index);
        }
        const same = setA.size === setB.size && [...setA].every((x) => setB.has(x));
        if (same && setA.size > 0) identical++;
        else if (same && setA.size === 0) bothEmpty++;
        else if (setA.size > 0 && setB.size === 0) { onlyA++; diffs.push(`${grp} job${job}(${name}) ${w.label} ${motionStateName(state)}: A有${setA.size} B空`); }
        else if (setA.size === 0 && setB.size > 0) { onlyB++; diffs.push(`${grp} job${job}(${name}) ${w.label} ${motionStateName(state)}: A空 B有${setB.size}`); }
        else { diffs.push(`${grp} job${job}(${name}) ${w.label} ${motionStateName(state)}: A[${[...setA].join(',')}] ≠ B[${[...setB].join(',')}]`); onlyA++; }
      }
    }
  }
}

console.log(`组合总数 ${identical + onlyA + onlyB + bothEmpty}（武器组合 ${WEAPONS.length} 个 × 状态族 ${FAMILIES.length} × 职业）`);
console.log(`  两边一致且有结果：${identical}`);
console.log(`  两边都为空      ：${bothEmpty}（例如该职业本就没有此状态）`);
console.log(`  仅路径A有 / 不一致：${onlyA}`);
console.log(`  仅路径B有        ：${onlyB}`);
if (diffs.length) {
  console.log(`\n差异明细（前 20 条）：`);
  for (const d of diffs.slice(0, 20)) console.log('  ' + d);
}

/* ─────────── 并排展示：原版直出字段 vs 语义字段 ─────────── */
console.log('\n=== 原版直出 vs 语义字段（m1 前 4 条 ATTACK）===');
const m1 = (JSON.parse(readFileSync(resolve('src/game/data/anim/anim-m1.generated.json'), 'utf8')) as { entries: Entry[] }).entries;
const bip1 = parseInx(ab(`${ASSET}/char/tmabcd/m1bip.inx`));
const smb1 = parseSmb(ab(`${ASSET}/char/tmabcd/m1.smb`));
const motions1 = buildMotionList(smb1, bip1);
for (const e of m1.filter((x) => x.state === 'ATTACK').slice(0, 4)) {
  const m = motions1.find((x) => x.index === e.raw.index);
  console.log(`\n  ${e.id}`);
  console.log(`    原版: itemCodeCount=${m?.itemCodeCount} 前8码=[${(m ? Array.from(m.itemCodeList).slice(0, 8) : []).join(',')}] jobBit=0x${(m?.dwJobCodeBit ?? 0).toString(16)} mapPos=${m?.mapPosition} 帧=[${m?.startFrame},${m?.endFrame}] ev=[${Array.from(m?.eventFrame ?? []).join(',')}]`);
  console.log(`    语义: 武器=[${e.weapon.any ? '任意' : (e.weapon.unarmed ? '空手' : '') + e.weapon.list.map((w) => `${w.hand}-${w.type}`).join(',')}] 职业=[${e.classes.join('/')}] 位置=${e.location} 帧=[${e.frames}] ev=[${e.eventFrames}]`);
}
void CLASS_FLAG;
