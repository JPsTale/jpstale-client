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
const { SITEM_CODE_BY_INDEX } = await import('../src/char/sitem-weapon-index.js');
const { skillMotionSrcByIcon } = await import('../src/game/skillMotionSrc.js');
const { JOB_DATA } = await import('../src/render/char-loader.js');
type MotionInfo = Awaited<ReturnType<typeof buildMotionList>>[number];

/** 职业号 → 动作组（m1..m8）——**从 `JOB_DATA.bipInx` 推**，不另抄一份表（AGENTS #15） */
function groupOf(job: number): string {
  const bip = (JOB_DATA as Record<number, { bipInx?: string }>)[job]?.bipInx;
  const m = bip ? /m(\d)bip\.inx$/.exec(bip) : null;
  if (!m) throw new Error(`职业 ${job} 推不出动作组（JOB_DATA.bipInx=${String(bip)}）`);
  return `m${m[1]}`;
}

/** 代表武器：**从该职业自己的 `.inx` SKILL 条目**的 `itemCodeList` 里取（sItem 索引 → idcode），
 *  取最小的那个 idcode。理由：动作数据**自己写了**这一招接受哪些武器 —— 比"按 DB 的
 *  primaryClass 猜"更硬（祭司的 SKILL 条目收 `0x0104` 法杖，而她的招牌法球 `0x0303` 根本不在
 *  sItem 索引表里，按 DB 猜会得出"祭司一招都放不出"的假结论）。取不到（该职业 SKILL 条目
 *  itemCodeCount 都是 0）才退回 DB 语义表的 `primaryClass`。 */
function representativeWeaponInx(skillMotions: MotionInfo[]): { code: number | null; from: string } {
  const found = new Set<number>();
  for (const m of skillMotions) {
    for (let i = 0; i < Math.min(m.itemCodeCount, m.itemCodeList.length); i++) {
      const idcode = SITEM_CODE_BY_INDEX[m.itemCodeList[i]!];
      if (idcode) found.add(idcode);
    }
  }
  if (found.size) {
    const code = Math.min(...found);
    return { code, from: `.inx(itemCodeList 里 ${found.size} 个武器码的最小值)` };
  }
  return { code: null, from: '取不到（SKILL 条目没有武器白名单）' };
}

/** DB 语义表兜底（`.inx` 白名单为空时用）：`primaryClass` = 该职业的**最小 idcode** */
const CLASS_EN: Record<number, string> = {
  1: 'Fighter', 2: 'Mechanician', 3: 'Archer', 4: 'Pikeman', 5: 'Atalanta',
  6: 'Knight', 7: 'Magician', 8: 'Priestess', 9: 'Assassin', 10: 'Shaman', 11: 'MartialArtist',
};
/** 语义表里格斗家写的是位掩码 `ps1024`（= addspecclass1=1024，见 AGENTS #71） */
const PRIMARY_ALIAS: Record<string, string> = { ps1024: 'MartialArtist' };

function representativeWeaponDb(job: number): number | null {
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
  map: number | null; mapSrc: string; alt?: string;
  codesInFile: number[];       // 该职业 .inx 的 SKILL 条目里出现过、且与该技能无关的全集（诊断用）
  hasEntry: boolean;           // 有没有任一 SKILL 条目带这个码（忽略 职业/武器/区域 过滤）
  /** 原版这一招用哪条动作（生成物 `skill-motion-src`：`attack`/`skill`/`mixed`/null 未见） */
  motionSrc: 'attack' | 'skill' | 'mixed' | null;
  /** 原版**事件帧**的音从哪来（生成物：`skill` 专属 wav / `weapon` 武器挥击音 / `none` 无） */
  eventSfx: 'skill' | 'weapon' | 'none' | null;
  /** 事件帧要不要补播武器挥击音（本轮的修复点） */
  weaponSfx: boolean;
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

  // 两个候选武器（都要试）：① DB 语义表里该职业的主用武器（玩家真会拿的那把）
  //                        ② 该职业 `.inx` SKILL 条目白名单里的最小码（动作数据自己认的武器）
  // 单一武器会给出**假阴性**：祭司拿法球（0x0303 不在 sItem 索引表里）⇒ 判她"一招都放不出"，
  // 而她拿法杖（0x0104）时全部可放（用户实测"祭司有音效"）。故逐个试，行内记下**是哪个武器**成功的。
  const inxRep = representativeWeaponInx(skillMotions);
  const dbRep = representativeWeaponDb(job);
  const candidates = [...new Set([dbRep, inxRep.code].filter((c): c is number => c != null))];
  for (const skill of SKILLS[classDir]!) {
    const key = skill.iconFile;
    const map = (SKILL_INDEX_BY_ICON as Record<string, number | null>)[key] ?? null;
    const src = PROPOSAL_SRC.get(key) ?? '既有';
    const fx = SFX_ROWS.get(key.toLowerCase());
    const hasEntry = map != null && skillMotions.some((m) => Array.from(m.skillCodeList ?? []).includes(map));
    const motionRow = skillMotionSrcByIcon(key);
    const bindLeft = skill.useCode === 'LEFT' || skill.useCode === 'ALL';
    const bindRight = skill.useCode === 'RIGHT' || skill.useCode === 'ALL';
    const inOpenPlay = OPENPLAY_MACROS.has(skill.name.replace(/[\s'\-_]/g, '').toUpperCase())
      || OPENPLAY_MACROS.has(key.replace(/^[a-z]+\d+ /i, '').replace(/\.bmp$/i, '').replace(/[\s_\-]/g, '').toUpperCase());

    const base: Row = {
      job, classDir, icon: key, name: skill.name, type: skill.type, reqLv: skill.reqLv, useCode: skill.useCode,
      weapon: candidates[0] ?? null, weaponUsed: candidates.length ? candidates.map((c) => `0x${c.toString(16)}`).join('/') : 'null(空手)',
      map, mapSrc: src, alt: skill.alt, codesInFile, hasEntry,
      motionSrc: motionRow?.motionSrc ?? null, eventSfx: motionRow?.eventSfx ?? null, weaponSfx: motionRow?.weaponSfx ?? false,
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

    // 逐个候选武器试（顺序：DB 主用武器 → `.inx` 白名单最小码 → 空手）；记下是哪一个成功的
    let r = { trigger: false, wavs: [] as string[], events: 0, motionIndex: null as number | null, range: null as [number, number] | null, frames: [] as number[] };
    let hitWeapon: string | null = null;
    for (const c of [...candidates, null]) {
      const attempt = run(c);
      if (attempt.trigger) { r = attempt; hitWeapon = c == null ? 'null(空手)' : `0x${c.toString(16)}`; break; }
    }
    base.weaponUsed = hitWeapon ?? `${base.weaponUsed}（都失败）`;
    base.triggerSkill = r.trigger;
    base.state = r.trigger ? STATE.SKILL! : 0;
    base.motionIndex = r.motionIndex;
    base.motionRange = r.range;
    base.eventFrames = r.frames;
    base.eventsFired = r.events;
    base.wavs = r.wavs;

    if (!r.trigger) {
      base.cls = hasEntry ? 'c' : 'b';
      // 已知边界：`matchWeapon` 只能按 **sItem 索引表**比对，而该表只覆盖 0x0101~0x0108
      // （`AGENTS` #3）⇒ 匕首(0x010A)/图腾(0x0109)/拳套(0x010B) 这些家族的武器码**永远匹配不上**，
      // 放宽到"同类型"也要读同一张表 ⇒ 空手放宽又要求白名单里有 0xFFFF 哨兵。
      // 证据：`representativeWeaponInx` 从这个职业的 SKILL 条目里能解出 0 个武器码。
      const weaponUnresolvable = !inxRep.code;
      base.note = hasEntry
        ? (weaponUnresolvable
          ? '条目存在但**任何武器都匹配不上**：本职业 SKILL 条目的武器码不在 sItem 索引表（只覆盖 0x0101~0x0108）里 ⇒ 精确匹配/同类型放宽都失效'
          : '条目存在但被 职业/武器/区域位 过滤掉（状态机两级放宽后仍无）')
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

  // ── 推出来的映射值复核（`skillIndexByIcon.ts` 里 `src=positional` 的那批）──────────────
  // 两条**可推翻**的判据：
  //   ① 该码在本职业 `.inx` 的 SKILL 条目里存不存在（= 这张表给的值指向什么、有没有东西）
  //   ② `.in` 的 `*적용기술` **名字集合**：名字命中的条目的码集合**不含**这个值 ⇒ 该值不是这一招的
  //      （名字用 `skillData` 的 name 与 alt 两套，归一化后比 —— 与 `extract-skill-map` 同一套口径）
  console.log('\n── 推出来的映射值复核（`skillIndexByIcon.ts` 里标 `positional` 的那批）');
  console.log('   图标                        值   .inx有该码  源码有该招  `.in` 名字命中条目的码集合        判定');
  const groupOfJob = new Map<number, string>();
  for (let job = 1; job <= 11; job++) groupOfJob.set(job, groupOf(job));
  const inCache = new Map<string, Array<{ skills: string[]; codes: number[] }>>();
  const inEntries = (job: number): Array<{ skills: string[]; codes: number[] }> => {
    const g = groupOfJob.get(job)!;
    const hit = inCache.get(g);
    if (hit) return hit;
    const j = JSON.parse(readFileSync(resolve(ROOT, `src/game/data/anim-in/anim-${g}.generated.json`), 'utf8')) as {
      entries: Array<{ inxState: string; skills: string[]; inxSkillCodes: number[] }>;
    };
    const list = j.entries.filter((e) => e.inxState === 'SKILL')
      .map((e) => ({ skills: e.skills.flatMap((s) => s.split(/\s+/).filter(Boolean)), codes: e.inxSkillCodes.filter((c) => c > 0) }));
    inCache.set(g, list);
    return list;
  };
  const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  let reviewed = 0, confirmed = 0, noAction = 0, suspicious = 0;
  for (const r of rows) {
    if (r.mapSrc !== 'positional') continue;
    reviewed++;
    const names = [normName(r.name), ...(r.alt ? [normName(r.alt)] : [])];
    const hits = inEntries(r.job).filter((e) => e.skills.some((s) => names.includes(normName(s))));
    const codes = [...new Set(hits.flatMap((e) => e.codes))];
    const byName = r.map != null && codes.includes(r.map);
    const inSrc = (() => {                       // 源码（SkillSub/character.cpp）里有没有这一招
      const m = skillMotionSrcByIcon(r.icon);
      return m != null && (m.motionSrc != null || m.eventSfx != null);
    })();
    let verdict: string;
    if (r.hasEntry) { verdict = '确认：本职业动作表里有带这个码的 SKILL 条目'; confirmed++; }
    else if (byName) { verdict = '**矛盾**：名字命中的条目含该码，但 .inx 里查不到 ⇒ 需复核（`.in` 与 `.inx` 不同代？）'; suspicious++; }
    else if (inSrc) { verdict = '确认：源码有这一招；该码在本代动作表里没有条目 ⇒ **动作数据缺**（不是映射错）'; confirmed++; }
    else { verdict = '**待核（缺证据）**：源码没有这一招，值属推断 —— 需 11 职业客户端/源码的动作定义'; noAction++; }
    console.log(`   ${r.icon.padEnd(28)} ${String(r.map ?? '-').padStart(3)} ${(r.hasEntry ? '有' : '无').padEnd(10)} `
      + `${(inSrc ? '有' : '无').padEnd(10)} ${(codes.length ? codes.join(',') : '（名字未命中）').padEnd(30)} ${verdict}`);
  }
  console.log(`   推的值 ${reviewed} 项：确认 ${confirmed}（其中${noAction ? '' : '全部'}有动作或源码出处）、矛盾 ${suspicious}、待核缺证据 ${noAction}`);
}
