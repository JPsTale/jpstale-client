# Task 2 报告: Hud 增加 setRunFlag/onAction 按钮点击

文件: `src/ui/Hud.ts`（已提交）

## 改动明细

### Step 1 — 扩展 Hud interface
- `Hud` 接口（原 15-19 行）：新增 `setRunFlag(run: boolean): void`、`onAction?: (action: 'toggleRun') => void`。
- 第 108 行 `uiState`：`runFlag: false` → `runFlag: true`（默认跑，与 WorldView running=true 一致）。

### Step 2 — setRunFlag 更新展示态
- `drawHoverFx` 后新增 `function setRunFlag(run): void { uiState.runFlag = run; }`。

### Step 3 — 按钮点击 hit-test
- `drawHoverFx` 后新增 `checkButtonClick()`：内容坐标 (569,555,595,581) 内左键按下（复用 ptrDown/ptrX/ptrY）→ `onAction?.('toggleRun')`。
- `loop()` 在 `draw()` 后追加 `checkButtonClick()` 调用。

### Step 4 — 暴露到返回对象
- `createHud` 返回对象新增 `setRunFlag`、`onAction: undefined`（main.ts 赋值）。
- 另声明模块内闭包 `let onAction: ((action: 'toggleRun') => void) | undefined`，供 `checkButtonClick` 引用并赋给返回对象字段（保持接口类型一致）。

## 构建输出
`npm run build` → `tsc --noEmit` 无错误，vite build 成功（77 modules，built in 173ms，仅 chunk>500kB 提示性警告）。

## 提交
- 提交信息: `feat(hud): 走跑按钮点击上报onAction + setRunFlag驱动tooltip`
- 提交哈希: `c374b84b370b42a6f501a96ad188d703768510cc`

## Fix: 下降沿触发

改了 `src/ui/Hud.ts` 的 `checkButtonClick()`（原 190-201 行附近）：原逻辑只判 `ptrDown`（按住态），`loop()` 每帧调用导致按住期间每帧都触发 `onAction?.('toggleRun')`，走跑来回来回切换。加入 `prevPtrDown` 闩锁，改为**下降沿**：仅当 `ptrDown` 由 false→true 的那一帧触发一次 `toggleRun`，按住期间不再重复触发。

行为变化：走跑按钮按一下只切一次，按住不来回切换。

构建输出：`npm run build` — `tsc --noEmit` 无错误；vite build 成功，77 modules，built in 173ms，仅 chunk>500kB 提示性警告。

提交：`fix(hud): 走跑按钮下降沿触发(按一下切一次, 按住不重复)` → `edfe13419038d7db0a9422411036b8a60f0f38c2`
