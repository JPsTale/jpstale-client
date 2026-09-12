/**
 * 死亡面板 —— 死后三个复活选项 + 强制复活倒计时。
 *
 * 三个选项对应原版 `Interface/sinInterFace.h` 的三个常量：
 *   `RESTART_FEILD=1`（本图离尸体最近的 StartPoint）/ `RESTART_TOWN=2`（村庄）/ `RESTART_EXIT=3`（继续躺）。
 * 代价（本级跨度经验 / 金币）由服务端在 `S2C_PlayerDeath` 里算好下发 —— 客户端只显示、不自己算，
 * 否则两边口径一旦漂移，玩家看到的数字会和实际扣的对不上。
 */
import { t } from '../i18n/index.js';

export interface DeathInfo {
  /** 强制复活倒计时（毫秒） */
  forceRespawnMs: number;
  expLossField: number;
  goldLossField: number;
  expLossTown: number;
}

export interface DeathPanel {
  show(info: DeathInfo): void;
  /** 已发出选择、等服务端复活包：禁用按钮并提示"复活中"（避免"点了没反应"的空窗） */
  setPending(): void;
  hide(): void;
  readonly visible: boolean;
}

interface Row {
  btn: HTMLButtonElement;
  main: HTMLElement;
  cost: HTMLElement;
}

export function createDeathPanel(container: HTMLElement, onChoose: (choice: 1 | 2 | 3) => void): DeathPanel {
  const root = document.createElement('div');
  root.style.cssText = 'display:none;position:fixed;inset:0;z-index:800;align-items:center;justify-content:center;'
    + 'background:rgba(0,0,0,0.55);color:#eee;font:15px/1.6 system-ui,sans-serif;';

  const box = document.createElement('div');
  box.style.cssText = 'min-width:340px;max-width:420px;padding:22px 26px;border:1px solid #6b3d3d;'
    + 'border-radius:6px;background:rgba(28,16,16,0.96);box-shadow:0 8px 32px rgba(0,0,0,0.6);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:22px;font-weight:700;color:#ff9c8a;text-align:center;margin-bottom:4px;';

  const timer = document.createElement('div');
  timer.style.cssText = 'text-align:center;color:#c9a;font-size:13px;margin-bottom:16px;';

  const mkRow = (choice: 1 | 2 | 3): Row => {
    const btn = document.createElement('button');
    btn.style.cssText = 'display:block;width:100%;margin:8px 0;padding:10px 12px;text-align:left;cursor:pointer;'
      + 'border:1px solid #7a4a4a;border-radius:4px;background:#2c1a1a;color:#f0dcdc;font:14px/1.4 system-ui,sans-serif;';
    btn.addEventListener('mouseenter', () => { btn.style.background = '#3d2323'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = '#2c1a1a'; });
    btn.addEventListener('click', () => onChoose(choice));
    const main = document.createElement('div');
    main.style.cssText = 'font-weight:600;';
    const cost = document.createElement('div');
    cost.style.cssText = 'font-size:12px;color:#c8a0a0;margin-top:2px;';
    btn.append(main, cost);
    return { btn, main, cost };
  };

  const rows: Array<{ row: Row; label: string; cost: (i: DeathInfo) => string }> = [
    { row: mkRow(1), label: 'death.option.field', cost: (i) => t('death.option.fieldCost', { exp: String(i.expLossField), gold: String(i.goldLossField) }) },
    { row: mkRow(2), label: 'death.option.town', cost: (i) => t('death.option.townCost', { exp: String(i.expLossTown) }) },
    { row: mkRow(3), label: 'death.option.wait', cost: () => t('death.option.waitCost') },
  ];
  box.append(title, timer, ...rows.map((r) => r.row.btn));
  root.appendChild(box);
  container.appendChild(root);

  let info: DeathInfo | null = null;
  let deadline = 0;
  let handle = 0;

  const render = (): void => {
    if (!info) return;
    title.textContent = t('death.title');
    for (const r of rows) {
      r.row.main.textContent = t(r.label);
      r.row.cost.textContent = r.cost(info);
    }
    const left = Math.max(0, Math.ceil((deadline - performance.now()) / 1000));
    timer.textContent = t('death.timer', { sec: String(left) });
  };

  return {
    get visible() { return root.style.display !== 'none'; },
    show(next: DeathInfo) {
      info = next;
      deadline = performance.now() + Math.max(0, next.forceRespawnMs);
      for (const r of rows) { r.row.btn.disabled = false; r.row.btn.style.opacity = '1'; }
      root.style.display = 'flex';
      render();
      if (handle) clearInterval(handle);
      handle = window.setInterval(render, 1000);
    },
    setPending() {
      for (const r of rows) { r.row.btn.disabled = true; r.row.btn.style.opacity = '0.55'; }
      if (handle) { clearInterval(handle); handle = 0; }
      title.textContent = t('death.pending');
      timer.textContent = '';
    },
    hide() {
      root.style.display = 'none';
      if (handle) { clearInterval(handle); handle = 0; }
      info = null;
    },
  };
}
