precision highp float;

uniform sampler2D uMask;
uniform vec3 uColor;
uniform vec2 uRes;
uniform float uRadius;
uniform float uOpacity;

varying vec2 vUv;

// 环形采样方向数（圆卷积近似高斯）
const int N = 8;

void main() {
  vec2 px = 1.0 / uRes;
  float m = texture2D(uMask, vUv).r;
  if (m > 0.5) discard; // 目标内部剔除，只保留外沿光圈

  // 对 mask 做一圈环绕采样：只有距离 mask 边缘 <= uRadius（屏像素）的像素 g > 0，
  // 且越贴近边缘 g 越大 → 沿目标外法线方向渐变衰减，形成"发光"。
  vec2 rad = uRadius * px;
  float g = 0.0;
  for (int i = 0; i < N; i++) {
    float a = 6.28318530718 * float(i) / float(N);
    vec2 d = vec2(cos(a), sin(a)) * rad;
    g += texture2D(uMask, vUv + d).r;
  }
  g /= float(N);

  float alpha = g * uOpacity;
  if (alpha < 0.004) discard;

  gl_FragColor = vec4(uColor, alpha);
}