import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { loadFore1, updateFrameAnimations } from './maps/fore1';
import { attachPick } from './maps/pick';

const app = document.getElementById('app') as HTMLElement;

const scene = new THREE.Scene();
// 天穹：equirect HDR（加载成功前用深色兜底）
scene.background = new THREE.Color(0x111122);
new RGBELoader()
  .load('/res/effect/sky/env.hdr', (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    scene.background = tex;
  }, undefined, () => {
    console.warn('sky env.hdr 加载失败，保留纯色背景');
  });

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500000);
camera.position.set(0, 200, 400);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
app.appendChild(renderer.domElement);

function resize(): void {
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
}
window.addEventListener('resize', resize);
resize();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 0, 0);

const clock = new THREE.Clock();

async function boot(): Promise<void> {
  const fore = await loadFore1(scene);
  const { mapRenderer, animatedMeshes } = fore;
  // 缩放视口到地图范围
  const midX = (mapRenderer.worldMin[0] + mapRenderer.worldMax[0]) / 2;
  const midZ = (mapRenderer.worldMin[2] + mapRenderer.worldMax[2]) / 2;
  controls.target.set(midX, 0, midZ);

  // 点击拾取诊断面板（z-fighting 分析）
  const panel = document.createElement('textarea');
  panel.style.cssText = 'position:fixed;left:8px;top:8px;width:560px;height:320px;margin:0;padding:8px;background:rgba(0,0,0,0.85);color:#cfc;font:11px/1.4 monospace;border:1px solid #486;z-index:10;resize:both;';
  panel.readOnly = true;
  const copyBtn = document.createElement('button');
  copyBtn.textContent = '复制';
  copyBtn.style.cssText = 'position:fixed;top:8px;right:8px;z-index:11;';
  copyBtn.onclick = () => {
    panel.select();
    document.execCommand('copy');
    copyBtn.textContent = '已复制';
    setTimeout(() => { copyBtn.textContent = '复制'; }, 1200);
  };
  document.body.appendChild(panel);
  document.body.appendChild(copyBtn);

  // 渲染统计 HUD（左下角）
  const hud = document.createElement('div');
  hud.style.cssText = 'position:fixed;left:8px;bottom:8px;padding:6px 10px;background:rgba(0,0,0,0.72);color:#cfc;font:12px/1.5 monospace;border:1px solid #486;z-index:9;user-select:none;pointer-events:none;white-space:pre;';
  document.body.appendChild(hud);

  attachPick(renderer.domElement, camera, fore, (r) => {
    if (!r.hit || r.faces.length === 0) {
      panel.value = `点击: 未命中 (raw ${r.rawX}, ${r.rawY}, ${r.rawZ})`;
      return;
    }
    const lines: string[] = [];
    lines.push(`命中 world (${r.worldX.toFixed(2)}, ${r.worldY.toFixed(2)}, ${r.worldZ.toFixed(2)})`);
    lines.push(`raw (${r.rawX}, ${r.rawY}, ${r.rawZ})  |  该柱共 ${r.faces.length} 面（按深度升序）`);
    lines.push('');
    r.faces.forEach((f) => {
      lines.push(
        `${f.rawY.toString().padStart(7)} wy=${f.worldY.toFixed(3)} mat=${String(f.matIdx).padStart(3)} ` +
        `t=${f.transparent ? 'Y' : 'n'} dw=${f.depthWrite ? 'Y' : 'n'} bt=${f.blendType} ` +
        `tex=${f.tex ? '/' : 'n'} lm=${f.hasLightmap ? 'Y' : 'n'} t2=${f.hasSecondTex ? 'Y' : 'n'} ` +
        `wind=${f.hasWind ? 'Y' : 'n'} water=${f.hasWater ? 'Y' : 'n'} scr=${f.hasScroll ? 'Y' : 'n'} ` +
        `ms=${f.meshStateHex} us=${f.useStateHex}` +
        (r.hit && f.faceIndex === r.hit.faceIndex ? '  <<HIT' : ''),
      );
    });
    panel.value = lines.join('\n');
  });

  let frameCount = 0, fpsAcc = 0;
  (function animate(): void {
    requestAnimationFrame(animate);
    controls.update();

    camera.updateMatrixWorld();
    camera.matrixWorldInverse.copy(camera.matrixWorld).invert();

    mapRenderer.render(camera);

    renderer.render(scene, camera);

    fpsAcc += clock.getDelta();
    frameCount++;
    if (fpsAcc >= 0.4) {
      const fps = frameCount / fpsAcc;
      hud.textContent =
        `FPS   ${fps.toFixed(0)}\n` +
        `Draw  ${mapRenderer.drawCallCount} / ${mapRenderer.materials.length}\n` +
        `Tris  ${Math.round(mapRenderer.visibleFaceCount).toLocaleString()} / ${mapRenderer.totalTriangleCount.toLocaleString()}\n` +
        `Verts ${mapRenderer.drawnVertexCount.toLocaleString()} / ${mapRenderer.totalVertexCount.toLocaleString()}`;
      frameCount = 0; fpsAcc = 0;
    }

    const animMs = clock.getElapsedTime() * 1000;
    mapRenderer.updateScroll(animMs);
    mapRenderer.updateWind(animMs);
    mapRenderer.updateWater(animMs);
    updateFrameAnimations(animatedMeshes, animMs);
  })();
}

boot().catch((e) => {
  console.error(e);
  const el = document.createElement('pre');
  el.textContent = '加载失败: ' + (e as Error).message;
  app.appendChild(el);
});
