import * as THREE from 'three';
import hoverOutlineVert from '../shaders/hover-outline.vert?raw';
import hoverOutlineFrag from '../shaders/hover-outline.frag?raw';

// 鼠标指向目标"发光外轮廓"（hover 高亮，纯本地渲染）。
//
// 方案：mask → 环形膨胀 → 合成。
//  1) mask：目标留在主场景原处（不迁移到隔离场景——隔离场景会导致世界矩阵错位、
//     真机上目标被渲染到错误坐标/视锥外 → mask 全黑），只临时隐藏与目标无关的分支，
//     override 单色材质后直接渲染主场景进 maskRT，矩阵/深度上下文与主渲染完全一致；
//  2) 环形膨胀：全屏 quad 采样 maskRT，只保留 mask 外沿 <= radius 的一圈，向外渐变衰减 → 光圈；
//  3) 合成回主画面。
export class HoverOutline {
  private renderer: THREE.WebGLRenderer;
  /** 目标所在的主场景：mask 渲染时目标留在原位，只隐藏其余分支。 */
  private mainScene: THREE.Scene | null;
  private maskRT: THREE.WebGLRenderTarget;
  private maskMat: THREE.MeshBasicMaterial;
  private quadScene: THREE.Scene;
  private quadCam: THREE.OrthographicCamera;
  private quadMat: THREE.ShaderMaterial;

  private target: THREE.Object3D | null = null;
  private color = new THREE.Color(0xffffff);
  private hidden: { obj: THREE.Object3D; vis: boolean }[] = [];

  /** 发光光圈宽度（屏像素）。 */
  radius: number;
  /** 发光强度（透明度系数），0~1。 */
  opacity: number;

  constructor(renderer: THREE.WebGLRenderer, mainScene: THREE.Scene | null, radius = 2.5, opacity = 0.9) {
    this.renderer = renderer;
    this.mainScene = mainScene;
    this.radius = radius;
    this.opacity = opacity;

    this.maskRT = new THREE.WebGLRenderTarget(1, 1);
    this.maskMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
    });
    // @types/three 未声明 MeshBasicMaterial.skinning，但 WebGLRenderer 会根据该属性生成蒙皮 shader
    (this.maskMat as unknown as { skinning: boolean }).skinning = true;

    this.quadMat = new THREE.ShaderMaterial({
      uniforms: {
        uMask: { value: this.maskRT.texture },
        uColor: { value: new THREE.Color() },
        uRes: { value: new THREE.Vector2(1, 1) },
        uRadius: { value: radius },
        uOpacity: { value: opacity },
      },
      vertexShader: hoverOutlineVert,
      fragmentShader: hoverOutlineFrag,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });

    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.quadMat);
    quad.frustumCulled = false;
    quad.renderOrder = 9999;
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quadScene = new THREE.Scene();
    this.quadScene.add(quad);
  }

  /** 设置要高亮的目标；传 null 清除。 */
  setTarget(target: THREE.Object3D | null, color = 0xffffff): void {
    if (target !== this.target) {
      const kind = target?.userData?.['kind'] as string | undefined;
      const nm = (target?.userData?.['name'] as string | undefined) || target?.name || '?';
      console.log(`[hover] 目标切换: ${target ? `kind=${kind} name=${nm}` : '(清除)'}`);
      this.target = target;
    }
    if (target) this.color.setHex(color);
  }

  /** 当前是否有轮廓目标（渲染循环用）。 */
  hasTarget(): boolean {
    return this.target !== null;
  }

  /**
   * 在主场景渲染（renderer.render(scene, camera)）之后调用，绘制发光轮廓。
   * 无目标时立即返回（零开销）。
   */
  render(camera: THREE.Camera): void {
    const target = this.target;
    if (!target) return;
    try {
      this.renderInner(camera);
    } catch (e) {
      console.error('[hover] render 异常:', e);
    }
  }

  private renderInner(camera: THREE.Camera): void {
    const target = this.target as THREE.Object3D;
    const r = this.renderer;
    const w = Math.max(1, Math.floor(r.domElement.width * r.getPixelRatio()));
    const h = Math.max(1, Math.floor(r.domElement.height * r.getPixelRatio()));
    if (this.maskRT.width !== w || this.maskRT.height !== h) {
      this.maskRT.setSize(w, h);
      (this.quadMat.uniforms.uRes.value as THREE.Vector2).set(w, h);
    }

    // ---- mask 渲染：主场景原位 + 隐藏无关分支 + override 单色 ----
    if (this.mainScene) {
      this.hideNonMesh(target);
      const ren = r as unknown as { overrideMaterial: THREE.Material | null };
      const prevOverride = ren.overrideMaterial;
      const prevTarget = r.getRenderTarget();
      const prevAutoClear = r.autoClear;
      const savedVis = this.hideOthers(this.mainScene, target);
      try {
        ren.overrideMaterial = this.maskMat;
        r.setRenderTarget(this.maskRT);
        r.autoClear = true;
        r.render(this.mainScene, camera);
      } finally {
        this.restoreOthers(savedVis);
        this.restoreVisibility();
        ren.overrideMaterial = prevOverride;
        r.setRenderTarget(prevTarget);
        r.autoClear = prevAutoClear;
      }
    }

    // ---- 合成到屏幕：绝不能 clear（会擦掉刚渲染的主画面 → 黑屏）----
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    (this.quadMat.uniforms.uColor.value as THREE.Color).copy(this.color);
    r.render(this.quadScene, this.quadCam);
    r.autoClear = prevAuto;
  }

  /**
   * 临时隐藏 target 在场景中的"无关分支"：保留 target 到主场景的祖先链及其子孙，
   * 其余根节点、每层兄弟都隐藏，让 mask 渲染只剩目标子树。返回需恢复的可见对象。
   */
  private hideOthers(scene: THREE.Scene, target: THREE.Object3D): { obj: THREE.Object3D; vis: boolean }[] {
    const chain: THREE.Object3D[] = [];
    let o: THREE.Object3D | null = target;
    while (o && o !== scene) {
      chain.push(o);
      o = o.parent;
    }
    if (o !== scene) return []; // 目标不在主场景下，无从隐藏

    const saved: { obj: THREE.Object3D; vis: boolean }[] = [];
    const hide = (n: THREE.Object3D): void => {
      if (n.visible) {
        saved.push({ obj: n, vis: true });
        n.visible = false;
      }
    };
    const chainSet = new Set(chain);
    for (const c of scene.children) if (!chainSet.has(c)) hide(c);
    for (let i = 0; i < chain.length - 1; i++) {
      const node = chain[i];
      const parent = node.parent;
      if (!parent) continue;
      for (const sib of parent.children) {
        if (sib !== node && !chainSet.has(sib)) hide(sib);
      }
    }
    return saved;
  }

  private restoreOthers(saved: { obj: THREE.Object3D; vis: boolean }[]): void {
    for (const { obj } of saved) obj.visible = true;
  }

  /**
   * 记录目标子树中"会真正画进 mask 的叶子渲染对象"（名字标签等 Sprite/Line/Points）并临时隐藏，
   * 渲染 mask 后恢复。
   * 注意：绝不能隐藏 Group/Bone 这类容器 —— 它们自己不渲染，但隐藏会连带其下所有 Mesh
   * 一起消失（如 NPC result.group 容器），导致 mask 空白、光圈不可见。
   */
  private hideNonMesh(root: THREE.Object3D): void {
    this.hidden.length = 0;
    root.traverse((o) => {
      if (o === root) return;
      const isRenderLeaf =
        (o as THREE.Sprite).isSprite === true ||
        (o as THREE.Line).isLine === true ||
        (o as THREE.Points).isPoints === true;
      if (isRenderLeaf && o.visible) {
        this.hidden.push({ obj: o, vis: true });
        o.visible = false;
      }
    });
  }

  private restoreVisibility(): void {
    for (const { obj, vis } of this.hidden) obj.visible = vis;
    this.hidden.length = 0;
  }

  dispose(): void {
    this.maskRT.dispose();
    this.maskMat.dispose();
    this.quadMat.dispose();
    for (const c of this.quadScene.children) (c as THREE.Mesh).geometry.dispose();
  }
}