/**
 * PT 角色文件解析器（.inx / .smb / .smd）
 *
 * 严格依据 exm C++ 源码：
 *  - Legacy/IO/fileread.cpp: smModelDecode / MotionKeyWordDecode
 *  - Legacy/Engine/Graphics/smObj3d.cpp: smPAT3D::LoadFile / smOBJ3D::LoadFile
 *  - Legacy/Engine/Graphics/smType.h: smMOTIONINFO / smMODELINFO / smVERTEX / smFACE / smTEXLINK
 *
 * .inx 是加密的：动画条目的 StartFrame/EndFrame 与 MotionKeyWord_1/2 异或混编，
 * 必须先用 MotionKeyWordDecode 还原。文件大小 == sizeof(smMODELINFO)。
 */

import { readCString } from '../core/binary.js';
import type {
  InxData, MotionInfo, ModelGroup, FramePos,
  SmbData, Obj3D, MaterialInfo, Face, TexLink,
  RotKey, PosKey, ScaleKey,
} from '../char/char-format.js';

// ===== 常量 =====

const CHRMOTION_EXT = 10;
const MOTION_INFO_SIZE = 172;

// ===== .inx 解析 =====

function readModelGroup(dv: DataView, offset: number): { data: ModelGroup; size: number } {
  const modelNameCnt = dv.getInt32(offset, true);
  const names: string[] = [];
  let pos = offset + 4;
  for (let i = 0; i < modelNameCnt && i < 4; i++) {
    names.push(readCString(dv, pos, 64));
    pos += 16;
  }
  return { data: { modelNameCnt, modelNames: names }, size: 4 + 4 * 16 };
}

function readRawMotionInfo(dv: DataView, offset: number): MotionInfo {
  return {
    index: 0,
    state: dv.getUint32(offset, true),
    motionKeyWord1: dv.getUint32(offset + 4, true),
    startFrame: dv.getUint32(offset + 8, true),
    motionKeyWord2: dv.getUint32(offset + 12, true),
    endFrame: dv.getUint32(offset + 16, true),
    eventFrame: [
      dv.getUint32(offset + 20, true),
      dv.getUint32(offset + 24, true),
      dv.getUint32(offset + 28, true),
      dv.getUint32(offset + 32, true),
    ],
    itemCodeCount: dv.getInt32(offset + 36, true),
    itemCodeList: new Uint16Array(dv.buffer, dv.byteOffset + offset + 40, 52),
    dwJobCodeBit: dv.getUint32(offset + 144, true),
    skillCodeList: new Uint8Array(dv.buffer, dv.byteOffset + offset + 148, 8),
    mapPosition: dv.getInt32(offset + 156, true),
    repeat: dv.getUint32(offset + 160, true),
    keyCode: dv.getUint8(offset + 164),
    fxValue: [dv.getUint8(offset + 165), dv.getUint8(offset + 166), dv.getUint8(offset + 167)],
    motionFrame: dv.getInt32(offset + 168, true),
  };
}

function motionKeyWordDecode(mi: MotionInfo): void {
  if (mi.motionKeyWord1 || mi.startFrame) {
    const frame = ((mi.startFrame & 0x000000ff) << 24) |
      (mi.startFrame & 0x00ff0000) |
      ((mi.motionKeyWord1 & 0x00ff0000) >>> 8) |
      (mi.motionKeyWord1 & 0x000000ff);
    mi.motionKeyWord1 = 0;
    mi.startFrame = frame >>> 0;
  }
  if (mi.motionKeyWord2 || mi.endFrame) {
    const frame = ((mi.motionKeyWord2 & 0x00ff0000) << 8) |
      ((mi.motionKeyWord2 & 0x000000ff) << 16) |
      ((mi.endFrame & 0x00ff0000) >>> 8) |
      (mi.endFrame & 0x000000ff);
    mi.motionKeyWord2 = 0;
    mi.endFrame = frame >>> 0;
  }
}

export function parseInx(buffer: ArrayBuffer): InxData {
  const dv = new DataView(buffer);

  const modelFile = readCString(dv, 0, 64);
  const motionFile = readCString(dv, 64, 64);
  const subModelFile = readCString(dv, 128, 64);
  let o = 192;

  const highRG = readModelGroup(dv, o); o += highRG.size;
  const defaultRG = readModelGroup(dv, o); o += defaultRG.size;
  const lowRG = readModelGroup(dv, o); o += lowRG.size;

  const rawMotions: MotionInfo[] = [];
  for (let i = 0; i < 512; i++) {
    const mi = readRawMotionInfo(dv, o);
    mi.index = i;
    rawMotions.push(mi);
    o += MOTION_INFO_SIZE;
  }

  const motionCount = dv.getInt32(o, true); o += 4;
  const fileTypeKeyWord = dv.getUint32(o, true); o += 4;
  const linkFileKeyWord = dv.getUint32(o, true); o += 4;
  const szLinkFile = readCString(dv, o, 64); o += 64;
  const talkLinkFile = readCString(dv, o, 64); o += 64;
  const talkMotionFile = readCString(dv, o, 64); o += 64;

  const motions = rawMotions.map(mi => ({ ...mi }));
  for (let i = CHRMOTION_EXT; i < Math.min(motionCount, 512); i++) {
    motionKeyWordDecode(motions[i]);
  }

  return {
    modelFile,
    motionFile,
    subModelFile,
    highModel: highRG.data,
    defaultModel: defaultRG.data,
    lowModel: lowRG.data,
    motions,
    motionCount,
    fileTypeKeyWord,
    linkFileKeyWord,
    szLinkFile,
    talkLinkFile,
    talkMotionFile,
  };
}

// ===== .smb / .smd 解析 =====

function readFramePos(dv: DataView, o: number): FramePos {
  return {
    startFrame: dv.getInt32(o, true),
    endFrame: dv.getInt32(o + 4, true),
    posNum: dv.getInt32(o + 8, true),
    posCnt: dv.getInt32(o + 12, true),
  };
}

function readIntMatrix(dv: DataView, o: number): number[] {
  const m: number[] = [];
  for (let i = 0; i < 16; i++) m.push(dv.getInt32(o + i * 4, true));
  return m;
}

function readFloatMatrix(dv: DataView, o: number): number[] {
  const m: number[] = [];
  for (let i = 0; i < 16; i++) m.push(dv.getFloat32(o + i * 4, true));
  return m;
}

function parseMaterialGroup(dv: DataView, matFilePoint: number): MaterialInfo[] {
  const materials: MaterialInfo[] = [];
  let o = matFilePoint;

  o += 4; // head
  o += 4; // smMaterialPtr
  const materialCount = dv.getInt32(o, true); o += 4;
  o += 12;
  o += 64;

  if (materialCount <= 0 || materialCount > 256) return materials;

  for (let m = 0; m < materialCount; m++) {
    const inUse = dv.getInt32(o, true); o += 4;
    const textureCounter = dv.getInt32(o, true); o += 4;
    o += 32;
    o += 32;
    o += 32;
    o += 4;
    const mapOpacity = dv.getInt32(o, true); o += 4;
    const textureType = dv.getInt32(o, true); o += 4;
    const blendType = dv.getInt32(o, true); o += 4;
    o += 4;
    const twoSide = dv.getInt32(o, true); o += 4;
    o += 4;
    o += 12;
    const transparency = dv.getFloat32(o, true); o += 4;
    const selfIllum = dv.getFloat32(o, true); o += 4;
    o += 12;
    o += 12;
    o += 128;
    const animTexCounter = dv.getInt32(o, true); o += 4;
    o += 8;
    o += 4;

    const mat: MaterialInfo = {
      inUse,
      textureCounter,
      texturePaths: [],
      mapOpacity,
      textureType,
      blendType,
      twoSide,
      transparency,
      selfIllum,
      animTexCounter,
      animTexturePaths: [],
    };

    if (inUse !== 0) {
      const strLen = dv.getInt32(o, true); o += 4;
      const strStart = o;
      for (let t = 0; t < textureCounter && o < strStart + strLen; t++) {
        const n1 = readCString(dv, o, 260); o += n1.length + 1;
        o += readCString(dv, o, 260).length + 1;
        if (n1) mat.texturePaths.push(n1);
      }
      for (let t = 0; t < animTexCounter && o < strStart + strLen; t++) {
        const n1 = readCString(dv, o, 260); o += n1.length + 1;
        o += readCString(dv, o, 260).length + 1;
        if (n1) mat.animTexturePaths.push(n1);
      }
      o = strStart + strLen;
    }

    materials.push(mat);
  }
  return materials;
}

function parseObj3D(dv: DataView, info: { nodeName: string; length: number; objFilePoint: number }): Obj3D {
  let o = info.objFilePoint;

  const head = dv.getUint32(o, true); o += 4;
  o += 4; // vertexPtr
  o += 4; // facePtr
  const texLinkPtr = dv.getUint32(o, true); o += 4;
  const physiquePtr = dv.getUint32(o, true); o += 4;
  const hasPhysique = physiquePtr !== 0;

  o += 24; // zeroVertex

  o += 4; // maxZ
  o += 4; // minZ
  o += 4; // maxY
  o += 4; // minY
  o += 4; // maxX
  o += 4; // minX
  o += 4; // dBound
  o += 4; // bound
  o += 4; // maxVertex
  o += 4; // maxFace
  const nVertex = dv.getInt32(o, true); o += 4;
  const nFace = dv.getInt32(o, true); o += 4;
  const nTexLink = dv.getInt32(o, true); o += 4;
  o += 4; // colorEffect
  o += 4; // clipStates

  const posi = { x: dv.getInt32(o, true), y: dv.getInt32(o + 4, true), z: dv.getInt32(o + 8, true) }; o += 12;
  const cameraPosi = { x: dv.getInt32(o, true), y: dv.getInt32(o + 4, true), z: dv.getInt32(o + 8, true) }; o += 12;
  const angle = { x: dv.getInt32(o, true), y: dv.getInt32(o + 4, true), z: dv.getInt32(o + 8, true) }; o += 12;

  for (let i = 0; i < 8; i++) o += 4; // trig

  const nodeName = readCString(dv, o, 32); o += 32;
  const nodeParent = readCString(dv, o, 32); o += 32;
  o += 4; // pParentPtr

  const tm = readIntMatrix(dv, o); o += 64;
  const tmInvert = readIntMatrix(dv, o); o += 64;
  const tmResult = readFloatMatrix(dv, o); o += 64;
  const tmRotate = readIntMatrix(dv, o); o += 64;
  o += 64; // mWorld
  o += 64; // mLocal

  o += 4; // lFrame

  const qx = dv.getFloat32(o, true); o += 4;
  const qy = dv.getFloat32(o, true); o += 4;
  const qz = dv.getFloat32(o, true); o += 4;
  const qw = dv.getFloat32(o, true); o += 4;
  const sx = dv.getInt32(o, true) / 256; o += 4;
  const sy = dv.getInt32(o, true) / 256; o += 4;
  const sz = dv.getInt32(o, true) / 256; o += 4;
  const px = dv.getInt32(o, true) / 256; o += 4;
  const py = dv.getInt32(o, true) / 256; o += 4;
  const pz = dv.getInt32(o, true) / 256; o += 4;

  o += 4; // tmRotPtr
  o += 4; // tmPosPtr
  o += 4; // tmScalePtr
  o += 4; // tmPrevRotPtr

  const tmRotCnt = dv.getInt32(o, true); o += 4;
  const tmPosCnt = dv.getInt32(o, true); o += 4;
  const tmScaleCnt = dv.getInt32(o, true); o += 4;

  const tmRotFrame: FramePos[] = [];
  for (let i = 0; i < 32; i++) { tmRotFrame.push(readFramePos(dv, o)); o += 16; }
  const tmPosFrame: FramePos[] = [];
  for (let i = 0; i < 32; i++) { tmPosFrame.push(readFramePos(dv, o)); o += 16; }
  const tmScaleFrame: FramePos[] = [];
  for (let i = 0; i < 32; i++) { tmScaleFrame.push(readFramePos(dv, o)); o += 16; }

  const tmFrameCnt = dv.getInt32(o, true); o += 4;

  const vertices: Obj3D['vertices'] = [];
  for (let i = 0; i < nVertex; i++) {
    vertices.push({
      x: dv.getInt32(o, true) / 256, y: dv.getInt32(o + 4, true) / 256, z: dv.getInt32(o + 8, true) / 256,
      nx: dv.getInt32(o + 12, true) / 256, ny: dv.getInt32(o + 16, true) / 256, nz: dv.getInt32(o + 20, true) / 256,
    });
    o += 24;
  }

  const faces: Face[] = [];
  for (let i = 0; i < nFace; i++) {
    faces.push({
      v: [dv.getUint16(o, true), dv.getUint16(o + 2, true), dv.getUint16(o + 4, true), dv.getUint16(o + 6, true)],
      t: [
        { u: dv.getFloat32(o + 8, true), v: dv.getFloat32(o + 12, true) },
        { u: dv.getFloat32(o + 16, true), v: dv.getFloat32(o + 20, true) },
        { u: dv.getFloat32(o + 24, true), v: dv.getFloat32(o + 28, true) },
      ],
      lpTexLink: dv.getUint32(o + 32, true),
    });
    o += 36;
  }

  const texLinks: TexLink[] = [];
  for (let i = 0; i < nTexLink; i++) {
    texLinks.push({
      u: [dv.getFloat32(o, true), dv.getFloat32(o + 4, true), dv.getFloat32(o + 8, true)],
      v: [dv.getFloat32(o + 12, true), dv.getFloat32(o + 16, true), dv.getFloat32(o + 20, true)],
      hTexture: dv.getUint32(o + 24, true),
      nextTex: dv.getUint32(o + 28, true),
    });
    o += 32;
  }

  const tmRot: RotKey[] = [];
  for (let i = 0; i < tmRotCnt; i++) {
    tmRot.push({
      frame: dv.getInt32(o, true),
      x: dv.getFloat32(o + 4, true),
      y: dv.getFloat32(o + 8, true),
      z: dv.getFloat32(o + 12, true),
      w: dv.getFloat32(o + 16, true),
    });
    o += 20;
  }

  const tmPos: PosKey[] = [];
  for (let i = 0; i < tmPosCnt; i++) {
    tmPos.push({
      frame: dv.getInt32(o, true),
      x: dv.getFloat32(o + 4, true),
      y: dv.getFloat32(o + 8, true),
      z: dv.getFloat32(o + 12, true),
    });
    o += 16;
  }

  const tmScale: ScaleKey[] = [];
  for (let i = 0; i < tmScaleCnt; i++) {
    tmScale.push({
      frame: dv.getInt32(o, true),
      x: dv.getInt32(o + 4, true) / 256,
      y: dv.getInt32(o + 8, true) / 256,
      z: dv.getInt32(o + 12, true) / 256,
    });
    o += 16;
  }

  const tmPrevRot: number[][] = [];
  for (let i = 0; i < tmRotCnt; i++) {
    tmPrevRot.push(readFloatMatrix(dv, o)); o += 64;
  }

  const boneNames: string[] | null = hasPhysique ? [] : null;
  for (let i = 0; i < nVertex && hasPhysique; i++) {
    boneNames!.push(readCString(dv, o, 32)); o += 32;
  }

  return {
    info,
    nodeName,
    nodeParent,
    hasPhysique,
    nVertex, nFace, nTexLink,
    texLinkPtr,
    tmFrameCnt,
    vertices, faces, texLinks,
    tmRot, tmPos, tmScale, tmPrevRot,
    tmRotFrame, tmPosFrame, tmScaleFrame,
    boneNames,
    bindQuat: { x: qx, y: qy, z: qz, w: qw },
    bindScale: { x: sx, y: sy, z: sz },
    bindPos: { x: px, y: py, z: pz },
    tm: { m: tm },
    tmInvert: { m: tmInvert },
    tmRotate: { m: tmRotate },
    tmResult,
    head, posi, cameraPosi, angle,
  };
}

export function parseSmb(buffer: ArrayBuffer): SmbData {
  const dv = new DataView(buffer);

  const header = readCString(dv, 0, 24);
  let o = 24;
  const objCounter = dv.getInt32(o, true); o += 4;
  const matCounter = dv.getInt32(o, true); o += 4;
  const matFilePoint = dv.getInt32(o, true); o += 4;
  const firstObjInfoPoint = dv.getInt32(o, true); o += 4;
  const tmFrameCounter = dv.getInt32(o, true); o += 4;
  const tmFrame: FramePos[] = [];
  for (let i = 0; i < 32; i++) { tmFrame.push(readFramePos(dv, o)); o += 16; }

  const objInfos: SmbData['objInfos'] = [];
  for (let i = 0; i < objCounter; i++) {
    objInfos.push({
      nodeName: readCString(dv, o, 32),
      length: dv.getInt32(o + 32, true),
      objFilePoint: dv.getInt32(o + 36, true),
    });
    o += 40;
  }

  const materials = matCounter > 0 ? parseMaterialGroup(dv, matFilePoint) : [];
  const objects = objInfos.map(info => parseObj3D(dv, info));

  return {
    header,
    objCounter,
    matCounter,
    matFilePoint,
    firstObjInfoPoint,
    tmFrameCounter,
    tmFrame,
    objInfos,
    materials,
    objects,
  };
}
