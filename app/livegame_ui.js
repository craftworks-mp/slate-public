// Live Game tab: rendering + polling (owner-approved 11/01 18:45). Logic lives in livegame.js (window.LiveGame) and live.js (window.Live);
// app.js wires this in through LiveGameUI.init(deps) and three small hooks (liveGameView, render, the click handler).
// Polls ESPN's summary for the one game on screen every 30 s while the game page is shown and the document is visible; stops otherwise.
// Failures keep the last values and show "Live data unavailable". Nothing is written to storage.
(function (root) {
  'use strict';
  const L = root.Live, G = root.LiveGame;
  const PRE_MS = 10 * 60000, POST_MS = 24 * 3600000; // same window as live.js eligible()
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  let D = null; // deps from app.js
  const st = { mode: 'box', open: {} }; // Box | Usage toggle; folds
  const lg = { key: '', ctx: null, evId: '', data: null, raw: null, failed: false, timer: 0, gen: 0, busy: false, finalDone: false, lastKey: '' };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function init(deps) { D = deps; }

  // ---- "On pace" (private demo: only with ?pace=1 in the URL; the owner reviews the formulas, docs/PACE_MODEL.md, before it is ever shown by default) ----
  // Pregame means come from the published slate (../slates/<sport>/<date>.json: proj.close|open[stat].v, min.close|open); fitted values from pace_params.json.
  // A stat without a pregame mean (no line that day) gets no number. The projection itself is the pure LiveGame.onPace.
  const paceFlag = () => { try { return /(^|[?&])pace=1(&|$)/.test(location.search); } catch (e) { return false; } };
  const pc = { params: null, loading: false, slate: {}, idx: {} };
  const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
  function paceLoad(ctx) {
    if (!paceFlag() || !ctx || (ctx.sport !== 'nba' && ctx.sport !== 'nfl')) return;
    if (!pc.params && !pc.loading) {
      pc.loading = true;
      fetch('pace_params.json').then((r) => (r.ok ? r.json() : false)).catch(() => false).then((j) => { pc.params = j || false; D.rerender(); });
    }
    if (!(ctx.key in pc.slate)) {
      pc.slate[ctx.key] = null;
      fetch('../slates/' + ctx.sport + '/' + ctx.date + '.json').then((r) => (r.ok ? r.json() : false)).catch(() => false).then((j) => {
        pc.slate[ctx.key] = j || false;
        const ix = pc.idx[ctx.key] = {};
        Object.values((j && j.players) || {}).forEach((p) => { ix[p.team + '|' + normName(p.name)] = p; });
        D.rerender();
      });
    }
  }
  function preOf(sport, p) {
    const pj = (k) => { const q = p.proj && ((p.proj.close && p.proj.close[k]) || (p.proj.open && p.proj.open[k])); return q && isNum(q.v) ? q.v : undefined; };
    if (sport === 'nba') {
      const mn = p.min && (isNum(p.min.close) ? p.min.close : p.min.open);
      return { min: isNum(mn) ? mn : undefined, pts: pj('pts'), reb: pj('reb'), ast: pj('ast'), tpm: pj('tpm') };
    }
    return { pyd: pj('pyd'), comp: pj('comp'), patt: pj('patt'), ryd: pj('ryd'), ratt: pj('ratt'), recy: pj('recy'), rec: pj('rec') };
  }
  // -> { stat: projected final } for one box row, or null (flag off, params / slate not loaded, no pregame mean, game not in play, ...)
  function paceOf(sport, ctx, d, code, row) {
    if (!paceFlag() || !pc.params || !pc.slate[ctx.key] || !row) return null;
    const p = (pc.idx[ctx.key] || {})[code + '|' + normName(row.name)];
    if (!p) return null;
    return G.onPace(sport, row, d, preOf(sport, p), pc.params, code);
  }
  const PACE_LAB = { pts: 'pts', reb: 'reb', ast: 'ast', pra: 'pra', pyd: 'yds', comp: 'cmp', patt: 'att', ryd: 'yds', ratt: 'car', recy: 'yds', rec: 'rec' };
  const PACE_ROW = { nba: ['pts', 'reb', 'ast'], passing: ['pyd', 'comp', 'patt'], rushing: ['ryd', 'ratt'], receiving: ['recy', 'rec'] };
  const paceN = (v) => (v >= 10 ? String(Math.round(v)) : v.toFixed(1));
  // live box row: "On pace 27 pts 8 reb 6 ast" under the player's name (one compact number per tracked stat)
  function paceRow(sport, ctx, d, code, unit) {
    return (r) => {
      const m = paceOf(sport, ctx, d, code, r), keys = PACE_ROW[sport === 'nba' ? 'nba' : unit] || [];
      const parts = m ? keys.filter((k) => isNum(m[k])).map((k) => `<b>${paceN(m[k])}</b> ${PACE_LAB[k]}`) : [];
      return parts.length ? `<small class="pc-line"><i>On pace</i> ${parts.join(' · ')}</small>` : '';
    };
  }

  // ---- which games get the live treatment ----
  // in the window from 10 min before the stored kickoff to 24 h after, not postponed. -> ctx or null
  function ctxFor(sport, g, date) {
    if (!g || g.status === 'post' || !g.kickoff) return null;
    const t = Date.parse(g.kickoff);
    if (isNaN(t)) return null;
    const now = Date.now();
    if (now < t - PRE_MS || now > t + POST_MS) return null;
    return { sport, gid: g.gid, date, away: g.away, home: g.home, key: sport + '|' + date + '|' + g.away + '|' + g.home, g };
  }

  // ---- page hook: called by liveGameView ----
  // -> { ctx, view: null | { center, body, brk } }. view is set only once the summary says the game is live or over (pregame pages are unchanged).
  // brk = at a break in play (halftime / intermission): the Game tab then shows the comparison bars first and the live content below (owner 11/01 18:50).
  function page(sport, g, date) {
    const ctx = ctxFor(sport, g, date);
    if (!ctx) return { ctx: null, view: null };
    if (lg.key !== ctx.key) { // another game (any sport): drop the old page's state AND its pending poll, so the new page fetches at once (a request still in flight is discarded by its gen check)
      lg.key = ctx.key; lg.ctx = ctx; lg.evId = ''; lg.data = null; lg.raw = null; lg.failed = false; lg.finalDone = false;
      stop();
    }
    lg.ctx = ctx;
    const d = lg.data;
    paceLoad(ctx);
    if (!d || (d.state !== 'in' && d.state !== 'post')) return { ctx, view: null };
    return { ctx, view: { center: center(d), body: body(ctx, d), brk: G.atBreak(d) } };
  }

  // ---- header center: score (white; at the final winner bold, loser muted, as the My Bets score rows) + period / clock ----
  function center(d) {
    const fin = d.state === 'post', wA = fin && d.away.score > d.home.score, wH = fin && d.home.score > d.away.score;
    const cls = (w) => (fin ? (w ? 'w' : 'l') : 'w');
    const score = `<span class="big fin pg-sc"><span class="${cls(wA)}">${esc(d.away.score)}</span><i>–</i><span class="${cls(wH)}">${esc(d.home.score)}</span></span>`;
    const tags = [];
    if (d.sport === 'nfl' && !fin) { if (d.away.poss) tags.push(d.away.code + ' ball'); else if (d.home.poss) tags.push(d.home.code + ' ball'); }
    const status = fin ? `<span class="lbl">Final${d.periods && d.periods.labels.length > (d.sport === 'nhl' ? 3 : 4) ? ' <em class="pg-ot">' + esc(d.periods.labels[d.periods.labels.length - 1]) + '</em>' : ''}</span>`
      : `<span class="lbl amber lg-clock">${esc(d.detail || 'Live')}</span>`;
    return `${score}${status}${tags.map((t) => `<span class="kline lg-poss">${esc(t)}</span>`).join('')}`;
  }

  // ---- body ----
  function body(ctx, d) {
    const sport = ctx.sport;
    const note = lg.failed ? '<div class="lv-note lg-note">Live data unavailable</div>' : '';
    const bets = G.betsFor(Object.values(D.bets()), sport, ctx.gid, ctx.date, ctx.away, ctx.home);
    const sum = D.lvCache.games[ctx.key] && D.lvCache.games[ctx.key].sum;
    const pinned = {}; // team code -> { espnId: [bet] }
    [ctx.away, ctx.home].forEach((code) => {
      pinned[code] = {};
      (bets[code] || []).forEach((b) => {
        const row = sum ? L.findPlayer(sport, sum, code, D.lvName(b), b.pid) : null;
        const id = row ? row.id : 'bet:' + b.id; // not in the box yet: still pinned, under its own key
        (pinned[code][id] = pinned[code][id] || []).push(b);
      });
    });
    const cc = D.cmpColors(sport, ctx.g);
    const colors = `style="--ca:${cc[0]};--ch:${cc[1]}"`;
    let out = (G.atBreak(d) ? D.sec(d.sport === 'nhl' ? 'Intermission · live game' : 'Halftime · live game') : '') + note + lineScore(sport, d);
    out += momentum(sport, ctx, d, colors);
    if (bets[''] && bets[''].length) out += gameBets(bets['']);
    out += toggle(sport);
    out += teamBox(sport, ctx, d, ctx.away, pinned[ctx.away]);
    out += teamBox(sport, ctx, d, ctx.home, pinned[ctx.home]);
    out += teamStats(sport, ctx, d, colors);
    out += `<p class="lg-foot">ESPN live box · updates every 30 s while this page is open${d.state === 'post' ? ' · final' : G.atBreak(d) ? ' · break in play' : ''}</p>`;
    return out;
  }
  function lineScore(sport, d) {
    const P = d.periods;
    if (!P || !P.labels.length) return '';
    const fin = d.state === 'post';
    const row = (code, arr, tot, win) => `<span class="pg-lc${win ? ' w' : ''}">${esc(code)}</span>${P.labels.map((_, i) => `<span>${arr[i] === '' ? '—' : esc(arr[i])}</span>`).join('')}<span class="pg-lt${win ? ' w' : ''}">${esc(tot)}</span>`;
    return `<div class="card pg-ls lg-ls" style="--n:${P.labels.length}" aria-label="Line score"><span></span>${P.labels.map((l) => `<span class="pg-lh">${esc(l)}</span>`).join('')}<span class="pg-lh">T</span>
      ${row(d.away.code, P.away, d.away.score, fin && d.away.score > d.home.score)}${row(d.home.code, P.home, d.home.score, fin && d.home.score > d.away.score)}</div>`;
  }
  // two-team row with a split bar (same look as the team comparison / Final-mode totals)
  function cmpRow(label, a, h, av, hv, low, subA, subH) {
    let share = 0.5, ba = false, bh = false;
    if (isNum(av) && isNum(hv) && av !== hv) { const tot = Math.abs(av) + Math.abs(hv); share = tot ? 0.5 + 0.4 * Math.tanh(4 * (av - hv) / tot) : 0.5; ba = low ? av < hv : av > hv; bh = !ba; }
    const la = isNum(av) && isNum(hv) && av > hv, lh = isNum(av) && isNum(hv) && hv > av;
    return `<div><div class="cmp-top"><span class="v${ba ? ' best' : ''}">${esc(a)}${subA ? `<small class="pg-sub">${esc(subA)}</small>` : ''}</span><span class="lab">${esc(label)}</span><span class="v${bh ? ' best' : ''}">${esc(h)}${subH ? `<small class="pg-sub">${esc(subH)}</small>` : ''}</span></div>
      <div class="split tc"><i class="${la ? 'lead' : ''}" style="flex:${share}"></i><i class="${lh ? 'lead' : ''}" style="flex:${1 - share}"></i></div></div>`;
  }
  const teamsHead = (A, H) => `<div class="cmp-teams"><span><b><i class="tdot a"></i>${esc(A)}</b></span><span><b>${esc(H)}<i class="tdot h"></i></b></span></div>`;
  // ---- momentum strip: real events only ----
  function momentum(sport, ctx, d, colors) {
    const m = G.momentum(sport, d, 6);
    if (!m) return '';
    const A = d.away.code, H = d.home.code; // the summary's own codes (what the play feed is keyed on)
    let inner = '';
    if (m.kind === 'drives') {
      const line = (x) => `<div class="lg-drive${x.cur ? ' cur' : ''}${x.score ? ' sc' : ''}"><span class="lg-dt"><i class="tdot ${x.code === A ? 'a' : 'h'}"></i>${esc(x.code)}</span><span class="lg-dd">${esc(x.plays)} plays · ${esc(x.yards)} yds · ${esc(x.time)}${x.start ? ` · from ${esc(x.start)}` : ''}</span><span class="lg-dr">${esc(x.cur ? (d.state === 'post' ? '—' : 'Drive on') : x.text || x.result || '—')}</span></div>`;
      const list = (m.current ? [m.current] : []).concat(m.recent);
      if (!list.length) return '';
      inner = `<div class="lg-drives">${list.map(line).join('')}</div>`;
      return `${D.sec('Drives')}<div class="card lg-mom" ${colors}>${teamsHead(A, H)}${inner}</div>`;
    }
    const rows = [];
    if (m.kind === 'nba') {
      m.windows.forEach((w) => rows.push(cmpRow(w.label + ' · pts', w.pts[A], w.pts[H], w.pts[A], w.pts[H], false)));
      const run = m.run ? `<div class="lg-chipline"><span class="lg-pill amber">${esc(m.run.code)} ${esc(m.run.pts)}-0 run</span></div>` : '';
      inner = rows.join('') + run;
    } else {
      m.windows.forEach((w) => rows.push(cmpRow(w.label + ' · attempts', w.att[A], w.att[H], w.att[A], w.att[H], false, w.sog[A] + ' on goal · ' + w.goals[A] + ' G', w.sog[H] + ' on goal · ' + w.goals[H] + ' G')));
      const pp = m.pp ? `<div class="lg-chipline"><span class="lg-pill amber">${esc(m.pp.code)} power play</span><span class="lg-chipnote">latest play ${esc(m.pp.clock)} · ${esc(G.perLabel('nhl', m.pp.period))}</span></div>` : '';
      inner = rows.join('') + pp;
    }
    return `${D.sec('Momentum')}<div class="card cmp pg-cmp lg-mom" ${colors}>${teamsHead(A, H)}${inner}<div class="lg-momfoot">Through the latest play (${esc(m.atText)}) · from the ESPN play feed</div></div>`;
  }
  // game-line bets on this game (total / team total / moneyline / spread): the My Bets live row as is
  function gameBets(list) {
    return `${D.sec('My bets · game lines')}<div class="card lg-pin">${list.map((b) => `<div class="lg-pinrow"><span class="lg-pinlab">${esc(b.label)}<small>${esc(D.fmtOdds(b.odds))} · ${esc(b.units)}u</small></span>${betLive(b)}</div>`).join('')}</div>`;
  }
  // a pinned bet's live row; a player the slate lists as Out gets a calm "Out · injury report" instead of "No stats yet"
  const betLive = (b) => {
    const h = D.lvHtml(b);
    if (h) return `<div class="lv-wrap lg-lv" data-lv="${esc(b.id)}">${h}</div>`;
    const inj = D.injOf ? D.injOf(b.sport, b.date, b.pid) : '';
    if (/^out\b/i.test(inj)) return '<div class="lv-wrap lg-lv lg-nostat lg-out"><span class="lv-t">Out · injury report</span></div>';
    return '<div class="lv-wrap lg-lv lg-nostat"><span class="lv-t">No stats yet · Live</span></div>';
  };
  // Box | Usage segment, then its one-line note in its own element under it (demo round 2)
  const toggle = (sport) => `<div class="bets-head lg-head">${D.segmented([['box', 'Box'], ['usage', 'Usage']], st.mode, 'data-lg', 'sortseg lg-seg')}</div><p class="lg-tognote">${st.mode === 'usage' ? usageNote(sport) : 'Players with a stat logged · My Bets pinned first'}</p>`;
  const usageNote = (sport) => ({ nba: 'Shot + FT attempts as a share of the team', nhl: 'Ice time, shifts, attempts (S + missed) as a share of the team', nfl: 'Targets, carries as a share of the team, pass attempts' }[sport] || '');

  // ---- team box ----
  function teamBox(sport, ctx, d, code, pins) {
    const rows = d.players[code] || [], fk = sport + '/' + ctx.gid + '/' + code;
    const pinIds = Object.keys(pins || {});
    const list = G.shown(rows, pins);
    const hidden = rows.filter((r) => !r.dnp && !r.act && !(pins && pins[r.id])).length;
    const title = D.sec(code + ' live box');
    // pinned bets first (player name + bet + the My Bets live row), then the table with pinned players highlighted at the top
    let pinHtml = '';
    pinIds.forEach((id) => {
      const row = rows.find((r) => r.id === id), bets = pins[id];
      const name = row ? row.name : (D.lvName(bets[0]) || bets[0].label);
      const pm = row ? paceOf(sport, ctx, d, code, row) : null; // On pace (?pace=1 only): the bet's own stat, projected final
      const paceTag = (b) => (pm && isNum(pm[b.market]) ? `<small class="pc-pin">On pace <b>${pm[b.market].toFixed(1)}</b></small>` : '');
      pinHtml += `<div class="lg-pinrow"><span class="lg-pinlab"><b>${esc(name)}</b>${bets.map((b) => `<small>${esc(betText(b))} · ${esc(D.fmtOdds(b.odds))} · ${esc(b.units)}u</small>${paceTag(b)}`).join('')}</span>${bets.map(betLive).join('')}</div>`;
    });
    const order = (xs) => { const pin = xs.filter((r) => pins && pins[r.id]), rest = xs.filter((r) => !(pins && pins[r.id])); return pin.concat(rest); };
    // in play (NBA `active` / NHL `onIce`, both verified as the players on the floor / ice): pinned first, then on floor, a slim "Bench" divider, the rest.
    // No divider at a break or after the final (the flag then still marks the last lineup) and none when nobody is flagged.
    const divide = (xs) => {
      if (d.state !== 'in' || G.atBreak(d) || !xs.some((r) => r.on)) return xs;
      const isPin = (r) => pins && pins[r.id], pin = xs.filter(isPin), on = xs.filter((r) => !isPin(r) && r.on), off = xs.filter((r) => !isPin(r) && !r.on);
      return pin.concat(on, off.length ? [{ divider: 'Bench' }] : [], off);
    };
    let inner = '';
    if (!list.length) inner = `<p class="pg-dnp">${d.state === 'post' ? 'No player stats in the box.' : 'No player has logged a stat yet.'}</p>`;
    else if (st.mode === 'usage') inner = usageTable(sport, list, pins);
    else if (sport === 'nba') {
      const starters = list.filter((r) => r.starter), bench = list.filter((r) => !r.starter);
      inner = table(sport, G.COLS.nba, divide(order(starters.concat(bench))), pins, 'Players', (r) => (r.on && d.state === 'in' ? 'On floor' : ''), undefined, paceRow(sport, ctx, d, code));
    } else if (sport === 'nhl') {
      const sk = list.slice().sort((x, y) => y.v.TOI - x.v.TOI), LEAD = 10, open = !!st.open[fk] || sk.length <= LEAD + 2;
      const shown = order(open ? sk : sk.slice(0, LEAD).concat(sk.slice(LEAD).filter((r) => pins && pins[r.id])));
      const gl = (d.goalies[code] || []).filter((p) => p.act);
      inner = table(sport, G.COLS.nhl, divide(shown), pins, 'Skaters', (r) => (r.on && d.state === 'in' ? 'On ice' : ''))
        + (!open ? `<button class="pg-fold" data-lg="fold:${esc(fk)}" aria-expanded="false">${sk.length - LEAD} more skaters</button>` : sk.length > LEAD + 2 ? `<button class="pg-fold" data-lg="fold:${esc(fk)}" aria-expanded="true">Fewer skaters</button>` : '')
        + (gl.length ? table(sport, G.COLS.nhlG, gl, {}, 'Goalies', (r) => (r.on && d.state === 'in' ? 'In net' : '')) : '');
    } else {
      inner = G.NFL_UNITS.map((unit) => {
        const ulist = order(list.filter((r) => r.units[unit] && (r.units[unit].act || (pins && pins[r.id]))).sort((x, y) => unitSort(unit, y) - unitSort(unit, x)));
        if (!ulist.length) return '';
        const LEAD = unit === 'defensive' ? 6 : 99, uk = fk + '/' + unit, open = !!st.open[uk] || ulist.length <= LEAD;
        return table(sport, G.COLS.nfl[unit], open ? ulist : ulist.slice(0, LEAD), pins, G.NFL_UNIT_LABEL[unit], null, unit, paceRow(sport, ctx, d, code, unit))
          + (ulist.length > LEAD ? `<button class="pg-fold" data-lg="fold:${esc(uk)}" aria-expanded="${open}">${open ? 'Fewer players' : `${ulist.length - LEAD} more players`}</button>` : '');
      }).join('');
    }
    const foot = hidden && d.state !== 'post' ? `<p class="pg-dnp">${hidden} ${hidden === 1 ? 'player' : 'players'} without a stat yet (hidden)</p>` : '';
    return `${title}<div class="card pg-box lg-box">${pinHtml ? `<div class="lg-pin lg-pinbox">${pinHtml}</div>` : ''}${inner}${foot}</div>`;
  }
  const unitSort = (unit, r) => { const v = r.v; return unit === 'passing' ? v.PYD : unit === 'rushing' ? v.RYD : unit === 'receiving' ? v.RECY * 1 + v.TGT * 0.01 : unit === 'defensive' ? v.TKL + 3 * v.SCK : v.FGM; };
  const betText = (b) => D.betLbl(b.market, b.side, b.line);
  function table(sport, cols, rows, pins, head, tag, unit, pace) {
    const th = `<tr><th scope="col">${esc(head)}</th>${cols.map((c) => `<th scope="col">${esc(c[1])}</th>`).join('')}</tr>`;
    const tr = (r) => {
      if (r.divider) return `<tr class="lg-div"><th scope="row" colspan="${cols.length + 1}">${esc(r.divider)}</th></tr>`;
      const raw = unit ? r.units[unit].raw : r.raw, t = tag ? tag(r) : '', pin = pins && pins[r.id];
      const cell = (lab) => { const v = raw[lab]; return v === undefined || v === '' ? '—' : esc(v); };
      return `<tr${pin ? ' class="pg-hl"' : ''}><th scope="row"><span class="pg-pl lg-pl"><b>${esc(r.short || r.name)}</b>${t || r.pos ? `<small>${t ? `<i class="lg-on">${esc(t)}</i>` : ''}${t && r.pos ? ' · ' : ''}${esc(r.pos)}</small>` : ''}${pace ? pace(r) : ''}</span></th>${cols.map(([lab]) => `<td>${cell(lab)}</td>`).join('')}</tr>`;
    };
    return `<div class="pg-scroll"><table class="pg-tbl lg-tbl"><thead>${th}</thead><tbody>${rows.map(tr).join('')}</tbody></table></div>`;
  }
  function usageTable(sport, list, pins) {
    const cols = G.USAGE[sport], raw = G.usage(sport, list), team = raw.team;
    const u = G.usageSort(sport, raw).filter((x) => (pins && pins[x.row.id]) || cols.some(([k]) => x.vals[k] > 0)); // no usage yet (e.g. NFL defense): not listed
    const pct = (x) => (x > 0 ? Math.round(x * 100) + '%' : '0%');
    const fmt = (k, v) => (k === 'MIN' ? String(Math.round(v)) : k === 'TOI' || k === 'PPTOI' ? G.mmss(Math.round(v * 60)) : String(v));
    const th = `<tr><th scope="col">By usage</th>${cols.map((c) => `<th scope="col">${esc(c[1])}${c[2] ? '<small> · share</small>' : ''}</th>`).join('')}</tr>`;
    const tr = (x) => { const r = x.row, pin = pins && pins[r.id]; return `<tr${pin ? ' class="pg-hl"' : ''}><th scope="row"><span class="pg-pl lg-pl"><b>${esc(r.short || r.name)}</b>${r.pos ? `<small>${esc(r.pos)}</small>` : ''}</span></th>${cols.map(([k, , sh]) => `<td class="${sh ? 'lg-us' : ''}">${esc(fmt(k, x.vals[k]))}${sh ? `<small>${esc(pct(x.share[k]))}</small>` : ''}</td>`).join('')}</tr>`; };
    const tot = `<tr class="lg-tot"><th scope="row"><span class="pg-pl lg-pl"><b>Team</b></span></th>${cols.map(([k, , sh]) => `<td>${sh ? esc(String(team[k])) : ''}</td>`).join('')}</tr>`;
    return `<div class="pg-scroll"><table class="pg-tbl lg-tbl lg-usage"><thead>${th}</thead><tbody>${u.map(tr).join('')}${tot}</tbody></table></div>`;
  }
  function teamStats(sport, ctx, d, colors) {
    const rows = d.teamStats;
    if (!rows || !rows.length) return '';
    const fk = 'tot:' + ctx.key, LEAD = 5, open = !!st.open[fk] || rows.length <= LEAD;
    const shown = open ? rows : rows.slice(0, LEAD);
    return `${D.sec('Team stats')}<div class="card cmp pg-cmp lg-tot-card" ${colors}>${teamsHead(ctx.away, ctx.home)}${shown.map((r) => cmpRow(r.label, r.a, r.h, r.av, r.hv, r.low, r.sub && r.sub[0], r.sub && r.sub[1])).join('')}
      ${rows.length > LEAD ? `<button class="pg-fold" data-lg="fold:${esc(fk)}" aria-expanded="${open}">${open ? 'Fewer team stats' : `${rows.length - LEAD} more team stats`}</button>` : ''}</div>`;
  }

  // ---- clicks (data-lg="box|usage|fold:<key>") ----
  function click(v) {
    if (v === 'box' || v === 'usage') st.mode = v;
    else if (v.startsWith('fold:')) { const k = v.slice(5); if (st.open[k]) delete st.open[k]; else st.open[k] = true; }
  }

  // ---- polling ----
  const on = () => !!lg.ctx && D.cur().kind === 'game' && document.visibilityState === 'visible' && !lg.finalDone;
  function stop() { clearTimeout(lg.timer); lg.timer = 0; lg.gen++; }
  // called at the end of every render with the page's live ctx (null when the page is not a live-window game page)
  function sync(ctx) {
    lg.ctx = ctx;
    if (!on()) { stop(); return; }
    if (!lg.timer && !lg.busy) run();
  }
  // One poll for the ctx current at its start. Everything is kept local until the request is back; if the page changed meanwhile
  // (gen moved on: another game, any sport), the result is thrown away and a fresh poll starts for the page now on screen.
  async function run() {
    const gen = lg.gen, ctx = lg.ctx;
    lg.busy = true;
    let evId = lg.evId, data = null, raw = null, failed = false;
    try {
      if (!evId) { // one scoreboard call to find ESPN's event id (same matching as My Bets)
        const ev = L.findEvent(L.parseScoreboard(ctx.sport, await D.lvFetch(L.ESPN + L.PATH[ctx.sport] + '/scoreboard?dates=' + ctx.date.replace(/-/g, ''))), { date: ctx.date, away: ctx.away, home: ctx.home });
        if (!ev) throw new Error('no event');
        evId = ev.id;
      }
      const js = await D.lvFetch(L.ESPN + L.PATH[ctx.sport] + '/summary?event=' + evId);
      const d = G.parseGame(ctx.sport, js);
      if (!d) throw new Error('summary shape');
      data = d; raw = js;
    } catch (e) { failed = true; }
    lg.busy = false;
    if (gen !== lg.gen || lg.ctx !== ctx && lg.key !== ctx.key) { sync(lg.ctx); return; } // stale: stopped or another page while the request was out
    if (failed) lg.failed = true;
    else {
      lg.evId = evId; lg.data = data; lg.raw = raw; lg.failed = false;
      // feed the My Bets live cache so pinned rows (and My Bets itself) read the same summary; no second poll
      const c = D.lvCache.games[ctx.key] = D.lvCache.games[ctx.key] || {};
      const sum = L.parseSummary(ctx.sport, raw);
      c.id = evId; c.sport = ctx.sport; c.state = data.state; c.sA = data.away.score; c.sH = data.home.score;
      if (sum) c.sum = sum;
      if (data.state === 'post') { c.finalDone = true; lg.finalDone = true; }
    }
    D.rerender();
    if (!on()) { stop(); return; }
    lg.timer = setTimeout(() => { lg.timer = 0; sync(lg.ctx); }, L.POLL_MS);
  }
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => sync(lg.ctx));

  root.LiveGameUI = { init, page, click, sync, state: lg, ui: st };
}(typeof window !== 'undefined' ? window : globalThis));
