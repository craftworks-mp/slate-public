// Parlays: builds the cross-game parlay cards (pure functions; no DOM). Loaded before app.js; also required by tests/test_parlays.js.
// Leg in: { key, sp, gid, pid, name, team, label, odds (American), P (percent), ev (percent), kickoff (ISO), recheck, uncal, pick }
// Card out: { kind: 'flip'|'value'|'longshot', n, legs, dec, american, chance (percent), ev (percent) }
// notes(card) -> { pros: [sentence], weak: sentence|null }: plain sentences from the card's own numbers (user 10/31 23:59);
//   legs may also carry stat, side ('o'|'u'), line, proj, grade
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

  // ---- notes: why the card looks good on paper, plus its weak spot. Facts only, no advice words; wording follows the numbers ----
  const WORD = ['zero', 'one', 'two', 'three', 'four', 'five'];
  const cap = (x) => x.charAt(0).toUpperCase() + x.slice(1);
  const num = (n) => WORD[n] || String(n);
  const STAT_W = { pts: 'points', reb: 'rebounds', ast: 'assists', tpm: '3-pointers', pra: 'points + rebounds + assists', pr: 'points + rebounds',
    pa: 'points + assists', ra: 'rebounds + assists', sog: 'shots on goal', g: 'goals', a: 'assists' };
  const statW = (st) => STAT_W[st] || String(st || '').toUpperCase();
  const SUFFIX = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i;
  function lastName(name) {
    const w = String(name || '').trim().split(/\s+/);
    if (w.length < 2) return w[0] || '';
    return (SUFFIX.test(w[w.length - 1]) && w.length > 2 ? w[w.length - 2] : w[w.length - 1]).replace(/,$/, '');
  }
  const poss = (nm) => (/s$/i.test(nm) ? nm + '’' : nm + '’s');
  const fmtO = (o) => (o > 0 ? '+' : '−') + Math.abs(Math.round(o));
  const pct = (v) => v.toFixed(1) + '%';
  const fx = (v) => (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(1));
  const breakEven = (o) => 100 / decimal(o); // percent the price needs
  function notes(card) {
    const legs = (card && card.legs) || [], n = legs.length, pros = [];
    if (!n) return { pros, weak: null };
    // 1. price: what the payout needs vs the model's chance (chance > need whenever every leg has positive EV)
    const need = 100 / card.dec, ratio = card.chance / need;
    const how = ratio >= 1.25 ? 'comfortably above that, at' : ratio >= 1.08 ? 'above that, at' : 'a little above that, at';
    pros.push(`The book pays ${fmtO(card.american)}, which needs a ${pct(need)} hit rate; the model has it ${how} ${pct(card.chance)}.`);
    // 2. cushion: how far projections sit past their lines (over/under legs with a projection)
    const ou = legs.filter((l) => isNum(l.proj) && isNum(l.line) && l.line > 0 && (l.side === 'o' || l.side === 'u'))
      .map((l) => Object.assign({ gap: (l.side === 'u' ? l.line - l.proj : l.proj - l.line) / l.line }, { l }));
    const past = ou.filter((x) => x.gap > 0).sort((a, b) => b.gap - a.gap);
    if (past.length) {
      const t = past[0].l, at = `${lastName(t.name)} at ${fx(t.proj)} ${statW(t.stat)} against a ${fx(t.line)} line`;
      if (past.length === n) pros.push(`${n === 2 ? 'Both' : 'Every'} projection${n === 2 ? 's land' : ' lands'} on the right side of ${n === 2 ? 'their lines' : 'its line'}, led by ${at}.`);
      else pros.push(`${cap(num(past.length))} of the ${num(n)} projections clear${past.length === 1 ? 's' : ''} ${past.length === 1 ? 'its line' : 'their lines'}; the widest gap is ${at}.`);
    }
    // 3. grades (best first), else the strongest single-leg EV
    const ORDER = ['S+', 'A', 'B', 'C', 'D', 'F'];
    const gs = legs.map((l) => l.grade).filter((g) => ORDER.indexOf(g) >= 0);
    if (gs.length === n) {
      const groups = ORDER.map((g) => [g, gs.filter((x) => x === g).length]).filter((x) => x[1]);
      if (groups.length === 1) pros.push(`${n === 2 ? 'Both legs' : 'All ' + num(n) + ' legs'} grade ${groups[0][0]}.`);
      else pros.push(groups.map(([g, c], i) => (i ? `${num(c)} ${g}` : `${cap(num(c))} leg${c > 1 ? 's' : ''} grade${c > 1 ? '' : 's'} ${g}`)).join(', ').replace(/, ([^,]*)$/, ' and $1') + '.');
    } else {
      const top = legs.slice().sort((a, b) => b.ev - a.ev)[0];
      pros.push(`The strongest single leg is ${lastName(top.name)}${top.stat ? ' ' + statW(top.stat) + (top.side === 'u' ? ' under' : top.side === 'o' ? ' over' : '') : ''} at +${top.ev.toFixed(1)}% EV.`);
    }
    // weak spot: the leg with the least room over what its own price needs
    let weak = null;
    if (n >= 2) {
      const w = legs.map((l) => ({ l, room: l.P - breakEven(l.odds) })).sort((a, b) => a.room - b.room)[0], l = w.l;
      const mk = l.stat ? `${statW(l.stat)}${l.side === 'u' ? ' under' : l.side === 'o' ? ' over' : ''}` : 'leg';
      const tail = w.room <= 0.05 ? `right at the ${pct(breakEven(l.odds))} its ${fmtO(l.odds)} price needs` : w.room < 2 ? `only a little more than the ${pct(breakEven(l.odds))} its ${fmtO(l.odds)} price needs` : `${w.room.toFixed(1)} points above the ${pct(breakEven(l.odds))} its ${fmtO(l.odds)} price needs`;
      weak = `The weak spot is ${poss(lastName(l.name))} ${mk}: the model gives it ${Math.round(l.P)}%, ${tail}.`;
    }
    return { pros, weak };
  }

  root.PARLAY = { CFG, decimal, toAmerican, eligible, cardMath, build, notes, lastName };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PARLAY;
}(typeof window !== 'undefined' ? window : globalThis));
