/**
 * `.part` 粒子脚本解析 —— 原版 `Effect/Particle/Script/*.part`
 *
 * 文法（实测 445 个文件，嵌套深度最多 2）：
 *
 *   particlesystem "名字" 1.00 {
 *     position = XYZ(0,0,0)
 *     eventsequence "名字" {
 *       sourceblendmode = BLEND_LAMP
 *       particletype    = TYPE_TWO
 *       numparticles    = 20          emitrate = 200      loops = 1     delay = 0
 *       lifetime        = random(0.5,1)                    // 秒
 *       emitradius      = xyz(random(-30,30),random(20,30),random(-30,30))
 *       initial velocity = XYZ(0,random(5,10),0)
 *       gravity         = XYZ(0,0,0)
 *       texture         = "effect\\particle\\flare.tga"
 *       initial size    = random(5,7)     initial sizeExt = 30
 *       initial color   = rgba(255,255,255,random(50,150))
 *       initial partAngleY = 0            initial LocalAngleY = 0
 *       fade so final color = rgba(0,0,0,0)
 *       fade so final size  = 1
 *       fade so final partAngleY = 250
 *     }
 *   }
 *
 * 值文法只有四种（实测）：数字、`random(a,b)`（大小写不敏感）、`XYZ(x,y,z)`/`xyz(...)`、`rgba(r,g,b,a)`；
 * 分量里可以再嵌 `random(a,b)`。另有引号字符串（纹理路径）。
 *
 * 已知精简（见阶段 3 说明）：
 *  - **多关键帧**：解析层**完整收集**（`PartEmitter.keyframes`，含中间帧与 `at <t> eventtimer`），
 *    渲染层也**已经消费**（`part-to-quarks.kfOf` → quarks 的 `Gradient`）——
 *    该缺口在 §12 迁移到 quarks 时**关闭**（此前自研 emitter 只取首尾，故曾记为"渲染侧缺口"）。
 *    带 `fade so at` 的文件约占 1/3。
 *  - `ParticleTypes[4]` 表在 ex-machina 里**只有声明没有定义**（反编译缺失），
 *    故 TYPE_ONE..FOUR 的精确渲染模式无法查证，运行时按"朝向相机的广告牌 + 旋转"近似。
 */

/** 一个可取值：定值或区间（`random(a,b)` 在生成每个粒子时滚动一次） */
export type Num = { k: 'n'; v: number } | { k: 'r'; a: number; b: number };
export type Vec3 = { x: Num; y: Num; z: Num };
export type Rgba = { r: Num; g: Num; b: Num; a: Num };

export type PartValue =
  | { k: 'num'; v: Num }
  | { k: 'vec'; v: Vec3 }
  | { k: 'color'; v: Rgba }
  | { k: 'str'; v: string };

export type PartBlend = 'lamp' | 'alpha' | 'color' | 'shadow' | 'invshadow' | 'addcolor';

/** 一个带时间戳的关键帧。`time` 单位是**秒**（原版 `at <t> <属性>` 的 t，实测最大到 12） */
export interface PartKeyframe {
  time: number;
  value: PartValue;
  /**
   * 原版 `IsFade`（`HoNewParticle.cpp:978 ProcessTime`）：
   *   `true`  —— 写法是 `fade so at <t> <属性>`：**线性过渡**到该值（各 `DoItToIt` 里算 Step）；
   *   `false` —— 写法是裸 `at <t> <属性>`：**到点直接赋值**（`if (!IsFade()) part.X = …`）＝**阶跃**。
   *
   * ⚠ 它**每个事件独立**：`ProcessTime` 里先看有没有 `fade`→`so`，没有就 `IsFade = false`，
   * 状态**不跨行继承**。我一度按"tokenizer 有状态、裸 at 是上一行 fade so 的续行"处理
   * （把裸 `at` 补成 `fade so at`）—— 依据是错的，于是 606 个阶跃事件被当成了渐变。
   */
  fade: boolean;
}

/**
 * emitter 内的多关键帧轨道：属性名 → 按时间升序的关键帧。
 *
 * 为什么必须收集（2026-09-16）：原版每条属性是一条**带时间戳的事件链**，相邻事件之间
 * 按 `Step = (新值 − 当前值) / (下一帧时间 − 当前帧时间)` 线性推进
 * （ex-machina `HoNewParticle.cpp` 各 `HoNewParticleEvent_*::DoItToIt`）。
 * 此前本解析器只保留 `initial X` 与 `fade so final X` 两个端点，**中间帧被丢弃**，
 * 于是当时"多关键帧"在渲染侧无从实现。
 * 转到 quarks 后中间帧是必需的、也已被消费（框架的曲线发生器正是按 `[值, 时间]` 列表表达，
 * 见 `part-to-quarks.kfOf`）—— 即该缺口在 §12 迁移时已关闭。
 */
export type PartKeyframes = Record<string, PartKeyframe[]>;

export interface PartEmitter {
  name: string;
  blend: PartBlend;
  /** TYPE_ONE..FOUR；**5 = 世界朝向面片**（我方扩展，PT 无此类型，原版走网格子系统） */
  particleType: number;
  numParticles: number;
  /** 每秒发射数 */
  emitRate: number;
  loops: number;
  delay: number;
  /** 寿命（秒） */
  lifetime: Num;
  emitRadius: Vec3;
  initialVelocity: Vec3;
  gravity: Vec3;
  texture: string | null;
  initialSize: Num | null;
  initialSizeExt: Num | null;
  initialColor: Rgba | null;
  initialPartAngle: Vec3 | null;
  initialLocalAngle: Vec3 | null;
  finalColor: Rgba | null;
  finalSize: Num | null;
  finalSizeExt: Num | null;
  finalPartAngle: Vec3 | null;
  finalLocalAngle: Vec3 | null;
  finalVelocity: Vec3 | null;
  /** 多关键帧轨道（`fade so at <t> <属性>`）；含端点帧，按时间升序 */
  keyframes: PartKeyframes;
}

export interface PartSystem {
  name: string;
  version: number;
  position: Vec3 | null;
  emitters: PartEmitter[];
  /**
   * **没被任何字段消费**的键（诊断用）。
   *
   * `.part` 是原版自研的一套源语（解释器在 `HoBaram/HoNewParticle.cpp`，关键字表见那里的
   * tokenizer）——本解析器只覆盖了其中一部分。没被读到的键此前是**静默丢弃**的
   * （`initial partAngleZ` 就是这么丢了很久，表现为"所有粒子朝向一样、看着不动"）。
   * 现在把它们记下来，由 `scripts/scan-part-coverage.ts` 汇总，让缺口可见（AGENTS #12）。
   */
  unhandled?: string[];
}

/* ─────────── 值解析 ─────────── */

/** 取滚动值：定值或区间内随机（原版 HoMinMax::GetRandomNumInRange） */
export function roll(n: Num): number {
  return n.k === 'n' ? n.v : n.a + Math.random() * (n.b - n.a);
}

function parseNum(s: string): Num | null {
  const t = s.trim();
  const rnd = /^random\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)$/i.exec(t);
  if (rnd) return { k: 'r', a: Number(rnd[1]), b: Number(rnd[2]) };
  const n = Number(t);
  return Number.isFinite(n) ? { k: 'n', v: n } : null;
}

/** 按顶层逗号切分（忽略括号内的逗号） */
function splitArgs(s: string): string[] {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

function parseVec3(s: string): Vec3 | null {
  const m = /^xyz\((.*)\)$/i.exec(s.trim());
  if (!m) return null;
  const a = splitArgs(m[1]!);
  if (a.length < 3) return null;
  const x = parseNum(a[0]!), y = parseNum(a[1]!), z = parseNum(a[2]!);
  return x && y && z ? { x, y, z } : null;
}

function parseRgba(s: string): Rgba | null {
  const m = /^rgba?\((.*)\)$/i.exec(s.trim());
  if (!m) return null;
  const a = splitArgs(m[1]!);
  if (a.length < 3) return null;
  const r = parseNum(a[0]!), g = parseNum(a[1]!), b = parseNum(a[2]!);
  const al = a.length > 3 ? parseNum(a[3]!) : { k: 'n', v: 255 } as Num;
  return r && g && b && al ? { r, g, b, a: al } : null;
}

function parseValue(raw: string): PartValue | null {
  const s = raw.trim();
  const str = /^"(.*)"$/.exec(s);
  if (str) return { k: 'str', v: str[1]! };
  const vec = parseVec3(s);
  if (vec) return { k: 'vec', v: vec };
  const col = parseRgba(s);
  if (col) return { k: 'color', v: col };
  const n = parseNum(s);
  if (n) return { k: 'num', v: n };
  // 裸标识符（`TYPE_THREE` / `BLEND_LAMP` / `BLEND_INVSHADOW` …）。
  // ⚠ 此前这里返回 null ⇒ 调用方 `if (!val) continue` **整行丢弃**，后果：
  //   `particletype` 恒为默认 TYPE_TWO（水平面）、`sourceblendmode` 恒为默认 LAMP（加法）
  //   ⇒ 全部 SHADOW / INVSHADOW / ALPHA 粒子都在按加法渲染，且 4 种面朝向只剩一种。
  // 2026-09-16 在 efria-studio 的粒子验证页（`.part` → three.quarks）实测发现。
  const bare = /^[A-Za-z_][A-Za-z0-9_]*$/.exec(s);
  return bare ? { k: 'str', v: bare[0] } : null;
}

/* ─────────── 枚举 ─────────── */

function toBlend(raw: string): PartBlend {
  const s = raw.trim().toUpperCase();
  if (s === 'BLEND_INVSHADOW') return 'invshadow';
  if (s === 'BLEND_COLOR' || s === 'BLEND_COLORO') return 'color'; // COLORO 是资产里的拼写错误
  if (s === 'BLEND_ALPHA') return 'alpha';
  if (s === 'BLEND_SHADOW') return 'shadow';
  // 原版共 **6 种**混合（`HoNewParticle.cpp:689` 的 `BlendingModes[6]`）：
  //   ALPHA / COLOR / **ADDCOLOR** / SHADOW / LAMP / INVSHADOW
  // ⚠ `BLEND_ADDCOLOR` 此前会**静默**落进下面的默认分支（当成 lamp）✗ ——
  //   它们在 D3D 里是两种不同的因子组合（`LAMP` = `SRC_ALPHA/ONE`，`ADDCOLOR` 的因子本模块**未核实**）
  //   ⇒ 这里显式映射到同一个结果，但**留痕**：调用方（`part-to-quarks`）会把它写进 notes 上报。
  if (s === 'BLEND_ADDCOLOR') return 'addcolor';
  return 'lamp';
}

function toParticleType(raw: string): number {
  switch (raw.trim().toUpperCase()) {
    case 'TYPE_ONE': return 1;
    case 'TYPE_TWO': return 2;
    case 'TYPE_THREE': return 3;
    case 'TYPE_FOUR': return 4;
    default: return 2;
  }
}

/* ─────────── 主解析 ─────────── */

function numOf(v: PartValue | undefined): Num | null {
  return v && v.k === 'num' ? v.v : null;
}
function vecOf(v: PartValue | undefined): Vec3 | null {
  return v && v.k === 'vec' ? v.v : null;
}

/**
 * 取"角度/朝向"这类字段 —— **两种写法都要吃**（资产里两种都有）：
 *
 *   `initial partAngle  = xyz(0,0,random(0,360))`   ← 向量写法
 *   `initial partAngleZ = random(0,360)`            ← 单轴标量写法（归一后键是 `initial partanglez`）
 *
 * ⚠ 此前只查向量写法 ⇒ **标量写法被静默丢弃**（VigorBall 三个脚本全是这一种）：
 *   每个粒子的初始朝向都一样、也没有"朝向随时间变"的终点值 ⇒
 *   看上去像"所有粒子一个样、不动"（用户实测："飞行过程中的粒子似乎没有序列帧动画"）。
 *   与 `parseValue` 里那次"裸标识符整行丢弃"是同一类错误：**没匹配上就当没写**。
 */
function axisVecOf(kv: Map<string, PartValue>, base: string, used?: Set<string>): Vec3 | null {
  const at = (k: string) => { used?.add(k); return kv.get(k); };
  const v = vecOf(at(base));
  const ax = numOf(at(base + 'x'));
  const ay = numOf(at(base + 'y'));
  const az = numOf(at(base + 'z'));
  if (!v && !ax && !ay && !az) return null;
  const zero: Num = { k: 'n', v: 0 };
  return { x: ax ?? v?.x ?? zero, y: ay ?? v?.y ?? zero, z: az ?? v?.z ?? zero };
}
function colOf(v: PartValue | undefined): Rgba | null {
  return v && v.k === 'color' ? v.v : null;
}
function strOf(v: PartValue | undefined): string | null {
  return v && v.k === 'str' ? v.v : null;
}

/** 解析一个 `.part` 文本。语法错误不抛，尽量返回已解析到的部分。 */
export function parsePart(text: string): PartSystem {
  const sys: PartSystem = { name: '', version: 1, position: null, emitters: [] };
  /** 当前 emitter 的键值对（键已小写、压缩空格） */
  let kv: Map<string, PartValue> | null = null;
  /** 收尾当前 emitter 块：把**没被任何字段消费**的键记到 `sys.unhandled`（诊断用，见该字段说明） */
  const pushEmitter = (): void => {
    if (!kv) return;
    const used = new Set<string>();
    sys.emitters.push(buildEmitter(kv, used));
    for (const k of kv.keys()) if (!used.has(k)) (sys.unhandled ??= []).push(k);
    kv = null;
  };

  // ⚠ 资产里有**紧凑写法**：一行挤多条语句（`alas_keep.part` 全文 2186 字节只占 ~10 行）。
  // 旧的"逐行 + 行首锚定"解析会把同一行里的 `eventsequence` 与后续键值对**整批丢掉**
  // ⇒ 该文件解析出 0 个 emitter（表现为"特效不存在"）。2026-09-16 在 efria-studio 的
  // 粒子验证页（`.part` → three.quarks）实测发现。
  // 规范化只做两件无损的事：把 `{`/`}` 与 `eventsequence` 拆到独立行；键值对改用**全局正则**扫描
  //（值文法只有 数字/random/XYZ/rgba/引号串/裸标识符 六种，故可以精确圈定值的边界）。
  const norm = text
    .replace(/[{}]/g, (m) => `\n${m}\n`)
    .replace(/\beventsequence\b/gi, '\neventsequence');

  const PS_RE = /^particlesystem\s+"([^"]*)"\s*([\d.]*)/i;
  const ES_RE = /^eventsequence\s+"([^"]*)"/i;
  // 值边界必须支持**一层嵌套**：`xyz(random(-20,20),0,random(-20,20))` 是常态
  //（旧的 `xyz\([^)]*\)` 会在第一个 `)` 停下 ⇒ 值残缺 ⇒ 整条被丢弃）
  const KV_RE = /([A-Za-z_][A-Za-z0-9_ .]*?)\s*=\s*((?:random|xyz|rgba)\((?:[^()]|\([^()]*\))*\)|"[^"]*"|[A-Za-z_][A-Za-z0-9_]*|-?\d+(?:\.\d+)?)/gi;

  for (const raw of norm.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    // particlesystem "名字" 1.00 {
    const ps = PS_RE.exec(line);
    if (ps) {
      sys.name = ps[1] ?? '';
      sys.version = Number(ps[2] || 1) || 1;
      continue;
    }
    // eventsequence "名字" {
    const es = ES_RE.exec(line);
    if (es) {
      kv = new Map();
      kv.set('__name', { k: 'str', v: es[1] ?? '' });
    }
    // 块结束：把当前 emitter 收尾
    if (line.startsWith('}')) {
      if (kv) { pushEmitter(); }
      continue;
    }
    // 键 = 值：一行可能有多对（紧凑写法）
    KV_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = KV_RE.exec(line)) !== null) {
      const rawKey = m[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
      // 键名**原样保留**（不再把裸 `at` 补成 `fade so at`）：两者在原版是两类事件 ——
      // `fade so at <t> X`（渐变）vs `at <t> X`（到点赋值/阶跃），见 `PartKeyframe.fade`。
      const key = rawKey;
      const val = parseValue(m[2]!);
      if (!val) continue;
      if (kv) { if (!kv.has(key)) kv.set(key, val); }         // emitter 内：同名取第一次
      else if (key === 'position') sys.position = vecOf(val);  // 系统级：position
    }
  }
  // 容错：最后一块没写 } 也要收
  if (kv) pushEmitter();
  return sys;
}

function buildEmitter(kv: Map<string, PartValue>, used: Set<string>): PartEmitter {
  // 每次取值都登记 ⇒ `unhandled` 由差集算出，**不需要维护第二份键表**（那样迟早漂移）
  const g = (k: string) => { used.add(k); return kv.get(k); };
  const keyframes = collectKeyframes(kv, used);
  return {
    name: strOf(g('__name')) ?? '',
    blend: toBlend(strOf(g('sourceblendmode')) ?? 'BLEND_LAMP'),
    // 未声明时的默认 = `TYPE_ONE`（朝相机的广告牌）。
    // 依据：`HoNewParticle.cpp:1925` 构造时 `ParticleType = TYPE_ONE;`
    //   —— 这就是".part 里没写 PARTICLETYPE"时原版实际走的值。
    // ⚠ 曾默认成 `TYPE_TWO`（水平 XZ 面）⇒ 所有未声明类型的粒子被**拍平**：
    //   `hulkhit1.part` 正是如此，表现为"粒子面朝上、视线拉平后变成薄薄一片"（用户实测发现）。
    particleType: toParticleType(strOf(g('particletype')) ?? 'TYPE_ONE'),
    numParticles: numOf(g('numparticles')) ? roll(numOf(g('numparticles'))!) : 1,
    emitRate: numOf(g('emitrate')) ? roll(numOf(g('emitrate'))!) : 1,
    loops: numOf(g('loops')) ? roll(numOf(g('loops'))!) : 1,
    delay: numOf(g('delay')) ? roll(numOf(g('delay'))!) : 0,
    lifetime: numOf(g('lifetime')) ?? { k: 'n', v: 1 },
    emitRadius: vecOf(g('emitradius')) ?? { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } },
    initialVelocity: vecOf(g('initial velocity')) ?? { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } },
    gravity: vecOf(g('gravity')) ?? { x: { k: 'n', v: 0 }, y: { k: 'n', v: 0 }, z: { k: 'n', v: 0 } },
    texture: strOf(g('texture')),
    initialSize: numOf(g('initial size')),
    initialSizeExt: numOf(g('initial sizeext')),
    initialColor: colOf(g('initial color')),
    initialPartAngle: axisVecOf(kv, 'initial partangle', used),
    initialLocalAngle: axisVecOf(kv, 'initial localangle', used),
    finalColor: colOf(g('fade so final color')),
    finalSize: numOf(g('fade so final size')),
    finalSizeExt: numOf(g('fade so final sizeext')),
    finalPartAngle: axisVecOf(kv, 'fade so final partangle', used),
    finalLocalAngle: axisVecOf(kv, 'fade so final localangle', used),
    finalVelocity: vecOf(g('fade so final velocity')),
    keyframes,
  };
}

/**
 * 收集中间关键帧（同属性按时间升序）—— 两种写法都收，`fade` 标志区分：
 *   `fade so at <t> <属性> = v` → 渐变目标；`at <t> <属性> = v` → 到点赋值（阶跃）。
 * 其他写法（`fade so <属性>`、`at <属性>`、裸 `final <属性>`）在原版是**报错**或未用到的形态，
 * 这里**不收** ⇒ 它们会落进 `unhandled`（可见），而不是被猜成某种语义。
 */
function collectKeyframes(kv: Map<string, PartValue>, used?: Set<string>): PartKeyframes {
  const out: PartKeyframes = {};
  for (const [key, value] of kv) {
    const m = /^(fade so )?at\s+(-?[\d.]+)\s+(.+)$/.exec(key);
    if (!m) continue;
    used?.add(key);
    const time = Number(m[2]);
    if (!Number.isFinite(time)) continue;
    const prop = m[3]!.trim();
    (out[prop] ??= []).push({ time, value, fade: m[1] !== undefined });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.time - b.time);
  return out;
}
