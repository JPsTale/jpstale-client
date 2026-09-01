import * as THREE from 'three';
import { parseSMD } from '../core/smd-parser';
import { loadGameTexture } from './texture-loader';

const S = 1 / 256;

function assetUrl(raw: string): string {
  return '/res/' + raw.replace(/\\/g, '/').toLowerCase();
}

/**
 * 加载 SMD 场景文件（如 chrselect/select.smd）为 Three.js Group。
 * 复用 smd-parser 的顶点/面/UV/材质解析，按材质分组构建网格。
 */
export interface SceneLoadResult {
  group: THREE.Group;
  bounds: { center: THREE.Vector3; size: THREE.Vector3 };
}

export async function loadScene(
  scenePath: string,
  _resPrefix: string,
): Promise<SceneLoadResult> {
  const group = new THREE.Group();
  const r = await fetch(scenePath);
  if (!r.ok) throw new Error('HTTP ' + r.status + ' — ' + scenePath);
  const buf = await r.arrayBuffer();
  const smd = parseSMD(buf);

  const texUrls = new Map<number, string>();
  for (let i = 0; i < smd.materials.length; i++) {
    const mat = smd.materials[i];
    if (mat.tex.length > 0) texUrls.set(i, assetUrl(mat.tex[0]));
  }
  const texMap = new Map<string, THREE.Texture>();
  await Promise.all([...texUrls.values()].map(async (url) => {
    const tex = await loadGameTexture(url);
    if (tex) texMap.set(url, tex);
  }));

  const matFaces = new Map<number, number[]>();
  for (let i = 0; i < smd.nFace; i++) {
    const m = smd.faceMat[i];
    const arr = matFaces.get(m);
    if (arr) arr.push(i);
    else matFaces.set(m, [i]);
  }

  for (const [matIdx, faceList] of matFaces) {
    const mat = smd.materials[matIdx];
    const nFaces = faceList.length;
    const pos = new Float32Array(nFaces * 9);
    const nrm = new Float32Array(nFaces * 9);
    const uv0 = texUrls.has(matIdx) ? new Float32Array(nFaces * 6) : null;

    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const ab = new THREE.Vector3(), ac = new THREE.Vector3(), fn = new THREE.Vector3();

    for (let fi = 0; fi < nFaces; fi++) {
      const i = faceList[fi];
      const a = smd.triIdx[i * 3], b = smd.triIdx[i * 3 + 1], c = smd.triIdx[i * 3 + 2];
      const vids = [a, b, c];
      for (let j = 0; j < 3; j++) {
        const vi = vids[j];
        pos[fi * 9 + j * 3] = -smd.verts[vi * 3 + 2] * S;
        pos[fi * 9 + j * 3 + 1] = smd.verts[vi * 3 + 1] * S;
        pos[fi * 9 + j * 3 + 2] = -smd.verts[vi * 3] * S;
      }
      va.set(pos[fi * 9], pos[fi * 9 + 1], pos[fi * 9 + 2]);
      vb.set(pos[fi * 9 + 3], pos[fi * 9 + 4], pos[fi * 9 + 5]);
      vc.set(pos[fi * 9 + 6], pos[fi * 9 + 7], pos[fi * 9 + 8]);
      ab.subVectors(vb, va); ac.subVectors(vc, va);
      fn.crossVectors(ab, ac).normalize();
      for (let j = 0; j < 3; j++) {
        nrm[fi * 9 + j * 3] = fn.x;
        nrm[fi * 9 + j * 3 + 1] = fn.y;
        nrm[fi * 9 + j * 3 + 2] = fn.z;
      }

      if (uv0) {
        const tlIdx = smd.faceTexLink[i];
        if (tlIdx >= 0) {
          const base = tlIdx * 6;
          if (base + 5 < smd.texUVs.length) {
            uv0[fi * 6] = smd.texUVs[base];
            uv0[fi * 6 + 1] = smd.texUVs[base + 3];
            uv0[fi * 6 + 2] = smd.texUVs[base + 1];
            uv0[fi * 6 + 3] = smd.texUVs[base + 4];
            uv0[fi * 6 + 4] = smd.texUVs[base + 2];
            uv0[fi * 6 + 5] = smd.texUVs[base + 5];
          }
        }
      }
    }

    const indices = new Uint32Array(nFaces * 3);
    for (let fi = 0; fi < nFaces; fi++) {
      indices[fi * 3] = fi * 3;
      indices[fi * 3 + 1] = fi * 3 + 1;
      indices[fi * 3 + 2] = fi * 3 + 2;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geom.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    if (uv0) geom.setAttribute('uv', new THREE.BufferAttribute(uv0, 2));
    geom.setIndex(new THREE.BufferAttribute(indices, 1));

    const tex = texUrls.has(matIdx) ? (texMap.get(texUrls.get(matIdx)!) || null) : null;
    const threeMat = new THREE.MeshLambertMaterial({
      map: tex,
      side: mat.twoSide ? THREE.DoubleSide : THREE.FrontSide,
    });

    const mesh = new THREE.Mesh(geom, threeMat);
    mesh.frustumCulled = false;
    group.add(mesh);
  }

  // Compute bounds
  const box = new THREE.Box3().setFromObject(group);
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  console.log('[scene-loader] bounds:', { center: center.toArray(), size: size.toArray(), nFace: smd.nFace, nVertex: smd.nVertex });

  return { group, bounds: { center, size } };
}
