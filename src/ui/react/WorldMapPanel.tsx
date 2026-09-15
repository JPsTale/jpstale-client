import { useEffect, useRef, useState } from 'react';
import PanelShell, { type PanelRect } from './PanelShell.js';
import {
  createWorldMap, type WorldMapChrome, type WorldMapEntity, type WorldMapHandle, type WorldMapPlayer,
} from '../WorldMap.js';
import { loadUiPrefs, saveUiPrefs } from '../ui-prefs.js';
import { t } from '../../i18n/index.js';

export interface WorldMapPanelOptions {
  getPlayer?: () => WorldMapPlayer | null;
  getEntities?: () => WorldMapEntity[];
}

/**
 * 世界地图面板 —— **和其它面板走同一套外壳**（`PanelShell`）。
 *
 * 用户 2026-09-16："这个地图必须走 reactpanel，和其他面板走一套东西而不是两套。"
 * 合并前地图自带一套 `.jp-wm` / `.jp-wm-win`（自己的标题栏、拖动、缩放、关闭、显隐、层级声明），
 * 代价是同一件事两处实现：层级要各接一遍（漏过地图）、容器层叠上下文坑连踩两次
 * （地图整层被世界层盖住、屏幕上一个像素看不见）。现在地图只提供**内容**，
 * 窗口外壳/层级/开关全部与背包、角色、技能、NPC 商店共用。
 *
 * 分工：
 *   · 本文档管**窗口**：位置尺寸（持久化在 `ui-prefs.worldMapRect`）、缩放、关闭、半透明；
 *   · `WorldMap.ts` 管**内容**：canvas 绘制、交互、点位/实体、面包屑数据（通过 `onChrome` 回调上来）。
 */
export default function WorldMapPanel({ getPlayer, getEntities }: WorldMapPanelOptions) {
  const [rect, setRect] = useState<PanelRect>(() => {
    const saved = loadUiPrefs().worldMapRect;
    // 记住的位置照样要过约束（视口可能已经变了）
    return saved ? clampRect(saved) : defaultRect();
  });
  const [chrome, setChrome] = useState<WorldMapChrome>({ crumbs: [], dim: false });
  const hostRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<WorldMapHandle | null>(null);

  // 挂载内容 / 卸载收尾。`getPlayer`/`getEntities` 是 main 注入的闭包（每次现读，不缓存）
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const map = createWorldMap(host, {
      getPlayer,
      getEntities,
      onChrome: setChrome,
      revealAll: false,    // 副本/战场只在玩家身处其中时才出现在地图上（用户 2026-09-15 定）
      openAtPlayer: true,  // 打开就是"我在的地方"，右键/↑ 再退回区域
    });
    mapRef.current = map;
    map.show();
    return () => { map.destroy(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 拖动/缩放改了窗口 → 先夹进合法范围，再记住（沿用地图自己的持久化字段，不动 ui-prefs 结构） */
  function onRectChange(r: PanelRect): void {
    const c = clampRect(r);
    setRect(c);
    saveUiPrefs({ worldMapRect: c });
  }

  return (
    <PanelShell
      panel="worldmap"
      title={t('panel.worldmap')}
      rect={rect}
      onRectChange={onRectChange}
      resizable
      dimWhenUnfocused={chrome.dim ? 0.5 : undefined}
    >
      {/* 面包屑**浮在画布左上角**（让开左侧竖条的 34px），不进标题栏 ——
          用户 2026-09-16："这个'面包屑'根本不应该出现在标题上，而是应该浮在 canvas 左上角。"
          它是**导航**（"我在哪一级 / 点这里回上一级"），和窗口身份（标题）不是一回事。 */}
      {chrome.crumbs.length > 0 && (
        <div className="jp-wm-crumb">
          {chrome.crumbs.map((c, i) => (
            <span key={c.text + i}>
              {i > 0 && <span className="sep"> › </span>}
              {c.go
                ? <span className="link" onClick={c.go}>{c.text}</span>
                : <span>{c.text}</span>}
            </span>
          ))}
        </div>
      )}
      <div ref={hostRef} style={{ position: 'absolute', inset: 0 }} />
    </PanelShell>
  );
}

/** 窗口尺寸下限 */
const MIN_W = 520, MIN_H = 340;
/** 顶部必须露出的高度（标题栏是拖动/关闭的唯一把手，露不出来就等于"打不开"） */
const HEAD_H = 34;

/**
 * 窗口几何的**边界约束**：这是**限制输入范围**，不是"发现不对就重置"的兜底 ——
 * 窗口矩形有三个来源（`ui-prefs` 里记住的、拖动、缩放），每个来源都必须过这里，
 * 于是"窗口跑到视口外"这种状态**根本不会被产生**。
 *
 * 为什么必须有（2026-09-16 实测）：`ui-prefs.worldMapRect` 是持久化的，玩家上次把窗口拖到
 * 右侧、之后浏览器窗口变小，再打开时矩形就落在视口外 —— 表现正是"按 M 打不开地图"
 * （DOM 里一切正常、屏幕上找不到）。夹住之后这类状态不可能出现。
 */
function clampRect(r: PanelRect): PanelRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(Math.max(MIN_W, vw - 16), Math.round(r.w)));
  const h = Math.max(MIN_H, Math.min(Math.max(MIN_H, vh - 16), Math.round(r.h)));
  // x：**整窗横向不出界**（窗口比视口宽时贴左）。允许出界就等于允许"左侧竖条看不到"，
  //    而那正是"窗口在、功能却用不了"的隐蔽故障；横向没有出界的理由。
  const x = Math.max(0, Math.min(Math.max(0, vw - w), Math.round(r.x)));
  // y：允许底部出界（大窗口在小视口里很常见），但**顶边必须留在视口内**（标题栏要抓得到）
  const y = Math.max(0, Math.min(Math.max(0, vh - HEAD_H), Math.round(r.y)));
  return { x, y, w, h };
}

/** 默认窗口矩形（占视口 80%，居中）。以前它长在 `WorldMap.ts` 里 —— 窗口的事归窗口层 */
function defaultRect(): PanelRect {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(1280, Math.round(vw * 0.8)));
  const h = Math.max(MIN_H, Math.min(860, Math.round(vh * 0.8)));
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w, h };
}
