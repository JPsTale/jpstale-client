/**
 * NaN 定位器 —— 回答 three 那句
 *   `THREE.BufferGeometry.computeBoundingSphere(): Computed radius is NaN`
 * 到底是**哪个场景对象**的几何脏了。
 *
 * 为什么需要它：three 只把 `BufferGeometry` 对象本身打进 console，里面没有名字、
 * 也没有父链，而场景里同名同型的几何成千上万（每张图几十个材质网格）——
 * 光看那个对象无法定位。
 *
 * 两种用法：
 *   1. **被动**：`?nan=1`（或 `?coll=1`）时自动挂上 `installNaNGeometryWatch`，
 *      一旦 three 报这条警告，立刻扫描场景并打印出"对象链 + 哪个属性 + 第几号顶点 + 值"。
 *   2. **主动**：控制台 `worldView.scanNaNGeometry()` 随时扫一遍，返回命中的对象清单。
 *
 * 只读：不修改任何几何，也不改变渲染路径。
 */
import * as THREE from 'three';

export interface NaNGeometryHit {
  /** 对象链（root → 该对象），带名字与类型，便于一眼认出 */
  path: string;
  /** 该对象的 userData.kind（我们给场景对象打的分类标签，如 monster/npc/item） */
  kind: string;
  geometryUuid: string;
  geometryName: string;
  /** 含非有限值的属性名（position / normal / uv / skinWeight …），必要时带"属性名:原因" */
  badAttributes: string[];
  /** 第一个坏值的细节：属性、顶点号、该顶点的分量、属性总顶点数、原因 */
  first: { attr: string; vertex: number; value: number[]; count: number; reason: string };
}

/**
 * 一个属性里的第一处问题。两类都要抓，且**必须分开报**：
 *   ① 真·非有限值（NaN/±Infinity 写进了缓冲区）；
 *   ② `count` 不是整数 —— `BufferAttribute.count = array.length / itemSize` **不取整**，
 *      容量若写成 itemSize 的非整数倍（如 1024 配 itemSize 3），three 遍历到最后一号顶点会读到
 *      越界元素 `undefined` 并当 NaN 处理，报 `computeBoundingSphere(): Computed radius is NaN`。
 *      此时**缓冲区里根本没有 NaN**，照着"找脏数据"的方向查是白费功夫（本项目实测踩过）。
 */
function firstBadVertex(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute): { vertex: number; value: number[]; reason: string } | null {
  const itemSize = attr.itemSize;
  const arr = (attr as THREE.BufferAttribute).array as ArrayLike<number> | undefined;
  if (!arr) return null;
  // 越界上界：count 可能非整数，遍历必须夹到数组实际容量（否则扫描器自己也会读到 undefined 而误报）
  const n = Math.min(Math.floor(attr.count), Math.floor(arr.length / itemSize));
  for (let i = 0; i < n; i++) {
    let bad = false;
    const v: number[] = [];
    for (let k = 0; k < itemSize; k++) {
      const x = arr[i * itemSize + k];
      v.push(x as number);
      if (!Number.isFinite(x)) bad = true;
    }
    if (bad) return { vertex: i, value: v, reason: '非有限值' };
  }
  if (!Number.isInteger(attr.count)) {
    return {
      vertex: n,
      value: [],
      reason: `count 非整数（${attr.count}）：array.length=${arr.length} 不是 itemSize(${itemSize}) 的整数倍` +
        ` → three 会读到越界元素 undefined 并当 NaN，报"包围球 NaN"；缓冲区本身没有 NaN`,
    };
  }
  return null;
}

/** 场景链：root → obj（只保留有名字或类型有意义的节点，避免把中间 Group 铺满） */
function pathOf(obj: THREE.Object3D): string {
  const parts: string[] = [];
  let cur: THREE.Object3D | null = obj;
  let guard = 0;
  while (cur && guard++ < 64) {
    const nm = cur.name || '(无名)';
    const kind = (cur.userData?.kind as string | undefined) ?? '';
    parts.unshift(`${cur.type}${kind ? `/${kind}` : ''}"${nm}"`);
    cur = cur.parent;
  }
  return parts.join(' → ');
}

/**
 * 扫描一棵子树里所有几何，找出 `position` 等属性含非有限值的对象。
 * @param root 扫描起点（通常是 scene）
 * @param checkAllAttributes 默认只查 position（three 报的就是它）；true 则连 normal/uv/skinWeight 一起查
 */
export function scanNaNGeometry(root: THREE.Object3D, checkAllAttributes = true): NaNGeometryHit[] {
  const hits: NaNGeometryHit[] = [];
  root.traverse((o) => {
    const g = (o as THREE.Mesh).geometry as THREE.BufferGeometry | undefined;
    if (!g || !g.attributes) return;
    const badAttributes: string[] = [];
    let first: NaNGeometryHit['first'] | null = null;
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && !checkAllAttributes) continue;
      const attr = g.attributes[name]!;
      const bad = firstBadVertex(attr);
      if (!bad) continue;
      badAttributes.push(name);
      if (!first || name === 'position') {
        first = { attr: name, vertex: bad.vertex, value: bad.value, count: Math.floor(attr.count), reason: bad.reason };
      }
    }
    if (!first) return;
    hits.push({
      path: pathOf(o),
      kind: ((o.userData?.kind as string | undefined) ?? ''),
      geometryUuid: g.uuid,
      geometryName: g.name || '(无名)',
      badAttributes,
      first,
    });
  });
  return hits;
}

/** 把命中打成人能读的控制台输出（默认 console.warn，避免与"错误"混在一起） */
export function reportNaNGeometry(hits: NaNGeometryHit[], tag = ''): void {
  if (!hits.length) {
    console.log(`[nan-scan]${tag ? ' ' + tag : ''} 场景内没有含非有限值的几何 ✓`);
    return;
  }
  console.warn(`[nan-scan]${tag ? ' ' + tag : ''} 命中 ${hits.length} 个对象（共 ${hits.length} 条）：`);
  for (const h of hits) {
    const vals = h.first.value.length
      ? ` = [${h.first.value.map((x) => (x === undefined ? 'undefined' : String(x))).join(', ')}]`
      : '';
    console.warn(
      `  · ${h.path}\n` +
      `    几何 ${h.geometryName} (${h.geometryUuid}) 坏属性 [${h.badAttributes.join(', ')}]\n` +
      `    问题：${h.first.reason}\n` +
      `    位置：属性 ${h.first.attr} 顶点 #${h.first.vertex}/${h.first.count}${vals}`,
    );
  }
}

/**
 * 挂上"警告即扫描"的钩子：包一层 console.error，命中 three 的
 * `Computed radius is NaN` 就立刻扫描场景并打印对象链。
 * 返回卸载函数（调试关闭时调用；重复安装不会叠加）。
 */
export function installNaNGeometryWatch(scene: THREE.Scene): () => void {
  const orig = console.error.bind(console);
  let busy = false;
  let reported = 0;
  const wrapped = (...args: unknown[]) => {
    orig(...args);
    const first = args[0];
    if (typeof first !== 'string' || !first.includes('Computed radius is NaN')) return;
    if (busy) return;              // 扫描本身不产生这条警告，但加锁防止重入
    busy = true;
    try {
      const hits = scanNaNGeometry(scene, false);
      reported++;
      // 只详列一次（后续同类警告只报数量）：three 对每个几何只报一次，通常也就一次
      if (reported === 1) reportNaNGeometry(hits, '（由 three 的包围球警告触发）');
      else console.warn(`[nan-scan] 第 ${reported} 次触发；当前命中 ${hits.length} 个对象`);
    } finally {
      busy = false;
    }
  };
  console.error = wrapped;
  return () => { console.error = orig; };
}
