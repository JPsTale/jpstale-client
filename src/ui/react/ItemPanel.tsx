import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { subscribeGame, getGameSnapshot, localBagMove, localStackMerge, localUnequipToBag, localEquipItem, localToHeld, removeInventoryItem, type GameItem } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import {
  itemDefById,
  itemIconUrl,
} from '../../game/data/itemDefs.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { sendEquipItem, sendUnequipItem, sendDropItem, sendSwitchWeapon, sendBagLayout, sendStackMerge } from '../../net/bridge.js';
import { useItemHover, ItemInfo } from './ItemInfo.js';

// 画布常量（对齐服务端 ItemLocations）
const BAG_W = 12;
const BAG_H = 12;
const CELL = 22; // 一格 22px

// 物品定义类型（从 itemDefs）
interface Def { id: number; code: number; name: string; icon: string; folder: string; w: number; h: number; class: number; pos: number; sound: number; reqLv: number }

// slot → x/y（y*W+x）
function slotXY(slot: number): { x: number; y: number } {
  return { x: slot % BAG_W, y: Math.floor(slot / BAG_W) };
}

/** 图片 hook：普通 BMP 黑色背景透明化；返回 dataURL。 */
function useItemImg(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(url);
  useEffect(() => {
    let alive = true;
    if (!url) { setSrc(null); return; }
    setSrc(url); // 先裸显，透明化成功再替换
    transparentBmp(url).then((p) => { if (alive) setSrc(p ?? url); });
    return () => { alive = false; };
  }, [url]);
  return src;
}

function defOf(it: GameItem): Def | undefined {
  return itemDefById(it.itemlistId);
}

// ==================== 背包画布 ====================
// 图标直接相对画布定位（左上角=slot 的 x/y），占多格 w×h；格线仅用 CSS 背景画布线，不遮挡图标。

export type BagDropMode = 'free' | 'merge' | 'swap' | 'bad';

/** 装备需求本地预校验（与服务器 ItemService.meetsRequirements 同规则） */
function meetsEquipReq(it: GameItem, ch: { level?: number; strength?: number; spirit?: number; talent?: number; agility?: number; health?: number } | null): boolean {
  if (!ch) return false;
  const lv = ch.level ?? 0, st = ch.strength ?? 0, sp = ch.spirit ?? 0;
  const ta = ch.talent ?? 0, ag = ch.agility ?? 0, hp = ch.health ?? 0;
  return lv >= it.reqLevel && st >= it.reqStrength && sp >= it.reqSpirit
    && ta >= it.reqTalent && ag >= it.reqAgility && hp >= it.reqHealth;
}

/** 计算把 it 放到 bag 的 slot 会发生什么（对齐原版：0 冲突可放；1 件同种可叠→合并、否则换手；≥2→不可） */
function bagTargetFor(it: GameItem, slot: number, items: GameItem[]): { mode: BagDropMode; conflict?: GameItem } {
  const def = defOf(it);
  const gw = def?.w ?? 1;
  const gh = def?.h ?? 1;
  const { x, y } = slotXY(slot);
  if (x + gw > BAG_W || y + gh > BAG_H) return { mode: 'bad' };
  const hits: GameItem[] = [];
  for (const o of items) {
    if (o.location !== 0 || o.uid === it.uid) continue;
    const od = defOf(o);
    const oo = slotXY(o.slot);
    const ow = od?.w ?? 1;
    const oh = od?.h ?? 1;
    if (oo.x < x + gw && oo.x + ow > x && oo.y < y + gh && oo.y + oh > y) hits.push(o);
  }
  if (hits.length === 0) return { mode: 'free' };
  // 装备槽来源：目标格必须为空（不换手/不合并）
  if (it.location !== 0) return { mode: 'bad' };
  if (hits.length === 1) {
    const c = hits[0];
    const sameStack = c.itemlistId === it.itemlistId && it.count + c.count <= 1000;
    // 可堆叠且同种 → 合并；否则换手（被撞件拿起）
    return sameStack ? { mode: 'merge', conflict: c } : { mode: 'swap', conflict: c };
  }
  return { mode: 'bad' };
}

// ==================== 背包画布（原版拖放视觉） ====================
// 拿起后物品不在原格绘制（光标持物）；拖动中落点按模式给 footprint 高亮：
// free 可放(蓝绿) / merge 合并(亮) / swap 换手(黄?) / bad 红（≥2 件冲突/越界）。
function BagCanvas({ items, held, onPick, onPutSlot, onZone, onHover, onHoverEnd }: {
  items: GameItem[];
  held: GameItem | null;
  onPick: (it: GameItem) => void;
  onPutSlot: (slot: number) => void;
  onZone: (overBag: boolean) => void;
  onHover: (it: GameItem, e: { clientX: number; clientY: number }) => void;
  onHoverEnd: () => void;
}) {
  const bagRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<BagDropMode | null>(null);
  // 拿起中的物品从原格隐藏（留在背包视觉上"空出"），不再原地绘制
  const placed = items
    .filter((x) => x.location === 0 && x.uid !== held?.uid)
    .map((it) => {
      const def = defOf(it);
      const { x, y } = slotXY(it.slot);
      return { it, x, y, w: def?.w ?? 1, h: def?.h ?? 1 };
    });

  /** 落点锚 = 指针所在格左上（对齐原版 SetInvenItemAreaCheck：ColorRect 取指针格起点，足迹=物品 w×h） */
  function anchoredTopLeft(cx: number, cy: number, gw: number, gh: number): { x: number; y: number } | null {
    const el = bagRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const cellX = Math.floor((cx - rect.left - el.clientLeft) / CELL);
    const cellY = Math.floor((cy - rect.top - el.clientTop) / CELL);
    if (cellX < 0 || cellX >= BAG_W || cellY < 0 || cellY >= BAG_H) return null;
    if (cellX + gw > BAG_W || cellY + gh > BAG_H) return null;
    return { x: cellX, y: cellY };
  }

  function updatePreview(cx: number, cy: number) {
    if (!held) { setAnchor(null); setMode(null); return; }
    const gw = defOf(held)?.w ?? 1;
    const gh = defOf(held)?.h ?? 1;
    const a = anchoredTopLeft(cx, cy, gw, gh);
    if (!a) { setAnchor(null); setMode(null); return; }
    setAnchor(a);
    setMode(bagTargetFor(held, a.y * BAG_W + a.x, items).mode);
  }

  function cellFromEvent(e: { clientX: number; clientY: number }): number | null {
    const el = bagRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const gx = Math.floor((e.clientX - rect.left - el.clientLeft) / CELL);
    const gy = Math.floor((e.clientY - rect.top - el.clientTop) / CELL);
    if (gx < 0 || gx >= BAG_W || gy < 0 || gy >= BAG_H) return null;
    return gy * BAG_W + gx;
  }

  function onBagPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (held) {
      const gw = defOf(held)?.w ?? 1;
      const gh = defOf(held)?.h ?? 1;
      const a = anchoredTopLeft(e.clientX, e.clientY, gw, gh);
      if (!a) return;
      // 拿起中：落点放置（空位/合并/换手统一），bad 忽略
      const t = bagTargetFor(held, a.y * BAG_W + a.x, items);
      if (t.mode === 'bad') return;
      onHoverEnd();
      onPutSlot(a.y * BAG_W + a.x);
    } else {
      const slot = cellFromEvent(e);
      if (slot === null) return;
      // 未拿起：命中哪件就拿起哪件（按覆盖格命中，含多格物品任意格）
      const p = placed.find((pp) => slotXY(slot).x >= pp.x && slotXY(slot).x < pp.x + pp.w
        && slotXY(slot).y >= pp.y && slotXY(slot).y < pp.y + pp.h);
      if (p) { onHoverEnd(); onPick(p.it); }
    }
  }

  return (
    <div
      className="jp-items-bag"
      ref={bagRef}
      style={{ width: BAG_W * CELL, height: BAG_H * CELL }}
      onPointerMove={(e) => { onZone(true); updatePreview(e.clientX, e.clientY); }}
      onPointerDown={onBagPointerDown}
      onPointerLeave={() => { onZone(false); setAnchor(null); setMode(null); }}
    >
      {/* 物品图标（拿起中的物品不绘制 → 原格空出）；按下事件交给容器统一分发 */}
      {placed.map((p) => (
        <button
          type="button"
          key={p.it.uid}
          className="jp-bag-item"
          style={{ left: p.x * CELL, top: p.y * CELL, width: p.w * CELL, height: p.h * CELL }}
          onPointerEnter={(e) => { e.stopPropagation(); onHover(p.it, e); }}
          onPointerLeave={onHoverEnd}
        >
          <ItemImg it={p.it} w={p.w * CELL} h={p.h * CELL} />
          {p.it.count > 1 ? <span className="jp-bag-count">{p.it.count}</span> : null}
        </button>
      ))}
      {/* 落点 footprint 预览：色框 + 幽灵物品（所见=所落） */}
      {held && anchor && mode ? (
        <div
          className={`jp-bag-preview jp-bag-preview--${mode}`}
          style={{
            left: anchor.x * CELL,
            top: anchor.y * CELL,
            width: (defOf(held)?.w ?? 1) * CELL,
            height: (defOf(held)?.h ?? 1) * CELL,
          }}
        >
          <ItemImg it={held} w={(defOf(held)?.w ?? 1) * CELL} h={(defOf(held)?.h ?? 1) * CELL} />
          {held.count > 1 ? <span className="jp-bag-count">{held.count}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ItemImg({ it, w, h }: { it: GameItem; w: number; h: number }) {
  const def = defOf(it);
  const url = def ? itemIconUrl(def) : null;
  const src = useItemImg(url);
  if (!def) return <span className="jp-items-unknown">#{it.itemlistId}</span>;
  if (!src) return null;
  return (
    <img
      src={src}
      alt={def.name}
      className="jp-item-iconimg"
      style={{ width: w, height: h }}
      draggable={false}
    />
  );
}

/** 拿起中的物品跟随鼠标（原版 MouseItem 持物光标，按物品原占格尺寸显示） */
function HeldIcon({ held, pos }: { held: GameItem; pos: { x: number; y: number } | null }) {
  if (!pos) return null;
  const def = defOf(held);
  const w = (def?.w ?? 1) * CELL;
  const h = (def?.h ?? 1) * CELL;
  return createPortal(
    <div className="jp-hand-ic" style={{ left: pos.x - w / 2, top: pos.y - h / 2, width: w, height: h }}>
      <ItemImg it={held} w={w} h={h} />
      {held.count > 1 ? <span className="jp-hand-count">{held.count}</span> : null}
    </div>,
    document.body,
  );
}

// ==================== 装备栏 ====================

interface SlotDef { slot: number; kind: 'small' | 'large' | 'mid'; label: string }

const EQUIP_TOP: SlotDef[] = [
  { slot: 4, kind: 'small', label: 'Amulet' },
  { slot: 6, kind: 'small', label: 'Ring L' },
  { slot: 5, kind: 'small', label: 'Ring R' },
  { slot: 7, kind: 'small', label: 'Sheltom' },
];
const EQUIP_MID: SlotDef[] = [
  { slot: 1, kind: 'large', label: 'Main Hand' },
  { slot: 3, kind: 'large', label: 'Armor' },
  { slot: 2, kind: 'large', label: 'Off Hand' },
];
const EQUIP_BOT: SlotDef[] = [
  { slot: 9, kind: 'mid', label: 'Gloves' },
  { slot: 8, kind: 'mid', label: 'Armlet' },
  { slot: 10, kind: 'mid', label: 'Boots' },
];

function sizeOf(kind: SlotDef['kind']): { w: number; h: number } {
  return kind === 'large' ? { w: 66, h: 88 } : kind === 'mid' ? { w: 44, h: 44 } : { w: 22, h: 22 };
}

/** 物品图标在槽内的显示尺寸：按占格尺寸居中，不拉伸（大槽内 1×1 物显示 22px 居中） */
function itemViewSize(it: GameItem, slotKind: SlotDef['kind']): { w: number; h: number } {
  const def = defOf(it);
  const gw = def?.w ?? 1;
  const gh = def?.h ?? 1;
  const box = sizeOf(slotKind);
  // 按占格像素；若超出槽盒则缩到槽内
  let w = gw * CELL;
  let h = gh * CELL;
  const scale = Math.min(box.w / w, box.h / h, 1);
  if (scale < 1) { w = Math.round(w * scale); h = Math.round(h * scale); }
  return { w, h };
}

function EquipColumn({ items, held, onPickEquip, onPutEquip, allowed, onHover, onHoverEnd }: {
  items: GameItem[];
  held: GameItem | null;
  onPickEquip: (slot: number) => void;
  onPutEquip: (slot: number) => void;
  allowed: (slot: number) => boolean;
  onHover: (it: GameItem, e: { clientX: number; clientY: number }) => void;
  onHoverEnd: () => void;
}) {
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  const eq = (slot: number) => items.find((x) => x.location === 2 && x.slot === slot && x.uid !== held?.uid);

  const renderRow = (list: SlotDef[]) => (
    <div className="jp-items-equiprow">
      {list.map((s) => {
        const it = eq(s.slot);
        const box = sizeOf(s.kind);
        const tint = held && hoverSlot === s.slot ? (allowed(s.slot) ? ' ok' : ' bad') : '';
        return (
          <button
            type="button"
            key={s.slot}
            className={`jp-items-equip jp-items-equip--${s.kind}${tint}`}
            style={{ width: box.w, height: box.h }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (held) {
                // 拿起中：该槽是落点（绿/红已在悬停提示），合法才放
                if (allowed(s.slot)) onPutEquip(s.slot);
                return;
              }
              if (it) onPickEquip(s.slot);
            }}
            title={it ? undefined : s.label}
            onPointerEnter={(e) => {
              if (held) setHoverSlot(s.slot);
              else if (it) { e.stopPropagation(); onHover(it, e); }
            }}
            onPointerLeave={() => { setHoverSlot(null); onHoverEnd(); }}
          >
            {it ? (
              <ItemImg it={it} {...itemViewSize(it, s.kind)} />
            ) : (
              <span className="jp-items-equip-label">{s.label}</span>
            )}
          </button>
        );
      })}
    </div>
  );

  return (
    <div className="jp-items-equips">
      {renderRow(EQUIP_TOP)}
      {renderRow(EQUIP_MID)}
      {renderRow(EQUIP_BOT)}
    </div>
  );
}

// ==================== 主面板 ====================

export default function ItemPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const { inventory } = snap;
  const [heldUid, setHeldUid] = useState<number | null>(null);
  const { hover, show: hoverShow, hide: hoverHide } = useItemHover();
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null);
  const [overBag, setOverBag] = useState(false);
  // 穿装备交换：等待服务端 ack 的挂起状态（成功=旧件保持手持；失败=还原）
  const pendingSwap = useRef<{ newUid: number; newBagSlot: number; oldUid: number | null; oldEquipSlot: number | null } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // 拿起/放下时信息框消失（原版：拖起时不再显示 hover 信息）
  useEffect(() => {
    if (heldUid != null) hoverHide();
  }, [heldUid]);
  // 持有期间全窗口跟踪鼠标（拿起瞬间即用指针位置，无残留/无需先滑动）
  useEffect(() => {
    if (heldUid == null) { setCursorPos(null); return; }
    const mv = (e: PointerEvent) => setCursorPos({ x: e.clientX, y: e.clientY });
    window.addEventListener('pointermove', mv);
    return () => window.removeEventListener('pointermove', mv);
  }, [heldUid]);
  // 穿装备 ack：新件 location 变为 2（已穿上）→ 挂起结束
  useEffect(() => {
    const p = pendingSwap.current;
    if (!p) return;
    const n = getGameSnapshot().inventory?.items.find((x) => x.uid === p.newUid);
    if (n && n.location === 2) {
      pendingSwap.current = null;
    }
  }, [snap.inventory]);
  // 拿起中：点击背包面板外区域 → 丢到地面（原版 ThrowItem；不是摧毁）
  useEffect(() => {
    if (heldUid == null) return;
    const onDown = (e: PointerEvent) => {
      const el = panelRef.current;
      const t = e.target as Node | null;
      if (el && t && el.contains(t)) return; // 面板内交互照常
      const it = getGameSnapshot().inventory?.items.find((x) => x.uid === heldUid);
      if (!it) { setHeldUid(null); return; }
      console.log('[bag] 丢到地面 uid=', it.uid, 'count=', it.count);
      removeInventoryItem(it.uid);      // 本地即时移除
      sendDropItem(it.uid, it.count || 1);
      setHeldUid(null);
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [heldUid]);
  // 穿装备失败（服务端 error）：本地即时改动还原——新件回背包原格，旧件回装备槽
  useEffect(() => {
    const onFail = () => {
      const p = pendingSwap.current;
      if (!p) return;
      localUnequipToBag(p.newUid, p.newBagSlot);
      if (p.oldUid != null && p.oldEquipSlot != null) {
        localEquipItem(p.oldUid, p.oldEquipSlot);
      }
      pendingSwap.current = null;
      setHeldUid(null);
    };
    window.addEventListener('pt:equipFail', onFail);
    return () => window.removeEventListener('pt:equipFail', onFail);
  }, []);

  if (!inventory) return <div className="jp-nodata">{t('item.noData')}</div>;

  const items = inventory.items;
  const held = heldUid != null ? items.find((x) => x.uid === heldUid) ?? null : null;
  const overload = !!snap.character && (snap.character.currentWeight ?? 0) > (snap.character.maxWeight ?? 0);
  const heldDef = held ? defOf(held) : undefined;

  /** 目标装备槽是否允许当前 held 物品 */
  function slotAllows(slot: number): boolean {
    if (!heldDef) return false;
    switch (heldDef.class) {
      case 2: return slot === 2;
      case 4: return slot === 1;
      case 6: return slot === 1;
      case 8: return slot === 3;
      case 16: return slot === 10;
      case 32: return slot === 9;
      case 192: return slot === 5 || slot === 6;
      case 256: return slot === 7;
      case 512: return slot === 4;
      case 2048: return slot === 8;
      default: return false;
    }
  }

  function onPickBag(it: GameItem) {
    // 拿起背包物品（源格由 BagCanvas 按 held 隐藏空出）
    setHeldUid(it.uid);
  }

  function onPutToBagSlot(targetSlot: number) {
    if (!held) return;
    if (held.location === 2) {
      // 装备 → 指定背包格（本地即时落格 + 上报布局；服务端落库并刷新属性/外观）
      const t = bagTargetFor(held, targetSlot, items);
      console.log('[bag] 卸装到指定格 uid=', held.uid, '→slot=', targetSlot, 'mode=', t.mode);
      if (t.mode === 'bad') return;
      localUnequipToBag(held.uid, targetSlot);
      sendBagLayout([{ uid: held.uid, slot: targetSlot }]);
      setHeldUid(null);
      return;
    }
    if (held.location !== 0) return;
    if (targetSlot === held.slot) { setHeldUid(null); return; }
    // 客户端网格权威：本地即时落子并渲染，随后上报布局；药水合并走 StackMerge
    const t = bagTargetFor(held, targetSlot, items);
    console.log('[bag] 放置 held uid=', held.uid, '来自slot=', held.slot, '→目标slot=', targetSlot,
      'xy=', JSON.stringify(slotXY(targetSlot)), 'mode=', t.mode, 'conflict=', t.conflict?.uid);
    if (t.mode === 'bad') return;
    if (t.mode === 'merge' && t.conflict) {
      localStackMerge(held.uid, t.conflict.uid);
      sendStackMerge(held.uid, t.conflict.uid);
      setHeldUid(null);
      return;
    }
    localBagMove(held.uid, targetSlot);
    sendBagLayout([{ uid: held.uid, slot: targetSlot }]);
    if (t.mode === 'swap' && t.conflict) {
      // 换手：被撞件"拿起"（客户端本地语义；其服务端槽位保持到下次放置才上报）
      setHeldUid(t.conflict.uid);
    } else {
      setHeldUid(null);
    }
  }

  function onPickEquip(slot: number) {
    const it = items.find((x) => x.location === 2 && x.slot === slot);
    if (it) setHeldUid(it.uid);
  }

  function onPutEquip(slot: number) {
    if (!held) return;
    if (!slotAllows(slot)) return;
    if (held.location === 0) {
      // 客户端预校验（与服务器一致）：不满足则保持手持、不发送
      if (!meetsEquipReq(held, snap.character)) {
        console.warn('[bag] 装备需求不足，穿入取消 uid=', held.uid);
        return;
      }
      const old = items.find((x) => x.location === 2 && x.slot === slot) ?? null;
      pendingSwap.current = old
        ? { newUid: held.uid, newBagSlot: held.slot, oldUid: old.uid, oldEquipSlot: old.slot }
        : { newUid: held.uid, newBagSlot: held.slot, oldUid: null, oldEquipSlot: null };
      // 本地即时：新件立刻进装备槽（背包即刻消失，不存在"回闪"）；旧件若在则抽离为手持
      setHeldUid(old ? old.uid : null);
      localEquipItem(held.uid, slot);
      if (old) localToHeld(old.uid);
      sendEquipItem(held.uid, slot);
    } else if (held.location === 2 && held.slot !== slot) {
      // 装备 → 另一装备槽（服务端无直换）：先脱回背包（旧槽清空），held 仍指向实例，
      // 待 store 收到 ItemUpdate 后其 location 变 0，用户再点目标空槽完成穿入。
      sendUnequipItem(held.slot);
    }
  }

  return (
    <>
      <div className="jp-items" ref={panelRef}>
        <div className="jp-items-left">
          <BagCanvas
            items={items}
            held={held}
            onPick={onPickBag}
            onPutSlot={onPutToBagSlot}
            onZone={setOverBag}
            onHover={hoverShow}
            onHoverEnd={hoverHide}
          />
          {/* 底部功能区（拿起时不显示物品名/丢弃按钮；丢到地面=点击面板外区域） */}
          <div className="jp-items-foot">
            <span className="jp-items-gold">{t('item.gold')}: {inventory.gold}</span>
            <span className={overload ? 'jp-items-wt jp-items-wt-over' : 'jp-items-wt'}>
              {t('item.weight')}: {snap.character?.currentWeight ?? 0}/{snap.character?.maxWeight ?? 0}
            </span>
            <button type="button" className="jp-items-switch" onClick={() => sendSwitchWeapon()} title="W">⇄</button>
          </div>
        </div>
        <EquipColumn
          items={items}
          held={held}
          onPickEquip={onPickEquip}
          onPutEquip={onPutEquip}
          allowed={slotAllows}
          onHover={hoverShow}
          onHoverEnd={hoverHide}
        />
      </div>
      <ItemInfo hover={hover} />
      {held && !overBag ? <HeldIcon held={held} pos={cursorPos} /> : null}
    </>
  );
}
