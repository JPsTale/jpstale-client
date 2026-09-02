# PT HUD 系统深度分析（Web 客户端适配版）

> 基于 ex-machina 源码全量分析，面向浏览器客户端的适配设计

## 1. 原版架构总结

### 1.1 坐标系

原版使用 **800×600 设计坐标系**，通过 `dsDrawOffset` 机制适配不同分辨率：

```cpp
// Main.cpp:287-288
g_fWinSizeRatio_X = (float)WinSizeX / 800.f;
g_fWinSizeRatio_Y = (float)WinSizeY / 600.f;
```

三种适配方式并存：
- **dsDrawOffset**：`offset = (WinSizeX-800, WinSizeY-600)`，根据锚点方向（LEFT/TOP/RIGHT/BOTTOM）自动偏移
- **g_fWinSizeRatio**：直接乘以设计坐标（仅 Bellatra 字体和 FullZoomMap 使用）
- **硬编码**：大部分 UI 直接写死 800×600 坐标

**关键发现**：原版没有真正的 UI 缩放系统。窗口拉大后，800×600 的 UI 区域保持不变，右侧多出的空间用 inter 条填充。

### 1.2 窗口行为

原版窗口 `WS_OVERLAPPEDWINDOW`（可拖拽调整大小），但只支持 3 种固定分辨率（800×600/1024×768/1280×1024）。超出范围时 UI 不会缩放，只是右侧出现空白或 inter 条扩展。

### 1.3 渲染管线

```
1. 清屏
2. 设置 dsDrawOffsetArray = dsARRAY_BOTTOM（底部锚定）
3. 绘制底部 HUD（条、按钮、菜单背景）
4. 设置 dsDrawOffsetArray = dsARRAY_TOP（顶部锚定）
5. 绘制顶部 HUD（小地图、战斗效果）
6. 绘制 3D 场景
7. 绘制浮动文字、角色名称
```

## 2. 键盘快捷键系统

### 2.1 核心操作键

| 键 | 功能 | 源码位置 |
|----|------|----------|
| **方向键** | 角色移动（前后左右） | ActionGame.cpp:37-64 |
| **空格** | 左键攻击 / 自动拾取 | ActionGame.cpp:150 |
| **Ctrl**（按住） | 右键攻击 / 使用右手技能 | ActionGame.cpp:190 |
| **R** | 切换走路/跑步 | sinMain.cpp:273 |
| **Z** | 切换相机模式（手动/自动/锁定） | sinMain.cpp:285 |
| **TAB** | 切换小地图显示 | sinMain.cpp:279 |
| **C** | 打开/关闭角色状态栏 | sinCharStatus.cpp:708 |
| **S** | 打开/关闭技能栏 | sinSkill.cpp:1248 |
| **V** | 打开/关闭物品装备栏 | sinInvenTory.cpp:2360 |
| **X** | 打开/关闭系统菜单 | sinMain.cpp:266 |
| **D** | 打开组队窗口 | sinMain.cpp:290 |
| **Q** | 打开任务窗口 | sinMain.cpp:294 |
| **E** | 切换武器套装 A/B | sinInvenTory.cpp:2481 |
| **W** | 切换防具套装 A/B | sinInvenTory.cpp:2495 |
| **1/2/3** | 使用药水槽 1/2/3 | sinInvenTory.cpp:2383 |
| **Shift+1/2/3** | 分配药水到槽位 | sinInvenTory.cpp:2387 |
| **F1~F8** | 技能快捷键 | sinSkill.cpp:1184 |
| **Enter** | 打开聊天输入 | sinInterFace.cpp:1547 |
| **Ctrl+Enter** | 切换聊天面板显示 | sinInterFace.cpp:1549 |
| **Esc** | 关闭消息框 | sinMessageBox.cpp:910 |

### 2.2 Web 适配要点

- 原版用 Win32 `VRKeyBuff[]` 和 `sinGetKeyClick()` 检测按键
- Web 版需改用 `KeyboardEvent.code` / `keydown` / `keyup`
- **注意**：原版 S/C/V 等键与聊天输入冲突——聊天打开时这些键用于输入文字，不触发窗口操作
- **实现建议**：维护一个 `chatInputActive` 状态，聊天激活时屏蔽游戏快捷键

## 3. 小地图系统

### 3.1 场内小地图（右上角）

**位置**：`px = 656 + (WinSizeX-800)`, `py = 426 + (WinSizeY-600)` → 实际是 (656, 426) 起的 128×128 区域

**渲染层级**：
1. 半透明黑色背景（`dsDrawColorBox` alpha=128）
2. 场地缩略图（`sCompactMap[0/1].hTexHandle`）——两张叠加
3. 边框（`Image\MapBox.dds`）
4. 玩家方向箭头（`MatArrow`，带旋转角度）
5. NPC 位置点（`MatNpcPos`）
6. 标题栏（场地名称，16px 高）

**数据**：`sCompactMap[4]` 数组，每个场地一张缩略图 + 标题图

### 3.2 全屏世界地图（TAB 切换）

**位置**：全屏覆盖（0,0）800×600
**纹理**：`image\GuideMap\_AFull.dds`（边框）+ 31 个区域地图图 + 31 个高亮图
**交互**：显示玩家位置、队友位置、区域名称高亮、退出按钮

### 3.3 Web 适配方案

- 场内小地图：Canvas 2D 绘制，右上角定位，窗口缩放时保持右上角锚定
- 缩略图数据：从服务端获取当前地图的 minimap 纹理（或程序化生成）
- 全屏世界地图：后续实现，当前不需要

## 4. 角色血条显示

### 4.1 自身 HUD 血条（屏幕底部）

即 sinInterFace 的 HP/MP/STM/EXP 条，800×600 坐标系内。

### 4.2 他人/NPC 血条（角色头顶）

**位置**：角色头顶 `MidX - (w>>1) + 5, MidY - (h>>1) + h + 2`
**渲染**：
1. 背景框（`Energy_Red.dds`，128×16）
2. 填充条（`Energy_Blue.dds`，颜色随 HP% 变化）
3. 颜色插值：HP>50% → RGB(255-p, 255, 0) 绿黄；HP<50% → RGB(255, p, 0) 红黄

**缩放**：`fSize = WinSizeX / 800.0f`（按分辨率缩放）

### 4.3 名称显示

**位置**：血条上方
**颜色**：玩家 RGB(255,160,120) 橙红；NPC RGB(255,255,180) 淡黄
**阴影**：黑色偏移 (+1, -1)

### 4.4 Web 适配方案

- 自身 HUD：Canvas 2D 按比例绘制（已实现）
- 他人血条：在 WorldView 3D 场景中，将角色世界坐标投影到屏幕坐标后绘制
- 名称：同上，Canvas 2D overlay

## 5. 战斗浮动文字/伤害数字

### 5.1 命中计数板（右上角 HoEffectHitBoard）

**位置**：固定 (725, 50)
**类型**：
- **普通命中**：数字精灵表（HitCount.dds，每数字 11×14），4 帧动画缩放 32→80
- **暴击**：显示 "Critical" 横幅（HitCount.dds 第二行），缩放 70→210

**纹理**：
- `Effect\Etc\HitBackBoard.dds`（圆形背景 32×32）
- `Effect\Etc\HitCount.dds`（数字精灵表 128×64）

### 5.2 防御/格挡/闪避指示器（底部中央 HaEffect）

**位置**：固定 (354, 488)，初始 128×64
**类型**：
- `HA_DEFANCE=1` → `defense.dds`
- `HA_BLOCK=2` → `block.dds`
- `HA_EVASION=3` → `Evade.dds`

**动画**：停留 510ms 后扩散淡出（alpha 255→0，size +3/tick）

### 5.3 伤害数字（飘字）

需要进一步分析，搜索伤害飘字系统。但从现有数据看，原版的伤害数字通过 `HoEffectHitBoard` 显示在右上角，而非飘在角色头上。

### 5.4 Web 适配方案

- 右上角命中板：Canvas 2D 固定位置，动画用 requestAnimationFrame
- 防御/格挡/闪避：Canvas 2D 叠加，底部中央
- 伤害飘字：如果需要（现代 ARPG 飘字），在 3D 世界坐标投影后绘制

## 6. UI 窗口系统（背包/技能/角色状态）

### 6.1 面板布局

三个主面板都从屏幕底部滑入，固定 800×200 尺寸：

| 面板 | 纹理 | 位置 |
|------|------|------|
| 角色状态 | CharStatus.dds | y = 600 - slideOffset + 56 |
| 背包 | InvenMain.dds | y = 600 - slideOffset + 56 |
| 技能 | Skill.dds | y = 600 - slideOffset + 56 |

滑入动画：`sinMoveKindInter[type]` 从 0 增加到目标值，面板从底部滑入。

### 6.2 交互机制

- 点击按钮或按快捷键 → `OpenFlag` 在 `SIN_OPEN/SIN_CLOSE` 间切换
- `CheckAllBox()` 确保同一时间最多一个面板打开
- 面板打开时聊天框上移 170px（`SubChatHeight=170`）

### 6.3 Web 适配方案

- 面板用 HTML/CSS 实现（比 Canvas 更适合复杂交互）
- 滑入动画用 CSS transition
- 响应式：面板宽度跟随窗口，但内容区域保持固定比例

## 7. 光标系统

### 7.1 原版光标类型

| 光标 | 文件 | 用途 |
|------|------|------|
| Default | default.cur | 默认 |
| Attack | attack.cur | 悬停敌人 |
| Talk | talk.cur | 悬停 NPC |
| GetItem | drop.cur / pickup.cur | 悬停物品 |
| Sell/Buy/Repair | sell.cur / buy.cur / repair.cur | 商店交互 |

### 7.2 Web 适配方案

- 使用 CSS `cursor` 属性 + 自定义 .cur/.png 光标文件
- 根据鼠标下方对象动态切换

## 8. Web 客户端自适应设计

### 8.1 核心问题

原版 800×600 固定设计 → Web 需要从手机（360×640）到 4K（3840×2160）全适配。

### 8.2 推荐方案：设计基准 + 等比缩放

**设计基准**：800×600（与原版一致，所有坐标直接复用）

**缩放策略**：
```
scale = min(viewportW / 800, viewportH / 600)
canvasW = 800 * scale
canvasH = 600 * scale
canvas 居中显示，两侧/上下留黑边
```

**效果**：
- 1920×1080 → scale=1.8 → canvas 1440×1080 → 左右各 240px 黑边
- 3840×2160 → scale=3.6 → canvas 2880×2160 → 左右各 480px 黑边
- 360×640（手机竖屏）→ scale=0.6 → canvas 480×360 → 上下留空

**优点**：
- 所有原版坐标直接复用，不需要重新计算
- 位图清晰（1:1 绘制后 CSS 缩放）
- 布局比例与原版完全一致

**缺点**：
- 宽屏设备两侧有黑边（但原版就是这样）
- 手机竖屏下 HUD 太小

### 8.3 备选方案：自适应布局

不使用固定画布，而是将 HUD 元素按锚点分布：
- HP/MP/STM/EXP 条 → 左下角锚定
- 6 功能按钮 → 底部居中
- 小地图 → 右上角锚定
- 命中计数板 → 右上角锚定

每个元素独立缩放，使用相对定位（% 或 vw/vh）。

**优点**：充分利用屏幕空间，无黑边
**缺点**：需要重新计算所有坐标，与原版布局有差异

### 8.4 推荐：方案 A（等比缩放）

理由：
1. 原版坐标可直接复用，减少错误
2. 与原版视觉效果一致
3. 实现简单，不需要为每个元素单独处理适配
4. 黑边可接受（原版在宽屏下也是这样）

## 9. 完整 HUD 元素清单（实现优先级）

### P0 — 核心（必须）
- [ ] HP/MP/Stamina/EXP 条（已实现，需验证坐标）
- [ ] 6 功能按钮（角色/背包/技能/组队/任务/系统）
- [ ] Walk/Run、相机、地图按钮
- [ ] 键盘快捷键（R/Z/TAB/C/S/V/X）

### P1 — 重要
- [ ] 小地图（场内 128×128）
- [ ] 日月时钟
- [ ] 技能槽（左右手）
- [ ] EXP 百分比文本
- [ ] 鼠标悬停提示（HP/MP/STM 数值）

### P2 — 增强
- [ ] 战斗命中计数板（右上角）
- [ ] 防御/格挡/闪避指示器
- [ ] 角色头顶血条 + 名称
- [ ] 自定义光标

### P3 — 完整
- [ ] 背包/技能/角色状态面板（HTML/CSS）
- [ ] Exit 菜单
- [ ] 聊天系统
- [ ] 全屏世界地图

### P4 — 扩展
- [ ] inter 技能条（右侧扩展）
- [ ] Menu-1/Menu-2 背景
- [ ] 伤害飘字
- [ ] 战斗特效（HaEffect 动画）
