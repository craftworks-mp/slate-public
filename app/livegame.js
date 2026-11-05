// Live Game tab: pure logic, no DOM (owner-approved 11/01 18:45). Loaded after live.js and before app.js; also required by tests/test_livegame.js.
// Parses one ESPN summary (site.api.espn.com .../summary?event=<id>) into a compact live box, usage splits and a momentum strip built only
// from real game events. Every field read here was seen in real ESPN summaries captured 11/01 (tests/fixtures/espn/*_full_*.json); nothing is invented.
// Team codes, the stat-logged rule and the bet progress view come from live.js (window.Live) so My Bets and this tab can never disagree.
(function (root) {
  'use strict';
  const L = root.Live || (typeof require === 'function' ? require('./live.js') : null);
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const num = (x) => { const v = parseFloat(String(x == null ? '' : x).replace('+', '')); return isNaN(v) ? null : v; };
  const n0 = (x) => { const v = num(x); return v === null ? 0 : v; };
  // "m:ss" -> seconds (NBA MIN is whole minutes: "22" -> 1320)
  const secs = (s) => { const p = String(s == null ? '' : s).split(':'); if (p.length === 1) { const v = num(p[0]); return v === null ? 0 : v * 60; } return n0(p[0]) * 60 + n0(p[1]); };
  const mmss = (t) => { const m = Math.floor(t / 60), s = Math.round(t - m * 60); return m + ':' + String(s).padStart(2, '0'); };
  const pair = (s) => { const p = String(s == null ? '' : s).split(/[-/]/); return [n0(p[0]), n0(p[p.length - 1])]; }; // "2-10" / "24/32" -> [made, att]
  const teamCode = (sp, a) => (L ? L.teamCode(sp, a) : String(a == null ? '' : a));
  // regulation period length in seconds + overtime length (NFL uses drives, no clock windows)
  const PERIOD = { nba: [720, 300], nhl: [1200, 300] };
  // NHL play clocks count UP inside the period (Period Start 0:00, Period End 20:00 in the real feed); NBA play clocks count DOWN (End Period 0.0)
  function elapsed(sp, period, clock) {
    const P = PERIOD[sp];
    if (!P || !isNum(period) || period < 1) return null;
    const reg = sp === 'nba' ? 4 : 3, c = secs(clock);
    let t = 0;
    for (let p = 1; p < period; p++) t += p <= reg ? P[0] : P[1];
    const len = period <= reg ? P[0] : P[1];
    return t + (sp === 'nhl' ? Math.min(c, len) : Math.max(0, len - c));
  }

  // ---- box columns (ESPN labels -> compact rows) ----
  // key: our stat key; lab: ESPN label; the cell shown is the raw ESPN string unless fmt says otherwise
  const COLS = {
    nba: [['MIN', 'MIN'], ['PTS', 'PTS'], ['REB', 'REB'], ['AST', 'AST'], ['FG', 'FG'], ['3PT', '3PT'], ['FT', 'FT'], ['STL', 'STL'], ['BLK', 'BLK'], ['TO', 'TO'], ['PF', 'PF'], ['+/-', '+/-']],
    nhl: [['TOI', 'TOI'], ['G', 'G'], ['A', 'A'], ['P', 'P'], ['S', 'S'], ['SM', 'SM'], ['HT', 'HT'], ['BS', 'BS'], ['+/-', '+/-'], ['PIM', 'PIM']],
    nhlG: [['SA', 'SA'], ['SV', 'SV'], ['GA', 'GA'], ['SV%', 'SV%'], ['TOI', 'TOI']],
    nfl: {
      passing: [['C/ATT', 'C/ATT'], ['YDS', 'YDS'], ['TD', 'TD'], ['INT', 'INT'], ['SACKS', 'SK']],
      rushing: [['CAR', 'CAR'], ['YDS', 'YDS'], ['TD', 'TD'], ['LONG', 'LNG']],
      receiving: [['TGTS', 'TGT'], ['REC', 'REC'], ['YDS', 'YDS'], ['TD', 'TD'], ['LONG', 'LNG']],
      defensive: [['TOT', 'TKL'], ['SOLO', 'SOLO'], ['SACKS', 'SCK'], ['TFL', 'TFL'], ['PD', 'PD']],
      kicking: [['FG', 'FG'], ['XP', 'XP'], ['PTS', 'PTS']],
    },
  };
  const NFL_UNITS = ['passing', 'rushing', 'receiving', 'defensive', 'kicking'];
  const NFL_UNIT_LABEL = { passing: 'Passing', rushing: 'Rushing', receiving: 'Receiving', defensive: 'Defense', kicking: 'Kicking' };
  // usage columns: [key, label, share key or ''] ; the share is the player's part of his team's total of the same stat
  const USAGE = {
    nba: [['MIN', 'MIN', ''], ['FGA', 'FGA', 'FGA'], ['3PA', '3PA', '3PA'], ['FTA', 'FTA', 'FTA']],
    nhl: [['TOI', 'TOI', ''], ['PPTOI', 'PP TOI', ''], ['SHFT', 'SHIFTS', ''], ['ATT', 'ATT', 'ATT']],
    nfl: [['TGT', 'TGT', 'TGT'], ['CAR', 'CAR', 'CAR'], ['PATT', 'ATT', '']], // ATT = pass attempts
  };
  // usage sort: the first usage stat with a team share, then the next ones (owner: "sortable by live usage")
  const USAGE_SORT = { nba: ['FGA', 'FTA', 'MINS'], nhl: ['ATT', 'TOIS', 'PPTOIS'], nfl: ['TGT', 'CAR', 'PATT'] };

  // a raw label -> value map of one athlete line
  const rawOf = (labels, stats) => { const r = {}; labels.forEach((lb, i) => { r[lb] = stats[i] == null ? '' : String(stats[i]); }); return r; };
  // the stat-logged rule of live.js (owner 11/01 18:17): any box number > 0 outside time / shifts / +/- / LONG
  const logged = (labels, stats) => (L && L.actCell ? labels.some((lb, i) => L.actCell(lb, stats[i])) : false);
  function athlete(a) {
    const at = a.athlete || {};
    return { id: String(at.id == null ? '' : at.id), name: String(at.displayName || ''), short: String(at.shortName || at.displayName || ''), jersey: String(at.jersey == null ? '' : at.jersey),
      pos: at.position && at.position.abbreviation ? String(at.position.abbreviation) : '' };
  }

  // ---- summary -> game ----
  // -> null when the shape is not an ESPN summary. { sport, state, detail, period, clock, away, home, periods, teamStats, players, goalies, nfl, onIce, plays, drives, scoring, idCode }
  function parseGame(sp, js) {
    try {
      const comp = js.header.competitions[0], st = comp.status || {}, ty = st.type || {};
      const idCode = {}; // ESPN team id -> pack code
      const side = {};
      comp.competitors.forEach((c) => {
        const code = teamCode(sp, c.team.abbreviation);
        idCode[String(c.team.id)] = code;
        side[c.homeAway] = { code, id: String(c.team.id), score: n0(c.score), winner: c.winner === true, poss: c.possession === true,
          line: Array.isArray(c.linescores) ? c.linescores.map((x) => (x && x.displayValue != null ? String(x.displayValue) : '')) : [] };
      });
      if (!side.away || !side.home) return null;
      const g = {
        sport: sp, state: String(ty.state || ''), typeName: String(ty.name || ''), completed: ty.completed === true, detail: String(ty.shortDetail || ty.detail || ''), longDetail: String(ty.detail || ''),
        period: isNum(st.period) ? st.period : null, clock: st.displayClock == null ? '' : String(st.displayClock), displayPeriod: st.displayPeriod == null ? '' : String(st.displayPeriod),
        away: side.away, home: side.home, idCode, players: {}, goalies: {}, nfl: {}, onIce: {}, teamStats: [], scoring: [], plays: [], drives: null,
      };
      g.periods = lineScore(sp, g);
      // player box
      ((js.boxscore && js.boxscore.players) || []).forEach((b) => {
        const code = teamCode(sp, b.team.abbreviation), rows = g.players[code] = g.players[code] || [];
        if (sp === 'nfl') { g.nfl[code] = g.nfl[code] || {}; }
        (b.statistics || []).forEach((s) => {
          const labels = s.labels || [];
          if (sp === 'nba') {
            if (['MIN', 'PTS', 'REB', 'AST', 'FG', '3PT', 'FT'].some((k) => labels.indexOf(k) < 0)) { g.bad = true; return; }
            (s.athletes || []).forEach((a) => {
              const stats = a.stats || [], raw = rawOf(labels, stats), p = athlete(a);
              const fg = pair(raw.FG), tp = pair(raw['3PT']), ft = pair(raw.FT);
              rows.push(Object.assign(p, { starter: a.starter === true, on: a.active === true, dnp: a.didNotPlay === true, reason: a.reason || '', act: logged(labels, stats), raw,
                v: { MIN: secs(raw.MIN) / 60, PTS: n0(raw.PTS), REB: n0(raw.REB), AST: n0(raw.AST), FGM: fg[0], FGA: fg[1], '3PM': tp[0], '3PA': tp[1], FTM: ft[0], FTA: ft[1], STL: n0(raw.STL), BLK: n0(raw.BLK), TO: n0(raw.TO), PF: n0(raw.PF), '+/-': n0(raw['+/-']) } }));
            });
          } else if (sp === 'nhl') {
            if (s.name === 'goalies') {
              if (['SA', 'SV', 'GA', 'TOI'].some((k) => labels.indexOf(k) < 0)) return;
              const gl = g.goalies[code] = g.goalies[code] || [];
              (s.athletes || []).forEach((a) => {
                const stats = a.stats || [], raw = rawOf(labels, stats), p = athlete(a);
                if (!stats.length) return;
                gl.push(Object.assign(p, { act: logged(labels, stats) || secs(raw.TOI) > 0, raw, v: { SA: n0(raw.SA), SV: n0(raw.SV), GA: n0(raw.GA), TOI: secs(raw.TOI) / 60 } }));
              });
              return;
            }
            if (s.name !== 'forwards' && s.name !== 'defenses') return;
            if (['TOI', 'G', 'A', 'S', 'SM', 'SHFT', 'PPTOI'].some((k) => labels.indexOf(k) < 0)) { g.bad = true; return; }
            (s.athletes || []).forEach((a) => {
              const stats = a.stats || [], raw = rawOf(labels, stats), p = athlete(a);
              if (!stats.length) return;
              const G = n0(raw.G), A = n0(raw.A), S = n0(raw.S), SM = n0(raw.SM);
              raw.P = String(G + A);
              rows.push(Object.assign(p, { group: s.name, act: logged(labels, stats), raw,
                v: { TOI: secs(raw.TOI) / 60, PPTOI: secs(raw.PPTOI) / 60, SHTOI: secs(raw.SHTOI) / 60, SHFT: n0(raw.SHFT), G, A, P: G + A, S, SM, ATT: S + SM, BS: n0(raw.BS), HT: n0(raw.HT), PIM: n0(raw.PIM), '+/-': n0(raw['+/-']), FO: raw['FO%'] == null ? '' : raw['FO%'] } }));
            });
          } else if (sp === 'nfl') {
            const cols = COLS.nfl[s.name];
            if (!cols) return;
            if (cols.some(([k]) => labels.indexOf(k) < 0)) { g.bad = true; return; }
            const list = g.nfl[code][s.name] = g.nfl[code][s.name] || [];
            (s.athletes || []).forEach((a) => {
              const stats = a.stats || [], raw = rawOf(labels, stats), p = athlete(a);
              const v = {};
              if (s.name === 'passing') { const ca = pair(raw['C/ATT']); v.COMP = ca[0]; v.PATT = ca[1]; v.PYD = n0(raw.YDS); v.PTD = n0(raw.TD); v.INT = n0(raw.INT); }
              if (s.name === 'rushing') { v.CAR = n0(raw.CAR); v.RYD = n0(raw.YDS); v.RTD = n0(raw.TD); }
              if (s.name === 'receiving') { v.TGT = n0(raw.TGTS); v.REC = n0(raw.REC); v.RECY = n0(raw.YDS); v.RECTD = n0(raw.TD); }
              if (s.name === 'defensive') { v.TKL = n0(raw.TOT); v.SCK = n0(raw.SACKS); v.PD = n0(raw.PD); }
              if (s.name === 'kicking') { const fg = pair(raw.FG), xp = pair(raw.XP); v.FGM = fg[0]; v.FGA = fg[1]; v.XPM = xp[0]; v.XPA = xp[1]; }
              const row = Object.assign(p, { unit: s.name, act: logged(labels, stats), raw, v });
              list.push(row);
              let pl = rows.find((r) => r.id === row.id);
              if (!pl) { pl = Object.assign({}, p, { units: {}, act: false, v: {} }); rows.push(pl); }
              pl.units[s.name] = row;
              pl.act = pl.act || row.act;
              Object.assign(pl.v, v);
            });
          }
        });
      });
      // team stats, scoring, plays / drives
      g.teamStats = teamStats(sp, js, g);
      if (sp === 'nhl') (js.onIce || []).forEach((e) => { const code = idCode[String(e.teamId)]; if (code) g.onIce[code] = (e.entries || []).map((x) => String(x.athleteid)); });
      if (sp === 'nhl' && g.onIce) Object.keys(g.players).forEach((code) => { const on = g.onIce[code] || []; g.players[code].forEach((p) => { p.on = on.indexOf(p.id) >= 0; }); (g.goalies[code] || []).forEach((p) => { p.on = on.indexOf(p.id) >= 0; }); });
      if (sp === 'nfl') { g.drives = drives(js, g); g.scoring = nflScoring(js, g); } else { g.plays = plays(sp, js, g); g.scoring = sp === 'nhl' ? nhlScoring(g) : []; }
      return g;
    } catch (err) { return null; }
  }
  // period labels + per-team values from the header linescores
  function lineScore(sp, g) {
    const a = g.away.line, h = g.home.line, n = Math.max(a.length, h.length);
    if (!n) return null;
    const reg = sp === 'nhl' ? 3 : 4;
    const labels = [];
    for (let i = 1; i <= n; i++) labels.push(i <= reg ? (sp === 'nhl' ? String(i) : 'Q' + i) : n - reg === 1 ? 'OT' : 'OT' + (i - reg));
    return { labels, away: labels.map((_, i) => a[i] == null ? '' : a[i]), home: labels.map((_, i) => h[i] == null ? '' : h[i]) };
  }
  // compact team stats from boxscore.teams[].statistics (name -> displayValue); rows: [label, awayText, homeText, awayNum, homeNum, lowerIsBetter]
  const TEAM_ROWS = {
    nba: [['FG', 'fieldGoalsMade-fieldGoalsAttempted', 'pair'], ['3PT', 'threePointFieldGoalsMade-threePointFieldGoalsAttempted', 'pair'], ['FT', 'freeThrowsMade-freeThrowsAttempted', 'pair'], ['REB', 'totalRebounds'], ['AST', 'assists'],
      ['TO', 'totalTurnovers', '', 1], ['Paint', 'pointsInPaint'], ['Fast break', 'fastBreakPoints'], ['Largest lead', 'largestLead']],
    nhl: [['Shots', 'shotsTotal'], ['PP', 'powerPlayGoals', 'pp'], ['FO%', 'faceoffPercent'], ['Hits', 'hits'], ['Blocks', 'blockedShots'], ['Giveaways', 'giveaways', '', 1], ['PIM', 'penaltyMinutes', '', 1]],
    nfl: [['Total yds', 'totalYards'], ['Pass yds', 'netPassingYards'], ['Rush yds', 'rushingYards'], ['Plays', 'totalOffensivePlays'], ['Yds/play', 'yardsPerPlay'], ['3rd down', 'thirdDownEff', 'eff'], ['Turnovers', 'turnovers', '', 1], ['Possession', 'possessionTime', 'time']],
  };
  function teamStats(sp, js, g) {
    const by = {};
    ((js.boxscore && js.boxscore.teams) || []).forEach((t) => {
      const code = teamCode(sp, t.team.abbreviation), m = by[code] = {};
      (t.statistics || []).forEach((s) => { if (s && s.name && m[s.name] === undefined) m[s.name] = s.displayValue == null ? '' : String(s.displayValue); });
    });
    const A = by[g.away.code] || {}, H = by[g.home.code] || {};
    if (!Object.keys(A).length && !Object.keys(H).length) return [];
    return (TEAM_ROWS[sp] || []).map(([label, key, kind, low]) => {
      let a = A[key], h = H[key];
      if (a === undefined && h === undefined) return null;
      if (kind === 'pp') { a = (A.powerPlayGoals || '0') + '/' + (A.powerPlayOpportunities || '0'); h = (H.powerPlayGoals || '0') + '/' + (H.powerPlayOpportunities || '0'); }
      const val = (x) => { if (x == null || x === '') return null; if (kind === 'pair' || kind === 'eff' || kind === 'pp') { const p = pair(x); return p[1] ? p[0] / p[1] : 0; } if (kind === 'time') return secs(x); return num(x); };
      const txt = (x) => (x == null || x === '' ? '—' : kind === 'pair' || kind === 'eff' ? String(x).replace('/', '-') : String(x));
      return { label, a: txt(a), h: txt(h), av: val(a), hv: val(h), low: !!low, sub: kind === 'pair' ? [pct(pair(a)), pct(pair(h))] : null };
    }).filter(Boolean);
  }
  const pct = (p) => (p[1] ? Math.round(p[0] / p[1] * 100) + '%' : '');

  // ---- plays (NBA / NHL) -> normalized events, oldest first ----
  // { t: game seconds elapsed, period, clock, code: team code (NHL blocked shots: the SHOOTER's team, from participants), type, scoring, pts, home/away score after, text, who }
  function plays(sp, js, g) {
    const idTeam = {}; // athlete id -> code (NHL blocked-shot attribution; the play's team is the blocking team in the real feed)
    Object.keys(g.players).forEach((c) => { g.players[c].forEach((p) => { idTeam[p.id] = c; }); (g.goalies[c] || []).forEach((p) => { idTeam[p.id] = c; }); });
    const out = [];
    (js.plays || []).forEach((x) => {
      try {
        const type = String((x.type && x.type.text) || ''), per = x.period && isNum(x.period.number) ? x.period.number : null, clock = x.clock && x.clock.displayValue != null ? String(x.clock.displayValue) : '';
        const t = elapsed(sp, per, clock);
        if (t === null) return;
        let code = x.team && x.team.id != null ? g.idCode[String(x.team.id)] || '' : '';
        const parts = Array.isArray(x.participants) ? x.participants : [];
        let who = '';
        if (sp === 'nhl') {
          const sh = parts.find((p) => p.type === 'shooter' || p.type === 'scorer');
          if (sh && sh.athlete) { if (type === 'Blocked' && idTeam[String(sh.athlete.id)]) code = idTeam[String(sh.athlete.id)]; who = String(sh.athlete.displayName || ''); }
        }
        out.push({ t, period: per, clock, code, type, scoring: x.scoringPlay === true, pts: isNum(x.scoreValue) ? x.scoreValue : 0, away: n0(x.awayScore), home: n0(x.homeScore), text: String(x.text || ''), who,
          strength: sp === 'nhl' && x.strength && x.strength.abbreviation ? String(x.strength.abbreviation) : '' });
      } catch (e) { /* skip a malformed play */ }
    });
    return out;
  }
  function nhlScoring(g) {
    return g.plays.filter((p) => p.type === 'Goal').map((p) => ({ code: p.code, period: p.period, clock: p.clock, away: p.away, home: p.home, text: p.text, who: p.who, strength: p.strength }));
  }
  // NFL drives: { current: drive|null, previous: [drive] (latest first) } ; drive = { code, result, text, yards, plays, time, score, start }
  function drives(js, g) {
    const d = js.drives || {};
    const one = (x, cur) => {
      if (!x || !x.team) return null;
      return { code: teamCode('nfl', x.team.abbreviation), result: x.result == null ? '' : String(x.result), text: x.displayResult == null ? (cur ? 'In progress' : '') : String(x.displayResult),
        yards: n0(x.yards), plays: n0(x.offensivePlays), time: x.timeElapsed && x.timeElapsed.displayValue ? String(x.timeElapsed.displayValue) : '', score: x.isScore === true,
        start: x.start && x.start.text ? String(x.start.text) : '', period: x.start && x.start.period && isNum(x.start.period.number) ? x.start.period.number : null, cur: !!cur };
    };
    const raw = Array.isArray(d.previous) ? d.previous : [];
    const cur = one(d.current, true);
    // the feed lists the current drive under both keys once it has plays: drop that copy from previous
    const dup = cur && d.current.id != null && raw.length && String(raw[raw.length - 1].id) === String(d.current.id);
    const previous = (dup ? raw.slice(0, -1) : raw).map((x) => one(x, false)).filter(Boolean).reverse();
    return { current: cur, previous };
  }
  function nflScoring(js, g) {
    return (js.scoringPlays || []).map((s) => {
      try {
        return { code: s.team ? teamCode('nfl', s.team.abbreviation) : '', kind: String((s.type && s.type.abbreviation) || ''), period: s.period && isNum(s.period.number) ? s.period.number : null,
          clock: s.clock && s.clock.displayValue != null ? String(s.clock.displayValue) : '', away: n0(s.awayScore), home: n0(s.homeScore), text: String(s.text || '') };
      } catch (e) { return null; }
    }).filter(Boolean);
  }

  // ---- momentum: factual windows only (no score, no weighting) ----
  // NBA: points per team over the last 5:00 and 10:00 of game clock, plus the current unanswered run (shown from 6-0). NHL: shot attempts (S + missed + blocked), shots on goal
  // and goals per team over the same windows, plus the latest power play seen in the play feed. NFL: the current drive and the last `n` finished drives.
  // Windows end at the latest play in the feed (the feed's own time, never the wall clock).
  function momentum(sp, g, n) {
    if (!g) return null;
    const A = g.away.code, H = g.home.code;
    if (sp === 'nfl') {
      if (!g.drives) return null;
      return { kind: 'drives', current: g.drives.current, recent: g.drives.previous.slice(0, n || 6), scoring: g.scoring };
    }
    const ev = g.plays;
    if (!ev.length) return null;
    const now = ev[ev.length - 1].t;
    const win = (sec) => ev.filter((p) => p.t > now - sec && p.t <= now);
    const sum = (list, fn) => { const o = {}; o[A] = 0; o[H] = 0; list.forEach((p) => { if (p.code === A || p.code === H) o[p.code] += fn(p); }); return o; };
    const windows = [300, 600].map((sec) => {
      const list = win(sec), o = { label: 'Last ' + sec / 60 + ' min', secs: sec, from: mmss(Math.max(0, now - sec)) };
      if (sp === 'nba') o.pts = sum(list, (p) => (p.scoring ? p.pts : 0));
      else { o.att = sum(list, (p) => (p.type === 'Shot' || p.type === 'Goal' || p.type === 'Missed' || p.type === 'Blocked' ? 1 : 0)); o.sog = sum(list, (p) => (p.type === 'Shot' || p.type === 'Goal' ? 1 : 0)); o.goals = sum(list, (p) => (p.type === 'Goal' ? 1 : 0)); }
      return o;
    });
    const out = { kind: sp, at: now, atText: ev[ev.length - 1].clock + (ev[ev.length - 1].period ? ' · ' + perLabel(sp, ev[ev.length - 1].period) : ''), windows, scoring: g.scoring };
    if (sp === 'nba') { // unanswered run: points by the team that scored last since the other team's last score
      let runTeam = '', run = 0;
      for (let i = ev.length - 1; i >= 0; i--) {
        const p = ev[i];
        if (!p.scoring || !p.code) continue;
        if (!runTeam) runTeam = p.code;
        if (p.code !== runTeam) break;
        run += p.pts;
      }
      out.run = runTeam && run >= 6 ? { code: runTeam, pts: run } : null;
      out.byPeriod = g.periods;
    } else { // latest strength seen with a team (relative to the play's team: 'power-play' = that team is on the PP, 'short-handed' = the other team is)
      let pp = null;
      for (let i = ev.length - 1; i >= 0; i--) {
        const p = ev[i];
        if (!p.code || !p.strength) continue;
        if (p.strength === 'power-play') pp = { code: p.code, clock: p.clock, period: p.period };
        else if (p.strength === 'short-handed') pp = { code: p.code === A ? H : A, clock: p.clock, period: p.period };
        break;
      }
      out.pp = pp;
    }
    return out;
  }
  const perLabel = (sp, n) => (sp === 'nhl' ? (n <= 3 ? ['1st', '2nd', '3rd'][n - 1] : n === 4 ? 'OT' : 'SO') : n <= 4 ? ['1st', '2nd', '3rd', '4th'][n - 1] : n === 5 ? 'OT' : 'OT' + (n - 4));

  // ---- usage splits ----
  // rows = one team's player rows (stat-logged or not). -> [{ row, vals: { KEY: raw number }, share: { KEY: 0..1 } }] with the team totals in `.team`
  function usage(sp, rows) {
    const cols = USAGE[sp] || [], team = {};
    const list = (rows || []).map((r) => {
      const vals = {};
      cols.forEach(([k]) => { vals[k] = isNum(r.v[k]) ? r.v[k] : 0; });
      return { row: r, vals, share: {} };
    });
    cols.forEach(([k, , sh]) => { if (sh) team[k] = list.reduce((t, x) => t + x.vals[k], 0); });
    list.forEach((x) => { cols.forEach(([k, , sh]) => { if (sh) x.share[k] = team[k] ? x.vals[k] / team[k] : 0; }); });
    list.team = team;
    return list;
  }
  // sort key for usage mode: the sport's main usage stats in order, then the box order (stable)
  function usageSort(sp, list) {
    const keys = { nba: ['FGA', 'FTA', 'MIN'], nhl: ['ATT', 'TOI', 'PPTOI'], nfl: ['TGT', 'CAR', 'PATT'] }[sp] || [];
    return list.map((x, i) => [x, i]).sort((p, q) => { for (const k of keys) { const d = (q[0].vals[k] || 0) - (p[0].vals[k] || 0); if (d) return d; } return p[1] - q[1]; }).map((p) => p[0]);
  }
  // players shown in the live box: stat logged (live.js rule) or pinned (a My Bets player). NBA DNP rows never show.
  const shown = (rows, pinned) => (rows || []).filter((r) => !r.dnp && (r.act || (pinned && pinned[r.id])));

  // ---- My Bets on this game ----
  // bets = open My Bets entries (mybets.js shape). Match by sport + gid, else sport + date + away/home. -> by team code: { CODE: [bet] } (game-line bets under '' )
  function betsFor(bets, sport, gid, date, away, home) {
    const out = {};
    (bets || []).forEach((b) => {
      if (!b || b.sport !== sport || b.status !== 'open') return;
      const hit = (gid && String(b.gid) === String(gid)) || (b.date === date && b.away === away && b.home === home);
      if (!hit) return;
      const k = b.type === 'prop' ? (b.team === away || b.team === home ? b.team : '') : '';
      (out[k] = out[k] || []).push(b);
    });
    return out;
  }

  // ---- break in play (owner 11/01 18:50: comparison bars first at halftime, live content first while the clock runs) ----
  // Real captures show STATUS_END_PERIOD ("End of 1st" NHL, "End of 3rd" NFL) for every period break; STATUS_HALFTIME is ESPN's documented halftime
  // status (not in the 11/01 captures, so matched by name only). NBA / NFL: halftime = the break after period 2 (either status); NHL: every intermission.
  function atBreak(g) {
    if (!g || g.state !== 'in') return false;
    if (g.typeName === 'STATUS_HALFTIME') return true;
    if (g.typeName !== 'STATUS_END_PERIOD') return false;
    return g.sport === 'nhl' ? true : g.period === 2;
  }

  // ---- "on pace for" (private demo, ?pace=1 only; formulas in docs/3-model/PACE_MODEL.md, fitted values in app/pace_params.json) ----
  // Owner rule (BUILD_PLAN 11/01 14:03 + "Standard for all projection math"): shown by default only after the owner has reviewed the formulas.
  // final = current + expected remaining. NBA: remaining minutes (share of the clock left he plays: pregame minutes, minutes so far, on the floor, starter, fouls, blowout z)
  // times the blended per-minute rate (pregame rate vs live rate, weight = minutes / (minutes + k)) times a fitted scale s. NFL: time left times the blended per-game rate
  // (weight w on the live pace, 1 - w on the pregame mean) times a fitted scale s times a game-script factor (1 + b * margin / 10). Parameters sit at fitted game times
  // (NBA minutes 6/12/24/36/42, NFL 15/30/45) and are interpolated in between (k in log10); outside the nodes the nearest node is used.
  // Pure: no DOM, no clock; paceCalc(sp, inp, P) mirrors scripts/backtest/pace_fit.py exactly (golden cases in tests/fixtures/pace_golden_*.json).
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, f) => a + (b - a) * f;
  function nodePos(nodes, t) {
    if (t <= nodes[0]) return [0, 0, 0];
    const n = nodes.length - 1;
    if (t >= nodes[n]) return [n, n, 0];
    for (let i = 0; i < n; i++) if (t <= nodes[i + 1]) return [i, i + 1, (t - nodes[i]) / (nodes[i + 1] - nodes[i])];
    return [n, n, 0];
  }
  // NBA features of the minutes model (all per-unit, so the minutes scale with the clock left)
  function nbaFeat(inp, names) {
    const tel = inp.tmin, tl = 48 - tel, m0 = inp.pre.min, z = Math.min(Math.abs(inp.margin) / Math.sqrt(tl), 6);
    const f = { '1': 1, m0n: m0 / 48, livef: inp.min / tel, on: inp.on ? 1 : 0, starter: inp.starter ? 1 : 0, fouls: inp.fouls, f4: inp.fouls >= 4 ? 1 : 0, f5: inp.fouls >= 5 ? 1 : 0, z, z_star: z * m0 / 36 };
    return names.map((n) => f[n]);
  }
  // inp (nba) = { tmin, min, pts, reb, ast, tpm, fouls, margin (his team's lead), on, starter, pre: { min, pts, reb, ast, tpm } } -> { minRem, pts, reb, ast, tpm, pra } | null
  // inp (nfl) = { tsec, margin, cur: { pyd.. }, pre: { pyd.. } } -> { stat: projected final } for every stat with cur and pre
  function paceCalc(sp, inp, P) {
    try {
      if (!P || !inp || !inp.pre) return null;
      if (sp === 'nba') {
        const C = P.nba;
        if (!C || !(inp.tmin >= C.minElapsed) || inp.tmin > 48 || !(inp.pre.min > 0)) return null;
        const [i, j, f] = nodePos(C.nodesMin, inp.tmin), A = C.nodes[i], B = C.nodes[j];
        const x = nbaFeat(inp, C.features);
        let g = 0;
        x.forEach((v, q) => { g += v * lerp(A.minBeta[q], B.minBeta[q], f); });
        const tl = 48 - inp.tmin, rm = tl * clamp(g, 0, 1), out = { minRem: rm };
        for (const st of ['pts', 'reb', 'ast', 'tpm']) {
          if (!isNum(inp.pre[st]) || !isNum(inp[st])) continue; // no pregame mean (no line) for this stat: no number
          const sa = A.stats[st], sb = B.stats[st], k = Math.pow(10, lerp(Math.log10(sa.k), Math.log10(sb.k), f)), s = lerp(sa.s, sb.s, f);
          const cm = inp.min, c = inp[st], pre = inp.pre[st] / inp.pre.min;
          const live = cm > 0.5 ? c / Math.max(cm, 0.5) : pre, w = cm / (cm + k);
          out[st] = c + s * rm * (w * live + (1 - w) * pre);
        }
        if (isNum(out.pts) && isNum(out.reb) && isNum(out.ast)) out.pra = out.pts + out.reb + out.ast;
        return out;
      }
      if (sp === 'nfl') {
        const C = P.nfl;
        if (!C || !(inp.tsec >= C.minElapsed) || inp.tsec > 3600) return null;
        const [i, j, f] = nodePos(C.nodesSec, inp.tsec), tl = (3600 - inp.tsec) / 3600, el = 1 - tl, mg = clamp(inp.margin, -21, 21) / 10, out = {};
        for (const st of Object.keys(C.nodes[0])) {
          const c = inp.cur[st], pre = inp.pre[st];
          if (!isNum(c) || !isNum(pre)) continue;
          const a = C.nodes[i][st], b = C.nodes[j][st], w = lerp(a.w, b.w, f), s = lerp(a.s, b.s, f), bb = lerp(a.b, b.b, f);
          out[st] = c + s * tl * (w * (c / el) + (1 - w) * pre) * (1 + bb * mg);
        }
        return out;
      }
    } catch (e) { /* malformed input: no number */ }
    return null;
  }
  // game clock text -> seconds (status.displayClock: "7:21" or, in the last minute, "45.3")
  const clockSecs = (s) => { const t = String(s == null ? '' : s); if (t.indexOf(':') >= 0) { const p = t.split(':'); return n0(p[0]) * 60 + n0(p[1]); } return n0(t); };
  // One player row of a parsed game (parseGame) -> { key: projected final } for the stats the params say are shown, or null.
  // g = parseGame result, code = the player's team code, pre = pregame means { min, pts.. } (NBA) / { pyd, comp, patt, ryd, ratt, recy, rec } (NFL), P = pace_params.json.
  // Only while the game is in play and in regulation; the number is a projection of the final stat (current included).
  function onPace(sp, row, g, pre, P, code) {
    try {
      if (!g || g.state !== 'in' || !row || !pre || !P || !isNum(g.period) || g.period < 1) return null;
      if ((sp !== 'nba' && sp !== 'nfl') || g.period > 4) return null;
      const margin = code === g.home.code ? g.home.score - g.away.score : g.away.score - g.home.score;
      const len = sp === 'nba' ? 720 : 900, el = (g.period - 1) * len + len - clockSecs(g.clock);
      let out = null;
      if (sp === 'nba') {
        if (row.dnp || !row.v) return null;
        out = paceCalc('nba', { tmin: el / 60, min: row.v.MIN, pts: row.v.PTS, reb: row.v.REB, ast: row.v.AST, tpm: row.v['3PM'], fouls: row.v.PF, margin, on: row.on === true, starter: row.starter === true, pre }, P);
        if (out) delete out.minRem;
      } else {
        const v = row.v || {};
        const cur = { pyd: v.PYD, comp: v.COMP, patt: v.PATT, ryd: v.RYD, ratt: v.CAR, recy: v.RECY, rec: v.REC };
        const q = (P.nfl && P.nfl.qual) || {};
        const all = paceCalc('nfl', { tsec: el, margin, cur, pre }, P);
        if (all) {
          out = {};
          Object.keys(all).forEach((st) => { const r = q[st]; if (r && isNum(pre[r[0]]) && pre[r[0]] >= r[1]) out[st] = all[st]; });
        }
      }
      if (!out) return null;
      const show = (P[sp] && P[sp].show) || [], res = {};
      show.forEach((st) => { if (isNum(out[st])) res[st] = out[st]; });
      return Object.keys(res).length ? res : null;
    } catch (e) { return null; }
  }

  const api = { COLS, NFL_UNITS, NFL_UNIT_LABEL, USAGE, USAGE_SORT, elapsed, secs, mmss, pair, parseGame, lineScore, teamStats, plays, drives, momentum, perLabel, usage, usageSort, shown, betsFor, atBreak, onPace, paceCalc, clockSecs };
  root.LiveGame = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof window !== 'undefined' ? window : globalThis));
