/**
 * Sin/Cos 查找表（smSin.cpp）。
 * ANGLE_360 = 4096 项；sdGetSin/sdGetCos 缩放 32768（15.16 定点）。
 * 地图 wind/water/scroll 用。
 */
const ANGLE_360 = 4096;

export const sdGetSin = new Float64Array(ANGLE_360 + 1);
export const sdGetCos = new Float64Array(ANGLE_360 + 1);

for (let i = 0; i <= ANGLE_360; i++) {
  const rad = (i / ANGLE_360) * Math.PI * 2;
  sdGetSin[i] = Math.sin(rad) * 32768;
  sdGetCos[i] = Math.cos(rad) * 32768;
}
