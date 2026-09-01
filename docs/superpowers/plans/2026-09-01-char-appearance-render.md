# 角色外观渲染端到端实现计划

> 依据设计文档 `2026-09-01-char-appearance-render-design.md`。目标：角色选择列表页按服务端结构化数据正确渲染完整外观（职业/脸型/转职阶级/身体装备/武器），并把消息结构（`CharacterAppearance` + `PlayerAppearInfo`）定好并生成，供游戏内世界复用（本期只定结构不接入）。

## 改动范围（本计划覆盖）

1. **proto**：两端同步新增结构 + 字段，重新生成
2. **DB**：`userdb.character_info` 加 `head`、`rank` 列（实体 + mapper 自动映射 + 建表/迁移脚本）
3. **服务端**：`handleCreateCharacter` 存 head；`sendCharacterList` 联表算外观填 `appearance`
4. **客户端**：`createCharacter` 加 head；`CharSelect` 用 `appearance` 渲染；移植武器加载器 + COSTUME_BODY_MAP

**不做**：穿脱交互、存档迁移、游戏内世界接入、buff/头衔/帮会字段、武器动画匹配细化。

---

## Step 1 — proto 定义（两端同步）

**核心改动：`jpstale-web/proto/base/common.proto`** 与 **`jpstale-server/pt-common/src/main/proto/base/common.proto`** 同步改（两份内容完全一致）。

在 `common.proto` 追加：

```proto
// 朝向/方向角（对应 PT ax/ay/az）
message Rotation {
  float x = 1;
  float y = 2;
  float z = 3;
}

// 角色外观——渲染一个角色所需的最小外观信息（角色选择列表、世界中其他玩家共用）
message CharacterAppearance {
  int32 class_id   = 1;  // 职业(1-10)
  int32 head      = 2;  // 头型/头模型编号(0-2)
  int32 rank       = 3;  // 转职阶级(0-7)
  string body_model  = 4;  // 最终身体模型路径（服务端已算好，如 "b005"）
  string weapon_dorp = 5; // 武器 dorpItem（可空）
  int32 weapon_pos   = 6; // 武器挂点 modelPosition（2左/4右/0无）
  int32 size_level   = 7; // 体型缩放（默认 1）
}

// 玩家出现：外观 + 身份 + 位置 + 朝向 + 状态（对应 PT smTRNAS_PLAYERINFO）
message PlayerAppearInfo {
  int64 player_id         = 1;
  string name             = 2;
  int32 level             = 3;
  CharacterAppearance appearance = 4;
  Position position       = 5;
  Rotation rotation       = 6;
  int32 state             = 7;
  int32 hp = 8;
  int32 max_hp = 9;
}
```

在 `message.proto`（两端同步）改：

```proto
// C2S_CreateCharacter 加 head
message C2S_CreateCharacter {
  string name = 1;
  int32 class_id = 2;
  int32 head = 3;   // 新增：创建时选的头型/头模型编号(0-2)
}

// CharacterInfo 加 appearance（字段 1-7 不变）
message CharacterInfo {
  int64 character_id = 1;
  string name = 2;
  int32 class_id = 3;
  int32 level = 4;
  Position position = 5;
  int32 map_id = 6;
  int64 gold = 7;
  CharacterAppearance appearance = 8;  // 新增
}

// S2C_PlayerAppear 复用 PlayerAppearInfo（本期只改定义，不接入）
message S2C_PlayerAppear {
  PlayerAppearInfo info = 1;
}
```

> 注意：`rotation`/`appearance` 是可空 message（proto3 无 `optional` 时用 `hasXxx()` 判断）。

**生成命令：**
- 客户端：`cd jpstale-web && npm run proto`（`gen-proto.ts`，生成 `src/net/proto/base_*`）
- 服务端：`cd jpstale-server && mvn -pl pt-common -am compile`（Maven protobuf 插件从 `src/main/proto` 生成）

**验证：** 两端重生成成功；`base_message.d.ts` / 生成的 Java 类含新 message 与字段。

**文件清单：**
- `jpstale-web/proto/base/common.proto`
- `jpstale-web/proto/base/message.proto`
- `jpstale-server/pt-common/src/main/proto/base/common.proto`
- `jpstale-server/pt-common/src/main/proto/base/message.proto`

---

## Step 2 — DB：character_info 加 head/rank

**`postgres-init/01-create-userdb.sql`** 的 `CREATE TABLE userdb.character_info`（line 13-36）加两列：

```sql
    head integer NULL,          -- 头型/头模型编号(0-2)
    rank integer NULL,          -- 转职阶级(0-7)，默认 0
```

**迁移脚本**（新文件 `postgres-init/99-alter-userdb-add-appearance.sql`，处理已存在的库）：

```sql
ALTER TABLE userdb.character_info ADD COLUMN IF NOT EXISTS head integer NULL;
ALTER TABLE userdb.character_info ADD COLUMN IF NOT EXISTS rank integer NULL;
```

**实体 `pt-dao/.../userdb/entity/CharacterInfo.java`** 加字段（`@TableField` 命名遵循 MyBatis-Plus 驼峰→下划线，`head`/`rank` 本身无下划线，直接用）：

```java
@TableField("head")
private Integer head;
@TableField("rank")
private Integer rank;
```

> mapper（`CharacterInfoMapper`）继承 BaseMapper，新增列自动映射，无需改 mapper。

**验证：** 建表/迁移脚本语法正确；实体编译通过。

---

## Step 3 — 服务端：存 head + 发外观

**文件：`pt-game-server/.../service/AccountService.java`**

### 3a. 创建角色存 head

`handleCreateCharacter`（:379）读 `request.getHead()`，传给 `createCharacter`：

```java
int head = request.getHead();  // 新增，头型编号 0-2
CharacterInfo character = createCharacter(accountName, name, classId, null, head);
```

新增重载 `createCharacter(accountName, name, jobCode, headModel, head)`，内部：
```java
character.setHead(head);
character.setRank(0);
```
（保留旧 `createCharacter(accountName, name, jobCode)` / 4 参版本，兼容现有调用，最终让报文入口走新 5 参版本。注意区分参数：`headModel` 是既有 `oldHead` 模型路径参数，`head` 是新增头型编号。`createCharacterForSession` 的 JSON 入口暂传 head=0。）

### 3b. sendCharacterList 填外观

`sendCharacterList`（:348）对每个角色：
- 读 `character.getHead()`/`character.getRank()`（缺省 0）
- 联表查该角色当前装备：`userdb.item`(`character_id, location=1`) → `gamedb.itemlist`(idcode=item_code) 取 `codeimg1`(dorpItem)、`modelposition`
- 算 `body_model`：
  - 命中 COSTUME_BODY_MAP 的时装 dorpItem → 查表身体基名
  - 否则 → 职业基础身体（`getBodyInxPath` 等价，未穿则默认 `001`，如 `b001`）
- 武器：装备栏里 `slot` 对应武器槽（RHAND/LHAND game）→ dorpItem + model_position；否则空

构建：
```java
CharacterAppearance.Builder app = CharacterAppearance.newBuilder()
    .setClassId(jobCode)
    .setHead(head)
    .setRank(rank)
    .setBodyModel(bodyModel)
    .setWeaponDorp(weaponDorp)   // 空字符串表示无武器
    .setWeaponPos(weaponPos)
    .setSizeLevel(1);
...setAppearance(app.build());
```

> 放服务端算好 `body_model`/`weapon_dorp`/`weapon_pos`，前端 `hasAppearance()` 判断是否渲染装备外观，否则退回 `getBodyInxPath(job, 1)` 空手。

**新增辅助方法**（本类或新 `AppearanceMapper` 服务）：
```java
// 联表：取角色当前装备 → 外观三元组
private CharacterAppearance buildAppearance(CharacterInfo c);
```
依赖注入：`itemMapper`（userdb.item）、`itemListMapper`（gamedb.itemlist）。需在 `pt-dao` 确认实体/mapper 存在（`Item`、`ItemList`、对应 Mapper）。

**验证：** `mvn -pl pt-game-server -am compile` 通过；`sendCharacterList` 发出的包含 `appearance`。

---

## Step 4 — 客户端：render appearance

### 4a. protocol.ts

`createCharacter(name, classId, head)`（`src/net/protocol.ts:9`）加 head：
```ts
export function createCharacter(name: string, classId: number, head: number): jpt.base.ClientMessage.$Properties {
    return jpt.base.ClientMessage.create({
        createCharacter: { name, classId, head },
    });
}
```

### 4b. CharSelect.ts — 按 appearance 渲染

- `show()`：遍历 `character_list.characters[]`，每角色取 `character.appearance`
- `selectCharacter(id)`：用该角色 appearance 的所有者字段重新 `loadPreview`
- `CharSelect.ts` UI 状态变量由 `selectedFace`/`selectFace`/`faceEls`/`updateFaceHighlight` 改为 `selectedHead`/`selectHead`/`headEls`/`updateHeadHighlight`（A1：全链路统一称 head）；i18n key `gui.charCreate.face` 文案保留"脸型/头型"UI 显示，变量名改 head
- `loadPreview` 现签名 `loadPreview(jobId, head)`，扩展为接受可选的 `appearance`（含 body_model/weapon_dorp/weapon_pos），把 body override + 武器挂载传进 `loadCharacterModel`
- 创建页 `doCreate`：`onCreate(name, classId, selectedHead)`，把当前选择的 head 传出去（`main.ts` 回调参数已是 `_head`，现在真正传递）
- 渲染层 `char-loader.ts` 内部参数 `faceNum` **保留**（对应 pviewer 原版命名，属内部实现细节、不走协议契约）

### 4c. 移植武器加载器 + 身体时装映射

- 新文件按 pviewer 移植：`weapon-loader.ts`（dorpItem → 加载 `it{dorpItem}.smd` 挂到 `modelPosition` 对应骨骼）、`costume-body-map.ts`（复用 pviewer `COSTUME_BODY_MAP`）
- `char-loader.ts`：确认 `getBodyInxPath`/`getBody(override)`/`getHeadInxPath` 已支持 mask；补 body_model 覆盖入口（服务端已算好 `b005` 这类最终路径，直接作 override）

**验证：** `npm run build`（tsc + vite）EXIT 0；角色选择列表页能渲染带装备外观的角色。

---

## 验证清单（端到端）

1. `npm run proto` + `mvn -pl pt-common -am compile` 重生成成功
2. 服务端编译通过；建表/迁移脚本生效
3. 创建角色（带 head）→ DB 落 head=所选、rank=0 → `S2C_CharacterList` 返回 `appearance`
4. 前端角色列表页：每角色按 appearance 渲染正确外观；点击切换预览
5. `npm run build` EXIT 0

## 关键文件

| 端 | 文件 | 改动 |
|----|------|------|
| proto | `jpstale-web/proto/base/common.proto` | +Rotation/CharacterAppearance/PlayerAppearInfo |
| proto | `jpstale-web/proto/base/message.proto` | +head,+appearance,+PlayerAppearInfo 复用 |
| proto | `pt-common/src/main/proto/base/*.proto` | 与 web 同步 |
| DB | `postgres-init/01-create-userdb.sql` | +head/rank 列 |
| DB | `postgres-init/99-alter-userdb-add-appearance.sql` | 迁移 |
| DB | `pt-dao/.../CharacterInfo.java` | +head/rank 字段 |
| server | `AccountService.java` | 存 head + buildAppearance + send |
| client | `src/net/protocol.ts` | createCharacter + head |
| client | `src/ui/CharSelect.ts` | appearance 渲染 + head 传递 |
| client | `src/char/weapon-loader.ts`(新) | 武器挂载 |
| client | `src/char/costume-body-map.ts`(新) | 身体时装查表 |

## 风险 / 待确认

- ✅ 已核实：`gamedb.itemlist` 的 `codeimg1`(→`ItemList.codeImg1`) 与 `modelposition`(→`ItemList.modelPosition`) 实体映射存在；`userdb.item`(`Item.location`/`slot`/`itemCode`) 与 `ItemMapper` 存在
- `userdb.item` 的装备 `slot` 使用 PT `INVENTORY_POS_*` 位掩码；联表时需知道哪些 slot 是"身体"、哪些是"武器（左右手）"（取 PT 源码 `INVENTORY_POS_*` 定义：RHAND=4 右武器、LHAND=2 左/盾、ARMOR=8 身体等）
- 现有 `sendCharacterList` 的 `PlayerService.loadEquipment` 已从 `userdb.item` 读装备，可复用其映射逻辑
