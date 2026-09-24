/**
 * 目标信息窗（右上角 3D 头像框）的**跨层共享状态**。
 *
 * 生产者/消费者关系（见 docs/目标信息窗-源码分析.md）：
 *   · `info`  —— WorldView 每帧写入（当前选中目标的实时名字/血量/尸体态）；
 *               React 面板（TargetInfoPanel）150ms 轮询读取渲染。
 *   · `hole`  —— React 面板测量"3D 头像透明孔"的屏幕矩形（CSS 像素）写入；
 *               WorldView 每帧读取，用它做 scissor 小视口渲染目标模型。
 *
 * 用可变共享对象而不是 store/props：`hole` 每帧只读、`info` 每帧只写，
 * 走 React 状态会让 3D 帧循环与 React 渲染互相牵连。
 */
export interface TargetWindowInfo {
  kind: 'monster' | 'player' | 'npc';
  id: number;
  name: string;
  /** 0 = 未知（服务端没给/目标还没上报），显示层不画等级 */
  level: number;
  hp: number;
  maxHp: number;
  /** 尸体态（怪：死亡动画播完前的窗口期由 WorldView 计时关闭） */
  dead: boolean;
}

export interface TargetHoleRect {
  /** CSS 像素，相对浏览器视口（canvas 全屏铺底，视口即画布坐标） */
  x: number;
  y: number;
  w: number;
  h: number;
}

export const targetWindowState: {
  info: TargetWindowInfo | null;
  hole: TargetHoleRect | null;
} = { info: null, hole: null };
