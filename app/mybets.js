// My Bets: storage, grading, backup (pure functions; no DOM). Loaded before app.js; also required by tests/test_mybets.js.
// Store (localStorage key sp.mybets.v1): { schema: 1, bets: { <betId>: { id, sport, date, gid, type, market, side, line, odds, units, label,
//   team, opp, addedAt, oddsEdited, status: open|W|L|P|void, settledAt, pl, grade?, uncal?, note? } } }
// Parlays (owner 11/12): type 'parlay', id 'parlay-<time>', legs: [{ id, sport, date, type: prop|game, market, side, line, odds, label, gid, away, home, team, start }],
//   odds = the combined price (auto from the legs, or the book's own number when oddsEdited). Each leg grades against its own results row.
// betId is the slate bet id; the published results file keys its rows by the same id.
(function (root) {
  'use strict';
  const KEY = 'sp.mybets.v1';
  const SCHEMA = 1;
  const UNIT_CHOICES = [0.5, 1, 1.5, 2];
  const STATUSES = ['open', 'W', 'L', 'P', 'void'];
  const SPORTS = ['nfl', 'nba', 'nhl'];
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const emptyStore = () => ({ schema: SCHEMA, bets: {} });

  // ---- storage (every access guarded: the app works when storage throws or is full) ----
  function getStorage() { try { return root.localStorage || null; } catch (e) { return null; } }
  function validBet(b) {
    return !!b && typeof b === 'object' && typeof b.id === 'string' && b.id.length > 0 && b.id.length < 200
      && SPORTS.includes(b.sport) && /^\d{4}-\d{2}-\d{2}$/.test(String(b.date || ''))
      && (b.type === 'prop' || b.type === 'game' || (b.type === 'parlay' && validLegs(b.legs))) && isNum(b.odds) && Math.abs(b.odds) >= 100
      && isNum(b.units) && b.units > 0 && b.units <= 100 && (b.line === null || b.line === undefined || isNum(b.line))
      && STATUSES.includes(b.status || 'open');
  }
  function validLegs(legs) {
    return Array.isArray(legs) && legs.length >= 2 && legs.length <= 12 && legs.every((l) => l && typeof l.id === 'string' && SPORTS.includes(l.sport)
      && /^\d{4}-\d{2}-\d{2}$/.test(String(l.date || '')) && (l.type === 'prop' || l.type === 'game') && isNum(l.odds) && Math.abs(l.odds) >= 100
      && (l.line === null || l.line === undefined || isNum(l.line)));
  }
  function cleanLeg(l) {
    const o = { id: l.id, sport: l.sport, date: l.date, type: l.type, market: String(l.market || ''), side: String(l.side || ''), line: isNum(l.line) ? l.line : null,
      odds: l.odds, label: String(l.label || '') };
    ['gid', 'away', 'home', 'team', 'opp', 'start', 'pid'].forEach((k) => { if (l[k] !== undefined && l[k] !== null && l[k] !== '') o[k] = String(l[k]); });
    if (l.res && ['W', 'L', 'P', 'void'].includes(l.res)) o.res = l.res;
    return o;
  }
  function cleanBet(b) { // keep known fields only; defaults for the optional ones
    const o = {
      id: b.id, sport: b.sport, date: b.date, gid: b.gid == null ? '' : String(b.gid), type: b.type, market: String(b.market == null ? '' : b.market),
      side: String(b.side == null ? '' : b.side), line: isNum(b.line) ? b.line : null, odds: b.odds, units: b.units, label: String(b.label == null ? '' : b.label),
      team: String(b.team == null ? '' : b.team), opp: String(b.opp == null ? '' : b.opp), addedAt: typeof b.addedAt === 'string' ? b.addedAt : '',
      oddsEdited: !!b.oddsEdited, status: b.status || 'open', settledAt: typeof b.settledAt === 'string' ? b.settledAt : '', pl: isNum(b.pl) ? b.pl : 0,
    };
    ['grade', 'note', 'pid', 'start', 'gradedOn', 'away', 'home'].forEach((k) => { if (b[k] !== undefined && b[k] !== null && b[k] !== '') o[k] = b[k]; });
    if (b.uncal) o.uncal = true;
    if (b.type === 'parlay') o.legs = b.legs.map(cleanLeg);
    return o;
  }
  // returns a store object; a missing, broken or foreign value gives an empty store (nothing thrown)
  function load(storage) {
    const st = emptyStore();
    try {
      const s = storage === undefined ? getStorage() : storage;
      const raw = s && s.getItem(KEY);
      if (!raw) return st;
      const o = JSON.parse(raw);
      if (!o || o.schema !== SCHEMA || !o.bets || typeof o.bets !== 'object') return st;
      Object.keys(o.bets).forEach((id) => { const b = o.bets[id]; if (validBet(b) && b.id === id) st.bets[id] = cleanBet(b); });
    } catch (e) { /* unreadable storage: start empty */ }
    return st;
  }
  function save(st, storage) { // true when written
    try {
      const s = storage === undefined ? getStorage() : storage;
      if (!s) return false;
      s.setItem(KEY, JSON.stringify(st));
      return true;
    } catch (e) { return false; }
  }

  // Two tabs / windows share one localStorage key, so a write never replaces the whole store from memory. commit() re-reads storage, applies
  // only this change (keyed by bet id) and writes the result back: another tab's adds and removals survive, and a removed bet cannot come back.
  // ops: { t: 'set', bet } add or edit (always wins) | { t: 'del', id } remove | { t: 'grade', bet } a settle result for a graded copy of the bet (applied only while
  // the bet still exists in storage, is still open there and has the same odds and units, so grading can neither bring back a removed bet nor overwrite an edit).
  // mem = this tab's in-memory store, used when storage is blocked or its key was cleared. -> { store, ok }; ok false = not written.
  function freshBase(mem, storage) {
    try {
      const s = storage === undefined ? getStorage() : storage;
      if (s && s.getItem(KEY) !== null && s.getItem(KEY) !== undefined) return load(s);
    } catch (e) { /* unreadable: use memory */ }
    return { schema: SCHEMA, bets: Object.assign({}, mem.bets) };
  }
  function commit(mem, ops, storage) {
    const base = freshBase(mem, storage), bets = Object.assign({}, base.bets);
    (ops || []).forEach((op) => {
      if (!op) return;
      if (op.t === 'set' && validBet(op.bet)) bets[op.bet.id] = cleanBet(op.bet);
      else if (op.t === 'del') delete bets[op.id];
      else if (op.t === 'grade' && op.bet) { // only if the stored bet is still open with the same odds and units the result was computed from (else it is graded again next pass)
        const cur = bets[op.bet.id];
        if (cur && cur.status === 'open' && cur.odds === op.bet.odds && cur.units === op.bet.units) bets[op.bet.id] = cleanBet(Object.assign({}, cur, { status: op.bet.status, pl: op.bet.pl, settledAt: op.bet.settledAt, gradedOn: op.bet.gradedOn, note: op.bet.note, legs: op.bet.legs || cur.legs }));
      }
    });
    const store = { schema: SCHEMA, bets };
    return { store, ok: save(store, storage) };
  }

  // ---- odds + P/L ----
  // American odds text -> number, or null when invalid (+150, -110, 150; magnitude 100..9999, whole numbers)
  function parseOdds(txt) {
    const t = String(txt == null ? '' : txt).trim().replace(/−/g, '-');
    if (!/^[+-]?\d{3,4}$/.test(t)) return null;
    const n = parseInt(t, 10);
    return Math.abs(n) >= 100 ? n : null;
  }
  // units won/lost: W +odds -> units*odds/100, W -odds -> units*100/|odds|, L -> -units, P/void/open -> 0
  function calcPL(status, odds, units) {
    if (status === 'L') return -units;
    if (status === 'W') return odds > 0 ? units * odds / 100 : units * 100 / Math.abs(odds);
    return 0;
  }
  const r2 = (v) => Math.round(v * 100) / 100;

  // ---- grading ----
  const NOTE_NOSETTLE = 'Can’t settle on its own: your line differs from the open and close lines and no final stat is published for it.';
  const RES = { W: 'W', L: 'L', P: 'P', push: 'P', PUSH: 'P', Push: 'P' };
  // Which phase block of a results row the bet was placed on: close when the stored line equals the close line, else open when it equals the open line.
  // Returns { phase, block } or null when neither phase has the bet's line (the line moved and we cannot tell which one was bet).
  function matchPhase(bet, row) {
    const same = (p) => p && typeof p === 'object' && (bet.line === null ? !isNum(p.line) : p.line === bet.line);
    if (same(row.close)) return { phase: 'close', block: row.close };
    if (same(row.open)) return { phase: 'open', block: row.open };
    return null;
  }
  // -> { status: 'W'|'L'|'P'|'void', pl, phase } | { status: 'open', note } | null (no row yet)
  function gradeBet(bet, row) {
    if (!row || typeof row !== 'object') return null;
    if (row.status === 'void') return { status: 'void', pl: 0, phase: '' };
    if (row.status === 'flagged') return { status: 'open', note: 'Checking: result under review' };
    if (row.status !== 'graded') return null;
    const m = matchPhase(bet, row);
    if (!m) { // the line differs from both published lines: settle at the bet's own line from the actual stat when the row carries it
      if (bet.type === 'prop' && isNum(bet.line) && isNum(row.actual) && (bet.side === 'o' || bet.side === 'u')) {
        const res = row.actual === bet.line ? 'P' : ((row.actual > bet.line) === (bet.side === 'o') ? 'W' : 'L');
        return { status: res, pl: res === 'P' ? 0 : r2(calcPL(res, bet.odds, bet.units)), phase: 'actual' };
      }
      return { status: 'open', note: NOTE_NOSETTLE };
    }
    const res = RES[m.block.result];
    if (!res) return { status: 'open', note: 'Checking: no result yet' };
    if (res === 'P') return { status: 'P', pl: 0, phase: m.phase };
    return { status: res, pl: r2(calcPL(res, bet.odds, bet.units)), phase: m.phase };
  }
  // ---- parlays ----
  const decOf = (o) => (o > 0 ? 1 + o / 100 : 1 + 100 / Math.abs(o));
  const amOf = (d) => Math.round(d >= 2 ? (d - 1) * 100 : -100 / (d - 1));
  // combined American odds of a set of legs (multiplied decimal odds)
  const parlayOdds = (legs) => amOf(legs.reduce((t, l) => t * decOf(l.odds), 1));
  const NOTE_REPRICED = 'A leg pushed or was voided, so the payout was recalculated from the legs left. Check your book’s payout.';
  const NOTE_DROPPED = 'A leg pushed or was voided, so it paid at the odds of the legs left.';
  // Any leg lost: L. Any leg not settled yet: open. Pushed / voided legs drop out and the price is rebuilt from the legs left
  // (a book-entered price can't be rebuilt exactly, so that case carries a note). All legs pushed / voided: P.
  // -> same shape as gradeBet, plus legs: [res per leg]
  function gradeParlay(bet, rowFor) {
    const res = bet.legs.map((l) => { const g = gradeBet(l, rowFor(l)); return g && g.status !== 'open' ? g.status : null; });
    const done = res.filter(Boolean).length;
    if (res.includes('L')) return { status: 'L', pl: r2(calcPL('L', bet.odds, bet.units)), legs: res };
    if (done < res.length) return { status: 'open', note: done ? `${done} of ${res.length} legs settled` : undefined, legs: res };
    const live = bet.legs.filter((l, i) => res[i] === 'W');
    if (!live.length) return { status: 'P', pl: 0, legs: res };
    if (live.length === bet.legs.length) return { status: 'W', pl: r2(calcPL('W', bet.odds, bet.units)), legs: res };
    const odds = parlayOdds(live);
    return { status: 'W', pl: r2(calcPL('W', odds, bet.units)), legs: res, note: bet.oddsEdited ? NOTE_REPRICED : NOTE_DROPPED, odds };
  }
  // apply grades to open bets; rowFor(bet) -> results row or undefined. Returns the number of bets that changed.
  // changed (optional array) receives the ids of the bets that changed
  function applyGrades(st, rowFor, nowIso, changed) {
    let n = 0;
    Object.values(st.bets).forEach((b) => {
      if (b.status !== 'open') return;
      const hit = () => { n++; if (changed) changed.push(b.id); };
      if (b.type === 'parlay') {
        const g = gradeParlay(b, rowFor);
        let moved = false;
        b.legs.forEach((l, i) => { const r = g.legs[i] || undefined; if (l.res !== r) { if (r) l.res = r; else delete l.res; moved = true; } });
        if (g.status === 'open') { if ((b.note || undefined) !== g.note) { if (g.note) b.note = g.note; else delete b.note; moved = true; } if (moved) hit(); return; }
        b.status = g.status; b.pl = g.pl; b.settledAt = nowIso || new Date().toISOString();
        if (g.note) b.note = g.note; else delete b.note;
        hit();
        return;
      }
      const g = gradeBet(b, rowFor(b));
      if (!g) { if (b.note) { delete b.note; hit(); } return; }
      if (g.status === 'open') { if (b.note !== g.note) { b.note = g.note; hit(); } return; }
      b.status = g.status; b.pl = g.pl; b.settledAt = nowIso || new Date().toISOString(); delete b.note;
      if (g.phase) b.gradedOn = g.phase;
      hit();
    });
    return n;
  }
  // results file path of a bet: results/<sport>/<YYYY-MM>.json
  const resultsPath = (b) => 'results/' + b.sport + '/' + b.date.slice(0, 7) + '.json';

  // ---- summary ----
  function summary(st) {
    const s = { open: 0, w: 0, l: 0, p: 0, voided: 0, units: 0, staked: 0, roi: null, atRisk: 0 };
    Object.values(st.bets).forEach((b) => {
      if (b.status === 'open') { s.open++; s.atRisk += b.units; } else if (b.status === 'W') s.w++; else if (b.status === 'L') s.l++;
      else if (b.status === 'P') s.p++; else if (b.status === 'void') s.voided++;
      if (b.status === 'W' || b.status === 'L' || b.status === 'P') { s.units += b.pl; s.staked += b.units; }
    });
    s.units = r2(s.units);
    s.roi = s.staked > 0 ? s.units / s.staked * 100 : null;
    return s;
  }

  // ---- closing line value ----
  // Did the odds you took beat the closing price on the same side and the same line? row = the results row the bet grades against.
  // impliedDiff = close implied % - your implied %, in percentage points; positive = beat (you paid less than the close price implies).
  // { beat: null, impliedDiff: null } when the row has no close price, or the close line differs from the bet's line.
  const impl = (o) => (o > 0 ? 100 / (o + 100) : -o / (-o + 100));
  function clvOf(bet, row) {
    const none = { beat: null, impliedDiff: null };
    const c = row && typeof row === 'object' ? row.close : null;
    if (!c || typeof c !== 'object' || !isNum(c.odds) || Math.abs(c.odds) < 100 || !bet || !isNum(bet.odds)) return none;
    const sameLine = bet.line === null || bet.line === undefined ? !isNum(c.line) : c.line === bet.line;
    if (!sameLine) return none;
    const d = (impl(c.odds) - impl(bet.odds)) * 100;
    return { beat: d > 0, impliedDiff: d };
  }

  // ---- export / import (the account-ready format) ----
  const exportName = (d) => 'slate-projector-bets-' + (d || new Date().toISOString().slice(0, 10)) + '.json';
  const exportText = (st) => JSON.stringify(st, null, 2);
  // Merge by id: the import only adds ids that are not present. Returns { store, added, skipped, invalid } or { error }.
  function mergeImport(st, incoming) {
    let o = incoming;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return { error: 'This file is not valid JSON.' }; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'This is not a Trend Bettors bets file.' };
    if (o.schema !== SCHEMA) return { error: 'Unsupported file version (schema ' + String(o.schema) + ').' };
    if (!o.bets || typeof o.bets !== 'object' || Array.isArray(o.bets)) return { error: 'This file has no bets.' };
    const out = { schema: SCHEMA, bets: Object.assign({}, st.bets) };
    let added = 0, skipped = 0, invalid = 0;
    Object.keys(o.bets).forEach((id) => {
      const b = o.bets[id];
      if (!validBet(b) || b.id !== id) { invalid++; return; }
      if (out.bets[id]) { skipped++; return; }
      out.bets[id] = cleanBet(b); added++;
    });
    return { store: out, added, skipped, invalid };
  }

  root.MyBets = { KEY, SCHEMA, UNIT_CHOICES, emptyStore, load, save, commit, validBet, cleanBet, parseOdds, calcPL, matchPhase, gradeBet, applyGrades, gradeParlay, parlayOdds, resultsPath, summary, clvOf, exportName, exportText, mergeImport };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MyBets;
}(typeof window !== 'undefined' ? window : globalThis));
