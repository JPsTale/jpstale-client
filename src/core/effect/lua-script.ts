/**
 * B6 Lua 前端（三族调度行 [25] + Lua 命令卷 L1-L33 的实现）—— 依据冻结文档：
 *
 *   · §C1/§C2：`.lua` 资产 = 全局函数命令流（每行一句、Begin/End 成对、`--` 注释、
 *     字符串枚举 stricmp 大小写不敏感）；本文件是**命令流读取器**（不是 Lua 解释器——
 *     资产只用到"逐行调用全局函数"这一子集，§C2）。
 *   · 行 [L1]：Begin 选类（6 类，stricmp）；后续命令只对匹配的控制器生效——
 *     **门控表照抄 C++，含缺陷**（行 [L24]：EventSize 对 ParticleSystem 是 no-op；
 *     行 [L26]：EventFadeSize 对 Mesh 是 no-op）——"顺手修好"= 与源码不一致，违规。
 *   · 行 [L27]/[L28]：Update/LoadScript/LoadScriptAxial 未注册为 Lua 命令
 *     （PiScript.cpp:38-71 缺席）⇒ 解析器遇到 = unknown-cmd（它们是宿主方法）。
 *   · 行 [25]/铁律 5③：ParticleSystem 块抽出的 IR 与 `.part` 共用同一批挂点
 *     （事件表喂 PtClockBehavior，行 [2]）——本文件只产 IR，不建第二套时间轴。
 *   · 未逐条取证的门控（InitPos 等）标 `unverified-gate`——如实记录，不冒充实测（U-A5-4 同批）。
 */
import type { Num } from './pt-value.js';

export type WorkType = 'PARENT' | 'MESH' | 'CREATEMESH' | 'BILLBOARD' | 'BILLBOARD_AXIAL' | 'PARTICLE_SYSTEM' | 'TEXTURE';

/** 门控表（A5 卷逐条 cpp 取证的子集；未取证 = 'UNVERIFIED'） */
export const GATES: Record<string, WorkType[] | 'UNVERIFIED'> = {
  // —— 逐字取证过的门控（A5 行 [L23]-[L26]、[L14]-[L17]、[L22]）——
  EventColor: ['MESH', 'TEXTURE', 'BILLBOARD_AXIAL', 'PARTICLE_SYSTEM'],       // HoEffectMain.cpp:232-236
  EventSize: ['MESH', 'TEXTURE', 'BILLBOARD_AXIAL'],                            // cpp:255-259（漏 PARTICLE_SYSTEM = 源码缺陷）
  EventFadeColor: ['MESH', 'TEXTURE', 'BILLBOARD_AXIAL', 'PARTICLE_SYSTEM'],    // cpp:278-282
  EventFadeSize: ['PARTICLE_SYSTEM', 'TEXTURE', 'BILLBOARD_AXIAL'],             // cpp:303-306（漏 MESH）
  InitParticleNum: ['PARTICLE_SYSTEM'],                                         // cpp:408-414
  InitEmitRate: ['PARTICLE_SYSTEM'],                                            // cpp:426-432
  InitVelocity: ['PARTICLE_SYSTEM'],                                            // cpp:417-425
  InitVelocityType: ['PARTICLE_SYSTEM'],                                        // cpp:380-392
  InitAxialPos: ['BILLBOARD_AXIAL'],                                            // cpp:435-441
  InitBlendType: ['TEXTURE', 'BILLBOARD_AXIAL', 'MESH', 'PARTICLE_SYSTEM'],     // [S25] 尾段
  // —— 未逐条取证（照常放行并标注，不冒充实测）——
  Begin: 'UNVERIFIED', End: 'UNVERIFIED', InitPos: 'UNVERIFIED', InitColor: 'UNVERIFIED',
  InitMeshName: 'UNVERIFIED', InitTextureName: 'UNVERIFIED', InitAniTextureName: 'UNVERIFIED',
  InitMaxFrame: 'UNVERIFIED', InitLoop: 'UNVERIFIED', InitStartDelayTime: 'UNVERIFIED',
  InitEndTime: 'UNVERIFIED', InitSize: 'UNVERIFIED', InitParticleType: 'UNVERIFIED',
  InitSpawnBoundingBox: 'UNVERIFIED', InitSpawnBoundingSphere: 'UNVERIFIED',
  InitSpawnBoundingDoughnut: 'UNVERIFIED',
  // Update/LoadScript/LoadScriptAxial：**不在 GATES**（注册表缺席 ⇒ unknown-cmd，行 [L27]/[L28]）
};

export interface LuaCmd {
  name: string;
  args: Array<number | string>;
  line: number;
  /** 门控裁定：applied=命中当前类；dropped-gate=类不匹配（源码 no-op，照抄）；
   *  unverified-gate=门控未取证（放行并标注）；unknown-cmd=注册表没有的命令 */
  gate: 'applied' | 'dropped-gate' | 'unverified-gate' | 'unknown-cmd';
}

export interface LuaBlock {
  /** Begin 的类（stricmp 归一为大写）；null = Begin 缺失的裸命令 */
  type: WorkType | null;
  beginLine: number | null;
  endLine: number | null;
  commands: LuaCmd[];
}

export interface ParseResult {
  blocks: LuaBlock[];
  /** Begin/End 不配对（End 多于 Begin 等）——解析报错，不静默（行 [L2]） */
  errors: Array<{ line: number; text: string }>;
  /** 无法解析成命令调用的非空行 */
  unparsed: Array<{ line: number; text: string }>;
}

const WORK_TYPES: WorkType[] = ['PARENT', 'MESH', 'CREATEMESH', 'BILLBOARD', 'BILLBOARD_AXIAL', 'PARTICLE_SYSTEM'];
/** stricmp 归一化查找表：Lua 字符串无下划线（"ParticleSystem"/"BillboardAxial"），
 *  内部枚举带下划线 ⇒ 双方去 '_' 后比对，命中返回规范枚举 */
const WORK_TYPE_LOOKUP = new Map(WORK_TYPES.map((t) => [t.replace(/_/g, ''), t]));

/** 解析单个实参：数字 → number；带引号 → string（去引号） */
function parseArg(raw: string): number | string {
  const s = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) return s.slice(1, -1);
  return s;
}

/** 拆实参（顶层逗号；双引号字符串内的逗号不拆） */
function splitArgs(inner: string): string[] {
  const out: string[] = [];
  let cur = ''; let inQuote = false;
  for (const ch of inner) {
    if (ch === '"') { inQuote = !inQuote; cur += ch; continue; }
    if (ch === ',' && !inQuote) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim() !== '') out.push(cur);
  return out;
}

/** 命令流读取器（§C2 子集：逐行 `Name(args)`；`--` 行注释剥除） */
export function parseLuaScript(text: string): ParseResult {
  const blocks: LuaBlock[] = [];
  const errors: ParseResult['errors'] = [];
  const unparsed: ParseResult['unparsed'] = [];
  let current: LuaBlock | null = null;
  let inBlockComment = false;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    let line = lines[i]!;
    if (inBlockComment) {
      const end = line.indexOf(']]');
      if (end >= 0) { line = line.slice(end + 2); inBlockComment = false; } else continue;
    }
    const blockStart = line.indexOf('--[[');
    if (blockStart >= 0) {
      line = line.slice(0, blockStart);
      if (!line.includes(']]')) { inBlockComment = true; }
    }
    line = line.replace(/--.*$/, '').trim();                 // 行注释
    if (line === '') continue;

    const m = /^([A-Za-z_]\w*)\s*\((.*)\)\s*;?\s*$/.exec(line);
    if (!m) { unparsed.push({ line: lineNo, text: line }); continue; }
    const name = m[1]!;
    const args = splitArgs(m[2]!).map(parseArg);

    if (name === 'Begin') {
      if (current) errors.push({ line: lineNo, text: 'Begin 嵌套（上一块未 End）' });
      // stricmp 语义：Lua 字符串"BillboardAxial/ParticleSystem"无下划线，
      // 内部枚举带下划线 ⇒ 归一化 = 大写 + 去 '_' 后经查找表回规范枚举
      const raw = String(args[0] ?? '').toUpperCase().replace(/_/g, '');
      const type = WORK_TYPE_LOOKUP.get(raw) ?? null;
      current = { type, beginLine: lineNo, endLine: null, commands: [] };
      continue;
    }
    if (name === 'End') {
      if (!current) { errors.push({ line: lineNo, text: 'End 多于 Begin' }); continue; }
      current.endLine = lineNo;
      blocks.push(current);
      current = null;
      continue;
    }

    const gate = GATES[name];
    let verdict: LuaCmd['gate'];
    if (gate === undefined) verdict = 'unknown-cmd';                        // 注册表/命令表没有（含宿主方法）
    else if (gate === 'UNVERIFIED') verdict = 'unverified-gate';
    else verdict = current?.type && gate.includes(current.type) ? 'applied' : 'dropped-gate';

    const cmd: LuaCmd = { name, args, line: lineNo, gate: current ? verdict : (gate === 'UNVERIFIED' ? 'unverified-gate' : 'unknown-cmd') };
    if (current) current.commands.push(cmd);
    else unparsed.push({ line: lineNo, text: line });                       // 块外的散命令（§C2：Begin/End 成对）
  }
  if (current) errors.push({ line: current.beginLine ?? 0, text: 'Begin 未 End' });
  return { blocks, errors, unparsed };
}

/* ── PARTICLE_SYSTEM 块 → IR（与 .part 共用挂点；行 [25]） ── */

export interface LuaParticleIR {
  numParticles?: number;
  emitRate?: number;
  loop?: number;
  delay?: number;
  endTime?: number | [number, number];
  /** 尺寸：**宽度区间、高度区间**（`InitSize(x1,x2,y1,y2)` 的四参语义；两参形式两端相等） */
  size?: [Num, Num];
  velocity?: [number, number, number, number, number, number];
  velocityType?: 'Random' | 'CurPos';
  particleType?: 'BillboardDefault' | 'BillboardAxial';
  blendType?: string;
  spawnBox?: [number, number, number, number, number, number];
  spawnSphere?: [number, number];
  spawnDoughnut?: [number, number, number, number];
  pos?: [number, number, number];
  color?: [number, number, number, number];
  texture?: string;
  /** 事件表（喂 PtClockBehavior，行 [2]；块值单位 0..255 与 .part 同） */
  events: Array<{ time: number; slot: 'color' | 'size' | 'sizeExt'; fade: boolean; next: number; value: Num[] }>;
  /** 被 NO-OP 门控丢弃的命令（行 [L24]/[L26] 源码缺陷——留痕不静默） */
  dropped: Array<{ name: string; line: number; reason: string }>;
  /** code spec 域命令（网格/贴图/轴对齐——行 [25]/[L5]/[L7]/[L8]） */
  codeSpec: LuaCmd[];
  /** 未逐条取证门控的放行命令 */
  unverified: Array<{ name: string; line: number }>;
}

function toNumPair(n: number | string, fallback = 0): Num {
  return typeof n === 'number' ? { k: 'n', v: n } : { k: 'n', v: fallback };
}

/** 从解析结果抽取 PARTICLE_SYSTEM 块的 IR（多个块 ⇒ 各自一份；行 [25]） */
export function particleIR(parsed: ParseResult): LuaParticleIR[] {
  const out: LuaParticleIR[] = [];
  for (const b of parsed.blocks) {
    if (b.type !== 'PARTICLE_SYSTEM') continue;
    const ir: LuaParticleIR = { events: [], dropped: [], codeSpec: [], unverified: [] };
    for (const { name, args, line, gate } of b.commands) {
      const n = (i: number, d = 0): number => (typeof args[i] === 'number' ? args[i] as number : d);
      if (gate === 'unknown-cmd') { ir.codeSpec.push({ name, args, line, gate }); continue; }
      if (gate === 'unverified-gate') ir.unverified.push({ name, line });
      switch (name) {
        case 'InitParticleNum': ir.numParticles = n(0); break;
        case 'InitEmitRate': ir.emitRate = n(0); break;
        case 'InitStartDelayTime': ir.delay = n(0); break;
        case 'InitEndTime':
          ir.endTime = args.length >= 2 ? [n(0), n(1)] : n(0); break;
        case 'InitSize': {   // C++：InitSize(x,y) ⇒ Min=Max；InitSize(x1,x2,y1,y2) ⇒ x∈[x1,x2]、y∈[y1,y2]
          const nn = (i: number): Num => ({ k: 'n', v: n(i) });
          const rr = (i: number, j: number): Num => ({ k: 'r', a: n(i), b: n(j) });
          ir.size = args.length >= 4 ? [rr(0, 1), rr(2, 3)] : [nn(0), nn(1)];
          break;
        }
        case 'InitVelocity':
          ir.velocity = [n(0), n(1), n(2), n(3), n(4), n(5)]; break;
        case 'InitVelocityType':
          ir.velocityType = String(args[0] ?? '').toLowerCase() === 'curpos' ? 'CurPos' : 'Random'; break;
        case 'InitParticleType':
          ir.particleType = String(args[0] ?? '').toLowerCase().startsWith('billboardaxial') ? 'BillboardAxial' : 'BillboardDefault'; break;
        case 'InitBlendType':
          ir.blendType = String(args[0] ?? ''); break;
        case 'InitSpawnBoundingBox':
          ir.spawnBox = [n(0), n(1), n(2), n(3), n(4), n(5)]; break;
        case 'InitSpawnBoundingSphere':
          ir.spawnSphere = [n(0), n(1)]; break;
        case 'InitSpawnBoundingDoughnut':
          ir.spawnDoughnut = [n(0), n(1), n(2), n(3)]; break;
        case 'InitPos':
          ir.pos = [n(0), n(1), n(2)]; break;                 // 行 [L3]：收下、运行忽略（调用方覆盖）
        case 'InitColor':
          ir.color = [n(0, 255), n(1, 255), n(2, 255), n(3, 255)]; break;
        case 'EventColor':                                    // 行 [L23]：到点赋值（非 fade）
          ir.events.push({ time: n(0), slot: 'color', fade: false, next: -1, value: [toNumPair(args[1] as number), toNumPair(args[2] as number), toNumPair(args[3] as number), toNumPair(args[4] as number)] });
          break;
        case 'EventFadeColor':                                // 行 [L25]：渐变
          ir.events.push({ time: n(0), slot: 'color', fade: true, next: -1, value: [toNumPair(args[1] as number), toNumPair(args[2] as number), toNumPair(args[3] as number), toNumPair(args[4] as number)] });
          break;
        case 'EventSize':                                     // 行 [L24]：对 ParticleSystem 是 no-op（源码缺陷）
          ir.dropped.push({ name, line, reason: 'EventSize 门控漏 PARTICLE_SYSTEM（源码缺陷，行[L24] 取证）' });
          break;
        case 'EventFadeSize':                                 // 行 [L26]：粒子域生效（C++ HoEffectController.cpp:21-33
          // 与 .part DoItToIt 逐字同构，m_Size 为 point3）⇒ x→size、y→sizeExt 两路 fade；
          // z 无 .part 对应（块无第三尺寸维）——丢弃留痕，U-A5-4 同批复核
          ir.events.push({ time: n(0), slot: 'size', fade: true, next: -1, value: [toNumPair(args[1] as number)] });
          ir.events.push({ time: n(0), slot: 'sizeExt', fade: true, next: -1, value: [toNumPair(args[2] as number)] });
          ir.dropped.push({ name: `${name}:z`, line, reason: 'point3 的 z 分量无 .part 尺寸对应（丢弃留痕，U-A5-4）' });
          break;
        case 'InitTextureName':
          ir.texture = String(args[0] ?? ''); break;
        case 'InitMeshName': case 'InitAniTextureName':
        case 'InitLoop':
          ir.loop = Math.trunc(n(0)); break;
        case 'InitMaxFrame': case 'Update':
        case 'LoadScript': case 'LoadScriptAxial': case 'InitAxialPos':
          ir.codeSpec.push({ name, args, line, gate }); break;  // 行 [25]/[L5]/[L7]/[L8]/[L27]/[L28]
        default:
          if (gate === 'unverified-gate') break;              // 已登记 unverified
          ir.codeSpec.push({ name, args, line, gate }); break;
      }
    }
    out.push(ir);
  }
  // Init* 参数 = ActualTime==0 事件的等价物（[S11] 创建回路：创建时跑 time-0 事件）——
  // 转成 time-0 事件进表，让 fade 链从初值起算（行 [L25] 的 255→128 斜坡依赖它）
  for (const ir of out) {
    if (ir.color) ir.events.unshift({ time: 0, slot: 'color', fade: false, next: -1, value: ir.color.map((c) => ({ k: 'n' as const, v: c })) });
    // 尺寸：区间原样进事件（PtClockBehavior 逐粒子掷 ⇒ 同 C++ `m_Size.GetRandom()`）——
    // 尺寸事件由 `luaIRToBuild` 统一追加（那里也负责缺省值），此处不再重复。
  }
  return out;
}
