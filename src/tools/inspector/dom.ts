/**
 * 资产检查器的 DOM 构建helpers。
 * 无框架：检查器是开发工具，不值得引入 React 运行时。
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K, cls?: string, text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** 可折叠分组，返回内容容器 */
export function section(parent: HTMLElement, title: string, collapsed = false): HTMLElement {
  const box = el('div', 'ins-sec');
  const head = el('div', 'ins-sec-head', title);
  const body = el('div', 'ins-sec-body');
  box.append(head, body);
  if (collapsed) box.classList.add('ins-sec--collapsed');
  head.onclick = () => box.classList.toggle('ins-sec--collapsed');
  parent.appendChild(box);
  return body;
}

/** 下拉行 */
export function selectRow(
  parent: HTMLElement, label: string,
  options: Array<{ value: string; text: string }>,
  value: string, onChange: (v: string) => void,
): HTMLSelectElement {
  const row = el('div', 'ins-row');
  row.appendChild(el('label', 'ins-label', label));
  const sel = el('select', 'ins-select');
  for (const o of options) {
    const opt = el('option', undefined, o.text);
    opt.value = o.value;
    sel.appendChild(opt);
  }
  sel.value = value;
  sel.onchange = () => onChange(sel.value);
  row.appendChild(sel);
  parent.appendChild(row);
  return sel;
}

/** 数值行（range + 只读数值） */
export function rangeRow(
  parent: HTMLElement, label: string,
  min: number, max: number, step: number, value: number,
  onChange: (v: number) => void,
): void {
  const row = el('div', 'ins-row');
  row.appendChild(el('label', 'ins-label', label));
  const r = el('input', 'ins-range');
  r.type = 'range'; r.min = String(min); r.max = String(max); r.step = String(step);
  r.value = String(value);
  const out = el('span', 'ins-val', String(value));
  r.oninput = () => { out.textContent = r.value; onChange(Number(r.value)); };
  row.append(r, out);
  parent.appendChild(row);
}

/** 复选行 */
export function checkRow(
  parent: HTMLElement, label: string, checked: boolean,
  onChange: (v: boolean) => void,
): HTMLInputElement {
  const row = el('div', 'ins-row ins-row--check');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.onchange = () => onChange(cb.checked);
  row.append(cb, el('label', 'ins-label', label));
  parent.appendChild(row);
  return cb;
}

/** 按钮组 */
export function btnRow(
  parent: HTMLElement,
  buttons: Array<{ label: string; title?: string; onClick: () => void }>,
): HTMLElement {
  const row = el('div', 'ins-btns');
  for (const b of buttons) {
    const btn = el('button', 'ins-btn', b.label);
    if (b.title) btn.title = b.title;
    btn.onclick = b.onClick;
    row.appendChild(btn);
  }
  parent.appendChild(row);
  return row;
}

/** 键值信息行 */
export function infoRow(parent: HTMLElement, key: string, value: string, cls = ''): HTMLElement {
  const row = el('div', 'ins-info' + (cls ? ' ' + cls : ''));
  row.append(el('span', 'ins-info-k', key), el('span', 'ins-info-v', value));
  parent.appendChild(row);
  return row;
}
