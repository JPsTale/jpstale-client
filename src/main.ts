import { AppScreen, transition, getScreen } from './app/State.js';
import { connect, send, onMessage, onJsonMessage, disconnect, setToken, clearToken, onTimeSync } from './net/transport.js';
import { createCharacter, selectCharacter } from './net/protocol.js';
import { createLoginPanel } from './ui/LoginPanel.js';
import { createServerSelect } from './ui/ServerSelect.js';
import type { ServerInfo } from './ui/ServerSelect.js';
import { createCharSelect } from './ui/CharSelect.js';
import type { CharacterInfo } from './ui/CharSelect.js';
import { preloadAllModels } from './render/model-cache.js';
import { createLoadingScreen } from './ui/LoadingScreen.js';
import { createHud } from './ui/Hud.js';
import type { HudState } from './ui/Hud.js';
import { createWorldView } from './ui/WorldView.js';
import type { EnterGameInfo, WorldLoadHooks } from './ui/WorldView.js';
import { t } from './i18n/index.js';
import { createGameClock } from './ui/GameClock.js';
import { createKeyBinding } from './ui/KeyBinding.js';
import { createKeyBindingPanel } from './ui/KeyBindingPanel.js';
import type { jpt } from './net/proto/base_message.js';
import { sha256 } from 'js-sha256';const app = document.getElementById('app')!;
const apiBase = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8080/pt`;

const loginPanel = createLoginPanel(app, { onLogin });
const serverSelectPanel = createServerSelect(app);
const charSelectPanel = createCharSelect(app);
const hudPanel = createHud(app);
const worldView = createWorldView(app, {
  onMoveModeChange: (mode) => console.log('[mmode]', mode), // P1 占位出口；未来接 C2S 时替换
});
const loadingScreen = createLoadingScreen(app);
// 进图加载出口（showPanelFor WORLD 处传给 worldView.show）
const worldLoadHooks: WorldLoadHooks = {
  onProgress: (current, max) => loadingScreen.setProgress(current, max),
  onReady: () => loadingScreen.hide(),
};
const gameClock = createGameClock();
const keyBinding = createKeyBinding();
const keyBindingPanel = createKeyBindingPanel(app, keyBinding);

function hideAll() {
  loginPanel.hide();
  serverSelectPanel.hide();
  charSelectPanel.hide();
  hudPanel.hide();
  worldView.hide();
  loadingScreen.hide();
}

onTimeSync((serverTimeMs: number) => {
  // 首次收到服务器权威时钟时锚定；此后走漂移校正
  if (gameClock.isSynced()) {
    gameClock.correctTime(serverTimeMs);
  } else {
    gameClock.setInitialTime(serverTimeMs);
  }
});

// 昼夜：游戏时钟时间 → WorldView 昼夜驱动（darkLevel/BackColor 渐变 + 火把 + 场景灯）
gameClock.onTimeUpdate((state) => {
  worldView.setGameTime(state.hour, state.min);
});

keyBinding.onKeyDown((action) => {
  switch (action) {
    case 'system':
      keyBindingPanel.show();
      break;
    case 'minimap':
      worldView.toggleMinimap();
      break;
    case 'walkRun':
      hudPanel.setRunFlag(worldView.toggleRun());
      break;
  }
});

hudPanel.onAction = (action) => {
  if (action === 'toggleRun') {
    hudPanel.setRunFlag(worldView.toggleRun());
  }
};

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
        onCreate: (name, classId, head) => send(createCharacter(name, classId, head)),
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
      console.log('[app] WORLD screen, hudState=', state);
      if (state) hudPanel.show(state);
      const enterGame = args[1] as EnterGameInfo | undefined;
      if (enterGame) {
        // 进图加载页：go() 的 hideAll 已收起 loadingScreen，这里同 tick 重新显示盖住世界画面，
        // WorldView 阶段进度喂进度条，首帧渲染完成（onReady）后收起
        const mapName = t(`map.${enterGame.mapId}`);
        const title = mapName.startsWith('map.')
          ? t('gui.load.world')
          : t('gui.load.entering', { map: mapName });
        loadingScreen.show(title);
        worldView.show(enterGame, worldLoadHooks);
      }
      break;
    }
  }
}

function go(to: AppScreen, ...args: unknown[]) {
  transition(getScreen(), to, ctx);
  showPanelFor(to, ...args);
}


async function onLogin(username: string, password: string) {
  if (getScreen() !== AppScreen.LOGIN) return;
  try {
    const passHash = sha256(`${username.toUpperCase()}:${password}`).toUpperCase();
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
        appearance: c.appearance ? {
          classId: c.appearance.classId || 0,
          head: c.appearance.head || 0,
          rank: c.appearance.rank || 0,
          bodyModel: c.appearance.bodyModel || undefined,
          bodyModelIdcode: c.appearance.bodyModelIdcode || 0,
          weaponDorp: c.appearance.weaponDorp || undefined,
          weaponIdcode: c.appearance.weaponIdcode || 0,
          weaponPos: c.appearance.weaponPos || 0,
          sizeLevel: c.appearance.sizeLevel || 0,
        } : undefined,
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
        stm: 0, maxStm: 0,
        level: Number(ps.level) || 1,
        exp: Number(ps.exp) || 0, maxExp: 0,
        playerName: '',
        gameClock,
      };
      if (getScreen() !== AppScreen.WORLD) {
        go(AppScreen.WORLD, hudState);
      } else {
        hudPanel.show(hudState);
      }
      break;
    }
    case 'enterGame': {
      const eg = msg.enterGame!;
      // 时间锚定不在此处做：连接即已发 ping，onTimeSync 首次回调已用服务器权威时钟初始化 GameClock
      const hudState: HudState = {
        hp: 100, maxHp: 100, mp: 50, maxMp: 50, stm: 0, maxStm: 0,
        level: eg.appearance?.classId ? 1 : 1,
        exp: 0, maxExp: 0,
        playerName: '',
        gameClock,
      };
      const enterGame: EnterGameInfo = {
        playerId: Number(eg.playerId),
        mapId: eg.mapId || 0,
        position: {
          x: eg.position?.x || 0,
          y: eg.position?.y || 0,
          z: eg.position?.z || 0,
        },
        rotation: eg.rotation ? {
          x: eg.rotation.x || 0,
          y: eg.rotation.y || 0,
          z: eg.rotation.z || 0,
        } : undefined,
        appearance: eg.appearance ? {
          classId: eg.appearance.classId || 0,
          head: eg.appearance.head || 0,
          rank: eg.appearance.rank || 0,
          bodyModel: eg.appearance.bodyModel || undefined,
          bodyModelIdcode: eg.appearance.bodyModelIdcode || 0,
          weaponDorp: eg.appearance.weaponDorp || undefined,
          weaponIdcode: eg.appearance.weaponIdcode || 0,
          weaponPos: eg.appearance.weaponPos || 0,
          sizeLevel: eg.appearance.sizeLevel || 0,
        } : undefined,
      };
      go(AppScreen.WORLD, hudState, enterGame);
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
        appearance: c.appearance ? {
          classId: c.appearance.classId ?? 0,
          head: c.appearance.head ?? 0,
          rank: c.appearance.rank ?? 0,
          bodyModel: c.appearance.bodyModel ?? undefined,
          bodyModelIdcode: c.appearance.bodyModelIdcode ?? 0,
          weaponDorp: c.appearance.weaponDorp ?? undefined,
          weaponIdcode: c.appearance.weaponIdcode ?? 0,
          weaponPos: c.appearance.weaponPos ?? 0,
          sizeLevel: c.appearance.sizeLevel ?? 0,
        } : undefined,
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

// 启动：预加载角色模型（选角需要），地图按需加载（进图时）
loadingScreen.show();
const TOTAL_MODELS = 10;
preloadAllModels((loaded) => {
  loadingScreen.setProgress(loaded, TOTAL_MODELS, `加载模型 ${loaded}/${TOTAL_MODELS}`);
  if (loaded >= TOTAL_MODELS) {
    loadingScreen.hide();
    go(AppScreen.LOGIN);
  }
});
