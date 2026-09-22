import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { subscribeGame, getGameSnapshot, hoveredItemOf, setHoverSpot, clearHoverItem, type GameItem, type HoverSource } from '../../app/gameStore.js';
import { itemDefById } from '../../game/data/itemDefs.js';
import { buildLines, weaponTypeChar, weaponTypeName } from '../itemInfoLines.js';

/**
 * 原版风格物品信息框（两列：左标签 / 右数值；需求不满足行红字）。
 * **行列表本身在 `../itemInfoLines.ts`**（纯函数、可离线断言）；本文件只管"悬停住哪、怎么渲染"。
 * 版式依据原版 `cITEM::ShowItemInfo` / `UIItemInfoBox`。
 */
export interface ItemHover { it: GameItem; x: number; y: number; }

/**
 * 悬停信息的状态**活在 store 里**（`gameStore.hoverItem`）—— 过去是本组件的 useState，
 * 于是只有背包面板内部能用：HUD 药水槽悬停永远不显示信息，面板一关也全没了。
 * 现在唯一来源是 store，`ItemInfoLayer` 由 `PanelsRoot` 全局渲染。
 */
export function useItemHover() {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  const h = snap.hoverSpot;
  const it = hoveredItemOf(snap);   // 判据的唯一实现（gameStore）：按来源现查，位置上换了什么就显示什么
  return {
    hover: it && h ? { it, x: h.x, y: h.y } : null,
    // 传的是**来源**（位置），不是物品：位置上的东西被换掉时信息框会自动跟着变
    show: (src: HoverSource, e: { clientX: number; clientY: number }) =>
      setHoverSpot(src, e.clientX + 16, e.clientY + 10),
    hide: () => clearHoverItem(),
  };
}

/** 全局信息框层（PanelsRoot 渲染一次）：背包关着、鼠标悬在 HUD 药水槽上时也要显示。 */
export function ItemInfoLayer() {
  const { hover } = useItemHover();
  return <ItemInfo hover={hover} />;
}


export function ItemInfo({ hover }: { hover: ItemHover | null }) {
  const snap = useSyncExternalStore(subscribeGame, getGameSnapshot);
  if (!hover) return null;
  const { it } = hover;
  const def = itemDefById(it.itemlistId);
  const rawName = def?.name ?? `#${it.itemlistId}`;
  // 名字：本体名 + 右上角武器类型小图标。（锻造等级**不再**当前缀 ——
  // 用户 2026-09-22："在名字下方显示强化等级"；`buildLines` 会把它作为 `sub` 行放在最前。）
  const name = rawName;
  const aged = it.agingLevel > 0;
  const cls = def?.class ?? 0;
  const ch = snap.character;
  const lines = buildLines(it, cls, ch);
  const weaponIcon = weaponTypeChar(it.itemCode);
  // 摆放：随光标，简单防越界
  const style: React.CSSProperties = {
    left: Math.min(hover.x, window.innerWidth - 260),
    top: Math.min(hover.y, window.innerHeight - 60 - lines.length * 17),
  };
  return createPortal(
    <div className="jp-item-info" style={style}>
      <div className={`jp-item-info-name${aged ? ' jp-item-info-age' : ''}`}>
        <span>{name}</span>
        {weaponIcon ? <span className="jp-item-info-wtype" title={weaponTypeName(it.itemCode)}>{weaponIcon}</span> : null}
      </div>
      {lines.map((ln, i) => (
        <div
          key={i}
          className={`jp-item-info-line${ln.section ? ' jp-item-info-sec' : ''}${ln.sub ? ' jp-item-info-sub' : ''}`
            + `${ln.red ? ' jp-item-info-red' : ''}${ln.req ? ' jp-item-info-req' : ''}`
            + `${ln.dim ? ' jp-item-info-dim' : ''}${ln.specHeader ? ' jp-item-info-specHeader' : ''}`
            + `${ln.spec ? ' jp-item-info-spec' : ''}${ln.age ? ' jp-item-info-age' : ''}`}
        >
          {ln.label !== undefined && <span className="jp-item-info-l">{ln.label}</span>}
          <span className="jp-item-info-v">{ln.value}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

