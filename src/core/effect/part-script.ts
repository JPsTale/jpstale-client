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
 *  - **多关键帧** `fade so at N <属性>` + `at N eventtimer` 只取首尾（initial → final）做线性插值；
 *    带 `fade so at` 的文件约占 1/3，属于后续细化项。
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

export type PartBlend = 'lamp' | 'alpha' | 'color' | 'shadow' | 'invshadow';

export interface PartEmitter {
  name: string;
  blend: PartBlend;
  /** TYPE_ONE..FOUR（见文件头说明：渲染模式为近似） */
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
}

export interface PartSystem {
  name: string;
  version: number;
  position: Vec3 | null;
  emitters: PartEmitter[];
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
  return n ? { k: 'num', v: n } : null;
}

/* ─────────── 枚举 ─────────── */

function toBlend(raw: string): PartBlend {
  const s = raw.trim().toUpperCase();
  if (s === 'BLEND_INVSHADOW') return 'invshadow';
  if (s === 'BLEND_COLOR' || s === 'BLEND_COLORO') return 'color'; // COLORO 是资产里的拼写错误
  if (s === 'BLEND_ALPHA') return 'alpha';
  if (s === 'BLEND_SHADOW') return 'shadow';
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

  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line || line.startsWith('//')) continue;

    // particlesystem "名字" 1.00 {
    const ps = /^particlesystem\s+"([^"]*)"\s*([\d.]*)/i.exec(line);
    if (ps) {
      sys.name = ps[1] ?? '';
      sys.version = Number(ps[2] || 1) || 1;
      continue;
    }
    // eventsequence "名字" {
    const es = /^eventsequence\s+"([^"]*)"/i.exec(line);
    if (es) {
      kv = new Map();
      kv.set('__name', { k: 'str', v: es[1] ?? '' });
      continue;
    }
    // 块结束：把当前 emitter 收尾
    if (line.startsWith('}')) {
      if (kv) { sys.emitters.push(buildEmitter(kv)); kv = null; }
      continue;
    }
    // 键 = 值
    const m = /^([A-Za-z_][A-Za-z0-9_ ]*?)\s*=\s*(.+?);?$/.exec(line);
    if (!m) continue;
    const key = m[1]!.trim().toLowerCase().replace(/\s+/g, ' ');
    const val = parseValue(m[2]!);
    if (!val) continue;
    if (kv) { if (!kv.has(key)) kv.set(key, val); }         // emitter 内：同名取第一次
    else if (key === 'position') sys.position = vecOf(val);  // 系统级：position
  }
  // 容错：最后一块没写 } 也要收
  if (kv) sys.emitters.push(buildEmitter(kv));
  return sys;
}

function buildEmitter(kv: Map<string, PartValue>): PartEmitter {
  const g = (k: string) => kv.get(k);
  return {
    name: strOf(g('__name')) ?? '',
    blend: toBlend(strOf(g('sourceblendmode')) ?? 'BLEND_LAMP'),
    particleType: toParticleType(strOf(g('particletype')) ?? 'TYPE_TWO'),
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
    initialPartAngle: vecOf(g('initial partangle')),
    initialLocalAngle: vecOf(g('initial localangle')),
    finalColor: colOf(g('fade so final color')),
    finalSize: numOf(g('fade so final size')),
    finalSizeExt: numOf(g('fade so final sizeext')),
    finalPartAngle: vecOf(g('fade so final partangle')),
    finalLocalAngle: vecOf(g('fade so final localangle')),
    finalVelocity: vecOf(g('fade so final velocity')),
  };
}
