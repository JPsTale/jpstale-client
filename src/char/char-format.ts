/**
 * PT 角色动画数据类型定义
 *
 * 来源：
 *  - exm Legacy/Engine/Graphics/smType.h: smMOTIONINFO / smMODELINFO / _MODELGROUP
 *  - exm Legacy/Game/Character/character.h: CHRMOTION_STATE_* / CHRMOTION_EXT
 *  - pviewer inx-parser.js: CLASS_FLAG / CHRMOTION_STATE
 */

// ===== 动画状态码 =====

export const CHRMOTION_EXT = 10;

/**
 * 死亡动作态（原版 `character.h` 的 `CHRMOTION_STATE_DEAD`）。
 *
 * **唯一常量定义** —— 这个值在别处被拼过至少三遍（下面的标签表、`WorldView.ANIM_DEAD`、
 * `anim-state-machine.STATE.DEAD`、怪物载入时"对死亡动作扣 8 帧"的判定），
 * 任何一处写错都表现为"尸体不躺下 / 尸体多趴 8 帧"这类很难定位的现象，故收敛到这里。
 */
export const CHRMOTION_STATE_DEAD = 0x0120;

/**
 * 技能动作态（原版 `character.h` 的 `CHRMOTION_STATE_SKILL`）。
 *
 * 与 DEAD 同理收敛：这个值此前在 `WorldView` 里是写死的 `0x0150`，而现在**多处**要按它分支
 * （怪物技能的事件帧武装、起手法阵/起手音、音效桶选择）⇒ 只留这一份定义。
 */
export const CHRMOTION_STATE_SKILL = 0x0150;

export const CHRMOTION_STATE: Record<number, string> = {
  0x00: 'NONE',
  0x40: 'STAND',
  0x50: 'WALK',
  0x60: 'RUN',
  0x70: 'SPRINT',
  0x80: 'FALLDOWN',
  0x100: 'ATTACK',
  0x110: 'DAMAGE',
  0x120: 'DEAD',
  0x130: 'SOMETIME',
  0x140: 'EAT',
  0x150: 'SKILL',
  0x170: 'FALLSTAND',
  0x180: 'FALLDAMAGE',
  0x200: 'RESTART',
  0x210: 'WARP',
  0x220: 'YAHOO',
  0x230: 'TAUNT',
  0x300: 'HAMMER',
  0x400: 'TALK_AR',
  0x410: 'TALK_E',
  0x420: 'TALK_OH',
  0x430: 'TALK_EYE',
  0x440: 'SMILE',
  0x450: 'GRUMBLE',
  0x460: 'SORROW',
  0x470: 'STARTLED',
  0x480: 'NATURE',
  0x490: 'SPECIAL',
};

export function motionStateName(state: number): string {
  return CHRMOTION_STATE[state] || ('0x' + state.toString(16));
}

// ===== 职业位掩码 =====

export const CLASS_FLAG: Record<string, number> = {
  Fighter: 0x0001,
  Mechanician: 0x0002,
  Archer: 0x0004,
  Pikeman: 0x0008,
  Atalanta: 0x0010,
  Knight: 0x0020,
  Magician: 0x0040,
  Priestess: 0x0080,
  Assassin: 0x0100,
  Shaman: 0x0200,
  // 第 11 职业 = 格斗家（徒手职业）。依据：m8 组 81 条全部标此位，
  // 且 m8 #51 的 attack_unarmed 是**双结算帧**（ev=960,3200）—— 徒手两段连击正是
  // 格斗家的招牌动作。其技能块为 203..222（紧接 m7 的 183..202）。
  // 注意：class 1 的 Fighter 在中文客户端里不是"格斗家"，勿混。
  // 我方 assets 仍缺该职业的体型/头部 inx，JOB_DATA 亦无 job 11 条目。
  MartialArtist: 0x0400,
};

export function decodeClassFlags(flag: number): string[] {
  if (!flag) return ['ALL'];
  const names: string[] = [];
  for (const [name, bit] of Object.entries(CLASS_FLAG)) {
    if (flag & bit) names.push(name);
  }
  return names.length ? names : ['NONE'];
}

// ===== 数据结构 =====

export interface FramePos {
  startFrame: number;
  endFrame: number;
  posNum: number;
  posCnt: number;
}

export interface MotionInfo {
  index: number;
  state: number;
  motionKeyWord1: number;
  startFrame: number;
  motionKeyWord2: number;
  endFrame: number;
  eventFrame: number[];
  itemCodeCount: number;
  itemCodeList: Uint16Array;
  dwJobCodeBit: number;
  skillCodeList: Uint8Array;
  mapPosition: number;
  repeat: number;
  keyCode: number;
  fxValue: number[];
  motionFrame: number;
  /** 该条目所属动画 .smb：仅子模型(subModelFile)条目携带，缺省用主体 animSmb */
  animSmb?: SmbData;
  /**
   * 该条目来自**副模型**（`.inx` 的 `subModelFile`，即 `*-die.INI` 那类）。
   *
   * 原版同名机制：`smCHAR::SetMotionFromCode` 先查主模型动作表，**查不到才查副模型**，
   * 查到就 `MotionSelectFrame = 1` 并改用副模型渲染（`PatDispMode & DISP_MODE_PATSUB` → `Pattern2`）。
   * 所以"这条动作属于哪具模型"是**逐条目**的属性，不是角色的属性。
   *
   * ⚠ 为什么必须显式标出来：实测 66 个带 DEAD 的副模型里 **63 个骨架与主模型完全不同**
   * （例：figon 主独有 29 根骨、副独有 51 根）⇒ 把副模型的动作套在主模型骨架上会错位。
   * 渲染方据此**连网格+骨架一起切**，不能只换 `animSmb`。
   */
  subModel?: boolean;
}

export interface ModelGroup {
  modelNameCnt: number;
  modelNames: string[];
}

export interface InxData {
  modelFile: string;
  motionFile: string;
  subModelFile: string;
  highModel: ModelGroup;
  defaultModel: ModelGroup;
  lowModel: ModelGroup;
  motions: MotionInfo[];
  motionCount: number;
  fileTypeKeyWord: number;
  linkFileKeyWord: number;
  szLinkFile: string;
  talkLinkFile: string;
  talkMotionFile: string;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface RotKey {
  frame: number;
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface PosKey {
  frame: number;
  x: number;
  y: number;
  z: number;
}

export interface ScaleKey {
  frame: number;
  x: number;
  y: number;
  z: number;
}

export interface Face {
  v: number[];
  t: { u: number; v: number }[];
  lpTexLink: number;
}

export interface TexLink {
  u: number[];
  v: number[];
  hTexture: number;
  nextTex: number;
}

export interface MaterialInfo {
  inUse: number;
  textureCounter: number;
  texturePaths: string[];
  mapOpacity: number;
  textureType: number;
  blendType: number;
  twoSide: number;
  transparency: number;
  selfIllum: number;
  animTexCounter: number;
  animTexturePaths: string[];
}

export interface Obj3D {
  info: { nodeName: string; length: number; objFilePoint: number };
  nodeName: string;
  nodeParent: string;
  hasPhysique: boolean;
  nVertex: number;
  nFace: number;
  nTexLink: number;
  texLinkPtr: number;
  tmFrameCnt: number;
  vertices: { x: number; y: number; z: number; nx: number; ny: number; nz: number }[];
  faces: Face[];
  texLinks: TexLink[];
  tmRot: RotKey[];
  tmPos: PosKey[];
  tmScale: ScaleKey[];
  tmPrevRot: number[][];
  tmRotFrame: FramePos[];
  tmPosFrame: FramePos[];
  tmScaleFrame: FramePos[];
  boneNames: string[] | null;
  bindQuat: Quat;
  bindScale: Vec3;
  bindPos: Vec3;
  tm: { m: number[] };
  tmInvert: { m: number[] };
  tmRotate: { m: number[] };
  mWorld: { m: number[] };
  mLocal: { m: number[] };
  tmResult: number[];
  head: number;
  posi: Vec3;
  cameraPosi: Vec3;
  angle: Vec3;
}

export interface SmbData {
  header: string;
  objCounter: number;
  matCounter: number;
  matFilePoint: number;
  firstObjInfoPoint: number;
  tmFrameCounter: number;
  tmFrame: FramePos[];
  objInfos: { nodeName: string; length: number; objFilePoint: number }[];
  materials: MaterialInfo[];
  objects: Obj3D[];
}

export interface SkelFrame {
  name: string;
  local: number[];
  world: number[];
  pos: Vec3;
}
