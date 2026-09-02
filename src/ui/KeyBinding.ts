// src/ui/KeyBinding.ts

export type GameAction = 
  | 'moveForward' | 'moveBackward' | 'moveLeft' | 'moveRight'
  | 'attack' | 'skill'
  | 'walkRun' | 'cameraMode' | 'minimap'
  | 'status' | 'skillPanel' | 'inventory' | 'party' | 'quest' | 'system'
  | 'showGroundItems'
  | 'skill1' | 'skill2' | 'skill3' | 'skill4' | 'skill5' | 'skill6'
  | 'skill7' | 'skill8' | 'skill9' | 'skill10' | 'skill11' | 'skill12'
  | 'potion1' | 'potion2' | 'potion3' | 'potion4' | 'potion5' | 'potion6'
  | 'potion7' | 'potion8' | 'potion9' | 'potion10' | 'potion11' | 'potion12'
  | 'chat' | 'closePanel'

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
  potion1: 'Digit1', potion2: 'Digit2', potion3: 'Digit3',
  potion4: 'Digit4', potion5: 'Digit5', potion6: 'Digit6',
  potion7: 'Digit7', potion8: 'Digit8', potion9: 'Digit9',
  potion10: 'Digit0', potion11: 'Minus', potion12: 'Equal',
  chat: 'Enter',
  closePanel: 'Escape',
}

export function createKeyBinding(): KeyBinding {
  let bindings = { ...DEFAULT_BINDINGS }
  let actionCallbacks: ((action: GameAction) => void)[] = []

  function handleKeyDown(e: KeyboardEvent) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
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
        bindings = { ...DEFAULT_BINDINGS, ...parsed }
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
