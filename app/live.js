// Live bet tracking for My Bets (display only; pure logic, no DOM). Loaded before app.js; also required by tests/test_live.js.
// Reads ESPN's site API straight from the browser; never writes to My Bets storage and never changes a bet's status or P/L (morning grading stays the record).
// Parsing mirrors scripts/sources.py (nfl_players, box) and scripts/grade.py (FIX team codes, PARTS stat keys, find_player, ou): see the notes on each block.
(function (root) {
  'use strict';
  const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/';
  const PATH = { nfl: 'football/nfl', nhl: 'hockey/nhl', nba: 'basketball/nba' };
  const SPORTS = ['nfl', 'nhl', 'nba'];
  const POLL_MS = 30000; // refresh period while My Bets is on screen and the page is visible
  const TIMEOUT_MS = 8000; // per request
  const PRE_MS = 10 * 60000; // start asking the scoreboard this long before a stored start time
  const POST_MS = 24 * 3600000; // an open bet this long after its start gets no more live requests
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  // ESPN abbreviation -> pack code (scripts/grade.py FIX, same maps)
  const FIX = {
    NBA: { GS: 'GSW', NY: 'NYK', NO: 'NOP', SA: 'SAS', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX', BRK: 'BKN' },
    NHL: { NJ: 'NJD', LA: 'LAK', SJ: 'SJS', TB: 'TBL', UTAH: 'UTA', WAS: 'WSH', MON: 'MTL', CLB: 'CBJ', NAS: 'NSH', VEG: 'VGK', LV: 'VGK' },
    NFL: { LA: 'LAR', WSH: 'WAS', JAC: 'JAX', LVR: 'LV' },
  };
  const teamCode = (sp, a) => { const s = String(a == null ? '' : a); return (FIX[sp.toUpperCase()] || {})[s] || s; };

  // scripts/core.py norm / name_keys, ported exactly
  function norm(n) {
    let s = String(n == null ? '' : n).normalize('NFKD').replace(/[^\x00-\x7F]/g, '').toUpperCase();
    s = s.replace(/[.'’\-]/g, ' ');
    s = s.replace(/\s+/g, ' ').trim();
    return s.replace(/\s+(JR|SR|II|III|IV)$/, '');
  }
  function nameKeys(n) {
    const w = norm(n).split(' ').filter(Boolean);
    return [w.join(' '), w.length ? w[0][0] + ' ' + w[w.length - 1] : ''];
  }

  // ---- which bets can be tracked ----
  // stat key -> parts summed (scripts/grade.py PARTS; atd = rushing + receiving TDs). Every NFL / NHL prop key in the slates is listed.
  const PARTS = {
    nfl: { pyd: ['pyd'], comp: ['comp'], patt: ['patt'], ptd: ['ptd'], ryd: ['ryd'], ratt: ['ratt'], recy: ['recy'], rec: ['rec'], rry: ['ryd', 'recy'], atd: ['rtd', 'rectd'] },
    nhl: { sog: ['sog'], g: ['g'], a: ['a'], pts: ['g', 'a'] },
    nba: { pts: ['pts'], reb: ['reb'], ast: ['ast'], tpm: ['tpm'], pra: ['pts', 'reb', 'ast'], pr: ['pts', 'reb'], pa: ['pts', 'ast'], ra: ['reb', 'ast'], td3: ['pts', 'reb', 'ast'] },
  };
  const GAME_MKT = ['total', 'ttA', 'ttB', 'ml', 'spread']; // ml / spread (side A|H): live score only, gray until final (owner 11/01 18:17)
  const OU = (b) => (b.side === 'o' || b.side === 'u') && isNum(b.line);
  const trackable = (b) => !!b && SPORTS.includes(b.sport) && b.status === 'open'
    && (b.type === 'prop' ? OU(b) && !!(PARTS[b.sport] || {})[b.market]
      : b.type === 'game' ? (b.market === 'ml' ? (b.side === 'A' || b.side === 'H') : b.market === 'spread' ? (b.side === 'A' || b.side === 'H') && isNum(b.line) : GAME_MKT.includes(b.market) && OU(b)) : false);
  const gameKey = (b) => b.sport + '|' + b.date + '|' + b.away + '|' + b.home;
  const dateNum = (d) => String(d).replace(/-/g, '');

  const F_ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
  const etDay = (iso) => { const t = new Date(iso); return isNaN(t) ? '' : F_ET.format(t); };

  // ---- scoreboard ----
  // -> [{ id, day (ET date), state (pre|in|post), away, home (pack codes), sA, sH }]
  function parseScoreboard(sp, js) {
    const out = [];
    ((js && js.events) || []).forEach((e) => {
      try {
        const c = e.competitions[0], tm = {};
        c.competitors.forEach((x) => { tm[x.homeAway] = x; });
        if (!tm.away || !tm.home) return;
        out.push({
          id: String(e.id), day: etDay(e.date), state: String(c.status.type.state), away: teamCode(sp, tm.away.team.abbreviation), home: teamCode(sp, tm.home.team.abbreviation),
          sA: Number(tm.away.score), sH: Number(tm.home.score),
        });
      } catch (err) { /* skip a malformed event */ }
    });
    return out;
  }
  // same sport + ET date + away/home (after the code fix); null when none or when two events match (never guess)
  function findEvent(events, bet) {
    const hits = events.filter((e) => e.day === bet.date && e.away === bet.away && e.home === bet.home);
    return hits.length === 1 ? hits[0] : null;
  }

  // ---- summary (box) ----
  // ESPN NFL: boxscore.players[team].statistics[] = { name: passing|rushing|receiving, labels, athletes: [{ athlete: { id, displayName }, stats }] } (sources.NFL_BOX)
  const NFL_BOX = { passing: { 'C/ATT': ['comp', 'patt'], YDS: 'pyd', TD: 'ptd' }, rushing: { CAR: 'ratt', YDS: 'ryd', TD: 'rtd' }, receiving: { REC: 'rec', YDS: 'recy', TGTS: 'tgt', TD: 'rectd' } };
  const NFL_KEYS = ['patt', 'comp', 'pyd', 'ptd', 'ratt', 'ryd', 'tgt', 'rec', 'recy', 'rtd', 'rectd'];
  const KEY_CAT = { patt: 'passing', comp: 'passing', pyd: 'passing', ptd: 'passing', ratt: 'rushing', ryd: 'rushing', rtd: 'rushing', rec: 'receiving', recy: 'receiving', tgt: 'receiving', rectd: 'receiving', g: 'skaters', a: 'skaters', sog: 'skaters', pts: 'nba', reb: 'nba', ast: 'nba', tpm: 'nba' };
  // a box cell counts as a logged stat when any number in it is > 0 ("0-2" FG = a shot attempt); time, shifts and +/- never count (owner 11/01 18:17:
  // a player shows in the live display only once he has logged at least one stat)
  const NO_ACT = ['MIN', 'TOI', 'PPTOI', 'SHTOI', 'ESTOI', 'SHFT', '+/-', 'LONG'];
  const actCell = (lab, raw) => NO_ACT.indexOf(lab) < 0 && String(raw == null ? '' : raw).split(/[-/]/).some((t) => parseFloat(t) > 0);
  const num = (x) => { const v = parseFloat(String(x == null ? '' : x).replace('+', '')); return isNaN(v) ? null : v; };

  // -> { state, sA, sH, away, home, teams: { CODE: [row] }, bad: { category: true } } or null when the shape is not an ESPN summary.
  // A category whose labels are missing is listed in `bad` and the stats from it are never computed (sources.py raises there; the app shows no live line instead of guessing).
  function parseSummary(sp, js) {
    try {
      const c = js.header.competitions[0], tm = {};
      c.competitors.forEach((x) => { tm[x.homeAway] = x; });
      const out = {
        state: String(c.status.type.state), away: teamCode(sp, tm.away.team.abbreviation), home: teamCode(sp, tm.home.team.abbreviation),
        sA: Number(tm.away.score), sH: Number(tm.home.score), teams: {}, bad: {},
      };
      (js.boxscore.players || []).forEach((b) => {
        const team = teamCode(sp, b.team.abbreviation), rows = out.teams[team] = out.teams[team] || [], byId = {};
        (b.statistics || []).forEach((s) => {
          const lab = s.labels || [];
          if (sp === 'nfl') {
            const spec = NFL_BOX[s.name];
            if (!spec) return;
            if (Object.keys(spec).some((k) => lab.indexOf(k) < 0)) { out.bad[s.name] = true; return; }
            (s.athletes || []).forEach((a) => {
              const st = a.stats || [], id = String(a.athlete.id == null ? '' : a.athlete.id), nm = a.athlete.displayName, k = id || nm;
              let r = byId[k];
              if (!r) { r = byId[k] = { id, name: nm, act: false }; NFL_KEYS.forEach((x) => { r[x] = 0; }); rows.push(r); }
              lab.forEach((lb, i) => { if (actCell(lb, st[i])) r.act = true; });
              Object.keys(spec).forEach((lb) => {
                const raw = st[lab.indexOf(lb)], key = spec[lb];
                if (Array.isArray(key)) { const p = String(raw == null || raw === '' ? '0/0' : raw).split('/'); r[key[0]] = Math.trunc(num(p[0]) || 0); r[key[1]] = Math.trunc(num(p[p.length - 1]) || 0); } else r[key] = Math.trunc(num(raw) || 0);
              });
            });
          } else if (s.name === 'forwards' || s.name === 'defenses') { // NHL skaters; shots on goal = column "S" (not "SOG"), as in sources.box
            if (['G', 'A', 'S'].some((k) => lab.indexOf(k) < 0)) { out.bad.skaters = true; return; }
            (s.athletes || []).forEach((a) => {
              const st = a.stats || [];
              if (!st.length || a.didNotPlay) return;
              const v = (k) => st[lab.indexOf(k)];
              rows.push({ id: String(a.athlete.id == null ? '' : a.athlete.id), name: a.athlete.displayName, g: num(v('G')) || 0, a: num(v('A')) || 0, sog: num(v('S')) || 0,
                act: lab.some((lb, i) => actCell(lb, st[i])) });
            });
          } else if (sp === 'nba') { // sources.box (NBA): MIN PTS REB AST, 3PT "made-att"
            if (['PTS', 'REB', 'AST', '3PT'].some((k) => lab.indexOf(k) < 0)) { out.bad.nba = true; return; }
            (s.athletes || []).forEach((a) => {
              const st = a.stats || [];
              if (!st.length || a.didNotPlay) return;
              const v = (k) => st[lab.indexOf(k)], tp = String(v('3PT') || '0-0').split('-');
              rows.push({ id: String(a.athlete.id == null ? '' : a.athlete.id), name: a.athlete.displayName, pts: num(v('PTS')) || 0, reb: num(v('REB')) || 0,
                ast: num(v('AST')) || 0, tpm: num(tp[0]) || 0, act: lab.some((lb, i) => actCell(lb, st[i])) });
            });
          }
        });
      });
      return out;
    } catch (err) { return null; }
  }

  // scripts/grade.py find_player: NFL tries the exact full name first; then a unique name_keys hit. null = no confident match.
  function findPlayer(sp, sum, team, name, pid) {
    const rows = ((sum && sum.teams) || {})[team];
    if (!rows) return null;
    if (sp === 'nba' && pid) { const byId = rows.filter((p) => p.id === String(pid)); if (byId.length === 1) return byId[0]; } // grade.py: NBA ids are ESPN ids
    if (!String(name || '').trim()) return null;
    if (sp === 'nfl') {
      const full = norm(name), exact = rows.filter((p) => norm(p.name) === full);
      if (exact.length === 1) return exact[0];
    }
    const keys = nameKeys(name).filter(Boolean);
    const hits = rows.filter((p) => nameKeys(p.name).some((k) => k && keys.indexOf(k) >= 0));
    return hits.length === 1 ? hits[0] : null;
  }
  // stat value of one box row, or null when it cannot be computed
  function statValue(sp, key, row, bad) {
    const parts = (PARTS[sp] || {})[key];
    if (!parts || !row) return null;
    let t = 0;
    for (let i = 0; i < parts.length; i++) {
      if (bad && bad[KEY_CAT[parts[i]]]) return null;
      if (!isNum(row[parts[i]])) return null;
      t += row[parts[i]];
    }
    return t;
  }

  // ---- color / status decision ----
  // phase: 'in' live, 'post' final. over hits when cur > line (yes props are overs of 0.5, so the first TD / goal); under is lost when cur > line.
  // -> { cls: 'gray'|'green'|'red'|'push', done }
  function decide(side, line, cur, phase) {
    const final = phase === 'post';
    if (final && cur === line) return { cls: 'push', done: true };
    if (side === 'o') return { cls: cur > line ? 'green' : final ? 'red' : 'gray', done: final || cur > line };
    return { cls: cur > line ? 'red' : final ? 'green' : 'gray', done: final || cur > line };
  }

  // ---- one bet's live view ----
  // game = cache.games[gameKey] (or undefined); name = the player's name for a prop. -> null when nothing should be shown.
  // { kind: 'ok', cur, line, target, pct, cls, phase, text, tail } | { kind: 'score', cls, phase, text, tail, away, home, sA, sH, win } (ml / spread); null = show nothing
  function betView(bet, game, name) {
    if (!trackable(bet) || !game || (game.state !== 'in' && game.state !== 'post')) return null;
    const phase = game.state, final = phase === 'post';
    if (bet.type === 'game' && (bet.market === 'ml' || bet.market === 'spread')) { // live score only; color at the final (grade.py game_result)
      if (!isNum(game.sA) || !isNum(game.sH)) return null;
      const diff = bet.side === 'A' ? game.sA - game.sH : game.sH - game.sA, x = bet.market === 'ml' ? diff : diff + bet.line;
      const cls = !final ? 'gray' : bet.market === 'spread' && x === 0 ? 'push' : x > 0 ? 'green' : 'red';
      const tail = bet.market === 'ml' ? '' : 'Margin ' + (diff > 0 ? '+' : '') + diff + ' · line ' + (bet.line > 0 ? '+' : '') + bet.line;
      const win = final && game.sA !== game.sH ? (game.sA > game.sH ? 'A' : 'H') : ''; // the team that won the game (styling only)
      return { kind: 'score', cls, phase, text: bet.away + ' ' + game.sA + ' – ' + game.sH + ' ' + bet.home, tail, away: bet.away, home: bet.home, sA: game.sA, sH: game.sH, win };
    }
    let cur;
    if (bet.type === 'game') {
      if (!isNum(game.sA) || !isNum(game.sH)) return null;
      cur = bet.market === 'total' ? game.sA + game.sH : bet.market === 'ttA' ? game.sA : game.sH;
    } else {
      if (!game.sum) return null; // box not fetched yet
      const row = findPlayer(bet.sport, game.sum, bet.team, name, bet.pid);
      if (!row || !row.act) return null; // not in the box, or no stat logged yet: not shown (owner 11/01 18:17)
      if (bet.market === 'td3') { // triple-double: Yes once PTS, REB and AST are all >= 10 (grade.py actual)
        if (game.sum.bad && game.sum.bad.nba) return null;
        const v = [row.pts, row.reb, row.ast], hit = v.every((t) => t >= 10) ? 1 : 0, d = decide(bet.side, bet.line, hit, phase);
        const pct = v.reduce((t, x) => t + Math.min(x, 10), 0) / 30 * 100;
        return { kind: 'ok', cur: hit, line: bet.line, target: 1, pct, cls: d.cls, phase, text: v[0] + ' PTS · ' + v[1] + ' REB · ' + v[2] + ' AST', tail: 'needs 10s' };
      }
      cur = statValue(bet.sport, bet.market, row, game.sum.bad);
      if (cur === null) return null; // a stat the summary cannot give: no live line
    }
    const d = decide(bet.side, bet.line, cur, phase), target = bet.line < 1 ? 1 : bet.line;
    const pct = Math.max(0, Math.min(100, cur / target * 100));
    return { kind: 'ok', cur, line: bet.line, target, pct, cls: d.cls, phase, text: 'Current: ' + cur, tail: bet.line < 1 ? 'needs 1' : 'of ' + bet.line };
  }

  // ---- fetching ----
  // Which open bets need live requests right now: trackable, a stored away/home, inside the start window, game not already final-fetched.
  function eligible(bets, now, cache) {
    const today = etDay(now);
    return bets.filter((b) => {
      if (!trackable(b) || !b.away || !b.home) return false;
      const g = cache.games[gameKey(b)];
      if (g && g.finalDone) return false;
      if (b.start) { const t = Date.parse(b.start); if (isNaN(t)) return false; return now >= t - PRE_MS && now <= t + POST_MS; }
      return b.date === today || b.date === etDay(now - 86400000);
    });
  }
  // One refresh cycle. fetchJson(url) -> Promise<json> (rejects on error / timeout). cache = { games: {}, failed: false } is updated in place.
  // One scoreboard call per sport (per bet date), then one summary call per live game that has a tracked prop bet (and one when a game just went final).
  // Failures keep the last values and set cache.failed. Returns { requests, failed }.
  async function refresh(o) {
    const cache = o.cache, now = o.now == null ? Date.now() : o.now, fetchJson = o.fetchJson;
    const list = eligible(o.bets, now, cache);
    let requests = 0, failed = false;
    const boards = {};
    list.forEach((b) => { boards[b.sport + '|' + b.date] = { sport: b.sport, date: b.date }; });
    const got = await Promise.all(Object.keys(boards).map(async (k) => {
      requests++;
      try { return [k, parseScoreboard(boards[k].sport, await fetchJson(ESPN + PATH[boards[k].sport] + '/scoreboard?dates=' + dateNum(boards[k].date)))]; } catch (e) { failed = true; return [k, null]; }
    }));
    const events = {};
    got.forEach((x) => { events[x[0]] = x[1]; });
    const games = {};
    list.forEach((b) => {
      const evs = events[b.sport + '|' + b.date];
      if (!evs) return;
      const ev = findEvent(evs, b);
      if (!ev) return;
      const gk = gameKey(b), g = cache.games[gk] = cache.games[gk] || {};
      g.id = ev.id; g.state = ev.state; g.sA = ev.sA; g.sH = ev.sH; g.sport = b.sport;
      const e = games[gk] = games[gk] || { g, prop: false };
      if (b.type === 'prop') e.prop = true;
    });
    await Promise.all(Object.keys(games).map(async (gk) => {
      const e = games[gk], g = e.g;
      if (g.state === 'post' && !e.prop) { g.finalDone = true; return; } // game-only bets: the scoreboard score is final
      if (!e.prop || (g.state !== 'in' && g.state !== 'post')) return;
      requests++;
      try {
        const sum = parseSummary(g.sport, await fetchJson(ESPN + PATH[g.sport] + '/summary?event=' + g.id));
        if (!sum) throw new Error('summary shape');
        g.sum = sum; g.state = sum.state || g.state;
        if (isNum(sum.sA) && isNum(sum.sH)) { g.sA = sum.sA; g.sH = sum.sH; }
        if (g.state === 'post') g.finalDone = true; // the one fetch after the game went final
      } catch (err) { failed = true; }
    }));
    cache.failed = failed;
    return { requests, failed };
  }
  // True while any open tracked bet could still produce live data (the app keeps its 30 s timer only then)
  const pending = (bets, now, cache) => eligible(bets, now, cache).length > 0;

  const api = { ESPN, PATH, POLL_MS, TIMEOUT_MS, FIX, PARTS, GAME_MKT, actCell, norm, nameKeys, teamCode, etDay, trackable, gameKey, parseScoreboard, findEvent, parseSummary, findPlayer, statValue, decide, betView, eligible, refresh, pending };
  root.Live = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
