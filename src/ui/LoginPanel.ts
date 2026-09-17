import { t, tOr } from '../i18n/index.js';

export interface LoginPanel {
  show(error?: string): void;
  hide(): void;
  setBusy(busy: boolean): void;
  destroy(): void;
}

export function createLoginPanel(container: HTMLElement, opts: {
  onLogin: (username: string, password: string) => void;
}): LoginPanel {
  const el = document.createElement('div');
  el.className = 'panel login-panel';
  el.style.cssText = 'display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:transparent;color:#fff;font-size:14px;text-shadow:0 1px 3px rgba(0,0,0,0.9);z-index:1';
  el.innerHTML = `
    <h2>${t('gui.login.title')}</h2>
    <div class="error" style="color:red;min-height:1.2em"></div>
    <input type="text" placeholder="${t('gui.login.username')}" autocomplete="username" />
    <input type="password" placeholder="${t('gui.login.password')}" autocomplete="current-password" />
    <button>${t('gui.login.submit')}</button>
  `;
  el.querySelectorAll('input').forEach(i => i.style.cssText = 'padding:6px 12px;width:240px;font-size:14px');
  const btn = el.querySelector('button')!;
  btn.style.cssText = 'padding:6px 24px;font-size:14px;cursor:pointer';

  const errEl = el.querySelector('.error')!;
  const inputs = el.querySelectorAll('input');
  const usernameInput = inputs[0];
  const passwordInput = inputs[1];
  const submit = () => {
    if (opts.onLogin) opts.onLogin(usernameInput.value.trim(), passwordInput.value);
  };

  btn.onclick = submit;
  passwordInput.onkeydown = (e) => {
    if (e.key === 'Enter') submit();
  };

  container.appendChild(el);

  return {
    show(error?: string) {
      el.style.display = 'flex';
      // tOr：error 可能来自服务端、不在文案表里；表里没有就显示原串，别显示 "error.xxx"
      errEl.textContent = error ? tOr(`error.${error}`, error) : '';
      usernameInput.focus();
    },
    hide() { el.style.display = 'none'; },
    setBusy(busy: boolean) {
      btn.disabled = busy;
      btn.textContent = t(busy ? 'gui.login.connecting' : 'gui.login.submit');
      btn.style.cursor = busy ? 'wait' : 'pointer';
    },
    destroy() { el.remove(); },
  };
}
