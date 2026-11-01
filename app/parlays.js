// Parlays: builds the cross-game parlay cards (pure functions; no DOM). Loaded before app.js; also required by tests/test_parlays.js.
// Leg in: { key, sp, gid, pid, name, team, label, odds (American), P (percent), ev (percent), kickoff (ISO), recheck, uncal, pick }
// Card out: { kind: 'flip'|'value'|'longshot', n, legs, dec, american, chance (percent), ev (percent) }
(function (root) {
  'use strict';
  // Everything tunable lives here.
  const CFG = {
    minEv: 0,            // leg EV must be above this (percent, exclusive)
    maxEv: 8,            // leg EV must be at or below this (percent): EV over 8% is almost never genuine
    cards: [             // built in this order, each greedily from the legs left after the earlier cards
      { kind: 'flip', n: 2, by: 'P' },
      { kind: 'flip', n: 3, by: 'P' },
      { kind: 'value', n: 3, by: 'ev' },
      { kind: 'longshot', n: 4, by: 'ev' },
      { kind: 'longshot', n: 5, by: 'ev' },
    ],
  };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const decimal = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / (-o));
  const toAmerican = (dec) => Math.round(dec >= 2 ? (dec - 1) * 100 : -100 / (dec - 1));

  function eligible(l, nowMs, cfg) {
    if (!l || l.pick === false || l.uncal || l.recheck) return false;
    if (!isNum(l.odds) || !isNum(l.P) || !isNum(l.ev) || Math.abs(l.odds) < 100) return false;
    if (!(l.ev > cfg.minEv && l.ev <= cfg.maxEv)) return false;
    const k = l.kickoff ? new Date(l.kickoff).getTime() : NaN;
    return isFinite(k) && k > nowMs;
  }
  function cardMath(legs) {
    let dec = 1, chance = 1, evf = 1;
    legs.forEach((l) => { dec *= decimal(l.odds); chance *= l.P / 100; evf *= 1 + l.ev / 100; });
    return { dec, american: toAmerican(dec), chance: chance * 100, ev: (evf - 1) * 100 };
  }
  const gameOf = (l) => l.sp + '|' + l.gid;
  const playerOf = (l) => l.sp + '|' + l.pid;
  function build(legs, now, cfg) {
    const c = Object.assign({}, CFG, cfg || {});
    const nowMs = now instanceof Date ? now.getTime() : (isNum(now) ? now : new Date(now).getTime());
    const pool = (legs || []).filter((l) => eligible(l, nowMs, c));
    const usedPlayers = new Set(), out = [];
    c.cards.forEach((spec) => {
      const other = spec.by === 'P' ? 'ev' : 'P';
      const sorted = pool.slice().sort((x, y) => y[spec.by] - x[spec.by] || y[other] - x[other] || (String(x.key) < String(y.key) ? -1 : String(x.key) > String(y.key) ? 1 : 0));
      const games = new Set(), picked = [];
      for (const l of sorted) {
        if (picked.length >= spec.n) break;
        if (games.has(gameOf(l)) || usedPlayers.has(playerOf(l))) continue;
        games.add(gameOf(l)); picked.push(l);
      }
      if (picked.length < spec.n) return; // short: skip the card, never shorten it
      picked.forEach((l) => usedPlayers.add(playerOf(l)));
      out.push(Object.assign({ kind: spec.kind, n: spec.n, legs: picked }, cardMath(picked)));
    });
    return out;
  }

  root.PARLAY = { CFG, decimal, toAmerican, eligible, cardMath, build };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PARLAY;
}(typeof window !== 'undefined' ? window : globalThis));
