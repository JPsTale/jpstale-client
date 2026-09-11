/**
 * 音频偏好 —— localStorage 持久化，滑块值 0..1 为倍率。
 *
 * 由 maps/map-audio.ts（BGM / 环境音 / 对象声源）与 audio/sfx.ts（音效）共用，
 * 避免两处各自读写同一个 key 而互相覆盖。
 */
export interface AudioPrefs {
  /** BGM 开关 / 音量 */
  bgmOn: boolean; bgmLevel: number;
  /** 环境音开关 / 音量 */
  ambOn: boolean; ambLevel: number;
  /** 场景对象声源开关 / 音量 */
  effOn: boolean; effLevel: number;
  /** 界面与战斗音效开关 / 音量 */
  sfxOn: boolean; sfxLevel: number;
}

const KEY = 'pt.audio.prefs';

export const audioPrefs: AudioPrefs = {
  bgmOn: true, bgmLevel: 1,
  ambOn: true, ambLevel: 1,
  effOn: true, effLevel: 1,
  sfxOn: true, sfxLevel: 1,
};

function load(): void {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}') as Record<string, unknown>;
    for (const key of Object.keys(audioPrefs) as Array<keyof AudioPrefs>) {
      const v = raw[key];
      if (typeof v === 'boolean' && typeof audioPrefs[key] === 'boolean') {
        (audioPrefs[key] as boolean) = v;
      } else if (typeof v === 'number' && typeof audioPrefs[key] === 'number') {
        (audioPrefs[key] as number) = Math.min(1, Math.max(0, v));
      }
    }
  } catch { /* 损坏则用默认值 */ }
}

export function saveAudioPrefs(): void {
  try { localStorage.setItem(KEY, JSON.stringify(audioPrefs)); } catch { /* ignore */ }
}

load();
