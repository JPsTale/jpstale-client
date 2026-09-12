/**
 * 资产检查器 —— 「语义数据」面板。
 *
 * 目的：让**语义化动画描述文件**（`src/game/data/semantic/*.json`）可看、可播、可与实时数据对照。
 *   - 列出 sidecar 的全部条目（clip/state/frames/events/skill/weapon/location）
 *   - 点一条 → 用**当前 `.smb` 路径**播出对应动作（sidecar 帧号是源空间，可直接索引 `.smb`）
 *   - 逐条对照 **sidecar ↔ 实时 motion**（帧区间/状态/事件帧），不一致标红
 *   - 列出该模型参与的**语义槽**（`variants.json`，多对多表）
 *
 * 这是"语义数据是否可信"的验收界面：帧区间对不对、事件帧是不是命中时刻，用眼睛核。
 */
import { el } from './dom.js';
import { motionStateName } from '../../char/char-format.js';

interface SemanticAnim {
  id: string; clip: string; state: string; frames: [number, number]; fps: number;
  repeat: boolean; events: Array<{ ord: number; frame: number }>;
  location: string; classes: number[]; skill?: string;
  weapon: { all?: boolean; unarmed?: boolean; list?: Array<{ type: string; hand: string }> };
  codes: string[]; cues: unknown[]; label: string; note: string;
}
export interface SemanticDoc {
  format: string;
  model: { id: string; animSet: string; fps: number; classes: number[]; legacy?: { bipInx: string; bipSmb: string } };
  animations: SemanticAnim[];
}
export interface LiveMotion {
  index: number; state: number; startFrame: number; endFrame: number;
  eventFrame?: ArrayLike<number>;
}

// 状态名一律用权威表（char-format 的 motionStateName），不在此另立一张表 ——
// 否则又成了"同一个值两个真相"（本面板首版就因此把 RESTART 报成 0x200）。

const weaponText = (a: SemanticAnim): string => {
  const w = a.weapon;
  if (w.all) return '任意';
  const uniq = [...new Set((w.list ?? []).map((x) => `${x.hand}-${x.type}`))];
  return (w.unarmed ? '空手|' : '') + (uniq.join(',') || '-');
};

/**
 * 渲染面板。
 * @param host 容器（会被清空重填）
 * @param doc  目标模型的 sidecar
 * @param live 实时 motion 列表（当前加载的模型；未加载则为空数组）
 * @param variants 语义槽 → clip 名列表
 * @param onPlay 点条目时回调：播放对应实时 motion（或 null 表示找不到）
 */
export function renderSemanticPanel(
  host: HTMLElement,
  doc: SemanticDoc | null,
  live: LiveMotion[],
  variants: Record<string, string[]>,
  onPlay: (m: LiveMotion | null, a: SemanticAnim) => void,
): void {
  host.innerHTML = '';
  if (!doc) { host.appendChild(el('div', 'ins-dim', '（未加载该模型的语义数据）')); return; }

  /** 实时 motion 按帧区间建索引（sidecar 帧号即源空间帧号，可直接配对） */
  const byFrames = new Map<string, LiveMotion>();
  for (const m of live) byFrames.set(`${m.startFrame}-${m.endFrame}`, m);

  // ── 逐条对照：sidecar ↔ 实时 motion ──
  let hit = 0, missFrame = 0, mismatch = 0;
  const rows: Array<{ a: SemanticAnim; m: LiveMotion | null; bad: string | null }> = [];
  for (const a of doc.animations) {
    const m = byFrames.get(`${a.frames[0]}-${a.frames[1]}`) ?? null;
    let bad: string | null = null;
    if (!m) { missFrame++; bad = '实时数据里没有同帧区间的 motion'; }
    else {
      const ev = Array.from(m.eventFrame ?? []).filter((x) => x > 0);
      const sev = a.events.map((e) => e.frame);
      if (motionStateName(m.state) !== a.state) bad = `状态不符：sidecar=${a.state} 实时=${motionStateName(m.state)}`;
      else if (ev.join(',') !== sev.join(',')) bad = `事件帧不符：sidecar=[${sev.join(',')}] 实时=[${ev.join(',')}]`;
      else hit++;
    }
    if (bad) mismatch++;
    rows.push({ a, m, bad });
  }

  const okAll = mismatch === 0 && live.length > 0;
  const stat = el('div', 'ins-note');
  stat.textContent = `模型 ${doc.model.id}（animSet ${doc.model.animSet}，fps ${doc.model.fps}）· ${doc.animations.length} 条 · 职业 ${doc.model.classes.join('/')}`
    + (live.length
      ? `\n对照实时 motion：完全一致 ${hit} / 同帧缺失 ${missFrame} / 字段不符 ${mismatch}`
        + (okAll ? '　✓ 全部一致' : '　⚠ 见下方标红行')
      : '\n（未加载该模型的实时 motion —— 点右侧「动作」里的动作后此处可对照）');
  host.appendChild(stat);

  // ── 该模型参与的语义槽 ──
  const clips = new Set(doc.animations.map((a) => a.clip));
  const mySlots = Object.entries(variants)
    .map(([slot, list]) => [slot, list.filter((c) => clips.has(c))] as const)
    .filter(([, list]) => list.length);
  const slotBox = el('div', 'ins-note');
  slotBox.textContent = `参与的语义槽 ${mySlots.length} 个：`
    + mySlots.slice(0, 12).map(([s, l]) => `${s}(${l.length})`).join('  ')
    + (mySlots.length > 12 ? ' …' : '');
  host.appendChild(slotBox);

  // ── 条目清单 ──
  const CAP = 200;
  for (const { a, m, bad } of rows.slice(0, CAP)) {
    const row = el('div', 'ins-motion');
    row.textContent = `${a.clip}  [${a.frames[0]},${a.frames[1]}]${a.repeat ? ' ↻' : ''}`
      + (a.events.length ? `  ev ${a.events.map((e) => e.frame).join(',')}` : '')
      + (a.skill ? `  技能 ${a.skill}` : '')
      + (a.label ? `  ${a.label}` : '');
    const line = el('div', 'ins-xr-inline' + (bad ? ' ins-xr-inline--bad' : ' ins-xr-inline--in'));
    line.textContent = `↳ 武器 ${weaponText(a)}　${a.location}`
      + `　职业 ${a.classes.join('/') || '-'}`
      + (a.codes.length ? `　(${a.codes.length} 个原版码)` : '')
      + (a.note ? `　//${a.note}` : '')
      + (bad ? `　⚠ ${bad}` : (m ? `　实况 #${m.index}` : ''));
    row.appendChild(line);
    row.onclick = () => onPlay(m, a);
    host.appendChild(row);
  }
  if (rows.length > CAP) host.appendChild(el('div', 'ins-dim', `… 另有 ${rows.length - CAP} 条未显示`));
}
