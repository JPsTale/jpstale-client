/**
 * **技能音效对差矩阵**（`npm run skill-sfx-matrix`）—— 用户 2026-09-23 报
 * "祭司/枪兵的技能有音效，武士的技能没音效"。
 *
 * 目的：把"同一个技能从图标到出声"的**每一根轴**都实测出来，**按职业分组并排**，
 * 好让"差在哪一根轴"一眼可读。不是读代码猜，而是**用真实资产 + 真实状态机 + 真实派发器**跑：
 *   `.inx`（我方实际发布的那一份）→ `buildMotionList`（与 WorldView 同一个构造器）
 *   → `createAnimStateMachine.triggerSkill`（运行时唯一入口）→ 事件帧 `crossEventFrames`
 *   → `fireSkillEvent`（真实音效派发）→ wav 文件存在性（路径 + 字节数）。
 *
 * ── 一根轴一行，失败分类（**不许混**）──────────────────────────────
 *   `ok`  有音：进 SKILL、跨过事件帧、wav 存在
 *   `a`   映射值缺失（`SKILL_INDEX_BY_ICON` 为 null）—— 被动技能属**设计如此**（表里标 `passive`）
 *   `b`   有映射值，但该职业 `.inx` 里**没有任何 SKILL 条目**的 `skillCodeList` 含这个码
 *        ⇒ `triggerSkill` 必然失败（`.inx` 数据缺这条动作；不是"匹配规则"的问题）
 *   `c`   条目存在但被 状态+职业+武器+区域位 过滤掉（含状态机两级放宽后仍无）
 *   `d`   进了 SKILL 但事件帧一个都没跨过（动作长度/事件帧数据的问题）
 *   `e0`  事件帧跨过了，但**这一招根本没有音效数据**（`skill-fx.json` 的 cast/event 都空）
 *   `e1`  有音效数据，但 wav 文件在资产根里**不存在**
 *   `e2`  `skill-fx.json` 里没有这一行（图标查不到行）
 *
 * ── 三条入口（原版三条施法路，判据都在数据里，不在这里复写）─────────
 *   `useCode` 决定这一招能不能绑到左拳/右拳 ⇒ 入口①③（左键点怪 / 追打循环，都走左拳）
 *   只对 `LEFT|ALL` 成立；入口②（`tryNoTargetCast`，右键无目标）只对 `RIGHT|ALL` 且
 *   在 `skill-openplay-macros.json` 名单里成立。**表里 166/200 是 RIGHT-only**。
 *
 * 用法：`npm run skill-sfx-matrix [-- --json] [--job=1]`
 *   `--json`     机器可读全量（复核/文档引用用）
 *   `--job=N`    只跑一个职业（1..11）
 * 资产根：`.env` 的 `VITE_ASSET_ROOT`（取不到 ⇒ **报明确错误退出**，不当成通过）。
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { installDomStub } from './dom-stub.js';
import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';
import { CLASS_DIR, SKILLS } from '../src/game/skillData.js';
import WEAPON_SEM from '../src/game/data/item-weapon-semantics.generated.json';
import PROPOSAL from '../src/game/data/anim-in/skill-index-map.generated.json';
import OPENPLAY from '../src/game/data/source/skill-openplay-macros.json';

installDomStub();

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const asJson = process.argv.includes('--json');
const onlyJob = Number(process.argv.find((a) => a.startsWith('--job='))?.slice(6) ?? 0) || 0;

const assetRoot = ((): string => {
  const envTxt = readFileSync(resolve(ROOT, '.env'), 'utf8');
  const v = /^\s*VITE_ASSET_ROOT\s*=\s*(.+)$/m.exec(envTxt)?.[1]?.trim();
  if (!v) throw new Error('.env 没有 VITE_ASSET_ROOT');
  return v;
})();

// 状态机/匹配器/派发器 —— 与运行时同一份实现（AGENTS #15：判定只写一份）
const { parseInx, parseSmb } = await import('../src/core/char-parser.js');
const { buildMotionList } = await import('../src/char/anim-player.js');
const { createAnimStateMachine, STATE } = await import('../src/char/anim-state-machine.js');
const { semanticEntriesForJob } = await import('../src/char/semantic-anim.js');
const { advanceAnimFrame, crossEventFrames, motionEventIndexOf } = await import('../src/char/animation.js');
const { skillFxRowByIcon, fireSkillCast, fireSkillEvent } = await import('../src/render/effects/skill-fx-runner.js');
const { getWeaponTypeFromIdCode, getHandTypeFromIdCode } = await import('../src/char/weapon-type.js');
const { JOB_DATA } = await import('../src/render/char-loader.js');

/** 职业号 → 动作组（m1..m8）——**从 `JOB_DATA.bipInx` 推**，不另抄一份表（AGENTS #15） */
function groupOf(job: number): string {
  const bip = (JOB_DATA as Record<number, { bipInx?: string }>)[job]?.bipInx;
  const m = bip ? /m(\d)bip\.inx$/.exec(bip) : null;
  if (!m) throw new Error(`职业 ${job} 推不出动作组（JOB_DATA.bipInx=${String(bip)}）`);
  return `m${m[1]}`;
}

/** 代表武器：取语义表里 `primaryClass` = 该职业的**最小 idcode**（同族低阶）。
 *  取不到（祭司没有法球段、`ps1024` 是格斗家的位掩码写法）⇒ 用 `FALLBACK_WEAPON` 或 null。 */
const CLASS_EN: Record<number, string> = {
  1: 'Fighter', 2: 'Mechanician', 3: 'Archer', 4: 'Pikeman', 5: 'Atalanta',
  6: 'Knight', 7: 'Magician', 8: 'Priestess', 9: 'Assassin', 10: 'Shaman', 11: 'MartialArtist',
};
/** 语义表里格斗家写的是位掩码 `ps1024`（= addspecclass1=1024，见 AGENTS #71） */
const PRIMARY_ALIAS: Record<string, string> = { ps1024: 'MartialArtist' };
/** 祭司的武器 = 法球（`gamedb` 语义表没收 `0x0303` 段）—— idcode 出处：AGENTS 纠错 #8b（`Skull Beads` = 0x0303_0500） */
const FALLBACK_WEAPON: Record<number, number> = { 8: 0x03030500 };

function representativeWeapon(job: number): number | null {
  if (FALLBACK_WEAPON[job] != null) return FALLBACK_WEAPON[job]!;
  const want = CLASS_EN[job]!;
  let best: number | null = null;
  for (const [code, v] of Object.entries((WEAPON_SEM as { byIdcode: Record<string, { primaryClass?: string }> }).byIdcode)) {
    const pc = PRIMARY_ALIAS[v.primaryClass ?? ''] ?? v.primaryClass;
    if (pc !== want) continue;
    const n = Number(code);
    if (best == null || n < best) best = n;
  }
  return best;
}

/** 图标 → 映射值来源：提案文件那一行的 `src`（`/in-name` / `positional` / `none`） */
const PROPOSAL_SRC = new Map<string, string>();
for (const rows of Object.values((PROPOSAL as { classes: Record<string, Array<{ iconFile: string; src: string }>> }).classes)) {
  for (const r of rows) if (!PROPOSAL_SRC.has(r.iconFile)) PROPOSAL_SRC.set(r.iconFile, r.src);
}
/** 图标 → 该图标在 `skill-fx.json` 里登记的音效（判 `e0` 用；与派发器同一份数据） */
const SFX_ROWS = new Map<string, { cast: string[]; event: string[] }>();
{
  const g = JSON.parse(readFileSync(resolve(ROOT, 'src/game/data/skill-fx.json'), 'utf8')) as {
    rows: Array<{ icon: string; cast: { sfx: string[] }; event: { sfx: string[] } }>;
  };
  for (const r of g.rows) SFX_ROWS.set(r.icon.toLowerCase(), { cast: r.cast.sfx, event: r.event.sfx });
}
const OPENPLAY_MACROS: Set<string> = new Set((OPENPLAY as { macros: Array<{ macro: string }> }).macros.map((m) => m.macro));

interface Row {
  job: number; classDir: string; icon: string; name: string; type: string; reqLv: number; useCode: string;
  weapon: number | null; weaponUsed: string;
  map: number | null; mapSrc: string;
  codesInFile: number[];       // 该职业 .inx 的 SKILL 条目里出现过、且与该技能无关的全集（诊断用）
  hasEntry: boolean;           // 有没有任一 SKILL 条目带这个码（忽略 职业/武器/区域 过滤）
  triggerSkill: boolean; state: number; motionIndex: number | null; motionRange: [number, number] | null;
  eventFrames: number[]; eventsFired: number;
  wavs: string[]; missingWavs: string[];
  bindLeft: boolean; bindRight: boolean; inOpenPlay: boolean;
  cls: 'ok' | 'a' | 'b' | 'c' | 'd' | 'e0' | 'e1' | 'e2';
  note: string;
}

const bytes = (p: string): ArrayBuffer => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};
const rows: Row[] = [];

for (let job = 1; job <= 11; job++) {
  if (onlyJob && job !== onlyJob) continue;
  const classDir = CLASS_DIR[job]!;
  const group = groupOf(job);
  const bipInx = (JOB_DATA as Record<number, { bipInx?: string }>)[job]?.bipInx;
  if (!bipInx) throw new Error(`职业 ${job} 没有 bipInx（动作组 ${group}）`);
  const inxPath = resolve(assetRoot, bipInx);
  if (!existsSync(inxPath)) throw new Error(`资产缺失：${inxPath}`);
  const inx = parseInx(bytes(inxPath));
  // ⚠ 与 `char-loader.resolveMotionBase` 同构（那是内部函数，未导出）
  const smbRel = String(inx.motionFile).split('\\').join('/').replace(/\.[^.]+$/, '').toLowerCase() + '.smb';
  const smbPath = resolve(assetRoot, smbRel);
  if (!existsSync(smbPath)) throw new Error(`资产缺失：${smbPath}`);
  const motions = buildMotionList(parseSmb(bytes(smbPath)), inx);
  const skillMotions = motions.filter((m) => m.state === STATE.SKILL);
  const codesInFile = [...new Set(skillMotions.flatMap((m) => Array.from(m.skillCodeList ?? [])))].sort((a, b) => a - b);

  const rep = representativeWeapon(job);
  for (const skill of SKILLS[classDir]!) {
    const key = skill.iconFile;
    const map = (SKILL_INDEX_BY_ICON as Record<string, number | null>)[key] ?? null;
    const src = PROPOSAL_SRC.get(key) ?? '既有';
    const fx = SFX_ROWS.get(key.toLowerCase());
    const hasEntry = map != null && skillMotions.some((m) => Array.from(m.skillCodeList ?? []).includes(map));
    const bindLeft = skill.useCode === 'LEFT' || skill.useCode === 'ALL';
    const bindRight = skill.useCode === 'RIGHT' || skill.useCode === 'ALL';
    const inOpenPlay = OPENPLAY_MACROS.has(skill.name.replace(/[\s'\-_]/g, '').toUpperCase())
      || OPENPLAY_MACROS.has(key.replace(/^[a-z]+\d+ /i, '').replace(/\.bmp$/i, '').replace(/[\s_\-]/g, '').toUpperCase());

    const base: Row = {
      job, classDir, icon: key, name: skill.name, type: skill.type, reqLv: skill.reqLv, useCode: skill.useCode,
      weapon: rep, weaponUsed: rep == null ? 'null(空手)' : `0x${rep.toString(16)}`,
      map, mapSrc: src, codesInFile, hasEntry,
      triggerSkill: false, state: 0, motionIndex: null, motionRange: null,
      eventFrames: [], eventsFired: 0, wavs: [], missingWavs: [],
      bindLeft, bindRight, inOpenPlay,
      cls: 'a', note: '',
    };

    if (map == null) {
      base.cls = 'a';
      base.note = skill.useCode === 'NOT' ? '无动画（被动；`useCode=NOT` ⇒ 不可绑、原版也无动作）' : '**映射缺失**：表里为 null';
      rows.push(base);
      continue;
    }

    /** 放一次：返回进没进 SKILL、播了哪些 wav。武器不匹配时按状态机自己的放宽链走（不在这里造第二份判定）。 */
    const run = (weapon: number | null): { trigger: boolean; wavs: string[]; events: number; motionIndex: number | null; range: [number, number] | null; frames: number[] } => {
      const sm = createAnimStateMachine({
        getMotions: () => motions,
        getClassId: () => job,
        getWeaponIdCode: () => weapon,
        getWeaponType: () => (weapon == null ? null : getWeaponTypeFromIdCode(weapon)),
        getHandType: () => {
          const h = weapon == null ? null : getHandTypeFromIdCode(weapon);
          return h === '1H' || h === '2H' ? h : null;
        },
        getSemanticEntries: () => semanticEntriesForJob(job),
        getFieldState: () => 2,          // 野外（`.in` 的 SKILL 条目 100% 是 필드，见 verify-skill-sound B 段）
        onMotionChange: () => {},
      });
      sm.triggerIdle();
      const trigger = sm.triggerSkill(map);
      const wavs: string[] = [];
      if (!trigger) return { trigger, wavs, events: 0, motionIndex: null, range: null, frames: [] };
      const m = sm.getCurrentMotion()!;
      const row = skillFxRowByIcon(key);
      const ctx = { scene: null as never, playSound: (p: string) => { wavs.push(p); }, log: () => {} };
      if (row) fireSkillCast(row, ctx, { x: 0, y: 0, z: 0 });
      const ef = Array.from(m.eventFrame).filter((f) => f > 0);
      const use = ef.length ? ef : [0];        // 无事件帧 → 原版兜底在起点触发一次（与 WorldView 同一判据）
      let fired = 0, events = 0, frame = m.startFrame * 160;
      for (let i = 0; i < 1200; i++) {
        frame = advanceAnimFrame(frame, m, 1 / 60, 1).frame;
        const crossed = crossEventFrames(use, fired, frame - m.startFrame * 160);
        fired = crossed.fired;
        for (const f of crossed.hit) {
          events++;
          if (row) {
            fireSkillEvent(row, { ...ctx, motionEvent: motionEventIndexOf(m.eventFrame, f), casterYaw: 0 }, { x: 0, y: 0, z: 0 }, null);
          }
        }
        if (events >= use.length) break;
      }
      return { trigger, wavs, events, motionIndex: m.index, range: [m.startFrame, m.endFrame], frames: ef };
    };

    let r = run(rep);
    if (!r.trigger && rep != null) {           // 武器不匹配 → 再试空手（报告里标出来）
      const bare = run(null);
      if (bare.trigger) { r = bare; base.weaponUsed = `${base.weaponUsed} → 空手才命中`; }
    }
    base.triggerSkill = r.trigger;
    base.state = r.trigger ? STATE.SKILL! : 0;
    base.motionIndex = r.motionIndex;
    base.motionRange = r.range;
    base.eventFrames = r.frames;
    base.eventsFired = r.events;
    base.wavs = r.wavs;

    if (!r.trigger) {
      base.cls = hasEntry ? 'c' : 'b';
      base.note = hasEntry
        ? '条目存在但被 职业/武器/区域位 过滤掉（状态机两级放宽后仍无）'
        : `该职业 .inx 无任何 SKILL 条目带码 ${map}（文件里 SKILL 码：${codesInFile.join(',')}）`;
      rows.push(base);
      continue;
    }
    if (r.events === 0) { base.cls = 'd'; base.note = '进了 SKILL 但事件帧没跨过'; rows.push(base); continue; }
    if (!fx) { base.cls = 'e2'; base.note = '`skill-fx.json` 无此行'; rows.push(base); continue; }
    if (r.wavs.length === 0) {
      base.cls = 'e0';
      base.note = `事件帧到了但本招无音效数据（cast=${JSON.stringify(fx.cast)} event=${JSON.stringify(fx.event)}）`;
      rows.push(base);
      continue;
    }
    base.missingWavs = r.wavs.filter((w) => !existsSync(resolve(assetRoot, w)));
    if (base.missingWavs.length) { base.cls = 'e1'; base.note = 'wav 文件不存在'; rows.push(base); continue; }
    base.cls = 'ok';
    base.note = '事件帧音正常';
    rows.push(base);
  }
}

/** wav 证据（路径 + 字节数）—— "能点开"级 */
const wavEvidence = new Map<string, { path: string; bytes: number } | { missing: true }>();
for (const r of rows) {
  for (const w of [...r.wavs, ...r.missingWavs]) {
    if (wavEvidence.has(w)) continue;
    const p = resolve(assetRoot, w);
    wavEvidence.set(w, existsSync(p) ? { path: p, bytes: statSync(p).size } : { missing: true });
  }
}

if (asJson) {
  console.log(JSON.stringify({ assetRoot, rows, wavEvidence: Object.fromEntries(wavEvidence) }, null, 1));
} else {
  const CLS_LABEL: Record<string, string> = {
    ok: '有音', a: 'a 映射缺失', b: 'b 无 SKILL 条目', c: 'c 被过滤', d: 'd 未跨事件帧',
    e0: 'e0 无音效数据', e1: 'e1 wav 不存在', e2: 'e2 无 skill-fx 行',
  };
  console.log(`资产根 ${assetRoot}`);
  console.log(`职业：1 fighter · 8 priestess · 4 pikeman（用户对照的三组）\n`);
  for (let job = 1; job <= 11; job++) {
    const rs = rows.filter((r) => r.job === job);
    if (!rs.length) continue;
    console.log(`── job${job} ${CLASS_DIR[job]}（动作组 ${groupOf(job)}，代表武器 ${rs[0]!.weaponUsed}）`);
    console.log('   图标                        映射 源          条目 trigger 进SKILL 事件帧 wav 结论');
    for (const r of rs) {
      const f = (s: string, n: number) => s.padEnd(n);
      console.log(`   ${f(r.icon, 28)} ${String(r.map ?? '-').padStart(4)} ${f(r.mapSrc, 11)} `
        + `${r.hasEntry ? '有' : '无'}  ${f(String(r.triggerSkill), 5)} ${f(String(r.state === STATE.SKILL), 5)} `
        + `${f(String(r.eventsFired), 5)} ${f(String(r.wavs.length), 3)} [${CLS_LABEL[r.cls]}] ${r.note}`);
      if (r.cls === 'ok') {
        for (const w of r.wavs) {
          const e = wavEvidence.get(w)!;
          console.log(`        · ${w} → ${'bytes' in e ? e.bytes + ' B' : '**不存在**'}`);
        }
      }
    }
    console.log('');
  }
  const byJob = (j: number, c: string) => rows.filter((r) => r.job === j && r.cls === c).length;
  console.log('── 汇总（每职业 × 失败类）');
  console.log('   job  总数 ok  a  b  c  d  e0 e1 e2');
  for (let job = 1; job <= 11; job++) {
    const n = rows.filter((r) => r.job === job).length;
    if (!n) continue;
    console.log(`   ${String(job).padEnd(5)}${String(n).padStart(4)}${['ok', 'a', 'b', 'c', 'd', 'e0', 'e1', 'e2']
      .map((c) => String(byJob(job, c)).padStart(3)).join('')}`);
  }
  const soundless = rows.filter((r) => r.cls !== 'ok');
  console.log(`\n有音 ${rows.length - soundless.length} / ${rows.length}；无声 ${soundless.length}`);
}
