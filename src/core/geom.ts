/**
 * 几何原语 —— 照抄原版的落点/朝向计算。
 *
 * 为什么要有这个文件：核验怪物攻击特效时，原版用 `GetMoveLocation(...)` 把特效从怪物原点
 * 挪到"身前 N 单位"，而**这个前向偏移取决于上一行调用的参数**。我当初把
 * `pX + GeoResult_X` 直接"翻译"成 `forward: N`，就漏掉了它来自哪个调用 —— 结果是
 * 粒子落在怪物身上而不是身前（用户实测发现）。
 *
 * 结论（用户 2026-09-17 提议并认可）：**不要翻译语义，要原样搬运** ——
 * 把原版的调用参数照抄进派表，由这里等价地算。这样"提取参数"只剩搬运，
 * 不再经过我的理解；而这个函数是纯函数，**可以单测**，一旦对了所有调用点都对。
 */

/**
 * PT 的角度制式：**一整圈 = 4096**。
 * 出处：`NewSourcePT-2023/SrcGame/src/smLib3d/smSin.h:21` `#define ANGLE_360 4096`
 * （`PTANGLE_1 = ANGLE_360/360`，故 1 度 = 4096/360 ≈ 11.378 单位）。
 */
export const PT_ANGLE_FULL = 4096;

/** PT 角度 → 弧度（先按掩码取模，与原版 `AngX &= ANGCLIP` 一致） */
export function ptAngleToRad(ang: number): number {
  const a = ang & (PT_ANGLE_FULL - 1);
  return (a / PT_ANGLE_FULL) * Math.PI * 2;
}

/**
 * 弧度 → PT 角度。
 *
 * 调用方手上的朝向通常是 `root.rotation.y`（弧度，three 约定），而原版 `GetMoveLocation`
 * 的第 5 个参数是 `Angle.y`（PT 制式，一整圈 4096）—— 这就是两者之间**唯一**的换算处。
 */
export function radToPtAngle(rad: number): number {
  return Math.round((rad / (Math.PI * 2)) * PT_ANGLE_FULL);
}

/**
 * 原版 `GetMoveLocation` 的等价实现 —— **逐行照抄旋转顺序**，不按手感重排。
 *
 * 出处：`NewSourcePT-2023/SrcGame/src/smLib3d/smgeosub.cpp:151`：
 *
 * ```
 * i  = (x*cosZ - y*sinZ) >> SH_ANGF_SFLOAT;   j = (x*sinZ + y*cosZ) >> SH_ANGF_SFLOAT;  k = z;
 * dy = (j*cosX - k*sinX) >> SH_ANGF_SFLOAT;   dz = (j*sinX + k*cosX) >> SH_ANGF_SFLOAT; k = dz;
 * dx = (k*sinY + i*cosY) >> SH_ANGF_SFLOAT;   dz = (k*cosY - i*sinY) >> SH_ANGF_SFLOAT;
 * GeoResult_X = dx;  GeoResult_Y = dy;  GeoResult_Z = dz;
 * ```
 *
 * 旋转顺序是 **Z → X → Y**（先绕 Z 转，再绕 X，最后绕 Y），**照抄，不要"优化"**。
 * 原版用定点（`FLOATNS = 8`）+ 查表（`sdGetSin/AngX`）；我们用浮点，数学等价且更准
 * （唯一差异：原版 `>>` 是向下取整，我们不舍入 —— 亚单位级，可忽略）。
 *
 * @param x,y,z    偏移量（world 单位）—— 原版调用里的前三个参数
 * @param angX,angY,angZ 旋转角（**PT 角度制式**，一整圈 4096）—— 原版后三个参数
 * @returns 旋转后的偏移（对应原版的 `GeoResult_X/Y/Z`）
 */
export function getMoveLocation(
  x: number, y: number, z: number,
  angX: number, angY: number, angZ: number,
): { x: number; y: number; z: number } {
  const radX = ptAngleToRad(angX);
  const radY = ptAngleToRad(angY);
  const radZ = ptAngleToRad(angZ);
  const sinX = Math.sin(radX), cosX = Math.cos(radX);
  const sinY = Math.sin(radY), cosY = Math.cos(radY);
  const sinZ = Math.sin(radZ), cosZ = Math.cos(radZ);

  // ① 绕 Z
  const i = x * cosZ - y * sinZ;
  const j = x * sinZ + y * cosZ;
  let k = z;

  // ② 绕 X
  const dy = j * cosX - k * sinX;
  let dz = j * sinX + k * cosX;
  k = dz;

  // ③ 绕 Y
  const dx = k * sinY + i * cosY;
  dz = k * cosY - i * sinY;

  return { x: dx, y: dy, z: dz };
}

/**
 * 由**水平方向分量**求朝向角（弧度）—— `faceAngleOf` 的内核，
 * 也是 `Math.atan2(方向x, 方向z)` 这一约定的**唯一实现处**。
 *
 * 之所以单独暴露：调用方拿到的有时是"差向量"，有时是**已归一化**的方向分量
 * （`WorldView` 由相机方向推角色朝向时就是归一化过的）——
 * 而除以一个正的常量不改变 `atan2` 的结果，两者进来等价。
 */
export function faceAngleFromDir(dirX: number, dirZ: number): number {
  return Math.atan2(dirX, dirZ);
}

/**
 * 由两点求**水平朝向角**（弧度，绕 Y）。
 *
 * 这不是原版的 `GetRadian3D` —— 后者算的是完整 3D 方向（含俯仰，一次写 `GeoResult_X/Y/Z`
 * 三个值）。这里的语义是"地平面上从 A 看向 B 的方向"，也就是项目里此前**散落 4 处**
 * 的内联 `Math.atan2(dx, dz)`（`WorldView.ts` 的 3505 / 4985 / 4987 / 5000 ——
 * 怪物转向、自机朝向、自机朝目标/NPC 移动）。四份同式实现属 AGENTS #15 的"同一判定
 * 出现第二份"，故收敛到这里，**唯一一份**。
 *
 * three 约定：模型默认朝 +Z，绕 Y 转 `angle` 后前向量为 `(sin, 0, cos)`
 * —— 与 `atan2(dx, dz)` 互为逆运算，也正是 `getMoveLocation` 里绕 Y 那一支的用法。
 */
export function faceAngleOf(
  from: { x: number; z: number },
  to: { x: number; z: number },
): number {
  return faceAngleFromDir(to.x - from.x, to.z - from.z);
}
