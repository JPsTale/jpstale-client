import { decodeTextureAsync } from '../core/texture.js';
import { t } from '../i18n/index.js';

/**
 * 角色信息面板（原版 PT 底部 800×200 停靠栏）。
 *
 * 坐标系统与 HUD 一致：逻辑画布 1280×720，内容按原版 800×600 坐标绘制，
 * 即 ctx.translate(240, 120) 后直接使用原版坐标。面板铺于 y=400~600（原版），
 * 贴底停靠，与 HUD 底边严格对齐。
 *
 * 布局依据 ex-machina sinCharStatus.cpp：
 *   sCharRectPosi[0..23] 文字位置 / PointButton[6] 分配箭头 / RegiBox[5] 抗性信息盒。
 * 标签文字已印在 status.bmp 背景上，本面板只绘制数值与交互元素。
 */

export interface CharacterStatus {
  playerId: number
  name: string
  job: number
  level: number
  exp: number
  nextExp: number
  gold: number
  strength: number
  spirit: number
  talent: number
  agility: number
  health: number
  statePoint: number
  totalStatPoints: number
  hp: number
  maxHp: number
  mp: number
  maxMp: number
  sp: number
  maxSp: number
  attackMin: number
  attackMax: number
  attackRating: number
  defense: number
  absorption: number
  moveSpeed: number
  walkSpeed: number
  runSpeed: number
  attackSpeed: number
  critical: number
  block: number
  shootingRange: number
  maxWeight: number
  resBionic: number
  resPoison: number
  resFire: number
  resLightning: number
  resIce: number
}

export interface CharacterPanel {
  show(status: CharacterStatus): void
  hide(): void
  dispose(): void
  visible(): boolean
  /** 属性分配回调：stat 为 strength/spirit/talent/agility/health/undo */
  onAllocate?: (stat: string) => void
}

const W = 1280
const H = 720

interface Tex { el: HTMLImageElement; w: number; h: number }

const TEXTURES: Record<string, string> = {
  status: 'status/status.bmp',
  changeArrow: 'status/changearrow.bmp',
  selectArrow: 'status/selectarrow.bmp',
  selectArrow2: 'status/selectarrow2.bmp',
  regBio: 'status/regiinfo/bioinfo.bmp',
  regFire: 'status/regiinfo/fireinfo.bmp',
  regIce: 'status/regiinfo/iceinfo.bmp',
  regPoison: 'status/regiinfo/poisoninfo.bmp',
  regLight: 'status/regiinfo/lightinfo.bmp',
  exit: 'inter/exit.bmp',
}

// 职业code(1-10) → i18n 键（与 CharSelect.JOBS 一致）
const JOB_KEYS: Record<number, string> = {
  1: 'job.fighter', 2: 'job.mechanician', 3: 'job.archer', 4: 'job.pikeman',
  5: 'job.atalanta', 6: 'job.knight', 7: 'job.magician', 8: 'job.priestess',
  9: 'job.assassin', 10: 'job.shaman',
}

// 数值文字位置（原版 800×600 内容坐标，左上角）
const T = {
  class: [75, 444] as const,
  name: [75, 465] as const,
  level: [75, 505] as const,
  exp: [75, 545] as const,
  next: [75, 565] as const,
  life: [391, 431] as const,
  mana: [391, 456] as const,
  stm: [391, 481] as const,
  str: [585, 435] as const,
  spi: [585, 456] as const,
  tal: [585, 475] as const,
  dex: [585, 495] as const,
  hea: [585, 515] as const,
  point: [585, 532] as const,
  ar: [710, 454] as const,
  ad: [710, 473] as const,
  def: [710, 494] as const,
  spd: [710, 514] as const,
  abs: [710, 533] as const,
  resB: [219, 457] as const,
  resP: [289, 456] as const,
  resF: [219, 494] as const,
  resL: [289, 494] as const,
  resI: [219, 531] as const,
}

// 分配箭头（18×17 changearrow）：5 属性 + 第 6 个为撤销
const ALLOC_BUTTONS: { x: number; y: number; stat: string }[] = [
  { x: 566, y: 432, stat: 'strength' },
  { x: 566, y: 453, stat: 'spirit' },
  { x: 566, y: 473, stat: 'talent' },
  { x: 566, y: 492, stat: 'agility' },
  { x: 566, y: 512, stat: 'health' },
  { x: 566, y: 532, stat: 'undo' },
]

// 抗性信息盒（鼠标移入显示 regiinfo 图标 70×27）
const RESIST_BOXES: { x: number; y: number; key: string; tex: string }[] = [
  { x: 185, y: 445, key: 'resB', tex: 'regBio' },
  { x: 185, y: 482, key: 'resF', tex: 'regFire' },
  { x: 185, y: 519, key: 'resI', tex: 'regIce' },
  { x: 251, y: 445, key: 'resP', tex: 'regPoison' },
  { x: 251, y: 482, key: 'resL', tex: 'regLight' },
]

// 关闭/收起按钮（原版 cShop.lpExit 20×20）
const EXIT_BTN = { x: 251, y: 565, w: 20, h: 20 }

function jobName(job: number): string {
  return t(JOB_KEYS[job] ?? 'job.fighter')
}

export function createCharacterPanel(container: HTMLElement): CharacterPanel {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.zIndex = '54'
  canvas.style.pointerEvents = 'none'
  canvas.style.display = 'none'
  container.appendChild(canvas)

  // 命中层：仅覆盖面板带（画布逻辑 y 520~720 = 原版 400~600），
  // 避免全屏 canvas 挡住世界点击。跟随 fitCanvas 布局。
  // z-index 57 高于 HUD 拦截层(56)：面板打开时面板交互优先，且吞掉该区域点击防世界移动。
  const hitZone = document.createElement('div')
  hitZone.style.position = 'fixed'
  hitZone.style.zIndex = '57'
  hitZone.style.display = 'none'
  hitZone.style.cursor = 'pointer'
  hitZone.style.pointerEvents = 'auto'
  container.appendChild(hitZone)

  const ctx = canvas.getContext('2d')!
  const textures: Partial<Record<string, Tex>> = {}

  let status: CharacterStatus | null = null
  let shown = false
  let rafId = 0
  let ptrX = -1
  let ptrY = -1
  // 属性分配回调（由 main.ts 注入）
  let onAllocate: ((stat: string) => void) | undefined

  // ── 布局适配：与 HUD 相同的等比缩放 + 贴底 ──
  function fitCanvas() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H)
    const wpx = W * scale
    const hpx = H * scale
    canvas.style.width = `${wpx}px`
    canvas.style.height = `${hpx}px`
    canvas.style.left = `${(window.innerWidth - wpx) / 2}px`
    canvas.style.top = `${window.innerHeight - hpx}px`
    // 命中层覆盖画布逻辑 y 520~720（= 内容 400~600）
    hitZone.style.left = `${(window.innerWidth - wpx) / 2}px`
    hitZone.style.width = `${wpx}px`
    hitZone.style.top = `${window.innerHeight - hpx + 520 * scale}px`
    hitZone.style.height = `${200 * scale}px`
  }

  function toContent(clientX: number, clientY: number): { mx: number; my: number } {
    const rect = canvas.getBoundingClientRect()
    if (rect.width <= 0) return { mx: -1, my: -1 }
    const s = rect.width / W
    return { mx: (clientX - rect.left) / s - 240, my: (clientY - rect.top) / s - 120 }
  }

  function drawTex(name: string, x: number, y: number, w: number, h: number) {
    const tt = textures[name]
    if (tt?.el) ctx.drawImage(tt.el, x, y, w, h)
  }

  function text(x: number, y: number, str: string, color = '#ffffff') {
    ctx.font = '12px "Microsoft YaHei", "Segoe UI", monospace'
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.fillStyle = color
    ctx.shadowColor = 'rgba(0,0,0,0.8)'
    ctx.shadowBlur = 2
    ctx.fillText(str, x, y)
    ctx.shadowBlur = 0
  }

  function draw() {
    if (!shown || !status) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, W, H)
    ctx.save()
    ctx.translate(240, 120)

    // 面板背景（800×200，贴底展开）
    drawTex('status', 0, 400, 800, 200)

    const s = status
    text(T.class[0], T.class[1], jobName(s.job))
    text(T.name[0], T.name[1], s.name)
    text(T.level[0], T.level[1], String(s.level))
    text(T.exp[0], T.exp[1], String(s.exp))
    text(T.next[0], T.next[1], String(s.nextExp))
    text(T.life[0], T.life[1], `${s.hp}/${s.maxHp}`)
    text(T.mana[0], T.mana[1], `${s.mp}/${s.maxMp}`)
    text(T.stm[0], T.stm[1], `${s.sp}/${s.maxSp}`)
    text(T.str[0], T.str[1], String(s.strength))
    text(T.spi[0], T.spi[1], String(s.spirit))
    text(T.tal[0], T.tal[1], String(s.talent))
    text(T.dex[0], T.dex[1], String(s.agility))
    text(T.hea[0], T.hea[1], String(s.health))
    if (s.statePoint > 0) text(T.point[0], T.point[1], String(s.statePoint))
    text(T.ar[0], T.ar[1], String(s.attackRating))
    text(T.ad[0], T.ad[1], `${s.attackMin}-${s.attackMax}`)
    text(T.def[0], T.def[1], String(s.defense))
    text(T.spd[0], T.spd[1], String(s.moveSpeed))
    text(T.abs[0], T.abs[1], String(s.absorption))
    text(T.resB[0], T.resB[1], String(s.resBionic))
    text(T.resP[0], T.resP[1], String(s.resPoison))
    text(T.resF[0], T.resF[1], String(s.resFire))
    text(T.resL[0], T.resL[1], String(s.resLightning))
    text(T.resI[0], T.resI[1], String(s.resIce))

    // 可分配属性点时绘制分配箭头（5 属性 + 撤销）
    if (s.statePoint > 0) {
      for (const b of ALLOC_BUTTONS) drawTex('changeArrow', b.x, b.y, 18, 17)
    }

    // 关闭按钮
    drawTex('exit', EXIT_BTN.x, EXIT_BTN.y, EXIT_BTN.w, EXIT_BTN.h)

    // 悬停反馈：抗性信息盒 + 分配箭头按下状态
    const { mx, my } = toContent(ptrX, ptrY)
    const hit = (x0: number, y0: number, x1: number, y1: number) =>
      mx >= x0 && mx < x1 && my >= y0 && my < y1
    // 抗性悬浮图标（原版画在信息盒上方 27px）
    for (const rb of RESIST_BOXES) {
      if (hit(rb.x, rb.y, rb.x + 31, rb.y + 30)) {
        drawTex(rb.tex, rb.x + 3, rb.y - 27, 70, 27)
        break
      }
    }
    if (s.statePoint > 0) {
      for (const b of ALLOC_BUTTONS) {
        if (hit(b.x, b.y, b.x + 18, b.y + 17)) {
          drawTex(b.stat === 'undo' ? 'selectArrow2' : 'selectArrow', b.x + 1, b.y + 1, 18, 17)
        }
      }
    }

    ctx.restore()
  }

  function loop() {
    draw()
    rafId = requestAnimationFrame(loop)
  }

  // ── 命中层交互 ──
  hitZone.addEventListener('pointermove', (e) => {
    ptrX = e.clientX
    ptrY = e.clientY
  })
  hitZone.addEventListener('pointerleave', () => {
    ptrX = -1
    ptrY = -1
  })
  hitZone.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !status) return
    const { mx, my } = toContent(e.clientX, e.clientY)
    const hit = (x0: number, y0: number, x1: number, y1: number) =>
      mx >= x0 && mx < x1 && my >= y0 && my < y1
    // 关闭按钮
    if (hit(EXIT_BTN.x, EXIT_BTN.y, EXIT_BTN.x + EXIT_BTN.w, EXIT_BTN.y + EXIT_BTN.h)) {
      hide()
      return
    }
    // 分配箭头（需有可分配点；撤销也需有历史，由服务端校验）
    if (status.statePoint > 0) {
      for (const b of ALLOC_BUTTONS) {
        if (hit(b.x, b.y, b.x + 18, b.y + 17)) {
          onAllocate?.(b.stat)
          return
        }
      }
    }
  })

  async function loadAllTextures() {
    const keys = Object.keys(TEXTURES)
    const loaded = await Promise.all(keys.map(k => loadTex(TEXTURES[k])))
    keys.forEach((k, i) => { if (loaded[i]) textures[k] = loaded[i]! })
  }

  async function loadTex(rel: string): Promise<Tex | null> {
    const url = '/res/image/sinimage/' + rel
    try {
      const resp = await fetch(url)
      if (!resp.ok) return null
      const buf = await resp.arrayBuffer()
      const decoded = await decodeTextureAsync(buf)
      if (!decoded) return null
      // 原版 Status/箭头等为带 alpha 的 DDS，本资产为 24-bit BMP 无 alpha：
      // 黑色（ColorKey 0,0,0，原版 CreateColorKeySurface 语义）置透明，恢复透明边缘。
      const px = decoded.pixels
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] === 0 && px[i + 1] === 0 && px[i + 2] === 0) {
          px[i + 3] = 0
        }
      }
      const c = document.createElement('canvas')
      c.width = decoded.width
      c.height = decoded.height
      const cx = c.getContext('2d')!
      cx.putImageData(new ImageData(new Uint8ClampedArray(decoded.pixels), decoded.width, decoded.height), 0, 0)
      const el = new Image()
      el.src = c.toDataURL()
      await new Promise<void>(r => { el.onload = () => r(); el.onerror = () => r() })
      return { el, w: decoded.width, h: decoded.height }
    } catch { return null }
  }

  window.addEventListener('resize', fitCanvas)
  fitCanvas()
  loadAllTextures().then(() => {
    rafId = requestAnimationFrame(loop)
  })

  function show(st: CharacterStatus) {
    status = st
    shown = true
    canvas.style.display = 'block'
    hitZone.style.display = 'block'
  }

  function hide() {
    shown = false
    canvas.style.display = 'none'
    hitZone.style.display = 'none'
    ptrX = -1
    ptrY = -1
  }

  return {
    show(status: CharacterStatus) { show(status) },
    hide() { hide() },
    visible() { return shown },
    set onAllocate(fn: ((stat: string) => void) | undefined) { onAllocate = fn },
    dispose() {
      hide()
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', fitCanvas)
      canvas.remove()
      hitZone.remove()
    },
  }
}