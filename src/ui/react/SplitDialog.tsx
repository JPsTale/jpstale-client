/**
 * 「拆分堆叠物品」弹框（用户 2026-09-14）。
 *
 * Shift + 左键点击堆叠物触发（见 `splitStore.requestSplit`），输入要**拆出去**的数量
 * （1 ~ 总数），确认后那份进鼠标位。
 *
 * **输入 = 总数 时等价于"整堆拿起"**（用户 2026-09-14 提的用法）—— 此时右侧提示从
 * `/ 总数` 变成"全部"，让用户看得出来这次不是拆分。服务端不需要任何额外支持：
 * `takeToHand` 里 `splitCount < have` 才拆，传总数自然走整堆那条路。
 *
 * 常驻在 `PanelsRoot`（不随背包开关）—— 药水槽在 HUD 上，背包关着也可能触发。
 *
 * 取值约束（用户 2026-09-14 定）：**输入时直接夹到上限**，越界值根本不进框。
 * 不做"先放进去、提交时再截断"，也不做"标红让用户自己改" —— 用户要的是数字**立刻**
 * 就变成 `总数-1`，框里永远没有一个非法值。（`min`/`max` 属性只是让原生 spinner 认界；
 * spinner 已按用户要求关掉，真正的约束在这里。）
 */
import { useEffect, useRef, useState } from 'react';
import { t } from '../../i18n/index.js';
import { cancelSplit, confirmSplit, useSplitRequest } from '../../app/splitStore.js';

export default function SplitDialog() {
  const req = useSplitRequest();
  const [value, setValue] = useState('1');
  const inputRef = useRef<HTMLInputElement>(null);

  // 每次打开：默认 1、聚焦并全选（直接输入即可覆盖）
  useEffect(() => {
    if (!req) return;
    setValue('1');
    const id = requestAnimationFrame(() => { inputRef.current?.focus(); inputRef.current?.select(); });
    return () => cancelAnimationFrame(id);
  }, [req?.uid, req?.total]);

  if (!req) return null;

  const max = req.total;
  // 空字符串允许存在（否则退格删不干净），其余一律夹进 [1, max] 再落回 state
  const onChange = (raw: string) => {
    if (raw === '') { setValue(''); return; }
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    setValue(String(Math.min(max, Math.max(1, n))));
  };
  const n = Math.max(1, Math.min(max, parseInt(value, 10) || 1));
  // 输入到总数 = **整堆拿起**（等价于不按 Shift 直接点它）：服务端 `takeToHand` 里
  // `splitCount < have` 才拆分，传总数自然走"整堆"那条路（用户 2026-09-14 提的用法）。
  const takeAll = n >= req.total;

  return (
    <div data-layer="splitDialog" className="jp-split-mask" onPointerDown={(e) => { if (e.target === e.currentTarget) cancelSplit(); }}>
      <div className="jp-split" role="dialog" aria-modal="true">
        <div className="jp-split-name">{req.name}</div>
        <div className="jp-split-row">
          <input
            ref={inputRef}
            className="jp-split-input"
            type="number"
            min={1}
            max={max}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onBlur={() => setValue(String(n))}   // 空值/异常退出时收敛回合法值
            onKeyDown={(e) => {
              // 拦掉键盘冒泡：否则数字键会被游戏快捷键吃掉（1/2/3 = 药水快捷）
              e.stopPropagation();
              if (e.key === 'Enter') confirmSplit(n);
              if (e.key === 'Escape') cancelSplit();
            }}
          />
          <span className="jp-split-total">{takeAll ? t('gui.all') : '/ ' + req.total}</span>
        </div>
        <div className="jp-split-btns">
          <button type="button" onClick={() => cancelSplit()}>{t('gui.cancel')}</button>
          <button type="button" className="jp-split-ok" onClick={() => confirmSplit(n)}>{t('gui.ok')}</button>
        </div>
      </div>
    </div>
  );
}
