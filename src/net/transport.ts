import { encodeClient, decodeServer, debugLog, ping } from './protocol.js';
import type { jpt } from './proto/base_message.js';
import { reportFallback } from '../char/fallback-log.js';
import { setKeepaliveInterval, clearKeepaliveInterval, setKeepaliveTimeout, clearKeepaliveTimeout } from '../core/keepalive-timer.js';

type ProtoHandler = (msg: jpt.base.ServerMessage) => void;
type JsonHandler = (type: string, data: Record<string, unknown>) => void;
type TimeSyncHandler = (serverTimeMs: number) => void;

let ws: WebSocket | null = null;
let protoHandlers: ProtoHandler[] = [];
let jsonHandlers: JsonHandler[] = [];
let timeSyncHandlers: TimeSyncHandler[] = [];
let url = '';
let reconnectTimer = 0;
let heartbeatTimer = 0;
let timeSyncTimer = 0;
let shouldReconnect = false;
let sendTokenOnConnect = false;
/** 本次关闭是否为客户端主动发起（登出/切登录页）；false = 意外断开 */
let intentionalClose = false;

export type ConnState = 'connected' | 'closed';
export interface ConnEvent { intentional: boolean; }
type ConnListener = (state: ConnState, ev: ConnEvent) => void;
let connListeners: ConnListener[] = [];

/** 监听连接生命周期（UI 断线提示用）。返回取消订阅函数。 */
export function onConnState(listener: ConnListener): () => void {
  connListeners.push(listener);
  return () => { connListeners = connListeners.filter(h => h !== listener); }
}

function emitConn(state: ConnState, ev: ConnEvent): void {
  for (const h of connListeners) h(state, ev);
}

// ---- 断线自动重连（有界尝试） ----
export interface ReconnectEvent {
  phase: 'connecting' | 'success' | 'failed';
  attempt: number;   // 当前尝试序号（connecting）；成功后为成功的那一次
  total: number;
}
type ReconnectListener = (ev: ReconnectEvent) => void;
let rcListeners: ReconnectListener[] = [];
let rcAttempt = 0;
let rcTotal = 0;
let rcActive = false;
let rcTimer = 0;
let rcSuccessOpen = false;

export function onReconnect(listener: ReconnectListener): () => void {
  rcListeners.push(listener);
  return () => { rcListeners = rcListeners.filter(h => h !== listener); }
}

function emitReconnect(ev: ReconnectEvent): void {
  for (const h of rcListeners) h(ev);
}

/**
 * 有界自动重连：最多 total 次，间隔 delayMs。断线后由调用方触发（`main.ts` 的 onConnState('closed')）。
 *
 * ⚠ 这里的等待**必须用 keepalive 定时器**：后台标签页里 window 定时器被节流到 ≥1Hz（隐藏 ≥5min
 * 后 ≥1/min），10 次 × 2s 的重连窗口会被拉成 ~10 分钟 —— 而"切 tab 掉线"正是要靠它救回来的场景
 * （用户 2026-09-21 实测的卡死）。清理也必须成对用 `clearKeepaliveTimeout`：本模块句柄是
 * keepalive 自己的编号空间，`clearTimeout` 清不掉（回调仍会飞）。
 */
export function startAutoReconnect(total = 10, delayMs = 2000): void {
  if (rcActive) return;
  if (!url) return;
  rcActive = true;
  rcAttempt = 0;
  rcTotal = total;
  rcSuccessOpen = false;
  scheduleReconnectAttempt(delayMs);
}

function scheduleReconnectAttempt(delayMs: number): void {
  clearKeepaliveTimeout(rcTimer);
  rcTimer = setKeepaliveTimeout(() => {
    rcAttempt++;
    emitReconnect({ phase: 'connecting', attempt: rcAttempt, total: rcTotal });
    rcSuccessOpen = false;
    _connect(); // ws.onopen/onclose 里会走重连状态机
  }, delayMs);
}

function onReconnectOpen(): void {
  if (!rcActive) return;
  rcSuccessOpen = true;
  rcActive = false;
  clearKeepaliveTimeout(rcTimer);
  emitReconnect({ phase: 'success', attempt: rcAttempt, total: rcTotal });
}

function onReconnectClosed(): void {
  if (!rcActive) return;
  if (rcSuccessOpen) return; // 已成功过（onopen 关闭了状态机）
  if (rcAttempt >= rcTotal) {
    rcActive = false;
    clearKeepaliveTimeout(rcTimer);
    emitReconnect({ phase: 'failed', attempt: rcAttempt, total: rcTotal });
  } else {
    scheduleReconnectAttempt(2000);
  }
}

export function stopAutoReconnect(): void {
  rcActive = false;
  clearKeepaliveTimeout(rcTimer);
}

// 服务端读空闲超时：WS 通道 `IdleStateHandler(120s)`（`WebSocketServer.java:55`）、
// 裸 TCP 通道 60s（`NettyServer.java:49`）。客户端走 WS ⇒ 真正的红线是 120s。
// 20s 心跳 + 4s 对时都压在 120s 以内（且都走 keepalive，后台不被节流）。
const HEARTBEAT_INTERVAL = 20000; // 每 20s 发一次 ping
const TIME_SYNC_INTERVAL = 4000;  // 每 4s 发一次时间校正

export function connect(wsUrl: string, withToken = false): void {
  url = wsUrl;
  sendTokenOnConnect = withToken;
  shouldReconnect = false;
  intentionalClose = false;
  _connect();
}

function _connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => {
    console.log('[net] connected');
    emitConn('connected', { intentional: false });
    onReconnectOpen();
    if (sendTokenOnConnect && _token) {
      sendJson('auth.token', { token: _token });
    }
    startHeartbeat();
  };
  /** 单条消息的派发（pong 时间同步 + 全部 proto handler）—— 合批与逐条两条路径共用这一份 */
  function dispatchProto(msg: jpt.base.ServerMessage): void {
    debugLog(msg);
    // 处理pong响应中的服务器时间
    if (msg.pong) {
      const serverTimeMs = Number(msg.pong.timestamp);
      for (const h of timeSyncHandlers) h(serverTimeMs);
    }
    for (const h of protoHandlers) h(msg);
  }

  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      try {
        const parsed = JSON.parse(ev.data);
        console.log('[net] json:', parsed.type);
        for (const h of jsonHandlers) h(parsed.type, parsed.data ?? {});
      } catch { console.warn('[net] bad json', ev.data); }
    } else {
      try {
        const msg = decodeServer(ev.data as ArrayBuffer);
        // 合批信封（服务端每 tick 把发给本玩家的多条消息装成一个包，见 proto S2C_Batch）：
        // 在这里**展开**，逐条走与单条完全相同的派发路径 —— 所以下游（bridge/WorldView）
        // 对自己的消息是否被合批一无所知，行为与逐条发送一字不差。
        // 只展开一层（服务端约定不会嵌套 batch）；真出现嵌套也只解一层，不会无限递归。
        const batched = msg.batch ? msg.batch.messages : null;
        if (batched && batched.length) {
          // protobufjs 生成的 .d.ts 把 repeated message 的元素声明成 `$Properties`（纯对象形状），
          // 但 `ServerMessage.decode()` 解出来的实际是 **ServerMessage 实例** —— 这里按运行时事实
          // 取窄。刻意不用 `fromObject()` 转换：那会对每条消息多拷一遍，把合批省下的 CPU 又吃回去。
          for (const one of batched) dispatchProto(one as unknown as jpt.base.ServerMessage);
        } else {
          dispatchProto(msg);
        }
      } catch { console.warn('[net] bad binary', ev.data); }
    }
  };
  ws.onclose = () => {
    console.log('[net] disconnected', intentionalClose ? '(主动)' : '(意外)');
    stopHeartbeat();
    emitConn('closed', { intentional: intentionalClose });
    if (!intentionalClose && rcActive) {
      onReconnectClosed(); // 有界重连状态机接管（onclose 即一次失败尝试结束）
      return;
    }
    // ⚠ 这一支**当前不可达**：`shouldReconnect` 全仓只被赋 `false`（:18/:120/:264），没有置 true 的地方
    // ⇒ 重连实际只走上面 `rcActive` 那条（`startAutoReconnect`，见 `main.ts` 的 onConnState('closed')）。
    // 保留它是因为语义上仍然成立（3s 后单发重连一次），但**别以为它在保活**：真正常用的是有界重连。
    if (shouldReconnect && !intentionalClose) {
      reconnectTimer = setKeepaliveTimeout(_connect, 3000);
    }
  };
  ws.onerror = (e) => { console.error('[net] error', e); };
}

function connStateLabel(): string {
  if (!ws) return 'closed';
  return ws.readyState === WebSocket.CONNECTING ? 'connecting' : ws.readyState === WebSocket.OPEN ? 'open' : 'closed';
}

/** 断线/未连接时丢包：写入降级清单（检查器可见，AGENTS #12），避免"发了没发"无从分辨。 */
function dropReport(kind: string, detail: string): void {
  reportFallback('net-drop', `[${connStateLabel()}] ${kind} 丢弃：${detail}`);
}

export function send(msg: jpt.base.ClientMessage.$Properties): void {
  if (ws?.readyState !== WebSocket.OPEN) {
    const name = msg?.payload ? String(msg.payload) : '?';
    dropReport('C2S', `type=${name}`);
    return;
  }
  ws.send(encodeClient(msg));
}

function startHeartbeat(): void {
  stopHeartbeat();
  // 连接即发一次 ping，让时间同步立刻获得服务器权威时钟（不等首个4s周期）
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(encodeClient(ping()));
  }
  heartbeatTimer = setKeepaliveInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeClient(ping()));
    }
  }, HEARTBEAT_INTERVAL);
  
  // 4秒时间同步
  timeSyncTimer = setKeepaliveInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeClient(ping()));
    }
  }, TIME_SYNC_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearKeepaliveInterval(heartbeatTimer);
    heartbeatTimer = 0;
  }
  if (timeSyncTimer) {
    clearKeepaliveInterval(timeSyncTimer);
    timeSyncTimer = 0;
  }
}

export function sendJson(type: string, payload?: Record<string, unknown>): void {
  if (ws?.readyState !== WebSocket.OPEN) {
    dropReport('JSON', `type=${type}`);
    return;
  }
  ws.send(JSON.stringify({ type, ...payload }));
}

export function onMessage(handler: ProtoHandler): () => void {
  protoHandlers.push(handler);
  return () => { protoHandlers = protoHandlers.filter(h => h !== handler); }
}

export function onJsonMessage(handler: JsonHandler): () => void {
  jsonHandlers.push(handler);
  return () => { jsonHandlers = jsonHandlers.filter(h => h !== handler); }
}

export function onTimeSync(handler: TimeSyncHandler): () => void {
  timeSyncHandlers.push(handler);
  return () => { timeSyncHandlers = timeSyncHandlers.filter(h => h !== handler); }
}

export function disconnect(): void {
  shouldReconnect = false;
  intentionalClose = true;
  clearKeepaliveTimeout(reconnectTimer);
  stopHeartbeat();
  ws?.close();
  ws = null;
}

export function isConnected(): boolean {
  return ws?.readyState === WebSocket.OPEN;
}

let _token = '';
export function setToken(t: string): void { _token = t; }
export function getToken(): string { return _token; }
export function clearToken(): void { _token = ''; }
