# `.spp` = 刷怪点（**不是出生点**）

来源：11 职业服务端 `Server服务端/GameServer/Field/*.spp`（2026-09-13 收进，50 个文件 220K）。

**语义依据**（动手前先看这几条，别再当成出生点）：
- `plans/exm-business-modules.md:355`：`AddSpawnPoint/DelSpawnPoint → AddStartPoint/DeleteStartPoint`，
  标注为 **"刷怪点编辑（地图编辑器）"**；
- `plans/pg-schema-analysis.md:53`：服务端 DB 用 **`map_spawn_point`** 存刷怪点；
- `docs/pt-core-gameplay.md:207`：`.spc` 记 NPC 分布，`.spm`/`.spp` 是配套地图文件；
- 代码：`NewSourcePT-2023/SrcGame/src/Server/OnSever.cpp` 的 `FindStartPoint`(7801) / `AddStartPoint`(7825) /
  `DeleteStartPoint`(7849)，以及 `onserver.h:89 STG_START_POINT{int state; int x, z;}` ×
  `STG_START_POINT_MAX=200` → **文件恒 2400 字节**（50 个文件逐一吻合）。

**`state` 是启用位**（实测 3980 条 `state=1` / 212 条 `state=0`）——
有效条目判据是 `state != 0`，**不是**"坐标非零"。

**位置/坐标**：`{x, -z}` 才是 `fields.json` 的坐标系（用 ric 已知点对照确认）。

⚠ **2026-09-13 的教训**：我曾把这些点当成"出生点"写进 `fields.json` 的 `startPoints`（已回滚）。
**出生点（每图通常 ≤10 个）与刷怪点是两回事**：`fields.json` 的 `startPoints` 由 EU 的 `MapGame.cpp` 生成，
来源不同、语义不同。落点类数据不可混用。
