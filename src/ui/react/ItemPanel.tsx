import { canEquipNow, isDroppable, overweightBlocks } from '../../game/itemRules.js';
import type { EquipReqChar } from '../../game/itemRules.js';
import { playItemSound, playItemDropSound } from '../../audio/index.js';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSyncExternalStore } from 'react';
import { beginOptimistic, getGameSnapshot, getHeldUid, heldItemOf, isOverUi, localBagMove, localEquipItem, localStackMerge, localToHeld, localUnequipToBag, removeInventoryItem, rollbackOptimistic, setHeldUid as setHeldUidStore, subscribeGame, type GameItem } from '../../app/gameStore.js';
import { t } from '../../i18n/index.js';
import { appendSystemMessage } from '../../app/chatStore.js';
import { isInputBlocked } from '../../app/inputGate.js';
import { ITEM_CLASS, isStackable, isPotionClass, isTwoHandWeaponClass } from '../../game/itemClass.js';
import { requestPlayEat } from '../WorldView.js';
import { itemDefById, itemIconUrl } from '../../game/data/itemDefs.js';
import { transparentBmp } from '../../game/transparentBmp.js';
import { sendEquipItem, sendDropItem, sendSwitchWeapon, sendBagLayout, sendStackMerge, sendUseItem, sendTakeToHand } from '../../net/bridge.js';
import { useItemHover, ItemInfo } from './ItemInfo.js';
import { LOC, isHeldItem } from '../../game/itemLocations.js';

// 画布常量（对齐服务端 ItemLocations）
const BAG_W = LOC.BAG_W;
const BAG_H = LOC.BAG_H;
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
/** 计算把 it 放到 bag 的 slot 会发生什么（对齐原版：0 冲突可放；1 件同种可叠→合并、否则换手；≥2→不可） */
function bagTargetFor(it: GameItem, slot: number, items: GameItem[]): { mode: BagDropMode; conflict?: GameItem } {
  const def = defOf(it);
  const gw = def?.w ?? 1;
  const gh = def?.h ?? 1;
  const { x, y } = slotXY(slot);
  if (x + gw > BAG_W || y + gh > BAG_H) return { mode: 'bad' };
  const hits: GameItem[] = [];
  for (const o of items) {
    if (!(o.location === LOC.BAG || o.location === LOC.WAREHOUSE) || o.uid === it.uid) continue;
    const od = defOf(o);
    const oo = slotXY(o.slot);
    const ow = od?.w ?? 1;
    const oh = od?.h ?? 1;
    if (oo.x < x + gw && oo.x + ow > x && oo.y < y + gh && oo.y + oh > y) hits.push(o);
  }
  if (hits.length === 0) return { mode: 'free' };
  // **真装备着**的件（装备栏 slot 1~13）卸到背包时目标格必须为空（服务端 applyBagLayout 对
  // "来源=装备位"也只接受空位）；而**鼠标位那件**（按住 slot=-1 的那个特殊槽）与背包件同等对待 ——
  // 它可以落到已占格上做换手/合并（原版 OVERLAP_ITEM_COLOR 就是"撞一件仍可放"）。
  // ⚠ 鼠标位住在装备栏里（location 同样是 EQUIP），所以这里**必须**用 isHeldItem 区分，
  // 否则"从装备槽拿起 → 放到背包已占格"会被判成非法（用户 2026-09-14 实测的"完全无法交换"）。
  if (!isHeldItem(it) && (it.location === LOC.EQUIP || it.location === LOC.BACKUP_EQUIP)) {
    return { mode: 'bad' };
  }
  if (hits.length === 1) {
    const c = hits[0];
    // 可堆叠（药水/材料）且同种才合并；装备撞装备是"换手"，不是叠加。
    // isStackable 与服务端 ItemInstance.stackable() 同一判据（药水 8192 可堆叠）。
    const sameStack = isStackable(def?.class) && isStackable(defOf(c)?.class)
      && c.itemlistId === it.itemlistId && it.count + c.count <= 1000;
    // 可堆叠且同种 → 合并；否则换手（被撞件拿起）
    return sameStack ? { mode: 'merge', conflict: c } : { mode: 'swap', conflict: c };
  }
  return { mode: 'bad' };
}

// ==================== 背包画布（原版拖放视觉） ====================
// 拿起后物品不在原格绘制（光标持物）；拖动中落点按模式给 footprint 高亮：
// free 可放(蓝绿) / merge 合并(亮) / swap 换手(黄?) / bad 红（≥2 件冲突/越界）。
function BagCanvas({ items, held, character, onPick, onUse, onPutSlot, onHover, onHoverEnd }: {
  items: GameItem[];
  held: GameItem | null;
  /** 用于判定"这件现在能不能穿" → 不能则格子涂红（原版 NotUseFlag 的红底提示） */
  character: EquipReqChar | null;
  onPick: (it: GameItem) => void;
  /** 右键使用（原版 cINVENTORY::RButtonDown）：服务端权威，客户端只报 uid */
  onUse: (it: GameItem) => void;
  onPutSlot: (slot: number) => void;
  onHover: (it: GameItem, e: { clientX: number; clientY: number }) => void;
  onHoverEnd: () => void;
}) {
  const bagRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [mode, setMode] = useState<BagDropMode | null>(null);
  /** 落点命中的那件（换手/合并目标）：原版把这个白框画在**被撞件自己**的矩形上 */
  const [hitUid, setHitUid] = useState<number | null>(null);
  // 拿起中的物品从原格隐藏（留在背包视觉上"空出"），不再原地绘制
  const placed = items
    .filter((x) => x.location === LOC.BAG && x.uid !== held?.uid)
    .map((it) => {
      const def = defOf(it);
      const { x, y } = slotXY(it.slot);
      return { it, x, y, w: def?.w ?? 1, h: def?.h ?? 1 };
    });

  /**
   * 落点锚 = **图标左上角所在的格**（四舍五入到最近格）。
   *
   * 依据原版 `cINVENTORY::SetInvenItemAreaCheck`（`sinInvenTory.cpp:6322`）：它遍历的是
   * **物品自身足迹的格中心**（`pItem->x + 11`、`+33`…，`+11` = 半格 = 四舍五入），
   * 第一个落在背包区域内的点决定锚格 —— 也就是"图标左上角所在格"，**不是指针所在格**。
   * 我们原来用指针格，于是大件（如 2×4 武器，44×88px）的虚影会比图标偏半个身位，
   * 看起来像"乱跳"（用户 2026-09-14 实测）。
   *
   * 返回 null = 没有合法落点（越界）→ 不画落点框，但**手上的图标照旧跟随光标**
   * （原版同样：`InitColorRect()` 清框 + 图标仍按 `MouseItem.x/y` 绘制）。
   */
  function anchoredTopLeft(cx: number, cy: number, gw: number, gh: number): { x: number; y: number } | null {
    const el = bagRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    // 图标像素级左上角（与 HeldIcon 的 `pos - w/2, h/2` 一致），再四舍五入到格
    const left = cx - (gw * CELL) / 2;
    const top = cy - (gh * CELL) / 2;
    const cellX = Math.round((left - rect.left - el.clientLeft) / CELL);
    const cellY = Math.round((top - rect.top - el.clientTop) / CELL);
    if (cellX < 0 || cellY < 0 || cellX + gw > BAG_W || cellY + gh > BAG_H) return null;
    return { x: cellX, y: cellY };
  }

  function updatePreview(cx: number, cy: number) {
    if (!held) { setAnchor(null); setMode(null); setHitUid(null); return; }
    const gw = defOf(held)?.w ?? 1;
    const gh = defOf(held)?.h ?? 1;
    const a = anchoredTopLeft(cx, cy, gw, gh);
    if (!a) { setAnchor(null); setMode(null); setHitUid(null); return; }   // 越界 → 无落点框（图标照旧跟随）
    const t = bagTargetFor(held, a.y * BAG_W + a.x, items);
    setAnchor(a);
    setMode(t.mode);
    setHitUid(t.conflict ? t.conflict.uid : null);
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
    // 只处理**左键**：右键的语义是"使用"（见容器 onContextMenu，原版 RButtonDown 语义）。
    // 不加这一句，右键按下会先被这里当成"拿起"，随后 onContextMenu 里的 `if (held) return`
    // 直接返回 → 右键表现为"拿起道具"、使用永远不触发（用户实测）。
    if (e.button !== 0) return;
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
      onPointerMove={(e) => { updatePreview(e.clientX, e.clientY); }}
      onPointerDown={onBagPointerDown}
      // 右键 = 使用（原版语义）。守卫与原版一致：手里拿着东西时右键不生效
      // （`MouseItem.Flag` 时不处理）；面板冲突由本组件只渲染一层来决定。
      onContextMenu={(e) => {
        e.preventDefault();
        if (held) return;
        const slot = cellFromEvent(e);
        if (slot === null) return;
        const p = placed.find((pp) => slotXY(slot).x >= pp.x && slotXY(slot).x < pp.x + pp.w
          && slotXY(slot).y >= pp.y && slotXY(slot).y < pp.y + pp.h);
        if (p) onUse(p.it);
      }}
      onPointerLeave={() => { setAnchor(null); setMode(null); setHitUid(null); }}
    >
      {/* 物品图标（拿起中的物品不绘制 → 原格空出）；按下事件交给容器统一分发 */}
      {placed.map((p) => (
        <button
          type="button"
          key={p.it.uid}
          className={`jp-bag-item${p.it.uid === hitUid ? ' jp-bag-item--hit' : ''}`
            + `${canEquipNow(p.it, character) ? '' : ' jp-bag-item--cannot'}`}
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

/**
 * 拿起中的物品跟随鼠标（原版 MouseItem 持物光标，按物品原占格尺寸显示）。
 *
 * ⚠ 它由 `PanelsRoot` 的 `HeldCursor` **全局**渲染，**不**挂在背包面板里：
 * 原版药水槽在底部 HUD 上，而本面板会盖住那块区域 —— 要"从背包拿起药水 → 关面板 → 点 HUD 药水槽"，
 * 手持图标在面板关闭时必须还在（`heldUid` 本来就跨开关存活，图标却原来只在面板里画）。
 * 导出给 `PanelsRoot` 用；**只有这一份实现**。
 */
export function HeldIcon({ held, pos }: { held: GameItem; pos: { x: number; y: number } | null }) {
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
// 药水快捷槽（ITEMSLOT 11/12/13）**不在装备栏里显示**（用户 2026-09-14）。
// 它们本来就画在底部 HUD 上（`Hud.ts` 的 POTION_RECTS，坐标取自原版 `sinInvenTory.cpp:167-169`），
// 原版也只有那一处 —— 装备栏再列一排是重复的。
// ⚠ 也因此**没有** `slotAllows` 的 POTION 分支：从面板放药水入槽这条路不存在，
//   唯一入口是 HUD 药水槽（`main.ts` 的 `hudPanel.onAction`：手持 → 放入，空手 → 拿起）。


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

function EquipColumn({ items, held, character, onPickEquip, onPutEquip, allowed, onHover, onHoverEnd }: {
  items: GameItem[];
  held: GameItem | null;
  /** 判定"槽里这件现在还穿不穿得上" → 穿不上则槽涂红（原版 NotUseFlag 的红底提示） */
  character: EquipReqChar | null;
  onPickEquip: (slot: number) => void;
  onPutEquip: (slot: number) => void;
  allowed: (slot: number) => boolean;
  onHover: (it: GameItem, e: { clientX: number; clientY: number }) => void;
  onHoverEnd: () => void;
}) {
  const [hoverSlot, setHoverSlot] = useState<number | null>(null);
  /**
   * 槽内物品。**双手武器占两只手**：另一只手上是双手武器时，本格显示**同一件**（占位）。
   * 原版语义见 `OverlapTwoHandItem`（sinInvenTory1.cpp:5241）：双手武器在槽 1 时，
   * `sInven[1].ItemIndex` 也指向那一件 —— 即副手格"被占位"。
   * 我们一件物品只有一个 slot，所以在渲染与点击时补这一份镜像。
   */
  const eq = (slot: number) => {
    const own = items.find((x) => x.location === LOC.EQUIP && x.slot === slot && x.uid !== held?.uid);
    if (own) return own;
    if (slot === 1 || slot === 2) {
      const other = items.find((x) => x.location === LOC.EQUIP && x.slot === (slot === 1 ? 2 : 1));
      if (other && isTwoHandWeaponClass(defOf(other)?.class)) return other;
    }
    return undefined;
  };

  const renderRow = (list: SlotDef[]) => (
    <div className="jp-items-equiprow">
      {list.map((s) => {
        const it = eq(s.slot);
        const box = sizeOf(s.kind);
        const tint = held && hoverSlot === s.slot ? (allowed(s.slot) ? ' ok' : ' bad') : '';
        // 槽里这件穿不上（属性/职业不满足）→ 涂红；原版连"装备着的"那格也一起涂（sinInvenTory.cpp:944）
        const cannot = !!it && !canEquipNow(it, character);
        // 拿着东西悬停本槽且允许放 → 在槽内居中显示半透明虚影（原版 SetX/SetY 槽内居中）
        const ghost = held && hoverSlot === s.slot && !it && allowed(s.slot);
        return (
          <button
            type="button"
            key={s.slot}
            className={`jp-items-equip jp-items-equip--${s.kind}${tint}${cannot ? ' jp-items-equip--cannot' : ''}`}
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
            ) : ghost && held ? (
              <span className="jp-items-equip-ghost">
                <ItemImg it={held} {...itemViewSize(held, s.kind)} />
              </span>
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
  // 手持道具由 store 持有（HUD 药水槽也要能接收从背包拿起的药水）；
  // 下面所有 heldUid / setHeldUid 的用法保持不变，只是换了来源。
  const heldUid = snap.heldUid;
  const setHeldUid = setHeldUidStore;
  const { hover, show: hoverShow, hide: hoverHide } = useItemHover();
  // 穿装备交换：等待服务端 ack 的挂起状态（成功=旧件保持手持；失败=还原）
  const panelRef = useRef<HTMLDivElement>(null);
  // 拿起/放下时信息框消失（原版：拖起时不再显示 hover 信息）
  useEffect(() => {
    if (heldUid != null) hoverHide();
  }, [heldUid]);
  // 拿起中：点击背包面板外区域 → 丢到地面（原版 ThrowItem；不是摧毁）
  useEffect(() => {
    if (snap.heldUid == null) return;
    const onDown = (e: PointerEvent) => {
      // 加载页/遮罩期间一律不处理（document 级监听不看 DOM 命中；否则加载时点一下就把手上道具丢了）
      if (isInputBlocked()) return;
      const el = panelRef.current;
      const t = e.target as Node | null;
      if (el && t && el.contains(t)) return; // 面板内交互照常
      // 只有点在**游戏画面（canvas）**上才算"丢到地面" —— 原版 ThrowItem 的语义是"扔到地上"。
      // 旧判定是"不在背包面板内就丢"，而 ItemInfo / HUD / 其它面板都在 .jp-items **之外**，
      // 于是拿起道具后点到那些地方就被误丢（用户 2026-09-13 实测：点药水槽区域丢了药水）。
      // 只有在**游戏画面**上点才算"丢到地面"，且**不能落在任何 UI 交互区里** ——
      // HUD（药水槽/按钮）是 pointer-events:none 的覆盖层，点它会穿透到 3D 画布上，
      // 只判 canvas 会把"点药水槽放入"误判成丢弃（用户 2026-09-13 实测：药水总被丢掉）。
      const isWorld = t instanceof Element && !!t.closest('canvas');
      if (!isWorld || isOverUi(e.clientX, e.clientY)) return;
      // ⚠ 必须取"仍在背包的持有物"（`getHeldUid` 就是这个判据），不能用 `snap.heldUid`：
      // 放进药水槽后那件已离开背包，而 heldUid 还留着旧值 → 拿它去找会找到**槽里那瓶**并丢出去
      // （用户 2026-09-13 实测：点地面准备走路，药水槽的药被丢到地上）。
      const uidNow = getHeldUid();
      const it = uidNow == null ? undefined
        : getGameSnapshot().inventory?.items.find((x) => x.uid === uidNow);
      if (!it) return;
      // 禁丢清单预校验（原版 NotDrow_Item_*）：拦住就不发请求 —— 否则本地已移除、服务端却拒绝，
      // 两端会不一致（物品在服务端还在、客户端没了）。最终仍以服务端为准。
      if (!isDroppable(defOf(it)?.code)) {
        console.warn('[bag] 该物品无法丢弃（禁丢清单）：uid=', it.uid, 'idCode=', defOf(it)?.code);
        setHeldUidStore(heldUid);   // 保持手持不变（等于这次点击没发生）
        return;
      }
      console.log('[bag] 丢到地面 uid=', it.uid, 'count=', it.count);
      playItemDropSound();   // 原版 ThrowInvenItemToField 专用音
      beginOptimistic([it]);            // 乐观更新前记快照：服务端拒绝时把整件（含数量）恢复
      removeInventoryItem(it.uid);      // 本地即时移除
      sendDropItem(it.uid, it.count || 1);
      setHeldUid(null);
      e.stopPropagation();
      e.preventDefault();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [snap.heldUid]);   // 物品变化（含"放入槽后离开背包"）都会重绑
  // 服务端拒绝（equip/drop/药水槽 都用同一条 sendError → pt:equipFail）：
  // 按乐观快照把界面恢复成点击前的样子（原版 BackUpPosi 语义）。三处操作共用这一份。
  useEffect(() => {
    const onFail = () => {
      if (rollbackOptimistic()) setHeldUid(null);
    };
    window.addEventListener('pt:equipFail', onFail);
    return () => window.removeEventListener('pt:equipFail', onFail);
  }, []);

  if (!inventory) return <div className="jp-nodata">{t('item.noData')}</div>;

  const items = inventory.items;
  // 手持 = `heldItemOf`（**唯一判据**）：背包里那一件（拿起后源格空出）或本地抽离的那件
  // （从装备槽拿起 / 换装时被换下的旧件）。别在这里再写一遍条件，见 gameStore.heldItemOf。
  const held = heldItemOf(snap);
  const overload = !!snap.character && (snap.character.currentWeight ?? 0) > (snap.character.maxWeight ?? 0);
  const heldDef = held ? defOf(held) : undefined;

  /** 目标装备槽是否允许当前 held 物品 */
  function slotAllows(slot: number): boolean {
    if (!heldDef) return false;
    // 位值定义见 `game/itemClass.ts`（与服务端 ItemClass 同一份、逐位对应）
    switch (heldDef.class) {
      case ITEM_CLASS.OFF_HAND: return slot === 2;
      case ITEM_CLASS.ONE_HAND_WEAPON: return slot === 1;
      case ITEM_CLASS.TWO_HAND_WEAPON: return slot === 1;
      case ITEM_CLASS.ARMOR: return slot === 3;
      case ITEM_CLASS.BOOTS: return slot === 10;
      case ITEM_CLASS.GLOVES: return slot === 9;
      case ITEM_CLASS.RING: return slot === 5 || slot === 6;
      case ITEM_CLASS.GEM: return slot === 7;
      case ITEM_CLASS.AMULET: return slot === 4;
      case ITEM_CLASS.ARMLET: return slot === 8;
      // 药水（ITEM_CLASS.POTION）**没有分支**：药水槽 11/12/13 不在本面板显示，也不从这里放
      // —— 唯一入口是底部 HUD 的药水槽（见上方注释）。
      default: return false;
    }
  }

  /** 找一个能放下该物品的背包空格号（本地预演用；服务端有自己的落位逻辑，这里只求"能放"） */
  function firstFreeBagSlot(it: GameItem): number | null {
    const def = defOf(it);
    const w = def?.w ?? 1, h = def?.h ?? 1;
    const occ = new Set<number>();
    for (const o of items) {
      if (o.location !== LOC.BAG || o.uid === it.uid) continue;
      const od = defOf(o);
      const ow = od?.w ?? 1, oh = od?.h ?? 1;
      const oo = slotXY(o.slot);
      for (let dy = 0; dy < oh; dy++) for (let dx = 0; dx < ow; dx++) occ.add((oo.y + dy) * BAG_W + (oo.x + dx));
    }
    for (let y = 0; y + h <= BAG_H; y++) {
      for (let x = 0; x + w <= BAG_W; x++) {
        let ok = true;
        for (let dy = 0; dy < h && ok; dy++) {
          for (let dx = 0; dx < w; dx++) if (occ.has((y + dy) * BAG_W + (x + dx))) { ok = false; break; }
        }
        if (ok) return y * BAG_W + x;
      }
    }
    return null;
  }

  function onPickBag(it: GameItem) {
    // 拿起 = 服务端把物品移到**鼠标位**（装备栏 slot=-1），原格腾空（`TakeToHand`）。
    // 本地先按同样语义乐观改（`localToHeld` 顺带把 heldUid 同步成"鼠标位那件"），
    // 服务端拒绝（手上已有东西/位置不可拿）时按快照还原。
    beginOptimistic([it]);
    localToHeld(it.uid);
    playItemSound(defOf(it)?.sound);   // 原版：拿起/放下都播该物品自带的 SoundIndex
    sendTakeToHand(it.uid);
    console.log('[bag:pick] 拿起背包物品 uid=', it.uid, 'loc=', it.location, 'slot=', it.slot,
      'listId=', it.itemlistId, 'size=', defOf(it)?.w, 'x', defOf(it)?.h);
  }

  /** 全量快照上报：当前 store 全部画布物品（背包/仓库页）最终格子（客户端布局权威）。
   *  装备/副装备槽不走 BagLayout（由 EquipItem/UnequipItem/SwitchWeapon 维护）；
   *  手持(HELD)不上报。手势/整理后调用一次；服务端按 seq 校验 + 校验失败静默（不回推）。 */
  function reportLayout() {
    const cur = getGameSnapshot().inventory;
    if (!cur) return;
    const entries = cur.items
      .filter((x) => !isHeldItem(x) && !(x.location === LOC.EQUIP || x.location === LOC.BACKUP_EQUIP))
      .map((x) => ({ uid: x.uid, location: x.location, slot: x.slot }));
    sendBagLayout(entries);
  }

  function onPutToBagSlot(targetSlot: number) {
    if (!held) return;
    // 负重门（原版 CheckSetOk 的**重量分支**，`sinInvenTory.cpp:6021`）。
    // 原版在拿起时会 `InvenItem[i].Flag = 0` 后立刻 `CheckWeight()`（同文件 :3772-3776），
    // 所以 `Weight[0]` **不含**手上那件；`Weight[0] + 该件` 恰好就是搬运后的总重，
    // 而搬运本身不改变总重 ⇒ 该判定等价于"**当前已超重就拒绝搬运**"（搬运、换格都拒）。
    // 例外：原版对任务武器豁免（我们无 `ItemKindCode` 列 → 用任务家族近似，见 itemRules）。
    if (overweightBlocks(snap.character?.currentWeight, snap.character?.maxWeight, defOf(held)?.code)) {
      console.warn('[bag:move] 已超重，拒绝搬运 uid=', held.uid,
        'w=', snap.character?.currentWeight, '/', snap.character?.maxWeight);
      appendSystemMessage(t('item.op.overWeight'), Date.now());
      return;
    }
    if (!isHeldItem(held) && (held.location === LOC.EQUIP || held.location === LOC.BACKUP_EQUIP)) {
      // 装备/副装备 → 指定背包格（本地即时落格 + 全量上报布局；服务端落库并刷新属性/外观）
      const tgt = bagTargetFor(held, targetSlot, items);
      console.log('[bag:unequip] 卸装到指定格 heldUid=', held.uid, 'heldLoc=', held.location, 'heldSlot=', held.slot,
        '→targetSlot=', targetSlot, 'xy=', JSON.stringify(slotXY(targetSlot)),
        'size=', defOf(held)?.w, 'x', defOf(held)?.h, 'mode=', tgt.mode,
        '冲突=', tgt.conflict ? { uid: tgt.conflict.uid, slot: tgt.conflict.slot, listId: tgt.conflict.itemlistId } : null);
      if (tgt.mode === 'bad') return;
      localUnequipToBag(held.uid, targetSlot);
      reportLayout();
      console.log('[bag:unequip] 已上报全量布局（含 uid=', held.uid, '→slot=', targetSlot, '）');
      setHeldUid(null);
      return;
    }
    // 从鼠标位（拿起的那件）落到背包格：走"本地落格 + 全量上报布局"，与背包内移动**同一条路**。
    // 服务端 `applyBagLayout` 已接受"来源 = 鼠标位"（它不在任何画布上，目标格必须是空的）。
    if (!isHeldItem(held)) return;
    // 客户端网格权威：本地即时落子并渲染，随后全量上报布局；药水合并走 StackMerge
    const tgt = bagTargetFor(held, targetSlot, items);
    console.log('[bag:move] 背包内移动 heldUid=', held.uid, 'fromSlot=', held.slot, '→targetSlot=', targetSlot,
      'xy=', JSON.stringify(slotXY(targetSlot)), 'size=', defOf(held)?.w, 'x', defOf(held)?.h,
      'mode=', tgt.mode, 'conflict=', tgt.conflict ? { uid: tgt.conflict.uid, slot: tgt.conflict.slot } : null);
    if (tgt.mode === 'bad') return;
    if (tgt.mode === 'merge' && tgt.conflict) {
      localStackMerge(held.uid, tgt.conflict.uid);
      sendStackMerge(held.uid, tgt.conflict.uid);
      console.log('[bag:move] 合并且上报 StackMerge src=', held.uid, 'dst=', tgt.conflict.uid);
      setHeldUid(null);
      return;
    }
    const srcLoc = held.location, srcSlot = held.slot;
    localBagMove(held.uid, targetSlot, LOC.BAG);
    if (tgt.mode === 'swap' && tgt.conflict) {
      // **换手**：被撞件要真的被"拿起" —— 原版是被撞件进鼠标位（`ChangeInvenItem` 的换手语义），
      // 在我们这里就是同一个动作：`localToHeld` + 服务端 `TakeToHand`。
      // ⚠ 顺序：`TakeToHand` 必须**先**发（服务端先把那一格腾出来），否则随后的全量布局上报里，
      // 目标格仍被被撞件占着 → `applyBagLayout` 的 canPlace 校验失败、整包被拒（"换了但没换成"）。
      // ⚠ 另一层：只 `setHeldUid` 而**不** `localToHeld` 会让物品"名义上拿着、实际还在背包格"，
      // 而手持判据只有一个（`isHeldItem`）→ 手上一件都算不上 → **图标与落点框双双消失**
      // （用户 2026-09-14 实测："鼠标和图标不显示，命中格也完全不显示"）。
      beginOptimistic([tgt.conflict]);
      localToHeld(tgt.conflict.uid);
      sendTakeToHand(tgt.conflict.uid);
      setHeldUid(tgt.conflict.uid);
      console.log('[bag:move] 换手：被撞件拿起 uid=', tgt.conflict.uid);
    } else {
      setHeldUid(null);
    }
    reportLayout();
    console.log('[bag:move] 已上报全量布局（含 uid=', held.uid, 'srcLoc=', srcLoc, 'srcSlot=', srcSlot, '→slot=', targetSlot, '）');
  }

  function onPickEquip(slot: number) {
    // 双手武器占两只手：点"占位显示"的那一格（副手/主手的镜像）也拿起同一件
    let it = items.find((x) => x.location === LOC.EQUIP && x.slot === slot);
    if (!it && (slot === 1 || slot === 2)) {
      const other = items.find((x) => x.location === LOC.EQUIP && x.slot === (slot === 1 ? 2 : 1));
      if (other && isTwoHandWeaponClass(defOf(other)?.class)) it = other;
    }
    if (it) {
      // 原版拿起装备就是**立刻卸下**：槽位清空 + 物品上鼠标 + 属性/外观当场变化
      // （`sinInvenTory.cpp:3767-3776`：`InvenItem[i].Flag = 0` + `sinSetCharItem(..., FALSE)` + `CheckWeight()`）。
      // 现在这**一次** `TakeToHand` 就完整表达了它：服务端把物品从装备槽移到鼠标位（装备栏 slot=-1），
      // 顺手重算属性/外观。不再需要"先脱到背包"那条绕道（那条在背包满时会让玩家**拿不起来**，
      // 而且"拿到一半掉线"会变成东西自己进了背包）。
      beginOptimistic([it]);            // 服务端拒绝时按快照还原回装备槽
      localToHeld(it.uid);
      playItemSound(defOf(it)?.sound);
      sendTakeToHand(it.uid);
      console.log('[bag:pick-eq] 拿起装备槽 uid=', it.uid, 'slot=', it.slot, '(点的是', slot, ')',
        'loc=', it.location, 'size=', defOf(it)?.w, 'x', defOf(it)?.h);
    } else {
      console.log('[bag:pick-eq] 拿起装备槽 slot=', slot, '但未找到物品');
    }
  }

  function onPutEquip(slot: number) {
    // 三个提前返回都带日志：静默 return 会让"点了没反应"无从诊断（用户 2026-09-12 定的规矩）。
    if (!held) {
      console.warn('[bag:put] 没有手持物品，忽略 slot=', slot);
      return;
    }
    if (!slotAllows(slot)) {
      console.warn('[bag:put] 目标槽不允许：uid=', held.uid, 'slot=', slot,
        'class=', heldDef?.class, 'def=', heldDef);
      return;
    }
    // 负重门（原版 CheckSetOk 的重量分支，见 itemRules.overweightBlocks）：搬运不改变总重，
    // 等价于"当前已超重就拒绝搬运"。本地先拦，免得"先装上再回滚"的闪烁。
    if (overweightBlocks(snap.character?.currentWeight, snap.character?.maxWeight, heldDef?.code)) {
      console.warn('[bag:put] 已超重，拒绝搬运 uid=', held.uid,
        'w=', snap.character?.currentWeight, '/', snap.character?.maxWeight);
      appendSystemMessage(t('item.op.overWeight'), Date.now());
      return;
    }
    // 手持 = 鼠标位那件（`heldItemOf` 的唯一来源）；服务端 `equipFromBag` 接受"来源 = 鼠标位"。
    if (isHeldItem(held)) {
      // 客户端预校验（与服务器一致）：不满足则保持手持、不发送
      if (!canEquipNow(held, snap.character)) {
        console.warn('[bag:put] 需求不足，穿入取消 uid=', held.uid, 'ch=', snap.character);
        return;
      }
      const old = items.find((x) => x.location === LOC.EQUIP && x.slot === slot) ?? null;
      console.log('[bag:equip] 穿装 heldUid=', held.uid, 'fromBagSlot=', held.slot, '→equipSlot=', slot,
        '旧件=', old ? { uid: old.uid, slot: old.slot } : null,
        'size=', defOf(held)?.w, 'x', defOf(held)?.h);
      // 乐观更新前记快照（新件 + 被换下的旧件）——失败时按它恢复，替代原先只覆盖"穿装备"的 pendingSwap
      beginOptimistic(old ? [held, old] : [held]);
      // 本地即时：新件立刻进装备槽（背包即刻消失，不存在"回闪"）；旧件若在则抽离为手持
      setHeldUid(old ? old.uid : null);
      playItemSound(defOf(held)?.sound);
      localEquipItem(held.uid, slot);
      if (old) localToHeld(old.uid);
      // 双手武器占**两只手**（原版 OverlapTwoHandItem，sinInvenTory1.cpp:5241）：
      // 进哪个槽就清另一个槽，被清的那件回背包。这里**本地立刻预演**，
      // 否则界面上会留着副手那件，直到服务端推送才消失（看得见的迟滞）。
      if (isTwoHandWeaponClass(defOf(held)?.class) && (slot === 1 || slot === 2)) {
        const otherSlot = slot === 1 ? 2 : 1;
        const other = items.find((x) => x.location === LOC.EQUIP && x.slot === otherSlot && x.uid !== held.uid);
        if (other) {
          const free = firstFreeBagSlot(other);
          if (free != null) localUnequipToBag(other.uid, free);
          else console.warn('[bag] 双手武器：背包无空位，另一只手的物品暂不回退（等服务端推送）');
        }
      }
      sendEquipItem(held.uid, slot);
      console.log('[bag:equip] 已上报 EquipItem uid=', held.uid, '→equipSlot=', slot);
    }
    // 没有"装备→另一个装备槽"的分支：从装备槽拿起时**已经**脱下来了（`onPickEquip` 发 `UnequipItem`），
    // 所以那一刻起它在服务端侧就是背包物品，换槽与"从背包穿装"是同一条路（上面那个分支）。
  }

  /** 右键使用：只上送 uid，效果与校验全在服务端（原版 RButtonDown 也是只表达"用这一件"） */
  function onUseBag(it: GameItem) {
    if (held) return;                 // 手里拿着东西时右键无效（对齐原版 MouseItem.Flag 守卫）
    // 药水：本地立刻播 EAT（原版 sinActionPotion 在点击瞬间切动作，不等服务端往返）
    if (isPotionClass(defOf(it)?.class)) requestPlayEat();
    sendUseItem(it.uid);
  }

  return (
    <>
      <div className="jp-items" ref={panelRef}>
        <div className="jp-items-left">
          <BagCanvas
            items={items}
            held={held}
            character={snap.character}
            onPick={onPickBag}
            onUse={onUseBag}
            onPutSlot={onPutToBagSlot}
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
          character={snap.character}
          onPickEquip={onPickEquip}
          onPutEquip={onPutEquip}
          allowed={slotAllows}
          onHover={hoverShow}
          onHoverEnd={hoverHide}
        />
      </div>
      <ItemInfo hover={hover} />
      {/* 手持图标不在这里画：由 `PanelsRoot` 的 `HeldCursor` 全局渲染（面板关掉也要跟着鼠标走） */}
    </>
  );
}
