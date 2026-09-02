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
  onTimeUpdate(callback: (state: TimeState) => void): void
  dispose(): void
  setInitialTime(serverTimeMs: number): void
  correctTime(serverTimeMs: number): void
}

const GAME_WORLDTIME_MIN = 800 // 800ms = 1 game minute
const GAME_HOUR_DAY = 4
const GAME_HOUR_DARKNESS = 23

export function createGameClock(): GameClock {
  let dwGameWorldTime = 0
  let dwConnectedServerTime = 0
  let dwConnectedClientTime = 0
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
    dwConnectedServerTime = serverTimeMs
    dwConnectedClientTime = Date.now()
    dwGameWorldTime = Math.floor(serverTimeMs / GAME_WORLDTIME_MIN)
    notify()
  }

  function correctTime(serverTimeMs: number) {
    const calculatedServerTime = (Date.now() - dwConnectedClientTime) + dwConnectedServerTime
    const drift = Math.abs(serverTimeMs - calculatedServerTime)
    
    // 漂移>10分钟（600000ms）时强制校正
    if (drift > 600000) {
      dwGameWorldTime = Math.floor(serverTimeMs / GAME_WORLDTIME_MIN)
      dwConnectedServerTime = serverTimeMs
      dwConnectedClientTime = Date.now()
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
    onTimeUpdate: (cb) => { callbacks.push(cb) },
    dispose: () => {
      clearInterval(intervalId)
      callbacks = []
    },
    setInitialTime,
    correctTime,
  }
}
