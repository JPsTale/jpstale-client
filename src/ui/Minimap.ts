// src/ui/Minimap.ts

export interface MinimapData {
  mapImage: HTMLImageElement | null
  playerX: number
  playerZ: number
  playerAngle: number
  npcs: Array<{ x: number; z: number; isEnemy: boolean }>
}

export interface Minimap {
  draw(data: MinimapData): void
  show(): void
  hide(): void
  dispose(): void
}

export function createMinimap(container: HTMLElement): Minimap {
  const canvas = document.createElement('canvas')
  canvas.width = 128
  canvas.height = 128
  canvas.style.cssText = `
    position: fixed; top: 10px; right: 10px;
    border: 2px solid #555; pointer-events: none;
    background: rgba(0,0,0,0.7);
  `
  container.appendChild(canvas)

  const ctx = canvas.getContext('2d')!

  function draw(data: MinimapData) {
    ctx.clearRect(0, 0, 128, 128)
    
    ctx.fillStyle = 'rgba(0,0,0,0.7)'
    ctx.fillRect(0, 0, 128, 128)
    
    if (data.mapImage) {
      ctx.drawImage(data.mapImage, 0, 0, 128, 128)
    }
    
    for (const npc of data.npcs) {
      ctx.fillStyle = npc.isEnemy ? '#ff0000' : '#00ff00'
      ctx.fillRect(npc.x - 1, npc.z - 1, 2, 2)
    }
    
    ctx.save()
    ctx.translate(data.playerX, data.playerZ)
    ctx.rotate(data.playerAngle * Math.PI / 180)
    ctx.fillStyle = '#ffff00'
    ctx.beginPath()
    ctx.moveTo(0, -4)
    ctx.lineTo(-2, 2)
    ctx.lineTo(2, 2)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
  }

  return {
    draw,
    show: () => { canvas.style.display = 'block' },
    hide: () => { canvas.style.display = 'none' },
    dispose: () => canvas.remove()
  }
}
