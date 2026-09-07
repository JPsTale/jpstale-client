# JPsTale Web 客户端 — 工程架构与决策记录

> 本文是 jpstale-web 的架构准绳。代码必须服从本文；修改架构须先改本文再动代码。

## 1. 冻结的技术决策

| 项 | 决策 | 说明 |
|----|------|------|
| **引擎** | three.js（保持 0.160.0，npm 安装） | 调研代码（maps/pviewer）已用 0.160 验证跑通，绑定层可直接迁移。无致命 bug 不升级。 |
| **语言/构建** | TypeScript + Vite | 已建成骨架（js package.json / vite.config.ts / tsconfig.json / index.html） |
| **UI/状态（面板层）** | 高频 HUD/小地图 = canvas；低频文本面板（角色/装备/技能/聊天/设置）= React + 外部 gameStore | 主循环驱动部分保持 canvas（位图原生，canvas 内不写整句动态文字）；React 只挂低频面板层（`src/ui/react/`，打开才渲染，不参与每帧）。状态单向流动：`net/bridge → app/gameStore → ui/react`（React 只读渲染，写动作走 bridge 发消息） |
| **仓库边界** | 客户端独立仓库（`jpstale-client`），不进 pt-web-server | 资产 `/res`（废弃 `/pt/exm-run/`）| 做成 `ASSET_BASE` 可配置常量；dev 用 vite 插件把本地游戏资产根映射到 `/res`（不拷贝版权资产、不污染构建产物）| 
| **网络传输** | 二进制 proto over WS `:10008`（浏览器主通道）；TCP:10007 供原生客户端 | client `net/transport` 走 protobuf（encodeClient/decodeServer）；服务端 `JsonToProtoHandler` 保留旧 JSON 信封回退。网络消息语义唯一真源是 proto |
| **面板层框架** | React（`react` + `react-dom`，TSX），volatile 用 `useSyncExternalStore` 接 gameStore | 不引状态库/ui 组件库；dev 无 fast-refresh（可验证性优先，改面板整页刷新；需要时再评估 `@vitejs/plugin-react` 与 Vite 的兼容） |
| **动画管线** | RemotePlayer/Monster/NPC/角色统一一套 | 共享 inx/smb 解析 → 骨骼 → 动画状态机 |
| **渲染策略** | 用 TS 重写渲染核心（不直接引用调研 JS） | 调研代码是 JS，重写为 TS 正式模块 |
| **协议真源** | `pt-common/src/main/proto/base/message.proto` + `common.proto` | 网络消息语义的唯一依据 |

## 2. 服务器真实形态（已确认，供 net/ 与 render/ 参照）

- **二进制 proto over TCP:10007**（NettyServer）：`LengthFieldBasedFrameDecoder(16MB, 0, 4, 0, 4)` = 4 字节长度前缀 + protobuf。纯 TCP，浏览器原生无法直连。
- **浏览器主通道：二进制 proto over WebSocket:10008**（/pt/ws）：client `transport.send(encodeClient(msg))`，服务端 `WebSocketServer + JsonToProtoHandler`（对旧 JSON 信封兜底映射）。proto 消息语义见 `pt-common/src/main/proto/base/message.proto`。
- 移动（movement-sync 已迭代）：客户端 `playerMove {angle, running, x, y, z}` 上行，服务端权威校验后回推 `PlayerState`；客户端预测距离 = 档位走/跑世界速度 × dt，快照漂移超阈值收敛。**速度档位 1~51**（服务端 `GameConstants`：档速 = 250 + 10×档位，帧步长 `((speed×coeff)>>8)/256` @60fps，coeff 走 180/跑 460）。
- 攻击：`game.attack {targetId}`，距离 ≤150 每 1s 一发。

## 3. 工程目录与依赖方向（单向，绝不逆向）

```
src/
  main.ts             # 启动：创建各层 → 状态机（登录/选角/WORLD 切换）
  app/                # 应用外壳 + 全局状态
    State.ts          #   屏幕状态机（AppScreen/transition/getScreen）
    gameStore.ts      #   框架无关状态 store（character/player/openPanel 快照；React 层只读）
  core/               # 纯逻辑层，零 three/DOM 依赖
    binary.ts        #   readCString（统一，去重复）
    smb-parser.ts    #   角色骨骼/动画 .smb/.smd
    smd-parser.ts    #   地图 .smd 解析
    texture.ts       #   BMP/TGA 加密解码
    sm-sin.ts        #   正弦/余弦查找表
  render/            # three.js 绑定层，无业务逻辑
    map-renderer.ts  #   地图渲染（wind/water/fog/lightmap）
    skinned-builder.ts # 骨骼 → SkinnedMesh
    texture-loader.ts  # 解码 → THREE.Texture
    model-cache.ts     # 模型预加载缓存
  net/               # 网络（浏览器直连 10008，二进制 proto）
    transport.ts     #   ws 封装（重连/心跳/ping 时间同步）+ onMessage/onJsonMessage
    protocol.ts      #   ClientMessage 构造（encodeClient/decodeServer）
    proto/base_message.d.ts # protobufjs 解析类型
    bridge.ts        #   proto 消息 → app/gameStore（订阅 onMessage）
  ui/
    WorldView.ts     #   three 场景：自机预测 + 远端插值 + 小地图/昼夜
    Hud.ts           #   HUD canvas（1280×720 缩放、位图、pointer-events:none）
    CharSelect.ts / LoginPanel.ts / ServerSelect.ts / LoadingScreen.ts
    KeyBinding.ts / KeyBindingPanel.ts / SystemSettingsPanel.ts
    react/           # React 面板层（低频文本面板）
      mount.tsx      #   createReactPanels()：挂载根，show/hide/toggle（store.openPanel）
      PanelsRoot.tsx #   按 openPanel 渲染唯一面板（互斥单值）
      PanelShell.tsx #   通用外壳：遮罩/align(left|center)/关闭
      CharStatusPanel.tsx # 角色信息面板（左侧详情栏，C 键进入），替代原 canvas 版
      panels.css
  i18n/              # t()/setLocale + locales/{zh,en}.json
```

## 4. 各层要点

- **core/**：从调研代码原样翻译，统一清理重复（readCString、matMulRow、两套 texture 解码器）。忠实还原二进制格式，不做算法"优化"（逆向代码，改算法会破坏兼容）。
- **render/**：map-renderer 去掉 `window.__pt*` 全局钩子；updateDayNight/updateScroll/updateWater/updateWind 直接复用（逐帧时间参数 t*1000）。
- **world/**：快照驱动实体；补插值/朝向（spawn-debug 是 teleport 式）；Monster state 直接映射动画状态机（CHASE→RUN/ATTACK→ATTACK/IDLE→STAND）。
- **net/**：`transport` 发送二进制 proto（encodeClient）；`bridge` 订阅消息把 S2C 状态写进 gameStore。写动作（allocStat/playerMove）由调用方经 `protocol.ts` 构造后 `send()`。
- **ui/react/**：只渲染 `openPanel` 对应的唯一面板（互斥天然）；面板数据只从 `useSyncExternalStore(subscribeGame, getGameSnapshot)` 读，写发动作走 bridge，禁止直接改 store 外状态。

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
- [x] Phase 1（feat/ui）：React 面板层基建（gameStore + bridge + PanelsRoot/PanelShell），构建验证通过；HUD 与 canvas 面板不受影响
- [x] Phase 2：CharStatusPanel 替换 canvas CharacterPanel（C 键进入，加点闭环走 bridge），canvas 版已移除
