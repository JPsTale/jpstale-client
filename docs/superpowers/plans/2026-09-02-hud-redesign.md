# HUD 重设计实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 忠实还原原版PT HUD到1280×720画布，实现昼夜循环系统和可配置键位

**Architecture:** 重写Hud.ts为1280×720基准的Canvas 2D渲染器，通过CSS缩放适配不同屏幕。新增GameClock模块处理服务端对时和昼夜状态。新增KeyBinding模块管理可配置键位。

**Tech Stack:** TypeScript, Canvas 2D, CSS transforms, localStorage, WebSocket (现有协议)

## Global Constraints

- 全程中文回复
- 所有UI元素坐标基于1280×720设计基准
- 纹理路径使用 `/res/image/sinimage/inter/` 前缀
- 保持现有代码风格（无框架，纯DOM + Canvas）
- 每个任务完成后运行 `npm run build` 验证编译通过

---

## 文件结构

### 新建文件
| 文件 | 职责 |
|------|------|
| `src/ui/Hud.ts` | 重写：1280×720 HUD Canvas渲染器 |
| `src/ui/GameClock.ts` | 游戏时钟：时间同步、昼夜状态、本地推进 |
| `src/ui/KeyBinding.ts` | 键位管理：存储、读取、设置面板 |
| `src/ui/Minimap.ts` | 小地图渲染（128×128） |

### 修改文件
| 文件 | 修改内容 |
|------|----------|
| `src/main.ts` | 集成新Hud、GameClock、KeyBinding |
| `src/net/protocol.ts` | 添加时间同步消息类型 |
| `src/net/transport.ts` | 添加4秒心跳对时 |
| `src/render/map-renderer.ts` | 接收昼夜状态，调整光照 |

---

## Task 1: 重写Hud.ts — 1280×720画布 + CSS缩放

**Files:**
- Rewrite: `src/ui/Hud.ts`
- Modify: `src/main.ts:180-220` (WORLD case)

**Interfaces:**
- Consumes: `decodeTextureAsync` from `core/texture.ts`
- Produces: `createHud(container): Hud`, `Hud` interface with `show(state)`, `hide()`, `dispose()`

- [ ] **Step 1: 创建新的Hud.ts骨架**

```typescript
// src/ui/Hud.ts
import { decodeTextureAsync } from '../core/texture.ts'

export interface HudState {
  hp: number; maxHp: number
  mp: number; maxMp: number
  stm: number; maxStm: number
  exp: number; maxExp: number
  level: number
  playerName: string
}

export interface Hud {
  show(state: HudState): void
  hide(): void
  dispose(): void
}

const W = 1280
const H = 720

export function createHud(container: HTMLElement): Hud {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'none'
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')!
  let currentState: HudState | null = null
  let textures: Map<string, HTMLImageElement> = new Map()
  let rafId = 0

  function fitCanvas() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H)
    canvas.style.width = `${W * scale}px`
    canvas.style.height = `${H * scale}px`
    canvas.style.left = `${(window.innerWidth - W * scale) / 2}px`
    canvas.style.top = `${(window.innerHeight - H * scale) / 2}px`
  }

  async function loadTexture(name: string, path: string) {
    const tex = await decodeTextureAsync(path)
    if (!tex) return
    const offscreen = document.createElement('canvas')
    offscreen.width = tex.width
    offscreen.height = tex.height
    const offCtx = offscreen.getContext('2d')!
    offCtx.putImageData(new ImageData(tex.pixels, tex.width, tex.height), 0, 0)
    const img = new Image()
    img.src = offscreen.toDataURL()
    textures.set(name, img)
  }

  function draw() {
    if (!currentState) return
    ctx.clearRect(0, 0, W, H)
    // TODO: 绘制HUD元素
  }

  function loop() {
    draw()
    rafId = requestAnimationFrame(loop)
  }

  async function loadAllTextures() {
    const basePath = '/res/image/sinimage/inter'
    const entries: [string, string][] = [
      ['bar_life', `${basePath}/bar_life.bmp`],
      ['bar_mana', `${basePath}/bar_mana.bmp`],
      ['bar_stamina', `${basePath}/bar_stamina.bmp`],
      ['bar_exp', `${basePath}/sinGage/bar_exp.bmp`],
      ['sun', `${basePath}/flash/sun.bmp`],
      ['moon', `${basePath}/flash/moon.bmp`],
      ['bar_time', `${basePath}/sinGage/bar_time.bmp`],
      ['bstatus', `${basePath}/bstatus.bmp`],
      ['binven', `${basePath}/binven.bmp`],
      ['bskill', `${basePath}/bskill.bmp`],
      ['bparty', `${basePath}/bparty.bmp`],
      ['bquest', `${basePath}/bquest.bmp`],
      ['bsystem', `${basePath}/bsystem.bmp`],
      ['walk', `${basePath}/button/walk.bmp`],
      ['autocam', `${basePath}/button/autocameraimage.bmp`],
      ['pixcam', `${basePath}/button/pixcameraimage.bmp`],
      ['mapon', `${basePath}/button/maponimage.bmp`],
    ]
    await Promise.all(entries.map(([name, path]) => loadTexture(name, path)))
  }

  window.addEventListener('resize', fitCanvas)
  fitCanvas()
  loadAllTextures().then(loop)

  return {
    show(state: HudState) {
      currentState = state
      canvas.style.display = 'block'
    },
    hide() {
      canvas.style.display = 'none'
      currentState = null
    },
    dispose() {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', fitCanvas)
      canvas.remove()
    }
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npm run build`
Expected: 编译通过，无TypeScript错误

- [ ] **Step 3: 验证CSS缩放**

在浏览器中打开，验证：
- Canvas居中显示
- 窗口缩放时Canvas等比缩放
- 两侧/上下有黑边

- [ ] **Step 4: Commit**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 重写Hud.ts为1280×720画布+CSS缩放"
```

---

## Task 2: 绘制HP/MP/STM/EXP条

**Files:**
- Modify: `src/ui/Hud.ts`

**Interfaces:**
- Consumes: `textures` Map（bar_life, bar_mana, bar_stamina, bar_exp）
- Produces: `drawBars(ctx, state)` 函数

- [ ] **Step 1: 添加条的绘制函数**

在Hud.ts中添加：

```typescript
function drawBars(ctx: CanvasRenderingContext2D, state: HudState) {
  // HP条 - 红色，底部锚定
  const hpFill = Math.floor(94 * (state.hp / state.maxHp))
  const hpTex = textures.get('bar_life')
  if (hpTex) {
    ctx.drawImage(hpTex, 0, 94 - hpFill, 16, hpFill, 511, 600 + (94 - hpFill), 16, 94)
  }

  // MP条 - 蓝色，底部锚定
  const mpFill = Math.floor(94 * (state.mp / state.maxMp))
  const mpTex = textures.get('bar_mana')
  if (mpTex) {
    ctx.drawImage(mpTex, 0, 94 - mpFill, 16, mpFill, 744, 600 + (94 - mpFill), 16, 94)
  }

  // STM条 - 绿色，底部锚定
  const stmFill = Math.floor(76 * (state.stm / state.maxStm))
  const stmTex = textures.get('bar_stamina')
  if (stmTex) {
    ctx.drawImage(stmTex, 0, 76 - stmFill, 8, stmFill, 485, 622 + (76 - stmFill), 8, 76)
  }

  // EXP条 - 黄色，底部锚定
  const expFill = Math.floor(86 * (state.exp / state.maxExp))
  const expTex = textures.get('bar_exp')
  if (expTex) {
    ctx.drawImage(expTex, 0, 86 - expFill, 6, expFill, 776, 610 + (86 - expFill), 6, 86)
  }
}
```

- [ ] **Step 2: 在draw()中调用**

```typescript
function draw() {
  if (!currentState) return
  ctx.clearRect(0, 0, W, H)
  drawBars(ctx, currentState)
}
```

- [ ] **Step 3: 验证编译和渲染**

Run: `npm run build`
在浏览器中验证条正确显示（需要有playerState数据）

- [ ] **Step 4: Commit**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 绘制HP/MP/STM/EXP垂直条"
```

---

## Task 3: 绘制日月时钟

**Files:**
- Modify: `src/ui/Hud.ts`

**Interfaces:**
- Consumes: `textures` Map（sun, moon, bar_time）, `GameClock`（稍后实现）
- Produces: `drawClock(ctx, hour, min)` 函数

- [ ] **Step 1: 添加时钟绘制函数**

```typescript
function drawClock(ctx: CanvasRenderingContext2D, hour: number, min: number) {
  const isDay = hour >= 4 && hour < 22
  const texName = isDay ? 'sun' : 'moon'
  const iconTex = textures.get(texName)
  
  if (iconTex) {
    // 日/月图标位置
    const iconX = isDay ? 581 : 682
    ctx.drawImage(iconTex, iconX, 707, 13, 13)
  }

  // 时条填充
  const barTex = textures.get('bar_time')
  if (barTex) {
    let fill: number
    if (isDay) {
      // 白天：从左到右填充 (4-21点)
      fill = Math.floor(50 * ((hour - 4) * 60 + min) / (19 * 60))
    } else {
      // 夜晚：从右到左填充 (22-3点)
      fill = Math.floor(50 * ((hour + 1) * 60 + min) / (5 * 60))
    }
    fill = Math.max(0, Math.min(50, fill))
    ctx.drawImage(barTex, 0, 0, fill, 5, 600, 712, fill, 5)
  }
}
```

- [ ] **Step 2: 在draw()中调用（暂时用固定时间）**

```typescript
function draw() {
  if (!currentState) return
  ctx.clearRect(0, 0, W, H)
  drawBars(ctx, currentState)
  drawClock(ctx, 12, 0) // 暂时固定12:00
}
```

- [ ] **Step 3: 验证编译**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 绘制日月时钟"
```

---

## Task 4: 绘制功能按钮

**Files:**
- Modify: `src/ui/Hud.ts`

**Interfaces:**
- Consumes: `textures` Map（bstatus, binven, bskill, bparty, bquest, bsystem, walk, autocam, pixcam, mapon）
- Produces: `drawButtons(ctx)` 函数, 按钮点击检测

- [ ] **Step 1: 定义按钮布局**

```typescript
interface Button {
  name: string
  x: number; y: number; w: number; h: number
  texture: string
  onClick?: () => void
}

const BUTTONS: Button[] = [
  // Walk/Camera/Map
  { name: 'walk', x: 920, y: 678, w: 24, h: 25, texture: 'walk' },
  { name: 'camera', x: 958, y: 678, w: 24, h: 25, texture: 'autocam' },
  { name: 'map', x: 997, y: 678, w: 24, h: 25, texture: 'mapon' },
  // 6功能按钮
  { name: 'status', x: 1037, y: 670, w: 25, h: 27, texture: 'bstatus' },
  { name: 'inventory', x: 1062, y: 670, w: 25, h: 27, texture: 'binven' },
  { name: 'skill', x: 1087, y: 670, w: 25, h: 27, texture: 'bskill' },
  { name: 'party', x: 1112, y: 670, w: 25, h: 27, texture: 'bparty' },
  { name: 'quest', x: 1137, y: 670, w: 25, h: 27, texture: 'bquest' },
  { name: 'system', x: 1235, y: 670, w: 25, h: 27, texture: 'bsystem' },
]
```

- [ ] **Step 2: 绘制按钮**

```typescript
function drawButtons(ctx: CanvasRenderingContext2D) {
  for (const btn of BUTTONS) {
    const tex = textures.get(btn.texture)
    if (tex) {
      ctx.drawImage(tex, btn.x, btn.y, btn.w, btn.h)
    }
  }
}
```

- [ ] **Step 3: 添加点击检测**

```typescript
canvas.addEventListener('click', (e) => {
  const scale = Math.min(window.innerWidth / W, window.innerHeight / H)
  const offsetX = (window.innerWidth - W * scale) / 2
  const offsetY = (window.innerHeight - H * scale) / 2
  const x = (e.clientX - offsetX) / scale
  const y = (e.clientY - offsetY) / scale

  for (const btn of BUTTONS) {
    if (x >= btn.x && x < btn.x + btn.w && y >= btn.y && y < btn.y + btn.h) {
      btn.onClick?.()
      break
    }
  }
})
```

- [ ] **Step 4: 验证编译**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 绘制功能按钮+点击检测"
```

---

## Task 5: 实现GameClock — 时间同步

**Files:**
- Create: `src/ui/GameClock.ts`
- Modify: `src/net/protocol.ts`
- Modify: `src/net/transport.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `send()` from transport, `onMessage()` from transport
- Produces: `createGameClock(): GameClock` with `getHour()`, `getMin()`, `isNight()`, `onTimeUpdate`

- [ ] **Step 1: 创建GameClock.ts**

```typescript
// src/ui/GameClock.ts

export interface TimeState {
  hour: number
  min: number
  isNight: boolean
}

export interface GameClock {
  getHour(): number
  getMin(): number
  isNight(): boolean
  getState(): TimeState
  onTimeUpdate(callback: (state: TimeState) => void): void
  dispose(): void
}

const GAME_WORLDTIME_MIN = 800 // 800ms = 1 game minute
const GAME_HOUR_DAY = 4
const GAME_HOUR_GLOW = 22
const GAME_HOUR_DARKNESS = 23

export function createGameClock(): GameClock {
  let dwGameWorldTime = 0
  let dwConnectedServerTime = 0
  let dwConnectedClientTime = 0
  let lastLocalTime = Date.now()
  let callbacks: ((state: TimeState) => void)[] = []

  function isNight(): boolean {
    const hour = Math.floor(dwGameWorldTime / 60) % 24
    return hour < GAME_HOUR_DAY || hour >= GAME_HOUR_DARKNESS
  }

  function getState(): TimeState {
    const hour = Math.floor(dwGameWorldTime / 60) % 24
    const min = Math.floor(dwGameWorldTime) % 60
    return { hour, min, isNight: isNight() }
  }

  function notify() {
    const state = getState()
    for (const cb of callbacks) cb(state)
  }

  // 初始同步
  function setInitialTime(serverTimeMs: number) {
    dwConnectedServerTime = serverTimeMs
    dwConnectedClientTime = Date.now()
    dwGameWorldTime = Math.floor(serverTimeMs / GAME_WORLDTIME_MIN)
    notify()
  }

  // 校正时间
  function correctTime(serverTimeMs: number) {
    const calculatedServerTime = (Date.now() - dwConnectedClientTime) + dwConnectedServerTime
    const drift = Math.abs(serverTimeMs - calculatedServerTime)
    
    // 漂移>10分钟（600000ms）时强制校正
    if (drift > 600000) {
      dwGameWorldTime = Math.floor(serverTimeMs / GAME_WORLDTIME_MIN)
      dwConnectedServerTime = serverTimeMs
      dwConnectedClientTime = Date.now()
    }
    notify()
  }

  // 本地推进
  function update() {
    const now = Date.now()
    const deltaMs = now - lastLocalTime
    lastLocalTime = now
    dwGameWorldTime += deltaMs / GAME_WORLDTIME_MIN
    notify()
  }

  // 启动本地推进循环
  let intervalId = setInterval(update, 100)

  return {
    getHour: () => Math.floor(dwGameWorldTime / 60) % 24,
    getMin: () => Math.floor(dwGameWorldTime) % 60,
    isNight,
    getState,
    onTimeUpdate: (cb) => { callbacks.push(cb) },
    dispose: () => {
      clearInterval(intervalId)
      callbacks = []
    },
    // 内部方法，供transport调用
    setInitialTime,
    correctTime,
  } as GameClock & { setInitialTime: (t: number) => void; correctTime: (t: number) => void }
}
```

- [ ] **Step 2: 验证编译**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/ui/GameClock.ts
git commit -m "feat(clock): 创建GameClock时间同步模块"
```

---

## Task 6: 集成时间同步到Transport

**Files:**
- Modify: `src/net/transport.ts`
- Modify: `src/net/protocol.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `GameClock.setInitialTime()`, `GameClock.correctTime()`
- Produces: 4秒心跳对时

- [ ] **Step 1: 修改protocol.ts添加时间消息**

在现有proto消息中添加时间同步字段（如果proto文件已有Time字段则跳过此步）

- [ ] **Step 2: 修改transport.ts添加4秒对时**

在现有心跳逻辑中添加时间校正：

```typescript
// 在现有的20s心跳中，添加4s对时
let timeSyncCounter = 0
const originalHeartbeat = // 保存原心跳逻辑

setInterval(() => {
  timeSyncCounter++
  
  // 每4秒发送时间校正
  if (timeSyncCounter % 4 === 0) {
    const calculatedServerTime = (Date.now() - dwConnectedClientTime) + dwConnectedServerTime
    send({ type: 'timeSync', clientTime: calculatedServerTime })
  }
  
  // 每20秒发送心跳
  if (timeSyncCounter % 20 === 0) {
    send({ type: 'ping' })
  }
}, 1000)
```

- [ ] **Step 3: 修改main.ts集成GameClock**

```typescript
import { createGameClock } from './ui/GameClock.ts'

// 在初始化时
const gameClock = createGameClock()

// 在onMessage中处理时间同步响应
case 'timeSync':
  gameClock.setInitialTime(message.serverTime)
  break

case 'timeSyncResponse':
  gameClock.correctTime(message.serverTime)
  break

// 传给Hud
hud.show({ ...playerState, gameClock })
```

- [ ] **Step 4: 验证编译**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/net/transport.ts src/net/protocol.ts src/main.ts
git commit -m "feat(clock): 集成4秒心跳对时到Transport"
```

---

## Task 7: 集成GameClock到Hud

**Files:**
- Modify: `src/ui/Hud.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `GameClock` from GameClock.ts
- Produces: 时钟实时更新

- [ ] **Step 1: 修改HudState添加gameClock**

```typescript
export interface HudState {
  // ... 现有字段
  gameClock?: GameClock
}
```

- [ ] **Step 2: 修改draw()使用gameClock**

```typescript
function draw() {
  if (!currentState) return
  ctx.clearRect(0, 0, W, H)
  drawBars(ctx, currentState)
  
  const clock = currentState.gameClock
  if (clock) {
    drawClock(ctx, clock.getHour(), clock.getMin())
  } else {
    drawClock(ctx, 12, 0) // 默认12:00
  }
  
  drawButtons(ctx)
}
```

- [ ] **Step 3: 验证编译**

Run: `npm run build`

- [ ] **Step 4: 验证时钟实时更新**

在浏览器中验证时钟每秒更新

- [ ] **Step 5: Commit**

```bash
git add src/ui/Hud.ts src/main.ts
git commit -m "feat(hud): 集成GameClock到Hud实时更新"
```

---

## Task 8: 昼夜状态计算

**Files:**
- Modify: `src/ui/GameClock.ts`
- Modify: `src/render/map-renderer.ts`

**Interfaces:**
- Consumes: `GameClock.getState()`
- Produces: `NightDayTime` 状态，传递给MapRenderer

- [ ] **Step 1: 在GameClock中添加昼夜判断**

```typescript
function isNight(): boolean {
  const hour = getHour()
  return hour < GAME_HOUR_DAY || hour >= GAME_HOUR_DARKNESS
}
```

- [ ] **Step 2: 在MapRenderer中接收昼夜状态**

```typescript
// map-renderer.ts
let isNight = false

export function setNightDay(night: boolean) {
  isNight = night
  // 调整场景光照
  if (scene) {
    scene.fog.color.setHex(isNight ? 0x111122 : 0xffffff)
  }
}
```

- [ ] **Step 3: 在main.ts中连接时钟和渲染器**

```typescript
gameClock.onTimeUpdate((state) => {
  mapRenderer.setNightDay(state.isNight)
})
```

- [ ] **Step 4: 验证编译**

Run: `npm run build`

- [ ] **Step 5: 验证昼夜切换**

调整游戏时间，验证场景光照变化

- [ ] **Step 6: Commit**

```bash
git add src/ui/GameClock.ts src/render/map-renderer.ts src/main.ts
git commit -m "feat(clock): 实现昼夜状态计算+场景光照切换"
```

---

## Task 9: 实现KeyBinding — 键位存储

**Files:**
- Create: `src/ui/KeyBinding.ts`

**Interfaces:**
- Produces: `createKeyBinding(): KeyBinding` with `get(action)`, `set(action, key)`, `reset()`, `getAll()`

- [ ] **Step 1: 创建KeyBinding.ts**

```typescript
// src/ui/KeyBinding.ts

export type GameAction = 
  | 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight'
  | 'attack' | 'skill'
  | 'walkRun' | 'cameraMode' | 'minimap'
  | 'status' | 'skillPanel' | 'inventory' | 'party' | 'quest' | 'system'
  | 'showGroundItems'
  | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'skill5' | 'skill6'
  | 'skill7' | 'skill8' | 'skill9' | 'skill10' | 'skill11' | 'skill12'
  | 'potion1' | 'potion2' | 'potion3' | 'potion4' | 'potion5' | 'potion6'
  | 'potion7' | 'potion8' | 'potion9' | 'potion10' | 'potion11' | 'potion12'
  | 'chat' | 'closePanel'

interface KeyBinding {
  get(action: GameAction): string | null
  set(action: GameAction, key: string): void
  reset(): void
  getAll(): Record<GameAction, string | null>
  save(): void
  load(): void
}

const STORAGE_KEY = 'pt-keybindings'

const DEFAULT_BINDINGS: Record<GameAction, string | null> = {
  moveForward: null,    // 默认不绑定，用户自选
  moveBackward: null,
  moveLeft: null,
  moveRight: null,
  attack: 'Space',
  skill: 'Control',
  walkRun: 'KeyR',
  cameraMode: 'KeyZ',
  minimap: 'Tab',
  status: 'KeyC',
  skillPanel: 'KeyS',
  inventory: 'KeyV',
  party: 'KeyD',
  quest: 'KeyQ',
  system: 'KeyX',
  showGroundItems: 'KeyA',
  skill1: 'F1', skill2: 'F2', skill3: 'F3', skill4: 'F4',
  skill5: 'F5', skill6: 'F6', skill7: 'F7', skill8: 'F8',
  skill9: 'F9', skill10: 'F10', skill11: 'F11', skill12: 'F12',
  potion1: 'Digit1', potion2: 'Digit2', potion3: 'Digit3',
  potion4: 'Digit4', potion5: 'Digit5', potion6: 'Digit6',
  potion7: 'Digit7', potion8: 'Digit8', potion9: 'Digit9',
  potion10: 'Digit0', potion11: 'Minus', potion12: 'Equal',
  chat: 'Enter',
  closePanel: 'Escape',
}

export function createKeyBinding(): KeyBinding {
  let bindings = { ...DEFAULT_BINDINGS }

  function get(action: GameAction): string | null {
    return bindings[action]
  }

  function set(action: GameAction, key: string): void {
    bindings[action] = key
  }

  function reset(): void {
    bindings = { ...DEFAULT_BINDINGS }
  }

  function getAll(): Record<GameAction, string | null> {
    return { ...bindings }
  }

  function save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  }

  function load(): void {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        bindings = { ...DEFAULT_BINDINGS, ...parsed }
      } catch (e) {
        console.warn('Failed to load key bindings:', e)
      }
    }
  }

  // 初始化时加载
  load()

  return { get, set, reset, getAll, save, load }
}
```

- [ ] **Step 2: 验证编译**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/ui/KeyBinding.ts
git commit -m "feat(keybinding): 创建KeyBinding键位管理模块"
```

---

## Task 10: 实现键盘输入处理

**Files:**
- Modify: `src/ui/KeyBinding.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `KeyBinding.get()`
- Produces: 键盘事件监听，触发游戏动作

- [ ] **Step 1: 添加键盘事件处理**

在KeyBinding.ts中添加：

```typescript
export interface KeyBinding {
  // ... 现有方法
  onKeyDown(callback: (action: GameAction) => void): void
  dispose(): void
}

// 在createKeyBinding中添加
let actionCallbacks: ((action: GameAction) => void)[] = []

function handleKeyDown(e: KeyboardEvent) {
  // 如果在输入框中，不处理游戏快捷键
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
    return
  }

  for (const [action, key] of Object.entries(bindings)) {
    if (key && e.code === key) {
      e.preventDefault()
      for (const cb of actionCallbacks) {
        cb(action as GameAction)
      }
      break
    }
  }
}

window.addEventListener('keydown', handleKeyDown)

// 修改返回对象
return {
  // ... 现有方法
  onKeyDown: (cb) => { actionCallbacks.push(cb) },
  dispose: () => {
    window.removeEventListener('keydown', handleKeyDown)
    actionCallbacks = []
  }
}
```

- [ ] **Step 2: 在main.ts中监听动作**

```typescript
const keyBinding = createKeyBinding()

keyBinding.onKeyDown((action) => {
  switch (action) {
    case 'walkRun':
      // 切换走路/跑步
      break
    case 'cameraMode':
      // 切换相机模式
      break
    case 'minimap':
      // 切换小地图
      break
    case 'status':
      // 打开角色面板
      break
    case 'skillPanel':
      // 打开技能面板
      break
    case 'inventory':
      // 打开背包面板
      break
    case 'party':
      // 打开组队窗口
      break
    case 'quest':
      // 打开任务窗口
      break
    case 'system':
      // 打开系统菜单
      break
    case 'chat':
      // 打开聊天输入
      break
    case 'closePanel':
      // 关闭当前面板
      break
    // ... 其他动作
  }
})
```

- [ ] **Step 3: 验证编译**

Run: `npm run build`

- [ ] **Step 4: 验证按键响应**

在浏览器中按键，验证控制台输出对应动作

- [ ] **Step 5: Commit**

```bash
git add src/ui/KeyBinding.ts src/main.ts
git commit -m "feat(keybinding): 实现键盘输入处理+动作回调"
```

---

## Task 11: 实现键位设置面板UI

**Files:**
- Create: `src/ui/KeyBindingPanel.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `KeyBinding.getAll()`, `KeyBinding.set()`, `KeyBinding.reset()`, `KeyBinding.save()`
- Produces: 键位设置面板DOM

- [ ] **Step 1: 创建KeyBindingPanel.ts**

```typescript
// src/ui/KeyBindingPanel.ts
import { KeyBinding, GameAction } from './KeyBinding.ts'

const ACTION_LABELS: Record<GameAction, string> = {
  moveForward: '向前移动',
  moveBackward: '向后移动',
  moveLeft: '向左移动',
  moveRight: '向右移动',
  attack: '攻击',
  skill: '技能',
  walkRun: '走路/跑步',
  cameraMode: '相机模式',
  minimap: '小地图',
  status: '角色状态',
  skillPanel: '技能面板',
  inventory: '背包面板',
  party: '组队窗口',
  quest: '任务窗口',
  system: '系统菜单',
  showGroundItems: '显示地面物品',
  skill1: '技能1', skill2: '技能2', skill3: '技能3', skill4: '技能4',
  skill5: '技能5', skill6: '技能6', skill7: '技能7', skill8: '技能8',
  skill9: '技能9', skill10: '技能10', skill11: '技能11', skill12: '技能12',
  potion1: '药水1', potion2: '药水2', potion3: '药水3',
  potion4: '药水4', potion5: '药水5', potion6: '药水6',
  potion7: '药水7', potion8: '药水8', potion9: '药水9',
  potion10: '药水10', potion11: '药水11', potion12: '药水12',
  chat: '聊天输入',
  closePanel: '关闭面板',
}

export function createKeyBindingPanel(container: HTMLElement, keyBinding: KeyBinding) {
  const panel = document.createElement('div')
  panel.style.cssText = `
    position: fixed; inset: 0; z-index: 1000;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.85);
  `

  const content = document.createElement('div')
  content.style.cssText = `
    background: #0a0a1a; border: 2px solid #f0c040;
    padding: 20px; max-height: 80vh; overflow-y: auto;
    min-width: 400px; color: #e0d8c8;
  `
  content.innerHTML = '<h2 style="color:#f0c040;margin:0 0 16px">键位设置</h2>'

  const bindings = keyBinding.getAll()
  const rows: { action: GameAction; keyEl: HTMLDivElement }[] = []

  for (const [action, key] of Object.entries(bindings)) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #333'

    const label = document.createElement('span')
    label.textContent = ACTION_LABELS[action as GameAction]

    const keyEl = document.createElement('div')
    keyEl.textContent = key || '未绑定'
    keyEl.style.cssText = `
      padding: 2px 8px; cursor: pointer;
      background: #1a1a2a; border: 1px solid #555;
      min-width: 80px; text-align: center;
    `
    keyEl.onclick = () => {
      keyEl.textContent = '请按键...'
      keyEl.style.borderColor = '#f0c040'
      const handler = (e: KeyboardEvent) => {
        e.preventDefault()
        keyBinding.set(action as GameAction, e.code)
        keyEl.textContent = e.code
        keyEl.style.borderColor = '#555'
        window.removeEventListener('keydown', handler)
      }
      window.addEventListener('keydown', handler)
    }

    row.appendChild(label)
    row.appendChild(keyEl)
    content.appendChild(row)
    rows.push({ action: action as GameAction, keyEl })
  }

  // 按钮区
  const buttons = document.createElement('div')
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end'

  const resetBtn = document.createElement('button')
  resetBtn.textContent = '重置默认'
  resetBtn.onclick = () => {
    keyBinding.reset()
    for (const row of rows) {
      row.keyEl.textContent = keyBinding.get(row.action) || '未绑定'
    }
  }

  const saveBtn = document.createElement('button')
  saveBtn.textContent = '保存'
  saveBtn.style.cssText = 'background:#f0c040;color:#000'
  saveBtn.onclick = () => {
    keyBinding.save()
    panel.style.display = 'none'
  }

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = '取消'
  cancelBtn.onclick = () => {
    keyBinding.load() // 恢复原值
    for (const row of rows) {
      row.keyEl.textContent = keyBinding.get(row.action) || '未绑定'
    }
    panel.style.display = 'none'
  }

  buttons.appendChild(resetBtn)
  buttons.appendChild(saveBtn)
  buttons.appendChild(cancelBtn)
  content.appendChild(buttons)

  panel.appendChild(content)
  container.appendChild(panel)

  return {
    show: () => { panel.style.display = 'flex' },
    hide: () => { panel.style.display = 'none' },
  }
}
```

- [ ] **Step 2: 在main.ts中集成**

```typescript
import { createKeyBindingPanel } from './ui/KeyBindingPanel.ts'

const keyBindingPanel = createKeyBindingPanel(document.body, keyBinding)

// 在system按钮点击时
case 'system':
  // 显示系统菜单，包含"键位设置"按钮
  keyBindingPanel.show()
  break
```

- [ ] **Step 3: 验证编译**

Run: `npm run build`

- [ ] **Step 4: 验证面板显示和交互**

在浏览器中打开键位设置面板，验证：
- 所有键位正确显示
- 点击后可以修改键位
- 保存/取消/重置功能正常

- [ ] **Step 5: Commit**

```bash
git add src/ui/KeyBindingPanel.ts src/main.ts
git commit -m "feat(keybinding): 实现键位设置面板UI"
```

---

## Task 12: 实现小地图渲染

**Files:**
- Create: `src/ui/Minimap.ts`
- Modify: `src/ui/Hud.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: 当前地图数据, 玩家位置
- Produces: 128×128小地图渲染

- [ ] **Step 1: 创建Minimap.ts**

```typescript
// src/ui/Minimap.ts

export interface MinimapData {
  mapImage: HTMLImageElement | null  // 地图缩略图
  playerX: number  // 玩家X位置 (0-128)
  playerZ: number  // 玩家Z位置 (0-128)
  playerAngle: number  // 玩家朝向角度
  npcs: Array<{ x: number; z: number; isEnemy: boolean }>  // NPC位置
}

export function createMinimap(container: HTMLElement) {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  canvas.style.cssText = `
    position: fixed; top: 10px; right: 10px;
    border: 2px solid #555; pointer-events: none;
  `
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')!

  function draw(data: MinimapData) {
    ctx.clearRect(0, 0, 128, 128)
    
    // 背景
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillRect(0, 0, 128, 128)
    
    // 地图缩略图
    if (data.mapImage) {
      ctx.drawImage(data.mapImage, 0, 0, 128, 128)
    }
    
    // NPC点
    for (const npc of data.npcs) {
      ctx.fillStyle = npc.isEnemy ? '#ff0000' : '#00ff00'
      ctx.fillRect(npc.x - 1, npc.z - 1, 2, 2)
    }
    
    // 玩家箭头
    ctx.save()
    ctx.translate(data.playerX, data.playerZ)
    ctx.rotate(data.playerAngle * Math.PI / 180)
    ctx.fillStyle = '#ffff00'
    ctx.beginPath()
    ctx.moveTo(0, -4)
    ctx.lineTo(-2, 2)
    ctx.lineTo(2, 2)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  return {
    draw,
    show: () => { canvas.style.display = 'block' },
    hide: () => { canvas.style.display = 'none' },
    dispose: () => canvas.remove(),
  }
}
```

- [ ] **Step 2: 在Hud.ts中集成**

```typescript
// 在Hud中添加minimap
let minimap: ReturnType<typeof createMinimap> | null = null

// 在show()中创建
show(state: HudState) {
  currentState = state
  if (!minimap) {
    minimap = createMinimap(container)
  }
  canvas.style.display = 'block'
}
```

- [ ] **Step 3: 在main.ts中更新小地图数据**

```typescript
// 在WorldView的渲染循环中
minimap.draw({
  mapImage: currentMapImage,
  playerX: player.position.x,
  playerZ: player.position.z,
  playerAngle: player.rotation,
  npcs: nearbyNPCs.map(n => ({
    x: n.position.x,
    z: n.position.z,
    isEnemy: n.isEnemy
  }))
})
```

- [ ] **Step 4: 验证编译**

Run: `npm run build`

- [ ] **Step 5: 验证小地图渲染**

在浏览器中验证小地图显示，玩家箭头跟随移动

- [ ] **Step 6: Commit**

```bash
git add src/ui/Minimap.ts src/ui/Hud.ts src/main.ts
git commit -m "feat(minimap): 实现128×128小地图渲染"
```

---

## Task 13: 集成所有模块到main.ts

**Files:**
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: 所有新模块
- Produces: 完整的HUD系统

- [ ] **Step 1: 导入所有新模块**

```typescript
import { createHud } from './ui/Hud.ts'
import { createGameClock } from './ui/GameClock.ts'
import { createKeyBinding } from './ui/KeyBinding.ts'
import { createKeyBindingPanel } from './ui/KeyBindingPanel.ts'
```

- [ ] **Step 2: 初始化所有模块**

```typescript
// 在应用初始化时
const gameClock = createGameClock()
const keyBinding = createKeyBinding()
const keyBindingPanel = createKeyBindingPanel(document.body, keyBinding)

// 在WORLD状态时创建Hud
case 'WORLD':
  const hud = createHud(container)
  hud.show({ ...playerState, gameClock })
  break
```

- [ ] **Step 3: 连接所有模块**

```typescript
// GameClock → MapRenderer
gameClock.onTimeUpdate((state) => {
  mapRenderer.setNightDay(state.isNight)
})

// KeyBinding → 游戏动作
keyBinding.onKeyDown((action) => {
  switch (action) {
    case 'walkRun':
      // 实现走路/跑步切换
      break
    case 'cameraMode':
      // 实现相机模式切换
      break
    case 'minimap':
      // 切换小地图显示
      break
    // ... 其他动作
  }
})
```

- [ ] **Step 4: 验证编译**

Run: `npm run build`

- [ ] **Step 5: 端到端测试**

在浏览器中完整测试：
1. 登录进入游戏
2. HUD正确显示（条、按钮、时钟、小地图）
3. 按键响应正确
4. 时钟实时更新
5. 昼夜切换正常

- [ ] **Step 6: Commit**

```bash
git add src/main.ts
git commit -m "feat(hud): 集成所有HUD模块到main.ts"
```

---

## Task 14: 最终验证和清理

**Files:**
- Review: 所有新建和修改的文件

**Interfaces:**
- 验证所有功能正常
- 清理TODO和调试代码

- [ ] **Step 1: 完整功能测试**

测试清单：
- [ ] HUD 1280×720画布正确显示
- [ ] CSS缩放适配不同屏幕
- [ ] HP/MP/STM/EXP条正确渲染
- [ ] 日月时钟实时更新
- [ ] 功能按钮可点击
- [ ] 小地图显示玩家位置
- [ ] 键位设置面板正常工作
- [ ] 快捷键响应正确
- [ ] 昼夜光照切换正常
- [ ] 时间同步正常

- [ ] **Step 2: 清理代码**

- 删除所有console.log调试语句
- 删除TODO注释
- 确保所有类型定义完整

- [ ] **Step 3: 运行构建验证**

Run: `npm run build`
Expected: 编译通过，无警告

- [ ] **Step 4: 最终Commit**

```bash
git add -A
git commit -m "feat(hud): 完成HUD重设计+昼夜系统+键位管理"
```
