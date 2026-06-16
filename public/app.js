// llmdash dashboard — fetches /api/state, renders, auto-refreshes, ticks countdowns.
const REFRESH_MS = 60_000;
let state = null;

function statusClass(remaining) {
  if (remaining >= 50) return 'good';
  if (remaining >= 20) return 'warn';
  return 'crit';
}

function fmtTokensHtml(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + '<span class="u">M</span>';
  if (n >= 1e3) return Math.round(n / 1e3) + '<span class="u">k</span>';
  return String(n);
}

function fmtUSD(n) {
  if (n == null) return '—';
  return '$' + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2));
}

function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return d + 'd ' + h + 'h';
  if (h > 0) return h + 'h ' + m + 'm';
  return m + 'm';
}

function fmtAge(iso) {
  if (!iso) return null;
  const ms = Date.now() - Date.parse(iso);
  if (ms < 0) return 'just now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'updated ' + s + 's ago';
  const m = Math.floor(s / 60);
  if (m < 60) return 'updated ' + m + 'm ago';
  return 'updated ' + Math.floor(m / 60) + 'h ago';
}

function renderPanel(win, data) {
  const el = document.querySelector(`.panel[data-window="${win}"]`);
  const remEl = el.querySelector('.rem-val');
  const fill = el.querySelector('.bar-fill');
  if (!data) {
    remEl.textContent = '—';
    remEl.className = 'rem-val';
    fill.style.width = '0';
    el.querySelector('.used').textContent = '—';
    el.querySelector('.reset').textContent = 'waiting…';
    el.querySelector('.reset-at').textContent = 'no reading yet';
    return;
  }
  // Round conservatively: floor remaining (never overstate headroom),
  // ceil used. This also matches what Claude Code's /usage shows.
  const remaining = Math.floor(data.remainingPct);
  const cls = statusClass(remaining);
  remEl.textContent = remaining;
  remEl.className = 'rem-val is-' + cls;
  fill.className = 'bar-fill fill-' + cls;
  fill.style.width = data.remainingPct + '%';
  el.querySelector('.used').textContent = Math.ceil(data.usedPct);
  if (data.resetsAt) {
    el.querySelector('.reset').textContent = fmtDur(Date.parse(data.resetsAt) - Date.now());
    el.querySelector('.reset-at').textContent =
      'resets ' + new Date(data.resetsAt).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  } else {
    el.querySelector('.reset').textContent = '—';
    el.querySelector('.reset-at').textContent = '';
  }
}

function renderActivity(a, projection) {
  document.querySelector('#burnRate .v').innerHTML = a ? fmtTokensHtml(a.burnTokensPerHour) : '—';
  document.getElementById('tok5h').innerHTML = a ? fmtTokensHtml(a.tokens.last5h) : '—';
  document.getElementById('tokWeek').innerHTML = a ? fmtTokensHtml(a.tokens.week) : '—';
  document.getElementById('tokToday').innerHTML = a ? fmtTokensHtml(a.tokens.today) : '—';
  document.getElementById('sessions').textContent = a ? a.sessionsToday : '—';
  document.getElementById('cacheRate').innerHTML = a ? Math.round(a.cacheHitRate * 100) + '<span class="u">%</span>' : '—';
  document.getElementById('estValue').textContent = a ? fmtUSD(a.estValueWeek) : '—';

  // Insights: token mix, cache savings, today's value
  if (a && a.tokenMix) {
    const mix = a.tokenMix;
    const total = (mix.cacheRead + mix.input + mix.cacheWrite + mix.output) || 1;
    document.querySelector('.seg-cr').style.width = (mix.cacheRead / total * 100) + '%';
    document.querySelector('.seg-in').style.width = (mix.input / total * 100) + '%';
    document.querySelector('.seg-cw').style.width = (mix.cacheWrite / total * 100) + '%';
    document.querySelector('.seg-out').style.width = (mix.output / total * 100) + '%';
    document.getElementById('mixCr').innerHTML = fmtTokensHtml(mix.cacheRead);
    document.getElementById('mixIn').innerHTML = fmtTokensHtml(mix.input);
    document.getElementById('mixCw').innerHTML = fmtTokensHtml(mix.cacheWrite);
    document.getElementById('mixOut').innerHTML = fmtTokensHtml(mix.output);
  }
  document.getElementById('cacheSaved').textContent = a ? fmtUSD(a.cacheSavingsWeek) : '—';
  document.getElementById('estToday').textContent = a ? fmtUSD(a.estValueToday) : '—';

  const proj = document.getElementById('burnProj');
  if (!projection || projection.etaMs == null) {
    proj.innerHTML = '<span class="burn-cap">limit data not available yet — start Claude Code with the statusline configured</span>';
    return;
  }
  const resetMs = state && state.limits.five_hour && state.limits.five_hour.resetsAt
    ? Date.parse(state.limits.five_hour.resetsAt) - Date.now() : null;
  if (projection.hitsBeforeReset) {
    proj.innerHTML = 'On pace to hit the 5-hour limit in <strong>~' + fmtDur(projection.etaMs - Date.now()) + '</strong>' +
      '<span class="burn-cap">before it resets in ' + fmtDur(resetMs) + '</span>';
  } else {
    proj.innerHTML = 'On pace to stay under the 5-hour limit' +
      '<span class="burn-cap">resets in ' + fmtDur(resetMs) + ' — comfortable</span>';
  }
}

function render() {
  if (!state) return;
  renderPanel('five_hour', state.limits.five_hour);
  renderPanel('seven_day', state.limits.seven_day);
  renderActivity(state.activity, state.projection);
  tickFreshness();
}

function tickFreshness() {
  const fresh = document.getElementById('freshness');
  const age = state && (state.dataAt || state.generatedAt);
  const label = fmtAge(state ? state.dataAt : null);
  document.getElementById('age').textContent =
    state && state.dataAt ? label : (state ? 'no limit reading yet' : 'connecting…');
  fresh.classList.toggle('stale', !(state && state.dataAt));
}

async function refresh() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status ' + res.status);
    state = await res.json();
    render();
  } catch (e) {
    document.getElementById('age').textContent = 'offline — retrying';
  }
}

// Tick countdowns/age every second from the last fetched state; refetch periodically.
setInterval(() => { if (state) render(); }, 1000);
setInterval(refresh, REFRESH_MS);
refresh();
