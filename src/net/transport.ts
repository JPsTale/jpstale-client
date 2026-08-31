import { encodeClient, decodeServer, debugLog } from './protocol.js';
import type { jpt } from './proto/base_message.js';

type Handler = (msg: jpt.base.ServerMessage) => void;
let ws: WebSocket | null = null;
let handlers: Handler[] = [];
let url = '';
let reconnectTimer = 0;
let shouldReconnect = false;

export function connect(wsUrl: string): void {
  url = wsUrl;
  shouldReconnect = true;
  _connect();
}

function _connect(): void {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';
  ws.onopen = () => { console.log('[net] connected'); };
  ws.onmessage = (ev) => {
    try {
      const msg = decodeServer(ev.data as ArrayBuffer);
      debugLog(msg);
      for (const h of handlers) h(msg);
    } catch { console.warn('[net] bad message', ev.data); }
  };
  ws.onclose = () => {
    console.log('[net] disconnected');
    if (shouldReconnect) {
      reconnectTimer = window.setTimeout(_connect, 3000);
    }
  };
  ws.onerror = (e) => { console.error('[net] error', e); };
}

export function send(msg: jpt.base.ClientMessage.$Properties): void {
  if (ws?.readyState !== WebSocket.OPEN) { console.warn('[net] not connected'); return; }
  ws.send(encodeClient(msg));
}

export function onMessage(handler: Handler): () => void {
  handlers.push(handler);
  return () => { handlers = handlers.filter(h => h !== handler); };
}

export function disconnect(): void {
  shouldReconnect = false;
  clearTimeout(reconnectTimer);
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
