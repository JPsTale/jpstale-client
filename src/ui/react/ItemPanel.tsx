import { useEffect, useState } from 'react';
import { useSyncExternalStore } from 'react';
import { subscribeGame, getGameSnapshot, type GameItem } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import {
  itemDefById,
  itemIconUrl,
} from '../../game/data/itemDefs.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { sendEquipItem, sendUnequipItem, sendDropItem, sendSwitchWeapon } from '../../net/bridge.js';

// 画布常量（对齐服务端 ItemLocations / 设计文档 v3.2）
const BAG_W = 12;
const BAG_H = 12;
const CELL = 22; // 一格 22px（放大系数在 CSS 用 --item-cell 缩放）

// 装备槽分组（PT 权威 1~13）
interface SlotDef { slot: number; label: string; kind: 'small' | 'large' | 'mid' }

// 槽→物品查找：items 里 location===2 && slot===n
function itemAtSlot(items: GameItem[], location: number, slot: number): GameItem | undefined {
  return items.find((x) => x.location === location && x.slot === slot);
}

// 画布坐标 slot → x/y（y*W+x）
function slotXY(slot: number): { x: number; y: number } {
  return { x: slot % BAG_W, y: Math.floor(slot / BAG_W) };
}

/** 图片 hook：普通 BMP 黑色背景透明化。 */
function useImg(url: string | null): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (!url) { setSrc(null); return; }
    setSrc(url); // 先裸显，透明化成功再替换
    transparentBmp(url).then((p) => { if (alive) setSrc(p ?? url); });
    return () => { alive = false; };
  }, [url]);
  return src;
}

// ==================== 背包画布 ====================

function BagGrid({ items, selected, onSelectItem, onSelectEmpty }: {
  items: GameItem[];
  selected: number | null;
  onSelectItem: (it: GameItem) => void;
  onSelectEmpty: (slot: number) => void;
}) {
  // 每个占位物品一个绝对定位图标；空格由背景网格铺满
  const placed = items
    .filter((x) => x.location === 0)
    .map((it) => {
      const def = itemDefById(it.itemlistId);
      const { x, y } = slotXY(it.slot);
      return { it, def, x, y, w: def?.w ?? 1, h: def?.h ?? 1 };
    });
  return (
    <div className="jp-items-bag" style={{ width: BAG_W * CELL, height: BAG_H * CELL }}>
      {Array.from({ length: BAG_W * BAG_H }, (_, slot) => {
        const { x, y } = slotXY(slot);
        // 该格是否某物品的左上角
        const occ = placed.find((p) => p.x === x && p.y === y);
        return (
          <div
            key={slot}
            className="jp-items-cell"
            style={{ left: x * CELL, top: y * CELL }}
            onClick={() => occ ? onSelectItem(occ.it) : onSelectEmpty(slot)}
          >
            {occ ? (
              <div
                className={`jp-items-icon${occ.it.uid === selected ? ' jp-items-icon--sel' : ''}`}
                style={{ width: occ.w * CELL, height: occ.h * CELL }}
              >
                <ItemIcon it={occ.it} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ItemIcon({ it }: { it: GameItem }) {
  const def = itemDefById(it.itemlistId);
  const url = def ? itemIconUrl(def) : null;
  const src = useImg(url);
  if (!def) return <span className="jp-items-unknown">#{it.itemlistId}</span>;
  return src ? (
    <img
      src={src}
      alt={def.name}
      className="jp-items-img"
      draggable={false}
      title={def.name}
    />
  ) : null;
}

// ==================== 装备栏 ====================

function EquipSlot({ label, kind, item, onClick }: {
  label: string;
  kind: 'small' | 'large' | 'mid';
  item?: GameItem;
  onClick: () => void;
}) {
  const size = kind === 'large' ? { w: 66, h: 88 } : kind === 'mid' ? { w: 44, h: 44 } : { w: 22, h: 22 };
  return (
    <button
      type="button"
      className={`jp-items-equip jp-items-equip--${kind}`}
      style={{ width: size.w, height: size.h }}
      onClick={onClick}
      title={label}
    >
      {item ? (
        <div className="jp-items-equip-item">
          <ItemIcon it={item} />
        </div>
      ) : (
        <span className="jp-items-equip-label">{label}</span>
      )}
    </button>
  );
}

function EquipColumn({ items, onUnequip }: {
  items: GameItem[];
  onUnequip: (slot: number) => void;
}) {
  const eq = (slot: number) => itemAtSlot(items, 2, slot);
  // 上：4×1×1 饰品（项链4/右戒5/左戒6/宝石7）
  const top: SlotDef[] = [
    { slot: 4, label: 'Amulet', kind: 'small' },
    { slot: 6, label: 'Ring L', kind: 'small' },
    { slot: 5, label: 'Ring R', kind: 'small' },
    { slot: 7, label: 'Sheltom', kind: 'small' },
  ];
  // 中：3 大槽（主手1/防具3/副手2）
  const mid: SlotDef[] = [
    { slot: 1, label: 'Main Hand', kind: 'large' },
    { slot: 3, label: 'Armor', kind: 'large' },
    { slot: 2, label: 'Off Hand', kind: 'large' },
  ];
  // 下：3×2×2（护手9/护腕8/靴10）
  const bot: SlotDef[] = [
    { slot: 9, label: 'Gloves', kind: 'mid' },
    { slot: 8, label: 'Armlet', kind: 'mid' },
    { slot: 10, label: 'Boots', kind: 'mid' },
  ];

  const renderSlots = (list: SlotDef[]) => (
    <div className="jp-items-equiprow">
      {list.map((s) => {
        const it = eq(s.slot);
        return (
          <div key={s.slot} className="jp-items-equipwrap">
            <EquipSlot label={s.label} kind={s.kind} item={it} onClick={() => { if (it) onUnequip(s.slot); }} />
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="jp-items-equips">
      {renderSlots(top)}
      {renderSlots(mid)}
      {renderSlots(bot)}
    </div>
  );
}

// ==================== 主面板 ====================

export default function ItemPanel() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const { inventory } = snap;
  const [selectedUid, setSelectedUid] = useState<number | null>(null);
  const [showDropConfirm, setShowDropConfirm] = useState(false);

  if (!inventory) {
    return <div className="jp-nodata">{t('item.noData')}</div>;
  }

  const items = inventory.items;
  const selected = selectedUid != null ? items.find((x) => x.uid === selectedUid) ?? null : null;

  function selectItem(it: GameItem) {
    // 点击已选中的背包物 → 取消；否则选中
    setSelectedUid((cur) => (cur === it.uid ? null : it.uid));
    setShowDropConfirm(false);
  }

  // 选中背包物品 → 穿到指定装备槽
  function equipTo(slot: number) {
    if (!selected) return;
    sendEquipItem(selected.uid, slot);
    setSelectedUid(null);
    setShowDropConfirm(false);
  }

  function unequip(slot: number) {
    sendUnequipItem(slot);
  }

  function doDrop() {
    if (!selected) return;
    if (!showDropConfirm) { setShowDropConfirm(true); return; }
    sendDropItem(selected.uid, selected.count || 1);
    setSelectedUid(null);
    setShowDropConfirm(false);
  }

  // 选中物品后允许穿的槽位（按 classItem：4单→1、6双手→1、2盾→2、8甲→3、16靴→10、32手→9、192戒→5/6、256宝石→7、512项链→4、2048护腕→8）
  const selDef = selected ? itemDefById(selected.itemlistId) : undefined;
  const allowSlots = ((): number[] => {
    if (!selDef) return [];
    switch (selDef.class) {
      case 2: return [2];
      case 4: return [1];
      case 6: return [1];
      case 8: return [3];
      case 16: return [10];
      case 32: return [9];
      case 192: return [5, 6];
      case 256: return [7];
      case 512: return [4];
      case 2048: return [8];
      default: return [];
    }
  })();

  const slotLabel: Record<number, string> = {
    1: 'Main', 2: 'Off', 3: 'Armor', 4: 'Amulet', 5: 'RingR', 6: 'RingL',
    7: 'Sheltom', 8: 'Armlet', 9: 'Gloves', 10: 'Boots',
  };

  return (
    <div className="jp-items">
      <div className="jp-items-left">
        <BagGrid
          items={items}
          selected={selectedUid}
          onSelectItem={selectItem}
          onSelectEmpty={() => { setSelectedUid(null); setShowDropConfirm(false); }}
        />
        {/* 底部功能区：金币 + 操作 */}
        <div className="jp-items-foot">
          <span className="jp-items-gold">{t('item.gold')}: {inventory.gold}</span>
          {selected && selected.location === 0 ? (
            <span className="jp-items-actions">
              {allowSlots.length > 0 && (
                <select
                  className="jp-items-slotpick"
                  value=""
                  onChange={(e) => { const s = Number(e.target.value); if (s > 0) equipTo(s); }}
                >
                  <option value="">{t('item.equip')}…</option>
                  {allowSlots.map((s) => (
                    <option key={s} value={s}>{slotLabel[s] ?? s}</option>
                  ))}
                </select>
              )}
              <button type="button" className="jp-items-act" onClick={doDrop}>
                {showDropConfirm ? t('item.drop') + '?' : t('item.drop')}
              </button>
            </span>
          ) : null}
          <button type="button" className="jp-items-switch" onClick={() => sendSwitchWeapon()} title="W">
            ⇄ {t('item.equip')}
          </button>
        </div>
      </div>
      <EquipColumn items={items} onUnequip={unequip} />
    </div>
  );
}
