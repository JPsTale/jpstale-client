import { t } from '../i18n/index.js';

export interface ServerInfo { id: number; name: string; online: number; }

export interface ServerSelect {
  show(servers: ServerInfo[], onSelect: (serverId: number) => void): void;
  hide(): void;
  destroy(): void;
}

export function createServerSelect(container: HTMLElement): ServerSelect {
  const el = document.createElement('div');
  el.className = 'panel server-select';
  el.style.cssText = 'display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,0.85);color:#fff;font-size:14px';
  container.appendChild(el);

  return {
    show(servers, onSelect) {
      el.innerHTML = `<h2>${t('gui.server.title')}</h2>`;
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      for (const s of servers) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 16px;background:#222;border-radius:4px;cursor:pointer;min-width:300px';
        row.innerHTML = `<span style="flex:1">${s.name}</span><span style="color:#888">${t('gui.server.online', { count: s.online })}</span>`;
        row.onclick = () => onSelect(s.id);
        list.appendChild(row);
      }
      el.appendChild(list);
      el.style.display = 'flex';
    },
    hide() { el.style.display = 'none'; },
    destroy() { el.remove(); },
  };
}
