# Task 3 报告: main.ts 接线（R 键 + HUD 按钮 + 出口）

## 每步改动

### Step 1: createWorldView 传出出口
- 文件: `src/main.ts` 第 29-31 行
- `const worldView = createWorldView(app);` → `createWorldView(app, { onMoveModeChange: (mode) => console.log('[mmode]', mode) })`

### Step 2: R 键（walkRun）接 toggleRun
- 文件: `src/main.ts` 第 68-70 行
- `keyBinding.onKeyDown` switch 中新增 `case 'walkRun'`，调用 `hudPanel.setRunFlag(worldView.toggleRun())`

### Step 3: Hud 按钮点击接 toggleRun
- 文件: `src/main.ts` 第 74-78 行
- `hudPanel.onAction` 赋值：`action === 'toggleRun'` 时 `hudPanel.setRunFlag(worldView.toggleRun())`

## npm run build 输出
`tsc --noEmit` 无错误；`vite build` 成功（77 modules transformed, built in 158ms）。仅 chunk 大小警告（非错误）。

## 提交哈希
`d88662b45e3c58bb5c06464077d8b59da79240d0`
