import { readFileSync } from 'fs';
import { parseInx, parseSmb } from '../src/core/char-parser.js';
import { parseSMD } from '../src/core/smd-parser.js';
import { evalSkeleton } from '../src/char/animation.js';

const ROOT = 'E:/JPsTale/client/';
function loadRes(p: string) {
  const b = readFileSync(ROOT + p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}
function baseName(mf: string | null) {
  if (!mf) return null;
  const norm = (mf || '').replace(/\\/g, '/').toLowerCase();
  const slash = norm.lastIndexOf('/');
  const name = norm.substring(slash + 1).replace(/\.[^.]+$/, '');
  const dir = slash >= 0 ? norm.substring(0, slash) : '';
  return dir + '/' + name;
}

const base = 'char/tmabcd/';

// ---------- 角色骨架 ----------
const bipInx = parseInx(loadRes(base + 'm1bip.inx'));
const bipSmbPath = baseName(bipInx.motionFile);
console.log('bip motion ->', bipSmbPath);
if (bipSmbPath) {
  const smb = parseSmb(loadRes(base + bipSmbPath.slice(base.length) + '.smb'));
  const skel = evalSkeleton(smb, 0, true);
  let mnX = Infinity, mnY = Infinity, mnZ = Infinity, mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
  for (const sf of skel) {
    const p = sf.pos;
    if (p.x < mnX) mnX = p.x; if (p.x > mxX) mxX = p.x;
    if (p.y < mnY) mnY = p.y; if (p.y > mxY) mxY = p.y;
    if (p.z < mnZ) mnZ = p.z; if (p.z > mxZ) mxZ = p.z;
  }
  console.log(`SKELETON raw bbox  X[${mnX.toFixed(1)},${mxX.toFixed(1)}]  Y[${mnY.toFixed(1)},${mxY.toFixed(1)}]  Z(engine-up)[${mnZ.toFixed(1)},${mxZ.toFixed(1)}]`);
  console.log(`SKELETON extents: X${(mxX-mnX).toFixed(1)} Y${(mxY-mnY).toFixed(1)} Z${(mxZ-mnZ).toFixed(1)}`);
}

// ---------- 角色身体网格 ----------
const bodyInx = parseInx(loadRes(base + 'b001.inx'));
const bodyModel = baseName(bodyInx.modelFile);
console.log('body modelFile ->', bodyModel);
if (bodyModel) {
  const smd = parseSmb(loadRes(base + bodyModel.slice(base.length) + '.smd'));
  let mnX = Infinity, mnY = Infinity, mnZ = Infinity, mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity, nV = 0;
  for (const o of smd.objects) {
    if (o.nVertex <= 0) continue;
    for (const v of o.vertices) {
      nV++;
      if (v.x < mnX) mnX = v.x; if (v.x > mxX) mxX = v.x;
      if (v.y < mnY) mnY = v.y; if (v.y > mxY) mxY = v.y;
      if (v.z < mnZ) mnZ = v.z; if (v.z > mxZ) mxZ = v.z;
    }
  }
  console.log(`BODY raw vert bbox (${nV} verts)  X[${mnX},${mxX}]  Y[${mnY},${mxY}]  Z(engine-up)[${mnZ},${mxZ}]`);
  console.log(`BODY extents RAW: X${(mxX-mnX).toFixed(1)} Y${(mxY-mnY).toFixed(1)} Z(height)${(mxZ-mnZ).toFixed(1)}`);
  console.log(`BODY extents /256: X${((mxX-mnX)/256).toFixed(2)} Y${((mxY-mnY)/256).toFixed(2)} Z(height)${((mxZ-mnZ)/256).toFixed(2)}`);
  // show a few sample verts to judge scale
  const o = smd.objects.find((x: any) => x.nVertex > 0)!;
  console.log('  sample verts:', o.vertices.slice(0, 3).map((v: any) => `(${v.x},${v.y},${v.z})`).join(' '));
}

// ---------- fore-1 地图 ----------
const mapSmd = parseSMD(loadRes('field/forest/fore-1.smd'));
let mnX = Infinity, mnY = Infinity, mnZ = Infinity, mxX = -Infinity, mxY = -Infinity, mxZ = -Infinity;
for (let i = 0; i < mapSmd.nVertex; i++) {
  const x = mapSmd.verts[i * 3], y = mapSmd.verts[i * 3 + 1], z = mapSmd.verts[i * 3 + 2];
  if (x < mnX) mnX = x; if (x > mxX) mxX = x;
  if (y < mnY) mnY = y; if (y > mxY) mxY = y;
  if (z < mnZ) mnZ = z; if (z > mxZ) mxZ = z;
}
console.log(`MAP raw vert bbox X[${mnX},${mxX}] Y[${mnY},${mxY}] Z[${mnZ},${mxZ}]`);
console.log(`MAP extents RAW: X${(mxX-mnX).toFixed(1)} Y${(mxY-mnY).toFixed(1)} Z${(mxZ-mnZ).toFixed(1)}`);
console.log(`MAP extents /256: X${((mxX-mnX)/256).toFixed(1)} Y${((mxY-mnY)/256).toFixed(1)} Z${((mxZ-mnZ)/256).toFixed(1)}`);
