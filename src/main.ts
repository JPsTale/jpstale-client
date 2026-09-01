import { AppScreen, transition, getScreen } from './app/State.js';
import { connect, send, onMessage, onJsonMessage, disconnect, setToken, clearToken } from './net/transport.js';
import { createCharacter, selectCharacter } from './net/protocol.js';
import { createLoginPanel } from './ui/LoginPanel.js';
import { createServerSelect } from './ui/ServerSelect.js';
import type { ServerInfo } from './ui/ServerSelect.js';
import { createCharSelect } from './ui/CharSelect.js';
import type { CharacterInfo } from './ui/CharSelect.js';
import { createHud } from './ui/Hud.js';
import type { HudState } from './ui/Hud.js';
import type { jpt } from './net/proto/base_message.js';

const app = document.getElementById('app')!;
const apiBase = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8080/pt`;

const loginPanel = createLoginPanel(app, { onLogin });
const serverSelectPanel = createServerSelect(app);
const charSelectPanel = createCharSelect(app);
const hudPanel = createHud(app);

function hideAll() {
  loginPanel.hide();
  serverSelectPanel.hide();
  charSelectPanel.hide();
  hudPanel.hide();
}

const ctx: import('./app/State.js').TransitionCtx = {
  showBoot() {},
  showLogin() {},
  showServerSelect() {},
  showCharSelect() {},
  showCharCreate() {},
  showWorld() {},
  hideAll,
};

function showPanelFor(to: AppScreen, ...args: unknown[]) {
  switch (to) {
    case AppScreen.LOGIN:
      loginPanel.show(args[0] as string | undefined);
      break;
    case AppScreen.SERVER_SELECT: {
      const servers = (args[0] as ServerInfo[]) || [];
      serverSelectPanel.show(servers, (id) => {
        const s = servers.find(s => s.id === id);
        if (s) {
          console.log('[app] connecting to server', s.name, s.ip + ':' + s.port);
          connect(`ws://${s.ip}:${s.port}/ws`, true);
        }
      });
      break;
    }
    case AppScreen.CHAR_SELECT: {
      const chars = (args[0] as CharacterInfo[]) || [];
      charSelectPanel.show(chars, {
        onSelect: (characterId) => send(selectCharacter(characterId)),
        onCreate: (name, classId, _head) => send(createCharacter(name, classId)),
        onLogout: () => {
          disconnect();
          clearToken();
          transition(getScreen(), AppScreen.LOGIN, ctx);
          showPanelFor(AppScreen.LOGIN);
        },
      });
      break;
    }
    case AppScreen.WORLD: {
      const state = args[0] as HudState | undefined;
      if (state) hudPanel.show(state);
      break;
    }
  }
}

function go(to: AppScreen, ...args: unknown[]) {
  transition(getScreen(), to, ctx);
  showPanelFor(to, ...args);
}

async function sha256hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

async function onLogin(username: string, password: string) {
  if (getScreen() !== AppScreen.LOGIN) return;
  try {
    const passHash = await sha256hex(`${username.toUpperCase()}:${password}`);
    const res = await fetch(`${apiBase}/api/game/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: username, password: passHash }),
    });
    const data = await res.json();
    if (!data.success) {
      showPanelFor(AppScreen.LOGIN, data.message || '登录失败');
      return;
    }
    setToken(data.token);
    const servers: ServerInfo[] = (data.servers ?? []).map((s: any) => ({
      id: s.id,
      name: s.name ?? `Server ${s.id}`,
      ip: s.ip,
      port: s.port,
      online: !!s.online,
    }));
    go(AppScreen.SERVER_SELECT, servers);
  } catch (e) {
    showPanelFor(AppScreen.LOGIN, '连接服务器失败');
  }
}

onMessage((msg: jpt.base.ServerMessage) => {
  switch (msg.payload) {
    case 'characterList': {
      const chars = (msg.characterList!.characters || []).map((c) => ({
        characterId: Number(c.characterId),
        name: c.name || '',
        classId: c.classId || 0,
        level: c.level || 1,
      }));
      if (getScreen() === AppScreen.SERVER_SELECT) {
        go(AppScreen.CHAR_SELECT, chars);
      } else {
        showPanelFor(AppScreen.CHAR_SELECT, chars);
      }
      break;
    }
    case 'createCharacterResult': {
      const r = msg.createCharacterResult!;
      if (r.success) {
        // server will send updated characterList automatically
      } else {
        console.warn('[app] create character failed', r.errorCode);
        charSelectPanel.handleCreateResult(false, `创建失败 (${r.errorCode})`);
      }
      break;
    }
    case 'playerState': {
      const ps = msg.playerState!;
      const hudState: HudState = {
        hp: ps.hp || 0, maxHp: ps.maxHp || 0,
        mp: ps.mp || 0, maxMp: ps.maxMp || 0,
        level: ps.level || 1,
      };
      if (getScreen() !== AppScreen.WORLD) {
        go(AppScreen.WORLD, hudState);
      } else {
        hudPanel.show(hudState);
      }
      break;
    }
    case 'error': {
      const e = msg.error!;
      console.warn('[app] server error', e.errorCode, e.errorMessage);
      break;
    }
  }
});

onJsonMessage((type, data) => {
  switch (type) {
    case 'auth.characterList': {
      const chars: CharacterInfo[] = ((data as any).characters ?? []).map((c: any) => ({
        characterId: c.characterId ?? c.id,
        name: c.name ?? '',
        classId: c.classId ?? c.class_id ?? 0,
        level: c.level ?? 1,
      }));
      if (getScreen() === AppScreen.SERVER_SELECT) {
        go(AppScreen.CHAR_SELECT, chars);
      } else {
        showPanelFor(AppScreen.CHAR_SELECT, chars);
      }
      break;
    }
    default:
      console.log('[app] unhandled json:', type, data);
  }
});

go(AppScreen.LOGIN);
