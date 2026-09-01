import * as THREE from 'three';

export interface CameraControls {
  update(): void;
  dispose(): void;
}

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): CameraControls {
  let theta = 0; // 水平角度
  let distance = 5; // 摄像机到原点距离
  const minDist = 2;
  const maxDist = 15;
  const height = 4; // 固定高度（俯视）
  let isDragging = false;
  let lastX = 0;

  // 俯视：摄像机在 (0, height, distance)，看向 (0, 0, 0)
  function updateCamera() {
    camera.position.set(
      Math.sin(theta) * distance,
      height,
      Math.cos(theta) * distance,
    );
    camera.lookAt(0, 0, 0);
  }

  function onPointerDown(e: PointerEvent) {
    isDragging = true;
    lastX = e.clientX;
    domElement.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (!isDragging) return;
    const dx = e.clientX - lastX;
    theta -= dx * 0.005; // 水平旋转速度
    lastX = e.clientX;
    updateCamera();
  }

  function onPointerUp(_e: PointerEvent) {
    isDragging = false;
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    distance += e.deltaY * 0.01;
    distance = Math.max(minDist, Math.min(maxDist, distance));
    updateCamera();
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });

  updateCamera();

  return {
    update() {},
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
    },
  };
}
