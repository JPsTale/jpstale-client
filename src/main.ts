import { AppScreen, transition, getScreen } from './app/State.js';
import { connect, send, onMessage, onJsonMessage, disconnect, setToken, clearToken, onTimeSync, onConnState, onReconnect, startAutoReconnect, stopAutoReconnect } from './net/transport.js';
import { createCharacter, selectCharacter, playerMove, backToCharacterSelect, logout } from './net/protocol.js';
import { createLoginPanel } from './ui/LoginPanel.js';
import { createLoginBackdrop } from './ui/LoginBackdrop.js';
import { sound } from './core/sound.js';
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
import { setSafeMaps } from './game/safeZones.js';
import { createKeyBinding } from './ui/KeyBinding.js';
import { createReactPanels } from './ui/react/index.js';
import { installBridge, sendPickupItem } from './net/bridge.js';
import { pressQuickBinding, openSystemMenu, closeSystemMenu } from './app/gameStore.js';
import { appendChatMessage, appendSystemMessage, setChatInputOpen, setChatVisible, takePendingSentOn } from './app/chatStore.js';
import type { jpt } from './net/proto/base_message.js';
import { sha256 } from 'js-sha256';const app = document.getElementById('app')!;
const apiBase = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8080/pt`;

const loginBackdrop = createLoginBackdrop(app);
const loginPanel = createLoginPanel(app, { onLogin });
const serverSelectPanel = createServerSelect(app);
const charSelectPanel = createCharSelect(app);
const hudPanel = createHud(app);
const worldView = createWorldView(app, {
  // 移动上报（客户端位置上权威）：WorldView 已按节奏/模式/停止去重，这里直接转发
  onMoveInt: (angle, mode, x, y, z, anim) => sendMoveIntent(angle, mode, x, y, z, anim),
  // 点击地面物品 → 拾取（服务端距离裁决 + 入背包 + 广播消失）
  onPickupGroundItem: (groundItemId) => sendPickupItem(groundItemId),
});

// 转发客户端权威移动（含位置 + 可选动画覆盖）
function sendMoveIntent(angle: number, mode: 0 | 1 | 2, x: number, y: number, z: number, anim = 0): void {
  send(playerMove(angle, mode, x, y, z, anim));
}

const loadingScreen = createLoadingScreen(app);

// ── 连接状态遮罩（i18n）：断开重连 / 退出等待，统一走这里提示 ──
const connOverlayEl = document.createElement('div');
connOverlayEl.style.cssText = 'display:none;position:fixed;inset:0;z-index:900;align-items:center;justify-content:center;flex-direction:column;gap:14px;background:rgba(0,0,0,0.8);color:#eee;font:15px/1.6 system-ui,sans-serif;';
const connTitle = document.createElement('div');
connTitle.style.cssText = 'font-size:22px;font-weight:700;color:#ffb0a0;';
const connSub = document.createElement('div');
connSub.style.cssText = 'color:#bbb;font-size:13px;';
const connBtn = document.createElement('button');
connBtn.style.cssText = 'padding:10px 26px;font-size:15px;cursor:pointer;border:1px solid #b0624f;background:#3a2320;color:#ffc9b8;border-radius:4px;';
connOverlayEl.append(connTitle, connSub, connBtn);
document.body.appendChild(connOverlayEl);
const RECONNECT_TOTAL = 10;
function connOverlayShow(): void { connOverlayEl.style.display = 'flex'; }
function connOverlayHide(): void { connOverlayEl.style.display = 'none'; }
function connSetTitle(key: string, params?: Record<string, string | number>): void { connTitle.textContent = t(`net.${key}`, params || {}); }
function connSetSub(key: string, params?: Record<string, string | number>): void { connSub.textContent = t(`net.${key}`, params || {}); }
function forceBackToLogin(reasonKey: string): void {
  stopAutoReconnect();
  connOverlayHide();
  disconnect();
  clearToken();
  resumeAuto = null;
  clearResume(); // 会话终结：续传引用一并清除（登录后重新建立）
  if (getScreen() !== AppScreen.LOGIN) go(AppScreen.LOGIN);
  loginPanel.show(t(`net.${reasonKey}`));
}
connBtn.onclick = () => forceBackToLogin('logoutReason');

// 退出/等待遮罩：登录中显示"正在断开连接..."，阻断操作直到服务端 ACK（auth.logout 等）
const busyEl = document.createElement('div');
busyEl.style.cssText = 'display:none;position:fixed;inset:0;z-index:901;align-items:center;justify-content:center;flex-direction:column;gap:16px;background:rgba(0,0,0,0.85);color:#eee;font:15px/1.6 system-ui,sans-serif;';
const busyTitle = document.createElement('div');
busyTitle.style.cssText = 'font-size:20px;font-weight:700;color:#ffd9a0;';
busyEl.append(busyTitle);
document.body.appendChild(busyEl);
function busyShow(key: string): void { busyTitle.textContent = t(`net.${key}`); busyEl.style.display = 'flex'; }
function busyHide(): void { busyEl.style.display = 'none'; }

// ── 会话续传：记住登录状态/所在界面，F5 或重开浏览器时若 token 仍有效自动回到对应界面 ──
// token 由登录 REST 颁发（Redis 侧 Sa-Token）；本地只保存引用，服务器重启不影响 token 有效性。
interface ResumeState {
  token?: string;
  server?: { id: number; name: string; ip: string; port: number };
  screen?: 'SERVER_SELECT' | 'CHAR_SELECT' | 'WORLD';
  charId?: number;
}
const RESUME_KEY = 'jpstale.resume';
function loadResume(): ResumeState {
  try { return JSON.parse(localStorage.getItem(RESUME_KEY) || '{}') as ResumeState; } catch { return {}; }
}
function saveResume(patch: Partial<ResumeState>): void {
  const next = { ...loadResume(), ...patch };
  localStorage.setItem(RESUME_KEY, JSON.stringify(next));
}
function clearResume(): void { localStorage.removeItem(RESUME_KEY); }
// 启动自动续传进行中（连接成功后的 onReconnect 分支据此不要强退回登录，等 characterList 续传）
let resumeAuto: { screen?: ResumeState['screen']; charId?: number } | null = null;

/** 启动自动续传：localStorage 有 token+服务器 → 直接连游戏服，让服务器 push characterList 续屏 */
function attemptAutoResume(): boolean {
  const r = loadResume();
  if (!r.token || !r.server || !r.server.ip) return false;
  resumeAuto = { screen: r.screen, charId: r.charId };
  setToken(r.token);
  loadingScreen.show(t('net.autoLogin'));
  go(AppScreen.SERVER_SELECT, [{ ...r.server, online: true }]);
  console.log('[app] 自动续传 →', r.server.name, r.server.ip + ':' + r.server.port, 'target=', r.screen || 'CHAR_SELECT');
  connect(`ws://${r.server.ip}:${r.server.port}/ws`, true);
  return true;
}

// 断线自动重连：意外断开 → 立即停止世界渲染，弹窗并尝试重连（有界 RECONNECT_TOTAL 次）；
// 任何一次连接成功：若已不在登录页则直接回登录重进（会话已失效），由 AOI 重新推场景。
onConnState((state, ev) => {
  if (state === 'connected') { connOverlayHide(); return; }
  if (ev.intentional) return;                       // 主动登出/切页，走正常流程
  if (getScreen() === AppScreen.LOGIN) return;      // 还在登录页：登录按钮会重试，不必打扰
  busyHide();                                       // 若正等待退出 ACK 时断了，改走重连提示
  // 离场即停：隐藏世界（怪物/NPC/掉落物等网络实体不再渲染；地图/自机一并暂停）
  worldView.hide();
  connSetTitle('connLost');
  connSetSub('reconnectProgress', { attempt: 0, total: RECONNECT_TOTAL });
  connOverlayShow();
  startAutoReconnect(RECONNECT_TOTAL, 2000);
});

onReconnect((ev) => {
  if (ev.phase === 'connecting') {
    connSetTitle('reconnecting');
    connSetSub('reconnectProgress', { attempt: ev.attempt, total: ev.total });
  } else if (ev.phase === 'success') {
    connSetTitle('reconnectedTitle');
    connSetSub('reconnectedSub');
    // 正在"启动自动续传/断线自动重连"期间：服务器回来了会再 push characterList 续传，
    // 不要强退回登录；否则会话已失效才回登录重进
    if (resumeAuto) { connOverlayHide(); return; }
    forceBackToLogin('reconnectedReason');
  } else {
    // failed：全部尝试都没连上
    connSetTitle('connFailedTitle');
    connSetSub('connFailedSub');
    forceBackToLogin('connFailedReason');
  }
});
// 进图加载出口（showPanelFor WORLD 处传给 worldView.show）
const worldLoadHooks: WorldLoadHooks = {
  onProgress: (current, max) => loadingScreen.setProgress(current, max),
  onReady: () => loadingScreen.hide(),
};
const gameClock = createGameClock();
const keyBinding = createKeyBinding();

// React 面板层（Phase 1 基建）：只渲染 store.openPanel；桥接把 proto 消息写进 store。
const reactPanels = createReactPanels(app);
installBridge();
console.info('[ui] react panels layer ready — dev: window.__pt.ui.show/hide');

// 开发入口：进图后 window.__pt.ui.toggle('charStatus') 打开角色信息面板
declare global {
  interface Window {
    __pt: { ui: { show: typeof reactPanels.show; hide: typeof reactPanels.hide; toggle: typeof reactPanels.toggle } };
  }
}
window.__pt = { ui: { show: reactPanels.show, hide: reactPanels.hide, toggle: reactPanels.toggle } };

function hideAll() {
  loginPanel.hide();
  serverSelectPanel.hide();
  charSelectPanel.hide();
  hudPanel.hide();
  worldView.hide();
  loadingScreen.hide();
  reactPanels.hide();
  setChatVisible(false);
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
      openSystemMenu();
      break;
    case 'status':
      reactPanels.toggle('charStatus');
      break;
    case 'skillPanel':
      reactPanels.toggle('skills');
      break;
    case 'inventory':
      reactPanels.toggle('inventory');
      break;
    case 'minimap':
      worldView.toggleMinimap();
      break;
    case 'walkRun':
      hudPanel.setRunFlag(worldView.toggleRun());
      break;
    case 'closePanel':
      // 输入框打开时 Esc 优先收输入，再收起面板/菜单
      setChatInputOpen(false);
      closeSystemMenu();
      reactPanels.hide();
      break;
    case 'chat':
      setChatInputOpen(true);
      break;
    // F1~F8 快捷技能：把绑定在该键的技能自动切到对应拳（skill1=F1→index0）
    case 'skill1': case 'skill2': case 'skill3': case 'skill4':
    case 'skill5': case 'skill6': case 'skill7': case 'skill8': {
      const idx = Number(action.slice(5)) - 1;
      pressQuickBinding(idx);
      break;
    }
  }
});

hudPanel.onAction = (action) => {
  if (action === 'toggleRun') {
    hudPanel.setRunFlag(worldView.toggleRun());
  } else if (action === 'system') {
    openSystemMenu();
  } else if (action === 'status') {
    reactPanels.toggle('charStatus');
  } else if (action === 'skills') {
    reactPanels.toggle('skills');
  } else if (action === 'inventory') {
    reactPanels.toggle('inventory');
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
  // 登录/选服界面显示原画背景层，其余界面隐藏（世界画面、选角自带底）
  if (to === AppScreen.LOGIN || to === AppScreen.SERVER_SELECT) {
    loginBackdrop.show();
  } else {
    loginBackdrop.hide();
  }
  // 界面 BGM/点击音效：登录+选服共用登录曲，选人独立曲目，进游戏静音
  const sndKind = (to === AppScreen.LOGIN || to === AppScreen.SERVER_SELECT)
    ? 'login'
    : to === AppScreen.CHAR_SELECT ? 'charSelect' : 'none';
  sound.setScreen(sndKind);
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
          saveResume({ server: { id: s.id, name: s.name, ip: s.ip, port: s.port }, screen: 'SERVER_SELECT' });
          connect(`ws://${s.ip}:${s.port}/ws`, true);
        }
      });
      break;
    }
    case AppScreen.CHAR_SELECT: {
      const chars = (args[0] as CharacterInfo[]) || [];
      charSelectPanel.show(chars, {
        onSelect: (characterId) => {
          saveResume({ charId: characterId, screen: 'WORLD' }); // 目标界面；enterGame 到达后确认
          send(selectCharacter(characterId));
        },
        onCreate: (name, classId, head) => send(createCharacter(name, classId, head)),
        onLogout: () => {
          // 服务端权威：只发退出意图；auth.logout 到达后客户端才清 token/断开回登录
          send(logout());
        },
      });
      break;
    }
    case AppScreen.WORLD: {
      const state = args[0] as HudState | undefined;
      console.log('[app] WORLD screen, hudState=', state);
      if (state) hudPanel.show(state);
      setChatVisible(true);
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

// ============ 系统菜单：大退 / 小退（退出前必须先发报文等服务端存档） ============
// 小退：回到角色选择。只发 backToCharacterSelect，服务端存档并回 auth.backToCharacterSelectResult，
// 连接与 token 都保留（token 不失效，同连接继续选角重进）。
// 大退：退出登录。发 logout，服务端存档并让 token 失效，回 auth.logout 后再断开清 token 回登录。
function performBackToCharSelect() {
  if (getScreen() !== AppScreen.WORLD) return;
  closeSystemMenu();
  hideAll();
  send(backToCharacterSelect());
  // 连接保持；等待 auth.backToCharacterSelectResult → 服务端补发 characterList → 切 CHAR_SELECT
}

function performSystemLogout() {
  if (getScreen() !== AppScreen.WORLD) return;
  closeSystemMenu();
  hideAll();
  // 弹"正在断开连接..."阻断操作；服务端权威登出，等 auth.logout ACK 才真正断开回登录
  busyShow('disconnecting');
  send(logout());
  // 等待 auth.logout → clearToken + disconnect → LOGIN
}

reactPanels.setSystemMenuSettings({
  keyBinding,
  onBackToCharSelect: performBackToCharSelect,
  onLogout: performSystemLogout,
});


async function onLogin(username: string, password: string) {
  if (getScreen() !== AppScreen.LOGIN) return;
  clearResume(); // 新一次手动登录：丢弃上次会话续传状态
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
    saveResume({ token: data.token });
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
      // 世界内忽略：角色列表只在 SERVER_SELECT/CHAR_SELECT/登录阶段有效；
      // 已进入世界后收到（如旧连接残余/双开顶号竞态）不可再叠选角页盖住世界。
      if (getScreen() === AppScreen.WORLD) {
        console.warn('[app] 世界内收到 characterList，忽略（避免选角页叠在世界上层）');
        return;
      }
      const chars = (msg.characterList!.characters || []).map((c) => ({
        characterId: Number(c.characterId),
        name: c.name || '',
        classId: c.classId || 0,
        level: c.level || 1,
        mapId: Number(c.mapId) || 0,
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
      saveResume({ screen: 'CHAR_SELECT' });
      // 会话续传：上次在游戏中 → characterList 就绪后自动选同一角色直接回世界
      if (resumeAuto?.screen === 'WORLD' && resumeAuto.charId) {
        const target = chars.find(c => c.characterId === resumeAuto!.charId);
        resumeAuto = null;
        if (target) {
          console.log('[app] 续传：自动选角进入世界', target.name);
          saveResume({ screen: 'WORLD', charId: target.characterId });
          send(selectCharacter(target.characterId));
        }
      } else {
        resumeAuto = null;
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
      // 自机移动速度接入服务端权威属性（walk/run speed 世界/秒；playerState 到 any 帧都设置）
      if (typeof ps.walkSpeed === 'number' && typeof ps.runSpeed === 'number') {
        worldView.setSpeed(ps.walkSpeed, ps.runSpeed);
      }
      const hudState: HudState = {
        hp: ps.hp || 0, maxHp: ps.maxHp || 0,
        mp: ps.mp || 0, maxMp: ps.maxMp || 0,
        stm: ps.sp || 0, maxStm: ps.maxSp || 0,
        level: Number(ps.level) || 1,
        exp: Number(ps.exp) || 0, maxExp: Number(ps.nextExp) || 0,
        playerName: ps.playerName || '',
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
      setSafeMaps(eg.maps?.map(m => ({ mapId: m.mapId ?? undefined, isSafe: m.isSafe ?? false })));
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
      worldView.setSelfId(enterGame.playerId);
      saveResume({ screen: 'WORLD' }); // 确认已进入世界
      break;
    }
    case 'playerMove': {
      const m = msg.playerMove!;
      worldView.applyPlayerMove(
        Number(m.playerId),
        m.position?.x || 0,
        m.position?.y || 0,
        m.position?.z || 0,
        m.angle || 0,
        m.animState || 0,
      );
      break;
    }
    case 'playerAppear': {
      const a = msg.playerAppear!;
      if (worldView.isSelf(Number(a.playerId))) {
        break;
      }
      const pa = a.appearance;
      worldView.playerAppear(
        Number(a.playerId),
        a.name || '',
        a.classId || 0,
        Number(a.level) || 1,
        a.position?.x || 0,
        a.position?.y || 0,
        a.position?.z || 0,
        a.angle || 0,
        pa ? {
          classId: pa.classId || 0,
          head: pa.head || 0,
          rank: pa.rank || 0,
          bodyModel: pa.bodyModel || undefined,
          bodyModelIdcode: pa.bodyModelIdcode || 0,
          weaponDorp: pa.weaponDorp || undefined,
          weaponIdcode: pa.weaponIdcode || 0,
          weaponPos: pa.weaponPos || 0,
          sizeLevel: pa.sizeLevel || 0,
        } : undefined,
      );
      break;
    }
    case 'playerDisappear': {
      worldView.playerDisappear(Number(msg.playerDisappear!.playerId));
      break;
    }
    case 'appearanceUpdate': {
      const a = msg.appearanceUpdate!;
      const pa = a.appearance;
      const app = pa ? {
        classId: pa.classId || 0,
        head: pa.head || 0,
        rank: pa.rank || 0,
        bodyModel: pa.bodyModel || undefined,
        bodyModelIdcode: pa.bodyModelIdcode || 0,
        weaponDorp: pa.weaponDorp || undefined,
        weaponIdcode: pa.weaponIdcode || 0,
        weaponPos: pa.weaponPos || 0,
        sizeLevel: pa.sizeLevel || 0,
      } : undefined;
      const pid = Number(a.playerId);
      if (worldView.isSelf(pid)) {
        worldView.updateSelfAppearance(app);
      } else {
        worldView.updateRemoteAppearance(pid, app);
      }
      break;
    }
    case 'monsterAppear': {
      const a = msg.monsterAppear!;
      worldView.monsterAppear(
        Number(a.monsterId),
        a.templateId || 0,
        a.name || '',
        a.modelFile || '',
        Number(a.level) || 1,
        a.position?.x || 0,
        a.position?.y || 0,
        a.position?.z || 0,
        a.angle || 0,
      );
      break;
    }
    case 'monsterMove': {
      const m = msg.monsterMove!;
      worldView.monsterMove(
        Number(m.monsterId),
        m.position?.x || 0,
        m.position?.y || 0,
        m.position?.z || 0,
        m.angle || 0,
        m.animState || 0,
      );
      break;
    }
    case 'monsterDisappear': {
      worldView.monsterDisappear(Number(msg.monsterDisappear!.monsterId));
      break;
    }
    case 'monsterDeath': {
      worldView.monsterDeath(Number(msg.monsterDeath!.monsterId));
      break;
    }
    case 'npcAppear': {
      const n = msg.npcAppear!;
      worldView.npcAppear(
        Number(n.npcId),
        n.nameKey || '',
        n.modelFile || '',
        n.position?.x || 0,
        n.position?.y || 0,
        n.position?.z || 0,
        n.angle || 0,
      );
      break;
    }
    case 'npcDisappear': {
      worldView.npcDisappear(Number(msg.npcDisappear!.npcId));
      break;
    }
    case 'groundItemAppear': {
      const g = msg.groundItemAppear!;
      const it = g.item;
      worldView.groundItemAppear(
        it?.groundItemId ? Number(it.groundItemId) : 0,
        it?.name || '',
        it?.position?.x || 0,
        it?.position?.y || 0,
        it?.position?.z || 0,
        it?.dorpItem || '',
      );
      break;
    }
    case 'groundItemDisappear': {
      worldView.groundItemDisappear(Number(msg.groundItemDisappear!.groundItemId));
      break;
    }
    case 'error': {
      const e = msg.error!;
      // minecraft 式翻译：key 优先，否则纯文本
      const text = e.key ? t(e.key, e.params || {}) : (e.errorMessage || String(e.errorCode || ''));
      console.warn('[app] server error', e.errorCode, text);
      // 穿装备失败 → 通知面板还原"交换拿起"的乐观状态
      if (e.errorMessage && String(e.errorMessage).includes('equip failed')) {
        window.dispatchEvent(new Event('pt:equipFail'));
      }
      const forCh = takePendingSentOn() ?? undefined;
      appendSystemMessage(text, Date.now(), forCh);
      break;
    }
    case 'chat': {
      const c = msg.chat!;
      appendChatMessage({
        channel: c.channel || 0,
        senderId: Number(c.senderId) || 0,
        senderName: c.senderName || '',
        message: c.message || '',
        timestamp: Number(c.timestamp) || Date.now(),
      });
      break;
    }
    case 'systemMessage': {
      const sm = msg.systemMessage!;
      // minecraft 式翻译：有 key 用 i18n 渲染（缺失 fallback 到 key），否则用纯文本
      const text = sm.key ? t(sm.key, sm.params || {}) : (sm.message || '');
      const forCh = takePendingSentOn() ?? undefined;
      appendSystemMessage(text, Number(sm.timestamp) || Date.now(), forCh);
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
        mapId: c.mapId ?? c.lastStage ?? 0,
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
      if (getScreen() === AppScreen.SERVER_SELECT || getScreen() === AppScreen.WORLD) {
        go(AppScreen.CHAR_SELECT, chars);
      } else {
        showPanelFor(AppScreen.CHAR_SELECT, chars);
      }
      break;
    }
    case 'auth.backToCharacterSelectResult': {
      // 小退存档确认：状态切回选角（连接/token 保留），选角列表随后由 characterList 填充
      const ok = (data as any)?.success;
      console.log('[app] backToCharacterSelect ack:', ok);
      if (ok && getScreen() !== AppScreen.CHAR_SELECT) {
        transition(getScreen(), AppScreen.CHAR_SELECT, ctx);
      }
      saveResume({ screen: 'CHAR_SELECT' });
      break;
    }
    case 'auth.logout': {
      const ok = (data as any)?.success;
      const reason = (data as any)?.reason;
      console.log('[app] logout ack:', ok, reason || '');
      // 服务端权威登出（主动大退 ack / token 失效 / 被顶号）：收尾“正在断开连接”等待弹窗
      busyHide();
      connOverlayHide();
      resumeAuto = null;
      clearResume();
      // 一律清 token、断开、回登录
      disconnect();
      clearToken();
      if (getScreen() !== AppScreen.LOGIN) {
        go(AppScreen.LOGIN);
      }
      if (reason) {
        loginPanel.show(reason);
      }
      break;
    }
    default:
      console.log('[app] unhandled json:', type, data);
  }
});

// 启动：预加载角色模型（选角需要），地图按需加载（进图时）
loginBackdrop.preload();
loadingScreen.show();
const TOTAL_MODELS = 10;
preloadAllModels((loaded) => {
  loadingScreen.setProgress(loaded, TOTAL_MODELS, `加载模型 ${loaded}/${TOTAL_MODELS}`);
  if (loaded >= TOTAL_MODELS) {
    loadingScreen.hide();
    // 先合法进入 LOGIN（BOOT→LOGIN），确保状态机就绪；随后续传走 LOGIN→SERVER_SELECT→… 全部合法
    go(AppScreen.LOGIN);
    if (!attemptAutoResume()) {
      // 无续传或续传不可用：正常停在登录页
    }
  }
});
