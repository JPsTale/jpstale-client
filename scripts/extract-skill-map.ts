/**
 * 技能表现映射提取（**来自源码，非命名猜测**）
 *
 * 依据：NewSourcePT-2023 `SrcGame/src/character.cpp` 的技能调度 —— 260 个
 * `case SKILL_PLAY_*:` 分支，内含 258 处 `SkillPlaySound(SKILL_SOUND_*)`
 * 与 46 处 `StartEffect(...)`，另有大量具名表现函数（如 `SkillArchMageFlameWave`）。
 *
 * 已确认的真实机制（`character.cpp:17133` SKILL_PLAY_FLAME_WAVE 为范例）：
 *   - 音效在**技能执行时**播放（不在结算帧），且常 `rand()%2` 在两个变体间随机
 *   - 伤害按 `MotionEvent == 1/2/3` **分段**发送（多段技能的实现方式）
 *   - 特效由**具名的 per-skill 函数**派发（`Skill*` / `StartEffect`），不是数据表
 *
 * 输出 `src/game/data/skill-code-map.json`：
 *   { skill, code: 'SKILL_PLAY_X', sounds: [wav 相对路径], presenters: [函数名] }
 *
 * 用法：npx tsx scripts/extract-skill-map.ts
 *   （需要 .refsrc/character.cpp；用 `scp` 从服务器取，见脚本末尾提示）
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { SKILLS } from '../src/game/skillData.js';

const SRC = resolve('.refsrc/character.cpp');
/** 表现函数的定义处：特效资产路径就写在它们体内（`MainWindow.LoadScript("Effect\\NewEffect\\X.lua")`）。
 *  且区分 SHOT_PROCESS（飞行中）与 SHOT_END（命中）—— 源码里就带时机语义。 */
const SRC_FX = resolve('.refsrc/HoNewEffectFunction.cpp');
const OUT = resolve('src/game/data/skill-code-map.json');
const SFX_TABLES = resolve('src/audio/data/sfx-tables.json');

if (!existsSync(SRC)) {
  console.error(`缺少 ${SRC}：请先取回源码\n  scp root@<server>:/data/PristonTale/src/NewSourcePT-2023/SrcGame/src/character.cpp .refsrc/`);
  process.exit(1);
}

const text = readFileSync(SRC, 'utf8');
const lines = text.split(/\r?\n/);

/* ─────────── SKILL_SOUND_* → wav 文件（已从 ex-machina effectsnd.cpp 提取） ─────────── */

const sfxTables = JSON.parse(readFileSync(SFX_TABLES, 'utf8')) as
  { skillSounds: Array<{ file: string; code: number | string; symbol: string }> };
const fileBySymbol = new Map<string, string>();
for (const s of sfxTables.skillSounds) fileBySymbol.set(s.symbol, s.file);

/* ─────────── 解析调度：case 标签 → 该 case 体内的音效/表现函数 ─────────── */

interface Entry { code: string; sounds: string[]; presenters: string[] }
const byCode = new Map<string, Entry>();
let pending: string[] = [];       // 自上次 break/return 以来见到的 case 标签
let guard = 0;

for (const raw of lines) {
  const line = raw.trim();

  const label = /^(?:case|default)\s+(SKILL_PLAY_\w+)\s*:/.exec(line);
  if (label) { pending.push(label[1]!); continue; }

  // case 体结束：把挂起的标签清掉。
  // **只认 break/return，不认 `}`** —— case 体内到处是 if 块的收尾 `}`，
  // 用它清空会把同一 case 后半段的调用全丢掉（曾因此漏掉 Divine Piercing 的音效）。
  if (/^(break|return)\b/.test(line)) { pending = []; continue; }
  if (!pending.length) continue;

  // SkillPlaySound(SKILL_SOUND_X ...)
  for (const m of line.matchAll(/SkillPlaySound\(\s*(SKILL_SOUND_\w+)/g)) {
    const sym = m[1]!;
    for (const code of pending) {
      const e = byCode.get(code) ?? { code, sounds: [], presenters: [] };
      const file = fileBySymbol.get(sym);
      const note = `${sym}${file ? '' : '(无文件映射)'}`;
      if (!e.sounds.includes(note)) e.sounds.push(note);
      byCode.set(code, e);
    }
  }
  // 具名表现函数（特效派发）：SkillXxx(...) / StartEffect(...)
  for (const m of line.matchAll(/\b(Skill[A-Z]\w*|StartEffect)\s*\(/g)) {
    const fn = m[1]!;
    if (fn.startsWith('SkillPlaySound')) continue;
    for (const code of pending) {
      const e = byCode.get(code) ?? { code, sounds: [], presenters: [] };
      if (!e.presenters.includes(fn)) e.presenters.push(fn);
      byCode.set(code, e);
    }
  }
  if (++guard > 400000) break;
}

/* ─────────── 表现函数 → 特效资产（调用图传递解析） ─────────── */

/**
 * 特效有**两套派发 API**，都要跟：
 *   (a) `MainWindow.LoadScript("Effect\\NewEffect\\X.lua")`  —— 路径字面量
 *   (b) `g_NewParticleMgr.Start("X")`                        —— 裸名（指向 .part）
 * 且 (b) 常被包在具名辅助函数里（如 `SkillSaintDivinePiercing → AssaParticle_ChainLance → Start("Skill3Hit3")`），
 * 所以要从表现函数出发做**传递解析**（限深度）。
 */
const FX_SRC_FILES = [
  'HoNewEffectFunction.cpp',   // 表现函数定义（LoadScript → Lua）
  'hoAssaParticleEffect.cpp',  // AssaParticle_* 家族（g_NewParticleMgr.Start → .part）
  'sinAssaParticle.cpp',
  'sinSkillEffect.cpp',        // sinEffect_* 技能特效
  'sinEffect.cpp',
  'SkillSub.cpp',
];

/** 函数名 → { 直接特效名, 调用的其它函数 } */
interface FnNode { effects: string[]; calls: string[] }
const callGraph = new Map<string, FnNode>();

for (const file of FX_SRC_FILES) {
  const p = resolve('.refsrc', file);
  if (!existsSync(p)) continue;
  let curFn: string | null = null;
  let depth = 0;
  let entered = false;   // 是否已进入函数体（本代码是 K&R 风格：`{` 在定义行的下一行）
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    const def = /^(?:void|int|bool|float|static\s+\w+)\s+(\w+)\s*\(/.exec(line);
    if (def && /^(Skill|AssaParticle|Skill3|sinEffect|SkillSub)/.test(def[1]!)) {
      curFn = def[1]!; depth = 0; entered = false;
      continue;   // 定义行本身不含花括号，若参与深度计算会把"函数体"立刻判为已结束
    }
    if (!curFn) continue;
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (depth > 0) entered = true;

    const node = callGraph.get(curFn) ?? { effects: [], calls: [] };
    // (a) LoadScript("Effect\...\X.lua")
    for (const m of line.matchAll(/"((?:Effect|effect)[^"]*?\.(lua|luac|ini|part))"/gi)) {
      const path = m[1]!.replace(/\\+/g, '/').toLowerCase();
      const base = path.slice(path.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '');
      const kind = m[2]!.toLowerCase() === 'part' ? 'part' : m[2]!.toLowerCase() === 'ini' ? 'ini' : 'lua';
      const tag = `${kind}:${base}`;
      if (!node.effects.includes(tag)) node.effects.push(tag);
    }
    // (b) g_NewParticleMgr.Start("X")  —— 裸名，家族稍后按资产表判定
    for (const m of line.matchAll(/g_NewParticleMgr\.Start\(\s*"([^"]+)"/g)) {
      const tag = `?:${m[1]!.toLowerCase()}`;
      if (!node.effects.includes(tag)) node.effects.push(tag);
    }
    // 嵌套调用的具名函数
    for (const m of line.matchAll(/\b((?:Skill|AssaParticle|sinEffect)\w*)\s*\(/g)) {
      const callee = m[1]!;
      if (callee !== curFn && !node.calls.includes(callee)) node.calls.push(callee);
    }
    callGraph.set(curFn, node);
    if (entered && depth <= 0) { curFn = null; entered = false; }
  }
}

/** 资产名 → 家族（用已生成的 effect-list.json 判定 `?:` 的家族） */
const familyByName = new Map<string, string>();
{
  const p = resolve('src/tools/inspector/data/effect-list.json');
  if (existsSync(p)) {
    for (const e of JSON.parse(readFileSync(p, 'utf8')) as Array<{ n: string; f: string }>) {
      if (!familyByName.has(e.n)) familyByName.set(e.n, e.f);
    }
  }
}

/** 从若干入口函数传递收集特效名（限深度，防环） */
function collectEffects(entries: string[], maxDepth = 3): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  let frontier = entries;
  for (let depth = 0; depth <= maxDepth && frontier.length; depth++) {
    const next: string[] = [];
    for (const fn of frontier) {
      if (seen.has(fn)) continue;
      seen.add(fn);
      const node = callGraph.get(fn);
      if (!node) continue;
      for (const e of node.effects) out.add(e);
      for (const c of node.calls) if (!seen.has(c)) next.push(c);
    }
    frontier = next;
  }
  // `?:name` 按资产表补上家族
  return [...out].map((t) => {
    if (!t.startsWith('?:')) return t;
    const n = t.slice(2);
    const fam = familyByName.get(n);
    return fam ? `${fam === 'part' ? 'part' : fam}:${n}` : `part:${n}`;
  });
}

/* ─────────── SKILL_PLAY_* → 我们的技能名（归一化匹配） ─────────── */

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

const skillByNorm = new Map<string, { classDir: string; name: string; icon: string }>();
for (const [classDir, list] of Object.entries(SKILLS)) {
  for (const s of list) {
    skillByNorm.set(norm(s.name), { classDir, name: s.name, icon: s.iconFile });
    if (s.alt) skillByNorm.set(norm(s.alt), { classDir, name: s.name, icon: s.iconFile });
  }
}

const rows = [...byCode.values()].map((e) => {
  const key = norm(e.code.replace(/^SKILL_PLAY_/, ''));
  const hit = skillByNorm.get(key) ?? null;
  // 该分支的表现函数各自带着自己的特效资产
  const effects = collectEffects(e.presenters);
  return {
    code: e.code,
    skill: hit?.name ?? null,
    classDir: hit?.classDir ?? null,
    sounds: e.sounds.map((s) => {
      const sym = s.replace(/\(无文件映射\)$/, '');
      return { symbol: sym, file: fileBySymbol.get(sym) ?? null };
    }),
    presenters: e.presenters,
    effects,
  };
});

mkdirSync(resolve('src/game/data'), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  note: '由 scripts/extract-skill-map.ts 从 NewSourcePT-2023 character.cpp 的技能调度提取'
    + '（case SKILL_PLAY_* 分支）。音效在技能执行时播放并常随机二选一；'
    + '伤害按 MotionEvent 计数分段发送；特效由具名 per-skill 函数派发。',
  rows,
}, null, 1) + '\n');

const soundTotal = rows.reduce((n, r) => n + r.sounds.length, 0);
const withFile = rows.reduce((n, r) => n + r.sounds.filter((s) => s.file).length, 0);
const mapped = rows.filter((r) => r.skill).length;
console.log(`case 分支 ${rows.length} 个：`);
console.log(`  能对上我们技能表 ${mapped}（${(100 * mapped / rows.length).toFixed(0)}%）`);
console.log(`  音效引用 ${soundTotal} 处，其中能解析到 wav 文件 ${withFile}（${(100 * withFile / soundTotal).toFixed(0)}%）`);
console.log(`  表现函数（特效派发）${rows.reduce((n, r) => n + r.presenters.length, 0)} 处，调用图节点 ${callGraph.size} 个`);
const fxRows = rows.filter((r) => r.effects.length).length;
const fxTotal = rows.reduce((n, r) => n + r.effects.length, 0);
console.log(`  能解析出特效的分支 ${fxRows}/${rows.length}，特效引用 ${fxTotal} 处`);
console.log(`写出 ${OUT}`);
