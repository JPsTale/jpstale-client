/**
 * 伤害数字打击感调节面板（Ctrl+Shift+U）—— 与 `render/dmg-fx.ts` 同一份配置：
 * 滑块只用数字输入框（没有 `<input type=range>` 的值格式差异），每改一项即刻 `dmgFxSet`，
 * 飘字绘制段每帧 `dmgFxGet()`，改完本次出招就生效 —— 手感全部可实时调，不用改代码重试。
 *
 * 刻意**不参与**层栈（#42 "声明即参与"）：它是开发工具，固定置顶（同 DevLog/Perf）。
 */
import { dmgFxGet, dmgFxSet, dmgFxReset, type DmgFxConfig } from '../render/dmg-fx.js';

type Field = { key: keyof DmgFxConfig; label: string; step: number; min: number; max: number };

const FIELDS: Field[] = [
  { key: 'bounceMs', label: '弹跳时长 ms', step: 10, min: 0, max: 1000 },
  { key: 'scaleNormal', label: '普通峰值', step: 0.05, min: 1, max: 3 },
  { key: 'scaleCrit', label: '暴击峰值', step: 0.05, min: 1, max: 4 },
  { key: 'upPeak', label: '弹起高度', step: 4, min: 0, max: 160 },
  { key: 'dropDepth', label: '落下深度', step: 2, min: 0, max: 120 },
  { key: 'driftNormal', label: '普通漂移', step: 2, min: 0, max: 160 },
  { key: 'driftCrit', label: '暴击漂移', step: 2, min: 0, max: 200 },
];

let panel: HTMLDivElement | null = null;
let installed = false;
let visible = false;
let keyHandler: ((e: KeyboardEvent) => void) | null = null;

function refresh(): void {
  if (!panel) return;
  const cfg = dmgFxGet();
  for (const f of FIELDS) {
    const el = panel!.querySelector<HTMLInputElement>(`input[data-key="${f.key}"]`);
    if (el) el.value = String(cfg[f.key]);
  }
}

function buildPanel(): void {
  panel = document.createElement('div');
  panel.className = 'jp-dmgfx-panel';
  const s = panel.style;
  Object.assign(s, {
    position: 'fixed', left: '12px', top: '12px', width: '250px', zIndex: '100000',
    background: 'rgba(8,12,18,.92)', border: '1px solid #39465a', borderRadius: '6px',
    padding: '8px 10px', font: '12px/1.45 ui-monospace,Consolas,monospace', color: '#dce6f2',
    display: visible ? 'flex' : 'none', flexDirection: 'column', gap: '4px',
    userSelect: 'none',
  });

  const title = document.createElement('div');
  Object.assign(title.style, {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    fontWeight: '700', color: '#ffd166', marginBottom: '4px',
  });
  title.textContent = '伤害数字打击感';

  const reset = document.createElement('button');
  reset.type = 'button';
  Object.assign(reset.style, {
    font: 'inherit', background: '#22304a', color: '#dfe8ff', border: '1px solid #39465a',
    borderRadius: '4px', cursor: 'pointer', padding: '1px 8px',
  });
  reset.textContent = '重置';
  reset.addEventListener('click', () => { dmgFxReset(); refresh(); });
  title.appendChild(reset);
  panel.appendChild(title);

  for (const f of FIELDS) {
    const row = document.createElement('label');
    Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    row.textContent = f.label;
    const input = document.createElement('input');
    input.type = 'number';
    input.dataset.key = f.key;
    Object.assign(input.style, {
      width: '76px', font: 'inherit', color: 'inherit', background: '#10151f',
      border: '1px solid #39465a', borderRadius: '4px', padding: '1px 4px', textAlign: 'right',
    });
    input.step = String(f.step);
    input.min = String(f.min);
    input.max = String(f.max);
    input.addEventListener('input', () => {
      const v = Number(input.value);
      if (Number.isFinite(v)) dmgFxSet({ [f.key]: v } as Partial<DmgFxConfig>);
    });
    row.appendChild(input);
    panel.appendChild(row);
  }
  document.body.appendChild(panel);
  refresh();
}

function toggle(): void {
  if (!panel) buildPanel();
  visible = !visible;
  panel!.style.display = visible ? 'flex' : 'none';
}

function destroy(): void {
  if (keyHandler) { window.removeEventListener('keydown', keyHandler); keyHandler = null; }
  panel?.remove();
  panel = null;
  installed = false;
  visible = false;
}

if (import.meta.hot) import.meta.hot.dispose(destroy);

export function installDmgFxPanel(): void {
  if (installed) return;
  installed = true;
  keyHandler = (e: KeyboardEvent) => {
    // Ctrl+Shift+U（避开 Perf 的 P / DevLog 的 L 与其它功能键）
    if (e.ctrlKey && e.shiftKey && e.code === 'KeyU') {
      e.preventDefault();
      toggle();
    }
  };
  window.addEventListener('keydown', keyHandler);
}

export function toggleDmgFxPanel(): void {
  toggle();
}