# 地图装饰性模型加载 — 工作计划

> 目标：客户端加载每张地图的装饰性 SMD 模型（静态 + 动画，如旋转风车），对齐原版 field.cpp 硬编码清单。

## 1. 背景与权威来源

- **装饰清单**：JPT2018 `field.cpp` 硬编码 `AddStageObject("路径"[, BipAnimation])`，共 **445 条**（44 张图）。
- **加载机制**：`playmain.cpp:304/306` → `smSTAGE3D::StageObject->AddObjectFile(szFile, szBipFile)`。
  - `BipAnimation=1`（路径含 `_Bip` 后缀）→ 骨骼动画装饰（如 iron 的 `i1-ani*_Bip.ASE`）
  - 否则 → 静态装饰
- **位置来源**：`smStgObj.cpp:156-162` — 装饰世界位置 = **模型第一个 obj3d 的 Tm 平移**（`Tm._41/_42/_43`），模型自带，非硬编码。
- **格式**：客户端资产是 `.smd`（`SMD Model data Ver 0.62`，非 `SMD Stage data`），用 `parseSmb` 可解析（v-ani01 实测：8 objects / 302 顶点 / tmFrame=0）。

## 2. 待调研缺口

| # | 缺口 | 说明 |
|---|------|------|
| 1 | 装饰 .smd 路径映射 | 原版 `"ricarten\v-ani01.ASE"` → 客户端 `field/ricarten/v-ani01.smd`，需确认 445 条全部能映射到资产 |
| 2 | 装饰位置提取 | `parseSmb` 的 obj3d 是否有 `tm` 平移（对应原版 Tm._41/42/43），需验证 v-ani01 的 transform |
| 3 | 装饰材质 | v-ani01 `materials=0`（parseSmb 返回 0 材质），装饰贴图从哪来需调研（可能 ASE 引用外部贴图 / 顶点色 / 共享材质） |
| 4 | 动画装饰 | `_Bip` 装饰是骨骼动画（smASE_ReadBone），客户端需播放动画（现有 char-loader 的骨骼/动画体系是否可复用） |
| 5 | 世界坐标变换 | 装饰是 Model 格式，坐标变换用角色的 ROT_X_NEG90 还是地图的绕 Y 镜面？需确认 |

## 3. 实施步骤

### Step 1：提取 445 装饰清单
- 从 `field.cpp` 解析全部 `AddStageObject`，生成 `mapId → [{path, bip}]` 表（TS 文件，如 `src/maps/map-decor.ts`）
- 清理重复/注释掉的条目

### Step 2：验证单张图（village-2 / map 3）
- v-ani01~14（14 个装饰）为起点
- 解析装饰 .smd（parseSmb）→ 提取位置（Tm 平移）→ 挂到场景
- 确认材质与坐标变换

### Step 3：静态装饰渲染
- 泛化装饰加载：遍历 mapId 的装饰清单，加载 + 摆位
- 与地图加载/卸载联动（`syncMapRegions` 加载/卸载对应装饰）

### Step 4：动画装饰
- `_Bip` 装饰骨骼动画播放（复用角色动画体系或独立实现）
- 静态装饰 + 动画装饰区分

### Step 5：全量接入 + 验证
- 44 图装饰清单全量
- 预加载（对齐 preloadAllMaps）或随图加载
- 性能（445 装饰 draw call）

## 4. 风险

- 装饰 .smd 与 ASE 路径映射可能不全（部分装饰资产缺失）
- 装饰材质源不明（materials=0）
- 动画装饰（Bip）实现复杂，可能需独立骨骼播放

## 5. 文件

- 新：`src/maps/map-decor.ts`（装饰清单）、`src/maps/decor-loader.ts`（加载渲染）
- 改：`WorldView.ts`（联动 mapHandles 加载/卸载）、`map-preload.ts`（预加载装饰）
- 参考：`field.cpp`、`smStgObj.cpp`、`playmain.cpp`
