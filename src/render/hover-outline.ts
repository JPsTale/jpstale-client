import * as THREE from 'three';
import hoverOutlineVert from '../shaders/hover-outline.vert?raw';
import hoverOutlineFrag from '../shaders/hover-outline.frag?raw';

// 鼠标指向目标"发光外轮廓"（hover 高亮，纯本地渲染）。
// 与 OutlinePass 不同：不读主场景深度纹理，改用"单色 mask → 环形膨胀"生成轮廓，
// 因此与 renderer 的 logarithmicDepthBuffer 完全兼容，无需关闭深度精度。
//
// 流程：
//  1) 把当前指向的目标（root 子树）用单色材质（保留蒙皮）渲染进 mask RT；
//  2) 全屏 quad 合成：环形采样 mask，只保留 mask 外沿 <= radius（屏像素）的一圈，
//     紧贴边缘处强度最高、向外渐变衰减到 0 → 分类色发光光圈。
export class HoverOutline {
  private renderer: THREE.WebGLRenderer;
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

  constructor(renderer: THREE.WebGLRenderer, radius = 2.5, opacity = 0.9) {
    this.renderer = renderer;
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
    if (target !== this.target) this.target = target;
    if (target) this.color.setHex(color);
  }

  /**
   * 在主场景渲染（renderer.render(scene, camera)）之后调用，绘制发光轮廓。
   * 无目标时立即返回（零开销）。
   */
  render(camera: THREE.Camera): void {
    const target = this.target;
    if (!target) return;

    const r = this.renderer;
    const w = Math.max(1, Math.floor(r.domElement.width * r.getPixelRatio()));
    const h = Math.max(1, Math.floor(r.domElement.height * r.getPixelRatio()));
    if (this.maskRT.width !== w || this.maskRT.height !== h) {
      this.maskRT.setSize(w, h);
      (this.quadMat.uniforms.uRes.value as THREE.Vector2).set(w, h);
    }

    // 名字标签等非 Mesh 对象不参与 mask（避免唯一字符/图标也画出光晕）
    this.hideNonMesh(target);

    // @types/three 未暴露 overrideMaterial 属性，这里窄化为实际存在该属性的形态
    const ren = r as unknown as { overrideMaterial: THREE.Material | null };
    const prevOverride = ren.overrideMaterial;
    const prevTarget = r.getRenderTarget();
    const prevAutoClear = r.autoClear;
    try {
      ren.overrideMaterial = this.maskMat;
      r.setRenderTarget(this.maskRT);
      r.autoClear = true;
      target.updateMatrixWorld(true);
      r.render(target, camera);
    } finally {
      ren.overrideMaterial = prevOverride;
      r.setRenderTarget(prevTarget);
      r.autoClear = prevAutoClear;
      this.restoreVisibility();
    }

    (this.quadMat.uniforms.uColor.value as THREE.Color).copy(this.color);
    r.render(this.quadScene, this.quadCam);
  }

  /** 记录目标子树中的非 Mesh 可见对象并临时隐藏，渲染 mask 后恢复。 */
  private hideNonMesh(root: THREE.Object3D): void {
    this.hidden.length = 0;
    root.traverse((o) => {
      if (o === root) return;
      if (!(o instanceof THREE.Mesh) && o.visible) {
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