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
