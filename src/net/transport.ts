import { encodeClient, decodeServer, debugLog, ping } from './protocol.js';
import type { jpt } from './proto/base_message.js';

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

/** 有界自动重连：最多 total 次，间隔 delayMs。断线后由调用方触发。 */
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
  clearTimeout(rcTimer);
  rcTimer = window.setTimeout(() => {
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
  clearTimeout(rcTimer);
  emitReconnect({ phase: 'success', attempt: rcAttempt, total: rcTotal });
}

function onReconnectClosed(): void {
  if (!rcActive) return;
  if (rcSuccessOpen) return; // 已成功过（onopen 关闭了状态机）
  if (rcAttempt >= rcTotal) {
    rcActive = false;
    clearTimeout(rcTimer);
    emitReconnect({ phase: 'failed', attempt: rcAttempt, total: rcTotal });
  } else {
    scheduleReconnectAttempt(2000);
  }
}

export function stopAutoReconnect(): void {
  rcActive = false;
  clearTimeout(rcTimer);
}

const HEARTBEAT_INTERVAL = 20000; // 每 20s 发一次 ping（服务端 60s 读空闲超时）
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
        debugLog(msg);
        // 处理pong响应中的服务器时间
        if (msg.pong) {
          const serverTimeMs = Number(msg.pong.timestamp);
          for (const h of timeSyncHandlers) h(serverTimeMs);
        }
        for (const h of protoHandlers) h(msg);
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
    if (shouldReconnect && !intentionalClose) {
      reconnectTimer = window.setTimeout(_connect, 3000);
    }
  };
  ws.onerror = (e) => { console.error('[net] error', e); };
}

export function send(msg: jpt.base.ClientMessage.$Properties): void {
  if (ws?.readyState !== WebSocket.OPEN) { console.warn('[net] not connected'); return; }
  ws.send(encodeClient(msg));
}

function startHeartbeat(): void {
  stopHeartbeat();
  // 连接即发一次 ping，让时间同步立刻获得服务器权威时钟（不等首个4s周期）
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(encodeClient(ping()));
  }
  heartbeatTimer = window.setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeClient(ping()));
    }
  }, HEARTBEAT_INTERVAL);
  
  // 4秒时间同步
  timeSyncTimer = window.setInterval(() => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(encodeClient(ping()));
    }
  }, TIME_SYNC_INTERVAL);
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = 0;
  }
  if (timeSyncTimer) {
    clearInterval(timeSyncTimer);
    timeSyncTimer = 0;
  }
}

export function sendJson(type: string, payload?: Record<string, unknown>): void {
  if (ws?.readyState !== WebSocket.OPEN) { console.warn('[net] not connected'); return; }
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
  clearTimeout(reconnectTimer);
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
