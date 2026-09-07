import type { ReactNode } from 'react';
import { t } from '../../i18n/index.js';
import { setOpenPanel, type OpenPanel } from '../../app/gameStore.js';

interface Props {
  title: string;
  panel: Exclude<OpenPanel, null>;
  children: ReactNode;
}

// 通用面板外壳：全屏透明层 + 底部滑入窗口 + 点击遮罩/Esc 关闭。
// 透明层 stopPropagation，避免点击面板时穿透到 three 世界的输入。
export default function PanelShell({ title, children }: Props) {
  return (
    <div className="jp-overlay" onPointerDown={(e) => e.stopPropagation()}>
      <div className="jp-dim" onPointerDown={() => setOpenPanel(null)} />
      <div className="jp-panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="jp-panel-head">
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