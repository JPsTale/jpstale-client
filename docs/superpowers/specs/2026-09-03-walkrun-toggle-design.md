# 走跑切换（R 键 + HUD 按钮）设计

- 日期：2026-09-03
- 状态：已批准（待实现）
- 关联：P1 交互层

## 1. 需求

实现走/跑切换：R 键（默认，可重绑）+ HUD 走跑按钮点击。切换改变**移动速度**与**角色动画**（走 WALK / 跑 RUN），并忠实原版权威行为。

## 2. 现状

- `WorldView.moveSpeed = 3`（帧步进），移动时**总是** `animState.triggerRun()`（WorldView.ts:932），无走/跑概念。
- `Hud.ts uiState.runFlag = false` 是局部死状态，仅 hover 时决定 tooltip 画 iWalk/iRun（Hud.ts:152）。
- 走跑按钮仅画 `walk.bmp` 单图标（Hud.ts:234）点击未接线；HUD canvas 为 `pointer-events:none`，点击走 window pointerdown 检测。
- `KeyBinding`：`walkRun:'KeyR'` 是默认绑定（KeyBinding.ts:35），可被 localStorage 覆盖；`onKeyDown` 统一派发。`walkRun` 已是 `GameAction` 成员与设置面板可重绑动作。
- 动画状态机已有 `WALK(0x50)/RUN(0x60)` 与 `triggerWalk/triggerRun`（anim-state-machine.ts）。

## 3. 原版权威行为（character.cpp）

- `MoveMode`：0=走(WALK)、1=跑(RUN)；`ChangeMoveMode()` 翻转（character.cpp:2295）。
- 切换时若在移动中（`MoveFlag`）立即换对应动画（character.cpp:2302-2307）。
- 速度比：跑 `MoveAngle2((MoveSpeed*460)>>8)` vs 走 `MoveAngle2((MoveSpeed*180)>>8)` ⇒ 跑≈走×2.56（character.cpp:3888-3901）。
- 走路是"基地"：DebugMode / 超负重 `Weight[0]>Weight[1]` / `Stamina[0]==0` 时强制 MoveMode=0 走。

## 4. 设计决策

### 4.1 状态所有权
- **WorldView 持有 `running` 真源**（它决定速度+动画）。
- Hud 纯展示：`setRunFlag(bool)` 同步 tooltip；点击现直接经 `onAction` 上报，维护 `runFlag` 仅作 hover tooltip 展示。
- main.ts 接线：R 键（keyBinding）与 Hud 按钮点击统一汇入 `worldView.toggleRun()`，再把新值同步回 Hud。

### 4.2 可替换出口（未来服务端对接，C 方案）
- 走跑是本地状态，但**切换动作收敛到可替换出口** `onMoveModeChange`，未来接 C2S 时只改出口，不动逻辑。
- 出口现在为 no-op/`console.log`，未来在 main.ts 替换为 `sendMoveMode('run'|'walk')`。
- 不预设客户端权威/服务端权威移动模型（A/B 均兼容：出口只发 mode 事件）。

### 4.3 键位自定义
- 走跑完全走 `keyBinding.onKeyDown` 的 `walkRun` 动作分发；R 只是默认键，用户可经设置面板重绑。
- **KeyBinding.ts 零改动**（`walkRun` 已存在）。

### 4.4 速度与动画
- `WALK_STEP = 3`（保留原 moveSpeed 语义）、`RUN_STEP = 7.5`（×2.5，对齐原版≈2.56 比值）。
- 移动：`const step = running ? RUN_STEP : WALK_STEP`。
- 动画：移动触发 `running ? triggerRun() : triggerWalk()`。

### 4.5 按钮图标
- 走跑按钮本体 `walk.bmp` 单态，原版 Button 目录仅此一个资源 → **两态不换按钮图标**，仅 tooltip 泡泡 iWalk↔iRun 变化（Hud.ts:152 已实现，忠于原版）。

## 5. 组件改动

### 5.1 WorldView
```ts
let running = true; // 默认跑
// 速度常量：WALK_STEP=3, RUN_STEP=7.5

export interface WorldViewOpts {
  onMoveModeChange?: (mode: 'run' | 'walk') => void; // 可替换出口（未来 C2S）
}
// createWorldView(container, opts?)
```
- 内部切换函数（不直接改 running）：
```ts
function setRunMode(next: boolean) {
  if (running === next) return;
  running = next;
  opts?.onMoveModeChange?.(next ? 'run' : 'walk');
  if (wasMoving) { running ? animState.triggerRun() : animState.triggerWalk(); }
}
```
- 公开方法：
  - `toggleRun(): boolean`（翻转，返回新值）
  - `isRunning(): boolean`
- `step = running ? RUN_STEP : WALK_STEP`
- 移动触发处 `running ? animState.triggerRun() : animState.triggerWalk()`

### 5.2 Hud
- 接口新增：
  - `setRunFlag(run: boolean): void`（驱动 tooltip + 维护展示态）
  - `onAction?: (action: 'toggleRun') => void`
- hit-test：内容坐标 (569,555,595,581) 内**左键按下** → `onAction?.('toggleRun')`（复用 drawHoverFx 的 hit 函数；点击不拦截世界，走 window pointerdown 坐标换算后判定）。

### 5.3 main.ts
- `keyBinding.onKeyDown` `case 'walkRun': hudPanel.setRunFlag(worldView.toggleRun()); break;`
- `hudPanel.onAction = (a) => { if (a === 'toggleRun') hudPanel.setRunFlag(worldView.toggleRun()); }`
- `createWorldView(app, { onMoveModeChange: (mode) => console.log('[mmode]', mode) })`（P1 出口占位，未来替换为 C2S）。

## 6. 范围外（不做 / YAGNI）
- 负重/体力强制走、村庄减速、SPRINT(0x70)、跑步消耗体力——等 P2 实体系/属性接入。
- 服务端权威移动计算——不预设，出口已留。
- 走跑按钮"按下态"贴图——原版无独立资源。

## 7. 验证
- 进世界默认跑（RUN 动画，step=7.5）。
- R 键 → 走（WALK 动画，step=3）；再 R → 跑；移动中切换动画即时生效。
- HUD 按钮点击 = R 键效果。
- hover 走跑按钮 tooltip 随 runFlag 变 iWalk/iRun。
- 修改键盘设置把 walkRun 绑到别的键 → 该键生效、R 失效。
- `[move mode]` 出口日志随切换打印（P1 占位）。
