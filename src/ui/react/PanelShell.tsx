import { useEffect, useState, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react';
import { t } from '../../i18n/index.js';
import { setOpenPanel, type OpenPanel } from '../../app/gameStore.js';

interface Props {
  title: string;
  panel: Exclude<OpenPanel, null>;
  children: ReactNode;
  /** 位置变体：'center'（底部居中，默认）| 'left'（左侧详情栏） */
  align?: 'center' | 'left';
  /** 左侧栏宽版（技能面板等需要更宽内容时用） */
  wide?: boolean;
}

// 位置记忆：每个面板类型独立存储拖动偏移（关闭再打开恢复，不同面板不串台）。
const posMemory = new Map<Exclude<OpenPanel, null>, { x: number; y: number }>();

// 通用面板外壳。
// - 透明层 pointer-events:none：面板打开不影响游戏操作（键盘走 window、鼠标点击走 three canvas）
// - left 变体可按住标题栏拖动（双击标题栏复位，位置跨开关持久化）
// 关闭：右上角 × 或 Esc（closePanel 动作）。
export default function PanelShell({ title, children, panel, align = 'center', wide = false }: Props) {
  const [pos, setPos] = useState(() => posMemory.get(panel) ?? { x: 0, y: 0 });
  const draggable = align === 'left';

  // 拖动/复位后写入位置记忆
  useEffect(() => {
    posMemory.set(panel, pos);
  }, [pos, panel]);

  function onHeadPointerDown(e: ReactPointerEvent<HTMLElement>) {
    if (!draggable) return;
    const start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
    const move = (ev: PointerEvent) =>
      setPos({ x: start.px + ev.clientX - start.x, y: start.py + ev.clientY - start.y });
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  const style = draggable
    ? {
        left: 24 + pos.x,
        top: `calc(50% + ${pos.y}px)`,
        transform: 'translateY(-50%)',
      }
    : undefined;

  return (
    <div className="jp-overlay">
      <div
        className={`jp-panel${align === 'left' ? ' jp-panel--left' : ''}${wide ? ' jp-panel--wide' : ''}`}
        style={style}
        role="dialog"
        aria-modal="false"
        aria-label={title}
      >
        <header
          className="jp-panel-head"
          onPointerDown={onHeadPointerDown}
          onDoubleClick={() => setPos({ x: 0, y: 0 })}
        >
          <span className="jp-panel-title">{title}</span>
          <button
            type="button"
            className="jp-panel-close"
            onClick={() => setOpenPanel(null)}
            aria-label={t('panel.close')}
          >
            ×
          </button>
        </header>
        <div className="jp-panel-body">{children}</div>
      </div>
    </div>
  );
}