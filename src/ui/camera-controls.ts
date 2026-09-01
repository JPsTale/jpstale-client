import * as THREE from 'three';

export interface CameraControls {
  update(): void;
  setTarget(t: THREE.Vector3): void;
  dispose(): void;
}

export function createCameraControls(
  camera: THREE.PerspectiveCamera,
  domElement: HTMLElement,
): CameraControls {
  let theta = 0;
  let distance = 80;
  const minDist = 20;
  const maxDist = 200;
  const minHeight = 10;
  let height = 40;
  let target = new THREE.Vector3(0, 0, 0);
  let isDragging = false;
  let lastX = 0;

  function updateCamera() {
    camera.position.set(
      Math.sin(theta) * distance + target.x,
      height + target.y,
      Math.cos(theta) * distance + target.z,
    );
    camera.lookAt(target);
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
    height = Math.max(minHeight, height + e.deltaY * 0.005);
    updateCamera();
  }

  domElement.addEventListener('pointerdown', onPointerDown);
  domElement.addEventListener('pointermove', onPointerMove);
  domElement.addEventListener('pointerup', onPointerUp);
  domElement.addEventListener('wheel', onWheel, { passive: false });

  updateCamera();

  return {
    update() {},
    setTarget(t: THREE.Vector3) {
      target.copy(t);
      updateCamera();
    },
    dispose() {
      domElement.removeEventListener('pointerdown', onPointerDown);
      domElement.removeEventListener('pointermove', onPointerMove);
      domElement.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
    },
  };
}
