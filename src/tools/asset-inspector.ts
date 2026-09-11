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
} from './inspector/model.js';
import modelListRaw from './inspector/data/model-list.json';
import { findMotions, findMotionsByType, pickMotion } from '../char/anim-match.js';
import { motionStateName, decodeClassFlags } from '../char/char-format.js';
import { getWeaponTypeFromIdCode } from '../char/weapon-type.js';
import { sfx } from '../audio/sfx.js';
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
  rangeRow(body, '脸 faceNum', 0, 9, 1, appearance.faceNum, (v) => { appearance.faceNum = v; void reload(); });
  rangeRow(body, '头饰 tier', 0, 3, 1, appearance.tier, (v) => { appearance.tier = v; void reload(); });
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

  selectRow(body, '主手武器', optList, '', (v) => {
    const w = opts.find((o) => String(o.def.id) === v);
    if (!w) {
      appearance.weaponIdcode = 0;
      appearance.weaponDorp = '';
    } else {
      appearance.weaponIdcode = w.def.code;
      appearance.weaponDorp = w.def.icon;   // icon = codeImg1 = weaponDorp（已核实）
      appearance.weaponPos = w.def.pos;
    }
    if (overrideInput && !overrideActive) overrideInput.value = appearance.weaponDorp;
    void reload();
  }).id = 'ins-weapon';

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
  const body = section(rightEl, '动作（按状态适配）');
  body.id = 'ins-states';

  const all = section(rightEl, '全部 motion 条目');
  all.id = 'ins-motions';

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

  // 调试可视化（吸收自 pviewer 的渲染开关）
  checkRow(play, '线框', false, (v) => stage.setWireframe(v));
  checkRow(play, '骨骼', false, (v) => stage.setShowBones(v));
  checkRow(play, '坐标轴', false, (v) => stage.setShowAxes(v));
}

/** 时间轴跟随当前动作的帧范围 */
function syncTimeline(): void {
  const tl = document.getElementById('ins-frame') as HTMLInputElement | null;
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
  const weaponId = appearance.weaponIdcode || null;
  const wType = appearance.weaponIdcode ? getWeaponTypeFromIdCode(appearance.weaponIdcode) : null;

  for (const [stateKey, state] of WATCH_STATES) {
    const core = CORE_PLAYER_STATES.has(stateKey);
    const exact = findMotions(motions, state, weaponId, classId, 3);
    const byType = exact.length ? [] : findMotionsByType(motions, state, wType, classId, 3);
    const row = el('div', 'ins-act');
    const tag = el('span', 'ins-act-name', motionLabel(stateKey));
    const cand = exact.length ? exact : byType;
    const cnt = el('span',
      cand.length ? 'ins-ok' : (core ? 'ins-bad' : 'ins-dim'),
      exact.length ? `${exact.length} 条` : (byType.length ? `类型回退 ${byType.length} 条` : (core ? '✗ 无动画' : '无（该状态非玩家核心，正常）')));
    // 该状态会触发的音效（玩家=职业目录，怪物/NPC=模型目录）
    const snd = motionSoundFiles(stateKey);
    const sndTag = el('span', 'ins-dim', snd.length ? `🔊 ${snd.length}` : '🔇');
    sndTag.title = snd.join('\n') || '该状态无音效文件';
    row.append(tag, cnt, sndTag);
    if (cand.length) {
      row.onclick = () => {
        const m = pickMotion(cand);
        stage.playMotion(m);
        log(`[动作] ${motionLabel(stateKey)} → motion[${cand.map((c) => c.index).join(',')}] 播放 0x${m?.state.toString(16)} [${m?.startFrame},${m?.endFrame}]`);
        refreshHud();
      };
      row.title = `候选 motion index: ${cand.map((c) => c.index).join(', ')}\n点击播放（随机取一条，与游戏内一致）`;
    } else if (core) {
      anomalies.push(`核心状态缺动画：job=${classId} weapon=${wType ?? 'BARE_HAND'} state=${stateKey}`);
    }
    host.appendChild(row);
  }
}

/** 全部 motion 原始条目（按状态分组），点击直放 */
function refreshMotionList(): void {
  const host = document.getElementById('ins-motions');
  if (!host) return;
  host.innerHTML = '';
  const motions = stage.motions().filter((m) => m.startFrame !== 0 || m.endFrame !== 0);
  if (!motions.length) { host.appendChild(el('div', 'ins-dim', '（未加载）')); return; }

  const byState = new Map<number, MotionInfo[]>();
  for (const m of motions) {
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
      row.onclick = () => {
        stage.playMotion(m);
        log(`[动作] 直放 #${m.index} ${name} ${frames} jobs=${jobs} items=${m.itemCodeCount} skills=${skills.join(',') || '-'}`);
        refreshHud();
      };
      sub.appendChild(row);
    }
  }
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
      const a = el('span', r.animIndex !== null ? 'ins-ok' : 'ins-bad',
        r.animIndex !== null ? `动画 #${r.animIndex}` : '✗ 无专属动画');
      const mid = el('span', 'ins-skill-name', `${r.def.name} (Lv${r.def.reqLv})`);
      const fx = el('span', 'ins-dim', '特效 待映射');
      const snd = el('span', 'ins-dim', '音效 待映射');
      row.append(mid, a, fx, snd);
      row.title = `${r.def.iconFile}\n${r.def.type}\n${r.def.desc ?? ''}`;
      row.onclick = () => {
        if (r.animIndex === null) {
          log(`[技能] ${r.def.name}: 无专属动画 → 游戏内会回退普攻动画`);
          return;
        }
        const motions = stage.motions();
        const cand = motions.filter((m) => m.state === 0x0150
          && Array.from(m.skillCodeList ?? []).includes(r.animIndex!));
        if (!cand.length) {
          log(`[技能] ${r.def.name}: animIndex=${r.animIndex} 但 .smb 中无对应 SKILL 条目 → 实际也会回退`);
          anomalies.push(`技能动画缺失：job=${appearance.jobId} skill=${r.def.name} animIndex=${r.animIndex}`);
          return;
        }
        const m = pickMotion(cand);
        stage.playMotion(m);
        log(`[技能] ${r.def.name} → animIndex=${r.animIndex} motion#${m?.index} [${m?.startFrame},${m?.endFrame}]`);
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
            stage.playMotion(pickMotion(cand));
            refreshHud();
          },
        })), '技能');
      },
    },
    {
      label: '复制异常清单',
      onClick: () => {
        const text = anomalies.join('\n');
        void navigator.clipboard?.writeText(text);
        log(`[走查] 已复制 ${anomalies.length} 条异常`);
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
    ? await stage.loadPlayer(appearance)
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
void reload(true);

log('资产检查器就绪。提示：所有按钮点击都会解锁音频；装备面板可试听挥击/未命中/暴击音。');
log('注意：技能的音效与特效映射表尚未重建（参考源码中已遗失），当前标为"待映射"。');
