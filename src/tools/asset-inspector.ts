/**
 * 资产检查器（Asset Inspector）—— 开发工具。
 *
 * 解决的问题：粒子/音效/动画的"适配情况"只能逐项观察确认，且
 * 「技能 → 特效/音效」的映射表在参考源码中已遗失（服务端 skilldb 只有数值列），
 * 必须靠本工具逐条观察实际效果来重建。
 *
 * 能力：任意伪造 职业/脸/装甲/体型/主副手武器 → 查看任意动作、每个技能的
 * 动画匹配情况与音效解析结果，并把"期望路径 vs 实际拿到"的缺口列出来。
 *
 * 匹配判定复用生产代码（anim-match 的 findMotions/findMotionsByType），
 * 不另写一套规则，避免"检查器说没问题、游戏里却没动画"。
 */
import { createCharStage, type CharStage, type InspectorAppearance, type DiagEntry } from './inspector/char-stage.js';
import { el, section, selectRow, rangeRow, checkRow, btnRow, infoRow } from './inspector/dom.js';
import {
  JOBS, weaponOptions, groupWeaponsByType, skillsForJob, skillAnimCoverage,
  motionLabel, playerMotionFiles, sfxBank, CORE_PLAYER_STATES, type SkillRow,
  FACE_RANGE, TIER_RANGE,
} from './inspector/model.js';
import modelListRaw from './inspector/data/model-list.json';
import effectListRaw from './inspector/data/effect-list.json';
import skillFxRaw from '../game/data/skill-fx.json';
import { JOB_DATA } from '../render/char-loader.js';
import { FIT_LABEL, pickSemanticMotion, type SemanticEntry } from '../char/anim-match.js';
import { motionStateName, decodeClassFlags } from '../char/char-format.js';
import { fallbacks } from '../char/fallback-log.js';
import { getWeaponTypeFromIdCode, getHandTypeFromIdCode, getHandType } from '../char/weapon-type.js';
import { sfx, weaponSoundCode } from '../audio/sfx.js';
import type { MotionInfo } from '../char/char-format.js';

/* ─────────── 页面骨架 ─────────── */

const app = document.getElementById('app') as HTMLElement;
const leftEl = document.getElementById('left') as HTMLElement;
const rightEl = document.getElementById('right') as HTMLElement;
const bottomEl = document.getElementById('bottom') as HTMLElement;

const stage: CharStage = createCharStage(app);

/* ─────────── 状态 ─────────── */

const appearance: InspectorAppearance = {
  jobId: 6,
  faceNum: 0,
  tier: 0,
  armorNum: 1,
  sizeLevel: 0,
  weaponIdcode: 0,
  weaponDorp: '',
  weaponPos: 4,
  offHandIdcode: 0,
  offHandDorp: '',
  offHandKind: 0,
  offHandPos: 2,
  bodyInxOverride: null,
};

/** 检查器用：当前是否"法师/祭司"（钝器走吟唱音，对齐原版 WeaponPlaySound） */
function isCaster(): boolean {
  return appearance.jobId === 7 || appearance.jobId === 8;
}

/* ── 检查目标：玩家职业 / 怪物·NPC 模型 ── */

interface ModelEntry { p: string; cat: string }
const MODEL_LIST = modelListRaw as unknown as ModelEntry[];

let targetMode: 'player' | 'model' = 'player';
let modelPath = '';
/** 当前目标的音效目录键：怪物/NPC = 模型 basename；玩家为空（走职业目录） */
let soundKey = '';
/** 当前目标是否玩家（决定装备/职业音效面板是否可用） */
let targetIsPlayer = true;

/** 当前目标在某动作态下的音效候选文件（玩家走职业目录，怪物/NPC 走模型目录） */
function motionSoundFiles(motion: string): string[] {
  if (targetIsPlayer) {
    return playerMotionFiles(appearance.jobId, motion as Parameters<typeof playerMotionFiles>[1]);
  }
  return soundKey ? sfxBank.charFiles(soundKey, motion as Parameters<typeof sfxBank.charFiles>[1]) : [];
}

/** 体型变调（原版 Feq：SizeLevel ≥ 0x1000 → 2800，基准 2205） */
/** 事件帧触发的攻击音模式（对齐源码 `AttackCritcal < 0` 的分支） */
let attackSoundMode: 'hit' | 'miss' | 'crit' = 'hit';

function pitchOf(): number {
  return appearance.sizeLevel >= 0x1000 ? 2800 / 2205 : 1;
}

let lastDiag: DiagEntry[] = [];
/** 走查中收集的异常 */
const anomalies: string[] = [];

function log(msg: string): void {
  const box = document.getElementById('log');
  if (!box) return;
  box.textContent += msg + '\n';
  box.scrollTop = box.scrollHeight;
}

/* ─────────── 顶部状态 ─────────── */

function refreshHud(): void {
  const hud = document.getElementById('hud');
  if (!hud) return;
  const m = stage.currentMotion();
  const motionTxt = m
    ? `动作 ${motionStateName(m.state)} [${m.startFrame},${m.endFrame}] frame=${Math.round(stage.currentFrame())}`
    : '动作 —';
  let head: string;
  if (targetMode === 'player') {
    const wType = appearance.weaponIdcode ? (getWeaponTypeFromIdCode(appearance.weaponIdcode) ?? '?') : '空手';
    head = `玩家 职业 ${appearance.jobId} | 装甲 ${appearance.armorNum} | 脸 ${appearance.faceNum}/tier ${appearance.tier} `
      + `| 主手 ${appearance.weaponDorp || '无'}(${wType})`
      + (appearance.offHandDorp ? ` | 副手 ${appearance.offHandDorp}` : '');
  } else {
    head = `模型 ${modelPath || '—'}${soundKey ? ` | 音效目录 ${soundKey}` : ' | ⚠ 无同名音效目录'}`;
  }
  hud.textContent = [head, motionTxt, `motion ${stage.motions().length}`].join('  |  ');
}

/* ─────────── 检查目标面板 ─────────── */

function buildTargetPanel(): void {
  const body = section(leftEl, '检查目标（玩家 / 怪物·NPC）');
  body.id = 'ins-target';

  let modelSel: HTMLSelectElement | null = null;

  selectRow(body, '目标类型', [
    { value: 'player', text: '玩家职业' },
    { value: 'model', text: `怪物 / NPC / 宠物（${MODEL_LIST.length} 个）` },
  ], 'player', (v) => {
    targetMode = v === 'model' ? 'model' : 'player';
    // 切到模型模式时若未选过，默认取第一只怪，避免空白
    if (targetMode === 'model' && !modelPath) {
      const first = MODEL_LIST.find((m) => m.cat === 'monster') ?? MODEL_LIST[0];
      if (first) modelPath = first.p;
      if (modelSel && modelPath) modelSel.value = modelPath;
    }
    setLeftMode();
    void reload(true);
  }).id = 'ins-target-mode';

  // 模型过滤 + 列表（731 条，靠过滤框缩小范围）
  const row = el('div', 'ins-row');
  row.appendChild(el('label', 'ins-label', '过滤'));
  const filter = el('input', 'ins-text');
  filter.placeholder = '如 acero / npc / golem';
  filter.id = 'ins-model-filter';
  row.appendChild(filter);
  body.appendChild(row);

  modelSel = selectRow(body, '模型', modelOptions(''), modelPath, (v) => {
    modelPath = v;
    void reload(true);
  });
  modelSel.id = 'ins-model';
  filter.oninput = () => {
    const keep = modelSel.value;
    const next = modelOptions(filter.value);
    modelSel.innerHTML = '';
    for (const o of next) {
      const opt = el('option', undefined, o.text);
      opt.value = o.value;
      modelSel.appendChild(opt);
    }
    if (next.some((o) => o.value === keep)) modelSel.value = keep;
  };

  // 任意 .inx 路径直载（吸收自 pviewer 的"解析 .inx"）
  const inx = el('input', 'ins-text');
  inx.placeholder = 'char/monster/xxx/xxx.inx';
  inx.id = 'ins-inx-path';
  const inxRow = el('div', 'ins-row');
  inxRow.append(el('label', 'ins-label', '按 .inx 直载'), inx);
  const go = el('button', 'ins-btn', '加载');
  go.onclick = () => {
    const p = inx.value.trim().replace(/\\/g, '/').toLowerCase();
    if (!p) return;
    targetMode = 'model';
    modelPath = p;
    setLeftMode();
    void reload(true);
  };
  inxRow.appendChild(go);
  body.appendChild(inxRow);
}

function modelOptions(filter: string): Array<{ value: string; text: string }> {
  const f = filter.trim().toLowerCase();
  const list = f ? MODEL_LIST.filter((m) => m.p.includes(f)) : MODEL_LIST;
  return list.slice(0, 600).map((m) => ({ value: m.p, text: `[${m.cat}] ${m.p}` }));
}

/** 玩家模式下隐藏/禁用仅玩家适用的面板 */
function setLeftMode(): void {
  const playerOnly = ['ins-sec-char', 'ins-sec-equip'];
  for (const id of playerOnly) {
    const sec = document.getElementById(id);
    if (!sec) continue;
    sec.classList.toggle('ins-disabled', targetMode !== 'player');
    sec.style.opacity = targetMode === 'player' ? '' : '0.4';
    (sec as HTMLElement).style.pointerEvents = targetMode === 'player' ? '' : 'none';
  }
}

/* ─────────── 特效面板（INI 广告牌） ─────────── */

const EFFECT_LIST = effectListRaw as unknown as Array<{ n: string; f: 'ini' | 'part' }>;
/** 特效相对演员的偏移（缺省身前胸口高度） */
let fxOffset = { x: 0, y: 25, z: 30 };

function buildEffectPanel(): void {
  const body = section(rightEl, '特效（INI 广告牌 + .part 粒子）');
  body.id = 'ins-sec-fx';

  const iniN = EFFECT_LIST.filter((e) => e.f === 'ini').length;
  selectRow(
    body, '特效',
    EFFECT_LIST.map((e) => ({ value: e.n, text: `[${e.f}] ${e.n}` })),
    '', () => { /* 选中即用 */ },
  ).id = 'ins-fx';

  btnRow(body, [
    { label: '▶ 播放', title: '在当前演员位置播放一次', onClick: () => void playEffect() },
    {
      label: '连播 3 次', onClick: () => {
        void playEffect();
        setTimeout(() => void playEffect(), 250);
        setTimeout(() => void playEffect(), 500);
      },
    },
  ]);
  btnRow(body, [
    { label: '身前', onClick: () => { fxOffset = { x: 0, y: 25, z: 30 }; } },
    { label: '胸口', onClick: () => { fxOffset = { x: 0, y: 25, z: 0 }; } },
    { label: '头顶', onClick: () => { fxOffset = { x: 0, y: 55, z: 0 }; } },
    { label: '地面', onClick: () => { fxOffset = { x: 0, y: 0, z: 0 }; } },
  ]);

  const out = el('div', 'ins-note');
  out.id = 'ins-fx-diag';
  body.appendChild(out);
  infoRow(body, '说明', `共 ${EFFECT_LIST.length} 个（INI ${iniN} + .part ${EFFECT_LIST.length - iniN}）；INI 帧时长按 70Hz，.part 用脚本自带参数`);
}

/** 播放特效面板当前选中的那个 */
async function playEffect(): Promise<void> {
  const sel = document.getElementById('ins-fx') as HTMLSelectElement | null;
  if (sel?.value) await playNamedEffect(sel.value);
}

/** 播放指定名字的特效（技能面板的 fx 芯片也走这里），并刷新诊断 */
async function playNamedEffect(name: string): Promise<void> {
  const ok = await stage.spawnEffect(name, fxOffset);
  const sel = document.getElementById('ins-fx') as HTMLSelectElement | null;
  if (sel && sel.value !== name) sel.value = name;
  const fam = EFFECT_LIST.find((e) => e.n === name)?.f;
  const d = stage.effectDiag();
  const pd = stage.partDiag();
  const out = document.getElementById('ins-fx-diag');
  if (out) {
    if (fam === 'part' && pd) {
      out.textContent = `${ok ? '✓ 已播放（.part 发射器）' : '✗ 未能播放'}\n`
        + `${pd.scriptPath}\n`
        + `emitter ${pd.emitterCount} 个\n`
        + `贴图: ${pd.textures.filter(Boolean).join(', ') || '(无)'}`
        + (pd.missing.length ? `\n⚠ 缺失 ${pd.missing.length}: ${pd.missing.slice(0, 3).join(', ')}` : '');
    } else if (d) {
      out.textContent = `${ok ? '✓ 已播放（INI 广告牌）' : '✗ 未能播放（无贴图/资源缺失）'}\n`
        + `${d.animationIni}\n`
        + `ImageData: ${d.imageIni ?? '(无 DataFile)'}\n`
        + `Blend=${d.blend}  Size 段=${d.hasSize ? '有' : '无(用默认尺寸)'}\n`
        + `帧 ${d.framePaths.length} 张`
        + (d.missing.length ? `\n⚠ 缺失 ${d.missing.length}: ${d.missing.slice(0, 4).join(', ')}` : '');
    } else {
      out.textContent = '(无解析结果)';
    }
  }
  log(`[特效] ${name}(${fam ?? '?'}) → ${ok ? 'OK' : '失败'}`);
}

/* ─────────── 动画映射对照（原版直出 ↔ 派生语义） ─────────── */

import animM1 from '../game/data/anim/anim-m1.generated.json';
import animM2 from '../game/data/anim/anim-m2.generated.json';
import animM3 from '../game/data/anim/anim-m3.generated.json';
import animM4 from '../game/data/anim/anim-m4.generated.json';
import animM5 from '../game/data/anim/anim-m5.generated.json';
import animM6 from '../game/data/anim/anim-m6.generated.json';
import animM7 from '../game/data/anim/anim-m7.generated.json';
import animM8 from '../game/data/anim/anim-m8.generated.json';
// 权威语义（11 职业服务端 .in 明文）
import inM1 from '../game/data/anim-in/anim-m1.generated.json';
import inM2 from '../game/data/anim-in/anim-m2.generated.json';
import inM3 from '../game/data/anim-in/anim-m3.generated.json';
import inM4 from '../game/data/anim-in/anim-m4.generated.json';
import inM5 from '../game/data/anim-in/anim-m5.generated.json';
import inM6 from '../game/data/anim-in/anim-m6.generated.json';
import inM7 from '../game/data/anim-in/anim-m7.generated.json';
import inM8 from '../game/data/anim-in/anim-m8.generated.json';
// 语义化动画描述文件（本方案主产物；取代运行时 .inx 解析）
import semM1 from '../game/data/semantic/m1.json';
import semM2 from '../game/data/semantic/m2.json';
import semM3 from '../game/data/semantic/m3.json';
import semM4 from '../game/data/semantic/m4.json';
import semM5 from '../game/data/semantic/m5.json';
import semM6 from '../game/data/semantic/m6.json';
import semM7 from '../game/data/semantic/m7.json';
import semM8 from '../game/data/semantic/m8.json';
import semVariantsRaw from '../game/data/semantic/variants.json';
import { renderSemanticPanel, type SemanticDoc } from './inspector/semantic-panel.js';
import { getSheatheSlot } from '../char/weapon-type.js';
import { openItemPicker, type PickerItem } from './inspector/item-picker.js';

const SEM_DOCS: Record<string, SemanticDoc> = {
  m1: semM1 as unknown as SemanticDoc, m2: semM2 as unknown as SemanticDoc,
  m3: semM3 as unknown as SemanticDoc, m4: semM4 as unknown as SemanticDoc,
  m5: semM5 as unknown as SemanticDoc, m6: semM6 as unknown as SemanticDoc,
  m7: semM7 as unknown as SemanticDoc, m8: semM8 as unknown as SemanticDoc,
};
const SEM_VARIANTS = (semVariantsRaw as unknown as { variants: Record<string, string[]> }).variants;

interface XrefEntry {
  id: string; state: string; frames: [number, number]; repeat: boolean;
  eventFrames: number[]; classes: string[];
  weapon: { any: boolean; unarmed: boolean; list: Array<{ type: string; hand: string }> };
  skills: string[]; location: string;
  raw: { index: number; itemCodes: number[]; skillCodes: number[]; motionFrame: number };
  xref: {
    idcodeTypes: string[]; iconFamilies: string[];
    /** 白名单码数 / 能查到 idcode 的码数；sItem 表缺新武器是常态，不是错误 */
    coverage: { total: number; resolved: number };
    coverageLevel: string;
    frameSignature?: { hitSettlements: number; spanFrames: number };
  };
}
const ANIM_GROUPS: Record<string, XrefEntry[]> = {
  m1: (animM1 as unknown as { entries: XrefEntry[] }).entries,
  m2: (animM2 as unknown as { entries: XrefEntry[] }).entries,
  m3: (animM3 as unknown as { entries: XrefEntry[] }).entries,
  m4: (animM4 as unknown as { entries: XrefEntry[] }).entries,
  m5: (animM5 as unknown as { entries: XrefEntry[] }).entries,
  m6: (animM6 as unknown as { entries: XrefEntry[] }).entries,
  m7: (animM7 as unknown as { entries: XrefEntry[] }).entries,
  m8: (animM8 as unknown as { entries: XrefEntry[] }).entries,
};

/* ── 权威语义：来自 11 职业服务端 `.in` 明文（职业名/武器代码/技能名）──
   这是**首选**来源；上面 ANIM_GROUPS 那套是从 .inx 的 sItem 索引反推的，
   而 sItem 表缺新武器/新职业，故只能作兜底。
   键用帧区间而非 index：`.in` 配的是 Server 侧 .inx，其 index 与我方 .inx 会错位，
   但帧区间已验证一致（m6/m8 全等，m1 148/150）。 */

interface InAnimEntry {
  inxIndex: number; inxState: string; inxFrames: [number, number]; inxEvents: number[];
  localFrames: [number, number]; collection: string; motion: string;
  repeat: boolean; disabled: boolean; classes: string[]; locations: string[]; skills: string[];
  weapon: { kind: 'all' | 'none' | 'list'; codes: string[]; unarmed?: boolean };
  weaponSemantics: Array<{ code: string; type: string; hand: string }>;
  note: string;
}
const IN_ENTRIES: Record<string, InAnimEntry[]> = {
  m1: (inM1 as unknown as { entries: InAnimEntry[] }).entries,
  m2: (inM2 as unknown as { entries: InAnimEntry[] }).entries,
  m3: (inM3 as unknown as { entries: InAnimEntry[] }).entries,
  m4: (inM4 as unknown as { entries: InAnimEntry[] }).entries,
  m5: (inM5 as unknown as { entries: InAnimEntry[] }).entries,
  m6: (inM6 as unknown as { entries: InAnimEntry[] }).entries,
  m7: (inM7 as unknown as { entries: InAnimEntry[] }).entries,
  m8: (inM8 as unknown as { entries: InAnimEntry[] }).entries,
};
/** 当前职业所在组 */
function groupOf(): string | null {
  if (targetMode !== 'player') return null;
  return GROUP_BY_JOB[appearance.jobId] ?? null;
}
/** 组 → (帧区间 → 该区间内的变体列表，按文件顺序)。
 *  同一帧区间常有多条变体（我方 m1 #17/#18 都是 386-414；.in 里 걷는동작2a/2b 也都是 42-70），
 *  故不能只用帧区间做键 —— 会互相覆盖。按"区间内序号"配对。 */
const IN_BY_FRAMES = new Map<string, Map<string, InAnimEntry[]>>();
function inEntryFor(start: number, end: number, nth: number): InAnimEntry | null {
  const grp = groupOf();
  if (!grp) return null;
  let m = IN_BY_FRAMES.get(grp);
  if (!m) {
    m = new Map();
    for (const e of IN_ENTRIES[grp] ?? []) {
      const k = `${e.inxFrames[0]}-${e.inxFrames[1]}`;
      m.set(k, [...(m.get(k) ?? []), e]);
    }
    IN_BY_FRAMES.set(grp, m);
  }
  const list = m.get(`${start}-${end}`);
  return list?.[nth] ?? list?.[0] ?? null;
}

/** 玩家职业 → motion 组（由 JOB_DATA 的 bipInx 推出；job 11 暂无 JOB_DATA 条目） */
const GROUP_BY_JOB: Record<number, string> = {};
for (const [id, job] of Object.entries(JOB_DATA)) {
  const m = /(m\d+)bip\.inx$/i.exec(job.bipInx);
  if (m) GROUP_BY_JOB[Number(id)] = m[1]!.toLowerCase();
}
/** 组 → (原版 index → 派生条目)；与「全部 motion 条目」按 index 配对 */
const XREF_BY_INDEX = new Map<string, Map<number, XrefEntry>>();
function xrefFor(index: number): XrefEntry | null {
  if (targetMode !== 'player') return null;          // 怪物/NPC 尚无结构化数据
  const grp = GROUP_BY_JOB[appearance.jobId];
  const entries = grp ? ANIM_GROUPS[grp] : undefined;
  if (!entries) return null;
  let m = XREF_BY_INDEX.get(grp!);
  if (!m) { m = new Map(entries.map((e) => [e.raw.index, e])); XREF_BY_INDEX.set(grp!, m); }
  return m.get(index) ?? null;
}

/** 只显示冲突 / 全部 */
let animXrefOnlyConflict = false;
let animXrefGroup = 'm1';

/** 「全部 motion 条目」的只看冲突开关（独立于上面的按组对照表：这里是边播边核） */
let motionOnlyConflict = false;
let motionFilterBar: HTMLElement | null = null;
let motionHead: HTMLElement | null = null;
/** 动作列表查看的组：auto=跟随当前职业；m1..m8=只看该组（无需加载模型，只读浏览） */
let motionGroupView = 'auto';

function buildAnimXrefPanel(): void {
  const body = section(rightEl, '动画映射对照（原版 ↔ 派生）', true);
  body.id = 'ins-sec-xref';

  selectRow(body, 'motion 组', Object.keys(ANIM_GROUPS).map((g) => ({ value: g, text: g })),
    animXrefGroup, (v) => { animXrefGroup = v; renderAnimXref(); }).id = 'ins-xref-group';
  checkRow(body, '只看白名单未解析', false, (v) => { animXrefOnlyConflict = v; renderAnimXref(); });

  const stat = el('div', 'ins-note');
  stat.id = 'ins-xref-stat';
  body.appendChild(stat);
  const host = el('div', 'ins-xref-host');
  host.id = 'ins-xref-host';
  body.appendChild(host);
  infoRow(body, '配对依据', '原版 index 与帧起止（原始信号，不经语义推导）');
  infoRow(body, '“道具异常”含义', '白名单里有“名称暗示的武器类型 ≠ idcode 类型”的道具；根因只在少数道具本身，见 anim/item-anomalies.generated.json');
}

/** 渲染两列对照：左=原版直出，右=我派生的映射 */
function renderAnimXref(): void {
  const host = document.getElementById('ins-xref-host');
  const stat = document.getElementById('ins-xref-stat');
  if (!host) return;
  const all = ANIM_GROUPS[animXrefGroup] ?? [];
  const list = animXrefOnlyConflict ? all.filter((e) => e.xref.coverageLevel === 'none') : all;
  const conf = { full: 0, partial: 0, none: 0, empty: 0 } as Record<string, number>;
  for (const e of all) conf[e.xref.coverageLevel] = (conf[e.xref.coverageLevel] ?? 0) + 1;
  if (stat) {
    stat.textContent = `${animXrefGroup}：${all.length} 条　` +
      `全部解析 ${conf.full ?? 0}　部分解析 ${conf.partial ?? 0}　一条未解析 ${conf.none ?? 0}　无白名单 ${conf.empty ?? 0}` +
      (animXrefOnlyConflict ? `\n（只显示 ${list.length} 条）` : '') +
      `\n注：这是**覆盖率**不是对错 —— sItem 表天然缺新职业/新武器，解析不出是常态。`
      + `\n待补清单见 anim/sitem-unresolved-indices.generated.json`;
  }

  host.innerHTML = '';
  const CAP = 150;
  for (const e of list.slice(0, CAP)) {
    const row = el('div', `ins-xr ins-xr--${e.xref.coverageLevel === 'none' ? 'bad' : e.xref.coverageLevel === 'full' ? 'ok' : 'na'}`);
    // 左列：原版直出
    const l = el('div', 'ins-xr-l');
    l.textContent = `#${e.raw.index}  帧[${e.frames[0]},${e.frames[1]}]${e.repeat ? '↻' : ''}  ${e.state}`
      + `  码[${e.raw.itemCodes.slice(0, 6).join(',')}${e.raw.itemCodes.length > 6 ? '…' : ''}]`
      + (e.xref.iconFamilies.length ? `  图标[${e.xref.iconFamilies.join(',')}]` : '')
      + (e.xref.idcodeTypes.length ? `  类型[${e.xref.idcodeTypes.join(',')}]` : '')
      + (e.raw.skillCodes.length ? `  技能码[${e.raw.skillCodes.join(',')}]` : '')
      + `  位置=${e.raw.motionFrame}`;
    // 右列：派生语义
    const r = el('div', 'ins-xr-r');
    r.textContent = `${e.id}  帧[${e.frames[0]},${e.frames[1]}]  `
      + (e.weapon.any ? '武器任意' : (e.weapon.unarmed ? '空手' : e.weapon.list.map((w) => `${w.hand}-${w.type}`).join(',')))
      + `  职业[${e.classes.join('/')}]`
      + (e.skills.length ? `  技能[${e.skills.join('/')}]` : '')
      + `  ${e.location}`
      + (e.eventFrames.length ? `  ev[${e.eventFrames.join(',')}]` : '');
    // 白名单覆盖率 + 未解析时的帧特征（索引解析不出来时，靠这个识别条目）
    const cv = el('div', 'ins-xr-c',
      `白名单 ${e.xref.coverage.resolved}/${e.xref.coverage.total}`
      + (e.xref.coverageLevel === 'none' && e.xref.frameSignature
        ? `　⚠ 一条未解析　结算帧×${e.xref.frameSignature.hitSettlements}　跨度${e.xref.frameSignature.spanFrames}帧`
        : ''));
    if (e.xref.coverageLevel === 'none') cv.classList.add('ins-xr-inline--bad');
    r.appendChild(cv);
    row.append(l, r);
    host.appendChild(row);
  }
  if (list.length > CAP) host.appendChild(el('div', 'ins-dim', `… 另有 ${list.length - CAP} 条未显示`));
}

/* ─────────── 角色面板 ─────────── */

function buildCharPanel(): void {
  const body = section(leftEl, '角色');
  body.parentElement!.id = 'ins-sec-char';
  const jobSel = selectRow(
    body, '职业',
    JOBS.map((j) => ({
      value: String(j.id),
      text: `${j.label}${j.hasModel ? '' : '  ⚠ 无模型'}  (${j.skillCount} 技能)`,
    })),
    String(appearance.jobId),
    (v) => { appearance.jobId = Number(v); void reload(true); },
  );
  jobSel.title = 'JOB_DATA 只覆盖职业 1-10；11(martial) 无模型数据';
  jobSel.id = 'ins-job';

  rangeRow(body, '装甲 armorNum', 1, 25, 1, appearance.armorNum, (v) => { appearance.armorNum = v; void reload(); });
  // 脸/头饰：走**局部换头**（不动骨架与 mixer），而不是整体 reload ——
  // 后者会重建动画（换脸后动作被重置）并造成撕裂。
  const doSwapHead = (): void => {
    void stage.swapHead(appearance).then((r) => {
      log(`[头部] 局部换头 face=${appearance.faceNum} tier=${appearance.tier}`
        + ` 纹理 ${r.loaded} 成功/${r.failed.length} 失败`
        + (r.note ? `　⚠ ${r.note}` : '')
        + (r.failed.length ? `：${r.failed.slice(0, 3).join(', ')}` : '　（骨架/动画未动）'));
      refreshHud();
    });
  };
  // 范围一律取自 char-loader 的常量（**唯一来源**，由头部资产推导）—— 曾在此硬编码 `0, 3`、
  // 且常量另写一份 0..9，导致界面缺第 5 档与脸 11~13（用户实测）。
  rangeRow(body, '脸 faceNum', FACE_RANGE.min, FACE_RANGE.max, 1, appearance.faceNum, (v) => { appearance.faceNum = v; doSwapHead(); });
  rangeRow(body, '头饰 tier', TIER_RANGE.min, TIER_RANGE.max, 1, appearance.tier, (v) => { appearance.tier = v; doSwapHead(); });
  rangeRow(body, '体型 sizeLevel', 0, 0x2000, 0x1000, appearance.sizeLevel, (v) => { appearance.sizeLevel = v; refreshHud(); });

  btnRow(body, [
    { label: '全身', onClick: () => stage.setCamera('full'), title: '相机预设：全身' },
    { label: '上半身', onClick: () => stage.setCamera('upper') },
    { label: '武器特写', onClick: () => stage.setCamera('weapon') },
  ]);

  // 该职业的音效预览（受击/死亡，走职业目录）
  btnRow(body, [
    {
      label: '受击音', onClick: () => {
        const files = motionSoundFiles('CHRMOTION_STATE_DAMAGE');
        log(`[音效] 受击 → ${files.length ? files.join(', ') : '（该目标无受击音）'}`);
        playMotionSound('CHRMOTION_STATE_DAMAGE');
      },
    },
    {
      label: '死亡音', onClick: () => {
        const files = motionSoundFiles('CHRMOTION_STATE_DEAD');
        log(`[音效] 死亡 → ${files.length ? files.join(', ') : '（该目标无死亡音）'}`);
        playMotionSound('CHRMOTION_STATE_DEAD');
      },
    },
  ]);
}

/** 播放当前目标在某动作态下的音效（玩家=职业目录，怪物/NPC=模型目录） */
function playMotionSound(motion: 'CHRMOTION_STATE_DAMAGE' | 'CHRMOTION_STATE_DEAD' | 'CHRMOTION_STATE_ATTACK'): void {
  const pos = { x: 0, y: 0, z: 0 };
  if (targetIsPlayer) sfx.playPlayerSound(appearance.jobId, motion, pos);
  else if (soundKey) sfx.playSoundByName(soundKey, motion, pos);
}

/* ─────────── 装备面板 ─────────── */

let overrideRowEl: HTMLElement | null = null;
let overrideInput: HTMLInputElement | null = null;
/** 模型码独立覆盖开关（用于暴露"动画白名单与可见模型不匹配"） */
let overrideActive = false;

function buildEquipPanel(): void {
  const body = section(leftEl, '装备');
  body.parentElement!.id = 'ins-sec-equip';

  // 主手：按武器类型分组
  const opts = weaponOptions(isCaster());
  const groups = groupWeaponsByType(opts);
  const optList: Array<{ value: string; text: string }> = [{ value: '', text: '（空手）' }];
  for (const [type, list] of [...groups.entries()].sort()) {
    for (const w of list) {
      optList.push({ value: String(w.def.id), text: `[${type}·${w.hand}] ${w.def.name}` });
    }
  }

  // 主手：弹框选择（替代原 select —— 带分类标签 + 详情面板）
  const applyWeapon = (w: { def: { id: number; code: number; icon: string; pos: number } } | null) => {
    if (!w) { appearance.weaponIdcode = 0; appearance.weaponDorp = ''; }
    else {
      appearance.weaponIdcode = w.def.code;
      appearance.weaponDorp = w.def.icon;   // icon = codeImg1 = weaponDorp（已核实）
      appearance.weaponPos = w.def.pos;
    }
    if (overrideInput && !overrideActive) overrideInput.value = appearance.weaponDorp;
    void reload();
  };
  const pickRow = el('div', 'ins-row');
  pickRow.appendChild(el('label', 'ins-label', '主手武器'));
  const pickBtn = el('button', 'ins-btn', '选择武器…') as HTMLButtonElement;
  pickBtn.id = 'ins-weapon-pick';
  const pickCur = el('span', 'ins-dim', '（未装备）');
  pickCur.id = 'ins-weapon-cur';
  pickBtn.onclick = () => openItemPicker(
    opts.map((o) => {
      const sl = getSheatheSlot(o.def.code);   // 分层解析：语义表 → 源码表 → 族规则 → default
      return { ...o.def, type: o.type, hand: o.hand, soundCode: o.soundCode,
        sheatheSlot: sl.slot, sheatheSrc: sl.src };
    }) as PickerItem[],
    (it) => applyWeapon(it ? opts.find((o) => o.def.id === it.id) ?? null : null),
    String(opts.find((o) => o.def.code === appearance.weaponIdcode)?.def.id ?? ''),
  );
  pickRow.append(pickBtn, pickCur);
  body.appendChild(pickRow);
  checkRow(body, '战斗姿态（持械→只用专属条目；非战斗=武器收起→空手动画）', combatStance, (v) => {
    combatStance = v;
    applyStance(true);   // 显式切换 → 强制应用
  });
  void optList;

  // 装备摘要：这把武器决定了哪四件事（refreshEquipInfo 填充）
  const info = el('div', 'ins-note');
  info.id = 'ins-equip-info';
  body.appendChild(info);

  // 故意留的覆盖：让 idcode（动画白名单）与 dorp（可见模型）不一致
  const ov = checkRow(body, '模型码独立覆盖（用于暴露动画/模型不匹配）', false, (v) => {
    overrideActive = v;
    if (overrideRowEl) overrideRowEl.style.display = v ? '' : 'none';
    if (v && overrideInput) overrideInput.value = appearance.weaponDorp;
  });
  void ov;
  overrideRowEl = el('div', 'ins-row');
  overrideRowEl.style.display = 'none';
  overrideInput = el('input', 'ins-text');
  overrideInput.placeholder = '如 wa101';
  overrideInput.onchange = () => { appearance.weaponDorp = overrideInput!.value.trim(); void reload(); };
  overrideRowEl.append(el('label', 'ins-label', 'dorp 模型码'), overrideInput);
  body.appendChild(overrideRowEl);

  // 副手：盾按名称筛（itemlist 无副手分类字段），匕首按武器语义类型筛
  const allWeapons = weaponOptions(isCaster());
  const offOpts: Array<{ value: string; text: string; kind: 1 | 2 }> = [];
  for (const d of allWeapons) {
    if (/shield|buckler/i.test(d.def.name)) offOpts.push({ value: String(d.def.id), text: `[盾] ${d.def.name}`, kind: 1 });
    else if (d.type === 'DAGGER') offOpts.push({ value: String(d.def.id), text: `[匕首] ${d.def.name}`, kind: 2 });
  }
  selectRow(body, '副手（盾/匕首）', [{ value: '', text: '（无）' }, ...offOpts.map(({ value, text }) => ({ value, text }))], '', (v) => {
    const picked = offOpts.find((o) => o.value === v);
    if (!picked) {
      appearance.offHandDorp = ''; appearance.offHandIdcode = 0; appearance.offHandKind = 0;
    } else {
      const w = allWeapons.find((o) => String(o.def.id) === v)!;
      appearance.offHandDorp = w.def.icon;
      appearance.offHandIdcode = w.def.code;
      appearance.offHandKind = picked.kind;
      appearance.offHandPos = 2;
    }
    void reload();
  }).id = 'ins-offhand';
  infoRow(body, '说明', '盾按名称筛（itemlist 无副手分类字段），匕首按 DAGGER 类型筛');

  refreshEquipInfo();
}

/** 主手决定的四项（武器类型/单双手/音效码/模型）+ 音效试听 */
function refreshEquipInfo(): void {
  const info = document.getElementById('ins-equip-info');
  if (!info) return;
  info.innerHTML = '';
  if (!appearance.weaponIdcode) {
    info.textContent = '空手：武器类型 BARE_HAND → 攻击音效码 14(punch hit)';
    return;
  }
  const type = getWeaponTypeFromIdCode(appearance.weaponIdcode) ?? '?';
  const w = weaponOptions(isCaster()).find((o) => o.def.code === appearance.weaponIdcode);
  if (!w) { info.textContent = '（该武器不在 ITEM_DEFS 中，动画白名单按类型回退）'; return; }
  const rows: string[] = [
    `武器类型 ${type}`,
    `单双手 ${w.hand}`,
    `攻击音效码 ${w.soundCode}${sfxBank.weaponPrefix(w.soundCode) ? ` (${sfxBank.weaponPrefix(w.soundCode)})` : ''}`,
    `音效文件 ${w.soundFiles.join(', ') || '⚠ 无'}`,
    `模型 it${appearance.weaponDorp.toLowerCase()}.smd`,
  ];
  info.textContent = rows.join('\n');
  btnRow(info, [
    {
      label: '试听挥击', onClick: () => {
        log(`[音效] 挥击码 ${w.soundCode} → ${w.soundFiles.join(', ')}`);
        sfx.playWeaponAttack(w.soundCode, { pitch: pitchOf(), priority: true });
      },
    },
    {
      label: '试听未命中', onClick: () => {
        const miss = sfxBank.weaponFiles(w.hand === '1H' ? 12 : 13);
        log(`[音效] 未命中 → ${miss.join(', ')}`);
        sfx.playWeaponMiss(w.hand, { pitch: pitchOf(), priority: true });
      },
    },
    {
      label: '试听暴击', onClick: () => {
        const crit = sfxBank.weaponFiles(16);
        log(`[音效] 暴击 → ${crit.join(', ')}`);
        sfx.playCritical({ pitch: pitchOf(), priority: true });
      },
    },
  ]);
  // 攻击动画播到**事件帧**时播哪种音（对齐源码 `AttackCritcal < 0` 分支）。
  // 有了它，"点播放攻击动画"就能听到与该武器匹配的攻击音，不必再去点试听。
  // ⚠ **这是调试用的手动覆盖**：原版的 miss/暴击由**服务端**裁定，客户端只是照结果播音。
  //   正式方案是"客户端报攻击意图 → 服务端把各事件帧的结果一次性算好下发"，客户端按结果播；
  //   那时这个开关只用于单独试听某一种结果，**不代表客户端有权决定结果**。
  selectRow(info, '事件帧攻击音（调试覆盖）', [
    { value: 'hit', text: '命中（武器音）' },
    { value: 'miss', text: '未命中（挥空音）' },
    { value: 'crit', text: '暴击（追加暴击音）' },
  ], attackSoundMode, (v) => {
    attackSoundMode = v as 'hit' | 'miss' | 'crit';
    log(`[音效] 事件帧攻击音模式 → ${attackSoundMode}（播放 ATTACK/SKILL 动画到事件帧时生效）`);
  });
}

/* ─────────── 动作面板 ─────────── */

const WATCH_STATES: Array<[string, number]> = [
  ['CHRMOTION_STATE_STAND', 0x0040],
  ['CHRMOTION_STATE_WALK', 0x0050],
  ['CHRMOTION_STATE_RUN', 0x0060],
  ['CHRMOTION_STATE_ATTACK', 0x0100],
  ['CHRMOTION_STATE_SKILL', 0x0150],
  ['CHRMOTION_STATE_DAMAGE', 0x0110],
  ['CHRMOTION_STATE_DEAD', 0x0120],
  // 以下以怪物/物件为主，玩家职业缺失属正常（不标红）
  ['CHRMOTION_STATE_HAMMER', 0x0300],
  ['CHRMOTION_STATE_WARP', 0x0210],
  ['CHRMOTION_STATE_TAUNT', 0x0230],
  ['CHRMOTION_STATE_YAHOO', 0x0220],
  ['CHRMOTION_STATE_FALLDOWN', 0x0080],
];

function buildActionPanel(): void {
  buildWalkthroughPanel();
  const body = section(rightEl, '动作（按状态适配）');
  body.id = 'ins-states';

  const all = section(rightEl, '全部 motion 条目');
  all.id = 'ins-motions';
  motionHead = all.parentElement?.querySelector('.ins-sec-head') ?? null;
  motionFilterBar = el('div', 'ins-motion-bar');
  // 组选择：让 m1~m8 全部可浏览（格斗家 m8 没有 JOB_DATA 条目，靠这个才能看到）
  selectRow(motionFilterBar, 'motion 组',
    [{ value: 'auto', text: '跟随当前职业' }, ...Object.keys(IN_ENTRIES).map((g) => ({ value: g, text: g }))],
    motionGroupView, (v) => { motionGroupView = v; refreshMotionList(); });
  const mcRow = el('div', 'ins-row ins-row--check');
  const mcb = el('input');
  mcb.type = 'checkbox';
  mcb.onchange = () => { motionOnlyConflict = mcb.checked; refreshMotionList(); };
  mcRow.append(mcb, el('label', 'ins-label', '只看白名单未解析'));
  motionFilterBar.appendChild(mcRow);

  const inSkills = section(rightEl, '技能名（.in 权威）');
  inSkills.id = 'ins-in-skills';

  const play = section(rightEl, '播放控制');
  checkRow(play, '暂停', false, (v) => stage.setPaused(v));
  checkRow(play, '循环', true, (v) => stage.setLooping(v));
  rangeRow(play, '速度', 0.1, 3, 0.1, 1, (v) => stage.setSpeed(v));
  btnRow(play, [
    { label: '⏹ 停止', title: '回到首帧并暂停', onClick: () => stage.stop() },
    { label: '◀ 步进', onClick: () => stage.stepFrames(-1) },
    { label: '步进 ▶', onClick: () => stage.stepFrames(1) },
    { label: '◀◀ -10', onClick: () => stage.stepFrames(-10) },
    { label: '▶▶ +10', onClick: () => stage.stepFrames(10) },
  ]);

  // 帧时间轴（吸收自 pviewer 的 frameSlider/timeline）：以动画帧（30fps）为单位
  const tlRow = el('div', 'ins-row');
  tlRow.appendChild(el('label', 'ins-label', '帧'));
  const tl = el('input', 'ins-range');
  tl.type = 'range'; tl.min = '0'; tl.max = '1'; tl.step = '1'; tl.value = '0';
  tl.id = 'ins-frame';
  const tlVal = el('span', 'ins-val', '0');
  tl.oninput = () => { stage.setFrame(Number(tl.value) * 160); tlVal.textContent = tl.value; };
  tlRow.append(tl, tlVal);
  play.appendChild(tlRow);

  // 事件帧 = **伤害结算时刻**（起手/后摇之后的命中瞬间），音效与特效多对齐于此。
  // 单独读数 + 一键跳过去，便于对着它核对时机。
  const evRow = el('div', 'ins-row');
  const evInfo = el('span', 'ins-dim', '事件帧 —');
  evInfo.id = 'ins-event-info';
  const evBtn = el('button', 'ins-btn', '⏱ 跳到事件帧');
  evBtn.onclick = () => {
    const evs = motionEventFrames();
    if (!evs.length) { log('[事件帧] 当前动作没有事件帧'); return; }
    stage.setFrame(stage.currentMotion()!.startFrame * 160 + evs[0]!);
    stage.setPaused(true);
    log(`[事件帧] 跳到第 ${(evs[0]! / 160).toFixed(0)} 帧（相对起手）并暂停`);
    syncTimeline();
  };
  evRow.append(evInfo, evBtn);
  play.appendChild(evRow);

  // 调试可视化（吸收自 pviewer 的渲染开关）
  checkRow(play, '线框', false, (v) => stage.setWireframe(v));
  checkRow(play, '骨骼', false, (v) => stage.setShowBones(v));
  checkRow(play, '坐标轴', false, (v) => stage.setShowAxes(v));
}

/** 当前动作的事件帧（相对起手，子帧单位；已排序） */
function motionEventFrames(): number[] {
  const m = stage.currentMotion();
  if (!m) return [];
  return Array.from(m.eventFrame ?? []).filter((x) => x > 0).sort((a, b) => a - b);
}

/** 时间轴跟随当前动作的帧范围 */
function syncTimeline(): void {
  const tl = document.getElementById('ins-frame') as HTMLInputElement | null;
  const info = document.getElementById('ins-event-info');
  const evs = motionEventFrames();
  if (info) {
    const r = stage.frameRange();
    info.textContent = evs.length
      ? `事件帧 ${evs.map((e) => `${(e / 160).toFixed(0)}帧`).join(', ')}`
        + (r ? `（动作共 ${((r.end - r.start) / 160).toFixed(0)} 帧）` : '')
      : '事件帧 —（该动作无）';
  }
  if (!tl) return;
  const r = stage.frameRange();
  if (!r) { tl.disabled = true; return; }
  tl.disabled = false;
  tl.min = String(Math.round(r.start / 160));
  tl.max = String(Math.round(r.end / 160));
  tl.value = String(Math.round(stage.currentFrame() / 160));
}

function buildBonePanel(): void {
  const body = section(rightEl, '骨骼信息', true);
  body.id = 'ins-bones';
}

function refreshBonePanel(names: string[], textures: { loaded: number; failed: string[] }): void {
  const host = document.getElementById('ins-bones');
  if (!host) return;
  host.innerHTML = '';
  infoRow(host, '骨骼数', String(names.length));
  infoRow(host, '纹理', `${textures.loaded} 成功 / ${textures.failed.length} 失败`,
    textures.failed.length ? 'ins-info--warn' : '');
  const list = el('div', 'ins-bonelist');
  list.textContent = names.join('\n');
  host.appendChild(list);
}

/** 每个状态下"当前职业+武器"能选到哪些动画（复用生产匹配逻辑） */
function refreshStatePanel(): void {
  const host = document.getElementById('ins-states');
  if (!host) return;
  host.innerHTML = '';
  const motions = stage.motions();
  if (!motions.length) { host.appendChild(el('div', 'ins-dim', '（未加载）')); return; }
  const classId = appearance.jobId;
  const wType = appearance.weaponIdcode ? getWeaponTypeFromIdCode(appearance.weaponIdcode) : null;

  for (const [stateKey, state] of WATCH_STATES) {
    const core = CORE_PLAYER_STATES.has(stateKey);
    const grpNow = groupOf();
    const defNow = optsFindByCode(appearance.weaponIdcode);
    // 手别**唯一来源**：语义表（honors 覆盖）→ DB class 兜底。
    // 曾用 defNow.class（DB 原始值）→ WS118 显示 1H 但匹配按 2H。
    const handNow = appearance.weaponIdcode
      ? ((getHandTypeFromIdCode(appearance.weaponIdcode) ?? (defNow ? getHandType(defNow.class) : null)) as '1H' | '2H' | null)
      : null;
    // **唯一匹配入口**：char/anim-match.ts 的 pickSemanticMotion。
    // 检查器不再自己算候选 —— 曾因此与姿态入口给出不同动画（1H 斧出 2H）。
    // 「战斗姿态」开关 = 原版的 野外(持械) / 村庄(收械) 这一**同一个轴**：
    // 收械即空手（`.in` 里村庄条目 0 条列过武器），所以不仅换 location，
    // weaponType 也一并置空 —— 否则就是"空手条目去适配所有武器"，制造候选杂音。
    const pick = pickSemanticMotion(
      motions,
      ((grpNow ? SEM_DOCS[grpNow]?.animations : undefined) ?? []) as unknown as SemanticEntry[],
      {
        state,
        weaponType: combatStance ? wType : null,
        hand: combatStance ? handNow : null,
        classId,
        location: combatStance ? 'field' : 'village',
      },
    );
    const cand = pick.motion ? [pick.motion] : [];
    const row = el('div', 'ins-act');
    STATE_ROWS.set(state, row);   // 供「战斗姿态」开关重触发这一行（同一实现）
    const tag = el('span', 'ins-act-name', motionLabel(stateKey));
    const cnt = el('span',
      cand.length ? 'ins-ok' : (core ? 'ins-bad' : 'ins-dim'),
      cand.length ? `✓ ${pick.why}` : (core ? `✗ 无动画（${pick.why}）` : '无（该状态非玩家核心，正常）'));
    // 该状态会触发的音效（玩家=职业目录，怪物/NPC=模型目录）
    const snd = motionSoundFiles(stateKey);
    const sndTag = el('span', 'ins-dim', snd.length ? `🔊 ${snd.length}` : '🔇');
    sndTag.title = snd.join('\n') || '该状态无音效文件';
    row.append(tag, cnt, sndTag);
    // 候选清单：**该姿态下所有适用的变体**，点哪条播哪条（★=匹配器自动选中的那条）。
    // 不适用者（空手/通用/异手）已被匹配器按姿态排除、**不在此列出** —— 旧版把它们
    // 排在末尾却仍可点，于是"持 1H 斧却能把空手跑步当选项"（用户实测）。
    // 排除数量在状态行上以「已排除 N」提示，避免"某条条目凭空消失"的困惑。
    if (pick.candidates.length) {
      const list = el('div', 'ins-cands');
      pick.candidates.slice(0, 8).forEach((c, ci) => {
        const line = el('div', 'ins-cand' + (ci === 0 ? ' ins-cand--sel' : ''));
        const axes = (c.entry.weapon.list ?? []).filter((x) => x.type === wType);
        const handMark = new Set(axes.map((x) => x.hand)).size > 1 ? '混' : axes.length ? '纯' : '—';
        line.textContent = `${ci === 0 ? '★' : '·'} ${c.entry.clip}  [${c.motion.startFrame},${c.motion.endFrame}]`
          + `  ${FIT_LABEL[c.fit]}/${handMark}`
          + (axes.length ? `  ${[...new Set(axes.map((x) => x.hand))].join('+')}` : '')
          + (c.entry.label ? `  ${c.entry.label}` : '');
        line.onclick = (ev) => {
          ev.stopPropagation();
          stage.playMotion(c.motion);
          log(`[动作] ${motionLabel(stateKey)} 候选#${ci + 1} → ${c.entry.clip} motion[${c.motion.index}] [${c.motion.startFrame},${c.motion.endFrame}]`);
          refreshHud();
        };
        list.appendChild(line);
      });
      if (pick.candidates.length > 8) list.appendChild(el('div', 'ins-dim', `… 另有 ${pick.candidates.length - 8} 条`));
      if (pick.fallback) {
        list.appendChild(el('div', 'ins-dim', '⚠ 该状态无专属条目，已回退到通用/空手动画（不是原版应有表现）'));
      }
      row.appendChild(list);
    }
    if (cand.length) {
      row.onclick = () => {
        const m = cand[0]!;                       // 语义匹配给出确定的一条（不再随机）
        stage.playMotion(m);
        log(`[动作] ${motionLabel(stateKey)} → ${pick.entry?.clip ?? '?'} motion[${m.index}] 播放 0x${m.state.toString(16)} [${m.startFrame},${m.endFrame}]`);
        refreshHud();
      };
      row.title = `候选 motion index: ${cand.map((c) => c.index).join(', ')}\n点击播放（随机取一条，与游戏内一致）`;
    } else if (core) {
      anomalies.push(`核心状态缺动画：job=${classId} weapon=${wType ?? 'BARE_HAND'} state=${stateKey}`);
    }
    host.appendChild(row);
  }
}

/** 只读浏览某一组（未加载该组模型时）——数据全部来自 `.in` 权威语义 */
function renderGroupReadOnly(host: HTMLElement, grp: string): void {
  const entries = IN_ENTRIES[grp] ?? [];
  const byState = new Map<string, InAnimEntry[]>();
  for (const e of entries) byState.set(e.inxState, [...(byState.get(e.inxState) ?? []), e]);
  const skillCount = entries.filter((e) => e.skills.length).length;
  if (motionHead) {
    motionHead.textContent = `${grp}（只读，未加载模型） · ${entries.length} 条 · 带技能名 ${skillCount}`;
  }
  host.appendChild(el('div', 'ins-dim',
    `未加载 ${grp} 的模型，仅列出 .in 权威语义（职业名/武器代码/技能名/位置/作者注释）。`
    + ` 想看动画请在「角色」里选对应职业。`));
  for (const [state, list] of [...byState.entries()].sort()) {
    const sub = section(host, `${state} · ${list.length} 条`);
    for (const e of list.slice().sort((a, b) => a.inxFrames[0] - b.inxFrames[0])) {
      const row = el('div', 'ins-motion');
      const uniq = [...new Set(e.weaponSemantics.map((x) => `${x.hand}-${x.type}`))];
      const w = e.weapon.kind === 'all' ? '任意'
        : e.weapon.kind === 'none' ? '空手'
          : (e.weapon.unarmed ? '空手|' : '') + uniq.join(',');
      row.textContent = `#${e.inxIndex}  [${e.inxFrames[0]},${e.inxFrames[1]}]${e.repeat ? ' ↻' : ''}`
        + `  ${e.collection}  ${e.motion}`;
      const line = el('div', 'ins-xr-inline ins-xr-inline--in');
      line.textContent = `↳ 武器 ${w}　职业 ${e.classes.join('/') || '-'}`
        + (e.skills.length ? `　技能 ${e.skills.join('/')}` : '')
        + (e.locations.length ? `　${e.locations.join(' ')}` : '')
        + (e.inxEvents.length ? `　ev ${e.inxEvents.join(',')}` : '')
        + (e.weapon.codes.length ? `　(${e.weapon.codes.length} 个武器码)` : '')
        + (e.note ? `　//${e.note}` : '');
      row.appendChild(line);
      sub.appendChild(row);
    }
  }
}

/**
 * 技能名清单（.in 权威）。跟随「全部 motion 条目」的组选择，
 * 这样格斗家（m8）等没有 JOB_DATA 条目的组也能列出技能名。
 */
function refreshInSkillList(grp: string | null): void {
  const host = document.getElementById('ins-in-skills');
  if (!host) return;
  host.innerHTML = '';
  if (!grp) { host.appendChild(el('div', 'ins-dim', '（请选择 motion 组，或加载一个玩家职业）')); return; }
  const entries = (IN_ENTRIES[grp] ?? []).filter((e) => e.skills.length)
    .slice().sort((a, b) => a.inxFrames[0] - b.inxFrames[0]);
  const names = new Set<string>();
  for (const e of entries) for (const sk of e.skills) names.add(sk);
  host.appendChild(el('div', 'ins-note',
    `${grp}：${entries.length} 个技能条目，去重技能名 ${names.size} 个（原文来自 .in 的 *적용기술）`));
  for (const e of entries) {
    const row = el('div', 'ins-motion');
    row.textContent = `#${e.inxIndex}  [${e.inxFrames[0]},${e.inxFrames[1]}]  ${e.motion}`;
    const line = el('div', 'ins-xr-inline ins-xr-inline--in');
    const w = e.weapon.kind === 'all' ? '任意' : e.weapon.kind === 'none' ? '空手'
      : (e.weapon.unarmed ? '空手|' : '') + [...new Set(e.weaponSemantics.map((x) => `${x.hand}-${x.type}`))].join(',');
    line.textContent = `技能 ${e.skills.join(' / ')}　武器 ${w}`
      + (e.inxEvents.length ? `　ev ${e.inxEvents.join(',')}` : '')
      + (e.note ? `　//${e.note}` : '');
    row.appendChild(line);
    host.appendChild(row);
  }
}


/** 战斗姿态开关。持械时武器在手上、各状态只用专属条目；
 *  非战斗（村庄）时武器收起、各状态用空手/通用条目 —— 两族都按武器分条目，
 *  用 sidecar 的 label + weapon 选择，正是语义层的用处。
 *  **默认持械**：走查武器动画要看的就是持械表现；且旧版因姿态只作用于 STAND，
 *  RUN/WALK/攻击事实上就是持械，默认改为持械才与当时的观察一致。 */
let combatStance = true;
/** 状态码 → 「动作」栏那一行。战斗姿态开关通过**点击这一行**应用，
 *  以保证"选哪条动画"只有一处实现（唯一实现在 char/anim-match.ts 的 pickSemanticMotion）。 */
const STATE_ROWS = new Map<number, HTMLElement>();
/** 上次应用姿态时的「武器|姿态」键。**只在它变化时**才重选 STAND ——
 *  否则换头型/换甲这类也会走 reload()，会把用户当前正在看的动作顶掉
 *（用户实测：装武器后换头型，动画被重置且撕裂）。*/
let lastStanceKey = '';

/** 按「战斗姿态 + 当前武器语义」选一条 STAND 播放。找不到精确匹配则退回空手/首条。 */
function applyStance(force = false): void {
  const grp = groupOf();
  if (!grp) return;
  const key = `${appearance.weaponIdcode}|${combatStance}|${grp}`;
  if (!force && key === lastStanceKey) return;   // 未变 → 不动当前动画（换脸/换甲也会走 reload）
  lastStanceKey = key;
  // **不自己选动画**：重算面板（姿态是喂给唯一匹配的输入）+ 重触发 STAND 行。
  // 必须**先** refreshStatePanel：行的点击处理挂着渲染时算好的候选，
  // 只改标志不重算 → 点下去播的还是旧结果（表现为勾了战斗姿态没用）。
  refreshStatePanel();
  // 挂载点同步：**骨判定与镜像份全在 WeaponMount**（自机/远端/检查器同一实现），
  // 这里只给姿态。此前检查器自己算骨骼名 + 自己 clone 镜像，于是成了唯一实现了双持的地方，
  // 游戏内（WorldView）反而没有 —— 正是"不要给检查器单独写"这条要避免的。
  {
    const stance = combatStance ? 'combat' : 'sheathed';
    const res = stage.setWeaponStance(stance);
    const sl = getSheatheSlot(appearance.weaponIdcode ?? 0);
    log(`[挂载] ${combatStance ? '持械' : '收械'} → ${res.mainBone ?? '(未挂)'}`
      + (res.mirrorBone ? ` + 镜像 ${res.mirrorBone}` : '')
      + (res.missingBone ? `（缺骨 ${res.missingBone}）` : '')
      + `（idcode=${appearance.weaponIdcode ?? 0} 槽位=${sl.slot} src=${sl.src}）`);
  }
  const row = STATE_ROWS.get(0x40);
  if (row) row.click();
  else log('[姿态] 状态面板未就绪，稍后再试');
}

/** 按 idcode 找武器定义（用检查器已有的 weaponOptions，避免再引 ITEM_DEFS） */
function optsFindByCode(code: number): { class: number; icon: string; pos: number } | null {
  if (!code) return null;
  return weaponOptions(isCaster()).find((o) => o.def.code === code)?.def ?? null;
}

/**
 * 「走查记录」面板：为"逐职业 × 逐武器 × 逐状态"的人工走查服务。
 * ① 日志可复制（日志区 CSS 是 user-select:none，选不中 → 用按钮取文本）
 * ② 一键记录当前(职业/武器/状态/判定/备注)，累加为可粘贴回传的 JSON 行
 * ③ 在同一武器类型内快速切上/下一把，避免反复开弹框
 */
function buildWalkthroughPanel(): void {
  const body = section(rightEl, '走查记录（人工核对用）', true);
  body.id = 'ins-walk';

  const row0 = el('div', 'ins-row');
  const copyBtn = el('button', 'ins-btn', '复制日志');
  copyBtn.onclick = () => {
    const txt = document.getElementById('log')?.textContent ?? '';
    void navigator.clipboard.writeText(txt).then(
      () => log(`[记录] 日志已复制（${txt.length} 字符）`),
      () => log('[记录] 剪贴板不可用；请手工复制下方文本框'),
    );
  };
  const clearBtn = el('button', 'ins-btn', '清空记录');
  row0.append(copyBtn, clearBtn);
  body.appendChild(row0);

  const row1 = el('div', 'ins-row ins-row--check');
  const badCb = el('input') as HTMLInputElement;
  badCb.type = 'checkbox';
  row1.append(badCb, el('label', 'ins-label', '本条不对（否则记为 OK）'));
  body.appendChild(row1);

  const noteIn = el('input', 'ins-text') as HTMLInputElement;
  noteIn.placeholder = '备注（如"播的是 1H 动画""挂点不对"）';
  const row2 = el('div', 'ins-row');
  row2.append(el('label', 'ins-label', '备注'), noteIn);
  body.appendChild(row2);

  const ta = el('textarea', 'ins-wrev-out') as HTMLTextAreaElement;
  ta.rows = 8;
  ta.id = 'ins-walk-out';
  ta.placeholder = '记录累加在这里（每行一条 JSON）。走查完成后整段复制回传给我即可。';

  const row3 = el('div', 'ins-row');
  const prevBtn = el('button', 'ins-btn', '◀ 上一把');
  prevBtn.onclick = () => cycleWeapon(-1);
  const nextBtn = el('button', 'ins-btn', '下一把武器 ▶');
  nextBtn.onclick = () => cycleWeapon(1);
  const recBtn = el('button', 'ins-btn ins-mk-btn--ok', '记录本条');
  recBtn.onclick = () => {
    const idc = appearance.weaponIdcode;
    const rec = {
      job: appearance.jobId,
      weapon: appearance.weaponDorp || '(空手)',
      idcode: idc || 0,
      type: idc ? (getWeaponTypeFromIdCode(idc) ?? '?') : '空手',
      hand: idc ? (getHandTypeFromIdCode(idc) ?? '?') : '-',
      sheathe: idc ? `${getSheatheSlot(idc).slot}(${getSheatheSlot(idc).src})` : '-',
      stance: combatStance ? 'combat' : 'sheathed',
      lastMotion: lastMotionLabel(),
      verdict: badCb.checked ? 'BAD' : 'OK',
      note: noteIn.value.trim() || undefined,
    };
    ta.value += JSON.stringify(rec) + '\n';
    badCb.checked = false; noteIn.value = '';
    log(`[记录] ${rec.weapon} j${rec.job} ${rec.verdict}${rec.note ? ' / ' + rec.note : ''}`);
  };
  row3.append(prevBtn, nextBtn, recBtn);
  body.appendChild(row3);
  body.appendChild(ta);

  clearBtn.onclick = () => { ta.value = ''; log('[记录] 已清空'); };
}

/** 最近一次播放的动作：直接从日志读，避免另存一份状态 */
function lastMotionLabel(): string {
  const lines = (document.getElementById('log')?.textContent ?? '').split('\n').filter((l) => l.includes('[动作]'));
  return lines[lines.length - 1]?.slice(0, 90) ?? '—';
}

/** 在当前武器类型内切上/下一把（保持走查节奏） */
function cycleWeapon(step: number): void {
  const opts = weaponOptions(isCaster());   // 已是 weapons-only
  const curType = appearance.weaponIdcode ? (getWeaponTypeFromIdCode(appearance.weaponIdcode) ?? null) : null;
  const list = curType ? opts.filter((o) => o.type === curType) : opts;
  if (!list.length) { log('[记录] 没有可切换的武器'); return; }
  const at = list.findIndex((o) => o.def.code === appearance.weaponIdcode);
  const idx = (((at + step) % list.length) + list.length) % list.length;
  const next = list[idx]!;
  appearance.weaponIdcode = next.def.code;
  appearance.weaponDorp = next.def.icon;
  appearance.weaponPos = next.def.pos;
  void reload();
  log(`[记录] 切到 ${next.def.name}（${next.type}/${next.hand}，同类型 ${list.length} 把中第 ${idx + 1} 把）`);
}

/**
 * 「语义数据」面板：把 sidecar 展示出来，并与**实时 motion** 逐条对照。
 * 点一条 → 用现有 .smb 路径播放（sidecar 帧号是源空间，可直接索引），
 * 从而用眼睛核"帧区间/事件帧"是否与实况一致。
 */
function refreshSemanticPanel(): void {
  let body = document.getElementById('ins-semantic');
  if (!body) {
    body = section(rightEl, '语义数据（sidecar ↔ 实况对照）');
    body.id = 'ins-semantic';
  }
  const grp = motionGroupView === 'auto' ? groupOf() : motionGroupView;
  const doc = grp ? SEM_DOCS[grp] ?? null : null;
  const live = (doc && grp === groupOf() ? stage.motions() : []) as unknown as Array<{
    index: number; state: number; startFrame: number; endFrame: number; eventFrame?: ArrayLike<number>;
  }>;
  renderSemanticPanel(body, doc, live, SEM_VARIANTS, (m) => {
    if (!m) { log('[语义] 该条在当前加载的模型里没有同帧区间的 motion（可能未加载该组）'); return; }
    stage.playMotion(m as never);
    log(`[语义] 播放实况 #${m.index} ${motionStateName(m.state)} [${m.startFrame},${m.endFrame}]`);
    refreshHud();
  });
}

/** 全部 motion 原始条目（按状态分组），点击直放；行下内联派生语义（按原版 index 配对） */
function refreshMotionList(): void {
  const host = document.getElementById('ins-motions');
  if (!host) return;
  host.innerHTML = '';
  if (motionFilterBar) host.appendChild(motionFilterBar);
  refreshSemanticPanel();

  // 组选择为具体组、且不是当前加载的组 → 只读浏览（格斗家 m8 走的就是这条）
  const liveGroup = groupOf();
  const effGroup = motionGroupView === 'auto' ? liveGroup : motionGroupView;
  refreshInSkillList(effGroup);
  if (motionGroupView !== 'auto' && motionGroupView !== liveGroup) {
    renderGroupReadOnly(host, motionGroupView);
    return;
  }

  const motions = stage.motions().filter((m) => m.startFrame !== 0 || m.endFrame !== 0);
  if (!motions.length) { host.appendChild(el('div', 'ins-dim', '（未加载）')); return; }

  // 冲突 = idcode 链与图标前缀两路信号矛盾（与「动画映射对照」同一定义）
  const conflict = new Set<number>();
  for (const m of motions) if (xrefFor(m.index)?.xref.coverageLevel === 'none') conflict.add(m.index);
  const seenFrames = new Map<string, number>();
  let inCovered = 0;
  for (const m of motions) {
    const k = `${m.startFrame}-${m.endFrame}`;
    const nth = seenFrames.get(k) ?? 0;
    seenFrames.set(k, nth + 1);
    if (inEntryFor(m.startFrame, m.endFrame, nth)) inCovered++;
  }
  if (motionHead) {
    motionHead.textContent = `全部 motion 条目 · ${motions.length} 条`
      + ` · .in 覆盖 ${inCovered}/${motions.length}`
      + (conflict.size ? ` · ⚠ 白名单未解析 ${conflict.size}` : '');
  }
  if (motionOnlyConflict && !conflict.size) {
    host.appendChild(el('div', 'ins-dim', '本组无白名单未解析条目（需先加载玩家职业）'));
    return;
  }

  const inSeen = new Map<string, number>();
  const byState = new Map<number, MotionInfo[]>();
  for (const m of motions) {
    if (motionOnlyConflict && !conflict.has(m.index)) continue;
    const arr = byState.get(m.state);
    if (arr) arr.push(m); else byState.set(m.state, [m]);
  }

  for (const [state, list] of [...byState.entries()].sort((a, b) => a[0] - b[0])) {
    const name = motionStateName(state);
    const sub = section(host, `${name} · ${list.length} 条`);
    for (const m of list) {
      const row = el('div', 'ins-motion');
      const frames = `[${m.startFrame},${m.endFrame}]${m.repeat ? ' ↻' : ''}`;
      const jobs = decodeClassFlags(m.dwJobCodeBit).join('/');
      const skills = Array.from(m.skillCodeList ?? []).filter((x) => x > 0);
      const ev = Array.from(m.eventFrame ?? []).filter((x) => x > 0);
      const bits = [
        `#${m.index}`, frames,
        m.itemCodeCount > 0 ? `武器白名单×${m.itemCodeCount}` : '武器通用',
        jobs !== 'ALL' ? `职业 ${jobs}` : '',
        skills.length ? `技能 ${skills.join(',')}` : '',
        ev.length ? `命中帧 ${ev.join(',')}` : '',
      ].filter(Boolean);
      row.textContent = bits.join('  ');
      // 行下对照：优先 `.in` 权威语义（职业名/武器代码/技能名都是原文明文），
      // 没有才退回从 .inx 的 sItem 索引反推的那套（已标注为"派生"）。
      const fk = `${m.startFrame}-${m.endFrame}`;
      const nth2 = inSeen.get(fk) ?? 0;
      inSeen.set(fk, nth2 + 1);
      const ina = inEntryFor(m.startFrame, m.endFrame, nth2);
      if (ina) {
        // 武器码是逐个列举的（如 37 个 WV101..WV157），显示时按 (hand,type) 去重才可读
        const uniq = [...new Set(ina.weaponSemantics.map((x) => `${x.hand}-${x.type}`))];
        const w = ina.weapon.kind === 'all' ? '任意'
          : ina.weapon.kind === 'none' ? '空手'
            : (ina.weapon.unarmed ? '空手|' : '') + uniq.join(',');
        const line2 = el('div', 'ins-xr-inline ins-xr-inline--in');
        line2.textContent = `↳ .in(${ina.motion})　武器 ${w}`
          + `　职业 ${ina.classes.join('/') || '-'}`
          + (ina.skills.length ? `　技能 ${ina.skills.join('/')}` : '')
          + (ina.locations.length ? `　${ina.locations.join(' ')}` : '')
          + (ina.inxEvents.length ? `　ev ${ina.inxEvents.join(',')}` : '')
          + (ina.weapon.codes.length ? `　(${ina.weapon.codes.length} 个武器码)` : '')
          + (ina.note ? `　//${ina.note}` : '');
        row.appendChild(line2);
      }
      const de = xrefFor(m.index);
      if (de) {
        const w = de.weapon.any ? '任意'
          : (de.weapon.unarmed ? '空手' : de.weapon.list.map((x) => `${x.hand}-${x.type}`).join(','));
        const conf = de.xref.coverageLevel;
        const line2 = el('div', 'ins-xr-inline' + (conf === 'none' ? ' ins-xr-inline--bad' : ''));
        line2.textContent = (ina ? '↳ 索引派生 ' : '↳ 派生 ') + `${de.id}　武器 ${w}　职业 ${de.classes.join('/')}`
          + (de.skills.length ? `　技能 ${de.skills.join('/')}` : '')
          + `　${de.location}`
          + (de.eventFrames.length ? `　ev ${de.eventFrames.join(',')}` : '')
          + `　白名单 ${de.xref.coverage.resolved}/${de.xref.coverage.total}`
          + (conf === 'none' && de.xref.frameSignature ? `（一条未解析；结算帧×${de.xref.frameSignature.hitSettlements}）` : '');
        row.appendChild(line2);
      }
      if (!ina && !de) {
        const line2 = el('div', 'ins-xr-inline ins-xr-inline--bad');
        line2.textContent = '↳ 无语义（.in 未覆盖，且不在派生表内）';
        row.appendChild(line2);
      }
      row.onclick = () => {
        stage.playMotion(m);
        log(`[动作] 直放 #${m.index} ${name} ${frames} jobs=${jobs} items=${m.itemCodeCount} skills=${skills.join(',') || '-'}`);
        refreshHud();
      };
      sub.appendChild(row);
    }
  }
}

/* ─────────── 技能表现清单（skill → 特效 / 音效）─────────── */

interface SkillFxRow {
  job: number; classDir: string; icon: string; name: string; alt?: string;
  fx: string[]; sfx: string[];
  /** 起手时机：一般只有一个"起跳/起手"音 */
  cast: { sfx: string[] };
  /** 事件帧时机（落地/命中）：特效 + 打击音 */
  event: { fx: string[]; sfx: string[] };
  confidence: string;
}
const SKILL_FX = skillFxRaw as unknown as { note: string; rows: SkillFxRow[] };
/** iconFile → 清单行（iconFile 在技能表内唯一） */
const SKILL_FX_BY_ICON = new Map<string, SkillFxRow>(SKILL_FX.rows.map((r) => [r.icon, r]));

/** 特效名去掉家族前缀（ini:/part:/lua:/luac:） */
const bareFx = (tagged: string): string => tagged.replace(/^[a-z]+:/, '');

/* ─────────── 技能试演（起手 / 事件帧 两个时机） ─────────── */

/** 当前正在试演的表现；事件帧触发时用它决定放什么 */
let activePerf: SkillFxRow | null = null;

/** 事件帧到达：放特效 + 打击音效（这是"落地/命中"的那一刻，不是起手） */
function onPerfEvent(): void {
  if (!activePerf) return;
  for (const f of activePerf.event.fx) {
    log(`[试演·事件帧] 特效 ${bareFx(f)}`);
    void playNamedEffect(bareFx(f));
  }
  for (const s of activePerf.event.sfx) {
    log(`[试演·事件帧] 音效 ${s}`);
    sfx.play(s, { priority: true });
  }
  if (!activePerf.event.fx.length && !activePerf.event.sfx.length) log('[试演·事件帧] （该技能无事件帧内容）');
}

/**
 * 试演一个技能：起手音立即响，特效与打击音等到**动画事件帧**再放。
 * 动画优先用该技能的专属动画（skillCodeList 命中）；命中不到就重播当前动作，
 * 由它的事件帧驱动 —— 这样即使"技能→动画"的关联缺失也能验证时机。
 */
function playPerformance(man: SkillFxRow, animIndex: number | null): void {
  activePerf = man;
  for (const s of man.cast.sfx) {
    log(`[试演·起手] 音效 ${s}`);
    sfx.play(s, { priority: true });
  }
  if (!man.cast.sfx.length) log('[试演·起手] （无起手音，仅记日志）');

  let started = false;
  if (animIndex !== null) {
    const cand = stage.motions().filter((m) => m.state === 0x0150
      && Array.from(m.skillCodeList ?? []).includes(animIndex));
    if (cand.length) {
      // **确定性**取 index 最小的一条：检查器要可复现，随机会让"看到的是不是真的"无从判断
      //（用户明确反对随机兜底）。变体随机是服务端职责，不在调试工具里做。
      stage.playMotion(cand.reduce((a, b) => (b.index < a.index ? b : a)));
      started = true;
    }
  }
  if (!started) {
    // 不静默充数：明确说明"没有专属动画，播的是当前动作"，让人一眼知道这不是该技能的动画。
    const cur = stage.currentMotion();
    log(animIndex === null
      ? '[试演] 该技能**无专属动画索引** → 未播技能动画（重播当前动作以触发事件帧）'
      : `[试演] 技能动画 #${animIndex} **无匹配条目** → 未播技能动画（重播当前动作以触发事件帧）`);
    if (cur) stage.playMotion(cur);
    else log('[试演] 无动画可播（先在"全部 motion 条目"里选一个动作）');
  }
  const evs = stage.currentMotion()?.eventFrame ? Array.from(stage.currentMotion()!.eventFrame).filter((x) => x > 0) : [];
  log(`[试演] ${man.name}：事件帧 ${evs.length ? evs.join(',') : '无'}（相对起手 ×160）`);
}

/* ─────────── 技能面板 ─────────── */

function buildSkillPanel(): void {
  const body = section(rightEl, '技能');
  body.id = 'ins-skills';
}

function refreshSkillPanel(): void {
  const host = document.getElementById('ins-skills');
  if (!host) return;
  host.innerHTML = '';
  if (!targetIsPlayer) {
    host.appendChild(el('div', 'ins-dim', '（怪物/NPC 无技能数据；技能面板仅对玩家职业有效）'));
    return;
  }
  const rows = skillsForJob(appearance.jobId);
  if (!rows.length) { host.appendChild(el('div', 'ins-dim', '（该职业无技能数据）')); return; }

  const cov = skillAnimCoverage(appearance.jobId);
  infoRow(host, '专属动画覆盖', `${cov.withAnim}/${cov.total}`, cov.withAnim === cov.total ? '' : 'ins-info--warn');

  let onlyMissing = false;
  checkRow(host, '只看无专属动画', false, (v) => { onlyMissing = v; renderSkillRows(); });
  const listHost = el('div');
  host.appendChild(listHost);

  function renderSkillRows(): void {
    listHost.innerHTML = '';
    let missing = 0;
    for (const r of rows as SkillRow[]) {
      if (!r.animIndex) missing++;
      if (onlyMissing && r.animIndex !== null) continue;
      const row = el('div', 'ins-skill');
      // 标出索引来源：positional=按职业代码块顺序推，需要人工核对
      const srcTag = r.animIndex === null ? ''
        : r.animIndexSrc === 'runtime' ? ''
          : r.animIndexSrc === '/in-name' ? '（.in 名称）' : '（.in 推）';
      const a = el('span', r.animIndex !== null ? 'ins-ok' : 'ins-bad',
        r.animIndex !== null ? `动画 #${r.animIndex}${srcTag}` : '✗ 无专属动画');
      const mid = el('span', 'ins-skill-name', `${r.def.name} (Lv${r.def.reqLv})`);
      row.append(mid, a);

      // 表现清单（skill → 特效 / 音效）：点击即可试播/试听，用于逐条校对
      const man = SKILL_FX_BY_ICON.get(r.def.iconFile);
      const fxBox = el('span', 'ins-chips');
      if (man && man.fx.length) {
        for (const f of man.fx.slice(0, 3)) {
          const chip = el('span', 'ins-chip', `fx:${bareFx(f)}`);
          chip.onclick = (e) => { e.stopPropagation(); void playNamedEffect(bareFx(f)); };
          chip.title = `点击播放 ${f}`;
          fxBox.appendChild(chip);
        }
        if (man.fx.length > 3) fxBox.appendChild(el('span', 'ins-dim', `+${man.fx.length - 3}`));
      } else {
        fxBox.appendChild(el('span', 'ins-dim', 'fx —'));
      }
      const sndBox = el('span', 'ins-chips');
      if (man && man.sfx.length) {
        for (const s of man.sfx.slice(0, 2)) {
          const chip = el('span', 'ins-chip', `sfx:${s.split('/').pop()}`);
          chip.onclick = (e) => { e.stopPropagation(); sfx.play(s, { priority: true }); log(`[音效] ${s}`); };
          chip.title = `点击播放 ${s}`;
          sndBox.appendChild(chip);
        }
        if (man.sfx.length > 2) sndBox.appendChild(el('span', 'ins-dim', `+${man.sfx.length - 2}`));
      } else {
        sndBox.appendChild(el('span', 'ins-dim', 'sfx —'));
      }
      row.append(fxBox, sndBox);
      // 试演：起手音 + （动画事件帧）特效与打击音
      const play = el('span', 'ins-chip ins-chip--play', '▶ 试演');
      play.onclick = (e) => {
        e.stopPropagation();
        // 清单里没有这个技能时，用空表现（只播动画，仍可看事件帧时机）
        const man2: SkillFxRow = man ?? {
          job: appearance.jobId, classDir: '', icon: r.def.iconFile, name: r.def.name,
          fx: [], sfx: [], cast: { sfx: [] }, event: { fx: [], sfx: [] }, confidence: 'none',
        };
        playPerformance(man2, r.animIndex);
      };
      row.appendChild(play);
      row.title = `${r.def.iconFile}\n${r.def.type}\n${r.def.desc ?? ''}`
        + (man ? `\n清单可信度: ${man.confidence}` : '\n（不在表现清单中）');
      row.onclick = () => {
        if (r.animIndex === null) {
          log(`[技能] ${r.def.name}: 无专属动画 → 游戏内会回退普攻动画`);
          return;
        }
        const motions = stage.motions();
        const cand = motions.filter((m) => m.state === 0x0150
          && Array.from(m.skillCodeList ?? []).includes(r.animIndex!));
        if (!cand.length) {
          log(`[技能] ${r.def.name}: animIndex=${r.animIndex} 但 .smb 中无对应 SKILL 条目 → 不会播技能动画（游戏内回退普攻）`);
          anomalies.push(`技能动画缺失：job=${appearance.jobId} skill=${r.def.name} animIndex=${r.animIndex}`);
          return;
        }
        // 确定性取 index 最小者（检查器要可复现；随机会让"看到的是不是真的"无从判断）
        const m = cand.reduce((a, b) => (b.index < a.index ? b : a));
        stage.playMotion(m);
        log(`[技能] ${r.def.name} → animIndex=${r.animIndex} motion#${m.index} [${m.startFrame},${m.endFrame}]`);
        refreshHud();
      };
      listHost.appendChild(row);
    }
    log(`[技能] 职业 ${appearance.jobId}: ${rows.length} 个技能，无专属动画 ${missing} 个`);
  }
  renderSkillRows();
}

/* ─────────── 诊断面板 ─────────── */

function buildDiagPanel(): void {
  const body = section(bottomEl, '诊断（期望 vs 实际）', true);
  body.id = 'ins-diag';
  btnRow(body, [
    {
      label: '导出 JSON', onClick: () => {
        const blob = new Blob([JSON.stringify({ appearance, diag: lastDiag, anomalies }, null, 2)], { type: 'application/json' });
        void navigator.clipboard?.writeText(blob ? JSON.stringify({ appearance, diag: lastDiag, anomalies }, null, 2) : '');
        log('[诊断] 已复制 JSON 到剪贴板');
      },
    },
    {
      label: '清空异常', onClick: () => { anomalies.length = 0; log('[诊断] 异常清单已清空'); },
    },
  ]);
  const list = el('div');
  list.id = 'ins-diag-list';
  body.appendChild(list);
}

function refreshDiagPanel(): void {
  const host = document.getElementById('ins-diag-list');
  if (!host) return;
  host.innerHTML = '';
  for (const d of lastDiag) {
    const row = el('div', 'ins-diag' + (d.ok ? '' : ' ins-diag--bad'));
    row.append(
      el('span', 'ins-diag-g', d.group),
      el('span', 'ins-diag-l', d.label),
      el('span', 'ins-diag-e', d.expected),
      el('span', d.ok ? 'ins-ok' : 'ins-bad', d.ok ? 'OK' : '✗'),
      d.note ? el('span', 'ins-dim', d.note) : el('span'),
    );
    host.appendChild(row);
  }
}

/* ─────────── 走查 ─────────── */

function buildWalkPanel(): void {
  const body = section(bottomEl, '批量走查', true);
  let dwell = 900;
  rangeRow(body, '每项停留(ms)', 200, 3000, 100, dwell, (v) => { dwell = v; });
  let running = false;
  const status = el('div', 'ins-note');
  body.appendChild(status);

  async function walk(items: Array<{ label: string; run: () => void }>, kind: string): Promise<void> {
    if (running) return;
    running = true;
    log(`[走查] 开始：${kind}，共 ${items.length} 项`);
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      status.textContent = `${kind} ${i + 1}/${items.length}：${it.label}`;
      it.run();
      await new Promise((r) => setTimeout(r, dwell));
    }
    status.textContent = `${kind} 完成`;
    log(`[走查] ${kind} 完成，异常 ${anomalies.length} 条`);
    if (anomalies.length) log('[走查] 异常：\n' + anomalies.join('\n'));
    running = false;
  }

  btnRow(body, [
    {
      label: '走查全部动作',
      onClick: () => {
        anomalies.length = 0;
        const motions = stage.motions().filter((m) => m.startFrame !== 0 || m.endFrame !== 0);
        void walk(motions.map((m) => ({
          label: `${motionStateName(m.state)} #${m.index}`,
          run: () => { stage.playMotion(m); refreshHud(); },
        })), '动作');
      },
    },
    {
      label: '走查全部技能',
      onClick: () => {
        anomalies.length = 0;
        const rows = skillsForJob(appearance.jobId);
        const motions = stage.motions();
        void walk(rows.map((r) => ({
          label: r.def.name,
          run: () => {
            if (r.animIndex === null) {
              anomalies.push(`技能无专属动画：${r.def.name} (${r.def.iconFile})`);
              return;
            }
            const cand = motions.filter((m) => m.state === 0x0150
              && Array.from(m.skillCodeList ?? []).includes(r.animIndex!));
            if (!cand.length) {
              anomalies.push(`技能有 animIndex 但 .smb 无对应条目：${r.def.name} animIndex=${r.animIndex}`);
              return;
            }
            stage.playMotion(cand.reduce((a, b) => (b.index < a.index ? b : a)));
            refreshHud();
          },
        })), '技能');
      },
    },
    {
      label: '走查全部特效',
      onClick: () => {
        anomalies.length = 0;
        void walk(EFFECT_LIST.map((e) => ({
          label: `[${e.f}] ${e.n}`,
          run: () => {
            const sel = document.getElementById('ins-fx') as HTMLSelectElement | null;
            if (sel) sel.value = e.n;
            void playEffect();
          },
        })), '特效');
      },
    },
    {
      label: '复制异常清单',
      onClick: () => {
        // 降级（fallback）也算异常：静默兜底会让人误判"看到的是真的"，故与异常一并导出。
        // 来源：src/char/fallback-log.ts 的统一上报通道。
        const text = [...anomalies, ...fallbacks().map((f) => `降级 ${f.kind}×${f.count}：${f.detail}`)].join('\n');
        void navigator.clipboard?.writeText(text);
        log(`[走查] 已复制 ${anomalies.length} 条异常 + ${fallbacks().length} 类降级`);
      },
    },
    {
      label: '看降级清单',
      onClick: () => {
        const list = fallbacks();
        log(list.length
          ? `[降级] 共 ${list.length} 类（发生次数）：\n` + list.map((f) => `  ${f.kind}×${f.count}  ${f.detail}`).join('\n')
          : '[降级] 无 —— 当前会话没有发生任何静默回退');
      },
    },
  ]);
}

/* ─────────── 加载流程 ─────────── */

let reloadSeq = 0;

async function reload(jobChanged = false): Promise<void> {
  const seq = ++reloadSeq;
  // 换职业会换 .smb → 动作与技能列表都必须重算
  if (jobChanged && targetMode === 'player') {
    const job = JOBS.find((j) => j.id === appearance.jobId);
    if (job && !job.hasModel) log(`[加载] 警告：职业 ${appearance.jobId} 在 JOB_DATA 中没有模型数据`);
  }
  const res = targetMode === 'player'
    ? await stage.loadPlayer(appearance, combatStance ? 'combat' : 'sheathed')
    : await stage.loadModel(modelPath, modelPath);
  if (seq !== reloadSeq) return; // 期间又触发了一次加载
  targetIsPlayer = res.isPlayer;
  soundKey = res.soundKey;
  lastDiag = res.diag;
  if (res.textures.failed.length) {
    for (const f of res.textures.failed) anomalies.push(`纹理缺失：${f}`);
  }
  refreshDiagPanel();
  refreshStatePanel();
  refreshMotionList();
  refreshSkillPanel();
  refreshEquipInfo();
  refreshBonePanel(res.boneNames, res.textures);
  syncTimeline();
  refreshHud();
  applyStance();   // 换武器/换职业后按「战斗姿态 + 武器语义」重选 STAND
  const what = targetMode === 'player'
    ? `job=${appearance.jobId} armor=${appearance.armorNum} face=${appearance.faceNum} tier=${appearance.tier} weapon=${appearance.weaponDorp || '-'}`
    : `model=${modelPath}`;
  log(`[加载] ${what} motions=${res.motions.length} 纹理 ${res.textures.loaded} 成功/${res.textures.failed.length} 失败`);
  for (const d of res.diag) {
    if (!d.ok) log(`[诊断!] ${d.group}/${d.label}: ${d.expected} → ${d.note ?? '失败'}`);
  }
}

/* ─────────── 启动 ─────────── */

buildTargetPanel();
buildCharPanel();
buildEquipPanel();
buildActionPanel();
buildSkillPanel();
buildEffectPanel();
buildAnimXrefPanel();
buildBonePanel();
buildDiagPanel();
buildWalkPanel();
setLeftMode();
let lastSyncedMotion: MotionInfo | null = null;
stage.onFrame = (frame, motion) => {
  refreshHud();
  if (motion !== lastSyncedMotion) { lastSyncedMotion = motion; syncTimeline(); }
  const tl = document.getElementById('ins-frame') as HTMLInputElement | null;
  if (tl && !tl.disabled) tl.value = String(Math.round(frame / 160));
};
// 事件帧 → ①技能试演的特效/打击音 ②**武器攻击音**（与 WorldView 的攻击命中帧同一机制）
// 攻击音的时机照抄原版：`ex-machina character.cpp` ~L2686 逐帧比较 `compFrame` 是否跨过
// `EventFrame[i]`，跨过即 `WeaponPlaySound()`（内部按 `AttackCritcal < 0` 选未命中音或武器音）。
// 该处**有状态门**：`MotionInfo->State` 必须是 ATTACK 或 SKILL 才触发 ——
// 故跑动/站立等条目即便带事件帧（跑步的 [480,2080]）也**不播武器音**，这里同样加门。
stage.onMotionEvent = (idx) => {
  onPerfEvent();
  const m = stage.currentMotion();
  if (!m) return;
  const st = motionStateName(m.state);
  if (st !== 'ATTACK' && st !== 'SKILL') return;
  if (attackSoundMode === 'crit') {
    log(`[音效] 事件帧#${idx + 1} → 暴击音`);
    sfx.playCritical({ pitch: pitchOf(), priority: true });
    return;
  }
  const idc = appearance.weaponIdcode;
  const t = idc ? getWeaponTypeFromIdCode(idc) : null;
  const h = (idc ? (getHandTypeFromIdCode(idc) ?? 'UNDEFINED') : 'UNDEFINED') as '1H' | '2H' | 'UNDEFINED';
  const code = weaponSoundCode(t, h, isCaster(), idc || 0);
  if (attackSoundMode === 'miss') {
    log(`[音效] 事件帧#${idx + 1} → 未命中音 ${sfxBank.weaponFiles(h === '1H' ? 12 : 13).join(', ')}`);
    sfx.playWeaponMiss(h, { pitch: pitchOf(), priority: true });
  } else {
    log(`[音效] 事件帧#${idx + 1} → 攻击音码 ${code}（${t ?? '空手'}/${h}）${sfxBank.weaponFiles(code).join(', ')}`);
    sfx.playWeaponAttack(code, { pitch: pitchOf(), priority: true });
  }
};
void reload(true);

log('资产检查器就绪。提示：所有按钮点击都会解锁音频；装备面板可试听挥击/未命中/暴击音。');
log('注意：技能的音效与特效映射表尚未重建（参考源码中已遗失），当前标为"待映射"。');
