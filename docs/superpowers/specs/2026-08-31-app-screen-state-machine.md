# JPsTale Web 客户端 — 应用级屏幕状态机 + 网络层 + i18n

> 本文定义 jpstale-web 客户端的**应用级屏幕状态机**、**网络通信层**、**i18n 国际化**的完整设计。
> 是 `app/State.ts`、`net/`、`ui/`、`i18n/` 实施的唯一依据。

---

## 1. 状态集（AppScreen 枚举）

| 状态 | 含义 | 界面 |
|------|------|------|
| `BOOT` | 启动 / 资源与连接初始化 | 加载条（DOM） |
| `LOGIN` | 登录主界面 | LoginPanel（DOM overlay） |
| `SERVER_SELECT` | 选择服务器 | ServerSelect（DOM overlay） |
| `CHAR_SELECT` | 角色列表 + 创建角色向导 | CharSelect（DOM overlay + three.js 3D 预览） |
| `WORLD` | 进入游戏世界 | 3D 场景 + Hud（DOM overlay） |

> **SETTINGS 覆盖层**不是独立状态，将来从任意状态可打开/关闭。

---

## 2. 状态转换拓扑

### 2.1 合法转换清单（唯一权威）

| 起 | 终 | 触发 | 副作用 |
|----|----|------|--------|
| `BOOT` | `LOGIN` | 启动完成 / 连接失败 | — |
| `LOGIN` | `SERVER_SELECT` | 登录成功（`auth.login` → `auth.serverList`） | 存会话 token |
| `SERVER_SELECT` | `CHAR_SELECT` | 选中服务器（`auth.selectServer` → `auth.characterList`） | 拉取角色列表 |
| `CHAR_SELECT` | `WORLD` | 选中角色进游戏（`auth.selectCharacter` → `auth.enterGame`） | 进入世界，加载地图 |
| `WORLD` | `CHAR_SELECT` | 游戏内"退出到主界面" | 释放世界资源，保留会话 |
| `WORLD` | `LOGIN` | 会话失效 / 强制断开 / 注销 | 释放世界 + 清会话 |
| `CHAR_SELECT` | `LOGIN` | 换账号 / 注销 | 清会话 |

> `CHAR_SELECT → SERVER_SELECT`（返回选服）：不需要。

### 2.2 每状态进入/退出副作用

#### BOOT → LOGIN
- **进入 BOOT**：加载静态索引（`data/`）；建立 WS 连接（`:10008`）。
- **退出 BOOT**：若连接未就绪，标记 `net.connected=false`，LOGIN 显示重试。

#### LOGIN
- **进入**：纯 DOM overlay，无3D场景。
- **退出**（→SERVER_SELECT）：无额外释放。

#### SERVER_SELECT
- **进入**：请求服务器列表（若 LOGIN 时未带）。
- **退出**：无。

#### CHAR_SELECT
- **进入**：拉取并渲染角色列表。
- **退出到 WORLD**：记录被选中角色信息，交给 World 初始化。
- **退出到 LOGIN**：清会话 + 断开。

#### WORLD
- **进入**：创建3D场景/相机；按角色出生地图加载地图资产；初始化本地 Player；订阅快照/实体。
- **退出到 CHAR_SELECT**：释放世界——销毁场景、卸载地图纹理/几何、断开快照订阅；保留 WS 连接与登录会话。
- **退出到 LOGIN**：上述 + 清会话 + 断开。

---

## 3. 网络层（net/）

### 3.1 连接管理（transport.ts）

- WebSocket URL：`ws(s)://{host}/pt/ws`
- 重连机制：断开后每3s 自动重试（仅 WORLD 状态且有 token 时）
- Token 机制：服务端120s 读空闲超时 → 发 `reconnect.token {token}` → 断开；客户端存储 token → 重连 → `auth.reconnect {token}` → 恢复 WORLD
- 心跳：依赖服务端 `IdleStateHandler`（120s），客户端无需额外心跳

### 3.2 消息格式

```json
{ "type": "<string>", "data": { ... } }
```

所有消息（双向）使用统一信封。`send(type, data)` 封装 `JSON.stringify`。

### 3.3 消息序列（已由 spawn-debug 验证）

#### 登录流程
| # | 方向 | type | data |
|---|------|------|------|
| 1 | C→S | `auth.login` | `{ username, password }` |
| 2 | S→C | `auth.loginResult` | `{ success, accountId, errorCode, errorMessage }` |
| 3 | S→C | `auth.serverList` | `{ servers: [{ id, name, online }] }` |
| 4 | C→S | `auth.selectServer` | `{ serverId }` |
| 5 | S→C | `auth.selectServer` | `{ success, serverId }` |
| 6 | S→C | `auth.characterList` | `{ characters: [{ characterId, name, classId, level, mapId, gold }] }` |

#### 角色创建
| # | 方向 | type | data |
|---|------|------|------|
| 7 | C→S | `auth.createCharacter` | `{ name, classId, head }` |
| 8 | S→C | `auth.createCharacter` | `{ success, errorCode, name, errorMessage }` |

#### 进入游戏
| # | 方向 | type | data |
|---|------|------|------|
| 9 | C→S | `auth.selectCharacter` | `{ characterId }` |
| 10 | S→C | `auth.enterGame` | `{ playerId, mapId, level, gold, exp, hp, maxHp, mp, maxMp }` |
| 11 | C→S | `game.enterMap` | `{ mapId }` |
| 12 | S→C | `game.mapEntered` | `{ mapId, mapName, player: {x,z}, config: {...} }` |
| 13 | C→S | `map.aabbs` | `{}` |
| 14 | S→C | `map.aabbs` | `{ aabbs: {...} }` |

#### 重连
| # | 方向 | type | data |
|---|------|------|------|
| 15 | S→C | `reconnect.token` | `{ token }` |
| 16 | C→S | `auth.reconnect` | `{ token }` |
| 17 | S→C | `auth.reconnect` | `{ success, playerId, mapId }` |

#### 错误码

服务端发送的 `errorCode` 数值直接作为 i18n key（`error.{code}`），无需语义命名。

| errorCode | i18n key | 中文 |
|-----------|----------|------|
| 0 | `error.0` | 连接失败 |
| -1 | `error.-1` | 账号不存在 |
| -2 | `error.-2` | 密码错误 |
| -3 | `error.-3` | 非测试玩家 |
| -4 | `error.-4` | 账号已登录 |
| -5 | `error.-5` | 有效期过期 |
| -6 | `error.-6` | 时长过期 |
| -8 | `error.-8` | 账号删除通知 |
| -12 | `error.-12` | 未满12岁 |
| -13 | `error.-13` | 需同意条款 |
| -16 | `error.-16` | 服务器繁忙 |
| -17 | `error.-17` | 请稍候 |
| -18 | `error.-18` | 第三连接 |
| -19 | `error.-19` | 密码格式错误 |
| -23 | `error.-23` | 登录被拒（至截止日） |
| -24 | `error.-24` | 登录被拒 |

> **⚠️ 未来优化：统一5位错误码**
>
> 当前服务端使用零散的负数错误码（-1, -2, -3...），缺乏统一规范。
> 计划升级为5位结构化错误码，规则如下：
>
> | 范围 | 归属 | 分组（每100） | 示例 |
> |------|------|---------------|------|
> | `10000-19999` | 客户端错误 | `10100` 输入校验 / `10200` 本地状态 | `10101` 用户名超长, `10102` 非法字符 |
> | `20000-29999` | 服务端错误 | `20100` 认证 / `20200` 业务逻辑 | `20101` 账号不存在, `20102` 密码错误 |
> | `30000-39999` | 第三方错误 | `30100` 网络 / `30200` 外部服务 | `30101` 连接超时 |
>
> 升级时只需替换服务端错误码 + 更新 `locales/*.json` 的 key，客户端 `t()` 调用方式不变。

---

## 4. UI 面板

### 4.1 LoginPanel（ui/LoginPanel.ts）

纯 DOM overlay。内容：
- 账号输入框 + 密码输入框
- 登录按钮
- 错误提示区域
- 连接状态/重试按钮

### 4.2 ServerSelect（ui/ServerSelect.ts）

纯 DOM overlay。内容：
- 服务器列表（名称 + 在线状态）
- 选择按钮
- 返回登录按钮

### 4.3 CharSelect（ui/CharSelect.ts）

DOM overlay + three.js 3D 预览。

#### 4.3.1 已有角色列表模式

- 角色卡片列表（名字 / 职业 / 等级）
- 选中角色 → "进入游戏" 按钮
- "创建角色" 按钮 → 进入创建向导
- "换账号" 按钮 → 回 LOGIN

#### 4.3.2 创建角色向导（4步子状态机）

```
CharSelect 内部状态：
  LIST          — 角色列表（默认）
  RACE_SELECT   — 选择种族
  JOB_SELECT    — 选择职业（3D预览切换）
  FACE_SELECT   — 选择脸型（3D预览切换）
  NAME_INPUT    — 输入角色名
```

**Step 1: 选择种族**

| 种族 | i18n key |
|------|----------|
| 坦普斯克隆 (Tempscron) | `race.tempscron` |
| 摩瑞恩 (Moryon) | `race.moryon` |

**Step 2: 选择职业**

| 种族 | 职业 | i18n key |
|------|------|----------|
| 坦普 | 武士 (Fighter) | `job.fighter` |
| 坦普 | 机械 (Mechanician) | `job.mechanician` |
| 坦普 | 弓箭手 (Archer) | `job.archer` |
| 坦普 | 枪兵 (Pikeman) | `job.pikeman` |
| 坦普 | 刺客 (Assassin) | `job.assassin` |
| 摩瑞 | 骑士 (Knight) | `job.knight` |
| 摩瑞 | 魔枪 (Atalanta) | `job.atalanta` |
| 摩瑞 | 祭司 (Priestess) | `job.priestess` |
| 摩瑞 | 法师 (Magician) | `job.magician` |
| 摩瑞 | 萨满 (Shaman) | `job.shaman` |

每步切换职业时，3D 预览更新对应角色模型（复用 `char-loader.ts` + `skinned-builder.ts`）。

**Step3: 选择脸型**

每个职业有2-3个脸型可选。3D 预览切换头部模型。

**Step4: 输入名字**

- 名字输入框（最多8字符，仅英文/数字/下划线）
- "创建" 按钮 → 发送 `auth.createCharacter {name, classId, head}`
- 成功 → 回到角色列表
- 失败 → 显示错误

**导航**：每步有"返回"按钮回到上一步。

### 4.4 Hud（ui/Hud.ts）

占位。WORLD 状态下显示的基础 HUD（血条/蓝条/等级/位置），后续迭代。

---

## 5. i18n 国际化

### 5.1 设计选型

| 原方案 | 问题 |
|--------|------|
| JPT2018 原版 `#ifdef` | 编译时切换，每语言一个 binary，不可热重载 |
| ex-machina 私服 | 无 i18n 系统，硬编码英文+遗留乱码 |
| **Minecraft `namespace:id`** | **运行时切换，数据驱动，加语言只加文件** ✅ |

采用 Minecraft 风格：嵌套 JSON 对象 + 点分隔键名 + 运行时切换。

### 5.2 架构

```
src/
  i18n/
    index.ts           # t(key, params?) + setLocale() + 嵌套键解析 + 加载 JSON
  locales/
    zh.json            # 中文（默认/完整）
    en.json            # 英文（预留，可后续补充）
```

JSON 文件放在 `locales/` 目录，与代码分离。Vite 支持 `import zh from '../locales/zh.json'` 直接导入。

### 5.3 键命名规范（Minecraft 风格）

格式：`category.subcategory.key`，嵌套 JSON 对象天然对应点分隔路径。

```json
// locales/zh.json
{
  "gui": {
    "login":    { "title": "登录", "username": "账号", "password": "密码", "submit": "登录" },
    "server":   { "title": "选择服务器", "online": "{count} 人在线" },
    "charSel":  { "title": "角色选择", "create": "创建角色", "enter": "进入游戏", "logout": "换账号" },
    "charCreate": {
      "race": "选择种族", "job": "选择职业", "face": "选择脸型", "name": "输入角色名",
      "back": "返回", "confirm": "确认", "create": "创建"
    }
  },
  "race": { "tempscron": "坦普族", "moryon": "魔灵族" },
  "job": {
    "fighter": "武士", "mechanician": "机械兵", "archer": "弓箭手",
    "pikeman": "枪兵", "assassin": "刺客",
    "knight": "骑士", "atalanta": "魔枪兵", "priestess": "祭司",
    "magician": "法师", "shaman": "萨满"
  },
  "error": {
    "0": "连接失败",
    "-1": "账号不存在",
    "-2": "密码错误",
    "-3": "非测试玩家",
    "-4": "账号已登录",
    "-5": "有效期过期",
    "-6": "时长过期",
    "-8": "账号删除通知",
    "-12": "未满12岁",
    "-13": "需同意条款",
    "-16": "服务器繁忙",
    "-17": "请稍候",
    "-18": "第三连接",
    "-19": "密码格式错误",
    "-23": "登录被拒（至截止日）",
    "-24": "登录被拒"
  }
}
```

### 5.4 翻译函数

```ts
// i18n/index.ts
import zh from '../locales/zh.json';
import en from '../locales/en.json';

const locales: Record<string, typeof zh> = { zh, en };
let locale = 'zh';

/** 点分隔键名查找，如 t('gui.login.title') → zh.gui.login.title */
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

export function setLocale(loc: string): void { locale = loc; }
export function getLocale(): string { return locale; }
```

### 5.5 运行时切换

- `setLocale('en')` → 全局切换，所有 `t()` 调用立即生效
- 无需重新加载页面
- 未翻译的 key 回退到中文，再回退到 key 本身

### 5.6 Locale 检测

1. `localStorage.getItem('locale')`（用户手动设置）
2. `navigator.language` 前缀匹配（`zh` → 中文，其他 → 英文）
3. 默认 `'zh'`

### 5.7 翻译范围

| 类别 | 内容 | 示例 |
|------|------|------|
| GUI 文字 | 按钮、标签、标题、占位符 | `t('gui.login.title')` → `'登录'` |
| 种族/职业名 | 静态游戏数据 | `t('job.fighter')` → `'武士'` |
| 错误消息 | 服务端错误码直接做 key | `t('error.-2')` → `'密码错误'` |

### 5.8 运行时数据处理

- 服务器名、角色名由服务端发送，客户端**原样显示**，不做自动翻译
- 如果服务端将来支持多语言，客户端按当前 locale 选择显示字段
- 当前实现：服务端发中文，客户端直接显示

### 5.9 与原版对比

| 方面 | JPT2018 原版 | 本方案 |
|------|-------------|--------|
| 切换方式 | `#ifdef` 编译时 | `setLocale()` 运行时 |
| 键命名 | C 变量名（`mgCloseGame`） | 点分隔（`gui.login.title`） |
| 新增语言 | 新编译 binary | 加一个 `.ts` 文件 |
| 热重载 | 不可能 | `setLocale()` 立即生效 |
| 类型安全 | 无 | TypeScript `typeof` 推导 |
| 字符编码 | Shift-JIS/Big5/混合 | UTF-8（浏览器原生） |

---

## 6. 文件结构

```
src/
  app/
    State.ts           # AppScreen 枚举 + transition(from, to, ctx)
    Game.ts            # 主循环 RAF（仅 WORLD 状态激活）
  net/
    transport.ts       # WebSocket 连接 + 重连 + token + send/onMessage
    protocol.ts        # 消息类型定义（对接 spawn-debug 的 {type, data} 格式）
  ui/
    LoginPanel.ts      # 登录面板（DOM）
    ServerSelect.ts    # 服务器选择（DOM）
    CharSelect.ts      # 角色选择 + 创建向导（DOM + three.js 3D 预览）
    Hud.ts             # 游戏内 HUD（占位）
  i18n/
    index.ts           # t() 翻译函数 + locale 管理
  locales/
    zh.json            # 中文
    en.json            # 英文（预留）
  main.ts              # 启动入口：init net → BOOT → transition(LOGIN)
```

### 依赖方向（单向）

```
main.ts → app/State.ts → ui/*, net/*, world/*
ui/* → net/*, i18n/*, core/*, render/*
net/* → （无 UI/three 依赖）
i18n/* → （无依赖）
core/* → （无依赖）
```

---

## 7. 与现有代码的衔接

- **角色渲染**：CharSelect 的3D预览复用 `char-loader.ts` + `skinned-builder.ts` + `animation.ts`（已验证可工作）
- **地图渲染**：WORLD 状态复用 `map-renderer.ts`（已验证 fore-1）
- **网络消息**：对接 `pt-web-server` 的 `JsonToProtoHandler` + `PacketRouterHandler`（spawn-debug 已验证全流程）
- **资产路径**：`/res/*` 映射到 `E:\JPsTale\client`（vite dev plugin 已配置）

---

## 8. 已确认决策

1. ✅ **5+5 职业**：坦普5个（武士/机械/弓箭手/枪兵/刺客），摩瑞5个（骑士/魔枪/祭司/法师/萨满）
2. ✅ **角色创建4步向导**：选种族→选职业→选脸型→输入名字，每步有3D预览
3. ✅ **完整网络层**：对接 spawn-debug 已验证的消息序列
4. ✅ **重连 + Token**：服务端120s 超时 → token → 断开 → 自动重连 → 恢复
5. ✅ **DOM overlay**：UI 用原生 DOM，不用框架
6. ✅ **仅 CHAR_SELECT 有3D预览**：LOGIN/SERVER_SELECT 无3D背景
7. ✅ **i18n 全量**：Minecraft 风格 `category.subcategory.key` 命名 + 嵌套 JSON + 运行时切换，中文优先预留扩展
8. ✅ **无 SETTINGS 覆盖层**：当前版本不做，保留扩展点
9. ✅ **无 fade 过渡**：先硬切屏幕，后加过渡动画
