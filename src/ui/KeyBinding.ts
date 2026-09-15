// src/ui/KeyBinding.ts

export type GameAction = 
  | 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight'
  | 'attack' | 'skill'
  | 'walkRun' | 'cameraMode' | 'minimap' | 'worldmap'
  | 'status' | 'skillPanel' | 'inventory' | 'party' | 'quest' | 'system'
  | 'showGroundItems'
  | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'skill5' | 'skill6'
  | 'skill7' | 'skill8' | 'skill9' | 'skill10' | 'skill11' | 'skill12'
  | 'potion1' | 'potion2' | 'potion3'
  | 'chat' | 'closePanel'
  | 'switchWeapon'

export interface KeyBinding {
  get(action: GameAction): string | null
  set(action: GameAction, key: string): void
  reset(): void
  getAll(): Record<GameAction, string | null>
  save(): void
  load(): void
  onKeyDown(callback: (action: GameAction) => void): () => void
  dispose(): void
}

const STORAGE_KEY = 'pt-keybindings'

const DEFAULT_BINDINGS: Record<GameAction, string | null> = {
  moveForward: null,
  moveBackward: null,
  moveLeft: null,
  moveRight: null,
  attack: 'Space',
  skill: 'Control',
  walkRun: 'KeyR',
  cameraMode: 'KeyZ',
  minimap: 'Tab',
  worldmap: 'KeyM',   // 原版大地图就是 M（ex-machina Main.cpp:3327 的 `wParam == 'M'`）
  status: 'KeyC',
  skillPanel: 'KeyS',
  inventory: 'KeyV',
  party: 'KeyD',
  quest: 'KeyQ',
  system: 'KeyX',
  showGroundItems: 'KeyA',
  skill1: 'F1', skill2: 'F2', skill3: 'F3', skill4: 'F4',
  skill5: 'F5', skill6: 'F6', skill7: 'F7', skill8: 'F8',
  skill9: 'F9', skill10: 'F10', skill11: 'F11', skill12: 'F12',
  // 原版只有 **3 个**药水快捷槽（ITEMSLOT 11/12/13，PotionOne/Two/Three），
  // 对应数字键 1/2/3（docs/pt-core-gameplay.md 19 节：护腕=臂环提供药水槽容量）。
  // 曾经这里排到 potion12（1-9/0/-/=），那是没有依据的扩展，已收敛。
  potion1: 'Digit1', potion2: 'Digit2', potion3: 'Digit3',
  chat: 'Enter',
  closePanel: 'Escape',
  switchWeapon: 'KeyW',
}

export function createKeyBinding(): KeyBinding {
  let bindings = { ...DEFAULT_BINDINGS }
  let actionCallbacks: ((action: GameAction) => void)[] = []

  function handleKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
      return
    }

    // **带修饰键的组合键不触发游戏动作**（用户 2026-09-14）：
    // 否则 Ctrl+C 会命中单键 C（状态面板），且 preventDefault 把浏览器的复制吞掉。
    // Shift 不算（Shift+F1 之类仍应生效，且 Shift 打字常用）；Alt/Meta 在浏览器里多为系统键，一并排除。
    if (e.ctrlKey || e.altKey || e.metaKey) {
      return
    }

    for (const [action, key] of Object.entries(bindings)) {
      if (key && e.code === key) {
        e.preventDefault()
        for (const cb of actionCallbacks) {
          cb(action as GameAction)
        }
        break
      }
    }
  }

  window.addEventListener('keydown', handleKeyDown)

  function get(action: GameAction): string | null {
    return bindings[action]
  }

  function set(action: GameAction, key: string): void {
    bindings[action] = key
  }

  function reset(): void {
    bindings = { ...DEFAULT_BINDINGS }
  }

  function getAll(): Record<GameAction, string | null> {
    return { ...bindings }
  }

  function save(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings))
  }

  function load(): void {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      try {
        const parsed = JSON.parse(saved)
        // 只认**当前定义**的 action：旧版本存过的 potion4..12 等废弃键直接丢弃，
        // 否则它们会作为"幽灵绑定"留在对象里、被 handleKeyDown 遍历到。
        const merged = { ...DEFAULT_BINDINGS }
        if (parsed && typeof parsed === 'object') {
          for (const k of Object.keys(DEFAULT_BINDINGS) as GameAction[]) {
            if (typeof (parsed as Record<string, unknown>)[k] === 'string') {
              merged[k] = (parsed as Record<string, string>)[k]!
            }
          }
        }
        bindings = merged
      } catch (e) {
        console.warn('Failed to load key bindings:', e)
      }
    }
  }

  load()

  return {
    get,
    set,
    reset,
    getAll,
    save,
    load,
    onKeyDown: (cb) => {
      actionCallbacks.push(cb)
      return () => { actionCallbacks = actionCallbacks.filter(h => h !== cb) }
    },
    dispose: () => {
      window.removeEventListener('keydown', handleKeyDown)
      actionCallbacks = []
    }
  }
}
