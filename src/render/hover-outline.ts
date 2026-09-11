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
//
// 诊断开关（默认全关，临时排查用）：
//  diagPureGreen — 合成 quad 换成半透明纯绿，验证合成 pass 能否上屏；
//  diagShowMask  — 直接把 maskRT 灰度画到屏幕上，判读 mask 内容是否为空。
const DIAG_SHOW_MASK_FRAG = `
varying vec2 vUv;
uniform sampler2D uMask;
uniform vec3 uColor;
void main() {
  float m = texture2D(uMask, vUv).r;
  gl_FragColor = vec4(uColor, m);
}
`;
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
  /** mask 渲染用临时场景：renderer.render() 直接传 Group 不渲染其子树，需临时挂到独立场景。 */
  private maskScene = new THREE.Scene();
  private diagLogged = false;
  private maskPassLogged = false;
  private diagRT = false;
  private rtDiagLogged = false;
  /** 诊断：true 时跳过 mask 渲染、用全白 uMask 强制合成，判定合成 pass 是否本身可用。 */
  private diagWhiteMask = false;
  private whiteTex: THREE.DataTexture | null = null;
  /** 诊断：true 时把合成 quad 换成纯绿半透明（忽略 mask），判定合成 pass 本身能否画到屏幕。 */
  private diagPureGreen = false;
  private greenMat: THREE.MeshBasicMaterial | null = null;
  /** 诊断：true 时直接在屏幕上显示 mask 内容灰度（判断 maskRT 是否为空）。 */
  private diagShowMask = false;
  private showMaskMat: THREE.ShaderMaterial | null = null;
  private quad!: THREE.Mesh;

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
    this.quad = quad;
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

  /** 当前是否有轮廓目标（诊断/渲染循环用）。 */
  hasTarget(): boolean {
    return this.target !== null;
  }

  /** 一次性诊断：渲染完成后打印真实 RT 尺寸与已编译 program 列表（区分 mask/quad 是否被渲染器使用）。 */
  private diagLinkStatus(): void {
    const r = this.renderer;
    const info = (r as unknown as { info?: { programs: unknown[]; render: { calls: number; triangles: number } } }).info;
    console.log('[hover-diag] 渲染后 (programs 数量=' + (info?.programs.length ?? 0) + ')', {
      rt: `${this.maskRT.width}x${this.maskRT.height}`,
      canvas: `${r.domElement.width}x${r.domElement.height} (CSS ${r.domElement.clientWidth}x${r.domElement.clientHeight})`,
      pixelRatio: r.getPixelRatio(),
      renderCalls: info?.render.calls,
      triangles: info?.render.triangles,
    });
  }

  /**
   * 在主场景渲染（renderer.render(scene, camera)）之后调用，绘制发光轮廓。
   * 无目标时立即返回（零开销）。
   */
  render(camera: THREE.Camera): void {
    const target = this.target;
    if (!target) return;

    // 真机诊断入口：console 执行 window.__hoverDiag='green'（纯绿合成）/ 'mask'（显示 mask 剪影）切换
    if (typeof window !== 'undefined') {
      const wd = (window as unknown as { __hoverDiag?: string }).__hoverDiag;
      this.diagPureGreen = wd === 'green';
      this.diagShowMask = wd === 'mask';
      this.diagWhiteMask = wd === 'white';
      this.diagRT = wd === 'rt';
    }

    try {
      this.renderInner(camera);
    } catch (e) {
      console.error('[hover] render 异常:', e);
    }

    if (!this.diagLogged && this.target) {
      this.diagLogged = true;
      this.diagLinkStatus();
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

// ---- mask 渲染（除非诊断强制白 mask）----
    if (!this.diagWhiteMask) {
      // 名字标签等非 Mesh 对象不参与 mask（避免名字/图标也画出光晕）
      this.hideNonMesh(target);

      // renderer.render() 直接传 Group 时其子树不会被渲染（mask 会全空）。
      // 因此把目标临时挂到独立 maskScene（会从主 scene 移出；主渲染在本调用之前已完成，
      // 移出/还原对主画面无副作用），渲染 mask 后按原 parent/索引挂回。
      const prevParent = target.parent;
      const prevIdx = prevParent ? prevParent.children.indexOf(target) : -1;
      this.maskScene.add(target);

      // @types/three 未暴露 overrideMaterial 属性，这里窄化为实际存在该属性的形态
      const ren = r as unknown as { overrideMaterial: THREE.Material | null };
      const prevOverride = ren.overrideMaterial;
      const prevTarget = r.getRenderTarget();
      const prevAutoClear = r.autoClear;
      try {
        ren.overrideMaterial = this.maskMat;
        r.setRenderTarget(this.maskRT);
        r.autoClear = true;
        // 捕获本机 mask pass 的实际 draw（临时关 autoReset，避免 render 末尾被清掉）
        const inf = (r as unknown as { info?: { autoReset: boolean; reset: () => void; render: { calls: number; triangles: number } } }).info;
        const prevAR = inf?.autoReset ?? true;
        if (inf) inf.autoReset = false;
        r.render(this.maskScene, camera);
        if (inf && !this.maskPassLogged) {
          this.maskPassLogged = true;
          console.log(`[hover-diag] mask pass: calls=${inf.render.calls} triangles=${inf.render.triangles}${inf.render.calls === 0 ? ' ← mask 未渲染任何网格!' : ''}`);
        }
        if (inf) {
          inf.autoReset = prevAR;
          inf.reset();
        }
      } finally {
        ren.overrideMaterial = prevOverride;
        r.setRenderTarget(prevTarget);
        r.autoClear = prevAutoClear;
        this.restoreVisibility();
        // 按原 parent/索引挂回主场景（matrixWorld 两端单位父矩阵，值不变）
        if (prevIdx >= 0 && prevParent) prevParent.children.splice(prevIdx, 0, target);
        else if (prevParent) prevParent.add(target);
      }
      // 诊断：readRenderTargetPixels 读 maskRT，判定内容是否真的写入（无头下 readPixels 是假阴，真机可能可读）
      if (this.diagRT && !this.rtDiagLogged) {
        this.rtDiagLogged = true;
        try {
          const w = this.maskRT.width, h = this.maskRT.height;
          const buf = new Uint8Array(w * h * 4);
          r.readRenderTargetPixels(this.maskRT, 0, 0, w, h, buf);
          let nonZero = 0, whitePix = 0, maxV = 0;
          for (let i = 0; i < buf.length; i += 4) {
            const v = Math.max(buf[i], buf[i + 1], buf[i + 2]);
            if (v > 0) nonZero++;
            if (v > 200) whitePix++;
            if (v > maxV) maxV = v;
          }
          console.log(`[hover-diag] maskRT=${w}x${h} readPixels: 非零=${nonZero} 白色(>200)=${whitePix} max=${maxV}`);
        } catch (e) {
          console.log('[hover-diag] maskRT 读取失败:', e);
        }
      }
    }

    // 合成 uMask：正常 = maskRT；白 mask 诊断 = 全白 1x1 纹理（跳过实际 mask 内容）
    let uMask: THREE.Texture = this.maskRT.texture;
    if (this.diagWhiteMask) {
      if (!this.whiteTex) {
        this.whiteTex = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
        this.whiteTex.needsUpdate = true;
      }
      uMask = this.whiteTex;
    }
    (this.quadMat.uniforms.uMask.value as THREE.Texture) = uMask;

    // 纯绿/显 mask 诊断：替换合成 quad 的材质（绕开正常 mask 合成逻辑）
    if (this.diagPureGreen) {
      if (!this.greenMat) {
        this.greenMat = new THREE.MeshBasicMaterial({
          color: 0x54ff9f,
          transparent: true,
          opacity: 0.5,
          depthTest: false,
          depthWrite: false,
        });
      }
      this.quad.material = this.greenMat;
    } else if (this.diagShowMask) {
      if (!this.showMaskMat) {
        this.showMaskMat = new THREE.ShaderMaterial({
          uniforms: {
            uMask: { value: this.maskRT.texture },
            uColor: { value: new THREE.Color(0x54ff9f) },
          },
          vertexShader: hoverOutlineVert,
          fragmentShader: DIAG_SHOW_MASK_FRAG,
          transparent: true,
          depthTest: false,
          depthWrite: false,
        });
      }
      this.quad.material = this.showMaskMat;
    } else {
      this.quad.material = this.quadMat;
    }

    // 合成到屏幕：绝不能 clear（会擦掉刚渲染的主画面 → 黑屏）。
    // mask 渲染时 autoClear=true 清的是 maskRT，合成这里必须关掉再渲染。
    const prevAuto = r.autoClear;
    r.autoClear = false;
    r.clearDepth();
    (this.quadMat.uniforms.uColor.value as THREE.Color).copy(this.color);
    r.render(this.quadScene, this.quadCam);
    r.autoClear = prevAuto;
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