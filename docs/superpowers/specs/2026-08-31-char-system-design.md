# 角色系统迁移设计(jpstale-web Char System)

日期:2026-08-31(补充:2026-09-01)
状态:设计稿,待审阅

## 1. 目标

把 `/pt/pviewer` 的角色模型解析、骨骼动画、装备模型、纸娃娃系统,作为**核心渲染库**迁移进 `jpstale-web`(Vite + TS + three.js,离线 demo)。

- **形态**:核心渲染库 + 一个 `char-demo` 演示页。**不**迁移 pviewer 的查看器 UI(选角列表/换装弹窗/骨骼开关等)。
- **动画**:含完整状态机(待机/走路/跑步/攻击/技能等状态转换 + 按职业/武器匹配动作),不只是低级播放器。
- **跨平台**:目标程序在 **Windows 与 Linux 均可正常运行**。这影响资产加载的大小写处理(见 §8)。
- **资产**:经 vite `/res` 映射加载 `E:\JPsTale\client` 下的真实游戏二进制(.inx/.smd/.smb/.tga/.bmp)。pviewer 的 JSON 是开发期预处理产物,仅作 dev 期数据表拷贝,未来以网络服务端返回的数据 + `client` 目录中的数据为准。

### 渲染后端可替换

核心计算层(解析/求值/骨骼动画)与渲染实现解耦。当前渲染基于 three.js(WebGL),未来可替换为 WebGPU/WGSL。渲染层是一个可替换的后端,不应让 three.js 的特有机制(如 onBeforeCompile)侵入核心计算层。

### 着色器独立文件

着色器(.vert/.frag)应作为**独立文件**存放,而非嵌入 TS 代码字符串。目的:
- **git 跟踪**:shader 变更可独立 diff,不伴随大批 TS 代码修改
- **独立调试**:可单独取出 shader 做调试
- **对照 C++ 原版**:便于逐函数对照 C++ 渲染路径(序列帧动画、滚 UV 动画、草/树叶风动画、装备闪光等),验证着色器正确性

着色器范式:**MeshBasicMaterial(无光照 base) + 自定义光照逻辑(环境光、点光源、lightmap、顶点动画)**。本项目用不上 PBR(无定向光、无阴影),当前 MeshBasicMaterial + 自定义光照注入已精准匹配游戏需求。

### 演进声明

本次迁移**先按 /pt/pviewer 现状**实现(解析 `.inx` + sItem 索引 + weaponType 语义兜底),**后期再升级为语义化动画系统**。

- 升级成本主要在于**数据源**(JPT2018 `.in` / 结构化数据转换),而**匹配逻辑**(weaponType+handType)已在 pviewer 的 `matchWeaponByType` 中实现,切换为主路径是低成本的。
- 服务端职责(技能可用性校验、随机选动画变体、广播同步)不属于前端渲染库,不在本次范围。
- 本设计的**数据走 provider 接口**正是为此次升级铺路:后期换数据源时,只换 provider,核心匹配/渲染不动。
- **注意**:JPT2018 的动画 `.in` 虽是原始权威来源,但太老。最终客户端目标不是十几年前的老古董,而是**纳入 PristonTale-EU 新增怪物、新增职业的新客户端**。因此数据升级时以新客户端(含 EU 扩展)为准,不囿于 JPT2018 旧数据。

### 数据源立场

语义化阶段的动画/武器数据是**静态数据**,可用**结构化 JSON** 承载,不必锁定 DB。

- DB(Forest 的 `modellist`/`modelanimationlist`、`skill`/`skill_animation` 表、服务端广播)属**服务端职责**,不属前端渲染库。
- 前端渲染库只需一份**可消费的结构化数据**(JSON 即可)。原始数据源可来自新客户端 `.in` 文本,一次性转换为结构化数据。

## 2. 术语与命名规范

### 2.1 术语统一(field / map / area / stage)

同一概念(地形/关卡)此前混用 field、map、area、stage,存在术语歧义。**统一决策**:

| 术语 | 归属 |
|------|------|
| **field** | **地形/关卡**的唯一命名。3D 地形库统一用 field:`field-parser`、`field-renderer`。 |
| **map / minimap** | **保留给 UI 地图**:后续小地图(minimap)与传送选点大地图(worldmap)。避免与地形渲染 `map-renderer` 冲突。 |
| area | 服务端 `AreaService` 用语;前端地形统一 field 为准。 |
| stage | 二进制引擎内部术语(SMD Stage data),不进公开 API 命名。 |

**理由**:`map` 在 UI 层还有"小地图/大地图"含义,若地形渲染也用 `map-renderer`,未来 UI 地图渲染必然同名冲突。field 与 map 各占一词,无歧义。

### 2.2 应用范围(重要)

- **`client` 资产目录/文件路径:不动**。`Field\Forest\...`、`Char\...` 等资产路径是既有架构,不改。
- **jpstale-web 项目代码该改就改**,含源文件名、目录、标识符:
  - `src/core/smd-parser.ts` → `field-parser.ts`,导出 `parseSMD`→`parseField`、`SMDData`→`FieldData`
  - `src/render/map-renderer.ts` → `field-renderer.ts`,类 `MapRenderer`→`FieldRenderer`
  - `src/maps/` → `src/field/`
  - 同步更新引用:map-renderer、pick、fore1 及 binary.ts 注释
- 这是语义化改名,不改逻辑。

## 3. 命名语义(与 PT 一致)

`.smd` 扩展名在 PT 中混用了两种不同二进制格式,迁移用**语义化命名**取代按扩展名命名:

| 文件 | 语义 | 解析器 |
|------|------|--------|
| 地图 `.smd` | Field/Stage 格式 | `field-parser.ts` |
| 角色 `.inx` | char-index(角色索引/动画清单) | `char-parser.ts` (`parseCharIndex`) |
| 角色 `.smd` | char-model(角色几何) | `char-parser.ts` (`parseCharModel`) |
| 角色 `.smb` | char-bone / char-animation(骨骼+动画) | `char-parser.ts` (`parseCharBone`) |

角色三种文件底层都含 smLegacyOBJ3D 结构,故**共用一个文件 `char-parser.ts`**,内部共用底层 reader,导出按文件类型命名的入口。

## 4. 文件布局

```
src/core/
  field-parser.ts    # 地图 .smd(Stage)解析——现 smd-parser 改名
  char-parser.ts     # 角色公共解析:parseCharIndex / parseCharModel / parseCharBone
  texture.ts         # 已有,复用(TGA/BMP 解密解码)
  binary.ts          # 已有,复用(readCString 等)

src/render/          # field-renderer 改名后位于此或独立 field/ 目录(见 §2.2)
  field-renderer.ts  # 地图渲染(现 map-renderer 改名)
  char-loader.ts     # 装配管线:body+head 共享骨架 + 武器(迁移 char-loader.js)
  skinned-builder.ts # 骨骼 + SkinnedMesh 构建(迁移 smb-parser.js 的 buildSkeleton/buildSkinnedMesh)
  weapon-loader.ts   # DropItem .smd → 静态 mesh 挂到骨骼(迁移 weapon-loader.js)

src/char/
  animation.ts           # evalSkeleton/applyToBones(纯数学,迁移 animation.js)
  char-format.ts         # CLASS_FLAG + 动画条目数据结构 + 状态名(迁移 inx-parser 的动画部分)
  anim-match.ts          # 状态/职业/武器匹配(迁移 anim-match.js)
  anim-state-machine.ts  # 动画状态机(迁移 anim-state-machine.js)
  data/                  # 开发期数据表(从 pviewer 拷贝),未来可被服务端/结构化数据覆盖
    job-data.ts  sitem-weapon-index.ts  weapon-type.ts  costume-body-map.ts

shaders/                 # 独立着色器文件(.vert/.frag)
  # 地形渲染、角色渲染、武器渲染等各模型的顶点/片段着色器
  # 便于对照 C++ 原版渲染路径验证(序列帧、滚 UV、风动画、装备闪光等)
```

## 5. 数据解耦

- **核心逻辑**(解析/求值/构建)纯 TS/three,不依赖具体数据内容。
- **数据表**集中在 `src/char/data/`。char 库通过 provider/import 接口读取 weapon 索引、weapon-type、costume 映射、job 路径、CLASS_FLAG。
- dev 期用 pviewer 拷贝的 JSON/TS 实现;未来同接口可由网络服务端返回或**结构化 JSON 数据**覆盖。
- 数据源**不锁定 DB**:动画/武器数据本身是静态的,结构化 JSON 即可承载(见 §1 数据源立场)。

## 6. 动画

- `animation.ts`:低级求值器,evalSkeleton(关键帧插值 + Slerp + 层级累积)、applyToBones。纯数学,与 three 解耦。
- `char-format.ts`:CLASS_FLAG、动画条目、状态码→名。
- `anim-match.ts`:按 `(状态, 职业, 武器)` 匹配 .inx 动画条目(精确 + 类型两种匹配,类型匹配即语义化 weaponType 兜底)。
- `anim-state-machine.ts`:状态转换(STAND→WALK/RUN/ATTACK/SKILL…,非循环态结束回 STAND)。输入 interface:`getMotions / getClassId / getWeaponIdCode / getWeaponType / onMotionChange / log`(沿用 pviewer opts 模式)。
- 后期语义化升级:匹配切 weaponType+handType 主路径,数据源换结构化数据。

### 6.1 原版 PT 引擎动画切换机制(ex-machina 源码分析)

**核心结论:所有动画切换都是硬切换(Hard Cut),没有动画混合/交叉淡入淡出。**

#### 切换流程

```
状态变化触发 → SetMotionFromCode(MotionCode) → ChangeMotion(index) → frame = StartFrame * 160
```

- `SetMotionFromCode()` (`character.cpp:2053`):遍历所有 `smMOTIONINFO` 条目,按以下维度筛选:
  - **State**: 动画状态码(STAND/WALK/RUN/ATTACK/SKILL/DEAD 等)
  - **MapPosition**: 地图类型(村庄/野外)
  - **dwJobCodeBit**: 职业掩码
  - **ItemCodeList**: 当前武器的 sItem 索引白名单
  - **SkillCodeList**: 技能代码匹配
- 匹配到多个时**随机选一个**(`rand() % FindCnt`)
- `ChangeMotion()` (`character.cpp:1974`):直接把帧计数器重置到起始帧,没有任何混合系数或过渡时间:
  ```cpp
  frame = MotionInfo->StartFrame * 160;  // 直接跳到起始帧
  FrameCounter = 0;
  AttackSkil = 0;
  // 清除所有事件帧状态
  ```

#### 动画结束时的状态转换

```cpp
frame += FrameStep;  // 每帧递增
if (frame >= MotionInfo->EndFrame * 160) {
    if (MotionInfo->Repeat == TRUE) {
        // 循环动画:帧回绕
        frame = StartFrame * 160 + (frame - EndFrame * 160);
    } else {
        // 非循环:硬切到 STAND 或下一个预设动画
        if (dwNextMotionCode)
            SetMotionFromCode(dwNextMotionCode);
        else
            SetMotionFromCode(CHRMOTION_STATE_STAND);
    }
}
```

#### 唯一的多层:面部表情系统

`smOBJ3D::TmAnimation()` (`smObj3d.cpp:1021`) 有一个独立的面部动画层,按骨骼名称匹配**替换**对应骨骼的变换矩阵。这是硬替换,不是混合——主体动画正常播放,面部表情骨骼(TalkPattern)直接覆盖对应骨骼的 `TmResult`,两者没有权重插值。

#### 事件帧机制

`smMOTIONINFO.EventFrame[4]` 在特定帧触发脚步声/技能特效/伤害判定,但**不参与动画过渡**,仅用于触发时机控制。

#### 本项目的决策

沿用原版硬切换,不做动画混合(blending)/交叉淡入淡出。原因:
1. 原版 PT 就是硬切换,保持行为一致
2. 硬切换实现简单,状态机逻辑清晰
3. PT 的动画帧率(70fps)和帧步长(80帧/更新)下,硬切换视觉上可接受
4. 如需更平滑过渡,后期可在 three.js 的 `AnimationMixer` 上用 `crossFadeTo` / `setEffectiveWeight` 升级,但不在本次范围

## 7. char-demo 页面

保留地图的 `index.html`/`main.ts` 不动,新增独立演示页:

- `char-demo.html` + `src/char-demo.ts`。
- vite `rollupOptions.input` 增加多页面输入(见实现计划)。
- 演示内容:加载一个角色(body+head 共享骨骼),显示动画状态机切换(待机/走路/攻击等),可换武器/换装(dropItem)。
- 复用 map 的场景设置习惯:logarithmicDepth、OrbitControls。

## 8. 资产路径与大小写规范(跨平台)

### 8.1 URI 全小写

PT 开发时文件夹/文件大小写命名混乱。**统一:运行时一切资产 URI 全小写**。

- 例:`client` 里实际文件是 `Field/Forest/fore-2.SMD`,运行时一律引用 `/res/field/forest/fore-2.smd`。
- 代码/资产引用层统一小写化;`client` 真实文件保持原样(不动)。

### 8.2 跨平台(Windows + Linux)

- **Windows** 文件系统大小写不敏感,`field/forest/fore-2.smd` 直接命中 `Field/Forest/fore-2.SMD`。
- **Linux** 大小写敏感。`client` 资产**已全小写**(经区分大小写正则验证,0 个大写残留),且运行时 URI 全小写,必然命中。
- 加载层:**不做大小写容错查找**。严格要求 URI 全小写精确命中(因为文件已全小写,必然命中)。容错查找会掩盖问题,增加未来排查难度。

### 8.3 client 现状

- 上周脚本已把 `field`、`char` 目录的资产**全部改为小写命名**。
- 经区分大小写正则验证,**client 所有目录均无大写残留**(0 个大写项)。资产已全小写。
- 因此:运行时 URI 全小写 = 文件系统实际路径(全小写),必然命中。

### 8.4 关键资产路径(迁移时确认实际路径)

- body/head 模型 `.inx/.smd`:`char/tmabcd/**`
- 骨骼 + 动画 `.smb`:`char/tmabcd/**`
- 武器 dropitem `.smd`:`image/sinimage/items/dropitem/`
- 资产 URL 解析逻辑(从 .inx 的 modelFile/motionFile 提取文件基名)迁移自 char-loader.js / weapon-loader.js。
- `/res` vite 映射已支持 `.inx/.smd/.smb` MIME,无需改 vite 配置;且因 asset 已全小写,URI 全小写必然命中。

## 9. 验证

- `pnpm build`(= `tsc --noEmit && vite build`)通过,TS strict + noUnusedLocals/Parameters 达标。
- 非平凡逻辑(解密、关键帧求值、状态匹配)保留一个可运行的自检(ponytail:最小的 assert 级 check)。
- char-demo 运行时:角色渲染正确、动画随状态机切换、换装/武器挂载生效(用户浏览器验证)。
- 大小写:同一 demo 在 Windows 与 Linux 均能加载资产(经 URI 全小写 + asset 全小写)。

## 10. 明确不做(YAGNI)

- 不迁 pviewer 的查看器 UI(列表/弹窗/加载面板)。
- 不实现 LOD 多套网格切换(除非 demo 需要)——共享骨架能力已内建,但暂不做自动 LOD。
- 不迁怪物列表/角色选择数据,除非 char-demo 需要。
- 不做完整的动画混合(blending)/过渡,状态机为简单切换(沿用 pviewer)。
- **本次不做语义化升级的实现**(服务端 skill/skill_animation、DB、广播、.in 转换)。只按 pviewer 现状迁移,并通过 provider 接口为后期语义化铺路。
- **不做 PBR**。本项目用 MeshBasicMaterial(无光照 base) + 自定义光照(环境光、点光源、lightmap、顶点动画),无定向光、无阴影。
