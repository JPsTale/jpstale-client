export enum AppScreen {
  BOOT = 'BOOT',
  LOGIN = 'LOGIN',
  SERVER_SELECT = 'SERVER_SELECT',
  CHAR_SELECT = 'CHAR_SELECT',
  WORLD = 'WORLD',
}

export interface TransitionCtx {
  showBoot: () => void;
  showLogin: (error?: string) => void;
  showServerSelect: (characters: unknown[]) => void;
  showCharSelect: (characters: unknown[]) => void;
  showWorld: (state: unknown) => void;
  hideAll: () => void;
}

let _screen: AppScreen = AppScreen.BOOT;
export function getScreen(): AppScreen { return _screen; }

const VALID: Record<string, string[]> = {
  [AppScreen.BOOT]:          [AppScreen.LOGIN],
  [AppScreen.LOGIN]:         [AppScreen.SERVER_SELECT],
  [AppScreen.SERVER_SELECT]: [AppScreen.CHAR_SELECT],
  [AppScreen.CHAR_SELECT]:   [AppScreen.WORLD, AppScreen.LOGIN],
  [AppScreen.WORLD]:         [AppScreen.CHAR_SELECT, AppScreen.LOGIN],
};

export function transition(from: AppScreen, to: AppScreen, ctx: TransitionCtx): void {
  if (!VALID[from]?.includes(to)) {
    console.warn(`[app] illegal transition ${from} → ${to}`);
    return;
  }
  _screen = to;
  ctx.hideAll();
  switch (to) {
    case AppScreen.BOOT:          ctx.showBoot(); break;
    case AppScreen.LOGIN:         ctx.showLogin(); break;
    case AppScreen.SERVER_SELECT: break;
    case AppScreen.CHAR_SELECT:   break;
    case AppScreen.WORLD:         break;
  }
}
