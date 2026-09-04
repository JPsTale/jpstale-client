/**
 * 登录/选服界面背景层 —— 使用 EU 客户端官方登录原画（/res/game/images/login/），
 * 替代纯黑底。原画下垫一层径向暗化（vignette）保证面板文字可读。
 *
 * 资产说明：bg1.png 是 EU 正式服 ImageBasedLogin 用的登录图，但磁盘上是 JPEG
 * 字节存成 .png（devAssets/nginx 都会按 .png 输出 image/png）；现代浏览器按魔数
 * 嗅探可正常解码，仍保留 onerror 回退链兜底到真 PNG 的 bg10.png。
 */
const LOGIN_ART = '/res/game/images/login/bg1.png';
const FALLBACK_ARTS = [
  '/res/game/images/login/bg10.png',
  '/res/game/images/login/bg7.png',
];

const STYLE_ID = 'login-backdrop-style';

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const st = document.createElement('style');
  st.id = STYLE_ID;
  st.textContent = `
    @keyframes lb-fade { from { opacity: 0; } to { opacity: 1; } }
  `;
  document.head.appendChild(st);
}

export interface LoginBackdrop {
  /** 启动加载页期间预解码原画，避免进入登录时图片才弹出 */
  preload(): void;
  show(): void;
  hide(): void;
  destroy(): void;
}

export function createLoginBackdrop(container: HTMLElement): LoginBackdrop {
  ensureStyle();

  const root = document.createElement('div');
  root.id = 'login-backdrop';
  root.style.cssText = 'display:none;position:fixed;inset:0;z-index:0;overflow:hidden;' +
    'background:radial-gradient(130% 130% at 50% 42%,rgba(8,8,16,0.35) 0%,rgba(8,8,16,0.6) 58%,rgba(4,4,10,0.88) 100%);';

  const img = document.createElement('img');
  img.draggable = false;
  img.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;';
  root.appendChild(img);

  container.insertBefore(root, container.firstChild);

  let attempts = 0;
  const trySources = [LOGIN_ART, ...FALLBACK_ARTS];
  img.addEventListener('error', () => {
    attempts++;
    if (attempts < trySources.length) {
      img.src = trySources[attempts];
    } else {
      img.style.display = 'none';
    }
  });

  return {
    preload() {
      if (img.src) return;
      img.src = trySources[0];
    },
    show() {
      if (img.src === '') img.src = trySources[0];
      if (root.style.display === 'none') {
        root.style.display = 'block';
        root.style.animation = 'lb-fade 0.5s ease both';
      }
    },
    hide() { root.style.display = 'none'; },
    destroy() {
      root.remove();
      const st = document.getElementById(STYLE_ID);
      if (st) st.remove();
    },
  };
}
