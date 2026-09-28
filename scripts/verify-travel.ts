/**
 * verify-travel：传送链（走图门 / NPC 传送 / 翅膀门网络 / Teleport Core）落地后的**可复算断言**。
 * `npm run verify-travel`。只读，失败即非零退出。
 *
 * 取证依据：docs/传送系统-原版机制与方案设计.md（§2 走图门 / §3 NPC 传送 / §4 翅膀 / §5 卷轴）。
 * 期望值全部**内嵌在本脚本**（原文出处见各断言注释），改表必须连这里一起改 —— 改了表不改这里
 * 就该红，这是它的职责。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SERVER = process.env.PT_SERVER_ROOT ?? resolve('..', 'jpstale-server');
const travelJava = readFileSync(
  resolve(SERVER, 'apps/game-server/src/main/java/org/jpstale/server/game/service/TravelService.java'), 'utf8');
const serverProto = readFileSync(
  resolve(SERVER, 'modules/protocol/src/main/proto/base/message.proto'), 'utf8');
const clientProto = readFileSync(resolve('proto/base/message.proto'), 'utf8');
const fields: Array<{ id: number; warpGates?: Array<{ x: number; z: number; destinations?: Array<{ map: number; x: number; z: number }> }> }> =
  JSON.parse(readFileSync(resolve('src/maps/fields.json'), 'utf8'));
const zh: Record<string, string> = JSON.parse(readFileSync(resolve('src/locales/zh_cn.json'), 'utf8'));
const en: Record<string, string> = JSON.parse(readFileSync(resolve('src/locales/en_us.json'), 'utf8'));
const bridge = readFileSync(resolve('src/net/bridge.ts'), 'utf8');
const store = readFileSync(resolve('src/app/gameStore.ts'), 'utf8');
const panelsRoot = readFileSync(resolve('src/ui/react/PanelsRoot.tsx'), 'utf8');

let pass = 0;
const fails: string[] = [];
function ok(cond: boolean, label: string): void {
  if (cond) { pass++; console.log(`  ✓ ${label}`); } else { fails.push(label); console.error(`  ✗ ${label}`); }
}
function arrayIn(src: string, name: string): number[] {
  const m = src.match(new RegExp(`${name}\\s*=\\s*\\{([^}]*)\\}`));
  if (!m) return [];
  // 先剥行注释再切分：否则 "…, 11,   // 1..10 …\n 12" 的下一段会把 12 连注释一起吞掉
  return m[1].replace(/\/\/[^\n]*/g, '').split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !Number.isNaN(n));
}

// ── A. 服务端表 = 原版原文（11 职业版客户端 / EU 事件码，逐字） ──
console.log('[A] 服务端代码表 vs 原版原文');
const WING = [3, 21, 18, 1, 6, 9, 12, 29, 37];        // sinWarpGateCODE（sinWarpGate.cpp:15）
const COST = [100, 300, 500, 1000, 2000, 4000];       // WarpGateUseCost（sinWarpGate.cpp:14）
ok(JSON.stringify(arrayIn(travelJava, 'WING_GATE_MAPS')) === JSON.stringify(WING), 'WING_GATE_MAPS = sinWarpGateCODE 9 门');
ok(JSON.stringify(arrayIn(travelJava, 'WING_GATE_COST_BY_TIER')) === JSON.stringify(COST), '费用表 = WarpGateUseCost 6 档');
// NPC 事件码 1000..1003 → 目的图（EU CharacterGame.cpp PHTeleport：Ricarten3/Atlantis45/BattleTown49/CastleOfTheLost5）
ok(/1000,\s*3,/.test(travelJava) && /1001,\s*45,/.test(travelJava)
   && /1002,\s*49,/.test(travelJava) && /1003,\s*5,/.test(travelJava), 'NPC_TELEPORTS = EU 事件码 1000→3 / 1001→45 / 1002→49 / 1003→5');
// HaPremiumItem.cpp TelePort_FieldNum 的目的地列（首行注释不计）：19,17,0,2,4,5,7,8,10,11,12,25,24,26,13,14,15,22,23,42,34,27,28,29,31,35,36,37,38,40,41,43,44,46,47,48,49
const CORE = arrayIn(travelJava, 'TELEPORT_CORE_MAPS');
ok(CORE.length === 37, `Teleport Core 白名单 37 条（原表首行注释不计），实际 ${CORE.length}`);
ok(CORE[0] === 19 && CORE[1] === 17 && CORE[36] === 49, 'Teleport Core 首尾与 HaPremiumItem.cpp:16-55 一致');
// 表不携带等级（用户 2026-09-28：等级唯一判定源 = maplist.levelreq）
ok(!/record NpcTeleport\(int teleportId,\s*int destMap,\s*long cost,\s*String note\)/.test(travelJava) === false
   && !/destMap,\s*int level/.test(travelJava), '代码表 record 无 level 字段（等级一律 DB）');

// ── B. fields.json：翅膀门网络的自指门数据在位（触发器 + 落点标记一体） ──
console.log('[B] fields.json 自指门（PosWarpOut）');
const selfGate = new Map<number, { x: number; z: number }>();
for (const m of fields) {
  for (const g of m.warpGates ?? []) {
    const ds = g.destinations ?? [];
    if (ds.length > 0 && ds.every((d) => d.map === m.id)) selfGate.set(m.id, { x: ds[0].x, z: ds[0].z });
  }
}
for (const id of WING) {
  ok(selfGate.has(id), `翅膀门图 ${id} 有自指门（落点数据在位）`);
}
ok(selfGate.get(3)?.x === 822 && selfGate.get(3)?.z === 19956, 'map3 自指出入口 = 822,19956（EU MapGame.cpp:303 同源）');

// ── C. 协议：两端 proto 一致 + wire 号 + 客户端生成物 ──
console.log('[C] 协议与生成物');
ok(serverProto === clientProto, '两端 message.proto 逐字一致');
ok(/S2C_TravelOpen travel_open = 215;/.test(serverProto), 'S2C_TravelOpen = wire 215');
ok(/C2S_TravelUse travel_use = 225;/.test(serverProto), 'C2S_TravelUse = wire 225');
const dts = readFileSync(resolve('src/net/proto/base_message.d.ts'), 'utf8');
ok(/travelOpen/.test(dts) && /TravelOption/.test(dts), '客户端 proto 生成物含 travelOpen/TravelOption');

// ── D. 客户端链路：bridge / store / 面板挂载 ──
console.log('[D] 客户端链路');
ok(/msg\.travelOpen/.test(bridge) && /sendTravelUse/.test(bridge), 'bridge 有 travelOpen 分发与 sendTravelUse');
ok(/setTravelOpen/.test(store) && /'travel'/.test(store), 'gameStore 有 travel 状态与 travel 面板');
ok(/TravelPanel/.test(panelsRoot), 'PanelsRoot 挂载 TravelPanel');

// ── E. 文案：travel.* 双语都在（i18n-parity 的 travel 子集，就地钉住） ──
console.log('[E] 文案');
const KEYS = ['travel.title', 'travel.titleWingGate', 'travel.confirm', 'travel.notEnoughGold', 'travel.wingRequired'];
for (const k of KEYS) {
  ok(k in zh && k in en, `${k} zh/en 双语在位`);
}

console.log('');
if (fails.length > 0) {
  console.error(`[verify-travel] FAIL：${fails.length}/${pass + fails.length} 断言未过`);
  process.exit(1);
}
console.log(`[verify-travel] 全部通过：${pass} 断言`);
