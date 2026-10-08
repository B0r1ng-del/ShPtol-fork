// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard) and the rolls the meta effects ask for — bounties (addBounty), item ids (rollItemId) and
// choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, applyCard, bountyBattles, isMultiRoundBounty } from '../choices.js';
import { weightedPick } from '../waves.js';
import { botPickCard } from '../bot.js';
import { OK, fail, DELAYS } from './common.js';

export class MatchSpDraft {
  enterSpDraft() {
    const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId, bondAvailable: (bondId) => this.bondLive(bondId) });
    const alive = this.alivePlayers();
    if (!draft || !alive.length) { this.enterPrep(); return; }
    this.phase = PHASE.SP_DRAFT;
    const order = alive.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay. A MODE may switch the
    // whole draft untimed and parallel and offer the random-allocation vote (fork 二.4 — GameData.spDraftRules).
    const rules = this.gd.spDraftRules;
    const untimed = this.soloUntimed || rules.untimed;
    this.sp = {
      ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0,
      parallel: rules.parallel, randomOffer: rules.randomFamilies, randomVotes: new Set(), randomResolved: false,
    };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
  }

  /**
   * The 机变 draft rules of the mode (`GameData.spDraftRules`; fork 二.4): `untimed`, `parallel` and
   * `randomFamilies` — all off for every official mode, which keeps the sequential timed draft exactly as it was.
   */
  get spRules() { return this.gd.spDraftRules; }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    // a parallel draft has no turn: the "current" player is simply the first one still to act (the bot scheduler
    // and the client's turn cue read this, nothing gates a pick on it)
    if (s.parallel) return s.order.find((pid) => !this.spDone(pid)) ?? null;
    return s.order[s.idx] ?? null;
  }

  /** Whether a player has finished its 机变 turn: it picked a card, or (parallel) it voted for the random draw. */
  spDone(playerId) {
    const s = this.sp;
    if (!s) return true;
    return s.picks[playerId] != null || (s.parallel && s.randomVotes.has(playerId));
  }

  startSpTurn() {
    const s = this.sp;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    if (s.parallel) {
      // 二.4: no clock — everyone decides at once and the draft ends when every alive player has picked or voted
      this.setDeadline(0);
      const available = s.cards.map((c) => c.idx).filter((i) => s.taken[i] == null);
      const pending = s.order.map((pid) => this.players.get(pid)).filter((ps) => ps && ps.alive && !this.spDone(ps.playerId));
      if (!pending.length || !available.length) { this.later(0, () => this.finishSpDraft()); return; }
      for (const ps of pending) if (ps.botControlled) this.scheduleSpBot(ps.playerId);
      this.markPublic();
      return;
    }
    const token = ++this._turnToken;
    while (s.idx < s.order.length) {
      const ps = this.players.get(s.order[s.idx]);
      if (ps && ps.alive && s.picks[ps.playerId] == null) break;
      s.idx++;
    }
    const available = s.cards.map((c) => c.idx).filter((i) => s.taken[i] == null);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.map((c) => c.idx).filter((i) => s.taken[i] == null);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  /** The AI seat `playerId` (default: the current turn) takes its 机变 action. */
  scheduleSpBot(playerId = this.spTurn()) {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || !this.sp) return;
      const ps = this.players.get(playerId);
      if (!ps || !ps.botControlled || this.spDone(ps.playerId)) return;
      // the sequential draft keeps the turn token / turn rule; a parallel one only needs the player to be pending
      if (!this.sp.parallel && (token !== this._turnToken || this.spTurn() !== ps.playerId)) return;
      const avail = this.sp.cards.map((c) => c.idx).filter((i) => this.sp.taken[i] == null);
      if (!avail.length) return;
      this._applyCard(ps, botPickCard(this, ps, this.sp.cards, avail));
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    // a parallel draft (fork 二.4) accepts every pick at any time; the sequential one keeps the turn rule
    if (!this.sp.parallel && this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (this.sp.taken[idx] != null) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  /**
   * 机变 随机分配 vote (fork 二.4): the player votes for the random allocation instead of picking a card. As soon as
   * HALF of the alive players have voted (`votes × 2 ≥ alive`) the system hands the cards out at random — one per
   * alive player, over their own pick — and the round moves on; below that every player keeps the card it picked.
   * Refused unless the mode offers the vote, and never in a 悬赏决策 draft ("悬赏类不要添加随机机制").
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  voteRandomChoice(ps) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const s = this.sp;
    if (!s.parallel || !s.randomOffer || !this.randomVoteOffered()) return fail(ERR.WRONG_PHASE, '随机分配 is not offered in this 机变'); // i18n-ignore (developer diagnostic)
    if (s.randomVotes.has(ps.playerId) || s.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    s.randomVotes.add(ps.playerId);
    this.markPublic();
    if (this.voteRandomReached()) { this.resolveRandomChoice(); return OK; }
    this.startSpTurn();
    return OK;
  }

  /** Whether this draft offers the vote at all: the mode lists the family, and the family is never 悬赏. */
  randomVoteOffered() {
    const s = this.sp;
    if (!s || !s.randomOffer) return false;
    return s.family !== 'bounty' && s.randomOffer.includes(s.family);
  }

  /** Whether HALF of the alive players (inclusive) have voted for the random allocation. */
  voteRandomReached() {
    const s = this.sp;
    if (!s) return false;
    const alive = this.alivePlayers().length;
    return alive > 0 && s.randomVotes.size * 2 >= alive;
  }

  /** Whether the random draw may hand `card` out: a listed family, and never a 悬赏 card. */
  randomChoiceEligible(card) {
    const s = this.sp;
    if (!s || !s.randomOffer || !card) return false;
    if (card.family === 'bounty') return false; // 悬赏 adds its enemies to the PICKER's own battles — never handed out
    return s.randomOffer.includes(card.family);
  }

  /**
   * Hand the draft's random-eligible cards out, one per alive player, in a shuffled order — the picker's own choice is
   * overridden, which is the point of the vote. Every player still gets at most one card, and the pick/taken maps stay
   * consistent for the audit.
   */
  resolveRandomChoice() {
    const s = this.sp;
    if (!s || s.randomResolved) return;
    s.randomResolved = true;
    const alive = this.alivePlayers().filter((p) => p.alive);
    const pool = s.cards.filter((c) => s.taken[c.idx] == null && this.randomChoiceEligible(c));
    this.rngDraft.shuffle(alive);
    this.rngDraft.shuffle(pool);
    const n = Math.min(pool.length, alive.length);
    for (let k = 0; k < n; k++) {
      const ps = alive[k];
      const card = pool[k];
      s.picks[ps.playerId] = card.idx;
      s.taken[card.idx] = ps.playerId;
      try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
      this.markPrivate(ps);
    }
    this.markPublic();
    this.finishSpDraft();
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || s.taken[idx] != null) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    this.startSpTurn();
  }

  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    this.enterPrep();
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items. */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6 } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]));
        let total = 0;
        for (const [, w] of pairs) total += Math.max(0, Number(w) || 0);
        let r = rng() * total;
        for (const [id, w] of pairs) { r -= Math.max(0, Number(w) || 0); if (r < 0) return id; }
        return pairs.length ? pairs[pairs.length - 1][0] : null;
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return items.length ? items[Math.floor(rng() * items.length)] : null;
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return list.length ? list[Math.floor(rng() * list.length)] : null;
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return list.length ? list[Math.floor(rng() * list.length)] : null;
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !this.pool.has(base) || this.pool.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = this.pool.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
