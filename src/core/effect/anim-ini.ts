/**
 * 特效 INI 解析 —— `Effect/AnimationData/*.ini` + `Effect/ImageData/*.ini`
 *
 * 复刻原版（ex-machina `Legacy/Engine/2D/HoAnimData.cpp`）语义，逐字对齐：
 *  - 用 Win32 `GetPrivateProfile*` 读，故「同名键取第一次出现」（后出现的忽略）
 *  - `Delay` 单位是 **70Hz 的帧数**（`HoEffect.cpp` 的 MainEffect 固定 1/70 步进），不是秒
 *  - `BlendType`：0=Color 1=Alpha 2=Lamp(加法) 3=Shadow
 *  - `Size` 缺失时 **`Angle` 整段被跳过**（HoAnimData.cpp 的顺序即如此）
 *  - `memset(AnimFrame, 1, ...)` 怪癖：CSV 比帧数短时，未填到的帧 byte 字段 = 1、ushort 字段 = 0x0101 = 257
 *  - `ImageData` 的 `Name` 去掉扩展名后接 **1-based** 序号，**扩展名原样保留**
 *    （我方资产里 `Shock0.tga` + Count 3 → `shock01.tga/shock02.tga/shock03.tga`）
 *
 * 已知脏数据（原版同样容忍，勿"修好"）：
 *  - 3 个文件的 `DataFile` 指向不存在的 ImageData（如 `SkillRoarLinePartice1.ini` 少一个 l）
 *  - `criticalhit22.ini` 有 `-` 前缀的注释段、`fireparticle1_blh.ini` 有 `#` 注释行
 *    （非标准注释符，在原版里只是"无法识别的键"）
 */

/** 原版特效推进频率（HoEffect 固定 1/70 秒/步） */
export const EFFECT_HZ = 70;

export type EffectBlend = 'color' | 'alpha' | 'lamp' | 'shadow';

export interface EffectFrame {
  /** ImageData 里的帧下标（0-based，来自 ImageNum） */
  imageIndex: number;
  /** 该帧持续多少 70Hz 步 */
  delay: number;
  /** 不透明度 0..255（BlendValue） */
  alpha: number;
  /** 宽（Size）；该 INI 未提供 Size 段时为 null = 不应用尺寸动画 */
  size: number | null;
  /** 旋转角（度）；未提供 Size/Angle 时为 null = 不应用旋转动画 */
  angle: number | null;
}

export interface AnimationData {
  /** ImageData 的文件名（basename，如 Hit1.ini）；解析不到时为 null */
  dataFile: string | null;
  blend: EffectBlend;
  startBlendValue: number;
  /** 是否提供了 Size 段（决定是否应用尺寸/角度动画） */
  hasSize: boolean;
  frames: EffectFrame[];
}

export interface ImageData {
  /** 原样保留的 Name（含扩展名），已折叠反斜杠 */
  name: string;
  count: number;
}

/* ─────────── 极简 Win32 风格 INI 读取 ─────────── */

/** 按 Win32 GetPrivateProfile 语义读取：大小写不敏感、同名键取**第一次**、行内 `#` 起不算注释 */
function readIni(text: string): (key: string) => string | undefined {
  const kv = new Map<string, string>();
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line) continue;
    if (line.startsWith('[')) continue;          // 段头：本格式只关心键
    const i = line.indexOf('=');
    if (i < 0) continue;                          // 非键值行（原版同样忽略）
    const key = line.slice(0, i).trim().toLowerCase();
    if (!key) continue;
    if (kv.has(key)) continue;                    // 第一次出现的生效
    kv.set(key, line.slice(i + 1).trim());
  }
  // 查询时统一小写：调用方写 'blendValue' 或 'blendvalue' 都能取到
  // （曾因这里大小写不一致导致 BlendValue/ImageNum 静默取不到 → 特效透明不可见）
  return (key: string) => kv.get(key.toLowerCase());
}

/** CSV → number[]；容忍空白与空段 */
function csvInt(s: string | undefined): number[] {
  if (s === undefined || s === '') return [];
  return s.split(',').map((x) => {
    const v = Number(x.trim());
    return Number.isFinite(v) ? Math.trunc(v) : 0;
  });
}

function firstInt(s: string | undefined, dflt: number): number {
  const v = Number((s ?? '').trim());
  return Number.isFinite(v) ? Math.trunc(v) : dflt;
}

function toBlend(v: number): EffectBlend {
  switch (v) {
    case 1: return 'alpha';
    case 2: return 'lamp';
    case 3: return 'shadow';
    default: return 'color';
  }
}

/* ─────────── ImageData ─────────── */

export function parseImageData(text: string): ImageData | null {
  const get = readIni(text);
  const rawName = get('name');
  if (!rawName) return null;
  // 源文件里是 C++ 转义写法（Name = Effect\\ImageData\\Hit1\\Shock0.tga），按字面是两个反斜杠
  const name = rawName.replace(/\\+/g, '/').replace(/^\/+/, '');
  return { name, count: firstInt(get('count'), 0) };
}

/**
 * 由 ImageData 的 Name + Count 解析出每一帧的资产相对路径（小写）。
 * 规则：去掉扩展名 → 依次接 1..Count → 原扩展名原样保留。
 * 例：`Effect/ImageData/Hit1/Shock0.tga` + 3 → `effect/imagedata/hit1/shock01.tga` … `shock03.tga`
 */
export function resolveImageFrames(img: ImageData): string[] {
  const lower = img.name.toLowerCase();
  const dot = lower.lastIndexOf('.');
  const base = dot > 0 ? lower.slice(0, dot) : lower;
  const ext = dot > 0 ? lower.slice(dot) : '';
  const out: string[] = [];
  for (let i = 1; i <= img.count; i++) out.push(`${base}${i}${ext}`);
  return out;
}

/* ─────────── AnimationData ─────────── */

export function parseAnimationData(text: string): AnimationData {
  const get = readIni(text);
  const imageNum = csvInt(get('imageNum'));
  const delayRaw = csvInt(get('delay'));
  const blendRaw = csvInt(get('blendValue'));
  const sizeRaw = csvInt(get('size'));
  const sizeHeightRaw = csvInt(get('sizeheight'));
  // 原版：Size 缺失则整段 Angle 不生效（解析顺序决定）
  const angleRaw = sizeRaw.length > 0 ? csvInt(get('angle')) : [];

  // 帧数以 ImageNum 为准；它为空时退化为其它列表里最长的一个
  const frameCount = imageNum.length || Math.max(delayRaw.length, blendRaw.length, sizeRaw.length);

  const frames: EffectFrame[] = [];
  for (let i = 0; i < frameCount; i++) {
    frames.push({
      imageIndex: imageNum[i] ?? 0,
      // Delay 未填到时原版 memset 会留下 257（我方 99 个文件里不存在此情况，保留兜底）
      delay: delayRaw[i] ?? 257,
      // byte 字段未填到 = 1（shield1.ini 的 BlendValue 少一项，正是这一条）
      alpha: blendRaw[i] ?? 1,
      // 只有提供了 Size 段才应用尺寸/角度动画（原版按 InfoFlag 决定，未提供则整段不生效）
      size: sizeRaw.length > 0 ? (sizeRaw[i] ?? sizeHeightRaw[i] ?? 257) : null,
      angle: angleRaw.length > 0 ? (angleRaw[i] ?? 0) : null,
    });
  }

  const dataFileRaw = get('datafile');
  return {
    dataFile: dataFileRaw ? dataFileRaw.trim() : null,
    blend: toBlend(firstInt(get('blendtype'), 0)),
    startBlendValue: firstInt(get('startblendvalue'), 0),
    hasSize: sizeRaw.length > 0,
    frames,
  };
}
