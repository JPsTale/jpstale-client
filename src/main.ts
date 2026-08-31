import { AppScreen, transition, getScreen } from './app/State.js';
import { connect, send, onMessage, disconnect, setToken, clearToken } from './net/transport.js';
import { loginRequest, createCharacter, selectCharacter } from './net/protocol.js';
import { createLoginPanel } from './ui/LoginPanel.js';
import { createServerSelect } from './ui/ServerSelect.js';
import type { ServerInfo } from './ui/ServerSelect.js';
import { createCharSelect } from './ui/CharSelect.js';
import type { CharacterInfo } from './ui/CharSelect.js';
import { createHud } from './ui/Hud.js';
import type { HudState } from './ui/Hud.js';
import type { jpt } from './net/proto/base_message.js';

const app = document.getElementById('app')!;

const loginPanel = createLoginPanel(app, { onLogin });
const serverSelectPanel = createServerSelect(app);
const charSelectPanel = createCharSelect(app);
const hudPanel = createHud(app);

const wsUrl = `ws://${window.location.hostname || 'localhost'}:10007/ws`;

function hideAll() {
  loginPanel.hide();
  serverSelectPanel.hide();
  charSelectPanel.hide();
  hudPanel.hide();
}

// ponytail: show functions wired to ctx are no-ops for panels handled manually below
const ctx: import('./app/State.js').TransitionCtx = {
  showBoot() {},
  showLogin() {},
  showServerSelect() {},
  showCharSelect() {},
  showWorld() {},
  hideAll,
};

function showPanelFor(to: AppScreen, ...args: unknown[]) {
  switch (to) {
    case AppScreen.LOGIN:
      loginPanel.show(args[0] as string | undefined);
      break;
    case AppScreen.SERVER_SELECT: {
      const servers = (args[0] as ServerInfo[]) || [{ id: 1, name: 'Server 1', online: 0 }];
      serverSelectPanel.show(servers, (id) => {
        console.log('[app] selected server', id);
      });
      break;
    }
    case AppScreen.CHAR_SELECT: {
      const chars = (args[0] as CharacterInfo[]) || [];
      charSelectPanel.show(chars, {
        onSelect: (characterId) => send(selectCharacter(characterId)),
        onCreate: (name, classId, _head) => send(createCharacter(name, classId)),
        onLogout: () => {
          transition(getScreen(), AppScreen.LOGIN, ctx);
          showPanelFor(AppScreen.LOGIN);
          disconnect();
          clearToken();
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

function onLogin(username: string, password: string) {
  if (getScreen() !== AppScreen.LOGIN) return;
  connect(wsUrl);
  send(loginRequest(username, password));
}

onMessage((msg: jpt.base.ServerMessage) => {
  switch (msg.payload) {
    case 'loginResponse': {
      const lr = msg.loginResponse!;
      if (lr.success) {
        setToken(String(lr.accountId));
        go(AppScreen.SERVER_SELECT);
      } else {
        showPanelFor(AppScreen.LOGIN, lr.errorMessage || 'unknown');
      }
      break;
    }
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
      if (!r.success) console.warn('[app] create character failed', r.errorCode);
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

go(AppScreen.LOGIN);
