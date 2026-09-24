
import { sfx } from './audio/index.js';
import { requestPlayEat } from './ui/WorldView.js';
import { AppScreen, transition, getScreen } from './app/State.js';
import { connect, send, onMessage, onJsonMessage, disconnect, setToken, clearToken, onTimeSync, onConnState, onReconnect, startAutoReconnect, stopAutoReconnect } from './net/transport.js';
import { createCharacter, selectCharacter, playerMove, backToCharacterSelect, logout, attackStart, attackHit, respawnChoice, unstuck } from './net/protocol.js';
import './ui/theme.css';
import { createLoginPanel } from './ui/LoginPanel.js';
import { createLoginBackdrop } from './ui/LoginBackdrop.js';
import { sound } from './core/sound.js';
import { createServerSelect } from './ui/ServerSelect.js';
import type { ServerInfo } from './ui/ServerSelect.js';
import { createCharSelect } from './ui/CharSelect.js';
import type { CharacterInfo } from './ui/CharSelect.js';
// （原先这里 import preloadAllModels 做启动预载 —— 已移除，见文件末尾的启动段说明）
import { createLoadingScreen } from './ui/LoadingScreen.js';
import { createDeathPanel } from './ui/DeathPanel.js';
import { createHud } from './ui/Hud.js';
import type { HudState } from './ui/Hud.js';
import { createWorldView, lookCritOf } from './ui/WorldView.js';
import type { EnterGameInfo, WorldLoadHooks } from './ui/WorldView.js';
import { t, tOr } from './i18n/index.js';
import { createGameClock } from './ui/GameClock.js';
import { isInputBlocked } from './app/inputGate.js';
import { setSafeMaps } from './game/safeZones.js';
import { createKeyBinding } from './ui/KeyBinding.js';
import { createReactPanels } from './ui/react/index.js';
import { installLayerStack } from './ui/layerStack.js';
import { installBridge, pressQuickKey, sendPickupItem, sendSwitchWeapon, sendUseItem, sendEquipItem, sendTakeToHand, sendNpcInteract, sendUseSkill, sendSkillHit } from './net/bridge.js';
import { beginOptimistic, clearCharacterTables, closeSystemMenu, getGameSnapshot, getHeldUid, itemByUid, localToHeld, openSystemMenu, potionUidInSlot, subscribeGame } from './app/gameStore.js';
import { useEffectKindOf } from './game/useEffect.js';
import { LOC } from './game/itemLocations.js';
import type { CharacterAppearance } from './ui/CharSelect.js';
import { itemDefById, itemIconUrl } from './game/data/itemDefs.js';
import { overweightBlocks } from './game/itemRules.js';
import type { PotionSlotView } from './ui/Hud.js';
import { initCursor } from './ui/cursor.js';
import { installDevLogPanel } from './ui/DevLogPanel.js';
import { installPerfPanel, togglePerfPanel } from './ui/PerfPanel.js';
import { installDmgFxPanel, toggleDmgFxPanel } from './ui/DmgFxPanel.js';
import { loadDisplayPrefs, saveDisplayPrefs } from './ui/display-prefs.js';
import { report as perfReport, formatReport as perfText, frameStart as perfFrameStart, mark as perfMark, frameEnd as perfFrameEnd, setCounter as perfSetCounter, buildExport as perfBuildExport } from './app/profiler.js';
import { dmgFxGet as dmgFxGetFn, dmgFxSet, dmgFxReset } from './render/dmg-fx.js';
import { isStackable } from './game/itemClass.js';
import { requestSplit } from './app/splitStore.js';
import { appendChatMessage, appendSystemMessage, setChatInputOpen, setChatVisible, takePendingSentOn, getChatSnapshot, Ch } from './app/chatStore.js';
import type { jpt } from './net/proto/base_message.js';
import { sha256 } from 'js-sha256';const app = document.getElementById('app')!;
const apiBase = import.meta.env.VITE_API_BASE || `http://${window.location.hostname}:8080/pt`;

const loginBackdrop = createLoginBackdrop(app);
const loginPanel = createLoginPanel(app, { onLogin });
const serverSelectPanel = createServerSelect(app);
const charSelectPanel = createCharSelect(app);
const hudPanel = createHud(app);
const worldView = createWorldView(app, {
  // 移动上报（客户端位置上权威）：WorldView 已按节奏/模式/停止去重，这里直接转发。
  // animIndex/animClip = 自机此刻播的那一条动画，服务端原样透传 → 旁观者直接播同一条。
  onMoveInt: (angle, mode, x, y, z, anim, animIndex, animClip) =>
    sendMoveIntent(angle, mode, x, y, z, anim, animIndex, animClip),
  // 点击地面物品 → 拾取（服务端距离裁决 + 入背包 + 广播消失）
  // 拾取：背包面板开着 → 直接拿到手上（原版 `cInvenTory.OpenFlag` 分支：窗口开着时拾取物进 MouseItem，
  // 不需要背包空格）；关着 → 自动进背包空格。手上已有东西时服务端仍进背包（不覆盖手上那件）。
  onNpcInteract: (entityId) => sendNpcInteract(entityId),
  onPickupGroundItem: (groundItemId) =>
    sendPickupItem(groundItemId, getGameSnapshot().openPanels.includes('inventory')),
  // 攻击起手（挥拳开始）→ C2S_AttackStart；命中帧（每段）→ C2S_AttackHit。服务端权威裁决+结算。
  onAttackStart: (monsterId, clientSeq, segments, animIndex, animClip) =>
    send(attackStart(monsterId, clientSeq, segments, animIndex, animClip)),
  onAttackHit: (monsterId, hitIndex) => send(attackHit(monsterId, hitIndex)),
  // 施法 → C2S_UseSkill：真实链路。`targetId=0` = **无目标施放**（右键即时施放那条路；
  // 服务端目前对 0 是空转 —— 技能效果属 P3+）。skillId = **数字技能 id**（`game/skillIdentity.ts`）。
  onCastSkill: (skillId, targetId, animIndex, animClip) =>
    sendUseSkill(skillId, targetId, animIndex ?? 0, animClip ?? ''),
  // 技能**事件帧**回报（逐段结算，D7）：服务端收到才结算那一段
  onSkillHit: (skillId, targetId, hitIndex) => sendSkillHit(skillId, targetId, hitIndex),
  // 武器套切换的兑现（W 键被缓存到动作播完才回调，见 WorldView.requestSwitchWeapon）
  onSwitchWeapon: () => sendSwitchWeapon(),
});

/**
 * proto 外观 → 客户端外观：**逐字段映射 + 缺省归一**，唯一一份。
 *
 * ⚠ 它**不做任何"我方补充"**。自机的发光输入由 `withSelfBlink` 补（本地物品表更新），
 *   那一步**只能用在自机**：套到远端身上会把**我的**武器锻造等级塞到别人身上
 *   （远端那几项只能来自服务端下发的 `S2C_AppearanceUpdate`）。
 */
function mapAppearance(pa: jpt.base.ICharacterAppearance | null | undefined): CharacterAppearance | undefined {
  if (!pa) return undefined;
  return {
    classId: pa.classId || 0,
    head: pa.head || 0,
    rank: pa.rank || 0,
    bodyModel: pa.bodyModel || undefined,
    bodyModelIdcode: pa.bodyModelIdcode || 0,
    weaponDorp: pa.weaponDorp || undefined,
    weaponIdcode: pa.weaponIdcode || 0,
    weaponPos: pa.weaponPos || 0,
    offHandDorp: pa.offHandDorp || undefined,
    offHandIdcode: pa.offHandIdcode || 0,
    offHandKind: pa.offHandKind || 0,
    offHandPos: pa.offHandPos || 0,
    // 呼吸发光的输入（原版 ItemKindCode / ItemAgingNum[0]）：服务端下发，客户端只转发给渲染层
    weaponKindCode: pa.weaponKindCode || 0,
    weaponAgingLevel: pa.weaponAgingLevel || 0,
    offHandKindCode: pa.offHandKindCode || 0,
    offHandAgingLevel: pa.offHandAgingLevel || 0,
    sizeLevel: pa.sizeLevel || 0,
  };
}

// ── 自机装备的锻造/合成呼吸发光（原版 `SetRenderBlinkColor`，装备时由 `sinSetCharItem` 定色）──
// 输入 = **装备物品的 (ItemKindCode, ItemAgingNum[0])**（`game/agingBlink.ts` 的表行）。
// 服务端现在也会下发这两列（远端玩家靠它发光），但自机**以本地物品表为准**：客户端手上就是最新的
// （锻造刚 +1 时服务端那条包可能还没到），所以这里在推外观之前用本地物品表覆盖一次。
// 订阅物品变化 ⇒ 锻造升级 / 换装 / 拿起放下 都会立刻反映（发光只改材质，不触发模型重建）。
function withSelfBlink(app: CharacterAppearance | undefined): CharacterAppearance | undefined {
  if (!app) return app;
  const items = getGameSnapshot().inventory?.items ?? [];
  const at = (slot: number) => items.find((x) => x.location === LOC.EQUIP && x.slot === slot);
  const main = at(1);   // 主手槽 1（与服务端 `ItemLocations.SLOT_MAIN_HAND` 同值）
  const off = at(2);    // 副手槽 2
  return {
    ...app,
    // 本地有这件就用本地的；没有（进图快照还没到）就留服务端下发的，别把值抹成 undefined
    weaponKindCode: main ? main.kindCode : app.weaponKindCode,
    weaponAgingLevel: main ? main.agingLevel : app.weaponAgingLevel,
    offHandKindCode: off ? off.kindCode : app.offHandKindCode,
    offHandAgingLevel: off ? off.agingLevel : app.offHandAgingLevel,
  };
}
/** 物品表变了 ⇒ 用**当前外观**（WorldView 持有）重推一次，把发光输入换成新的装备 */
function repushSelfBlink(): void {
  const cur = worldView.currentSelfAppearance();
  if (cur) worldView.updateSelfAppearance(withSelfBlink(cur));
}
subscribeGame(repushSelfBlink);
/**
 * 世界地图 —— 现在是**普通面板**（`panel:worldmap`，由 `WorldMapPanel` 渲染），
 * 与背包/角色/技能/NPC 商店共用 `PanelShell` 外壳、层级栈与 `openPanels` 开关。
 *
 * 这里只注入它需要的**数据源**（玩家位置 / 地图上的实体）：
 * 闭包是懒执行的，真正读取发生在面板打开后 —— 所以下面那行 `setWorldMapOptions`
 * 必须在 `worldView` 已建好之后调用（它就在 `createReactPanels` 那一段）。
 */

// 转发客户端权威移动（含位置 + 可选动画覆盖 + 当前动画条目）
function sendMoveIntent(angle: number, mode: 0 | 1 | 2, x: number, y: number, z: number, anim = 0,
                        animIndex = 0, animClip = ''): void {
  send(playerMove(angle, mode, x, y, z, anim, animIndex, animClip));
}

/**
 * 选角进场（**唯一入口** —— 换角色/续传自动进场都必须走它）。
 *
 * 在这里先 `worldView.beginWorldEnter()` 丢掉**上一局**残留的 Appear 暂存。
 * 必须在**发起进场这一刻**清，不能等到世界建好（`show()`）再清：
 * 服务端是先 `aoiManager.onPlayerEnter(...)` 发视野内玩家/怪的 Appear，**再**发 `S2C_EnterGame`
 * （`AccountService` 里就是这个顺序），而此刻本机世界还没建好 ⇒ 这些 Appear 全在暂存里等着重放。
 * 若在 `show()` 里清暂存，就把**本局刚收到**的 Appear 一起清掉了
 * —— 症状是"进场后看不到附近任何玩家/地面物品"（用户 2026-09-16 联机实测）。
 * 判据是"这次进场之前 vs 之后"，所以清点只能落在进场发起处。
 */
function enterCharacter(characterId: number): void {
  worldView.beginWorldEnter();
  send(selectCharacter(characterId));
}

// 加载页：进图时进度条**按已加载字节渐进**（4 个阶段的回调粒度太粗，会长时间不动 ——
// 用户 2026-09-14 实测"它根本不走，只有在加载完之后才动一下"）。refMB 是经验参考量。
const loadingScreen = createLoadingScreen(app, { progressFromBytes: { refMB: 40 } });

// 死亡面板：三个复活选项（对应原版 sinInterFace.h 的 RESTART_FEILD / RESTART_TOWN / RESTART_EXIT）。
// 点击只发意图，**不在这里关闭面板** —— 等服务端 S2C_PlayerRespawn 回来再关，
// 否则"点了没反应"的那段空窗会让人以为没点上（代价结算也以服务端为准）。
const deathPanel = createDeathPanel(app, (choice) => {
  send(respawnChoice(choice));
  deathPanel.setPending();   // 面板留着但锁住，等服务端复活包到达再关（点了要有反馈）
});

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
// 启动即用原版光标（登录/选角界面也要，不然那里还是系统箭头）
initCursor();
// 游戏内日志面板（Ctrl+Shift+L）：屏蔽右键菜单后，需要一个不依赖 devtools 的日志入口
installDevLogPanel();
// 性能剖析面板（Ctrl+Shift+P）：掉帧时看"这一帧的时间花在哪一段"，不必去用 devtools 的 profiler
installPerfPanel();
// 伤害数字打击感调节面板（Ctrl+Shift+U）：实时调弹跳/漂移/金闪，不用改代码一遍遍重试
installDmgFxPanel();

// ===== 屏蔽浏览器右键菜单 =====
// 原版没有浏览器菜单，而右键要用来"使用道具"（已实现）与"使用技能"（待做）。
// 不屏蔽的话：UI 上右键弹出系统菜单、canvas 上右键弹出"图片另存为/检查"（用户 2026-09-13 实测）。
// 输入框放行：否则失去右键粘贴，而输入框里右键"使用"没有意义。
// 用 capture 阶段：先于 React 的合成事件处理，但**不阻断传播**（背包的 onContextMenu 照常工作）。
document.addEventListener('contextmenu', (e) => {
  const t = e.target as HTMLElement | null;
  const tag = t?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || t?.isContentEditable) return;
  e.preventDefault();
}, true);

/** 三个药水槽（ITEMSLOT 11/12/13）的显示数据：图标 url + 数量（空槽 url=''） */
function potionsForHud(): PotionSlotView[] {
  const items = getGameSnapshot().inventory?.items ?? [];
  const out: PotionSlotView[] = [];
  for (const slot of [11, 12, 13]) {
    const it = items.find((x) => x.location === 0 && x.slot === slot);
    const def = it ? itemDefById(it.itemlistId) : undefined;
    out.push(it && def ? { url: itemIconUrl(def), count: it.count } : { url: '', count: 0 });
  }
  return out;
}

const keyBinding = createKeyBinding();

// React 面板层（Phase 1 基建）：只渲染 store.openPanel；桥接把 proto 消息写进 store。
const reactPanels = createReactPanels(app);
// 世界地图的数据源（地图内容在 React 面板里挂载；这里只递闭包）
reactPanels.setWorldMapOptions({
  getPlayer: () => worldView.worldMapPlayer(),       // 每次重绘现读（含朝向）
  getEntities: () => worldView.worldMapEntities(),   // NPC 绿点 / 怪物红点 / 队友（图标与小地图同源）
});
// 层栈：一次安装，之后**声明即参与**（`data-layer` 属性），不需要在各处手动注册
installLayerStack(app);
installBridge();
console.info('[ui] react panels layer ready — dev: window.__pt.ui.show/hide');

// 开发入口：进图后 window.__pt.ui.toggle('charStatus') 打开角色信息面板
// 性能剖析（Ctrl+Shift+P 开关面板）：window.__pt.perf.report() 取一份分段报告；
// frameStart/mark/frameEnd/setCounter 是采样原语，供 console 里手动造一段测量用
// （也是自动化验证的入口 —— 面板读的必须是**同一个** profiler 实例，这几个引用即凭证）。
// 伤害数字打击感调节（Ctrl+Shift+U）：window.__pt.dmgFx.get()/set()/reset() 与面板同源。
declare global {
  interface Window {
    __pt: {
      ui: { show: typeof reactPanels.show; hide: typeof reactPanels.hide; toggle: typeof reactPanels.toggle };
      perf: {
        report: typeof perfReport;
        text: typeof perfText;
        toggle: typeof togglePerfPanel;
        frameStart: typeof perfFrameStart;
        mark: typeof perfMark;
        frameEnd: typeof perfFrameEnd;
        setCounter: typeof perfSetCounter;
        export: typeof perfBuildExport;
      };
      dmgFx: {
        get: () => ReturnType<typeof dmgFxGetFn>;
        set: typeof dmgFxSet;
        reset: typeof dmgFxReset;
        toggle: typeof toggleDmgFxPanel;
      };
    };
  }
}
window.__pt = {
  ui: { show: reactPanels.show, hide: reactPanels.hide, toggle: reactPanels.toggle },
  perf: {
    report: perfReport,
    text: () => perfText(perfReport()),
    toggle: togglePerfPanel,
    frameStart: perfFrameStart,
    mark: perfMark,
    frameEnd: perfFrameEnd,
    setCounter: perfSetCounter,
    export: perfBuildExport,
  },
  dmgFx: {
    get: dmgFxGetFn,
    set: dmgFxSet,
    reset: dmgFxReset,
    toggle: toggleDmgFxPanel,
  },
};

function hideAll() {
  loginPanel.hide();
  serverSelectPanel.hide();
  charSelectPanel.hide();
  hudPanel.hide();
  worldView.hide();    // 切屏时大地图随 reactPanels.hide() 一起收起（它现在就是普通面板）
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
      hudPanel.setMapFlag(worldView.toggleMinimap());
      break;
    case 'worldmap':
      // 原版：M 开大地图（单机是自己那张图，这里是"世界 → 地图"）。
      // 走 store 的面板开关 —— 和背包/角色/技能同一条路（Esc 也因此自动生效）
      if (!isInputBlocked()) reactPanels.toggle('worldmap');
      break;
    case 'walkRun':
      hudPanel.setRunFlag(worldView.toggleRun());
      break;
    case 'cameraMode':
      hudPanel.setCamFlag(worldView.toggleCameraMode());
      break;
    case 'closePanel': {
      // Esc 分级（一次只吃一层，用户 2026-09-14）：
      //   ① 聊天输入框开着 → 收起输入；
      //   ② 还有面板/菜单开着 → 关掉它们；
      //   ③ 界面都干净了 → 取消当前目标（停止追击/攻击循环），**不产生任何移动意图**。
      const hadUi = getChatSnapshot().inputOpen
        || getGameSnapshot().openPanels.length > 0
        || getGameSnapshot().systemMenuOpen;
      setChatInputOpen(false);
      closeSystemMenu();
      reactPanels.hide();
      if (!hadUi) worldView.cancelTarget();
      break;
    }
    case 'chat':
      setChatInputOpen(true);
      break;
    case 'switchWeapon':
      // W 键：当前装备套 ↔ 备用武器套（主手+副手整对互换，服务端裁决）。
      // **不直接发**：攻击/技能/吃药动画没播完就换武器，会出现"模型换了、动画还是旧武器那套"。
      // 交给 WorldView 在动作播完时回调（对齐原版 sinChangeSetFlag 的兑现时机）。
      worldView.requestSwitchWeapon();
      break;
    case 'showGroundItems':
      worldView.toggleGroundItemLabels();
      break;
    // F1~F8 快捷技能：把绑定在该键的技能装到它的拳上（skill1=F1→index0）。
    // 目标拳的判定在 `game/skillBinding.quickFistOf`（唯一实现）；定不下来（该键未绑 / 绑定表没到 /
    // `useCode` 左右都能绑的 ALL 类 / 异职业绑定）⇒ `pressQuickKey` 返回 false 且**什么都不做**。
    case 'skill1': case 'skill2': case 'skill3': case 'skill4':
    case 'skill5': case 'skill6': case 'skill7': case 'skill8': {
      const idx = Number(action.slice(5)) - 1;
      if (!pressQuickKey(idx)) {
        console.log('[skillbind] F' + (idx + 1) + ' 没有可装的目标（未绑 / 绑定表未到 / 目标拳无法确定）');
      }
      break;
    }
    // 数字键 1/2/3：使用对应药水快捷槽（ITEMSLOT 11/12/13）里的药水。
    // 只上送 uid，效果与校验全在服务端（含"槽是空的"这种失败）。
    case 'potion1': case 'potion2': case 'potion3': {
      const idx = Number(action.slice(6)) - 1;
      const uid = potionUidInSlot(idx);
      if (uid == null) {
        console.log('[potion] 药水槽 ' + (idx + 1) + ' 是空的');
        break;
      }
      // 只有"真的开始吃"才发请求 —— EAT 中 / 冷却中时 `requestPlayEat` 返回 false，
      // 那一下按键整体无效（原版 `sinActionPotion` 返回 FALSE 时连 `pUsePotion` 都不设）。
      if (requestPlayEat(useEffectKindOf(itemByUid(uid)?.itemCode))) sendUseItem(uid);
      break;
    }
  }
});

hudPanel.onAction = (action, mods) => {
  if (action === 'toggleRun') {
    hudPanel.setRunFlag(worldView.toggleRun());
  } else if (action === 'toggleCamera') {
    hudPanel.setCamFlag(worldView.toggleCameraMode());
  } else if (action === 'toggleMinimap') {
    hudPanel.setMapFlag(worldView.toggleMinimap());
  } else if (action === 'worldmap') {
    if (!isInputBlocked()) reactPanels.toggle('worldmap');
  } else if (action === 'potion1' || action === 'potion2' || action === 'potion3') {
    // 点药水槽：**手里有道具 → 放进这一格**（原版左键拿起→点槽放下；同种/容量由服务端校验）；
    // 空手 → 等同于对应数字键（使用该槽里的药水）。
    const idx = Number(action.slice(6)) - 1;
    // 手持判据同原版：**物品还在背包才算拿着**（`getHeldUid` 已收紧）。
    // 因此"放入一部分"时手上继续留着剩下的（原版 sinInvenTory.cpp:4616-4624 是逐瓶转移、搬不完留在原处），
    // 而"全部放入"后那件离开背包，手持自动失效（= 放手），**不需要手动清**。
    const heldNow = getHeldUid();
    if (heldNow != null) {
      // 乐观更新前记快照：药水槽放入是**拆堆**（可能只放一部分），服务端拒绝时要能还原数量
      const heldItem = getGameSnapshot().inventory?.items.find((x) => x.uid === heldNow);
      // 负重预检（原版 CheckSetOk 的重量分支，见 itemRules.overweightBlocks）：
      // 已超重时原版直接拒绝搬运；本地先拦，免得"先放入、再被服务端拒绝回滚"的闪烁。
      const ch = getGameSnapshot().character;
      if (overweightBlocks(ch?.currentWeight, ch?.maxWeight, itemDefById(heldItem?.itemlistId ?? -1)?.code)) {
        appendSystemMessage(t('item.op.overWeight'), Date.now());
        return;
      }
      if (heldItem) beginOptimistic([heldItem]);
      // 放入音**不在这里播**：由 store 的"放进容器"事件统一判定
      // （`gameStore.commit` → `notifyPlacedItems`；用户 2026-09-14 要求"无论是鼠标操作、
      // 拾取操作（服务器发来消息），都执行相同的逻辑"）。服务端落地后会推 ItemUpdate → 播该物品的音。
      sendEquipItem(heldNow, 11 + idx);
    } else {
      const uid = potionUidInSlot(idx);
      const it = uid == null ? undefined
        : getGameSnapshot().inventory?.items.find((x) => x.uid === uid);
      if (uid == null || !it) {
        console.log('[potion] 药水槽 ' + (idx + 1) + ' 是空的');
      } else {
        // **左键 = 拿起**（原版 LButtonDown 语义）：把它拿进手上，之后点别处就是放下/丢弃。
        // 喝药是**右键**（原版 UsePotion 由 RButtonDown 触发，见 potionUse* 分支）。
        // Shift + 左键 = **拆分**（用户 2026-09-14）：堆叠数 > 1 时弹框输入要拆出去几个。
        if (mods?.shift && it.count > 1 && isStackable(itemDefById(it.itemlistId)?.class)) {
          requestSplit(it.uid, it.count, itemDefById(it.itemlistId)?.name ?? '');
          return;
        }
        beginOptimistic([it]);
        localToHeld(uid);        // 拿起也是一次"落点变化" → 音由 store 统一播（见 notifyPlacedItems）
        sendTakeToHand(uid);
      }
    }
  } else if (action === 'potionUse1' || action === 'potionUse2' || action === 'potionUse3') {
    // **右键**点药水槽 = 喝（原版 UsePotion：ItemPosition 11/12/13 && Class == ITEM_CLASS_POTION）。
    // 手上有东西时右键无效（原版 MouseItem.Flag 守卫）。
    const idx = Number(action.slice(9)) - 1;
    const uid = potionUidInSlot(idx);
    if (uid == null) {
      console.log('[potion] 药水槽 ' + (idx + 1) + ' 是空的');
    } else if (getHeldUid() == null) {
      // 同数字键：EAT 中 / 冷却中 → 那一下按键整体无效（不吃也不发）
      if (requestPlayEat(useEffectKindOf(itemByUid(uid)?.itemCode))) sendUseItem(uid);
    }
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
      }, () => {
        forceBackToLogin('logoutReason');
      });
      break;
    }
    case AppScreen.CHAR_SELECT: {
      const chars = (args[0] as CharacterInfo[]) || [];
      charSelectPanel.show(chars, {
        onSelect: (characterId) => {
          saveResume({ charId: characterId, screen: 'WORLD' }); // 目标界面；enterGame 到达后确认
          enterCharacter(characterId);
        },
        onCreate: (name, classId, head) => send(createCharacter(name, classId, head)),
        onLogout: () => {
          // 服务端权威：只发退出意图；auth.logout 到达后客户端才清 token/断开回登录
          send(logout());
        },
        onBackToServers: async () => {
          disconnect(); // 断游戏服连接但保留 token（intentional，不触发重连警告）
          saveResume({ screen: 'SERVER_SELECT' }); // 回选服：下一屏目标即 SERVER_SELECT
          try {
            go(AppScreen.SERVER_SELECT, await fetchServerList());
          } catch {
            go(AppScreen.SERVER_SELECT, []); // 列表拉不到 → 空态 + 退出按钮兜底
          }
        },
      });
      break;
    }
    case AppScreen.WORLD: {
      const state = args[0] as HudState | undefined;
      console.log('[app] WORLD screen, hudState=', state);
      if (state) hudPanel.show(state);
      hudPanel.setPotions(potionsForHud());
      // 物品变化（拾取/放入药水槽/吃药）→ 刷新 HUD 药水槽（HUD 内部只更新这一项）
      subscribeGame(() => hudPanel.setPotions(potionsForHud()));
      setChatVisible(true);
      const enterGame = args[1] as EnterGameInfo | undefined;
      if (enterGame) {
        // 发光输入已随 `enterGame.appearance` 一并补好（见上面的 `withSelfBlink`）；
        // 之后任何物品变化都由 `subscribeGame(repushSelfBlink)` 重推，这里不必再补一次。
        // 进图加载页：go() 的 hideAll 已收起 loadingScreen，这里同 tick 重新显示盖住世界画面，
        // WorldView 阶段进度喂进度条，首帧渲染完成（onReady）后收起
        const mapName = t(`map.${enterGame.mapId}`);
        const title = mapName.startsWith('map.')
          ? t('gui.load.world')
          : t('gui.load.entering', { map: mapName });
        loadingScreen.show(title);
        worldView.show(enterGame, worldLoadHooks);
        // HUD 小按钮的 tooltip 画的是**当前状态**（走/跑、相机模式、地图开关），进图时对齐一次，
        // 避免 WorldView 默认值与 HUD 默认值将来各自漂移
        hudPanel.setRunFlag(worldView.isRunning());
        hudPanel.setCamFlag(worldView.cameraMode());
        hudPanel.setMapFlag(worldView.isMinimapOn());
      }
      break;
    }
  }
}

function go(to: AppScreen, ...args: unknown[]) {
  if (!transition(getScreen(), to, ctx)) return;
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

// 脱困：零代价传送到本图最近的 StartPoint。服务端权威（它才知道地图边界与地形），
// 客户端只发意图：C2S_Unstuck（不带宽窄参数）→ 服务端算落点 → S2C_PlayerTeleport 广播回来。
// 与死亡复活同构（C2S_RespawnChoice / S2C_PlayerRespawn），但走独立消息、不含死亡语义。
function performUnstuck() {
  if (getScreen() !== AppScreen.WORLD) return;
  closeSystemMenu();
  send(unstuck());
}

reactPanels.setSystemMenuSettings({
  keyBinding,
  onBackToCharSelect: performBackToCharSelect,
  onLogout: performSystemLogout,
  onUnstuck: performUnstuck,
  getFps: () => worldView.getTargetFps(),
  setFps: (fps) => worldView.setTargetFps(fps),
  // 显示预算偏好：存 localStorage（下次进来还在）+ 立刻应用到世界（不用重进游戏）
  getDisplayPrefs: () => loadDisplayPrefs(),
  setDisplayPrefs: (p) => { saveDisplayPrefs(p); worldView.setDisplayPrefs(p); },
});


async function fetchServerList(): Promise<ServerInfo[]> {
  const res = await fetch(`${apiBase}/api/game/servers`);
  const data = await res.json();
  if (data.code !== 200) {
    console.warn(`[web] 服务器列表获取失败 code=${data.code} msg=${data.msg}`);
    return [];
  }
  return (data.data ?? []).map((s: any) => ({
    id: s.id,
    name: s.name ?? `Server ${s.id}`,
    ip: s.ip,
    port: s.port,
    online: !!s.online,
  }));
}

async function onLogin(username: string, password: string) {
  if (getScreen() !== AppScreen.LOGIN) return;
  clearResume(); // 新一次手动登录：丢弃上次会话续传状态
  loginPanel.setBusy(true); // 连接中：禁用按钮并提示，防止重复提交
  try {
    const passHash = sha256(`${username.toUpperCase()}:${password}`).toUpperCase();
    const res = await fetch(`${apiBase}/api/game/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: username, password: passHash }),
    });
    const data = await res.json();
    if (data.code !== 200) {
      // 服务端只回 translate key（如 error.web.loginFailed），翻不出来才退回本地兜底文案
      showPanelFor(AppScreen.LOGIN, tOr(data.msg, t('gui.login.failed')));
      return;
    }
    setToken(data.data.token);
    saveResume({ token: data.data.token });
    // 服务器列表走独立接口（登录不复用、不耦合选服）
    const servers = await fetchServerList();
    go(AppScreen.SERVER_SELECT, servers);
  } catch (e) {
    showPanelFor(AppScreen.LOGIN, t('net.connFailed'));
  } finally {
    loginPanel.setBusy(false);
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
        appearance: mapAppearance(c.appearance),
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
          enterCharacter(target.characterId);
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
        charSelectPanel.handleCreateResult(false, t('gui.charCreate.failedRetry'));
      }
      break;
    }
    case 'playerState': {
      const ps = msg.playerState!;
      // 自机移动速度接入服务端权威属性（walk/run speed 世界/秒；playerState 到 any 帧都设置）
      if (typeof ps.walkSpeed === 'number' && typeof ps.runSpeed === 'number') {
        // 速度值用于**本地移动步长**；动画速率由服务端查表算好一并下发（1 档 = 1.0）
        worldView.setSpeed(ps.walkSpeed, ps.runSpeed, ps.animWalkRate || 0, ps.animRunRate || 0);
      }
      worldView.setSelfLevel(Number(ps.level) || 1);   // 跨图边界的等级门槛判定用
      const hudState: HudState = {
        hp: ps.hp || 0, maxHp: ps.maxHp || 0,
        mp: ps.mp || 0, maxMp: ps.maxMp || 0,
        stm: ps.sp || 0, maxStm: ps.maxSp || 0,
        level: Number(ps.level) || 1,
        // EXP 条用**本级**口径：经验是累计值（L1 起累加），直接拿 exp/nextExp 画永远是"快满"
        // （用户 2026-09-12 报的就是这个）。本级已获得 = exp - levelExp，本级升级所需 = nextExp - levelExp。
        exp: Math.max(0, (Number(ps.exp) || 0) - (Number(ps.levelExp) || 0)),
        maxExp: Math.max(0, (Number(ps.nextExp) || 0) - (Number(ps.levelExp) || 0)),
        playerName: ps.playerName || '',
        gameClock,
      };
      if (getScreen() !== AppScreen.WORLD) {
        go(AppScreen.WORLD, hudState);
      } else {
        hudPanel.show(hudState);
      }
      // 名牌/血条：自机 hp（权威值；hp 下降=受击 → 战斗窗口）与名牌名
      worldView.setSelfName(ps.playerName || '');
      worldView.setSelfHp(ps.hp || 0, ps.maxHp || 0);
      break;
    }
    case 'enterGame': {
      const eg = msg.enterGame!;
      // 进图的**第一件事**：把上一个角色留下的"按角色权威表"清成**未知**（技能表 + 绑定表）——
      // 服务端紧接着补发（`sendSkillTables`），在那之前谁也不许拿旧表画东西
      // （否则"换角色进图"的头几帧 HUD 会画出**上一个角色**的拳位图标，用户 2026-09-24 的症状）。
      clearCharacterTables();
      setSafeMaps(eg.maps?.map(m => ({ mapId: m.mapId ?? undefined, isSafe: m.isSafe ?? false, levelReq: m.levelReq ?? 0 })));
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
        appearance: withSelfBlink(mapAppearance(eg.appearance)),
        // 全量地图包围盒（服务端权威，SMD 派生）→ 判图/预加载查找表
        maps: eg.maps?.map((m) => ({
          mapId: Number(m.mapId) || 0,
          bounds: (m.minX !== undefined && m.minX !== null)
            ? [Number(m.minX), Number(m.maxX), Number(m.minZ), Number(m.maxZ)] as [number, number, number, number]
            : undefined,
        })),
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
        m.animIndex || 0,   // 对方播的那一条动画（服务端透传）→ 旁观者直接播同一条
        m.animClip || '',
        m.useSeq || 0,          // 使用道具序号（去重）→ 站着连喝两瓶也会每次都播
        m.useItemIdcode || 0,   // 使用道具的 idcode → 旁观者推粒子/音（与自机同一函数）
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
        a.hp || 0,
        a.maxHp || 0,
        a.clanName || '',
        a.clanMark || '',
        a.position?.x || 0,
        a.position?.y || 0,
        a.position?.z || 0,
        a.angle || 0,
        mapAppearance(pa),
        // 走/跑**动画速率**（服务端查表算好；1 档 = 1.0）——本消息里不再传速度值（那对字段已废弃）
        a.animWalkRate || 1,
        a.animRunRate || 1,
        // 对方**此刻在播的那一条**（服务端缓存自其最近上报）：进视野时对齐用 —— 否则"出现时正在
        // 挥砍/施法/走路"的玩家会先站住（用户 2026-09-23）。不在外观指纹里（不换网格、只选动画条目）。
        a.animIndex || 0,
        a.animClip || '',
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
      const pid = Number(a.playerId);
      const self = worldView.isSelf(pid);
      // 自机：本地物品表覆盖（锻造刚 +1 时本条包可能还是旧的）；远端：**只用**服务端下发
      const app = self ? withSelfBlink(mapAppearance(pa)) : mapAppearance(pa);
      if (self) {
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
        a.hp || 0,
        a.maxHp || 0,
        a.position?.x || 0,
        a.position?.y || 0,
        a.position?.z || 0,
        a.angle || 0,
        !!a.dead,
        a.monsterEffectId || 0,
        a.animRate || 0,   // 动画播放速率（服务端按 DB attackspeed 算好下发）
        Number(a.ownerEntityId) || 0,  // 召唤物归属：>0 = 玩家召唤出来的（名牌画蓝 + `(主人名)`、不可攻击自己那只）
        a.ownerName || '',
        a.summonLifeTotalMs || 0,      // 头顶倒计时条：总寿命 + 收到时的剩余（客户端本地推比例）
        a.summonLifeRemainingMs || 0,
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
        // 服务端选定的攻击变体条目（`S2C_MonsterMove.anim_index`）——不传的话客户端本地自选变体，
        // 而各变体的事件帧不同（实测 169 个多变体模型里 129 个如此）⇒ 特效/音效会在错的时刻触发。
        m.animIndex || 0,
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
    case 'skillStart': {
      // 技能起手广播：旁观者立刻播**施法者自己播的那一条**技能动画（服务端透传 anim_index/anim_clip）
      const ss = msg.skillStart!;
      worldView.signalSkillStart(Number(ss.casterId ?? 0), Number(ss.skillId ?? 0),
        Number(ss.targetId ?? 0), Number(ss.animIndex ?? 0), ss.animClip || '');
      break;
    }
    case 'attackStart': {
      // 起手广播：远端玩家立刻挥拳（自机由本地攻击循环驱动，内部忽略）
      const as = msg.attackStart!;
      worldView.signalAttackStart(Number(as.attackerId ?? 0), Number(as.targetId ?? 0),
        Number(as.attackSpeed ?? 0), as.animIndex || 0, as.animClip || '');
      break;
    }
    case 'attackPlan': {
      // B 方案：服务端在起手时即裁定各段结果，客户端据此在事件帧直接播正确的音（免一次往返）
      worldView.applyAttackPlan(msg.attackPlan!);
      break;
    }
    case 'attackResult': {
      // 攻击结算（命中帧逐段）：目标怪物飘伤害+自减血；missed → 头顶 MISS
      const ar = msg.attackResult!;
      const attackerId = Number(ar.attackerId ?? 0);
      const targetId = Number(ar.targetId ?? 0);
      if (worldView.isSelf(attackerId)) worldView.markSelfCombat();
      if (ar.missed) {
        worldView.showFloater('monster', targetId, 'MISS', '#d8dce3', false, attackerId);
        if (worldView.isSelf(attackerId)) worldView.playSelfAttackResult(true, false, Number(ar.hitIndex ?? 0));
      } else {
        const crit = !!ar.isCritical;
        worldView.showFloater('monster', targetId, String(ar.damage || 0), crit ? '#ffd166' : '#ffffff', crit, attackerId);
        worldView.applyMonsterHit(targetId, ar.damage || 0);
        // 命中特效：暴击判定 = is_critical ∨ AttackEffect（原版 character.cpp:13354 置位 / :5166 消费）。
        // ⚠ 只有外观与武器音走 lookCritOf；飘字（上方）仍只跟 isCritical（任务书 :173）。
        const critLook = lookCritOf({ missed: false, critical: crit, attackEffect: !!ar.attackEffect });
        if (critLook) {
          worldView.spawnEffectOnUnit(targetId, 'CriticalHit1');
          worldView.spawnEffectOnUnit(targetId, 'Light1');
        } else {
          worldView.spawnEffectOnUnit(targetId, 'NormalHit1');
        }
        if (worldView.isSelf(attackerId)) worldView.playSelfAttackResult(false, crit, Number(ar.hitIndex ?? 0), !!ar.attackEffect);
      }
      break;
    }
    case 'damage': {
      // 怪→玩家伤害（S2C_Damage：targetId=受害者，damage+权威 currentHp）→ 受害者头顶飘红字
      const d = msg.damage!;
      const tid = Number(d.targetId ?? 0);
      if (d.missed) {
        // 怪这一刀没打中（原版 sinGetMonsterAccuracy）：只飘 MISS，不扣血、不播受击硬直/受击音
        worldView.showFloater(null, tid, 'MISS', '#d8dce3', false);
        break;
      }
      if (d.blocked) {
        // 被格挡：同样不扣血、不播受击硬直/音，飘 "Blocked" + 随机播 impact/block{1,2,3}.wav
        worldView.showFloater(null, tid, 'Blocked', '#9fd8ff', false);
        sfx.play('wav/effects/impact/block' + (1 + Math.floor(Math.random() * 3)) + '.wav');
        break;
      }
      worldView.showFloater(null, tid, '-' + (d.damage || 0), '#ff6b6b', false);
      worldView.applyUnitHp(tid, d.currentHp || 0, true);
      // 受击硬直：自机/远端玩家站立被打播 DAMAGE（攻击/技能中不打断）
      worldView.onTakeDamage(tid, d.damage || 0);
      break;
    }
    case 'playerDeath': {
      // 死亡：躺下停在 DEAD 动画末帧（不再立刻复活）。自己还要弹三个复活选项 + 倒计时。
      const pd = msg.playerDeath!;
      const pid = Number(pd.playerId ?? 0);
      worldView.applyPlayerDeath(pid);
      if (worldView.isSelf(pid)) {
        deathPanel.show({
          forceRespawnMs: Number(pd.forceRespawnMs ?? 60000),
        });
      }
      break;
    }
    case 'playerTeleport': {
      // 不连续位移（脱困/传送）：服务端广播的一条消息两个受众 —— 本人搬自己、旁观者挪 actor。
      const tp = msg.playerTeleport!;
      const pid = Number(tp.playerId ?? 0);
      const mapId = Number(tp.mapId ?? 0);
      const info = {
        mapId,
        x: Number(tp.position?.x ?? 0),
        y: Number(tp.position?.y ?? 0),
        z: Number(tp.position?.z ?? 0),
        angle: Number(tp.angle ?? 0),
      };
      if (worldView.isSelf(pid)) {
        const needLoad = worldView.respawnNeedsMapLoad(mapId);
        if (needLoad) loadingScreen.show(t('death.respawning'));
        void worldView.applyTeleport(info).finally(() => {
          if (needLoad) loadingScreen.hide();
        });
      } else {
        worldView.teleportRemote(pid, info);
      }
      break;
    }
    case 'mapSwitched': {
      // 服务端权威换图校准（protobuf）：对齐 currentMapId 并同步区域/音频/姿态
      const ms = msg.mapSwitched!;
      worldView.applyMapSwitched(Number(ms.mapId ?? 0));
      break;
    }
    case 'ageUpBroadcast': {
      // 锻造成功：**自己与旁观者都播**（原版 `smCOMMNAD_USER_AGINGUP`，服务端按 AOI 广播）——
      // 白光 + `.part` aging，音效编号 7 与升级同一记音、按距离衰减（`netplay.cpp:7290-7298`）。
      const ab = msg.ageUpBroadcast!;
      const pid = Number(ab.playerId ?? 0);
      const at = worldView.unitFeetPos(pid);
      if (at) sfx.playLevelUp(worldView.isSelf(pid) ? undefined : { pos: at });
      else break;              // 不在视野里：不放音也不放特效（同升级那支的口径）
      worldView.spawnAgeUpEffect(pid);
      break;
    }
    case 'levelUpBroadcast': {
      // 升级：**自己与旁观者都播**升级音 + 特效（等级数值由服务端权威推送）。
      // 原版两处调用点：`playsub.cpp:1310`（自己，音量 400）与 `character.cpp:9157`（看见别人升级，
      // `esPlaySound(7, GetDistVolume(pX,pY,pZ))` ⇒ 同一条音、按距离衰减）。
      const lb = msg.levelUpBroadcast!;
      const pid = Number(lb.playerId ?? 0);
      // 名牌 `Lv.X` 前缀的时效：升级广播自带新等级，就地刷新（不在视野内则忽略，回来时 Appear 会带）
      worldView.updateRemoteLevel(pid, Number(lb.level) || 0);
      const isSelf = worldView.isSelf(pid);
      const at = worldView.unitFeetPos(pid);
      if (isSelf) {
        sfx.playLevelUp();                      // 原版 `esPlaySound(7, 400)`：自己，2D 优先音
      } else if (at) {
        sfx.playLevelUp({ pos: at });           // 原版 `esPlaySound(7, GetDistVolume(pX,pY,pZ))`
      } else {
        // 那个玩家不在视野里（服务端按 AOI 半径广播，边界上可能收得到）：**不放音也不放特效** ——
        // 不退回"贴在耳边"的 2D 音（原版这条路的音量本来就来自距离）
        break;
      }
      worldView.spawnLevelUpEffect(pid);
      break;
    }
    case 'playerRespawn': {
      // 服务端权威复活：位置/地图/半血。自机位置权威在客户端 → 必须由客户端把自己搬过去。
      const pr = msg.playerRespawn!;
      const pid = Number(pr.playerId ?? 0);
      if (!worldView.isSelf(pid)) break;
      deathPanel.hide();
      const info = {
        mapId: Number(pr.mapId ?? 0),
        x: Number(pr.position?.x ?? 0),
        y: Number(pr.position?.y ?? 0),
        z: Number(pr.position?.z ?? 0),
        hp: Number(pr.hp ?? 0),
        maxHp: Number(pr.maxHp ?? 0),
      };
      // 换图复活要重新加载地图 —— 原版做法是加载界面盖住，好了再进画面（用户 2026-09-13）；
      // 不盖的话玩家会看到世界在脚下一块块长出来。
      const needLoad = worldView.respawnNeedsMapLoad(info.mapId);
      if (needLoad) loadingScreen.show(t('death.respawning'));
      void worldView.applyRespawn(info).finally(() => {
        if (needLoad) loadingScreen.hide();
      });
      break;
    }
    case 'recovery': {
      // 资源回复（与 'damage' 对称）：HP 绿字 / MP 蓝字。各为 0 = 该项没回复 → 不飘。
      // ⚠ 被动缓慢回复**不发**这条（服务端 RegenerationService 只刷 HUD，不广播）。
      const r = msg.recovery!;
      const tid = Number(r.targetId ?? 0);
      const hp = r.hpAmount || 0;
      const mp = r.mpAmount || 0;
      if (hp > 0) worldView.showFloater(null, tid, '+' + hp, '#5cff8a', false);
      if (mp > 0) worldView.showFloater(null, tid, '+' + mp, '#5cb8ff', false);
      worldView.applyUnitHp(tid, r.currentHp || 0, false);
      break;
    }
    case 'npcAppear': {
      const n = msg.npcAppear!;
      worldView.npcAppear(
        Number(n.entityId),
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
      worldView.npcDisappear(Number(msg.npcDisappear!.entityId));
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
        it?.itemId || 0,                          // 原版 idcode：只用于判物品大类（武器才躺平），见 WorldView.groundItemAppear
        Number(it?.itemlistId || 0),              // itemlist 主键：只给显示名查 i18n（`item.<id>.name`）
        Number(it?.quantity || 0),                // 堆叠数（名牌用）
        Number(it?.money || 0),                   // 金币金额（int64 → number；金币名牌显示它而非 quantity）
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
      // 物品操作失败（key 前缀 `item.op.`，服务端按**原因**回 key，见 ItemNetworkHandler.opKeySuffix）
      // → 通知面板把乐观更新整体还原（原版 BackUpPosi 语义）。
      // 判据是**协议字段**，不再靠 errorMessage 里的字符串匹配 —— 后者改一句文案就会静默失效。
      if (e.key && e.key.startsWith('item.op.')) {
        // 失败音（用户 2026-09-14：拿起/放下/交换/拾取**失败**才播这个提示音）。
        // 这里是唯一入口：服务端拒绝的任何物品操作都经 `S2C_Error` 回来 → 一处覆盖全部失败。
        sfx.playUi('denied');
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
      // 服务端显式标了 CHAT_BATTLE 的走"战斗" tab；未标（默认 0）一律还是系统消息 —— 老发送方不用改
      const battle = Number(sm.channel ?? 0) === Ch.BATTLE;
      appendSystemMessage(text, Number(sm.timestamp) || Date.now(), forCh, battle);
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
        appearance: mapAppearance(c.appearance as jpt.base.ICharacterAppearance | undefined),
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

// 启动：**不再预加载角色模型**（用户 2026-09-14 定："不要登录之前就加载一堆东西"）。
//
// 原来这里跑 `preloadAllModels`，它要把 10 个职业的完整骨架+身体+头全下完（8 组动画包
// 合计 162MB）才肯 `go(AppScreen.LOGIN)` —— 打开页面到能输账号密码之间就是这个下载。
// 现在登录页只等背景图；选角/创建角色预览改走 lite 包按需加载（每组 293~648KB，
// 见 render/lite-loader.ts），进图时才拉自机那一个职业的完整包。
loginBackdrop.preload();
go(AppScreen.LOGIN);
attemptAutoResume();
