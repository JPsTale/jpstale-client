# 前置流程 UI 评审与重设计（阶段 1：登录 / 选服 / 选角 / 进图 / 断线重连）

> 日期：2026-09-17
> 范围：本阶段只覆盖「进入游戏前 + 断线重连」的五块 UI（登录、选服、选角、进图加载、重连遮罩）。
> 游戏内 React 面板（背包/属性/技能/地图/聊天/死亡三选项等）属阶段 2，本文只给方向不落细节。
> 交付物：① 现状评审（问题清单 + 优先级）② 重设计（设计系统 / 组件规范 / 关键页面线框 / 实施顺序）。
> 里程碑：本文经用户批范围后，才可按「实施顺序」改代码（AGENTS 前提：不改 DB、改动前对齐）。

---

## 一、现状评审

### 1.1 范围与方法

对本阶段五块 UI 逐一做了源码级勘察（读文件，不截屏），现行实现全部是**原生 DOM + 内联 `style.cssText`**，
无任何共享样式文件；三块主要页面拆为独立模块，靠 `main.ts` 的 `showPanelFor()` 按 `AppScreen` 分发。

| 页面 | 文件 | 规模 |
|---|---|---|
| 登录 | `src/ui/LoginPanel.ts` (+`LoginBackdrop.ts`) | 48 / 80 行 |
| 选服 | `src/ui/ServerSelect.ts` | 35 行 |
| 选角（list + create 双模式） | `src/ui/CharSelect.ts` | 796 行 |
| 进图加载 | `src/ui/LoadingScreen`（经 `main.ts` 驱动） | — |
| 断线重连 | `net/transport.ts` + `connOverlay`（`main.ts` 内） | — |
| 屏切换 | `src/app/State.ts` | 48 行 |

### 1.2 现状逐块

**登录（LoginPanel）**
- `panel.login-panel`：绝对定位居中，透明底，白字 + 文本投影（`text-shadow`）压在原画上。
- 结构：`h2` 标题 + 一行红色 `.error` + 用户名/密码两个 `input`（宽 240px）+ 一个 `button`。
- 交互：按钮点击或密码框回车触发 `onLogin`；`show(error)` 时把 error 填入红字行（`t('error.xxx') ?? error`）。
- 背景（LoginBackdrop）：EU 官方登录原画 `bg1.png`（实为 JPEG 字节存 .png）+ 径向暗化 vignette +
  三条后备源回退链（bg1→bg10→bg7）失败则隐藏图片；启动时 `preload()` 预解码。

**选服（ServerSelect）**
- 35 行：标题 + 服务器行列表。行 = `div`，胶囊感（`border-radius:4px`、`backdrop-filter:blur(2px)`、
  `rgba(15,15,24,0.55)` 半透明底）。
- **只有 onSelect 一种交互**：无退出登录、无空态、无连接中、无失败框 —— AGENTS 痛点 2 原样存在。

**选角（CharSelect）**
- list 模式：左侧 300px 侧栏（`char-side`，深底 `rgba(0,0,0,0.85)`）＝ 标题 + 角色卡列表 + 三按钮
  （进入/创建/换账号）；右侧全宽 3D 预览（three.js，`#1a1a2e` 场景底）。
- 角色卡：`#222` 底、选中 `#3a5a3a` 边框 `#f0c040`；卡内显示 名字 / 职业·等级 / 所在位置（mapId→名）。
- create 模式：三栏（左＝职业名+描述+属性占位；中＝3D 预览；右＝职业 2 列网格 + 脸型 3 格 + 名字输入 + 创建/返回）。
- 空角列表时 `clearPreview()`，只有"创建"可用。
- 铁律挂载好：预览用 `WeaponMount`（含刺客匕首镜像）、`anim-player` 共享实现、`selectJob/selectHead` 即时刷新 3D。
- ⚠ `updateJobInfo` 把 `jobDesc`/`jobAttr` 置空（数据未接），右侧职业面板等于摆设。

**进图加载（LoadingScreen）**
- 原画底层 + 中部框（`box.png`，455×90 自带上小框/下大框）+ **绿色进度条**（261×29 内缩放，跟字节走，见 AGENTS #58）+ 右下角字节/速度行。
- `z-index:1400`（层栈体系刻意不参与，永远压顶）；阶段进度（本图/邻图/角色/首帧）上限 95%，`setProgress(100)` 才满。
- 目前只有 loadingScreen.show/hide，无标题/副标题层级结构（标题在 `main.ts` 由 `t('map.${mapId}')` 拼）。

**断线重连（transport + connOverlay）**
- 断线双路径：10×2s 有界重连（`RECONNECT_TOTAL=10`）/ 3s 重连；`busyShow('net.*')` 文本驱动遮罩。
- 遮罩：`connOverlayEl` z-900，`rgba(0,0,0,0.8)` 全屏，标题 `#ffb0a0` 22px + 副文 `#bbb` 13px + 「重新连接」按钮（`#3a2320` 底）。
- ⚠ 硬伤：`transport.send()` 在非 OPEN 时**只 console.warn 然后静默丢包**（违反 AGENTS #12：降级必须可见）。
- 重连成功判定 = 仅 `ws.onopen`，不验证重新登录；`getScreen()==LOGIN` 时重连遮罩 show 被跳过（不弹）。
- i18n：`net.*` 11 键齐备（connLost/connLostSub/reconnecting/reconnectProgress/reconnected*/connFailed*/logoutReason），键设计已够用。

**屏状态机（State.ts）**
- `transition()` 每次无条件 `hideAll()`，只调用 `showBoot()/showLogin()`（其余 show* 是空实现，实际渲染在 `showPanelFor`）。
- Valid 表 `LOGIN→SERVER_SELECT→CHAR_SELECT→WORLD→…`。**无 CHAR_SELECT→SERVER_SELECT 边**（选服落在三步必返登录；服务器列表不缓存，回来要重拉）。

### 1.3 问题清单（编号 = 后续引用）

| # | 严重度 | 问题 | 位置 |
|---|---|---|---|
| U01 | 高 | **无设计系统**：全 UI 内联样式，颜色/间距/圆角/字体散落 6 个文件，改一次视觉要改 N 处 | 全部 |
| U02 | 高 | **选服页无状态**：无退出登录/空态/连接中/失败框，进不去选服时用户面对"死掉的列表" | ServerSelect.ts |
| U03 | 高 | **send() 静默丢包**：连接没开时点任何按钮 = 无反馈、无队列、无提示（违反 #12） | transport.ts |
| U04 | 中 | **登录页无反馈态**：点登录到有结果之间无 loading；报错只有一行裸红字 | LoginPanel.ts:17 |
| U05 | 中 | **选角职业面板是空壳**：`jobDesc/jobAttr` 恒空，选了职业看不出"这是什么职业" | CharSelect.ts:426-430 |
| U06 | 中 | **选角无返回选服**：从选服进选角后没有"回上一步"，且 VALID 表无此边 | State.ts |
| U07 | 中 | **i18n 债**：`创建失败 (${r.errorCode})` 硬编码中文（`failedRetry` 键存在未用）；error.* 走 `?? error` 兜底 | main.ts:690-699 |
| U08 | 低 | **配色与游戏内不一致**：选服胶囊 `rgba(15,15,24,.55)` vs 选角 `#222/#3a5a3a` vs 场景 `#1a1a2e`，三套暗色互相打架 | ServerSelect/CharSelect |
| U09 | 低 | 选角 list 模式与 create 模式之间的切换是硬 `display` 切换，无过渡 | CharSelect.ts:699-721 |
| U10 | 低 | 加载页只有 show/hide，无"当前在做什么"的文案槽（标题是 main.ts 现拼的） | main.ts:531-556 |
| U11 | 低 | 重连遮罩配色（`#3a2320` 暗红底）与其余 UI 无一致性来源 | main.ts connOverlay |

**优先级结论**：U01/U02/U03 是本轮必改；U04/U05/U06/U07 一并收；U08-U11 随设计系统落地自然消失。

---

## 二、重新设计

### 2.1 设计方向

经典 MMORPG 前置体验 —— 「暗色北欧月夜」基调：深蓝黑底色、暖金强调、星屑式点缀。
不跟随现代 SaaS 白卡片风；要的是**游戏开场**感（登录是自己角色的第一次亮相）。

三个支柱：
1. **可读性优先**：所有文字站在稳定底衬上（面板/暗化/描边），原画只是氛围，不能牺牲对比度。
2. **一致来源于一处**：颜色/字体/间距/圆角全部进 token，UI 代码只引用 token，不再手写色值。
3. **每个动作都有回声**（AGENTS #12）：loading、成功、失败、断线，都有显式状态与文案，绝不静默。

### 2.2 设计 Token（CSS 变量，`src/ui/theme.css`）

```
:root {
  /* 色板：暗青基 + 暖金 + 一条寒光蓝做次级 */
  --c-bg:        #0b0f14;   /* 全屏底（选角场景也统一到这附近） */
  --c-panel:     #141a22;   /* 面板底 */
  --c-card:      #1c2430;   /* 卡片/行底 */
  --c-card-hi:   #242e3c;   /* 选中/悬停 */
  --c-border:    rgba(255,255,255,0.08);
  --c-border-hi: rgba(255,255,255,0.18);
  --c-text:      #e8e4da;   /* 主文字 */
  --c-text-dim:  #a9a79e;   /* 次文字 */
  --c-muted:     #6f726c;   /* 占位/禁用 */
  --c-primary:   #c9a227;   /* 暖金：主按钮/选中/焦点 */
  --c-primary-hi:#e0ba4a;
  --c-ok:        #5da56d;   /* 成功：进入游戏/连接成功 */
  --c-bad:       #c2554f;   /* 失败/错误 */
  --c-info:      #6ea8d8;   /* 信息：位置/连接中 */

  /* 字体（全部系统栈，不下载 woff —— 中文场景自带宽） */
  --f-sans: "Segoe UI", "Microsoft YaHei UI", "PingFang SC", "Hiragino Sans GB", system-ui, sans-serif;
  --f-serif: Georgia, "Times New Roman", serif;   /* 只在 Latin 大标题点缀用 */

  /* 尺度 */
  --r-sm: 4px; --r-md: 6px; --r-lg: 10px;
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px;
  --t-xs: 11px; --t-sm: 12px; --t-md: 14px; --t-lg: 18px; --t-xl: 24px;
  --z-sys: 1400;      /* loading 遮罩（永远顶） */
}
```

> 决策记录：
> - **不引入 web 字体**（AGENTS 前提 + 中文 woff 动辄 1MB+，为一句标题不值得）。黄金标题用系统衬线 + 字距宽松
>   （`letter-spacing:.1em`）顶替"雕花体"的手感。
> - 主色放弃火红/纯绿，取**暖金**做 CTA 与选中：与现有 `#f0c040`（选角已用）同族，平滑迁移、减少跳跃。
> - 场景底 `#1a1a2e` → `#0b0f14`：三个暗色统一成一个。

### 2.3 组件规范（本阶段用的最小集）

**button**（primary / ghost 两态 + disabled）
```
primary: bg var(--c-primary) 文字 #101010 加粗; hover 提亮;
ghost:   透明底, 1px var(--c-border), 文字 var(--c-text); hover 底 fl-card-hi;
disabled: 文字 var(--c-muted), 底 fl-card;
loading:  文字前加 "◌ " 前缀（不换布局、不加 spinner DOM）
```

**input**
```
底 var(--c-panel), 1px var(--c-border), 内边距 8px 12px, 圆角 var(--r-sm);
focus: outline 2px var(--c-primary)/40（不位移、不改 border，避免跳动）;
::placeholder color var(--c-muted);
```

**panel 容器**
```
背景 var(--c-panel)；若压在原画上 → 加 :before 半透明暗化层（不用整体 opacity，保护子元素对比度）；
标题 18px 加粗 + 下边距；宽高按内容，不再裸 `position:absolute;inset:0`。
```

**overlay（重连 / 全屏态共用）**
```
背景 rgba(6,8,12,0.86)；中央卡 = panel 样式 + 标题/副文/操作区三层；
标题 22px var(--c-text)；进度文本（attempt/total）用 var(--c-info)。
```

**卡片行（角色卡 / 服务器行）**
```
底 var(--c-card)；hover fl-card-hi；选中 2px var(--c-primary) 边框 + 底 fl-card-hi；
主行 = 名字（14px 加粗），次行 = 派系色点 + 职业·等级 / 服务器状态点。
状态点：● online var(--c-ok) / ○ offline var(--c-muted) / ◐ connecting var(--c-info)。
```

**细节**：所有可点击项的 `cursor:pointer`；焦点全程可见（键盘可达）；禁用态允许但**写明原因**（#12）。

### 2.4 关键页面线框

**登录**（保持垂直居中，结构升级）
```
[ 原画(全屏) + vignette ]
    标题   《JPsTale》                     ← 衬线 28px + 字距
    副标   server.tagline（可空则隐藏）     ← 次文字
    错误行  var(--c-bad) 细字（原红字→token）
    [用户名]  [密码]
    [ 登 入 ] (primary, 按下即 "◌ 正在验证…")
    版本号   build 角标（左下角，muted）
```

**选服**（改自 35 行版，加状态）
```
    标题   选择服务器
    [服务器行 × N]       状态点 ●/◐/○
    -- 空态：  "暂无可用服务器"  + 重试按钮（#12：必须可见、可操作）
    -- 连接中： 列表区显示 "正在连接…"
    -- 失败：  列表上方错误条 + 重试
    [ 退出登录 ] (ghost, 底部)
```
> 服务器列表进入即拉；拉取中不能只空白（U02）。

**选角 list**
```
┌──────────────────────────────────────────┐
│ 3D 预览（右侧主区）                       │   ← 保留
├──────────────────────────────────────────┤
│ 左侧 300px：                             │
│  标题 选择角色                            │
│  [角色卡 × N]                            │
│  ── 空态： "还没有角色"（创建=唯一动作）──│
│  [进入游戏] primary                      │
│  [创建角色] ghost                        │
│  [换账号]    ghost                        │
│  [返回服务器] ghost ← U06：新增          │
└──────────────────────────────────────────┘
```
> 角色卡补一个数据点：把 `job`/`level`/`location` 用派系色点 + 两行排，不再裸一行灰字。

**选角 create**（三栏不变，补真数据）
```
│ 左：职业名 + 描述(26px)           中：3D         右：职业网格 / 脸型 / 名字 / 创建+返回
│                                      预览           ↑ U05：jobDesc/jobAttr 填充真描述（若暂无数据写"待接入"而非留白）
```
> 脸型从 3 格按 `FACE_RANGE`（char-loader.ts 唯一常量）渲染，不再硬编码 3。

**进图加载**（沿用现绿条/字节机制，只补层级）
```
  原画(暗化) → 中部框(下大框) → 绿色进度条(上小框) → 标题槽（"正在进入 {地图名}…"）
  右下角：已下载 / ~总量 · 速度 · 缓存命中 N     （现状已具）
```

**断线重连**（overlay 配色换 token，语义不变）
```
  "连接已断开" / "正在重新连接… (n/10)" / 成功后短暂 "已重连"
  按钮： [重新连接]（立即触发一次）/ 连不上时 [返回登录]
  ★ send() 改动：非 OPEN 时 → 若有会话：入待发队列并尝试重连；无会话：记一次可见失败（toast）
```
> 详规：`transport.send()` 改为「OPEN 直发；CONNECTING 入队；其余（CLOSED 且无会话）→ 触发一次例外的可见报错」。

### 2.5 状态矩阵（本阶段每屏必须覆盖）

| 屏 | 正常 | 加载/连接中 | 空 | 失败 | 断线 |
|---|---|---|---|---|---|
| 登录 | 输入可用 | 按钮"正在验证…" | — | 红字错误行（token） | — |
| 选服 | 行列表 | "正在连接…" | "暂无可用服务器"+重试 | 错误条+重试 | — |
| 选角 | 卡列表+3D | 创建中"正在创建…" | "还没有角色" | 创建失败行（i18n） | 见重连 |
| 进图 | 进度条+标题 | = 正常态 | — | 卡住 95% = 真相（不加假 100） | — |
| 重连 | "已重连" | "正在重新连接…(n/10)" | — | "无法连接"+返回登录 | 遮罩本体 |

---

## 三、实施顺序（批范围后按此执行）

每步 = 最小 diff + 对应回归手段。**阶段 1 与阶段 2 硬隔离**，不混。

### 阶段 1（本文件范围）

- **S1 `theme.css` + token 落地**：新建 `src/ui/theme.css`（2.2 内容）；Login/ServerSelect/CharSelect 的**新增与改动样式**改为引用 token；删除各文件手写色值中的重复项。回归：`npx tsc --noEmit` + 视觉比对（无像素回归测试，手动过一遍三屏）。
- **S2 选服页状态补齐（U02）**：加 空态/连接中/失败条/重试 + 退出登录按钮（`opts.onLogout` 已存在）。回归：跑一次"服务器列表返回空 / 连接失败"两个分支的本地 stubbing 验证。
- **S3 `transport.send()` 可见化（U03）**：非 OPEN 分支写死不可静默 —— 有会话入队 + 触发重连；无会话 `reportFallback('transport',…)`。回归：`send()` 三态单测（OPEN/CONNECTING/CLOSED）。
- **S4 登录反馈态 + i18n 债（U04/U07）**：按钮 loading 态；`创建失败` 改用 `gui.charCreate.failedRetry`；`error.*` 已有键不再 `?? 原文`（保留原文本兜底给未知 code，但 key 存在就别裸显示）。回归：`npx tsc` + 手测"错误密码"。
- **S5 选角补件（U05/U06）**：`jobDesc/jobAttr` 接数据源（暂无则 `t('gui.charCreate.selectJob')` 说明）；新加 `[返回服务器]` 按钮 → `showPanelFor(SERVER_SELECT)`（State.ts 补 `CHAR_SELECT→SERVER_SELECT` 边，服务器列表不重拉用缓存 —— 若 State.ts 没有缓存则先缓存）。回归：选角↔选服往返一次成功。
- **S6 收尾**：加载页加标题槽（`main.ts` 拼 `正在进入 {mapName}`，现有 `t('map.${mapId}')`）；重连遮罩换 token 色；全屏三屏配色对齐 `#0b0f14` 族。回归：完整走一遍 登录→选服→选角→进图。

### 阶段 2（另立文档，方向先行）

游戏内 React 面板（背包/属性/技能/地图/聊天/系统菜单/死亡三选项）：
- 沿用同一 token 文件（`theme.css` 在阶段 1 已是全局唯一来源），面板直接 `var(--c-*)`。
- 组件层（`src/ui/react/` 内既有 PanelShell）逐步替换手写 `worldmap.css`/`panels.css` 中的散值。
- 不与阶段 1 并行，避免两处改色互相踩。

---

## 四、待用户批定的口径

1. **主色**：暖金 `#c9a227`（与现状 `#f0c040` 同族，平滑迁移）—— 还是坚持欧服原味更深金的 `#b8860b` 系？默认前者。
2. **不引字体**：标题用系统衬线顶替雕花体 —— 认可则照此；坚持要 woff 需另评估体积/缓存策略。
3. **选角场景底色**：`#1a1a2e` → `#0b0f14` 统一 —— 认可则改；在意"蓝调更魔幻"可留 `#10141f` 微调。
4. **S5 的返回服务器**：确认要加（推荐加，选服页重拉列表成本低）。
5. **范围确认**：上述 S1–S6 是否批准开工；阶段 2 是否本轮先只写方向文档。

---

> 附：本文列出的代码位置均为勘察时点（2026-09-17）实指；开工若文件已变以最新为准。