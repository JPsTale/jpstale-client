import { useEffect, useState, type CSSProperties, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../i18n/index.js';
import { closePanel, type OpenPanel } from '../../app/gameStore.js';

/** 窗口矩形（屏幕像素，绝对定位） */
export interface PanelRect { x: number; y: number; w: number; h: number }

interface Props {
  title: string;
  panel: Exclude<OpenPanel, null>;
  children: ReactNode;
  /** 位置变体：'center'（底部居中，默认）| 'left'（左侧详情栏） */
  align?: 'center' | 'left';
  /** 左侧栏宽版（角色状态等需要更宽内容时用） */
  wide?: boolean;
  /** 宽度模式：'auto'（贴合内容，技能面板等窄面板用）| 默认走 .jp-panel--left 固定宽 */
  width?: 'auto';
  /** 标题栏里追加的内容（世界地图的面包屑）—— 紧跟在标题右侧 */
  headerExtra?: ReactNode;
  /**
   * **受控窗口矩形**：给了就完全接管位置与尺寸（绝对定位），`align`/`wide` 的默认布局不再生效。
   * 世界地图用这条 —— 它需要固定的 w/h、右下角缩放，以及自己的位置持久化（`worldMapRect`）。
   */
  rect?: PanelRect;
  onRectChange?: (r: PanelRect) => void;
  /** 右下角缩放把手（需配合 `rect`）。下限由调用方在 `onRectChange` 里夹 */
  resizable?: boolean;
  /** 非激活（鼠标不在窗口内）时的不透明度；不传 = 始终 1。世界地图传 0.5（FF14 风格） */
  dimWhenUnfocused?: number;
}

// 位置记忆：每个面板类型独立存储拖动偏移（关闭再打开恢复，不同面板不串台）。
// ⚠ 只服务**非受控**面板；受控面板（世界地图）的位置由调用方自己持久化（worldMapRect）。
const posMemory = new Map<Exclude<OpenPanel, null>, { x: number; y: number }>();

/** 缩放下限的兜底（调用方应收在自己的 `onRectChange` 里再夹一次业务下限） */
const MIN_W = 260, MIN_H = 180;

/**
 * 通用面板外壳 —— **所有窗口都走它**（背包/角色/技能/NPC商店/系统菜单/世界地图）。
 *
 * - 透明层 `pointer-events:none`：面板打开不影响游戏操作（键盘走 window、鼠标点击走 three canvas）
 * - 层级：靠 `data-layer` / `data-layer-host` 交给 `layerStack` 排（"谁激活谁最上"）
 * - 关闭：右上角 × 或 Esc（`closePanel` 动作）
 * - 拖动：标题栏；缩放下限外的模式由调用方决定（`align==='left'` 或受控 `rect`）
 *
 * 世界地图为什么也走这里（用户 2026-09-16）：它原本自带一套 `.jp-wm` / `.jp-wm-win` 窗口
 * （自己的标题栏、拖动、缩放、关闭、显隐、层级声明），于是**同一件事有两套实现** ——
 * 层级要各接一遍（漏过地图）、容器层叠上下文坑连踩两次（地图整层被世界层盖住、一个像素看不见）。
 * 合并后地图只提供**内容**，外壳与其它面板完全共用。
 */
export default function PanelShell({
  title, children, panel, align = 'center', wide = false, width,
  headerExtra, rect, onRectChange, resizable = false, dimWhenUnfocused,
}: Props) {
  const [pos, setPos] = useState(() => posMemory.get(panel) ?? { x: 0, y: 0 });
  const [focused, setFocused] = useState(false);
  const controlled = !!rect;
  const draggable = controlled || align === 'left';
  const unfocused = dimWhenUnfocused !== undefined && !focused;

  // 拖动后写入位置记忆（受控面板不用它 —— 位置由调用方持有）
  useEffect(() => {
    if (!controlled) posMemory.set(panel, pos);
  }, [pos, panel, controlled]);

  function startDrag(e: ReactPointerEvent<HTMLElement>, mode: 'move' | 'size') {
    if (mode === 'move' && !draggable) return;
    if (mode === 'size' && (!controlled || !resizable || !rect)) return;
    // 阻止拖动时的**文本选择**（用户 2026-09-16：拖右下角缩放"像在复制聊天消息一样"把面板文字全选中）。
    // `pointerdown` 的 preventDefault 会拦住随后的选择行为；再配合 `.jp-panel--abs` 的 user-select:none 兜底。
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const base = controlled && rect
      ? { x: rect.x, y: rect.y, w: rect.w, h: rect.h }
      : { x: pos.x, y: pos.y, w: 0, h: 0 };
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (mode === 'move') {
        if (controlled) onRectChange?.({ ...base, x: Math.round(base.x + dx), y: Math.round(base.y + dy) });
        else setPos({ x: base.x + dx, y: base.y + dy });
      } else {
        onRectChange?.({
          ...base,
          w: Math.max(MIN_W, Math.round(base.w + dx)),
          h: Math.max(MIN_H, Math.round(base.h + dy)),
        });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const style: CSSProperties = {};
  if (controlled && rect) {
    style.left = rect.x;
    style.top = rect.y;
    style.width = rect.w;
    style.height = rect.h;
  } else if (draggable) {
    style.left = 24 + pos.x;
    style.top = `calc(50% + ${pos.y}px)`;
    style.transform = 'translateY(-50%)';
    if (width === 'auto') style.width = 'fit-content';
  }
  if (unfocused) style.opacity = dimWhenUnfocused;

  return (
    <div className="jp-overlay">
      <div
        data-panel={panel}
        data-layer={`panel:${panel}`}
        data-layer-host="panels"
        className={`jp-panel${align === 'left' && !controlled ? ' jp-panel--left' : ''}`
          + `${wide ? ' jp-panel--wide' : ''}${controlled ? ' jp-panel--abs' : ''}`
          + `${unfocused ? ' jp-panel--unfocused' : ''}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-label={title}
        onPointerEnter={() => setFocused(true)}
        onPointerLeave={() => setFocused(false)}
      >
        <header
          className="jp-panel-head"
          onPointerDown={(e) => startDrag(e, 'move')}
          onDoubleClick={() => { if (!controlled) setPos({ x: 0, y: 0 }); }}
        >
          <span className="jp-panel-title">{title}</span>
          {headerExtra}
          <button
            type="button"
            className="jp-panel-close"
            onClick={() => closePanel(panel)}
            aria-label={t('panel.close')}
          >
            ×
          </button>
        </header>
        <div className="jp-panel-body">{children}</div>
        {resizable && controlled && (
          <div className="jp-panel-grip" onPointerDown={(e) => startDrag(e, 'size')} />
        )}
      </div>
    </div>
  );
}
