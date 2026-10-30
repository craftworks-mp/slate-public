(() => {
  const SPORTS = { nfl: 'NFL', nba: 'NBA', nhl: 'NHL' };
  const TITLES = { ...SPORTS, bets: 'Bets', results: 'Results' };
  const SEGMENTS = ['Games', 'Teams', 'Players', 'Standings'];
  const FILTERS = ['All', 'NFL', 'NBA', 'NHL'];

  const state = {
    route: 'nba',
    segment: { nfl: 'Games', nba: 'Games', nhl: 'Games' },
    dayOffset: 0,
    filter: 'All',
  };

  const $ = (id) => document.getElementById(id);
  const view = $('view');

  const dateFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric',
  });

  // Noon UTC of today's New York calendar date, shifted by n days (DST-safe).
  function dateLabel(n) {
    if (n === -1) return 'Yesterday';
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(new Date()).map((x) => [x.type, x.value]));
    const d = new Date(Date.UTC(+p.year, +p.month - 1, +p.day + n, 12));
    return dateFmt.format(d).replace(',', '');
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function segmented(items, active, attr) {
    return `<div class="seg" role="group">${items.map((i) =>
      `<button ${attr}="${i}" class="${i === active ? 'on' : ''}" aria-pressed="${i === active}">${i}</button>`).join('')}</div>`;
  }

  function render() {
    const r = state.route;
    $('title').textContent = TITLES[r];
    document.title = `${TITLES[r]} · Slate Projector`;
    document.querySelectorAll('#nav a').forEach((a) => {
      if (a.dataset.route === r) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });

    if (SPORTS[r]) {
      const seg = state.segment[r];
      const o = state.dayOffset;
      const pill = (n, label) => `<button data-off="${n}" class="${o === n ? 'on' : ''}">${label}</button>`;
      const far = Math.abs(o) > 1;
      view.innerHTML = segmented(SEGMENTS, seg, 'data-seg') +
        `<div class="dates">
          <button class="arrow" data-shift="-1" aria-label="Previous day">‹</button>
          <div class="pills">${pill(-1, 'Yesterday')}${pill(0, 'Today')}${pill(1, 'Tomorrow')}</div>
          <button class="arrow" data-shift="1" aria-label="Next day">›</button>
        </div>` +
        (far ? `<div class="muted" style="text-align:center;font-size:14px">${esc(dateLabel(o))}</div>` : '') +
        `<div class="card">${seg} for ${esc(dateLabel(o))} — data coming next.</div>`;
    } else if (r === 'bets') {
      view.innerHTML = '<div class="card">Bets decks open at the close pull. Coming next.</div>';
    } else {
      view.innerHTML = segmented(FILTERS, state.filter, 'data-filter') +
        `<div class="card">${state.filter} results — data coming next.</div>`;
    }
  }

  view.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.seg) state.segment[state.route] = d.seg;
    else if (d.off !== undefined) state.dayOffset = +d.off;
    else if (d.shift) state.dayOffset += +d.shift;
    else if (d.filter) state.filter = d.filter;
    else return;
    render();
  });

  function route() {
    const h = location.hash.slice(1);
    state.route = TITLES[h] ? h : 'nba';
    render();
  }
  window.addEventListener('hashchange', route);

  const sheet = $('sheet'), backdrop = $('backdrop');
  function setSheet(open) {
    sheet.hidden = backdrop.hidden = !open;
    if (open) $('close').focus(); else $('gear').focus();
  }
  $('gear').addEventListener('click', () => setSheet(true));
  $('close').addEventListener('click', () => setSheet(false));
  backdrop.addEventListener('click', () => setSheet(false));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !sheet.hidden) setSheet(false); });

  route();
})();
