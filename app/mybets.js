// My Bets: storage, grading, backup (pure functions; no DOM). Loaded before app.js; also required by tests/test_mybets.js.
// Store (localStorage key sp.mybets.v1): { schema: 1, bets: { <betId>: { id, sport, date, gid, type, market, side, line, odds, units, label,
//   team, opp, addedAt, oddsEdited, status: open|W|L|P|void, settledAt, pl, grade?, uncal?, note? } } }
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
      && (b.type === 'prop' || b.type === 'game') && isNum(b.odds) && Math.abs(b.odds) >= 100
      && isNum(b.units) && b.units > 0 && b.units <= 100 && (b.line === null || b.line === undefined || isNum(b.line))
      && STATUSES.includes(b.status || 'open');
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
    if (!m) return { status: 'open', note: 'Checking: line changed' };
    const res = RES[m.block.result];
    if (!res) return { status: 'open', note: 'Checking: no result yet' };
    if (res === 'P') return { status: 'P', pl: 0, phase: m.phase };
    return { status: res, pl: r2(calcPL(res, bet.odds, bet.units)), phase: m.phase };
  }
  // apply grades to open bets; rowFor(bet) -> results row or undefined. Returns the number of bets that changed.
  function applyGrades(st, rowFor, nowIso) {
    let n = 0;
    Object.values(st.bets).forEach((b) => {
      if (b.status !== 'open') return;
      const g = gradeBet(b, rowFor(b));
      if (!g) { if (b.note) { delete b.note; n++; } return; }
      if (g.status === 'open') { if (b.note !== g.note) { b.note = g.note; n++; } return; }
      b.status = g.status; b.pl = g.pl; b.settledAt = nowIso || new Date().toISOString(); delete b.note;
      if (g.phase) b.gradedOn = g.phase;
      n++;
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

  // ---- export / import (the account-ready format) ----
  const exportName = (d) => 'slate-projector-bets-' + (d || new Date().toISOString().slice(0, 10)) + '.json';
  const exportText = (st) => JSON.stringify(st, null, 2);
  // Merge by id: the import only adds ids that are not present. Returns { store, added, skipped, invalid } or { error }.
  function mergeImport(st, incoming) {
    let o = incoming;
    if (typeof o === 'string') { try { o = JSON.parse(o); } catch (e) { return { error: 'This file is not valid JSON.' }; } }
    if (!o || typeof o !== 'object' || Array.isArray(o)) return { error: 'This is not a Slate Projector bets file.' };
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

  root.MyBets = { KEY, SCHEMA, UNIT_CHOICES, emptyStore, load, save, validBet, cleanBet, parseOdds, calcPL, matchPhase, gradeBet, applyGrades, resultsPath, summary, exportName, exportText, mergeImport };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MyBets;
}(typeof window !== 'undefined' ? window : globalThis));
