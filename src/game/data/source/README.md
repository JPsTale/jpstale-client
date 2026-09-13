# source/ —— 离线源数据（提交进仓库，不引用外部项目）

| 文件 | 是什么 | 出处 |
|---|---|---|
| `field-cpp-startpoints.txt` | **出生点**：`grep -n 'SetCenterPos\|AddStartPoint' field.cpp` 的原样输出（保留行号可回溯） | `NewSourcePT-2023/SrcGame/src/field.cpp`（原版把出生点**硬编码**在代码里，`FIELD_START_POINT_MAX=8`） |
| `spawn-points/*.spp` | **刷怪点**（⚠ **不是**出生点）：`STG_START_POINT{state,x,z}` × 200 = 恒 2400 字节 | 11 职业服务端 `Server服务端/GameServer/Field/*.spp` |

**别把两者混用**：出生点每图 ≤8 个、供角色创建/传送/死亡复活选点；`.spp` 每图几十~200 条、是刷怪机制的数据。
详见 `spawn-points/README.md` 与 `AGENTS.md` 第 20 条。

**出生点数据已定稿**，就在 `src/maps/fields.json` 的 `startPoints`（每张图 1~8 个，逐图带 `startPointsSource`）。
不设生成管线（用户 2026-09-13："我只想要数据"、"我们会有很多次重建吗？"）—— 这里没有需要反复派生的东西，
留生成器反而会在有人手工调过某张图后被覆盖。以后要改出生点，**直接改 `fields.json` 的两份副本**。
`field-cpp-startpoints.txt` 只作**依据**留档（原版这些值长什么样）。
