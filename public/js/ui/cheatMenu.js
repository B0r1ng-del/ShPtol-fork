// public/js/ui/cheatMenu.js — 作弊菜单 (fork, requirement 三: available in EVERY mode).
//
//   * 触发与激活 — the 悬浮球 opens a panel; while locked the panel shows only the activation code input. Typing
//     CHEAT_CODE unlocks it and the unlock is remembered per device (loadPref/savePref). The code is a UI GATE, not a
//     security boundary: it ships in this bundle, and the server only validates the ACTION (shared/protocol.js).
//   * UI与交互 — the ball is DRAGGABLE and its position is remembered; the panel is DRAGGABLE by its title bar
//     ("拖拽标题栏移动"), also remembered. Both are clamped to the viewport on every render so a position saved on a
//     big screen cannot leave the ball off-screen on a small one.
//   * 菜单功能 — five controls sending `g.cheat`: 无限资金 (a switch), 复原资金, 商店满级, 免费刷新 +5, 盟约层数 +100.
//     They are server commands that touch the activating player's own state only (owner's call "谁开谁负责").
//   * 红色警告横幅 — CheatBanner renders the `m.cheat` broadcast the room receives the FIRST time a player uses a
//     cheat: `"<name>"纸尿裤兜不住了!!`.
//
// Styles: public/css/cheat.css (injected on first use when the page does not link it), same pattern as emotes.js.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { CHEAT_CODE, CHEAT_ACTIONS, CHEAT_INFINITE_FUNDS } from '../../../shared/constants.js';
import { html } from './components.js';
import { loadPref, savePref } from '../store.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const CHEAT_CSS_HREF = '/css/cheat.css';
export const PREF_UNLOCKED = 'cheatUnlocked';
export const PREF_BALL = 'cheatBall';
export const PREF_PANEL = 'cheatPanel';
/** The banner stays up this long (the requirement only says it is raised once). */
export const CHEAT_BANNER_MS = 7000;

/** Whether this device has already typed the activation code. */
export const cheatUnlocked = () => loadPref(PREF_UNLOCKED, false) === true;
/** The activation code check, exported for tests: an exact match unlocks. */
export const cheatCodeOk = (code) => String(code ?? '').trim() === CHEAT_CODE;
/** The five panel entries, in the panel's order (labels are the requirement's own wording). */
export const CHEAT_BUTTONS = Object.freeze([
  { action: 'infiniteFunds', label: '无限资金', kind: 'switch', title: `资金不再被扣除（面板数字补到 ${CHEAT_INFINITE_FUNDS}）` },
  { action: 'restoreFunds', label: '复原资金', kind: 'button', title: '恢复到开启无限资金之前的资金' },
  { action: 'maxShop', label: '商店满级', kind: 'button', title: '调度中心直接升到最高级并重排货架' },
  { action: 'freeRefresh', label: '免费刷新 +5', kind: 'button', title: '增加 5 次免费刷新' },
  { action: 'bondLayers', label: '盟约层数 +100', kind: 'button', title: '当前已激活的每个盟约 +100 层' },
]);

/** Link public/css/cheat.css once (dev harnesses); no-op outside a browser. */
export function ensureCheatCss(doc = globalThis.document) {
  if (!doc?.head || typeof doc.querySelector !== 'function') return false;
  const sel = `link[rel="stylesheet"][href$="${CHEAT_CSS_HREF}"]`;
  if (doc.querySelector(sel)) return false;
  const link = doc.createElement('link');
  link.rel = 'stylesheet';
  link.href = CHEAT_CSS_HREF;
  doc.head.appendChild(link);
  return true;
}

/** Clamp a remembered { x, y } (viewport fractions) into [0.02, 0.98]; a missing/garbage pref yields the fallback. */
export function clampPos(pos, fallback) {
  const p = pos && typeof pos === 'object' ? pos : null;
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(0.98, Math.max(0.02, v)) : d);
  return { x: num(p && p.x, fallback.x), y: num(p && p.y, fallback.y) };
}

/**
 * 红色警告横幅 (requirement 三): the `m.cheat` frame the room gets the first time a player uses a cheat. Shows the
 * newest one for CHEAT_BANNER_MS, then goes away.
 * @param {{ cheats?: any[] }} props `cheats` = store.cheats ({ seq, playerId, name, text, at })
 */
export function CheatBanner({ cheats = [] }) {
  const list = Array.isArray(cheats) ? cheats : [];
  const last = list.length ? list[list.length - 1] : null;
  const [, tick] = useState(0);
  useEffect(() => {
    if (!last) return undefined;
    const left = last.at + CHEAT_BANNER_MS - Date.now();
    if (left <= 0) return undefined;
    const t = setTimeout(() => tick((v) => v + 1), left + 30);
    return () => clearTimeout(t);
  }, [last && last.seq, last && last.at]);
  if (!last || Date.now() - last.at >= CHEAT_BANNER_MS) return null;
  return html`<div class="cheat-banner" role="alert" data-testid="cheat-banner">
    <span class="cheat-banner__mark">!</span>
    <span class="cheat-banner__text">${last.text || `"${last.name || '博士'}"纸尿裤兜不住了!!`}</span>
  </div>`;
}

/**
 * The 悬浮球 + panel. `onCheat(action, on)` sends the intent (`ui/gameActions.js` actions.cheat).
 * @param {{ onCheat: (action: string, on?: boolean|null) => void, priv?: any, disabled?: boolean }} props
 *   `priv` = m.private (its `cheat.infiniteFunds` is the server's authoritative switch state)
 */
export function CheatMenu({ onCheat, priv = null, disabled = false }) {
  useEffect(() => { ensureCheatCss(); }, []);
  const [unlocked, setUnlocked] = useState(cheatUnlocked);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [ball, setBall] = useState(() => clampPos(loadPref(PREF_BALL, null), { x: 0.93, y: 0.12 }));
  const [panel, setPanel] = useState(() => clampPos(loadPref(PREF_PANEL, null), { x: 0.66, y: 0.2 }));
  const drag = useRef(null);
  const infinite = !!priv?.cheat?.infiniteFunds;

  const submitCode = () => {
    if (!cheatCodeOk(code)) return;
    setUnlocked(true);
    savePref(PREF_UNLOCKED, true);
    setCode('');
  };

  // one pointer-drag helper for both the ball and the panel's title bar: the target is moved by viewport fractions
  const startDrag = (what) => (e) => {
    if (e.button != null && e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { what, id: e.pointerId, dx: e.clientX - box.left, dy: e.clientY - box.top, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.moved = true;
    const w = Math.max(1, globalThis.innerWidth || 1);
    const h = Math.max(1, globalThis.innerHeight || 1);
    const next = clampPos({ x: (e.clientX - d.dx) / w, y: (e.clientY - d.dy) / h }, { x: 0.5, y: 0.5 });
    if (d.what === 'ball') setBall(next); else setPanel(next);
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;
    savePref(d.what === 'ball' ? PREF_BALL : PREF_PANEL, d.what === 'ball' ? ball : panel);
    e.preventDefault();
  };

  return html`<div class="cheat">
    <button type="button" class=${cx('cheat-ball', !unlocked && 'is-locked', open && 'is-on')}
      style=${`left:${(ball.x * 100).toFixed(3)}%; top:${(ball.y * 100).toFixed(3)}%`}
      title=${unlocked ? '作弊菜单（可拖动）' : '作弊菜单：点开输入激活码'}
      aria-label="作弊菜单" aria-expanded=${open ? 'true' : 'false'} data-testid="cheat-ball"
      onPointerDown=${startDrag('ball')} onPointerMove=${onMove} onPointerUp=${endDrag} onPointerCancel=${endDrag}
      onClick=${() => { if (!drag.current) setOpen((v) => !v); }}>${unlocked ? '☠' : '⌘'}</button>
    ${open ? html`<section class="cheat-panel" role="dialog" aria-label="作弊菜单"
      style=${`left:${(panel.x * 100).toFixed(3)}%; top:${(panel.y * 100).toFixed(3)}%`} data-testid="cheat-panel">
      <header class="cheat-panel__bar" onPointerDown=${startDrag('panel')} onPointerMove=${onMove}
        onPointerUp=${endDrag} onPointerCancel=${endDrag}>
        <span class="cheat-panel__crown">♛</span>
        <b class="cheat-panel__title">作弊菜单</b>
        <span class="cheat-panel__micro">CHEAT</span>
        <button type="button" class="cheat-panel__x" aria-label="关闭" onClick=${() => setOpen(false)}>✕</button>
      </header>
      ${unlocked ? html`<div class="cheat-panel__body">
        ${CHEAT_BUTTONS.map((b) => (b.kind === 'switch'
          ? html`<button key=${b.action} type="button" class=${cx('cheat-row', 'cheat-row--switch', infinite && 'is-on')}
              title=${b.title} data-testid=${`cheat-${b.action}`} disabled=${disabled}
              aria-pressed=${infinite ? 'true' : 'false'} onClick=${() => onCheat(b.action, !infinite)}>
              <span class="cheat-row__label">${b.label}</span>
              <span class="cheat-switch" aria-hidden="true"><i></i></span>
            </button>`
          : html`<button key=${b.action} type="button" class="cheat-row" title=${b.title}
              data-testid=${`cheat-${b.action}`} disabled=${disabled} onClick=${() => onCheat(b.action, null)}>
              <span class="cheat-row__label">${b.label}</span>
            </button>`))}
      </div>` : html`<div class="cheat-panel__body cheat-panel__body--locked">
        <input class="cheat-code" type="password" value=${code} placeholder="输入激活码"
          aria-label="激活码" data-testid="cheat-code" autocomplete="off"
          onInput=${(e) => setCode(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') submitCode(); }} />
        <button type="button" class="cheat-row cheat-row--go" onClick=${submitCode} disabled=${!cheatCodeOk(code)}>激活</button>
      </div>`}
      <footer class="cheat-panel__foot">拖拽标题栏移动</footer>
    </section>` : null}
  </div>`;
}

export { CHEAT_ACTIONS };
