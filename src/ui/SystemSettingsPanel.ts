// src/ui/SystemSettingsPanel.ts
// 系统设置面板（对应 HUD b5 "system" 按钮）—— 目前只有音频控制；后续加画质/操作等
import { mapAudio } from '../maps/map-audio.js'

export interface SystemSettingsPanelOptions {
  /** 打开键位设置子面板（原系统键位入口） */
  onOpenKeyBindings?: () => void
}

export interface SystemSettingsPanel {
  show(): void
  hide(): void
  dispose(): void
}

const ROW_STYLE = `
  display:flex; justify-content:space-between; align-items:center;
  padding:6px 0; border-bottom:1px solid #333; gap:12px;
`

function makeChannelRow(
  title: string,
  getOn: () => boolean,
  setOn: (on: boolean) => void,
  getLevel: () => number,
  setLevel: (v: number) => void,
): HTMLElement {
  const row = document.createElement('div')
  row.style.cssText = ROW_STYLE

  const label = document.createElement('span')
  label.textContent = title
  label.style.minWidth = '96px'

  const toggle = document.createElement('input')
  toggle.type = 'checkbox'
  toggle.checked = getOn()
  toggle.style.width = '16px'
  toggle.style.height = '16px'
  toggle.style.accentColor = '#f0c040'

  const slider = document.createElement('input')
  slider.type = 'range'
  slider.min = '0'
  slider.max = '1'
  slider.step = '0.05'
  slider.value = String(getLevel())
  slider.style.flex = '1'
  slider.disabled = !getOn()

  toggle.onchange = () => {
    const on = toggle.checked
    slider.disabled = !on
    setOn(on)
  }
  slider.oninput = () => setLevel(Number(slider.value))

  row.appendChild(label)
  row.appendChild(slider)
  row.appendChild(toggle)
  return row
}

export function createSystemSettingsPanel(
  container: HTMLElement,
  opts: SystemSettingsPanelOptions = {},
): SystemSettingsPanel {
  const overlay = document.createElement('div')
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 1000;
    display: none; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.85);
  `

  const content = document.createElement('div')
  content.style.cssText = `
    background: #0a0a1a; border: 2px solid #f0c040;
    padding: 20px; min-width: 380px; color: #e0d8c8;
  `
  content.innerHTML = '<h2 style="color:#f0c040;margin:0 0 16px">系统设置</h2>'

  const sectionTitle = (s: string) => {
    const el = document.createElement('div')
    el.textContent = s
    el.style.cssText = 'color:#f0c040;font-weight:bold;margin:12px 0 4px'
    return el
  }

  content.appendChild(sectionTitle('声音'))
  content.appendChild(makeChannelRow('背景音乐', () => mapAudio.bgmOn, (o) => mapAudio.setBgmOn(o), () => mapAudio.bgmLevel, (v) => mapAudio.setBgmLevel(v)))
  content.appendChild(makeChannelRow('环境音效', () => mapAudio.ambOn, (o) => mapAudio.setAmbOn(o), () => mapAudio.ambLevel, (v) => mapAudio.setAmbLevel(v)))
  content.appendChild(makeChannelRow('场景音效', () => mapAudio.effOn, (o) => mapAudio.setEffOn(o), () => mapAudio.effLevel, (v) => mapAudio.setEffLevel(v)))

  const buttons = document.createElement('div')
  buttons.style.cssText = 'display:flex;gap:8px;margin-top:16px;justify-content:flex-end'

  const kbBtn = document.createElement('button')
  kbBtn.textContent = '键位设置'
  kbBtn.onclick = () => opts.onOpenKeyBindings?.()

  const closeBtn = document.createElement('button')
  closeBtn.textContent = '关闭'
  closeBtn.style.cssText = 'background:#f0c040;color:#000'
  closeBtn.onclick = () => overlay.style.display = 'none'

  buttons.appendChild(kbBtn)
  buttons.appendChild(closeBtn)
  content.appendChild(buttons)

  overlay.appendChild(content)
  container.appendChild(overlay)

  return {
    show: () => { overlay.style.display = 'flex' },
    hide: () => { overlay.style.display = 'none' },
    dispose: () => overlay.remove(),
  }
}