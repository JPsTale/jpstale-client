# Task 1: 重写Hud.ts — 1280×720画布 + CSS缩放

**Files:**
- Rewrite: `src/ui/Hud.ts`
- Modify: `src/main.ts:180-220` (WORLD case)

**Interfaces:**
- Consumes: `decodeTextureAsync` from `core/texture.ts`
- Produces: `createHud(container): Hud`, `Hud` interface with `show(state)`, `hide()`, `dispose()`

## Steps

- [ ] **Step 1: 创建新的Hud.ts骨架**

```typescript
// src/ui/Hud.ts
import { decodeTextureAsync } from '../core/texture.ts'

export interface HudState {
  hp: number; maxHp: number
  mp: number; maxMp: number
  stm: number; maxStm: number
  exp: number; maxExp: number
  level: number
  playerName: string
}

export interface Hud {
  show(state: HudState): void
  hide(): void
  dispose(): void
}

const W = 1280
const H = 720

export function createHud(container: HTMLElement): Hud {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  canvas.style.position = 'fixed'
  canvas.style.inset = '0'
  canvas.style.pointerEvents = 'none'
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')!
  let currentState: HudState | null = null
  let textures: Map<string, HTMLImageElement> = new Map()
  let rafId = 0

  function fitCanvas() {
    const scale = Math.min(window.innerWidth / W, window.innerHeight / H)
    canvas.style.width = `${W * scale}px`
    canvas.style.height = `${H * scale}px`
    canvas.style.left = `${(window.innerWidth - W * scale) / 2}px`
    canvas.style.top = `${(window.innerHeight - H * scale) / 2}px`
  }

  async function loadTexture(name: string, path: string) {
    const tex = await decodeTextureAsync(path)
    if (!tex) return
    const offscreen = document.createElement('canvas')
    offscreen.width = tex.width
    offscreen.height = tex.height
    const offCtx = offscreen.getContext('2d')!
    offCtx.putImageData(new ImageData(tex.pixels, tex.width, tex.height), 0, 0)
    const img = new Image()
    img.src = offscreen.toDataURL()
    textures.set(name, img)
  }

  function draw() {
    if (!currentState) return
    ctx.clearRect(0, 0, W, H)
    // TODO: 绘制HUD元素
  }

  function loop() {
    draw()
    rafId = requestAnimationFrame(loop)
  }

  async function loadAllTextures() {
    const basePath = '/res/image/sinimage/inter'
    const entries: [string, string][] = [
      ['bar_life', `${basePath}/bar_life.bmp`],
      ['bar_mana', `${basePath}/bar_mana.bmp`],
      ['bar_stamina', `${basePath}/bar_stamina.bmp`],
      ['bar_exp', `${basePath}/sinGage/bar_exp.bmp`],
      ['sun', `${basePath}/flash/sun.bmp`],
      ['moon', `${basePath}/flash/moon.bmp`],
      ['bar_time', `${basePath}/sinGage/bar_time.bmp`],
      ['bstatus', `${basePath}/bstatus.bmp`],
      ['binven', `${basePath}/binven.bmp`],
      ['bskill', `${basePath}/bskill.bmp`],
      ['bparty', `${basePath}/bparty.bmp`],
      ['bquest', `${basePath}/bquest.bmp`],
      ['bsystem', `${basePath}/bsystem.bmp`],
      ['walk', `${basePath}/button/walk.bmp`],
      ['autocam', `${basePath}/button/autocameraimage.bmp`],
      ['pixcam', `${basePath}/button/pixcameraimage.bmp`],
      ['mapon', `${basePath}/button/maponimage.bmp`],
    ]
    await Promise.all(entries.map(([name, path]) => loadTexture(name, path)))
  }

  window.addEventListener('resize', fitCanvas)
  fitCanvas()
  loadAllTextures().then(loop)

  return {
    show(state: HudState) {
      currentState = state
      canvas.style.display = 'block'
    },
    hide() {
      canvas.style.display = 'none'
      currentState = null
    },
    dispose() {
      cancelAnimationFrame(rafId)
      window.removeEventListener('resize', fitCanvas)
      canvas.remove()
    }
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `npm run build`
Expected: 编译通过，无TypeScript错误

- [ ] **Step 3: 验证CSS缩放**

在浏览器中打开，验证：
- Canvas居中显示
- 窗口缩放时Canvas等比缩放
- 两侧/上下有黑边

- [ ] **Step 4: Commit**

```bash
git add src/ui/Hud.ts
git commit -m "feat(hud): 重写Hud.ts为1280×720画布+CSS缩放"
```
