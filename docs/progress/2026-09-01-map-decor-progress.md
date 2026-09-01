# 地图装饰物（StageObject）渲染 — 进展与待解决问题

> 记录装饰模型的实现进展、已验证结论、以及坐标管道的待解问题。

## 一、进展（已完成）

### 1.1 装饰清单提取
- **来源**：`field.cpp` 硬编码 `AddStageObject("路径"[, BipAnimation])`，共 **431 条**（44 张图）。
- **产物**：`src/maps/map-decor.ts`（`MAP_DECOR: Record<mapId, DecorEntry[]>`，mapId 已按 FieldMap 对齐，room/office 偏移已修正）。
- 校验：map3(village-2) 有 23 个装饰（v-ani01~14 + v_ani01~04 + world_ani01~05）。

### 1.2 装饰 .smd 路径映射
- **问题**：客户端打包时装饰 .smd 分散在各 field 子目录，文件名/目录与 ASE 路径不一致（如 `forest\v_ani01.ASE` 实际无此文件）。
- **方案**：按文件名反查客户端全部 field/*.smd（578 个去重），生成 `src/maps/decor-paths.ts`（`DECOR_PATHS: Record<文件名, /res 路径>`）。
- **命中率**：431 个装饰中 400 命中（92.8%），31 缺失（下划线/连字符命名差异、个别号码）。

### 1.3 装饰加载与渲染（当前实现）
- `src/maps/decor-loader.ts`：
  - `loadDecor`：`parseSmb` 读 .smd（MODEL 0.62）→ 顶点按 tm 旋转 + 角色变换 + 位置 → 纯色 `MeshBasicMaterial`（绿色 0x88aa44）。
  - `loadMapDecor`：挂到 scene，返回 group 列表。
  - `unloadDecor`：卸载时释放 geometry/material。
- **WorldView 联动**：`loadMapById` 加载地图时挂装饰，`syncMapRegions` 卸载时清除。

### 1.4 已验证结论
- 装饰 .smd 是 `SMD Model data Ver 0.62`（MODEL 格式，同角色），非地图 `SMD Stage data`。
- 装饰**无骨骼、无动画帧**（`tmFrameCounter=0`，objects 无 boneNames）——**不是骨骼/顶点动画模型**。
- 装饰对象有 `head=0xc1424344`（含 OBJ_HEAD_TYPE_NEW_NORMAL 法线标志）。
- 位置 = 第一个对象 `tm` 平移（地图空间 raw 定点），地图变换（绕 Y 镜面 `-z,y,-x` ÷256）后**落在正确地图内**（v-ani01 实测在 village-2 内）。
- 部分装饰朝向正确（风车完美），部分错误（水闸应横却竖）——**tm 旋转应用不完整/不统一**。

## 二、待解决问题（核心）

### 2.1 装饰顶点坐标管道未完全复刻
原版装饰坐标 = **多个变换叠加**，当前实现只部分复刻，导致朝向对错不一：

| 原版变换 | 源码 | 当前状态 |
|---------|------|---------|
| ReformTM（顶点 × tmInvert） | `smObj3d.cpp:616` | ⚠ 试过但"完全不显示"，原因未明 |
| WorldForm（顶点 × mWorld） | `smObj3d.cpp:1320` | ⚠ mWorld 实测为 float 矩阵（含 1.0f 平移），变换后不在地图内 |
| Draw（SetPosi/SetFixPosi 摆位） | `smStgObj.cpp:197-244` | 位置用 tm 平移（已验证正确） |
| tm 旋转（对象自身朝向） | obj.tm | ⚠ 部分装饰对、部分错 |

**关键矛盾**：位置（tm 平移，地图变换）正确，但顶点（tm 旋转 + 角色变换）朝向不统一。风车 tm 旋转 31° 正确，水闸 tm 旋转后仍竖（应横）。

**疑点**：
1. ReformTM 用 `tmInvert`，WorldForm 用 `mWorld`——两者叠加才是最终坐标，当前只用了 tm 旋转。
2. `mWorld` 是 float 矩阵但 char-parser 之前按 int 读（已改 float），float 变换结果不在地图内——语义未明。
3. 装饰可能含**贴图动画**（如 treeani_*.tga）而非几何动画，但材质逆向未做（当前纯色）。

### 2.2 装饰材质逆向（未做）
- 装饰 .smd 的 `materials=0`（parseSmb 读不出材质），贴图名在 ASE 里（`riy-w*.bmp`，独立外部贴图）。
- 需要从 ASE 提取贴图名 + 映射到客户端贴图路径（分散目录）。
- 当前用纯色渲染。

### 2.3 装饰动画（未确认）
- 装饰 `tmFrameCounter=0` 无动画帧，但 ASE 里 `AddStageObject(..., BipAnimation=1)` 的 `_Bip` 装饰（如 iron 的 i1-ani*_Bip）是骨骼动画。
- 静态装饰（v-ani01 等）无骨骼，动画来源可能是贴图序列或 tm 运行时旋转——**未验证**。

## 三、下一步建议

1. **彻底读透原版装饰坐标管道**（ReformTM + WorldForm + SetPosi 的精确叠加），再实现，避免组合试错。
2. 参考 `smObj3d.cpp`（WorldForm/ReformTM）和 `smStgObj.cpp`（Draw）的完整坐标流。
3. 材质逆向：从 ASE 提取贴图名 → 客户端贴图路径。
4. 确认装饰动画类型（骨骼/贴图/tm）后实现。

## 四、相关文件

- `src/maps/map-decor.ts`（装饰清单）
- `src/maps/decor-paths.ts`（文件名→路径映射）
- `src/maps/decor-loader.ts`（加载/渲染）
- `src/maps/map-decor.js`（原计划文档）
- 参考源码：`ex-machina/src/game/Legacy/Engine/Graphics/smObj3d.cpp`（WorldForm/ReformTM）、`smStgObj.cpp`（Draw/AddObjectFile）、`field.cpp`（AddStageObject 清单）
