import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { subscribeGame, getGameSnapshot, type GameItem } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import {
  itemDefById,
  itemIconUrl,
} from '../../game/data/itemDefs.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { sendInventoryMove, sendEquipItem, sendUnequipItem, sendDropItem, sendSwitchWeapon } from '../../net/bridge.js';
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
function BagCanvas({ items, held, onPick, onPutSlot, onHover, onHoverEnd }: {
  items: GameItem[];
  held: GameItem | null;
  onPick: (it: GameItem) => void;
  onPutSlot: (slot: number) => void;
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

  function updatePreview(cx: number, cy: number) {
    const el = bagRef.current;
    if (!el || !held) { setAnchor(null); setMode(null); return; }
    const rect = el.getBoundingClientRect();
    const gx = Math.floor((cx - rect.left) / CELL);
    const gy = Math.floor((cy - rect.top) / CELL);
    if (gx < 0 || gx >= BAG_W || gy < 0 || gy >= BAG_H) { setAnchor(null); setMode(null); return; }
    const slot = gy * BAG_W + gx;
    setAnchor({ x: gx, y: gy });
    setMode(bagTargetFor(held, slot, items).mode);
  }

  return (
    <div
      className="jp-items-bag"
      ref={bagRef}
      style={{ width: BAG_W * CELL, height: BAG_H * CELL }}
      onPointerMove={(e) => updatePreview(e.clientX, e.clientY)}
      onPointerLeave={() => { setAnchor(null); setMode(null); }}
      onClick={(e) => {
        if (!held || !bagRef.current) return;
        const rect = bagRef.current.getBoundingClientRect();
        const gx = Math.floor((e.clientX - rect.left) / CELL);
        const gy = Math.floor((e.clientY - rect.top) / CELL);
        if (gx < 0 || gx >= BAG_W || gy < 0 || gy >= BAG_H) return;
        const t = bagTargetFor(held, gy * BAG_W + gx, items);
        if (t.mode === 'bad') return; // 红格：不可放
        onPutSlot(gy * BAG_W + gx);
      }}
    >
      {/* 物品图标（拿起中的物品不绘制 → 原格空出） */}
      {placed.map((p) => (
        <button
          type="button"
          key={p.it.uid}
          className="jp-bag-item"
          style={{ left: p.x * CELL, top: p.y * CELL, width: p.w * CELL, height: p.h * CELL }}
          onPointerDown={(e) => { e.stopPropagation(); onPick(p.it); }}
          onPointerEnter={(e) => { e.stopPropagation(); onHover(p.it, e); }}
          onPointerLeave={onHoverEnd}
        >
          <ItemImg it={p.it} w={p.w * CELL} h={p.h * CELL} />
          {p.it.count > 1 ? <span className="jp-bag-count">{p.it.count}</span> : null}
        </button>
      ))}
      {/* 落点 footprint 预览（不拦截事件） */}
      {held && anchor && mode ? (
        <div
          className={`jp-bag-preview jp-bag-preview--${mode}`}
          style={{
            left: anchor.x * CELL,
            top: anchor.y * CELL,
            width: (defOf(held)?.w ?? 1) * CELL,
            height: (defOf(held)?.h ?? 1) * CELL,
          }}
        />
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

/** 拿起中的物品跟随鼠标（原版 MouseItem 持物光标） */
function HeldIcon({ held, pos }: { held: GameItem; pos: { x: number; y: number } | null }) {
  if (!pos) return null;
  return createPortal(
    <div className="jp-hand-ic" style={{ left: pos.x - 22, top: pos.y - 22 }}>
      <ItemImg it={held} w={44} h={44} />
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
              if (it) onPickEquip(s.slot);
              else if (held) { if (allowed(s.slot)) onPutEquip(s.slot); }
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

  if (!inventory) return <div className="jp-nodata">{t('item.noData')}</div>;

  const items = inventory.items;
  const held = heldUid != null ? items.find((x) => x.uid === heldUid) ?? null : null;
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
      // 装备 → 背包格（脱下回背包）
      sendUnequipItem(held.slot);
      setHeldUid(null);
      return;
    }
    if (held.location !== 0) return;
    if (targetSlot === held.slot) { setHeldUid(null); return; }
    // 原版语义：空位放 / 同种合并 / 单件换手(被撞件成为下一手持物)
    const t = bagTargetFor(held, targetSlot, items);
    if (t.mode === 'bad') return;
    sendInventoryMove(held.uid, 0, targetSlot);
    if (t.mode === 'swap' && t.conflict) {
      // 服务端把被撞件腾到空位；客户端乐观地把"换到的下一件"拿起继续拖
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
      // 背包 → 装备
      sendEquipItem(held.uid, slot);
      setHeldUid(null);
    } else if (held.location === 2 && held.slot !== slot) {
      // 装备 → 另一装备槽（服务端无直换）：先脱回背包（旧槽清空），held 仍指向实例，
      // 待 store 收到 ItemUpdate 后其 location 变 0，用户再点目标空槽完成穿入。
      sendUnequipItem(held.slot);
    }
  }

  function dropHeld() {
    if (!held) return;
    sendDropItem(held.uid, held.count || 1);
    setHeldUid(null);
  }

  function returnHeld() {
    // 取消拿起：无操作，原物品仍在原位（服务端未变）；换手乐观态也还原为放手
    setHeldUid(null);
  }

  return (
    <>
      <div
        className="jp-items"
        onPointerMove={(e) => { if (heldUid != null) setCursorPos({ x: e.clientX, y: e.clientY }); }}
        onPointerLeave={() => setCursorPos(null)}
      >
        <div className="jp-items-left">
          <BagCanvas
            items={items}
            held={held}
            onPick={onPickBag}
            onPutSlot={onPutToBagSlot}
            onHover={hoverShow}
            onHoverEnd={hoverHide}
          />
          {/* 底部功能区 */}
          <div className="jp-items-foot">
            <span className="jp-items-gold">{t('item.gold')}: {inventory.gold}</span>
            {held ? (
              <span className="jp-items-heldinfo">
                <b>{heldDef?.name ?? `#${held.itemlistId}`}</b>
                <button type="button" className="jp-items-act" onClick={dropHeld}>{t('item.drop')}</button>
                <button type="button" className="jp-items-act" onClick={returnHeld}>{t('panel.close')}</button>
              </span>
            ) : null}
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
      {held ? <HeldIcon held={held} pos={cursorPos} /> : null}
    </>
  );
}
