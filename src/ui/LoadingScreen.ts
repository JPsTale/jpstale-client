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

const SCREENS = '/res/game/images/loadingscreens/';
const MISC = '/res/game/images/misc/';

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

export function createLoadingScreen(container: HTMLElement): LoadingScreen {
  const root = document.createElement('div');
  root.id = 'loading-screen';
  root.style.cssText = 'display:none;position:fixed;inset:0;background:#0a0a1a;overflow:hidden;z-index:200;';

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
  const tip = document.createElement('div');
  tip.style.cssText = 'position:absolute;left:50%;margin-left:-215px;top:calc(100% - 115px);width:430px;height:50px;' +
    'display:flex;align-items:center;justify-content:center;text-align:center;color:#e0d8c8;' +
    'font:12px/1.5 "Microsoft YaHei","Segoe UI",sans-serif;text-shadow:0 1px 2px #000;pointer-events:none;';
  root.append(title, tip);

  // 进度条（EU ThreadLoadingBar：底条恒画满，填充图固定 262 宽、由外层裁宽实现进度）
  const barWrap = document.createElement('div');
  barWrap.style.cssText = 'position:absolute;left:50%;top:50%;width:262px;height:33px;margin-left:-133px;margin-top:187px;';
  const barFrame = document.createElement('img');
  barFrame.draggable = false;
  barFrame.src = MISC + 'loadingbar.bmp';
  barFrame.style.cssText = 'position:absolute;inset:0;width:262px;height:33px;';
  barFrame.addEventListener('error', () => { barFrame.style.display = 'none'; });
  const fillWrap = document.createElement('div');
  fillWrap.style.cssText = 'position:absolute;left:0;top:0;height:33px;width:0%;overflow:hidden;';
  const barFill = document.createElement('img');
  barFill.draggable = false;
  barFill.src = MISC + 'loadingbar_.bmp';
  barFill.style.cssText = 'display:block;width:262px;height:33px;max-width:none;';
  barFill.addEventListener('error', () => { fillWrap.style.display = 'none'; });
  fillWrap.appendChild(barFill);
  barWrap.append(barFrame, fillWrap);
  root.appendChild(barWrap);
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
      fillWrap.style.width = '0%';
      root.style.display = 'block';
    },
    setProgress(current, max, label) {
      const pct = max > 0 ? Math.min(100, Math.round(current / max * 100)) : 0;
      fillWrap.style.width = pct + '%';
      if (label !== undefined) tip.textContent = label;
    },
    hide() { root.style.display = 'none'; },
  };
}
