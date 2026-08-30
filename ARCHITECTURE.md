# JPsTale Web 客户端 — 工程架构与决策记录

> 本文是 jpstale-web 的架构准绳。代码必须服从本文；修改架构须先改本文再动代码。

## 1. 冻结的技术决策

| 项 | 决策 | 说明 |
|----|------|------|
| **引擎** | three.js（保持 0.160.0，npm 安装） | 调研代码（maps/pviewer）已用 0.160 验证跑通，绑定层可直接迁移。无致命 bug 不升级。 |
| **语言/构建** | TypeScript + Vite | 已建成骨架（js package.json / vite.config.ts / tsconfig.json / index.html） |
| **UI/状态** | 原生 DOM overlay + 模块化 TS，不引 UI 框架 | MMO 客户端主循环驱动，非数据驱动；界面仅登录/选角/HUD 几屏 |
| **仓库边界** | 客户端独立仓库（`jpstale-web`），不进 pt-web-server | 已调研原型（maps/pviewer/spawn-debug/simulator）是过渡产物，最终迁出；客户端自包含 |
| **资产路径** | `/res/*`（废弃 `/pt/exm-run/`）| 做成 `ASSET_BASE` 可配置常量；**前端自持**：dev 用 vite 插件/静态中间件把 `E:\JPsTale\client` 映射到 `/res`（不拷贝版权资产、不污染构建产物）；生产指向部署位置 |
| **网络传输** | JSON over WS `:10008`（/pt/ws），proto 为语义基准 | net/ 做 transport 抽象，将来可切二进制 proto（需服务端新增 WS 通道） |
| **动画管线** | RemotePlayer/Monster/NPC/角色统一一套 | 共享 inx/smb 解析 → 骨骼 → 动画状态机 |
| **渲染策略** | 用 TS 重写渲染核心（不直接引用调研 JS） | 调研代码是 JS，重写为 TS 正式模块 |
| **协议真源** | `pt-common/src/main/proto/base/message.proto` + `common.proto` | 网络消息语义的唯一依据 |

## 2. 服务器真实形态（已确认，供 net/ 与 render/ 参照）

- **二进制 proto over TCP:10007**（NettyServer）：`LengthFieldBasedFrameDecoder(16MB, 0, 4, 0, 4)` = 4 字节长度前缀 + protobuf。纯 TCP，浏览器原生无法直连。
- **JSON over WebSocket:10008**（WebSocketServer + JsonToProtoHandler）：浏览器直连通道。`{type, data}` 信封，服务端 JSON→proto 进业务（toClientMessage / serverMessageToJson 一一映射）。
- 登录流程（spawn-debug 已验证）：`auth.login` → `auth.serverList` → `auth.selectServer` → `auth.characterList` → `auth.selectCharacter` → `auth.enterGame`（S2C_PlayerState → `auth.enterGame`）→ `game.enterMap` → `game.mapEntered` → `map.aabbs` → 快照 `game.snapshot`（≈150ms 全量覆盖）。
- 移动：客户端 `game.moveInput {angle, running}` 意图上行，服务端权威推位置；客户端预测 `speed*0.05`/tick，快照漂移>20 时 20% 拉回（静止硬同步）。
- 攻击：`game.attack {targetId}`，距离 ≤150 每 1s 一发。

## 3. 工程目录与依赖方向（单向，绝不逆向）

```
src/
  main.ts             # 启动：createApp → 挂载场景 → 状态机
  app/                # 应用外壳 + 主循环
    App.ts            #   渲染器 + 相机 + 渲染循环（three）
    Game.ts           #   主循环（RAF）：输入→状态同步→动画→render
    State.ts          #   全局客户端状态
  core/               # 纯逻辑层，零 three/DOM 依赖，可单测
    binary.ts        #   readCString（统一，去重复）
    sm-sin.ts        #   正弦/余弦查找表（wind/water）
    smb-parser.ts    #   网格+骨骼二进制解析（角色/武器/动画 .smb/.smd）
    smd-parser.ts    #   地图 .smd 解析（几何/材质/UV/光照）
    inx-parser.ts    #   .inx 模型信息+加密动画条目
    texture.ts       #   BMP/TGA 加密解码（地图 vs 角色 colorkey 差异做成配置项）
    animation.ts     #   骨骼求值：quat/matMul/toYup/evalSkeleton
    collision.ts     #   地图碰撞网格（纯数据）
    anim-match.ts    #   动画条目匹配（精确/类型/职业）
    anim-state-machine.ts # 动画状态机（STAND/RUN/ATTACK…）
    weapon-type.ts   #   idCode→武器类型
    job-data.ts      #   10 职业身体/头/骨骼资源路径
    costume-body-map.ts # 时装→职业身体映射
    sitem-weapon-index.ts # sItem↔idCode 数据表
  render/            # three.js 绑定层，无业务逻辑
    map-renderer.ts  #   地图网格+材质+每帧剔除/shader（wind/water/fog/lightmap）
    skinned-builder.ts # 骨骼→THREE.Bone + SkinnedMesh
    texture-loader.ts  # 解码数据→THREE.Texture（flipY/colorspace 按场景配置）
    builders.ts      #   辅助几何（bone lines 调试）
  world/             # 游戏实体（调研代码没有，新增 MMO 核心）
    MapInstance.ts   #   一张图：地图渲染+碰撞+camera
    Player.ts        #   本地控制玩家：输入→移动→动画状态机→渲染
    RemotePlayer.ts  #   远端玩家：服务器状态驱动（无本地输入）
    Monster.ts / NPC.ts # 服务器驱动实体（复用 RemotePlayer 动画管线）
    SpawnManager.ts  #   实体生命周期
    Lighting.ts      #   昼夜/场景光/火把
  net/               # 网络（transport 抽象）
    transport.ts     #   接口：connect/send/onMessage
    json-transport.ts #   实现1：JSON over WS:10008（现在用）
    protobuf-transport.ts # 实现2：二进制 proto over WS（将来，需服务端）
    protocol.ts      #   消息类型定义（TS 类型对齐 proto）
    ws.ts            #   浏览器 WS 封装（重连/心跳）
  ui/                # 界面（原生 DOM overlay）
    LoginPanel.ts    #   登录
    CharSelect.ts    #   选角
    Hud.ts           #   血条/技能栏/小地图/聊天
  data/              # 静态索引数据（职业/武器/怪物表，源自 pviewer js+json）
```

**依赖方向**：`ui`/`world`/`render` → `core` + `net`；`core` 不依赖任何东西；`net` 不依赖 three。

## 4. 各层要点

- **core/**：从调研代码原样翻译，统一清理重复（readCString、matMulRow、两套 texture 解码器）。忠实还原二进制格式，不做算法"优化"（逆向代码，改算法会破坏兼容）。
- **render/**：map-renderer 去掉 `window.__pt*` 全局钩子；updateDayNight/updateScroll/updateWater/updateWind 直接复用（逐帧时间参数 t*1000）。
- **world/**：快照驱动实体；补插值/朝向（spawn-debug 是 teleport 式）；Monster state 直接映射动画状态机（CHASE→RUN/ATTACK→ATTACK/IDLE→STAND）。
- **net/**：transport 抽象，现在 JSON 实现；`/pt/ws` 端点（连 10008 时注意 vite proxy 与 nginx 路由）。

## 5. 当前进度

- [x] 骨架（package.json/tsconfig/vite.config/index.html）— Vite 启动验证 HTTP 200
- [x] three 0.160.0 + typescript + vite 依赖已装
- [x] 架构文档冻结（本文）
- [x] E: 离线渲染 demo（core 纯解析层 + render 绑定层）——已迁移并渲染 fore-1
  - core/smd-parser.ts（maps smd-parser.js TS 化）
  - core/texture.ts（maps texture-decoder.js TS 化）
  - render/texture-loader.ts（loadGameTexture：二进→DataTexture）
  - render/map-renderer.ts（maps map-renderer.js TS 化，去掉 `window.__ptWindAmpScale`，shader wind/water/fog/lightmap/昼夜/火把）
  - maps/fore1.ts（单图加载 /res + getMatConfig + 帧动画）
  - main.ts（OrbitControls + 每帧 updateScroll/Wind/Water + 帧动画 + render 剔除）
  - 资产经 vite devAssets `/res` → `E:\JPsTale\client`；fore-1 静态+风/水/滚动已在浏览器渲染通过
- [ ] 碰撞网格（render/collision，maps collision.js TS 化）
- [ ] 登录→选角→进图联网链路（net/ + ui/）
