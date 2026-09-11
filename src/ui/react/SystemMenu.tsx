import { useEffect, useState } from 'react';
import { t } from '../../i18n/index.js';
import { mapAudio } from '../../maps/map-audio.js';
import { closeSystemMenu } from '../../app/gameStore.js';
import { KeyBinding, GameAction } from '../KeyBinding.js';

// 系统菜单（X 键）：居中模态 + 纵向主菜单逐级进入。
// 主菜单：回到角色选择 / 退出登录 / 音效设置 / 画面设置 / 键位设置 / 功能设置。
// 子页：音效(现可用)、键位(现可用)；画面/功能 只留入口占位（后续开发）。
export interface SystemMenuSettings {
  keyBinding: KeyBinding;
  onBackToCharSelect?: () => void;
  onLogout?: () => void;
  /** 客户端帧率上限（0=不限制/跟随显示器）；画面设置里可调 */
  getFps?: () => number;
  setFps?: (fps: number) => void;
}

type SubPage = 'main' | 'audio' | 'keys' | 'video' | 'function';

// 画面设置：帧率档位（0=不限制）
const FPS_OPTIONS: number[] = [30, 60, 120, 0];

function VideoPage({ settings }: { settings: SystemMenuSettings }) {
  const [fps, setFpsState] = useState(settings.getFps?.() ?? 0);
  return (
    <div className="jp-men-page">
      <div className="jp-men-row">
        <span className="jp-men-key-label">{t('menu.fps')}</span>
        <div className="jp-men-opts">
          {FPS_OPTIONS.map((v) => (
            <button
              key={v}
              type="button"
              className={fps === v ? 'jp-men-opt jp-men-opt--on' : 'jp-men-opt'}
              onClick={() => { setFpsState(v); settings.setFps?.(v); }}
            >
              {v === 0 ? t('menu.fpsUnlimited') : String(v)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function AudioRow({
  title, getOn, setOn, getLevel, setLevel,
}: {
  title: string; getOn: () => boolean; setOn: (v: boolean) => void;
  getLevel: () => number; setLevel: (v: number) => void;
}) {
  const [on, setOnState] = useState(getOn());
  const [lv, setLvState] = useState(getLevel());
  return (
    <div className="jp-men-audio">
      <div className="jp-men-audio-head">
        <span>{title}</span>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => { setOnState(e.target.checked); setOn(e.target.checked); }}
        />
      </div>
      <input
        type="range" min={0} max={1} step={0.05}
        value={lv}
        disabled={!on}
        onChange={(e) => { const v = Number(e.target.value); setLvState(v); setLevel(v); }}
      />
    </div>
  );
}

// 键位设置子页：逐行动态监听按键（复用 KeyBinding 存储）
function KeyBindPage({ keyBinding }: { keyBinding: KeyBinding }) {
  const [bindings, setBindings] = useState(keyBinding.getAll());
  const [capture, setCapture] = useState<GameAction | null>(null);

  useEffect(() => {
    if (!capture) return;
    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      keyBinding.set(capture, e.code);
      setBindings(keyBinding.getAll());
      setCapture(null);
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [capture, keyBinding]);

  return (
    <div className="jp-men-page">
      <div className="jp-men-keys">
        {Object.keys(ACTION_LABELS).map((action) => (
          <div className="jp-men-key-row" key={action}>
            <span className="jp-men-key-label">{t(ACTION_LABELS[action])}</span>
            <button
              className={capture === action ? 'jp-men-key jp-men-key--capture' : 'jp-men-key'}
              onClick={() => setCapture(action as GameAction)}
            >
              {capture === action ? '...' : (bindings[action as GameAction] ?? t('menu.none'))}
            </button>
          </div>
        ))}
      </div>
      <div className="jp-men-foot">
        <button className="jp-men-btn" onClick={() => {
          keyBinding.reset();
          setBindings(keyBinding.getAll());
        }}>
          {t('menu.reset')}
        </button>
        <button className="jp-men-btn" onClick={() => {
          keyBinding.save();
          closeSystemMenu();
        }}>
          {t('menu.save')}
        </button>
      </div>
    </div>
  );
}

const ACTION_LABELS: Record<string, string> = {
  moveForward: 'menu.bind.moveForward', moveBackward: 'menu.bind.moveBackward',
  moveLeft: 'menu.bind.moveLeft', moveRight: 'menu.bind.moveRight',
  attack: 'menu.bind.attack', skill: 'menu.bind.skill',
  walkRun: 'menu.bind.walkRun', cameraMode: 'menu.bind.cameraMode', minimap: 'menu.bind.minimap',
  status: 'menu.bind.status', skillPanel: 'menu.bind.skillPanel', inventory: 'menu.bind.inventory',
  party: 'menu.bind.party', quest: 'menu.bind.quest', system: 'menu.bind.system',
  showGroundItems: 'menu.bind.showGroundItems',
  skill1: 'menu.bind.skill1', skill2: 'menu.bind.skill2', skill3: 'menu.bind.skill3', skill4: 'menu.bind.skill4',
  skill5: 'menu.bind.skill5', skill6: 'menu.bind.skill6', skill7: 'menu.bind.skill7', skill8: 'menu.bind.skill8',
  skill9: 'menu.bind.skill9', skill10: 'menu.bind.skill10', skill11: 'menu.bind.skill11', skill12: 'menu.bind.skill12',
  potion1: 'menu.bind.potion1', potion2: 'menu.bind.potion2', potion3: 'menu.bind.potion3',
  potion4: 'menu.bind.potion4', potion5: 'menu.bind.potion5', potion6: 'menu.bind.potion6',
  potion7: 'menu.bind.potion7', potion8: 'menu.bind.potion8', potion9: 'menu.bind.potion9',
  potion10: 'menu.bind.potion10', potion11: 'menu.bind.potion11', potion12: 'menu.bind.potion12',
  chat: 'menu.bind.chat', closePanel: 'menu.bind.closePanel',
};

function MenBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button className="jp-men-main-btn" onClick={onClick}>{label}</button>
  );
}

export default function SystemMenu({ settings }: { settings: SystemMenuSettings }) {
  const [page, setPage] = useState<SubPage>('main');

  function close() { if (page === 'main') closeSystemMenu(); else setPage('main'); }

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Escape') { e.stopPropagation(); close(); }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  });

  return (
    <div className="jp-overlay jp-menu-overlay" onClick={close}>
      <div className="jp-panel jp-menu" onClick={(e) => e.stopPropagation()}>
        <header className="jp-panel-head">
          <span className="jp-panel-title">{page === 'main' ? t('menu.title') : t('menu.back')}</span>
          <button type="button" className="jp-panel-close" onClick={close}>×</button>
        </header>
        <div className="jp-panel-body">
          {page === 'main' && (
            <div className="jp-men-main">
              <MenBtn label={t('menu.backToChar')} onClick={() => settings.onBackToCharSelect?.()} />
              <MenBtn label={t('menu.logout')} onClick={() => settings.onLogout?.()} />
              <div className="jp-men-sep" />
              <MenBtn label={t('menu.audio')} onClick={() => setPage('audio')} />
              <MenBtn label={t('menu.video')} onClick={() => setPage('video')} />
              <MenBtn label={t('menu.keys')} onClick={() => setPage('keys')} />
              <MenBtn label={t('menu.function')} onClick={() => setPage('function')} />
            </div>
          )}
          {page === 'audio' && (
            <div className="jp-men-page">
              <AudioRow title={t('menu.bgm')} getOn={() => mapAudio.bgmOn} setOn={(v) => mapAudio.setBgmOn(v)} getLevel={() => mapAudio.bgmLevel} setLevel={(v) => mapAudio.setBgmLevel(v)} />
              <AudioRow title={t('menu.amb')} getOn={() => mapAudio.ambOn} setOn={(v) => mapAudio.setAmbOn(v)} getLevel={() => mapAudio.ambLevel} setLevel={(v) => mapAudio.setAmbLevel(v)} />
              <AudioRow title={t('menu.eff')} getOn={() => mapAudio.effOn} setOn={(v) => mapAudio.setEffOn(v)} getLevel={() => mapAudio.effLevel} setLevel={(v) => mapAudio.setEffLevel(v)} />
            </div>
          )}
          {page === 'video' && <VideoPage settings={settings} />}
          {page === 'keys' && <KeyBindPage keyBinding={settings.keyBinding} />}
          {page === 'function' && (
            <div className="jp-men-page jp-men-func">
              <p className="jp-nodata">{t('menu.comingSoon')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}