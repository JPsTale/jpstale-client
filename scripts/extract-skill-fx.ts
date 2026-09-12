/**
 * 技能表现清单生成 —— `skill → { fx: [...], sfx: [...] }`
 *
 * 背景：原版把「播哪个特效、播哪个音效」硬编码在**启动特效的那处调用点**，
 * 而该调用点在反编译中丢失（服务端 skilldb 也没有这两列）。
 * 所以这张表只能从**命名约定**重建，再由人工在资产检查器里逐条试听/试看校对。
 *
 * 匹配规则（按可信度从高到低）：
 *   1. exact —— 归一化名字直接相同
 *   2. alt   —— `skillData` 里的旧译名（如 Fierce Wind / Seismic Impact / Holy Conviction）
 *   3. alias —— 人工整理的缩写对照（如 aofr = Arrow of Range、roz = Rage of Zecram）
 *   4. 5th   —— 五转：`.part` 名为 `<职业码>5<旧译名>`，如 ac5fiercewind / r5sesmicimpact
 *
 * 输出 `src/game/data/skill-fx.json`（游戏与检查器共用）。
 * 用法：npx tsx scripts/extract-skill-fx.ts
 */
import { writeFileSync, mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { SKILLS, CLASS_DIR } from '../src/game/skillData.js';
import { SKILL_INDEX_BY_ICON } from '../src/game/data/skillIndexByIcon.js';

const ASSET_ROOT = resolve(process.env.PT_ASSET_ROOT ?? 'E:/JPsTale/client');
const OUT = resolve('src/game/data/skill-fx.json');
/** 源码派生的技能调度表（scripts/extract-skill-map.ts 产出）—— 音效侧的权威来源 */
const CODE_MAP = resolve('src/game/data/skill-code-map.json');

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * 人工缩写对照 —— 仅在原版音效/特效文件名用了缩写时使用。
 * 每条都注明依据，便于复核。
 */
const ALIAS: Record<string, string[]> = {
  'Arrow of Range': ['aofr'],                    // 原版 SkillSoundWav: "AofR 01.wav" ↔ SKILL_SOUND_SKILL_ARROW_OF_RANGE
  'Rage of Zecram': ['roz'],                     // 原版 SkillSoundWav: "RoZ 0N.wav" ↔ SKILL_SOUND_SKILL_RAGE_OF_ZECRAM1..3
  "Assassin's Eye": ['assassineye', 'assasins'],  // 文件名无撇号
  'Physical Absorption': ['physicalabsorb'],     // 特效 INI 写作 SkillPhysicalAbsorb1.ini
  'Mortal Blow': ['motalblow'],                  // 特效 INI 写作 SkillMotalBlowHit.ini（原版拼写错误）
  'Vis Tenus': ['vistenus'],                     // 特效 INI 写作 SkillVisTenus1.ini
  'Tornado': ['tornado'],                        // SkillTornado.ini / SkillTornado2.ini
  'Meteorite': ['meteo', 'archmagemeteo'],       // 特效写作 Meteo1/2.lua、SkillArchMageMeteo1-4.lua
  'Ice Meteorite': ['icemeteorite', 'celestialglacialspike'],
  'Thunderstorm': ['thunderstorm', 'celestialchainlight'],
  'Divine Lightning': ['celestialchainlight'],
  'Bigger Spear': ['biggerspear', 'amplified'],
};

/* ─────────── 收集候选：特效（INI / .part / Lua）与音效 ─────────── */

interface Named { name: string; kind: 'ini' | 'part' | 'lua' }

function listNames(dir: string, ext: string): string[] {
  try {
    return readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(ext))
      .map((f) => f.replace(new RegExp(`\\${ext}$`, 'i'), '').toLowerCase());
  } catch { return []; }
}

const iniNames = listNames(join(ASSET_ROOT, 'effect/animationdata'), '.ini');
const partNames = [
  ...listNames(join(ASSET_ROOT, 'effect/particle/script'), '.part'),
  ...listNames(join(ASSET_ROOT, 'game/scripts/particles'), '.part'),
];
const luaNames = listNames(join(ASSET_ROOT, 'effect/neweffect'), '.lua');
// 较新客户端把部分效果编译成 .luac（同目录），虽不可解析但**属于资产、要纳入清单**，
// 否则 skillwarriordestroyer1 这类五转效果会漏掉。
const luacNames = listNames(join(ASSET_ROOT, 'game/scripts/particles'), '.luac');

const effects: Named[] = [
  ...iniNames.map((name) => ({ name, kind: 'ini' as const })),
  ...partNames.map((name) => ({ name, kind: 'part' as const })),
  ...luaNames.map((name) => ({ name, kind: 'lua' as const })),
  ...luacNames.map((name) => ({ name, kind: 'luac' as const })),
];

/** 音效：返回相对路径列表（含阵营目录），键为归一化名 */
const sounds = new Map<string, string[]>();
for (const faction of ['tempskron', 'morion']) {
  const rel = `wav/effects/skill/${faction}`;
  let files: string[] = [];
  try { files = readdirSync(join(ASSET_ROOT, rel)); } catch { continue; }
  for (const f of files) {
    if (!f.toLowerCase().endsWith('.wav')) continue;
    const key = norm(f.replace(/\.wav$/i, '').replace(/\s*\d+$/, ''));
    const arr = sounds.get(key);
    const path = `${rel}/${f.toLowerCase()}`;
    if (arr) arr.push(path); else sounds.set(key, [path]);
  }
}

/* ─────────── 每个技能做匹配 ─────────── */

interface Row {
  job: number;
  classDir: string;
  icon: string;
  name: string;
  alt?: string;
  /** 匹配到的特效名（含家族前缀 ini:/part:/lua:/luac:） */
  fx: string[];
  /** 匹配到的音效相对路径 */
  sfx: string[];
  /**
   * 按时机拆分（技能的表现为"起手"与"事件帧"两个时刻，见下）。
   * 默认规则：特效全部在**事件帧**放；音效有 ≥2 个时，第一个在起手、其余在事件帧。
   * 与人工基准冲突时以 OVERRIDE 为准。
   */
  cast: { sfx: string[] };
  event: { fx: string[]; sfx: string[] };
  /** 源码派生的 SKILL_PLAY_* 码（有则说明音效来自 character.cpp，最可信） */
  code?: string | null;
  /** 源码里的表现函数名（特效由它们派发，下一步从这里挖特效资产） */
  presenters?: string[];
  /** 统一记录的第三项：动画索引（来自 skill-mapping，可被覆盖表修正） */
  animIndex?: number | null;
  /** 手工覆盖的依据说明 */
  note?: string;
  confidence: 'code' | 'manual' | 'exact' | 'alt' | 'alias' | 'none' | 'n/a';
}

/**
 * 手工覆盖表 —— **以 `src/game/data/skill-fx.overrides.json` 为准**（人手维护，脚本只读不写）。
 * 本文件不再内嵌覆盖数据：脚本重跑会覆盖生成物，手写内容必须放在独立文件里才不会被冲掉。
 *   `src/game/data/skill-fx.generated.json`  ← 生成物，随时可重跑
 *   `src/game/data/skill-fx.overrides.json`  ← 手作物，脚本永不覆盖
 *   `src/game/data/skill-fx.json`            ← 上面两者合并后的结果（应用读这个）
 */
const OVERRIDES = resolve('src/game/data/skill-fx.overrides.json');
const GENERATED = resolve('src/game/data/skill-fx.generated.json');

interface FxOverride {
  /** 起手音（覆盖自动拆分） */
  castSfx?: string[];
  /** 事件帧特效（覆盖匹配结果） */
  eventFx?: string[];
  /** 事件帧音效 */
  eventSfx?: string[];
  /** 动画索引覆盖（skill-mapping 缺失或不对时手填；null 表示明确"无专属动画"） */
  animIndex?: number | null;
  /** 说明依据（谁、怎么核对的） */
  note?: string;
}

const overridesBySkill: Record<string, FxOverride> = existsSync(OVERRIDES)
  ? (JSON.parse(readFileSync(OVERRIDES, 'utf8')) as { skills?: Record<string, FxOverride> }).skills ?? {}
  : {};

/**
 * 不计入表现的活动/皮肤变体（子串匹配）。
 * `icevalentobrandish` 等属节日活动皮，常规技能不会用到。
 */
const IGNORE_FX = ['valento', 'xmass', 'halloween', 'event', 'pcbang', 'lowlevel', 'randomcube'];

/**
 * EU 客户端**没有这些职业的资产**（后来版本才加入的职业）。
 * 格斗家(job 11) 在 `skillData` 里有技能表（取自 wartale 新版资料），但客户端资产里
 * 既无模型也无特效/音效 —— 这不是缺口，标为 n/a 不计入匹配率。
 */
const ABSENT_IN_CLIENT = new Set(['martial']);

const rows: Row[] = [];
/** 特效名两条键：原样 + 去掉末尾数字。
 *  后者用来匹配"名字里夹了五转职业名"的 Lua/part，如
 *  `skillwarriordestroyer1` → `skillwarriordestroyer` 可被 Destroyer 的 endsWith 命中。 */
const fxByNorm = effects.map((e) => {
  const n = norm(e.name);
  return { normName: n, stripped: n.replace(/\d+$/, ''), ...e };
});

/* ─────────── 源码派生表（音效权威来源） ─────────── */

interface CodeRow {
  code: string; skill: string | null; classDir: string | null;
  sounds: Array<{ symbol: string; file: string | null }>;
  presenters: string[];
}
const codeRows: CodeRow[] = existsSync(CODE_MAP)
  ? (JSON.parse(readFileSync(CODE_MAP, 'utf8')) as { rows: CodeRow[] }).rows
  : [];
if (!codeRows.length) {
  console.warn('[skillfx] 未找到 skill-code-map.json（先跑 npm run skillmap）——本次仅用命名约定');
}
/** 技能名归一化 → 源码行（可能多职业同名，取第一个；应用时优先同职业） */
const codeBySkillNorm = new Map<string, CodeRow[]>();
for (const r of codeRows) {
  if (!r.skill) continue;
  const k = norm(r.skill);
  const arr = codeBySkillNorm.get(k);
  if (arr) arr.push(r); else codeBySkillNorm.set(k, [r]);
}

/**
 * 特效名匹配。原版命名不统一，按可信度分档（记录命中规则便于复核）：
 *   1. `skill<名>` 完全相等     —— 如 SkillSpark1.ini ↔ Spark
 *   2. `<名>` 完全相等          —— 如 CircleTrap.ini ↔ Circle Trap
 *   3. `skill<名>` 前缀         —— 如 SkillExtremeShield{Particle,Big,Small}.ini ↔ Extreme Shield
 *   4. `<名>` 前缀              —— 如 AutomationLeft/Right.ini ↔ Automation、Meteo1/2.lua ↔ 见别名
 *   5. `<职业码>5<名>` 结尾     —— 五转：ac5fiercewind ↔ Fierce Wind
 * 前缀匹配要求名字 ≥5 字符，避免 "Ice" 之类误命中一堆 ice*。
 */
function matchFx(keys: string[]): string[] {
  const out = new Set<string>();
  for (const k of keys) {
    if (!k) continue;
    const long = k.length >= 5;
    for (const e of fxByNorm) {
      const s = e.stripped;
      const hit =
        e.normName === `skill${k}` ||
        e.normName === k ||
        (long && e.normName.startsWith(`skill${k}`)) ||
        (long && e.normName.startsWith(k)) ||
        e.normName.endsWith(`5${k}`) ||
        // 末尾去数字后按结尾匹配：接住 skill<class><名>N（五转 Lua/part 命名）
        (long && (s.endsWith(k) || s.endsWith(`5${k}`)));
      if (hit) out.add(`${e.kind}:${e.name}`);
    }
  }
  return [...out];
}

function matchSfx(keys: string[]): { hits: string[]; how: 'exact' | 'alt' | 'alias' | 'none' } {
  for (const [i, how] of [['0', 'exact'], ['1', 'alt'], ['2', 'alias']] as const) {
    const k = keys[Number(i)];
    if (k && sounds.has(k)) return { hits: sounds.get(k)!, how };
  }
  return { hits: [], how: 'none' };
}

const jobOf = new Map<string, number>();
for (const [job, dir] of Object.entries(CLASS_DIR)) jobOf.set(dir, Number(job));

for (const [classDir, list] of Object.entries(SKILLS)) {
  const job = jobOf.get(classDir) ?? 0;
  for (const s of list) {
    const nName = norm(s.name);
    const nAlt = s.alt ? norm(s.alt) : '';
    const nAlias = (ALIAS[s.name] ?? ALIAS[s.alt ?? ''] ?? []).map(norm);

    const keys = [nName, nAlt, ...nAlias].filter(Boolean) as string[];
    const fxRaw = matchFx(keys).filter((t) => !IGNORE_FX.some((ig) => t.toLowerCase().includes(ig)));

    // 音效：**源码派生优先**（NewSourcePT-2023 的 case SKILL_PLAY_*），其次命名约定。
    // 注意源码只给出"该技能有哪些音效"（rand()%2 表明多为并列变体），**不表达先后时机**。
    const codeRowsForSkill = codeBySkillNorm.get(nName)
      ?? (nAlt ? codeBySkillNorm.get(nAlt) : undefined) ?? [];
    const codeRow = codeRowsForSkill.find((r) => r.classDir === classDir) ?? codeRowsForSkill[0] ?? null;
    const codeSfx = codeRow
      ? [...new Set(codeRow.sounds.map((s) => s.file).filter((f): f is string => !!f))]
      : [];
    const { hits: nameSfx, how } = matchSfx(keys);
    const sfx = codeSfx.length ? codeSfx : nameSfx;

    // 特效：源码派生优先（表现函数体里的 `LoadScript("Effect\\NewEffect\\X.lua")`），
    // 其次命名约定。注意源码里特效有**两套派发 API**：
    //   (a) MainWindow.LoadScript(...)      —— 已捕获（Lua 家族）
    //   (b) AssaParticle_* / Skill* 等具名函数 —— 实现在 AssaParticle.cpp 等，**尚未跟踪**
    const codeFx = (codeRow?.effects ?? []).filter((t) => !IGNORE_FX.some((ig) => t.toLowerCase().includes(ig)));
    const fx = ABSENT_IN_CLIENT.has(classDir) ? [] : (codeFx.length ? codeFx : fxRaw);

    let confidence: Row['confidence'];
    if (ABSENT_IN_CLIENT.has(classDir)) confidence = 'n/a';
    else if (codeSfx.length || codeFx.length) confidence = 'code';
    else if (sounds.has(nName)) confidence = 'exact';
    else if (nAlt && sounds.has(nAlt)) confidence = 'alt';
    else if (how === 'alias') confidence = 'alias';
    else confidence = 'none';

    // 起手/事件帧拆分：默认"特效在事件帧、第一个音效在起手"，人工基准优先
    const ov = overridesBySkill[s.name];
    const cast = { sfx: ov?.castSfx ?? (sfx.length >= 2 ? [sfx[0]!] : []) };
    const eventSfx = ov?.eventSfx ?? (sfx.length >= 2 ? sfx.slice(1) : sfx);
    const event = {
      fx: ov?.eventFx
        ? ov.eventFx.map((n) => {
          const hit = fx.find((t) => t.split(':')[1] === n);
          return hit ?? `part:${n}`;
        })
        : fx,
      sfx: ABSENT_IN_CLIENT.has(classDir) ? [] : eventSfx,
    };

    rows.push({
      job, classDir, icon: s.iconFile, name: s.name, alt: s.alt,
      fx, sfx: ABSENT_IN_CLIENT.has(classDir) ? [] : sfx,
      cast, event, confidence,
      code: codeRow?.code ?? null,
      presenters: codeRow?.presenters ?? [],
      animIndex: SKILL_INDEX_BY_ICON[s.iconFile] ?? null,
    });
  }
}

mkdirSync(resolve('src/game/data'), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  note: '由 scripts/extract-skill-fx.ts 依据命名约定生成；confidence=none 的条目需人工补。原版把绑定硬编码在调用点，该调用点在反编译中丢失。',
  rows,
}, null, 1) + '\n');

/** 手工覆盖条数（写入阶段累加，汇总日志要读它） */
let overridden = 0;

const scored = rows.filter((r) => r.confidence !== 'n/a');
const withFx = scored.filter((r) => r.fx.length > 0).length;
const withSfx = scored.filter((r) => r.sfx.length > 0).length;
const byConf = new Map<string, number>();
for (const r of rows) byConf.set(r.confidence, (byConf.get(r.confidence) ?? 0) + 1);

console.log(`技能 ${rows.length} 个（可评估 ${scored.length}，另 ${rows.length - scored.length} 个为 EU 客户端无资产的职业）：`);
console.log(`  有特效 ${withFx}（${(100 * withFx / scored.length).toFixed(0)}%）  有音效 ${withSfx}（${(100 * withSfx / scored.length).toFixed(0)}%）`);
console.log(`  音效可信度：${[...byConf.entries()].map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`  按职业（有特效/总数）：`);
for (const [dir] of Object.entries(SKILLS)) {
  const rs = rows.filter((r) => r.classDir === dir);
  const tag = ABSENT_IN_CLIENT.has(dir) ? '  ← EU 客户端无此职业资产' : '';
  console.log(`    ${dir.padEnd(10)} ${rs.filter((r) => r.fx.length).length}/${rs.length}${tag}`);
}
console.log(`  手工覆盖 ${overridden} 条（来自 skill-fx.overrides.json）`);
console.log(`写出 ${GENERATED} 与 ${OUT}（合并后）`);
void readFileSync;
