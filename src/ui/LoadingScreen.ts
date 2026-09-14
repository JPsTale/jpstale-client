/**
 * 加载页 —— 忠实移植 PristonTale-EU 客户端（game/game/DXGraphicEngine.cpp）：
 *   DrawLoadingImage：{name}-blur.png 全屏拉伸 → border.png(898×698 居中) → {name}.png(800×600 居中)
 *                     → box.png(455×90, 底部居中) + 标题 + 随机提示文字
 *   ThreadLoadingBar：loadingbar.bmp 底条(262×33, 恒画满) + loadingbar_.bmp 填充按 262*cur/max 裁宽
 * 几何与 EU 一致：bar 位置 (W/2-133, H/2+187)；box 顶 (W/2-227, H-147)。
 * 图片清单取自源码 szaLoadingImagesLoading[]（修复其 "Archer_Alone" 后缺逗号的拼接 bug，
 * 文件名用磁盘实际小写，兼容 Ubuntu 大小写敏感的资产根）。
 * 资产：/res/game/images/loadingscreens/*.png、/res/game/images/misc/loadingbar*.bmp
 */
import { t, getLocale } from '../i18n/index.js';
import { setInputBlocked } from '../app/inputGate.js';
import { assetProgress, resetAssetProgress } from '../core/asset-cache.js';

const SCREENS = '/res/game/images/loadingscreens/';
// 注：原 EU 的 `loadingbar.bmp` / `loadingbar_.bmp` 已不再使用 —— 进度改由纯色框自身的填充表达
//（用户 2026-09-14："直接删掉第 3 个进度条，把第 2 个框改成进度条"）。

/**
 * 进度填充的几何与配色 —— **单一来源**。
 *
 * 这里改一次，**游戏里用它、调试页（`loading-demo.html`）也读它**，两边永远一致。
 * （教训：调试页原先自己写了一份默认值，于是"在调试页调好的效果"与"刷新后看到的"不相等 ——
 *  用户 2026-09-14 报"我刷新调试页面后，看到的效果不是这样啊"。两份默认值 = 必然漂移。）
 *
 * 数值由调试页调定后抄这里；**不要手算**（我手写过一次就差了 1px，被调试页当场抓出来）。
 */
export const PROGRESS_FILL = {
  /** 四边余量（相对小框内沿） */
  inset: { top: 4, bottom: 2, left: 5, right: 4 },
  color: '#48e70d',
  alpha: 0.91,
  radius: 2,
} as const;

/** `box.png` 里"小框"的内沿（相对 455×90 的图；**实测值**，换框图才需重测） */
const BOX_INNER = { left: 94, top: 1, right: 355, bottom: 30 } as const;
/** 框自身的定位常量（对应 boxImg 的 CSS：`left:50%/margin-left:-227px`、`top:calc(100% - 147px)`） */
const BOX_HALF_W = 227;
const BOX_TOP_OFFSET = 147;
/** 进度条的最大宽度（由上面的常量算出，别写死） */
const PROGRESS_MAX_W = BOX_INNER.right - BOX_INNER.left - PROGRESS_FILL.inset.left - PROGRESS_FILL.inset.right;

/** `#rrggbb` + alpha → `rgba(...)` */
function cssRgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

const LOADING_IMAGES = [
  // New Titles
  'ch-ft', 'chars', 'mrin', 'archer_alone', 'priestess_floating', 'rip_ept', 'map',
  // Classic Titles
  'map-all-all', 'map-all-mrin', 'map-all-tscr', 'map-ch-ac', 'map-ch-at', 'map-ch-ft',
  'map-ch-knight', 'map-ch-meca', 'map-ch-mg', 'map-ch-pk', 'map-ch-pt', 'map-game',
  'map-logo-rns', 'map-sod', 'map-tw-nvsc', 'map-tw-pillai', 'map-tw-rica', 'map-user_001',
];

// 提示文字（只收录本客户端已实现的按键，勿凭空写快捷键）
const TIPS: Record<string, string[]> = {
  zh: [
    '按住鼠标左键，角色会朝指针方向移动',
    '按 Tab 键显示/隐藏场内小地图',
    '按 R 键切换走/跑模式',
    '方向键旋转视角，PageUp/PageDown 调整俯仰',
  ],
  en: [
    'Hold the left mouse button to move toward the pointer',
    'Press Tab to toggle the in-game minimap',
    'Press R to toggle walk/run',
    'Arrow keys rotate the camera, PageUp/PageDown adjust pitch',
  ],
};

export interface LoadingScreen {
  /** 显示加载页；title 缺省用提示标题（EU: "Gameplay Tips & Tricks"） */
  show(title?: string): void;
  /** 进度：填充宽 = 262*current/max（EU UpdateLoading 语义）；label 提供时替换提示文字 */
  setProgress(current: number, max: number, label?: string): void;
  hide(): void;
}

export function createLoadingScreen(
  container: HTMLElement,
  opts?: {
    /**
     * 不要自动刷新右下角那行字节文本 —— 由调用方自己填。
     * 调试页（`loading-demo.html`）用它来**模拟**这一行在不同进度下的样子（那里没有真实下载，
     * 默认逻辑会把文本清空，于是看不到这一行）。
     */
    manualProgressText?: boolean;
    /**
     * 进度条**按已加载字节**渐进驱动，而不是等 `setProgress` 的阶段跳。
     *
     * 为什么需要（用户 2026-09-14 实测："它根本不走，只有在加载完之后才动一下"）：
     * 进图的回调只有 **4 个阶段**（本图/邻图/角色/首帧），而每个阶段内部可能耗时几分钟 ——
     * 绿条于是长时间钉在 25%/50% 不动。改成跟着字节走：每 200ms 涨一点，一直有动静。
     *
     * `refMB` 是**参考总量**（经验值，没有资产清单就只能取经验）：涨到它的 95% 停住，
     * 等 `setProgress` 报"阶段满"时才置 100% —— 那时确实加载完了。
     */
    progressFromBytes?: { refMB: number };
  },
): LoadingScreen {
  const root = document.createElement('div');
  root.id = 'loading-screen';
  // z-index 1400 **高于持物图标**（`.jp-hand-ic` = 1300）：加载页期间那件东西不该露出来。
  // cursor:none —— 加载页不显示鼠标（原版引擎里 `ShowCursor(FALSE)` 虽被注释掉，但用户要求明确，
  // 且我们确实在加载动画上挂着道具图标：由本页盖住 + 闸门同时挡掉）。
  root.style.cssText = 'display:none;position:fixed;inset:0;background:#0a0a1a;overflow:hidden;'
    + 'z-index:1400;cursor:none;';

  // 图层按 EU DrawLoadingImage 的渲染顺序叠放；单张图缺失时隐藏该层不阻塞其余
  const mkImg = (css: string): HTMLImageElement => {
    const img = document.createElement('img');
    img.draggable = false;
    img.style.cssText = css;
    img.addEventListener('error', () => { img.style.display = 'none'; });
    root.appendChild(img);
    return img;
  };
  const bgImg = mkImg('position:absolute;inset:0;width:100%;height:100%;object-fit:fill;');
  const borderImg = mkImg('position:absolute;left:50%;top:50%;width:898px;height:698px;transform:translate(-50%,-50%);');
  const artImg = mkImg('position:absolute;left:50%;top:50%;width:800px;height:600px;transform:translate(-50%,-50%);');
  const boxImg = mkImg('position:absolute;left:50%;top:calc(100% - 147px);width:455px;height:90px;margin-left:-227px;');

  const title = document.createElement('div');
  title.style.cssText = 'position:absolute;left:0;right:0;top:calc(100% - 140px);text-align:center;color:#f8f0d8;' +
    'font:bold 13px "Microsoft YaHei","Segoe UI",sans-serif;text-shadow:0 1px 2px #000;pointer-events:none;';
  // 提示文字：**与标题、进度条一起排在同一个纯色框（box.png）里**
  //（用户 2026-09-14：进度条原来在框外、字节字样压在花背景上看不清；都收进纯色框，
  //  空间够、对比度也够。这是我们相对 EU 的有意改动：EU 把 bar 画在框上方，我们合并进框。）
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;left:50%;margin-left:-215px;top:calc(100% - 121px);width:430px;height:40px;' +
    'display:flex;align-items:center;justify-content:center;text-align:center;color:#e0d8c8;' +
    'font:12px/1.35 "Microsoft YaHei","Segoe UI",sans-serif;text-shadow:0 1px 2px #000;pointer-events:none;';
  root.append(title, tip);

  /**
   * 进度 = **纯色框背后的填充**（用户 2026-09-14："直接删掉第 3 个进度条，把第 2 个框改成进度条"，
   * 随后明确："我想让进度条的颜色在它的背后走动"）。
   *
   * 不再用 EU 的 `loadingbar.bmp` / `loadingbar_.bmp`（那条独立轨道），而是让 box.png 这个框
   * 自己承担进度：填充层与框**完全重合**（同样的居中与尺寸），宽度按进度从左往右长。
   *
   * ⚠ **关键是层序**：它必须插在框底图**之前**（DOM 在前 = 画在下面）—— 透过半透明的圆角框看见颜色在涨；
   * 若插在框之后就成了"框上贴了一块色斑"（我第一版就是这样，用户截图指出）。
   * 因为被框压暗了一层，颜色比平常更亮更实一些；左侧给 8px 圆角与框的圆角吻合（否则直角会戳出来）。
   */
  const boxFill = document.createElement('div');
  // box.png 里**自带两个叠着的框**：上面小的（原为标题条）+ 下面大的（原为提示区）。
  // 用户 2026-09-14 改主意：**进度用上面那个小框**（绿色填充）。
  // 边界是量出来的（相对 455×90 的图）：内部约 x 96~353、y 2~25；
  //   中心列 y=1 是亮线、y=26~29 是下边框、y=31 才是大框上边框；横向 x=95 / x=354 是亮线。
  // ⇒ 取 x 94~355（宽 261）、y 1~30（高 29）。**这个 261 正好等于原版 `loadingbar` 的 262** ——
  //   也就是说 EU 那条进度条本就是为这个小框设计的尺寸，只是画在了框外面。
  // 层序（用户 2026-09-14 定）：**背景框 → 进度 → 框上的文字**。
  // ⚠ 进度必须在**框之上**：上面那个小框是**不透明的**（量过：小框内部亮度 22~23 实心暗色，
  //   大框是 27），画在它背后根本透不出来。而它又必须在**文字之下**（不遮住"正在进入 X"）。
  //   ⇒ `boxImg.after(boxFill)` 把进度紧跟框之后插入 ⇒ 顺序自然是 框 / 进度 / title / tip。
  // 直接画在实心小框上，就不需要光晕了（外发光会溢到框外，看着糊）。
  // 用户 2026-09-14 微调：宽高各收缩 2px 后，依次调"上再减 2、下再减 1"、"左右再减 2"。
  // 几何与配色全部由 PROGRESS_FILL 算出（单一来源，调试页读同一份常量）：
  //   小框内沿（实测）减去四边余量。data-role 供调试页定位这一层。
  boxFill.dataset.role = 'progress';
  {
    const f = PROGRESS_FILL;
    const left = BOX_INNER.left + f.inset.left;
    const top = BOX_INNER.top + f.inset.top;
    const h = BOX_INNER.bottom - BOX_INNER.top - f.inset.top - f.inset.bottom;
    boxFill.style.cssText = `position:absolute;left:calc(50% - ${BOX_HALF_W - left}px);`
      + `top:calc(100% - ${BOX_TOP_OFFSET - top}px);width:0;height:${h}px;`
      + `max-width:${PROGRESS_MAX_W}px;border-radius:${f.radius}px;`
      + `background:${cssRgba(f.color, f.alpha)};pointer-events:none;`;
  }
  boxImg.after(boxFill);

  /**
   * 字节/速度行：**居中**显示"已加载 / 总量 · 速度"。
   *
   * 用户 2026-09-14 的两条要求都在这里：
   *  - "玩家要看到的是**已经加载成功多少数据**，命中缓存的可以直接累加数字" ⇒ `bytesLoaded`
   *    在 `asset-cache` 里已含缓存命中，这里**不再**区分"这次走没走网络"（原来没活动时会切成
   *    "缓存命中 N"，那是站在我们视角、不是玩家视角）。
   *  - "不要那个 `~`" ⇒ 直接给数字；总量只有对端给了 Content-Length 时才显示（dev 的 vite
   *    中间件是 chunked、没有这个头，所以本地通常只显示"已加载"那一段）。
   * 速度按**网络**字节算（命中缓存没有"速度"可言），无网络活动时不显示速度。
   */
  const bytesEl = document.createElement('div');
  // data-role 供调试页（loading-demo.html）定位并接管这一行的文本
  bytesEl.dataset.role = 'bytes';
  bytesEl.style.cssText = 'position:absolute;left:0;right:0;bottom:63px;width:fit-content;margin:0 auto;'
    + 'text-align:center;color:#f4f8fd;font:11px/1.45 ui-monospace,Consolas,monospace;'
    + 'pointer-events:none;white-space:nowrap;';
  root.appendChild(bytesEl);

  /** 字节数 → 人读的短串（进度条那点宽度只够放这个量级） */
  function fmtBytes(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return (n / 1024).toFixed(0) + ' KB';
    return Math.max(0, Math.round(n)) + ' B';
  }

  /** 速度串：数字与单位**紧贴**（`399KB/s`）—— 照用户给的写法 */
  function fmtSpeed(n: number): string {
    if (n >= 1048576) return (n / 1048576).toFixed(1) + 'MB/s';
    if (n >= 1024) return Math.round(n / 1024) + 'KB/s';
    return Math.round(n) + 'B/s';
  }

  function refreshBytes(): void {
    const p = assetProgress();
    if (p.bytesLoaded <= 0) {
      bytesEl.textContent = '';   // 还没开始加载：不显示 "0 MB" 这种没信息量的东西
      return;
    }
    // 最终格式（用户 2026-09-14 定）：**"已加载 @ 速度"**，例如 `12.4 MB @ 399KB/s`。
    // 走缓存（没有网络活动）时速度位显示 **`-- KB/s`** —— 把格式固定住，比让那一段忽有忽无更稳。
    // 不显示总量：我们能算出的只是"已发出请求的 Content-Length 之和"，它随请求发出而增长，不如不给。
    // 已加载**含缓存命中**（玩家看的是"一共加载成功了多少"）。
    bytesEl.textContent = fmtBytes(p.bytesLoaded) + ' @ '
      + (p.speed > 1024 ? fmtSpeed(p.speed) : '-- KB/s');

    // 字节驱动的渐进式进度：每 200ms 涨一点，**上限 95%**（剩下的留给"真加载完"那一刻）。
    // 被调试页接管（manualProgressText）时不参与 —— 那里的宽度由它自己的滑块决定。
    if (opts?.progressFromBytes && !opts.manualProgressText) {
      const refBytes = Math.max(1, opts.progressFromBytes.refMB) * 1048576;
      const ratio = Math.min(0.95, p.bytesLoaded / refBytes);
      boxFill.style.width = (PROGRESS_MAX_W * ratio) + 'px';
    }
  }
  let bytesTimer = 0;

  container.appendChild(root);

  // EU 客户端为会话内一次性随机（ImageHandler 缓存，本次运行恒用同一张）
  const chosen = LOADING_IMAGES[Math.floor(Math.random() * LOADING_IMAGES.length)] ?? 'map';
  let shown = false;

  return {
    show(titleText) {
      const blurSrc = SCREENS + chosen + '-blur.png';
      const artSrc = SCREENS + chosen + '.png';
      if (!shown) {
        shown = true;
        bgImg.src = blurSrc;
        artImg.src = artSrc;
        borderImg.src = SCREENS + 'border.png';
        boxImg.src = SCREENS + 'box.png';
      }
      title.textContent = titleText ?? t('gui.load.tipsTitle');
      const tips = (getLocale() === 'en' ? TIPS.en : TIPS.zh) ?? TIPS.zh ?? [];
      tip.textContent = tips.length ? tips[Math.floor(Math.random() * tips.length)] : '';
      boxFill.style.width = '0';   // 进度归零（纯色框内的填充层）
      // 字节统计窗口从 0 起算（"这次加载下了多少"），并开始 200ms 刷新
      resetAssetProgress();
      bytesEl.textContent = '';
      if (bytesTimer) window.clearInterval(bytesTimer);
      // 被调用方接管时不启自动刷新（见 opts.manualProgressText 的说明）
      bytesTimer = opts?.manualProgressText ? 0 : window.setInterval(refreshBytes, 200);
      root.style.display = 'block';
      // 加载期间挡住世界/HUD/背包的鼠标操作（挂在 window/document 上的监听不看 DOM 命中，见 inputGate）
      setInputBlocked(true);
    },
    setProgress(current, max, label) {
      const pct = max > 0 ? Math.min(100, Math.max(0, current / max)) : 0;
      // 字节渐进模式下，日常宽度交给 refreshBytes（否则退化成"只在 4 个阶段跳一下"）；
      // 但**阶段报满时强制置满** —— 那一刻确实加载完了，不该停在 95%。
      if (pct >= 1 || !opts?.progressFromBytes) {
        boxFill.style.width = (PROGRESS_MAX_W * pct) + 'px';
      }
      if (label !== undefined) tip.textContent = label;
    },
    hide() {
      if (bytesTimer) { window.clearInterval(bytesTimer); bytesTimer = 0; }
      root.style.display = 'none';
      setInputBlocked(false);
    },
  };
}
