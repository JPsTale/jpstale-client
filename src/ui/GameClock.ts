// src/ui/GameClock.ts

export interface TimeState {
  hour: number
  min: number
  isNight: boolean
}

export interface GameClock {
  getHour(): number
  getMin(): number
  isNight(): boolean
  getState(): TimeState
  isSynced(): boolean
  onTimeUpdate(callback: (state: TimeState) => void): void
  dispose(): void
  setInitialTime(serverTimeMs: number): void
  correctTime(serverTimeMs: number): void
}

const GAME_WORLDTIME_MIN = 800 // 800ms = 1 game minute
const GAME_HOUR_DAY = 4
const GAME_HOUR_DARKNESS = 23
// 原版漂移容差：>10 游戏分钟强制 snap（=800*10=8000ms 真实时间）
const MAX_DRIFT_GAME_MIN = 10

export function createGameClock(): GameClock {
  let dwGameWorldTime = 0
  let hasServerTime = false
  let lastLocalTime = Date.now()
  let callbacks: ((state: TimeState) => void)[] = []

  function getHour(): number {
    return Math.floor(dwGameWorldTime / 60) % 24
  }

  function getMin(): number {
    return Math.floor(dwGameWorldTime) % 60
  }

  function isNight(): boolean {
    const hour = getHour()
    return hour < GAME_HOUR_DAY || hour >= GAME_HOUR_DARKNESS
  }

  function getState(): TimeState {
    return {
      hour: getHour(),
      min: getMin(),
      isNight: isNight()
    }
  }

  function notify() {
    const state = getState()
    for (const cb of callbacks) cb(state)
  }

  function setInitialTime(serverTimeMs: number) {
    hasServerTime = true
    dwGameWorldTime = Math.floor(serverTimeMs / GAME_WORLDTIME_MIN)
    notify()
  }

  function isSynced(): boolean {
    return hasServerTime
  }

  function correctTime(serverTimeMs: number) {
    if (!hasServerTime) {
      setInitialTime(serverTimeMs)
      return
    }
    // 服务器毫秒 → 游戏分钟（同 ConvSysTimeToGameTime）
    const serverGameMin = Math.floor(serverTimeMs / GAME_WORLDTIME_MIN)
    const driftMin = Math.abs(dwGameWorldTime - serverGameMin)

    // 原版 netplay: abs(dwGameWorldTime - dwTime) > 10 → snap 回服务器时间
    if (driftMin > MAX_DRIFT_GAME_MIN) {
      dwGameWorldTime = serverGameMin
    }
    notify()
  }

  function update() {
    const now = Date.now()
    const deltaMs = now - lastLocalTime
    lastLocalTime = now
    dwGameWorldTime += deltaMs / GAME_WORLDTIME_MIN
    notify()
  }

  // 启动本地推进循环
  let intervalId = setInterval(update, 100)

  return {
    getHour,
    getMin,
    isNight,
    getState,
    isSynced,
    onTimeUpdate: (cb) => { callbacks.push(cb) },
    dispose: () => {
      clearInterval(intervalId)
      callbacks = []
    },
    setInitialTime,
    correctTime,
  }
}
