// public/js/ui/cheatMenu.js — 作弊菜单 (fork, requirement 三: available in EVERY mode).
//
//   * 触发与激活 — ONE floating control (图四): while locked it is a small ball; typing CHEAT_CODE in the panel it is
//     attached to unlocks it. The activation code is a UI GATE, not a security boundary (it ships in this bundle) and
//     the server validates the ACTION only (shared/protocol.js).
//   * 悬浮球与面板是一体的 — the control MORPHS in place: closed it is the 悬浮球, clicking it turns it into the menu,
//     and the menu's ✕ turns it back into the ball at the same spot. The whole thing is DRAGGABLE in both states (the
//     ball itself, the panel's title bar) and the position is remembered (`PREF_POS`), clamped to the viewport on every
//     read so a position saved on a large screen cannot leave it off-screen on a small one.
//   * 菜单功能 — five rows sending `g.cheat`: 无限资金 (a switch, with the funds beside it), 复原资金, 商店满级,
//     免费刷新 +5, 盟约层数 +100. Server commands that touch the activating player's own state only ("谁开谁负责").
//   * 红色警告横幅 — CheatBanner renders the `m.cheat` broadcast the room receives the FIRST time a player uses a
//     cheat: `"<name>"纸尿裤兜不住了!!`.
//
// Styles: public/css/cheat.css (injected on first use when the page does not link it), same pattern as emotes.js.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { CHEAT_CODE, CHEAT_ACTIONS, CHEAT_INFINITE_FUNDS } from '../../../shared/constants.js';
import { html } from './components.js';
import { loadPref, savePref, useStore } from '../store.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

export const CHEAT_CSS_HREF = '/css/cheat.css';
export const PREF_UNLOCKED = 'cheatUnlocked';
/** The one remembered position of the whole control (viewport fractions), shared by the ball and the panel. */
export const PREF_POS = 'cheatPos';
/** Kept for callers written against the older two-position version (the ball had a pref of its own). */
export const PREF_BALL = PREF_POS;
export const PREF_PANEL = PREF_POS;
/** The banner stays up this long (the requirement only says it is raised once). */
export const CHEAT_BANNER_MS = 7000;
/** Where the control first appears (left of the HUD's own top-right corner, so the panel fits). */
export const CHEAT_HOME = Object.freeze({ x: 0.78, y: 0.1 });
/**
 * The panel's width as a fraction of the viewport — a fixed 3.02rem of the 19.2rem design width, so this is constant at
 * every size. The OPEN panel grows to the right of the shared anchor, so it is clamped by this: without it a position
 * saved for the small 悬浮球 (or a wide default) would push the menu off the right edge of the screen.
 */
export const CHEAT_PANEL_W = 0.17;

/**
 * Whether this device has already unlocked the drawer **for the current server session**. The `welcome` frame hands out
 * a new `playerId` when the server restarts (`main.js` notice: 「服务器会话已重置」, and the same comparison in
 * `store.js sessionResetNotice`), so keying the unlock on it gives exactly "输入一次就够了，直到下次服务器重启" —
 * closing and reopening the ball does not ask again, and a restarted server does.
 */
export const cheatUnlocked = (sessionId = undefined) => {
  const rec = loadPref(PREF_UNLOCKED, null);
  if (!rec || typeof rec !== 'object' || rec.ok !== true) return false;
  if (sessionId === undefined) return true;                    // caller does not track sessions
  return rec.session != null && rec.session === sessionId;
};
/** Remember an accepted activation code for the current server session. */
export const rememberCheatUnlock = (sessionId = null) => savePref(PREF_UNLOCKED, { ok: true, session: sessionId });
/** The activation code check, exported for tests: an exact match (surrounding blanks tolerated) unlocks. */
export const cheatCodeOk = (code) => String(code ?? '').trim() === CHEAT_CODE;
/** The five panel rows, in the panel's order (the labels are the requirement's own wording). */
export const CHEAT_BUTTONS = Object.freeze([
  { action: 'infiniteFunds', label: '无限资金', kind: 'switch', glyph: '¥', title: `资金不再被扣除（面板数字补到 ${CHEAT_INFINITE_FUNDS} 以上）` },
  { action: 'restoreFunds', label: '复原资金', kind: 'button', glyph: '↻', title: '恢复到开启无限资金之前的资金' },
  { action: 'maxShop', label: '商店满级', kind: 'button', glyph: '⛨', title: '调度中心直接升到最高级并重排货架' },
  { action: 'freeRefresh', label: '免费刷新 +5', kind: 'button', glyph: '↻', title: '增加 5 次免费刷新' },
  { action: 'bondLayers', label: '盟约层数 +100', kind: 'button', glyph: '◆', title: '当前已激活的每个盟约 +100 层' },
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
 * The one-piece 悬浮球 / 面板. `onCheat(action, on)` sends the intent (`ui/gameActions.js` actions.cheat).
 * @param {{ onCheat: (action: string, on?: boolean|null) => void, priv?: any, disabled?: boolean }} props
 *   `priv` = m.private (its `cheat.infiniteFunds` is the server's authoritative switch state; `priv.funds` is shown on
 *   the 无限资金 row, like the reference panel)
 */
export function CheatMenu({ onCheat, priv = null, disabled = false }) {
  useEffect(() => { ensureCheatCss(); }, []);
  // the code is asked for ONCE PER SERVER SESSION: unlocked while `me.playerId` stays the same, asked again after the
  // server restarts (which is what re-issues it)
  const sessionId = useStore((s) => s.me?.playerId ?? null);
  const [unlocked, setUnlocked] = useState(() => cheatUnlocked(sessionId));
  useEffect(() => { setUnlocked(cheatUnlocked(sessionId)); }, [sessionId]);
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [pos, setPos] = useState(() => clampPos(loadPref(PREF_POS, null), CHEAT_HOME));
  const drag = useRef(null);
  const infinite = !!priv?.cheat?.infiniteFunds;
  const funds = Number.isFinite(priv?.funds) ? Math.trunc(priv.funds) : null;

  const submitCode = () => {
    if (!cheatCodeOk(code)) return;
    setUnlocked(true);
    rememberCheatUnlock(sessionId);
    setCode('');
  };
  /** Close the drawer — it STAYS unlocked for this server session, so reopening the ball does not ask again. */
  const close = () => { setOpen(false); setCode(''); };

  // ONE drag handler for the whole control: the ball is its own handle, the panel is dragged by its title bar. A press
  // that starts ON a child button (✕ / i) never begins a drag, so the button keeps an ordinary click — capturing the
  // pointer there is what used to swallow the ✕. The handle itself is a <button> too, hence the `target !== currentTarget`
  // test: dragging BY the ball must still work.
  const startDrag = (e) => {
    if (e.button != null && e.button !== 0) return;
    if (e.target !== e.currentTarget && e.target && typeof e.target.closest === 'function' && e.target.closest('button, input')) return;
    const box = e.currentTarget.getBoundingClientRect();
    drag.current = { id: e.pointerId, dx: e.clientX - box.left, dy: e.clientY - box.top, moved: false };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.moved = true;
    const w = Math.max(1, globalThis.innerWidth || 1);
    const h = Math.max(1, globalThis.innerHeight || 1);
    setPos(clampPos({ x: (e.clientX - d.dx) / w, y: (e.clientY - d.dy) / h }, CHEAT_HOME));
  };
  const endDrag = (e) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.moved) return;               // a click, not a drag: the ball's onClick still opens the panel
    savePref(PREF_POS, pos);
    e.preventDefault();
  };
  const dragProps = {
    onPointerDown: startDrag, onPointerMove: onMove, onPointerUp: endDrag, onPointerCancel: endDrag,
  };
  // the open panel must stay on screen: it extends to the right of the ball's own anchor
  const shownX = Math.min(pos.x, open ? 0.98 - CHEAT_PANEL_W : 0.98);

  return html`<div class="cheat" style=${`left:${(shownX * 100).toFixed(3)}%; top:${(pos.y * 100).toFixed(3)}%`} data-testid="cheat-root">
    ${open ? html`<section class="cheat-panel" role="dialog" aria-label="作弊菜单" data-testid="cheat-panel">
      <header class="cheat-panel__bar" ...${dragProps}>
        <span class="cheat-panel__crown" aria-hidden="true">♛</span>
        <b class="cheat-panel__title">作弊菜单</b>
        <span class="cheat-panel__micro">CHEAT</span>
        <button type="button" class="cheat-panel__ico" aria-label="说明"
          title="作弊指令只影响你自己；本局第一次使用会向全房间播报一条红色警告">i</button>
        <button type="button" class="cheat-panel__ico cheat-panel__x" aria-label="关闭" title="收起为悬浮球"
          data-testid="cheat-close" onClick=${close}>✕</button>
      </header>
      ${unlocked ? html`<div class="cheat-panel__body">
        ${CHEAT_BUTTONS.map((b) => (b.kind === 'switch'
          ? html`<button key=${b.action} type="button" class=${cx('cheat-row', 'cheat-row--switch', infinite && 'is-on')}
              title=${b.title} data-testid=${`cheat-${b.action}`} disabled=${disabled}
              aria-pressed=${infinite ? 'true' : 'false'} onClick=${() => onCheat(b.action, !infinite)}>
              <span class="cheat-switch" aria-hidden="true"><i></i></span>
              <span class="cheat-row__label">${b.label}</span>
              ${funds != null ? html`<span class="cheat-row__value num">${funds}</span>` : null}
            </button>`
          : html`<button key=${b.action} type="button" class="cheat-row" title=${b.title}
              data-testid=${`cheat-${b.action}`} disabled=${disabled} onClick=${() => onCheat(b.action, null)}>
              <span class="cheat-row__glyph" aria-hidden="true">${b.glyph}</span>
              <span class="cheat-row__label">${b.label}</span>
            </button>`))}
      </div>` : html`<div class="cheat-panel__body cheat-panel__body--locked">
        <input class="cheat-code" type="password" value=${code} placeholder="输入激活码"
          aria-label="激活码" data-testid="cheat-code" autocomplete="off"
          onInput=${(e) => setCode(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter') submitCode(); }} />
        <button type="button" class="cheat-row cheat-row--go" onClick=${submitCode} disabled=${!cheatCodeOk(code)}>激活</button>
      </div>`}
      <footer class="cheat-panel__foot">拖拽标题栏移动</footer>
    </section>` : html`<button type="button" class=${cx('cheat-ball', !unlocked && 'is-locked')}
      title=${unlocked ? '作弊菜单（可拖动）' : '作弊菜单：点开输入激活码'}
      aria-label="作弊菜单" aria-expanded="false" data-testid="cheat-ball" ...${dragProps}
      onClick=${() => { if (!drag.current) setOpen(true); }}><span aria-hidden="true">${unlocked ? '♛' : '⚙'}</span></button>`}
  </div>`;
}

export { CHEAT_ACTIONS };
