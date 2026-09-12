/**
 * 生成「技能图标 → 动画索引（skillCode）」映射，来源是 11 职业服务端的 `.in` 明文。
 *
 * 为什么需要：现有 `skillIndexByIcon.ts` 只覆盖到索引 198（源自 EU 技能树交叉），
 * 缺 m7 尾部 199~202 与 m8 整块 203~222 —— 导致技能面板出现大量"无专属动画"的**假象**。
 *
 * `.in` 的数据形状（已实测）：
 *   - 每个技能条目的 `*적용기술` 可列**多个空格分隔的技能名**（多技能共用一个动画）
 *   - 同一动画会按武器类**复制多份**（기술동작2a/2b/2c…），技能名相同
 *   - `.inx` 侧给出该条目的 skillCodeList（经 extract-anim-from-in 配对写入 inxSkillCodes）
 *   ⇒ 名字与代码是**集合对应**，不是逐位对应。
 *
 * 因此本脚本产出的是**提案**（带证据等级），不直接改 `skillIndexByIcon.ts`：
 *   src='/in-name'    该代码的 .in 名字与 skillData 名字（归一化后）匹配 → 证据强
 *   src='positional'  同职业内按 skillData 顺序对齐到该职业的连续代码块 → 中等证据
 *   src='none'        未定位（被动/无动画）
 * 同时打印每个职业的匹配率，供人工核对后再决定是否采纳。
 *
 * 用法：npx tsx scripts/extract-skill-index-from-in.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLASS_DIR, SKILLS } from '../src/game/skillData.js';

const IN_DIR = resolve('src/game/data/anim-in');
const OUT = resolve('src/game/data/anim-in/skill-index-map.generated.json');
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];

/** `.in` 里的职业名 → CLASS_DIR 的键。Rogue/Prayer 与 Pikeman/Priest 同组，视为同职业。 */
const CLASS_NAME_TO_DIR: Record<string, string> = {
  Fighter: 'fighter', Mechanician: 'mecha', Archer: 'archer', Pikeman: 'pikeman',
  Atalanta: 'atalanta', Knight: 'knight', Magician: 'magician',
  Priest: 'priestess', Prayer: 'priestess', Assassin: 'assassin',
  Shaman: 'shaman', MartialArtist: 'martial', Rogue: 'pikeman',
};

interface SkillEntry { name: string; codes: number[]; classes: string[]; frames: [number, number]; group: string }

/** 收集全部技能条目（名字已按空格拆分） */
const entries: SkillEntry[] = [];
for (const g of GROUPS) {
  const j = JSON.parse(readFileSync(resolve(IN_DIR, `anim-${g}.generated.json`), 'utf8')) as {
    entries: Array<{ skills: string[]; inxSkillCodes: number[]; classes: string[]; inxFrames: [number, number] }>;
  };
  for (const e of j.entries) {
    if (!e.skills.length || !e.inxSkillCodes.length) continue;
    for (const raw of e.skills) {
      for (const nm of raw.split(/\s+/).filter(Boolean)) {
        entries.push({ name: nm, codes: e.inxSkillCodes, classes: e.classes, frames: e.inxFrames, group: g });
      }
    }
  }
}

/** 归一化：去掉空格/连字符/下划线并大写，便于跨本地化比对名字 */
const norm = (s: string) => s.replace(/[\s_\-']/g, '').toUpperCase();

/** 职业 → 名字 → 代码集合 */
const byClass = new Map<string, Map<string, Set<number>>>();
for (const e of entries) {
  for (const cn of e.classes) {
    const dir = CLASS_NAME_TO_DIR[cn];
    if (!dir) continue;
    const m = byClass.get(dir) ?? new Map<string, Set<number>>();
    const set = m.get(e.name) ?? new Set<number>();
    for (const c of e.codes) set.add(c);
    m.set(e.name, set);
    byClass.set(dir, m);
  }
}

const report: string[] = [];
const out: Record<string, Array<{ iconFile: string; name: string; code: number | null; src: string; evidence?: string }>> = {};

for (const [idStr, dir] of Object.entries(CLASS_DIR)) {
  const id = Number(idStr);
  const skills = SKILLS[dir] ?? [];
  const nameMap = byClass.get(dir) ?? new Map<string, Set<number>>();

  // 该职业的代码块起点：名字能匹配上的代码里的最小值
  let blockStart: number | null = null;
  for (const sk of skills) {
    const hits = nameMap.get(norm(sk.name) === '' ? sk.name : sk.name);
    const match = [...nameMap.entries()].find(([nm]) => norm(nm) === norm(sk.name));
    if (match) for (const c of match[1]) blockStart = blockStart == null ? c : Math.min(blockStart, c);
    void hits;
  }
  // 名字匹配不上时兜底：该职业全部代码的最小值
  let minCode: number | null = null;
  for (const set of nameMap.values()) for (const c of set) minCode = minCode == null ? c : Math.min(minCode, c);
  const start = blockStart ?? minCode;

  let byName = 0;
  const rows: typeof out[string] = [];
  skills.forEach((sk, i) => {
    const match = [...nameMap.entries()].find(([nm]) => norm(nm) === norm(sk.name));
    if (match && match[1].size) {
      const code = Math.min(...match[1]);
      rows.push({ iconFile: sk.iconFile, name: sk.name, code, src: '/in-name', evidence: `名称匹配「${match[0]}」` });
      byName++;
      return;
    }
    if (sk.type === 'Passive') {
      rows.push({ iconFile: sk.iconFile, name: sk.name, code: null, src: 'none', evidence: '被动技能，无动画' });
      return;
    }
    if (start != null) {
      rows.push({ iconFile: sk.iconFile, name: sk.name, code: start + i, src: 'positional', evidence: `按块起点 ${start} 顺序推` });
      return;
    }
    rows.push({ iconFile: sk.iconFile, name: sk.name, code: null, src: 'none' });
  });
  out[dir] = rows;
  const pos = rows.filter((r) => r.src === 'positional').length;
  const non = rows.filter((r) => r.src === 'none').length;
  report.push(`${String(id).padStart(2)} ${dir.padEnd(10)} 技能 ${String(skills.length).padStart(2)}`
    + `（名称匹配 ${String(byName).padStart(2)} / 顺序推 ${String(pos).padStart(2)} / 未定 ${non}）`
    + `  代码范围 ${start ?? '-'}~`);
}

mkdirSync(IN_DIR, { recursive: true });
writeFileSync(OUT, JSON.stringify({
  note: '技能图标 → 动画索引(skillCode) 的**提案**，来源 11 职业服务端 .in 明文。'
    + 'src=/in-name 表示名称匹配（证据强）；positional 表示按同职业代码块顺序推（中等）；'
    + 'none 表示被动或无动画。人工核对后再决定是否覆盖 skillIndexByIcon.ts。生成物，勿手改。',
  evidenceLevels: { '/in-name': '强', positional: '中', none: '无' },
  classes: out,
}, null, 1) + '\n');

console.log('=== 各职业匹配情况 ===');
for (const r of report) console.log('  ' + r);
console.log(`\n写出 ${OUT}`);
