# 角色外观渲染设计（端到端 · DB 结构化）

## 概述

让角色在客户端按**服务端结构化数据**正确渲染完整外观（职业/脸型/转职阶级/身体装备/武器），并把消息结构设计成**可复用、不遗漏**的外观同步结构。

对照原始权威源码（最早日服 `JPT2018/J_Server` 与后期引擎 `E:\repo\ex-machina`），明确"一个角色被渲染/出现在视野"需要哪些字段，避免自己凭空设计漏字段。

## 权威事实（来自源码核对）

### 存档 `record.h`（JPT2018，与 exm 一致）
- 每角色一份存档 `TRANS_RECORD_DATA`，主体 `smCHAR_INFO`：
  - `szModelName[64]`(身体模型名) `szModelName2[60]`(头/武器模型名) `JOB_CODE`(职业) `Level` `ChangeJob`(转职 rank 0-7) `Brood`(种族) `RefomCode`(外观) `SizeLevel`(体型)
  - 脸型**不是独立字段**，编码在头模型名里（如 `tmh-b01` → face=0）
- 选角色列表结构 `_TRANS_CHAR_INFO`：`szName/szModelName/szModelName2/JOB_CODE/Level/Brood/dwArmorCode/StartField/PosX/PosZ`
- 物品 `sRECORD_ITEM`：`ItemCount/x/y/ItemPosition + sITEMINFO`；穿戴槽位由 `ItemPosition` 的 `INVENTORY_POS_*` 位掩码决定（BOX/LHAND/RHAND/ARMOR/BOOTS/GLOVES/...）

### 玩家"出现"同步 `smTRNAS_PLAYERINFO(_QUICK)`（JPT2018:1866/1880，exm 同构）
一个角色出现在视野里，需要同步：
- `smCharInfo`（名称/身体模型/头模型/职业/等级/种族/转职 rank）
- `dwObjectSerial`（对象id）
- `x,y,z`（坐标，int 定点 FLOATNS=8）
- `ax,ay,az`（朝向/方向角）
- `state`（状态）

### 周期性状态广播 `smPLAYDATA`（JPT2018:1752）
- `dwObjectSerial + x,y,z + angle[4] + frame`（angle 0-2 三轴朝向、3 动作码）

### 明确**不在**出现包里的
- **buff**：走 `smPLAYDATA2/3`（`BuffCount + PlayBuff[]`）或技能包**后续单独同步**（我们 proto 已有 `S2C_BuffApply/BuffRemove`）
- **头衔/title**：独立协议（不在 smCHAR_INFO 里）
- **帮会 clan**：独立 TransClanInfo

## 消息结构分层设计

两类使用场景对应两层结构，都落在 `common.proto`（两端各有一份拷贝，需同步改+重新生成）：

### 1. `CharacterAppearance`（纯外观，可复用）
渲染任意角色的**外观本体**，不含坐标/身份。供角色选择列表嵌入，也是将来 `PlayerSpawn` 的子结构。

```proto
// 角色外观——渲染一个角色所需的最小外观信息（角色选择、世界中其他玩家共用）
message CharacterAppearance {
  int32 class_id  = 1;  // 职业(1-10)，决定骨骼/身体前缀/头前缀/种族
  int32 head      = 2;  // 头型/头模型编号(0-2)，配合 rank 决定头模型（PT 无独立 face 字段，脸型即头模型名编号）
  int32 rank      = 3;  // 转职阶级(0-7)，决定头模型后缀(a/b/c)
  string body_model = 4;  // 最终身体 body 模型（服务端已算好，如 "b005" 或时装映射路径）
  string weapon_dorp = 5; // 武器 dorpItem（可空，如 "WA102"）
  int32 weapon_pos  = 6;  // 武器挂点 modelPosition（2左/4右/0无）
  int32 size_level  = 7;  // 体型缩放（默认 1）
}
```

> 字段语义对照 PT：`class_id+head+rank` 决定头模型 `getHeadInxPath(job, headNum, rank)`（head 即头模型编号，客户端内部渲染参数名沿用 pviewer 的 `faceNum`）；`body_model` 是身体网格路径；`weapon_dorp`+`weapon_pos` 是武器挂载。服务端算好最终值下发，前端不查表。

### 2. `PlayerAppearInfo`（出现：外观 + 身份 + 位置 + 朝向 + 状态）
世界中其他玩家进入视野时使用。对应 PT `smTRNAS_PLAYERINFO`。可复用于怪物（怪物去掉外观，用 template_id）。

```proto
message PlayerAppearInfo {
  int64 player_id         = 1;   // 对象id（dwObjectSerial）
  string name             = 2;   // 角色名
  int32 level             = 3;   // 等级
  CharacterAppearance appearance = 4;  // 外观（复用）
  Position position       = 5;   // 坐标
  Rotation rotation       = 6;   // 朝向（新增类型，见下）
  int32 state             = 7;   // 状态（PlayerState）
  int32 hp = 8;  int32 max_hp = 9;   // 血量（显示血条用）
}
```

在 `common.proto` 新增朝向类型：
```proto
// 朝向/方向角（对应 PT ax/ay/az）
message Rotation { float x = 1; float y = 2; float z = 3; }
```

### 3. proto 消息改造
- `C2S_CreateCharacter`（message.proto）加 `int32 head = 3;`（创建时选的头型/头模型编号）
- `CharacterInfo`（message.proto:138）新增字段（`CharacterAppearance appearance = 8;`），原字段 1-7 不变
- `S2C_PlayerAppear`（message.proto:181）改为复用 `PlayerAppearInfo`（本次只定结构；游戏内世界尚未实现，接入后续做）

## 存储（DB 结构化 · 真相源）

遵循"DB 结构化存储为真相源，运行时 JVM 内存 + Redis 缓存，定时落库；不做历史迁移、不做穿脱交互"。

### userdb.character_info 新增列
- `head` smallint（头型/头模型编号 0-2，默认 0）
- `rank` smallint（转职 0-7，默认 0）
对应实体 `CharacterInfo.java` 补字段 + mapper + 建表脚本（`postgres-init/01-create-userdb.sql`；已建库需迁移脚本 `ALTER TABLE ... ADD COLUMN`）。

### 装备外观来源（只读当前穿着，不做穿脱）
- `userdb.item`（`location=1` 装备栏、`slot` 槽位）存当前穿戴
- `gamedb.itemlist` 提供 `codeimg1`(→dorpItem) 与 `modelposition`(→weapon_pos)
- 服务端 `sendCharacterList` 对每个角色联表取当前装备 → 算最终 `body_model`/`weapon_dorp`/`weapon_pos`

> 身体 `body_model` 计算规则（服务端）：
> - 若穿着**时装/特殊盔甲**（dorpItem 在 COSTUME_BODY_MAP 命中）→ 用查表身体基名
> - 否则 → 职业基础身体（`b001` 等，armorNum 公式，未穿则默认 1）
> - 前端 `getBodyInxPath`/`getBody(override)` 直接消费

## 客户端渲染

移植已在 `pt-web-server/static/pviewer/` 验证的纸娃娃机制（参考 `costume-body-map.js`、`weapon-loader.js`）：

- **换装 = 整个 body mesh 替换**：`loadCharacterModel(job, head, rank, 'high', bodyModelOverride)` → 新 body .inx → 新 .smd → 新 Group；head 与骨骼共享不变
- **武器 = 挂点子节点 add/remove**：`bone.add(weaponGroup)`，挂点 `modelPosition===2? LEFT_HAND : RIGHT_HAND`；武器组不蒙皮、局部坐标直接挂骨骼
- 新增移植文件：武器加载器（等价 pviewer `weapon-loader.js`）、身体时装查表（复用 pviewer `COSTUME_BODY_MAP`）

### 角色选择列表页（本次落地主场景）
- `CharSelect.ts` `show()` 拿到 `S2C_CharacterList.characters[]`，对每个角色中间预览渲染 `characters[i].appearance`
- 点击角色卡片 → `selectCharacter(id)` → 用该角色的 `appearance` 重新 `loadPreview`
- 创建页：仍按当前 job+head 预览（空手/基础身体）；`onCreate(name, classId, head)` 把 head 随 `C2S_CreateCharacter` 发出

### 游戏内世界（本次只定结构，不接入）
- 游戏内多人世界场景尚未实现（有 `map-renderer`/`fore1.ts`，无 PlayerAppear 使用方）
- `PlayerAppearInfo` 结构先定好并生成，等世界场景实现时用同一渲染入口（Appearance 复用）

## 边界 / 本期不做

- 不做穿脱/换装交互 UI
- 不做历史 `.chr`/`.dat` 存档导入
- 不实现游戏内多人世界与 `S2C_PlayerAppear` 的实际接入
- 不把 buff/头衔/帮会塞进外观结构（PT 均为独立消息；buff 走现有 `S2C_BuffApply/Remove`）
- 武器动画匹配保持现状（空手/套用现有 `matchWeapon` 逻辑）；武器类型(`weapon_type`)本期不发

## 数据流（角色选择页）

```
登录 → S2C_CharacterList{characters:[{..., appearance}]}
          ↓
CharSelect.show() → 遍历渲染每角色卡片 + 中间 3D 预览(loadCharacterModel(appearance))
          ↓
点击角色 → selectCharacter(id) → 用该角色 appearance 重新 loadPreview
          ↓
创建页 → 选 job+head → doCreate 发送 C2S_CreateCharacter{name, class_id, head}
          ↓
服务端 handleCreateCharacter(存 head, rank=0) → 刷新 sendCharacterList
```

## 依赖的现有代码

- 客户端：`char-loader.ts`(`JOB_DATA`/`getHeadInxPath`/`getBody`/`loadCharacterModel`)、`CharSelect.ts`、`net/protocol.ts`(`createCharacter`)、`core/texture.ts`(PNG 支持)、`char/anim-match.ts`
- 服务端：`AccountService.sendCharacterList`/`handleCreateCharacter`、`CharacterInfo`(DB 实体)、`CharacterData.java`(存档解析断点,本期不动)
- proto：`jpstale-web/proto/base/{common,message}.proto` + `jpstale-server/pt-common/src/main/proto/base/`（两份须同步），改后跑生成脚本
- 参考：`pt-web-server/static/pviewer/{costume-body-map,weapon-loader}.js`

## 改动清单（实现计划时细化）

1. proto：`common.proto` 加 `CharacterAppearance`/`PlayerAppearInfo`/`Rotation`；`message.proto` 的 `C2S_CreateCharacter` 加 head、`CharacterInfo` 加 appearance、`S2C_PlayerAppear` 复用；两端同步+重新生成
2. DB：`userdb.character_info` 加 head/rank 列 + 实体 + mapper + 迁移脚本
3. 服务端：`handleCreateCharacter` 存 head；`sendCharacterList` 联表算外观填 appearance
4. 客户端：`protocol.ts` createCharacter 加 head；`CharSelect.ts` 用 appearance 渲染；移植武器加载器 + COSTUME_BODY_MAP
