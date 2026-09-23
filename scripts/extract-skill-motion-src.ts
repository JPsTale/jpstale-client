/**
 * **技能 → 原版"用哪条动作 + 音从哪来"** 生成器（`npm run skill-motion-src`）。
 *
 * 为什么需要：2026-09-23 用户报"武士技能没音效、枪兵/祭司有"。对差实测（`report-skill-sfx-matrix`）
 * 指向一根**我们没实现的轴**：原版在 **SKILL 态的事件帧**也会播**武器挥击音**，而我们的客户端
 * 只在 ATTACK 态播。武士最早的三招（Raving / Impact / Triple Impact）在原版里恰好**全靠这条路径**，
 * 枪兵的 Pike Wind、祭司的 Healing 则有专属 wav ⇒ 听感上"按职业有别"。
 *
 * 取证源（**唯一输入口径**，逐字两处，缺一不可）：
 *   · `.refsrc/SkillSub.cpp`       —— 客户端**起手**：每个 `case SKILL_*:` 里调
 *     `SetMotionFromCode(CHRMOTION_STATE_ATTACK | CHRMOTION_STATE_SKILL)`
 *     ⇒ 这一招用**普攻动作**还是**技能动作**（Triple Impact 按技能等级二选一 ⇒ `mixed`）。
 *   · `.refsrc/character.cpp`      —— `smCHAR::EventSkill()`（技能事件帧分派）：
 *     `SkillPlaySound(SKILL_SOUND_*)` = 专属技能音；`return FALSE` = **落回**
 *     `EventAttack` 的通用分支（`character.cpp:4244` `WeaponPlaySound(this)`）= **武器挥击音**。
 *     （`EventSkill` 末尾 `return TRUE` ⇒ `break` 的那些 case 不落回。）
 *   · `src/audio/data/sfx-tables.json` —— `SKILL_SOUND_*` → wav 相对路径。
 *
 * ⚠ **两份源的行号只对下面记的 md5 成立**（`.refsrc` 与 `E:/repo/NewSourcePT-2023` 逐字节相同）：
 *   `character.cpp` 9f516cc3958eaec248c814a76f4f1f8b · `SkillSub.cpp` 468de9f003858c24160d4ab2897de420
 *
 * 输出 `src/game/data/skill-motion-src.generated.json`（运行时读它，见 `game/skillMotionSrc.ts`）。
 * 用法：`npx tsx scripts/extract-skill-motion-src.ts [--json]`
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { SKILLS, CLASS_DIR } from '../src/game/skillData.js';
import { scanSwitchCases } from './openplay-scan.js';

const ROOT = resolve('.');
const CHAR_SRC = resolve(process.env.PT_SKILL_SRC ?? resolve(ROOT, '.refsrc/character.cpp'));
const SUB_SRC = resolve(process.env.PT_SKILLSUB_SRC ?? resolve(ROOT, '.refsrc/SkillSub.cpp'));
const SFX_TABLES = resolve(ROOT, 'src/audio/data/sfx-tables.json');
const OUT = resolve(ROOT, 'src/game/data/skill-motion-src.generated.json');
/** 期望的源文件指纹（行号/结论都绑在这上面）——不符就**拒绝生成**（别拿别的检出当依据） */
const EXPECT = {
  'character.cpp': '9f516cc3958eaec248c814a76f4f1f8b',
  'SkillSub.cpp': '468de9f003858c24160d4ab2897de420',
};

for (const p of [CHAR_SRC, SUB_SRC]) {
  if (!existsSync(p)) {
    console.error(`✗ 缺少 ${p}\n  .refsrc/ 是 gitignore 的参考源目录；取回方式见 AGENTS「参考资料源」。`);
    process.exit(1);
  }
}
const md5 = (p: string) => createHash('md5').update(readFileSync(p)).digest('hex');
for (const [name, want] of Object.entries(EXPECT)) {
  const p = name === 'character.cpp' ? CHAR_SRC : SUB_SRC;
  const got = md5(p);
  if (got !== want) {
    console.error(`✗ ${p} 指纹不符：期望 ${want}，实得 ${got}\n  行号结论绑在期望那份上；换源请连同本文件一起复核。`);
    process.exit(1);
  }
}
/** latin1：源是 EUC-KR/CJK 混编码，utf8 解会抛错；ASCII（宏名/表达式）不受影响 */
const charLines = readFileSync(CHAR_SRC, 'latin1').split(/\r?\n/);
const subLines = readFileSync(SUB_SRC, 'latin1').split(/\r?\n/);
const sfxTables = JSON.parse(readFileSync(SFX_TABLES, 'utf8')) as {
  skillSounds: Array<{ file: string; symbol: string }>;
};
const fileBySymbol = new Map(sfxTables.skillSounds.map((s) => [s.symbol, s.file]));

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/* ─────────── ① SkillSub.cpp：这一招用哪条动作 ─────────── */

export type MotionSrc = 'attack' | 'skill' | 'mixed';

/**
 * 抠出某个函数里那个 switch 的**每个 case 的正文行**。
 *
 * case 标签的定位**复用** `scripts/openplay-scan.ts` 的 `scanSwitchCases`（AGENTS #15：那份扫描器
 * 已服务 `extract-openplay-skills` / `verify-mouse-cast` / `report-skill-motion-speed`，不复制第二份）；
 * 本函数只做它没做的那件事 —— 把"相邻两个 case 标签之间"的行当作前一个 case 的正文，
 * 并把**连续的空标签**（fall-through，如 `case SKILL_RAVING: case SKILL_PLAY_IMPACT:`）合并到
 * 后面那个有正文的 case 上。
 */
function caseBodies(text: string, funcPattern: RegExp, funcName: string, switchPattern: RegExp): Map<string, { body: string[]; line: number }> {
  const scan = scanSwitchCases(text, funcPattern, funcName, switchPattern);
  const lines = text.split(/\r?\n/);
  const labels = [...scan.cases, ...scan.nestedCases].sort((a, b) => a.line - b.line);
  const out = new Map<string, { body: string[]; line: number }>();
  const pending: Array<{ macro: string; line: number }> = [];
  for (let i = 0; i < labels.length; i++) {
    const at = labels[i]!;
    const next = labels[i + 1]?.line ?? scan.switchEndLine;
    const body = lines.slice(at.line, next - 1);
    // "空标签" = 正文里没有任何可执行语句（只有空行/注释）
    const hasCode = body.some((l) => l.trim() !== '' && !/^\/[/*]/.test(l.trim()));
    pending.push({ macro: at.macro, line: at.line });
    if (!hasCode) continue;
    for (const p of pending) out.set(p.macro, { body, line: p.line });
    pending.length = 0;
  }
  return out;
}

/** `.refsrc/SkillSub.cpp` 两个入口都要扫：右手（`OpenPlaySkill`）与左拳/追打（`PlaySkillAttack`） */
const subBodies = new Map<string, { body: string[]; line: number }>();
for (const [fn, pat, sw] of [
  ['OpenPlaySkill', /^\s*int\s+OpenPlaySkill\s*\(/, /switch\s*\(\s*lpSkill->Skill_Info\.CODE\s*\)/],
  ['PlaySkillAttack', /^\s*int\s+PlaySkillAttack\s*\(/, /switch\s*\(\s*lpSkill->CODE\s*\)/],
] as const) {
  for (const [macro, v] of caseBodies(readFileSync(SUB_SRC, 'latin1'), pat, fn, sw)) subBodies.set(macro, v);
}

interface SubRec { motions: Set<string>; retry: boolean; lines: number[] }
const subBySkill = new Map<string, SubRec>();
for (const [macro, v] of subBodies) {
  for (let i = 0; i < v.body.length; i++) {
    const t = v.body[i]!;
    const m = /SetMotionFromCode\(\s*CHRMOTION_STATE_(ATTACK|SKILL)\b/.exec(t);
    // `RetryPlayAttack(...)` = `PlayAttackFromPosi(..., NormalAttackRange, NormalAttackMode)`
    // （`SkillSub.cpp:1491-1498`）⇒ **起一次普通攻击**，那就是"用普攻动作"
    // （`Critical Hit` 只有它、没有 SetMotionFromCode ⇒ 它的动作就是普攻动作）
    const isRetry = /RetryPlayAttack\s*\(/.test(t);
    if (!m && !isRetry) continue;
    const r = subBySkill.get(macro) ?? { motions: new Set<string>(), retry: false, lines: [] };
    if (m) r.motions.add(m[1]!.toLowerCase());
    if (isRetry) r.retry = true;
    r.lines.push(v.line + i);
    subBySkill.set(macro, r);
  }
}

/* ─────────── ② character.cpp：EventSkill 的音从哪来 ─────────── */

interface EvRec { sounds: string[]; weapon: boolean; weaponDirect: number | null; returnsFalse: boolean; lines: number[] }
const evByCode = new Map<string, EvRec>();
{
  const text = readFileSync(CHAR_SRC, 'latin1');
  const bodies = caseBodies(text, /^int\s+smCHAR::EventSkill\s*\(/, 'smCHAR::EventSkill',
    /switch\s*\(\s*AttackSkil\s*&\s*0xFF\s*\)/);
  for (const [macro, v] of bodies) {
    if (!macro.startsWith('SKILL_PLAY_')) continue;
    const r: EvRec = { sounds: [], weapon: false, weaponDirect: null, returnsFalse: false, lines: [] };
    for (let i = 0; i < v.body.length; i++) {
      const t = v.body[i]!;
      const ln = v.line + i;
      const sm = /SkillPlaySound\(\s*(SKILL_SOUND_\w+)/.exec(t);
      if (sm && !r.sounds.includes(sm[1]!)) { r.sounds.push(sm[1]!); r.lines.push(ln); }
      if (/WeaponPlaySound\s*\(/.test(t)) { r.weapon = true; r.lines.push(ln); }
      const wd = /PlayWaponSoundDirect\([^,]*,[^,]*,[^,]*,\s*(\d+)/.exec(t);
      if (wd) { r.weapon = true; r.weaponDirect = Number(wd[1]); r.lines.push(ln); }
      if (/^\s*return FALSE\b/.test(t)) { r.returnsFalse = true; r.lines.push(ln); }
    }
    evByCode.set(macro, r);
  }
}

/* ─────────── ③ 对到我们的技能（图标为键，与运行时同一套） ─────────── */

const byNorm = new Map<string, { classDir: string; icon: string }>();
for (const [classDir, list] of Object.entries(SKILLS)) {
  for (const s of list) {
    byNorm.set(norm(s.name), { classDir, icon: s.iconFile });
    if (s.alt) byNorm.set(norm(s.alt), { classDir, icon: s.iconFile });
  }
}
/** 两边都归一化后再比：`SKILL_TRIPLE_IMPACT` 与我们的 `Triple Impact` 只差下划线/空格。
 *  SkillSub 的 case 名带 `SKILL_` 前缀 ⇒ 去掉后与我们的技能名同形。 */
const normMap = <T>(m: Map<string, T>, strip = ''): Map<string, T> =>
  new Map([...m.entries()].map(([k, v]) => [strip ? norm(k).replace(strip, '') : norm(k), v]));

const jobOf = new Map(Object.entries(CLASS_DIR).map(([job, dir]) => [dir, Number(job)]));
const subNorm = normMap(subBySkill, 'skill');
const evNorm = normMap(evByCode);
const rows: Array<Record<string, unknown>> = [];
let matchedMotion = 0, matchedSound = 0;
for (const [classDir, list] of Object.entries(SKILLS)) {
  const job = jobOf.get(classDir)!;
  for (const s of list) {
    // 名字只作**枚举常量名**：`SKILL_RAVING` ↔ 我们的 `Raving`（归一化后相等），两边都不带职业前缀
    const altKey = s.alt ? norm(s.alt) : '';
    const subHit = subNorm.get(norm(s.name))
      ?? (altKey ? subNorm.get(altKey) : undefined);
    const evHit = evNorm.get(`skillplay${norm(s.name)}`)
      ?? (altKey ? evNorm.get(`skillplay${altKey}`) : undefined);

    // 动作：显式 `SetMotionFromCode(SKILL)` 优先（它写在 RetryPlayAttack 之后，会盖掉普攻）；
    // 只有普攻那一路（ATTACK / RetryPlayAttack）⇒ 'attack'；两者都有 ⇒ 'mixed'（按技能等级二选一）
    const mset = subHit?.motions;
    const motionSrc: MotionSrc | null = !subHit ? null
      : mset?.has('skill') && (mset.has('attack') || subHit.retry) ? 'mixed'
        : mset?.has('skill') ? 'skill'
          : (mset?.has('attack') || subHit.retry) ? 'attack' : null;
    const sounds = (evHit?.sounds ?? []).map((sym) => ({ symbol: sym, file: fileBySymbol.get(sym) ?? null }));
    // `eventSfx` = **事件帧那一层**的音从哪来（不含"起手音"，起手音在 skill-fx.json 的 cast）
    const eventSfx: 'skill' | 'weapon' | 'none' | null = !evHit ? null
      : sounds.length ? 'skill' : ((evHit.weapon || evHit.returnsFalse) ? 'weapon' : 'none');
    if (motionSrc) matchedMotion++;
    if (eventSfx) matchedSound++;
    rows.push({
      job, classDir, icon: s.iconFile, name: s.name,
      /** 这一招原版用哪条动作：`attack`=普攻动作（`SetMotionFromCode(ATTACK)` / `RetryPlayAttack`）、
       *  `skill`=技能动作（`SetMotionFromCode(SKILL)`）、`mixed`=**按技能等级二选一**、`null`=源里没有这一招 */
      motionSrc,
      motionLines: subHit?.lines ?? [],
      motionRetryPlayAttack: subHit?.retry ?? false,
      eventSfx,
      sounds,
      /** 事件帧要播**武器挥击音**（`WeaponPlaySound(this)` / `return FALSE` 落回通用分支；
       *  我们的客户端此前完全没实现这条 ⇒ 用户 2026-09-23 报的"武士技能没音效"） */
      weaponSfx: eventSfx === 'weapon',
      /** `PlayWaponSoundDirect(x,y,z,N)` 的 N（直接武器音下标，如 13）；无则 null */
      weaponDirect: evHit?.weaponDirect ?? null,
      /** `EventSkill` 的 case `return FALSE` ⇒ 落回通用分支（`character.cpp:4244` `WeaponPlaySound`） */
      evSkillReturnsFalse: evHit?.returnsFalse ?? false,
      soundLines: evHit?.lines ?? [],
    });
  }
}

writeFileSync(OUT, JSON.stringify({
  note: '原版"这一招用哪条动作 + 音从哪来"，由 scripts/extract-skill-motion-src.ts 从 SkillSub.cpp'
    + '（起手动作选择）与 character.cpp 的 EventSkill（事件帧音效）机械提取。生成物，勿手改。'
    + 'motionSrc: attack/skill/mixed(按技能等级)/null(源无此招)；eventSfx: skill(事件帧专属 wav)/weapon(事件帧落回武器挥击音)/none(事件帧无音)。',
  source: {
    skillSub: { path: '.refsrc/SkillSub.cpp', md5: EXPECT['SkillSub.cpp'] },
    character: { path: '.refsrc/character.cpp', md5: EXPECT['character.cpp'] },
  },
  rows,
}, null, 1) + '\n');

const counts = (k: string) => {
  const m = new Map<string, number>();
  for (const r of rows) { const v = String(r[k] ?? 'null'); m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m.entries()].map(([k2, v]) => `${k2}=${v}`).join(' ');
};
console.log(`技能 ${rows.length} 条（motionSrc 有源 ${matchedMotion}，eventSfx 有源 ${matchedSound}）`);
console.log(`  motionSrc：${counts('motionSrc')}`);
console.log(`  eventSfx：${counts('eventSfx')}`);
console.log(`  weaponSfx（原版在事件帧播武器挥击音）：${rows.filter((r) => r.weaponSfx).length} 条`);
for (const job of [1, 4, 8]) {
  const rs = rows.filter((r) => r.job === job);
  const c = (k: string) => {
    const m = new Map<string, number>();
    for (const r of rs) { const v = String(r[k] ?? 'null'); m.set(v, (m.get(v) ?? 0) + 1); }
    return [...m.entries()].map(([k2, v]) => `${k2}=${v}`).join(' ');
  };
  console.log(`  job${job}：motionSrc ${c('motionSrc')} / eventSfx ${c('eventSfx')}`);
}
console.log(`写出 ${OUT}`);
