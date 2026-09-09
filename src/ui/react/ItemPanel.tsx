import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribeGame, getGameSnapshot, type GameItem } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import {
  itemDefById,
  itemIconUrl,
} from '../../game/data/itemDefs.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { sendInventoryMove, sendEquipItem, sendUnequipItem, sendDropItem, sendSwitchWeapon } from '../../net/bridge.js';

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

function BagCanvas({ items, heldUid, canDropAt, onPick, onPut, onDrop }: {
  items: GameItem[];
  heldUid: number | null;
  canDropAt: (slot: number) => boolean;
  onPick: (it: GameItem) => void;
  onPut: (slot: number) => void;
  onDrop: (slot: number) => void;
}) {
  const placed = items
    .filter((x) => x.location === 0)
    .map((it) => {
      const def = defOf(it);
      const { x, y } = slotXY(it.slot);
      return { it, x, y, w: def?.w ?? 1, h: def?.h ?? 1 };
    });
  const isHeld = (uid: number) => uid === heldUid;
  return (
    <div className="jp-items-bag" style={{ width: BAG_W * CELL, height: BAG_H * CELL }}>
      {/* 物品图标（绝对定位于画布，层级在格线之上） */}
      {placed.map((p) => (
        <button
          type="button"
          key={p.it.uid}
          className={`jp-bag-item${isHeld(p.it.uid) ? ' jp-bag-item--held' : ''}`}
          style={{ left: p.x * CELL, top: p.y * CELL, width: p.w * CELL, height: p.h * CELL }}
          onPointerDown={(e) => { e.stopPropagation(); onPick(p.it); }}
          title={defOf(p.it)?.name ?? `#${p.it.itemlistId}`}
        >
          <ItemImg it={p.it} w={p.w * CELL} h={p.h * CELL} />
          {p.it.count > 1 ? <span className="jp-bag-count">{p.it.count}</span> : null}
        </button>
      ))}
      {/* 点击空格 = 放置/丢弃拿起的物品（格子透明可点） */}
      {Array.from({ length: BAG_W * BAG_H }, (_, slot) => {
        const occ = placed.find((p) => slotXY(slot).x === p.x && slotXY(slot).y === p.y);
        if (occ) return null; // 有物品的格交给图标处理
        const { x, y } = slotXY(slot);
        return (
          <button
            type="button"
            key={'e' + slot}
            className={`jp-bag-empty${canDropAt(slot) ? ' jp-bag-empty--ok' : ''}`}
            style={{ left: x * CELL, top: y * CELL }}
            onPointerDown={(e) => { e.stopPropagation(); if (heldUid != null) onPut(slot); else onDrop(slot); }}
          />
        );
      })}
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

function EquipColumn({ items, heldUid, onPickEquip, onPutEquip }: {
  items: GameItem[];
  heldUid: number | null;
  onPickEquip: (slot: number) => void;
  onPutEquip: (slot: number) => void;
}) {
  const eq = (slot: number) => items.find((x) => x.location === 2 && x.slot === slot);

  const renderRow = (list: SlotDef[]) => (
    <div className="jp-items-equiprow">
      {list.map((s) => {
        const it = eq(s.slot);
        const box = sizeOf(s.kind);
        return (
          <button
            type="button"
            key={s.slot}
            className={`jp-items-equip jp-items-equip--${s.kind}`}
            style={{ width: box.w, height: box.h }}
            onPointerDown={(e) => {
              e.stopPropagation();
              if (it) onPickEquip(s.slot);
              else if (heldUid != null) onPutEquip(s.slot);
            }}
            title={s.label}
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
    // 拿起背包物品：若已拿起别的，先放回原位？简化：直接换拿起（原物品留在原格，服务端保证唯一）
    setHeldUid(it.uid);
  }

  function onPutToBagSlot(targetSlot: number) {
    if (!held) return;
    if (held.location === 0) {
      // 背包 → 背包格移动
      if (targetSlot !== held.slot) {
        sendInventoryMove(held.uid, 0, targetSlot);
      }
    } else if (held.location === 2) {
      // 装备 → 背包空格（脱装）
      sendUnequipItem(held.slot);
    }
    setHeldUid(null);
  }

  function onDropToBag(_targetSlot: number) {
    // 丢弃走底部按钮；空画布点击无 held 时无操作
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

  function canDropAt(_slot: number): boolean {
    return held != null && held.location === 0;
  }

  function dropHeld() {
    if (!held) return;
    sendDropItem(held.uid, held.count || 1);
    setHeldUid(null);
  }

  function returnHeld() {
    // 取消拿起：无操作，原物品仍在原位（服务端未变）
    setHeldUid(null);
  }

  return (
    <div className="jp-items">
      <div className="jp-items-left">
        <BagCanvas
          items={items}
          heldUid={heldUid}
          canDropAt={canDropAt}
          onPick={onPickBag}
          onPut={onPutToBagSlot}
          onDrop={onDropToBag}
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
        heldUid={heldUid}
        onPickEquip={onPickEquip}
        onPutEquip={onPutEquip}
      />
    </div>
  );
}
