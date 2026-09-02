// src/ui/KeyBindingPanel.ts
import { KeyBinding, GameAction } from './KeyBinding'

const ACTION_LABELS: Record<GameAction, string> = {
  moveForward: '向前移动',
  moveBackward: '向后移动',
  moveLeft: '向左移动',
  moveRight: '向右移动',
  attack: '攻击',
  skill: '技能',
  walkRun: '走路/跑步',
  cameraMode: '相机模式',
  minimap: '小地图',
  status: '角色状态',
  skillPanel: '技能面板',
  inventory: '背包面板',
  party: '组队窗口',
  quest: '任务窗口',
  system: '系统菜单',
  showGroundItems: '显示地面物品',
  skill1: '技能1', skill2: '技能2', skill3: '技能3', skill4: '技能4',
  skill5: '技能5', skill6: '技能6', skill7: '技能7', skill8: '技能8',
  skill9: '技能9', skill10: '技能10', skill11: '技能11', skill12: '技能12',
  potion1: '药水1', potion2: '药水2', potion3: '药水3',
  potion4: '药水4', potion5: '药水5', potion6: '药水6',
  potion7: '药水7', potion8: '药水8', potion9: '药水9',
  potion10: '药水10', potion11: '药水11', potion12: '药水12',
  chat: '聊天输入',
  closePanel: '关闭面板',
}

export interface KeyBindingPanel {
  show(): void
  hide(): void
  dispose(): void
}

export function createKeyBindingPanel(container: HTMLElement, keyBinding: KeyBinding): KeyBindingPanel {
  const panel = document.createElement('div')
  panel.style.cssText = `
    position: fixed; inset: 0; z-index: 1000;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.85);
  `

  const content = document.createElement('div')
  content.style.cssText = `
    background: #0a0a1a; border: 2px solid #f0c040;
    padding: 20px; max-height: 80vh; overflow-y: auto;
    min-width: 400px; color: #e0d8c8;
  `
  content.innerHTML = '<h2 style="color:#f0c040;margin:0 0 16px">键位设置</h2>'

  const bindings = keyBinding.getAll()
  const rows: { action: GameAction; keyEl: HTMLDivElement }[] = []

  for (const [action, key] of Object.entries(bindings)) {
    const row = document.createElement('div')
    row.style.cssText = 'display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid #333'

    const label = document.createElement('span')
    label.textContent = ACTION_LABELS[action as GameAction]

    const keyEl = document.createElement('div')
    keyEl.textContent = key || '未绑定'
    keyEl.style.cssText = `
      padding: 2px 8px; cursor: pointer;
      background: #1a1a2a; border: 1px solid #555;
      min-width: 80px; text-align: center;
    `
    keyEl.onclick = () => {
      keyEl.textContent = '请按键...'
      keyEl.style.borderColor = '#f0c040'
      const handler = (e: KeyboardEvent) => {
        e.preventDefault()
        keyBinding.set(action as GameAction, e.code)
        keyEl.textContent = e.code
        keyEl.style.borderColor = '#555'
        window.removeEventListener('keydown', handler)
      }
      window.addEventListener('keydown', handler)
    }

    row.appendChild(label)
    row.appendChild(keyEl)
    content.appendChild(row)
    rows.push({ action: action as GameAction, keyEl })
  }

  const buttons = document.createElement('div')
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end'

  const resetBtn = document.createElement('button')
  resetBtn.textContent = '重置默认'
  resetBtn.onclick = () => {
    keyBinding.reset()
    for (const row of rows) {
      row.keyEl.textContent = keyBinding.get(row.action) || '未绑定'
    }
  }

  const saveBtn = document.createElement('button')
  saveBtn.textContent = '保存'
  saveBtn.style.cssText = 'background:#f0c040;color:#000'
  saveBtn.onclick = () => {
    keyBinding.save()
    panel.style.display = 'none'
  }

  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = '取消'
  cancelBtn.onclick = () => {
    keyBinding.load()
    for (const row of rows) {
      row.keyEl.textContent = keyBinding.get(row.action) || '未绑定'
    }
    panel.style.display = 'none'
  }

  buttons.appendChild(resetBtn)
  buttons.appendChild(saveBtn)
  buttons.appendChild(cancelBtn)
  content.appendChild(buttons)

  panel.appendChild(content)
  container.appendChild(panel)

  return {
    show: () => { panel.style.display = 'flex' },
    hide: () => { panel.style.display = 'none' },
    dispose: () => panel.remove()
  }
}
