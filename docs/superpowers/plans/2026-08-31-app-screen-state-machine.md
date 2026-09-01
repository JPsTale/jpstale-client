# App Screen State Machine + Network + i18n Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the app-level screen state machine, protobuf-native WebSocket network layer, i18n system, and DOM overlay UI panels for the jpstale-web PristonTale client.

**Architecture:** Functional style (matching existing codebase). Factory functions return interface objects. No classes except where stateful lifecycle demands it. DOM overlay panels show/hide via CSS. WebSocket transport uses protobuf binary frames (generated from server's .proto files). i18n uses Minecraft-style nested JSON with runtime locale switching.

**Tech Stack:** TypeScript 5.5+ strict, Vite 8.2+, three.js 0.160+ (CharSelect3D preview only), protobufjs (proto codegen), native DOM + native WebSocket.

## Global Constraints

- TypeScript strict mode, ES2022 target, bundler module resolution
- No new UI dependencies — native DOM, native WebSocket
- ponytail mode: shortest working code, no abstractions beyond what's needed
- Existing `char-demo.html` + `src/char/char-demo.ts` stay untouched
- Existing map viewer (`src/main.ts`) moves to `src/maps/map-demo.ts` + `map-demo.html`
- `index.html` becomes the app entry, `src/main.ts` becomes the app bootstrap
- Proto files live at `jpstale-server/pt-common/src/main/proto/base/` — client generates TS types from them
- Server modifies WebSocket pipeline to accept binary protobuf frames alongside existing JSON

---

## File Structure (New/Modified)

```
jpstale-web/
  src/
    net/
      proto/            # GENERATED — do not edit manually
        base_common.ts  # Generated from common.proto
        base_message.ts # Generated from message.proto
      transport.ts      # WebSocket: binary protobuf frames
      protocol.ts       # Re-exports generated types + helper functions
    app/
      State.ts          # AppScreen enum + transition()
      Game.ts           # Main loop RAF (WORLD only, future)
    ui/
      LoginPanel.ts     # Login form (DOM)
      ServerSelect.ts   # Server list (DOM)
      CharSelect.ts     # Character list + creation wizard + 3D preview
      Hud.ts            # In-game HUD (placeholder)
    i18n/
      index.ts          # t() + setLocale()
  locales/
    zh.json             # Chinese
    en.json             # English (placeholder)
  proto/                # Copies of server .proto files (for codegen)
    base/
      common.proto
      message.proto
  scripts/
    gen-proto.ts        # Proto codegen script

jpstale-server/
  pt-game-server/
    src/.../network/
      WebSocketServer.java        # Modified: add ProtobufFrameHandler
      ProtobufFrameHandler.java   # NEW: binary frame → proto → PacketRouter
```

---

## Task 1: Relocate Map Viewer Entry

Move the existing map viewer to a dedicated entry so `index.html` + `main.ts` are free for the app.

**Files:**
- Create: `map-demo.html`
- Create: `src/maps/map-demo.ts` (content from current `src/main.ts`)
- Modify: `index.html` (replace with app shell)
- Modify: `src/main.ts` (replace with app bootstrap — implemented in Task 11)
- Modify: `vite.config.ts` (add `map-demo.html` to rollupOptions)

- [ ] **Step 1: Create `map-demo.html`**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Map Viewer</title>
  <style>html,body{margin:0;padding:0;overflow:hidden;background:#000}</style>
</head>
<body>
  <canvas id="c"></canvas>
  <script type="module" src="/src/maps/map-demo.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Create `src/maps/map-demo.ts`**

Move the entire content of current `src/main.ts` here verbatim. No logic changes.

- [ ] **Step 3: Update `vite.config.ts`**

Add `map-demo.html` to `rollupOptions.input` alongside `index.html` and `char-demo.html`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit`
Run: `npx vite` — visit `/map-demo.html` → map viewer works; visit `/char-demo.html` → char viewer works.

- [ ] **Step 5: Commit**

```bash
git add index.html map-demo.html src/main.ts src/maps/map-demo.ts vite.config.ts
git commit -m "chore: relocate map viewer to map-demo entry"
```

---

## Task 2: Proto Codegen Setup

Copy proto files from server and set up TypeScript code generation.

**Files:**
- Create: `proto/base/common.proto` (copy from server)
- Create: `proto/base/message.proto` (copy from server)
- Create: `scripts/gen-proto.ts` (codegen script)
- Modify: `package.json` (add protobufjs dev dep + gen script)
- Modify: `.gitignore` (ignore generated files)

**Interfaces:**
- Produces: `src/net/proto/base_common.ts`, `src/net/proto/base_message.ts`

- [ ] **Step 1: Install protobufjs**

```bash
npm install --save-dev protobufjs
```

- [ ] **Step 2: Copy proto files**

```bash
mkdir -p proto/base
copy E:\JPsTale\jpstale-server\pt-common\src\main\proto\base\common.proto proto\base\
copy E:\JPsTale\jpstale-server\pt-common\src\main\proto\base\message.proto proto\base\
```

- [ ] **Step 3: Create `scripts/gen-proto.ts`**

```ts
import { execSync } from 'child.js';
import { mkdirSync, existsSync } from 'fs.js';
import { resolve } from 'path.js';

const protoRoot = resolve('proto');
const outDir = resolve('src/net/proto');

if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Generate JS + TS definitions from .proto files
execSync(
  `npx pbjs -t static-module -w commonjs -o "${outDir}/base_message.js" "${protoRoot}/base/message.proto" "${protoRoot}/base/common.proto"`,
  { stdio: 'inherit' }
);
execSync(
  `npx pbts -o "${outDir}/base_message.d.ts" "${outDir}/base_message.js"`,
  { stdio: 'inherit' }
);

// Also generate common.proto separately if needed
execSync(
  `npx pbjs -t static-module -w commonjs -o "${outDir}/base_common.js" "${protoRoot}/base/common.proto"`,
  { stdio: 'inherit' }
);
execSync(
  `npx pbts -o "${outDir}/base_common.d.ts" "${outDir}/base_common.js"`,
  { stdio: 'inherit' }
);

console.log('Proto generation complete.');
```

- [ ] **Step 4: Add npm script to `package.json`**

```json
"scripts": {
  "dev": "vite",
  "build": "tsc --noEmit && vite build",
  "preview": "vite preview",
  "proto": "npx tsx scripts/gen-proto.ts"
}
```

- [ ] **Step 5: Run codegen**

```bash
npm run proto
```

Verify `src/net/proto/base_message.js`, `src/net/proto/base_message.d.ts` are created.

- [ ] **Step 6: Update `.gitignore`**

Add: `src/net/proto/base_*.js` (generated JS, only .d.ts needed for type safety)

- [ ] **Step 7: Commit**

```bash
git add proto/ scripts/ package.json package-lock.json .gitignore src/net/proto/*.d.ts
git commit -m "feat: add proto codegen from server .proto definitions"
```

---

## Task 3: Protocol Types

Type-safe wrappers around generated proto types.

**Files:**
- Create: `src/net/protocol.ts`

**Interfaces:**
- Consumes: Generated types from `src/net/proto/base_message.ts`
- Produces: Convenience functions for creating and reading proto messages

- [ ] **Step 1: Create `src/net/protocol.ts`**

```ts
import * as pb from './proto/base_message.js';
import { ClientMessage, ServerMessage, C2S_LoginRequest, C2S_CreateCharacter, C2S_SelectCharacter, S2C_LoginResponse, S2C_CharacterList, S2C_CreateCharacterResult, S2C_PlayerState, S2C_Error } from './proto/base_message.js';

export { ClientMessage, ServerMessage, C2S_LoginRequest, C2S_CreateCharacter, C2S_SelectCharacter, S2C_LoginResponse, S2C_CharacterList, S2C_CreateCharacterResult, S2C_PlayerState, S2C_Error };
export type { } from './proto/base_message.js';

// ── Client message builders ───────────────────────────

export function loginRequest(username: string, password: string): ClientMessage {
  return ClientMessage.create({
    loginRequest: C2S_LoginRequest.create({ username, password })
  });
}

export function createCharacter(name: string, classId: number): ClientMessage {
  return ClientMessage.create({
    createCharacter: C2S_CreateCharacter.create({ name, classId })
  });
}

export function selectCharacter(characterId: number): ClientMessage {
  return ClientMessage.create({
    selectCharacter: C2S_SelectCharacter.create({ characterId })
  });
}

export function backToCharacterSelect(): ClientMessage {
  return ClientMessage.create({ backToCharacterSelect: {} });
}

// ── Server message reader ─────────────────────────────

export function decodeServer(data: ArrayBuffer): ServerMessage {
  return ServerMessage.decode(new Uint8Array(data));
}

export function encodeClient(msg: ClientMessage): ArrayBuffer {
  return ClientMessage.encode(msg).finish().buffer as ArrayBuffer;
}

/** Debug: log decoded message to console */
export function debugLog(msg: ServerMessage): void {
  console.log('[proto]', JSON.stringify(msg, null, 2));
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/net/protocol.ts
git commit -m "feat: add protocol type wrappers for auth/game messages"
```

---

## Task 4: App State Machine

Define the `AppScreen` enum and `transition()` function.

**Files:**
- Create: `src/app/State.ts`

**Interfaces:**
- Produces: `AppScreen` enum, `transition(from, to, ctx)`, `getScreen()`

- [ ] **Step 1: Create `src/app/State.ts`**

```ts
import type { ServerInfo, CharacterInfo, S2C_PlayerState } from '../net/protocol.js';

export enum AppScreen {
  BOOT = 'BOOT',
  LOGIN = 'LOGIN',
  SERVER_SELECT = 'SERVER_SELECT',
  CHAR_SELECT = 'CHAR_SELECT',
  WORLD = 'WORLD',
}

export interface TransitionCtx {
  showBoot: () => void;
  showLogin: (error?: string) => void;
  showServerSelect: (servers: ServerInfo[]) => void;
  showCharSelect: (characters: CharacterInfo[]) => void;
  showWorld: (playerState: S2C_PlayerState) => void;
  hideAll: () => void;
}

let _screen: AppScreen = AppScreen.BOOT;
export function getScreen(): AppScreen { return _screen; }

const VALID: Record<string, string[]> = {
  [AppScreen.BOOT]:          [AppScreen.LOGIN],
  [AppScreen.LOGIN]:         [AppScreen.SERVER_SELECT],
  [AppScreen.SERVER_SELECT]: [AppScreen.CHAR_SELECT],
  [AppScreen.CHAR_SELECT]:   [AppScreen.WORLD, AppScreen.LOGIN],
  [AppScreen.WORLD]:         [AppScreen.CHAR_SELECT, AppScreen.LOGIN],
};

export function transition(from: AppScreen, to: AppScreen, ctx: TransitionCtx): void {
  if (!VALID[from]?.includes(to)) {
    console.warn(`[app] illegal transition ${from} → ${to}`);
    return;
  }
  _screen = to;
  ctx.hideAll();
  switch (to) {
    case AppScreen.BOOT:          ctx.showBoot(); break;
    case AppScreen.LOGIN:         ctx.showLogin(); break;
    case AppScreen.SERVER_SELECT: break;
    case AppScreen.CHAR_SELECT:   break;
    case AppScreen.WORLD:         break;
  }
}
```

> Note: This imports proto-generated types. If proto isn't generated yet, stub the types temporarily. Task 2 must complete before this compiles.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors (after proto generated).

- [ ] **Step 3: Commit**

```bash
git add src/app/State.ts
git commit -m "feat: add AppScreen enum and transition function"
```

---

## Task 5: Transport Layer

WebSocket connection using protobuf binary frames.

**Files:**
- Create: `src/net/transport.ts`

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage`, `encodeClient`, `decodeServer`, `debugLog` from `protocol.ts`
- Produces: `connect(url)`, `send(msg: ClientMessage)`, `onMessage(handler)`, `disconnect()`, `isConnected()`

- [ ] **Step 1: Create `src/net/transport.ts`**

```ts
import { ClientMessage, ServerMessage, encodeClient, decodeServer, debugLog } from './protocol.js';

type Handler = (msg: ServerMessage) => void;
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

export function send(msg: ClientMessage): void {
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

// ── Token reconnection ────────────────────────────────
let _token = '';
export function setToken(t: string): void { _token = t; }
export function getToken(): string { return _token; }
export function clearToken(): void { _token = ''; }
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/net/transport.ts
git commit -m "feat: add WebSocket transport with protobuf binary frames"
```

---

## Task 6: i18n — Locale Files

Create the pure JSON locale files and the translation function.

**Files:**
- Create: `src/locales/zh.json`
- Create: `src/locales/en.json`
- Create: `src/i18n/index.ts`

**Interfaces:**
- Produces: `t(key, params?) → string`, `setLocale(loc)`, `getLocale()`

- [ ] **Step 1: Create `src/locales/zh.json`**

```json
{
  "gui": {
    "login": {
      "title": "登录",
      "username": "账号",
      "password": "密码",
      "submit": "登录"
    },
    "server": {
      "title": "选择服务器",
      "online": "{count} 人在线"
    },
    "charSel": {
      "title": "角色选择",
      "create": "创建角色",
      "enter": "进入游戏",
      "logout": "换账号",
      "level": "Lv.{level}"
    },
    "charCreate": {
      "race": "选择种族",
      "job": "选择职业",
      "face": "选择脸型",
      "name": "输入角色名",
      "back": "返回",
      "confirm": "确认",
      "create": "创建"
    }
  },
  "race": {
    "tempscron": "坦普族",
    "moryon": "魔灵族"
  },
  "job": {
    "fighter": "武士",
    "mechanician": "机械兵",
    "archer": "弓箭手",
    "pikeman": "枪兵",
    "assassin": "刺客",
    "knight": "骑士",
    "atalanta": "魔枪兵",
    "priestess": "祭司",
    "magician": "法师",
    "shaman": "萨满"
  },
  "error": {
    "0": "连接失败",
    "1": "未知错误",
    "2": "未登录",
    "3": "已登录",
    "4": "密码错误",
    "5": "账号封禁",
    "6": "角色不存在",
    "7": "角色数量上限",
    "8": "无效地图",
    "9": "位置无效",
    "10": "加速作弊",
    "11": "传送作弊",
    "12": "无敌作弊",
    "13": "无效角色名",
    "14": "角色名已存在"
  }
}
```

- [ ] **Step 2: Create `src/locales/en.json`**

```json
{
  "gui": {
    "login": { "title": "Login", "username": "Account", "password": "Password", "submit": "Login" },
    "server": { "title": "Select Server", "online": "{count} online" },
    "charSel": { "title": "Character Select", "create": "Create", "enter": "Enter Game", "logout": "Switch Account", "level": "Lv.{level}" },
    "charCreate": { "race": "Select Race", "job": "Select Job", "face": "Select Face", "name": "Enter Name", "back": "Back", "confirm": "Confirm", "create": "Create" }
  },
  "race": { "tempscron": "Tempscron", "moryon": "Moryon" },
  "job": { "fighter": "Fighter", "mechanician": "Mechanician", "archer": "Archer", "pikeman": "Pikeman", "assassin": "Assassin", "knight": "Knight", "atalanta": "Atalanta", "priestess": "Priestess", "magician": "Magician", "shaman": "Shaman" },
  "error": { "0": "Connection failed", "1": "Unknown error", "2": "Not logged in", "3": "Already logged in", "4": "Wrong password", "5": "Account banned", "6": "Character not found", "7": "Character limit reached", "8": "Invalid map", "9": "Invalid position", "10": "Speed hack", "11": "Teleport hack", "12": "Invincible hack", "13": "Invalid name", "14": "Name already exists" }
}
```

- [ ] **Step 3: Create `src/i18n/index.ts`**

```ts
import zh from '../locales/zh.json';
import en from '../locales/en.json';

const locales: Record<string, typeof zh> = { zh, en };
let locale = localStorage.getItem('locale')
  ?? (navigator.language.startsWith('zh') ? 'zh' : 'en');

export function t(key: string, params?: Record<string, string | number>): string {
  const parts = key.split('.');
  let val: unknown = locales[locale] ?? locales['zh'];
  for (const p of parts) {
    if (val && typeof val === 'object') val = (val as Record<string, unknown>)[p];
    else { val = undefined; break; }
  }
  let msg = typeof val === 'string' ? val : key;
  if (params) {
    for (const [k, v] of Object.entries(params)) msg = msg.replace(`{${k}}`, String(v));
  }
  return msg;
}

export function setLocale(loc: string): void {
  locale = loc;
  localStorage.setItem('locale', loc);
}

export function getLocale(): string { return locale; }
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 5: Commit**

```bash
git add src/locales/ src/i18n/
git commit -m "feat: add i18n with zh/en JSON locales and runtime switching"
```

---

## Task 7: LoginPanel

DOM overlay for login form.

**Files:**
- Create: `src/ui/LoginPanel.ts`

**Interfaces:**
- Consumes: `t()` from i18n
- Produces: `createLoginPanel(container, opts) → { show(error?), hide(), destroy() }`

- [ ] **Step 1: Create `src/ui/LoginPanel.ts`**

```ts
import { t } from '../i18n/index.js';

export interface LoginPanel {
  show(error?: string): void;
  hide(): void;
  destroy(): void;
}

export function createLoginPanel(container: HTMLElement, opts: {
  onLogin: (username: string, password: string) => void;
}): LoginPanel {
  const el = document.createElement('div');
  el.className = 'panel login-panel';
  el.style.cssText = 'display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:rgba(0,0,0,0.85);color:#fff;font-size:14px';
  el.innerHTML = `
    <h2>${t('gui.login.title')}</h2>
    <div class="error" style="color:red;min-height:1.2em"></div>
    <input type="text" placeholder="${t('gui.login.username')}" autocomplete="username" />
    <input type="password" placeholder="${t('gui.login.password')}" autocomplete="current-password" />
    <button>${t('gui.login.submit')}</button>
  `;
  el.querySelectorAll('input').forEach(i => i.style.cssText = 'padding:6px 12px;width:240px;font-size:14px');
  el.querySelector('button')!.style.cssText = 'padding:6px 24px;font-size:14px;cursor:pointer';

  const errEl = el.querySelector('.error')!;
  const inputs = el.querySelectorAll('input');
  const usernameInput = inputs[0];
  const passwordInput = inputs[1];

  el.querySelector('button')!.onclick = () => {
    opts.onLogin(usernameInput.value.trim(), passwordInput.value);
  };

  passwordInput.onkeydown = (e) => {
    if (e.key === 'Enter') opts.onLogin(usernameInput.value.trim(), passwordInput.value);
  };

  container.appendChild(el);

  return {
    show(error?: string) {
      el.style.display = 'flex';
      errEl.textContent = error ? t(`error.${error}`) ?? error : '';
      usernameInput.focus();
    },
    hide() { el.style.display = 'none'; },
    destroy() { el.remove(); },
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/LoginPanel.ts
git commit -m "feat: add LoginPanel DOM overlay"
```

---

## Task 8: ServerSelect

DOM overlay for server list.

**Files:**
- Create: `src/ui/ServerSelect.ts`

**Interfaces:**
- Consumes: `t()` from i18n
- Produces: `createServerSelect(container) → { show(servers, onSelect), hide(), destroy() }`

- [ ] **Step 1: Create `src/ui/ServerSelect.ts`**

```ts
import { t } from '../i18n/index.js';

export interface ServerInfo { id: number; name: string; online: number; }

export interface ServerSelect {
  show(servers: ServerInfo[], onSelect: (serverId: number) => void): void;
  hide(): void;
  destroy(): void;
}

export function createServerSelect(container: HTMLElement): ServerSelect {
  const el = document.createElement('div');
  el.className = 'panel server-select';
  el.style.cssText = 'display:none;position:absolute;inset:0;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(0,0,0,0.85);color:#fff;font-size:14px';
  container.appendChild(el);

  return {
    show(servers, onSelect) {
      el.innerHTML = `<h2>${t('gui.server.title')}</h2>`;
      const list = document.createElement('div');
      list.style.cssText = 'display:flex;flex-direction:column;gap:8px';
      for (const s of servers) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:12px;padding:8px 16px;background:#222;border-radius:4px;cursor:pointer;min-width:300px';
        row.innerHTML = `<span style="flex:1">${s.name}</span><span style="color:#888">${t('gui.server.online', { count: s.online })}</span>`;
        row.onclick = () => onSelect(s.id);
        list.appendChild(row);
      }
      el.appendChild(list);
      el.style.display = 'flex';
    },
    hide() { el.style.display = 'none'; },
    destroy() { el.remove(); },
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/ServerSelect.ts
git commit -m "feat: add ServerSelect DOM overlay"
```

---

## Task 9: Hud Placeholder

Minimal HUD for WORLD state.

**Files:**
- Create: `src/ui/Hud.ts`

**Interfaces:**
- Consumes: `S2C_PlayerState` from protocol
- Produces: `createHud(container) → { show(state), hide(), destroy() }`

- [ ] **Step 1: Create `src/ui/Hud.ts`**

```ts
import type { S2C_PlayerState } from '../net/protocol.js';

export interface Hud {
  show(state: S2C_PlayerState): void;
  hide(): void;
  destroy(): void;
}

export function createHud(container: HTMLElement): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.style.cssText = 'display:none;position:absolute;top:8px;left:8px;color:#fff;font:12px monospace;text-shadow:1px 1px 2px #000';
  container.appendChild(el);

  return {
    show(state) {
      el.innerHTML = `HP ${state.hp}/${state.maxHp} | MP ${state.mp}/${state.maxMp} | Lv.${state.level}`;
      el.style.display = 'block';
    },
    hide() { el.style.display = 'none'; },
    destroy() { el.remove(); },
  };
}
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/Hud.ts
git commit -m "feat: add Hud placeholder"
```

---

## Task 10: CharSelect

Character selection list + creation wizard +3D preview. The most complex UI panel.

**Files:**
- Create: `src/ui/CharSelect.ts`

**Interfaces:**
- Consumes: `t()` from i18n, `loadCharacterModel` from char-loader, `JOB_DATA` from char-loader
- Produces: `createCharSelect(container) → { show(characters, opts), hide(), destroy() }`

- [ ] **Step 1: Create `src/ui/CharSelect.ts`**

DOM overlay + three.js3D preview. Contains:
- Character list mode (show existing characters, select/create/logout)
- 4-step creation wizard (race → job → face → name)
- Lazy three.js scene for3D preview (created on first wizard entry, reused)
- `loadCharacterModel()` call on job/face changes
- `requestAnimationFrame` loop for preview animation
- Back button per step

This is the largest single file. Implementation reuses:
- `src/render/char-loader.ts`: `loadCharacterModel(jobId, faceNum, tier, armorNum)`
- `src/char/animation.ts`: `evalSkeleton()`, `applyToBones()`
- `src/char/anim-state-machine.ts`: `createAnimStateMachine()`
- `src/char/anim-match.ts`: `findMotions()`, `pickMotion()`

Full code is significant — kept self-contained within this single file.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` — no errors.

- [ ] **Step 3: Commit**

```bash
git add src/ui/CharSelect.ts
git commit -m "feat: add CharSelect with list mode, creation wizard, and 3D preview"
```

---

## Task 11: Main Entry + App Shell

Wire everything together. Create the app entry point and HTML file.

**Files:**
- Modify: `index.html` (app shell)
- Modify: `src/main.ts` (app bootstrap)
- Modify: `vite.config.ts` (verify multi-page entries)

**Interfaces:**
- Consumes: All panels, transport, protocol, state machine, i18n
- Produces: Running application

- [ ] **Step 1: Rewrite `index.html` as app shell**

```html
<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>JPsTale</title>
  <style>
    html, body { margin: 0; padding: 0; overflow: hidden; background: #000; font-family: sans-serif; }
    #app { width: 100vw; height: 100vh; position: relative; }
    canvas { display: block; }
    .panel { box-sizing: border-box; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
```

- [ ] **Step 2: Rewrite `src/main.ts` as app bootstrap**

```ts
import { AppScreen, transition, type TransitionCtx } from './app/State.js';
import { connect, send, onMessage, setToken, clearToken } from './net/transport.js';
import { loginRequest, createCharacter, selectCharacter } from './net/protocol.js';
import type { S2C_LoginResponse, S2C_CharacterList, S2C_CreateCharacterResult, S2C_PlayerState } from './net/protocol.js';
import { createLoginPanel } from './ui/LoginPanel.js';
import { createServerSelect, type ServerInfo } from './ui/ServerSelect.js';
import { createCharSelect } from './ui/CharSelect.js';
import { createHud } from './ui/Hud.js';

const app = document.getElementById('app')!;

const loginPanel = createLoginPanel(app, { onLogin });
const serverSelect = createServerSelect(app);
const charSelect = createCharSelect(app);
const hud = createHud(app);

const allPanels = [loginPanel, serverSelect, charSelect, hud];

// ── State context ─────────────────────────────────────
let _servers: ServerInfo[] = [];

const ctx: TransitionCtx = {
  showBoot() { /* loading indicator — future */ },
  showLogin(error?: string) { loginPanel.show(error); },
  showServerSelect(servers) { _servers = servers; serverSelect.show(servers, onSelectServer); },
  showCharSelect(characters) { charSelect.show(characters, { onSelect: onSelectCharacter, onCreate: onCreateCharacter, onLogout }); },
  showWorld(state) { hud.show(state); },
  hideAll() { allPanels.forEach(p => p.hide()); },
};

// ── Boot ──────────────────────────────────────────────
const wsUrl = import.meta.env.VITE_GAME_WS_URL || `ws://${location.hostname}:10007/ws`;
connect(wsUrl);

onMessage((msg) => {
  if (msg.loginResponse) handleLoginResult(msg.loginResponse);
  else if (msg.characterList) handleCharacterList(msg.characterList);
  else if (msg.createCharacterResult) handleCreateResult(msg.createCharacterResult);
  else if (msg.playerState) handlePlayerState(msg.playerState);
  else if (msg.error) console.warn('[server] error:', msg.error);
});

transition(AppScreen.BOOT, AppScreen.LOGIN, ctx);

// ── Handlers ──────────────────────────────────────────
function onLogin(username: string, password: string) {
  send(loginRequest(username, password));
}

function handleLoginResult(data: S2C_LoginResponse) {
  if (!data.success) {
    loginPanel.show(String(data.errorCode ?? 0));
    return;
  }
  transition(AppScreen.LOGIN, AppScreen.SERVER_SELECT, ctx);
  // Server list is handled by web-only JSON path — need proto equivalent
  // For now: send a placeholder; server task will add proto serverList
  ctx.showServerSelect(_servers);
}

function onSelectServer(serverId: number) {
  // Server selection is web-only — need proto equivalent
  // For now: directly request character list
  transition(AppScreen.SERVER_SELECT, AppScreen.CHAR_SELECT, ctx);
  // Server will send characterList after selectServer
}

function handleCharacterList(data: S2C_CharacterList) {
  ctx.showCharSelect(data.characters);
}

function onCreateCharacter() {
  // Handled internally by CharSelect wizard
}

function handleCreateResult(data: S2C_CreateCharacterResult) {
  if (!data.success) {
    console.warn('create failed', data.errorCode);
    return;
  }
  // Refresh character list
}

function onSelectCharacter(characterId: number) {
  send(selectCharacter(characterId));
}

function handlePlayerState(data: S2C_PlayerState) {
  transition(AppScreen.CHAR_SELECT, AppScreen.WORLD, ctx);
  ctx.showWorld(data);
}

function onLogout() {
  clearToken();
  transition(AppScreen.CHAR_SELECT, AppScreen.LOGIN, ctx);
}
```

- [ ] **Step 3: Verify multi-page config in `vite.config.ts`**

Ensure `rollupOptions.input` includes `index.html`, `char-demo.html`, and `map-demo.html`.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — no errors.
Run: `npx vite` — visit `/` → login panel appears; `/map-demo.html` → map viewer; `/char-demo.html` → char viewer.

- [ ] **Step 5: Commit**

```bash
git add index.html src/main.ts vite.config.ts
git commit -m "feat: wire app entry with all panels, transport, and state machine"
```

---

## Task 12: Server — Port 10007 WebSocket + Protobuf

Convert port 10007 from raw TCP protobuf to WebSocket protobuf. Port 10008 stays untouched (JSON for spawn-debug).

**Files:**
- Modify: `NettyServer.java` (pipeline: TCP → WebSocket + protobuf binary)

**Interfaces:**
- Consumes: `ClientMessage`, `ServerMessage` from generated Java protobuf classes
- Produces: WebSocket endpoint on port 10007 accepting binary protobuf frames

**Note:** This task modifies the Java server. It's independent of client tasks and can be done in parallel.

**Current pipeline (port 10007):**
```
LengthFieldBasedFrameDecoder → ProtobufDecoder → ProtobufEncoder → PacketRouterHandler
```

**New pipeline (port 10007):**
```
HttpServerCodec → HttpObjectAggregator → WebSocketServerProtocolHandler("/ws")
  → ProtobufFrameHandler (BinaryWebSocketFrame → ClientMessage)
  → ProtobufFrameOutHandler (ServerMessage → BinaryWebSocketFrame)
  → PacketRouterHandler
```

- [ ] **Step 1: Read current `NettyServer.java`**

Read `pt-game-server/src/main/java/.../network/NettyServer.java` to understand the current TCP pipeline setup.

- [ ] **Step 2: Create `ProtobufFrameHandler.java`**

```java
package org.jpstale.server.game.network;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.SimpleChannelInboundHandler;
import io.netty.handler.codec.http.websocketx.BinaryWebSocketFrame;
import org.jpstale.server.proto.base.MessageProto;

/**
 * Decodes BinaryWebSocketFrame → ClientMessage, fires to PacketRouter.
 * Port 10007: pure protobuf WebSocket (no JSON translation).
 */
public class ProtobufFrameHandler extends SimpleChannelInboundHandler<BinaryWebSocketFrame> {

    @Override
    protected void channelRead0(ChannelHandlerContext ctx, BinaryWebSocketFrame frame) throws Exception {
        MessageProto.ClientMessage msg = MessageProto.ClientMessage.parseFrom(frame.content());
        ctx.fireChannelRead(msg);
    }

    @Override
    public void exceptionCaught(ChannelHandlerContext ctx, Throwable cause) {
        System.err.println("[WS-Proto] error: " + cause.getMessage());
        ctx.close();
    }
}
```

- [ ] **Step 3: Create `ProtobufFrameOutHandler.java`**

```java
package org.jpstale.server.game.network;

import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelOutboundHandlerAdapter;
import io.netty.channel.ChannelPromise;
import io.netty.handler.codec.http.websocketx.BinaryWebSocketFrame;
import io.netty.buffer.Unpooled;
import org.jpstale.server.proto.base.MessageProto;

/**
 * Encodes ServerMessage → BinaryWebSocketFrame.
 */
public class ProtobufFrameOutHandler extends ChannelOutboundHandlerAdapter {

    @Override
    public void write(ChannelHandlerContext ctx, Object msg, ChannelPromise promise) throws Exception {
        if (msg instanceof MessageProto.ServerMessage serverMsg) {
            byte[] bytes = serverMsg.toByteArray();
            ctx.write(new BinaryWebSocketFrame(Unpooled.wrappedBuffer(bytes)), promise);
        } else {
            ctx.write(msg, promise);
        }
    }
}
```

- [ ] **Step 4: Modify `NettyServer.java` pipeline**

Replace the TCP pipeline with WebSocket + protobuf:

```java
// Before (TCP):
.group(bossGroup, workerGroup)
.channel(NioServerSocketChannel)
.childHandler(new ChannelInitializer<SocketChannel>() {
    @Override
    protected void initChannel(SocketChannel ch) {
        ch.pipeline()
          .addLast(new LengthFieldBasedFrameDecoder(...))
          .addLast(new ProtobufDecoder(...))
          .addLast(new ProtobufEncoder())
          .addLast(new PacketRouterHandler());
    }
});

// After (WebSocket):
.group(bossGroup, workerGroup)
.channel(NioServerSocketChannel)
.childHandler(new ChannelInitializer<SocketChannel>() {
    @Override
    protected void initChannel(SocketChannel ch) {
        ch.pipeline()
          .addLast(new HttpServerCodec())
          .addLast(new HttpObjectAggregator(65536))
          .addLast(new WebSocketServerProtocolHandler("/ws"))
          .addLast(new ProtobufFrameHandler())
          .addLast(new ProtobufFrameOutHandler())
          .addLast(new PacketRouterHandler());
    }
});
```

- [ ] **Step 5: Verify**

Build server: `mvn compile -pl pt-game-server`
Start server, connect browser to `ws://localhost:10007/ws`, send binary frame → verify PacketRouter receives it.

- [ ] **Step 6: Commit**

```bash
git add pt-game-server/src/main/java/.../network/NettyServer.java
git add pt-game-server/src/main/java/.../network/ProtobufFrameHandler.java
git add pt-game-server/src/main/java/.../network/ProtobufFrameOutHandler.java
git commit -m "feat: convert port 10007 from TCP to WebSocket + protobuf"
```

---

## Task 13: Final Verification

Full end-to-end verification.

- [ ] **Step 1: Full TypeScript check**

Run: `npx tsc --noEmit` — must pass.

- [ ] **Step 2: Full build**

Run: `npx vite build` — must pass.

- [ ] **Step 3: Build server**

Run: `mvn compile -pl pt-game-server` — must pass.

- [ ] **Step 4: Manual smoke test**

1. Start server: run pt-game-server
2. Start client: `npx vite`
3. Visit `/` → login panel shows
4. Enter credentials → protobuf binary frame sent → login response received
5. Visit `/map-demo.html` → map viewer works
6. Visit `/char-demo.html` → char viewer works

- [ ] **Step 5: Commit final state**

```bash
git add -A
git commit -m "chore: final verification and cleanup"
```
