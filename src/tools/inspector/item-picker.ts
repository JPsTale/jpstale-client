/**
 * 资产检查器 —— 装备选择弹框（替代难用的 <select>）。
 *
 * 形态参考原作物品选择器：顶部一级分类（武器/防具/饰品）、二级武器类型标签，
 * 左侧物品列表（名称 + 需求等级），右侧详情面板（需求/基础/杂项）。
 * 单击选中看详情，点「装备」应用；Esc / 点遮罩 / 关闭按钮退出。
 */
import { el } from './dom.js';

export interface PickerItem {
  id: number; code: number; name: string; icon: string; folder: string;
  class: number; pos: number; sound: number; reqLv: number;
  type: string; hand: string; soundCode: number;
  /** 收械挂点槽位（`getSheatheSlot` 分层解析：语义表 → 源码表 → 族规则 → default） */
  sheatheSlot?: string;
  /** 槽位来源，用于区分"权威表值"与"规则兜底"：character.cpp / user / family-rule(…) / default */
  sheatheSrc?: string;
}

/** 语义类型 → 显示名（对齐原作标签：Fists=拳套, Phantoms=图腾, Wands & Staffs 合并） */
const TYPE_LABEL: Record<string, string> = {
  AXE: 'Axes', CLAW: 'Claws', DAGGER: 'Daggers', KNUCKLE: 'Fists',
  HAMMER: 'Hammers', JAVELIN: 'Javelins', PHANTOM: 'Phantoms',
  SCYTHE: 'Scythes', SWORD: 'Swords', BOW: 'Bows', CROSSBOW: 'Crossbows', STAFF: 'Wands & Staffs',
  UNKNOWN: '未定类型',
};
/** 槽位 → 简短显示（挂点核对用） */
const SLOT_LABEL: Record<string, string> = {
  hand: '手', back: '背', bow: '弓背', crossbow: '弩背', dagger_l: '腰左', dagger_r: '腰右',
};

const TYPE_ORDER = ['AXE', 'CLAW', 'DAGGER', 'KNUCKLE', 'HAMMER', 'JAVELIN', 'PHANTOM', 'SCYTHE', 'SWORD', 'BOW', 'CROSSBOW', 'STAFF', 'UNKNOWN'];

let modal: HTMLElement | null = null;

export function closeItemPicker(): void {
  modal?.remove();
  modal = null;
}

export function openItemPicker(
  items: PickerItem[],
  onPick: (it: PickerItem | null) => void,
  currentId?: string,
): void {
  closeItemPicker();

  const byType = new Map<string, PickerItem[]>();
  for (const it of items) byType.set(it.type, [...(byType.get(it.type) ?? []), it]);
  for (const list of byType.values()) list.sort((a, b) => a.reqLv - b.reqLv || a.name.localeCompare(b.name));
  const types = TYPE_ORDER.filter((t) => byType.has(t));

  modal = el('div', 'ins-modal');
  const box = el('div', 'ins-modal-box');
  modal.appendChild(box);

  // 一级分类（目前只有武器有数据；其余按原作形态保留标签位）
  const lvl1 = el('div', 'ins-mk-row ins-mk-lvl1');
  for (const [label, active] of [['Weapons', true], ['Defenses', false], ['Accessories', false]] as const) {
    const b = el('button', 'ins-mk-tab' + (active ? ' ins-mk-tab--on' : ''), label);
    if (!active) { b.disabled = true; b.title = '防具/饰品走「装甲」面板，此处暂只列武器'; }
    lvl1.appendChild(b);
  }
  box.appendChild(lvl1);

  // 二级：武器类型
  const lvl2 = el('div', 'ins-mk-row ins-mk-lvl2');
  // 初始类型优先级：**当前武器的类型**（打开弹框多半是为改它）> 上次记忆 > 第一个
  const LS_TYPE = 'pt.inspector.picker.type';
  let saved: string | null = null;
  try { saved = localStorage.getItem(LS_TYPE); } catch { /* ignore */ }
  const curItem = currentId ? items.find((i) => String(i.id) === currentId) : undefined;
  let curType = curItem?.type
    ?? (saved && types.includes(saved) ? saved : (types[0] ?? 'UNKNOWN'));
  const typeBtns = new Map<string, HTMLElement>();
  for (const t of types) {
    const b = el('button', 'ins-mk-tab' + (t === curType ? ' ins-mk-tab--on' : ''), TYPE_LABEL[t] ?? t);
    b.onclick = () => {
      curType = t;
      try { localStorage.setItem(LS_TYPE, t); } catch { /* ignore */ }
      for (const [k, el2] of typeBtns) el2.classList.toggle('ins-mk-tab--on', k === t);
      renderList();
    };
    typeBtns.set(t, b);
    lvl2.appendChild(b);
  }
  box.appendChild(lvl2);

  const body = el('div', 'ins-mk-body');
  const listBox = el('div', 'ins-mk-list');
  const detail = el('div', 'ins-mk-detail');
  body.append(listBox, detail);
  box.appendChild(body);

  let picked: PickerItem | null = null;

  const showDetail = (it: PickerItem | null) => {
    detail.innerHTML = '';
    if (!it) { detail.appendChild(el('div', 'ins-dim', '（选中一件物品查看详情）')); return; }
    // 预览区：图标（可能缺失，用 onerror 标注而不是留破图）
    const prev = el('div', 'ins-mk-prev');
    const img = el('img', 'ins-mk-img') as HTMLImageElement;
    img.src = `/res/image/sinimage/items/${it.folder}/it${it.icon}.bmp`;
    img.onerror = () => img.replaceWith(el('div', 'ins-dim', '无图标资产'));
    prev.appendChild(img);
    detail.appendChild(prev);

    const sec = (title: string, rows: Array<[string, string]>) => {
      detail.appendChild(el('div', 'ins-mk-sec', title));
      const t = el('table', 'ins-mk-tbl');
      for (const [k, v] of rows) {
        const tr = el('tr');
        tr.append(el('td', 'ins-mk-k', k), el('td', 'ins-mk-v', v));
        t.appendChild(tr);
      }
      detail.appendChild(t);
    };
    detail.appendChild(el('div', 'ins-mk-name', `${it.name}`));
    sec('Requirements', [['Level', String(it.reqLv)]]);
    sec('Base Stats', [
      ['Type', `${it.type}${TYPE_LABEL[it.type] ? `（${TYPE_LABEL[it.type]}）` : ''}`],
      ['Hand', it.hand],
      ['Attack Sound Code', String(it.soundCode)],
      ['Equip Slot (classitem)', String(it.class)],
      ['Model Position', String(it.pos)],
    ]);
    sec('Misc', [
      ['Sheathe Slot', it.sheatheSlot ? `${it.sheatheSlot}（${SLOT_LABEL[it.sheatheSlot] ?? '?'}）` : '未知'],
      ['Sheathe Source', it.sheatheSrc ?? '—'],
      ['idCode', String(it.code)],
      ['icon / dorp', it.icon],
      ['folder', it.folder],
      ['Pickup Sound', String(it.sound)],
    ]);
  };

  const renderList = () => {
    listBox.innerHTML = '';
    const list = byType.get(curType) ?? [];
    const head = el('div', 'ins-mk-head', `Item Name（${list.length}）　Level`);
    listBox.appendChild(head);
    for (const it of list) {
      const row = el('div', 'ins-mk-item' + (String(it.id) === currentId ? ' ins-mk-item--cur' : ''));
      row.append(
        el('span', 'ins-mk-hand', it.hand || '—'),          // 1H/2H 直接可见
        el('span', 'ins-mk-slot', it.sheatheSlot ? (SLOT_LABEL[it.sheatheSlot] ?? it.sheatheSlot) : '?'),  // 收械挂点
        el('span', 'ins-mk-iname', it.name),
        el('span', 'ins-mk-ilv', String(it.reqLv)),
      );
      row.onclick = () => {
        picked = it;
        for (const r of listBox.querySelectorAll('.ins-mk-item')) r.classList.remove('ins-mk-item--sel');
        row.classList.add('ins-mk-item--sel');
        showDetail(it);
      };
      row.ondblclick = () => { picked = it; onPick(it); closeItemPicker(); };
      listBox.appendChild(row);
    }
    if (!list.length) listBox.appendChild(el('div', 'ins-dim', '（该类型暂无物品）'));
  };

  const foot = el('div', 'ins-mk-row ins-mk-foot');
  const btnEmpty = el('button', 'ins-mk-btn', '清空（空手）');
  btnEmpty.onclick = () => { onPick(null); closeItemPicker(); };
  const btnOk = el('button', 'ins-mk-btn ins-mk-btn--ok', '装备');
  btnOk.onclick = () => { if (picked) { onPick(picked); closeItemPicker(); } };
  const btnCancel = el('button', 'ins-mk-btn', '关闭');
  btnCancel.onclick = () => closeItemPicker();
  foot.append(btnEmpty, btnOk, btnCancel);
  box.appendChild(foot);

  modal.onclick = (e) => { if (e.target === modal) closeItemPicker(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { closeItemPicker(); window.removeEventListener('keydown', onKey); } };
  window.addEventListener('keydown', onKey);

  document.body.appendChild(modal);
  renderList();
  // 自动选中当前武器并滚到可见处（免得每次手动翻列表）
  if (curItem) {
    picked = curItem;
    const rows = [...listBox.querySelectorAll('.ins-mk-item')];
    const idx = (byType.get(curType) ?? []).findIndex((x) => x.id === curItem.id);
    const rowEl = idx >= 0 ? rows[idx] : undefined;
    rowEl?.classList.add('ins-mk-item--sel');
    rowEl?.scrollIntoView({ block: 'center' });
    showDetail(curItem);
  } else {
    showDetail(null);
  }
}
