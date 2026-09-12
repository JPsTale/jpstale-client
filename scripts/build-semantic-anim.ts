/**
 * 生成**语义化动画描述文件**（本方案的主产物）。
 *
 * 定位（见 docs/chars/语义化动画-方案设计.md §0.1）：
 *   它**取代运行时对 `.inx` 的解析** —— 动作表、状态、帧区间、事件帧、职业/武器白名单、
 *   技能绑定、cues 全部在这里；运行时不再需要读 `.inx`。
 *   `.smb` → glb 是**另一件事**（替换姿态容器），与本文档解耦、可晚做。
 *
 * 关键约束：**对姿态容器不可知** —— 帧号一律记**源空间**（原版 .inx 帧索引）+ 声明 fps；
 * 现在按帧索引采样 `.smb`，将来由 glb 换算 clip 时间（frame / fps）。容器可随时替换。
 *
 * 输入（全部已产出、已提交）：
 *   anim-in/anim-m{1..8}.generated.json      698 条条目（.in 明文 → 语义）
 *   anim-in/weapon-codes.generated.json      武器码 → (type, hand)，带来源标注
 *   anim-in/skill-index-map.generated.json   技能→动画索引提案
 *   src/game/skillData.ts                    职业技能表（名称/等级/被动/图标）
 * 输出：src/game/data/semantic/
 *   vocabulary.json   武器类型/单双手/状态/职业/攻击类 等枚举
 *   skills.json       11 职业 × 20 技能
 *   m{1..8}.json      每模型的 sidecar（animations[] + cues 挂点）
 *   variants.json     语义槽 → 条目（多对多；服务端据此选变体）
 *   index.json        清单与校验和
 *   anim.schema.json  JSON Schema
 * 用法：npx tsx scripts/build-semantic-anim.ts
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CHRMOTION_STATE, CLASS_FLAG } from '../src/char/char-format.js';
import { CLASS_DIR, SKILLS } from '../src/game/skillData.js';

const IN_DIR = resolve('src/game/data/anim-in');
const OUT = resolve('src/game/data/semantic');
const GROUPS = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
/** 帧号时间基准。原版动作按帧计，渲染侧一直按 30fps 处理；此处显式声明以便换算。 */
const FPS = 30;

/* ─────────── 载入输入 ─────────── */

interface InEntry {
  inxIndex: number; inxState: string; inxFrames: [number, number]; inxEvents: number[];
  localFrames: [number, number]; motion: string; repeat: boolean; disabled: boolean;
  classes: string[]; locations: string[]; skills: string[];
  weapon: { kind: 'all' | 'none' | 'list'; codes: string[]; unarmed?: boolean };
  weaponSemantics: Array<{ code: string; type: string; hand: string }>;
  note: string;
}
const WC = JSON.parse(readFileSync(resolve(IN_DIR, 'weapon-codes.generated.json'), 'utf8')) as {
  table: Record<string, { type: string; hand: string; src: { type: string; hand: string } }>;
};

/** `.in` 里的职业名 → CLASS_DIR 键（Rogue/Prayer 与 Pikeman/Priest 同组） */
const CLASS_NAME_TO_DIR: Record<string, string> = {
  Fighter: 'fighter', Mechanician: 'mecha', Archer: 'archer', Pikeman: 'pikeman',
  Atalanta: 'atalanta', Knight: 'knight', Magician: 'magician',
  Priest: 'priestess', Prayer: 'priestess', Assassin: 'assassin',
  Shaman: 'shaman', MartialArtist: 'martial', Rogue: 'pikeman',
};
const DIR_TO_CLASS_ID: Record<string, number> = {};
for (const [idStr, dir] of Object.entries(CLASS_DIR)) DIR_TO_CLASS_ID[dir] = Number(idStr);

/* ─────────── 词汇表 ─────────── */

const states: Record<string, number> = {};
for (const [code, name] of Object.entries(CHRMOTION_STATE)) states[name] = Number(code);
const weaponTypes = [...new Set(Object.values(WC.table).map((v) => v.type))].sort();
const hands = [...new Set(Object.values(WC.table).map((v) => v.hand))].sort();
const classNames = Object.fromEntries(
  Object.entries(CLASS_FLAG).map(([name, bit]) => [name, bit]),
);

const vocabulary = {
  format: 'jpstale.vocabulary/1',
  note: '语义词汇表：所有跨文件复用的枚举。生成物，勿手改。',
  fps: FPS,
  states,
  weaponTypes,
  hands,
  /** 武器码 → (类型,单双手) 及来源。hand 为 "?" 表示未定（不猜）。 */
  weaponCodes: WC.table,
  classes: classNames,
  classDirs: CLASS_DIR,
  classDirToId: DIR_TO_CLASS_ID,
  /** `.in` 出现的职业名 → CLASS_DIR 键 */
  classNameToDir: CLASS_NAME_TO_DIR,
};

/* ─────────── 技能表 ─────────── */

interface SkillRow {
  code: number | null; classId: number; slot: number; name: string;
  iconFile: string; reqLv: number; passive: boolean; classDir: string;
}
const skills: SkillRow[] = [];
for (const [dir, list] of Object.entries(SKILLS)) {
  const classId = DIR_TO_CLASS_ID[dir];
  if (!classId) continue;
  list.forEach((sk, i) => {
    skills.push({
      code: null, classId, slot: i + 1, name: sk.name, iconFile: sk.iconFile,
      reqLv: (sk as { reqLv?: number }).reqLv ?? 0,
      passive: (sk as { type?: string }).type === 'Passive', classDir: dir,
    });
  });
}
// 技能 code：用 .in 的技能名 ↔ 条目 inxSkillCodes 反查（名称匹配后再按同职业顺序补齐）
const inEntries: Array<{ grp: string; e: InEntry }> = [];
for (const g of GROUPS) {
  const j = JSON.parse(readFileSync(resolve(IN_DIR, `anim-${g}.generated.json`), 'utf8')) as { entries: InEntry[] };
  for (const e of j.entries) inEntries.push({ grp: g, e });
}
const norm = (x: string) => x.replace(/[\s_\-']/g, '').toUpperCase();
const codeByName = new Map<string, number[]>();
for (const { e } of inEntries) {
  if (!e.skills.length) continue;
  for (const raw of e.skills) {
    for (const nm of raw.split(/\s+/).filter(Boolean)) {
      const k = norm(nm);
      const codes = (e as unknown as { inxSkillCodes?: number[] }).inxSkillCodes ?? [];
      codeByName.set(k, [...(codeByName.get(k) ?? []), ...codes]);
    }
  }
}
let skillMatched = 0;
for (const s of skills) {
  const hit = codeByName.get(norm(s.name));
  if (hit?.length) { s.code = Math.min(...hit); skillMatched++; }
}
// 未匹配的非被动：按同职业代码块顺序补（块起点 = 该职业已匹配 code 的最小值 - (slot-1)）
const blockStart = new Map<number, number>();
for (const s of skills) {
  if (s.code == null) continue;
  const cur = blockStart.get(s.classId);
  const st = s.code - (s.slot - 1);
  if (cur == null || st < cur) blockStart.set(s.classId, st);
}
let skillPositional = 0;
for (const s of skills) {
  if (s.code != null || s.passive) continue;
  const st = blockStart.get(s.classId);
  if (st != null) { s.code = st + (s.slot - 1); skillPositional++; }
}

const skillsDoc = {
  format: 'jpstale.skills/1',
  note: '技能表：11 职业 × 20。code 为 null 表示未定位（被动或无动画）。'
    + 'code 来源：名称匹配（强）后按同职业代码块顺序补齐（中）。生成物，勿手改。',
  stats: { total: skills.length, matched: skillMatched, positional: skillPositional, unresolved: skills.filter((s) => s.code == null).length },
  skills,
};

/* ─────────── sidecar（每模型）─────────── */

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const STATE_SLUG: Record<string, string> = {
  STAND: 'stand', WALK: 'walk', RUN: 'run', SPRINT: 'sprint', ATTACK: 'attack',
  DAMAGE: 'damage', DEAD: 'dead', FALLDOWN: 'falldown', FALLSTAND: 'fallstand',
  FALLDAMAGE: 'falldamage', RESTART: 'restart', EAT: 'eat', WARP: 'warp',
  TAUNT: 'taunt', YAHOO: 'yahoo', SKILL: 'skill', HAMMER: 'hammer',
};

/** 语义前缀（§3.3 文法）：技能名优先，否则 状态 [+ 手/类型] */
function semanticOf(e: InEntry): string {
  if (e.inxState === 'SKILL') {
    const nm = e.skills[0]?.split(/\s+/)[0];
    return nm ? `skill_${slug(nm)}` : 'skill';
  }
  const base = STATE_SLUG[e.inxState] ?? slug(e.inxState);
  const w = e.weapon;
  if (w.kind === 'all') return `${base}_any`;
  const sem = e.weaponSemantics.filter((x) => x.type !== 'SHIELD' && x.type !== 'GEAR');
  const mapped = sem.map((x) => WC.table[x.code] ?? x);
  if (!mapped.length) return w.unarmed ? `${base}_unarmed` : base;
  const hs = [...new Set(mapped.map((m) => m.hand))];
  const ts = [...new Set(mapped.map((m) => m.type))];
  // 有未知手时不硬编手，避免谎报（见 §3.3.1）
  if (hs.some((h) => h !== '1H' && h !== '2H')) return w.unarmed ? `${base}_unarmed` : base;
  const tag = hs.length > 1 ? 'mixed' : ts.length === 1 ? `${hs[0]!.toLowerCase()}_${ts[0]!.toLowerCase()}` : hs[0]!.toLowerCase();
  return w.unarmed ? `${base}_unarmed_${tag}` : `${base}_${tag}`;
}

const variants: Record<string, string[]> = {};
const index: Array<{ model: string; animSet: string; animations: number; clips: string }> = [];
let totalAnim = 0;

mkdirSync(OUT, { recursive: true });
for (const grp of GROUPS) {
  const src = JSON.parse(readFileSync(resolve(IN_DIR, `anim-${grp}.generated.json`), 'utf8')) as { entries: InEntry[] };
  const animSet = grp;                       // 玩家侧 animSet 与模型 1:1（实测，见 §1.2b）
  const seen = new Map<string, number>();    // 同语义重名 → 追加序号
  const animations = src.entries.map((e) => {
    const sem = semanticOf(e);
    const n = (seen.get(sem) ?? 0) + 1; seen.set(sem, n);
    const clip = n > 1 ? `${sem}~${n}.${animSet}.${e.inxIndex}` : `${sem}.${animSet}.${e.inxIndex}`;
    const classIds = [...new Set(e.classes.map((c) => DIR_TO_CLASS_ID[CLASS_NAME_TO_DIR[c] ?? ''] ?? 0).filter(Boolean))];
    const sem2 = e.weaponSemantics.filter((x) => x.type !== 'SHIELD' && x.type !== 'GEAR');
    const slot = sem2.map((x) => {
      const m = WC.table[x.code] ?? x;
      return m.hand === '1H' || m.hand === '2H' ? `${STATE_SLUG[e.inxState] ?? slug(e.inxState)}_${m.hand.toLowerCase()}_${m.type.toLowerCase()}` : null;
    }).filter((x): x is string => !!x);
    for (const s of new Set(slot.length ? slot : [`${STATE_SLUG[e.inxState] ?? slug(e.inxState)}_${e.weapon.kind === 'all' ? 'any' : 'unarmed'}`])) {
      variants[s] = [...(variants[s] ?? []), clip];
    }
    return {
      id: `${animSet}:${e.inxIndex}`, clip, state: e.inxState,
      frames: e.inxFrames, fps: FPS, repeat: e.repeat,
      events: e.inxEvents.map((f, i) => ({ ord: i + 1, frame: f })),
      location: e.locations.includes('마을') && e.locations.includes('필드') ? 'any'
        : e.locations.includes('마을') ? 'village' : 'field',
      classes: classIds,
      ...(e.skills.length ? { skill: e.skills[0]!.split(/\s+/)[0] } : {}),
      weapon: e.weapon.kind === 'all' ? { all: true }
        : { ...(e.weapon.unarmed ? { unarmed: true } : {}), list: [...new Set(sem2.map((x) => { const m = WC.table[x.code] ?? x; return `${m.type}|${m.hand}`; }))].map((k) => { const [type, hand] = k.split('|'); return { type, hand }; }) },
      /** 原版物品码，仅作外部参照（不作匹配键） */
      codes: e.weapon.codes,
      cues: [],                                  // 步骤 3 生成（音效/特效绑定）
      label: e.motion, note: e.note,
    };
  });
  totalAnim += animations.length;
  index.push({ model: animSet, animSet, animations: animations.length, clips: `${animSet}.json` });
  const doc = {
    format: 'jpstale.anim/1',
    note: '语义化动画描述（取代运行时 .inx 解析）。帧号为**源空间**索引，fps 见 model.fps；'
      + '姿态容器可替换（当前 .smb / 将来 glb：clip 时间 = frame / fps）。生成物，勿手改。',
    model: {
      id: animSet, animSet, fps: FPS,
      classes: [...new Set(animations.flatMap((a) => a.classes))].sort((a, b) => a - b),
      skeleton: `${animSet}.glb`, clips: `${animSet}.glb`,
      /** 过渡期：姿态仍来自 .smb/.inx；转 glb 后移除 */
      legacy: { bipInx: `char/tmabcd/${animSet}bip.inx`, bipSmb: `${animSet}.smb` },
    },
    animations,
  };
  const text = JSON.stringify(doc, null, 1) + '\n';
  writeFileSync(resolve(OUT, `${animSet}.json`), text);
  writeFileSync(resolve(OUT, `.${animSet}.sha256`), createHash('sha256').update(text).digest('hex'));
}

writeFileSync(resolve(OUT, 'vocabulary.json'), JSON.stringify(vocabulary, null, 1) + '\n');
writeFileSync(resolve(OUT, 'skills.json'), JSON.stringify(skillsDoc, null, 1) + '\n');
writeFileSync(resolve(OUT, 'variants.json'), JSON.stringify({
  format: 'jpstale.variants/1',
  note: '语义槽 → 满足它的条目 clip（多对多）。一条动画可满足多个槽（其白名单覆盖多种武器）；'
    + '一个槽可被多条动画满足（= 变体，服务端从中随机选）。生成物，勿手改。',
  slotCount: Object.keys(variants).length, variants,
}, null, 1) + '\n');
writeFileSync(resolve(OUT, 'index.json'), JSON.stringify({
  format: 'jpstale.anim-index/1', fps: FPS, totalAnimations: totalAnim, models: index,
}, null, 1) + '\n');

/* JSON Schema（最小可用：结构 + 关键约束） */
writeFileSync(resolve(OUT, 'anim.schema.json'), JSON.stringify({
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'jpstale.anim/1',
  type: 'object',
  required: ['format', 'model', 'animations'],
  properties: {
    format: { const: 'jpstale.anim/1' },
    model: {
      type: 'object', required: ['id', 'animSet', 'fps'],
      properties: { id: { type: 'string' }, animSet: { type: 'string' }, fps: { type: 'number', minimum: 1 } },
    },
    animations: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'clip', 'state', 'frames', 'fps', 'events'],
        properties: {
          id: { type: 'string', pattern: '^[a-z0-9]+:[0-9]+$' },
          clip: { type: 'string', minLength: 1 },
          state: { type: 'string' },
          frames: { type: 'array', items: { type: 'integer' }, minItems: 2, maxItems: 2 },
          fps: { type: 'number' },
          repeat: { type: 'boolean' },
          events: {
            type: 'array',
            items: { type: 'object', required: ['ord', 'frame'], properties: { ord: { type: 'integer' }, frame: { type: 'integer' } } },
          },
          location: { enum: ['village', 'field', 'any'] },
          classes: { type: 'array', items: { type: 'integer' } },
          skill: { type: 'string' },
        },
      },
    },
  },
}, null, 1) + '\n');

console.log(`sidecar：${GROUPS.length} 个，条目合计 ${totalAnim}`);
console.log(`skills.json：${skillsDoc.stats.total} 条（名称匹配 ${skillMatched} / 顺序推 ${skillPositional} / 未定 ${skillsDoc.stats.unresolved}）`);
console.log(`variants.json：${Object.keys(variants).length} 个语义槽`);
console.log(`写出 ${OUT}/{vocabulary,skills,variants,index}.json + m{1..8}.json + anim.schema.json`);
