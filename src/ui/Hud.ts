export interface HudState {
  hp: number; maxHp: number;
  mp: number; maxMp: number;
  level: number;
}

export interface Hud {
  show(state: HudState): void;
  hide(): void;
  destroy(): void;
}

export function createHud(container: HTMLElement): Hud {
  const el = document.createElement('div');
  el.className = 'hud';
  el.style.cssText = 'display:none;position:absolute;top:8px;left:8px;color:#fff;font:12px monospace;text-shadow:1px 1px 2px #000';
  container.appendChild(el);

  return {
    show(state) {
      el.innerHTML = `HP ${state.hp}/${state.maxHp} | MP ${state.mp}/${state.maxMp} | Lv.${state.level}`;
      el.style.display = 'block';
    },
    hide() { el.style.display = 'none'; },
    destroy() { el.remove(); },
  };
}
