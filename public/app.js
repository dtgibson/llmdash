// llmdash dashboard — renders each tool (Claude Code, Codex) and the cross-tool
// "headroom" cue, from /api/state. Auto-refreshes; ticks countdowns each second.
const REFRESH_MS = 60_000;
let state = null;

const statusClass = (rem) => (rem >= 50 ? 'good' : rem >= 20 ? 'warn' : 'crit');

function fmtTokensHtml(n) {
  if (n == null) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + '<span class="u">M</span>';
  if (n >= 1e3) return Math.round(n / 1e3) + '<span class="u">k</span>';
  return String(n);
}
function fmtUSD(n) { return n == null ? '—' : '$' + (n >= 100 ? Math.round(n).toLocaleString() : n.toFixed(2)); }
function fmtDur(ms) {
  if (ms == null) return '—';
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60000), d = Math.floor(mins / 1440), h = Math.floor((mins % 1440) / 60), m = mins % 60;
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
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function gaugeHtml(win, label) {
  if (!win) {
    return `<div class="panel"><div class="panel-head"><span class="win-label">${label}</span><span class="win-reset">—</span></div>`
      + `<div class="remaining">—<span class="unit">%</span></div><div class="sub">waiting for a reading</div>`
      + `<div class="bar"><div class="bar-fill" style="width:0"></div></div></div>`;
  }
  const rem = Math.floor(win.remainingPct), used = Math.ceil(win.usedPct), cls = statusClass(rem);
  const resetIn = win.resetsAt ? fmtDur(Date.parse(win.resetsAt) - Date.now()) : '—';
  return `<div class="panel"><div class="panel-head"><span class="win-label">${label}</span><span class="win-reset">resets in ${resetIn}</span></div>`
    + `<div class="remaining is-${cls}">${rem}<span class="unit">%</span></div><div class="sub">remaining · ${used}% used</div>`
    + `<div class="bar"><div class="bar-fill fill-${cls}" style="width:${win.remainingPct}%"></div></div></div>`;
}

function burnHtml(tool) {
  const a = tool.activity, proj = tool.projection, five = tool.limits.five_hour;
  const rate = a ? fmtTokensHtml(a.burnTokensPerHour) : '—';
  let projHtml;
  if (proj && proj.etaMs != null && five && five.resetsAt) {
    const resetMs = Date.parse(five.resetsAt) - Date.now();
    projHtml = proj.hitsBeforeReset
      ? `On pace to hit the 5-hour limit in <strong>~${fmtDur(proj.etaMs - Date.now())}</strong><span class="burn-cap">before it resets in ${fmtDur(resetMs)}</span>`
      : `On pace to stay under the 5-hour limit<span class="burn-cap">resets in ${fmtDur(resetMs)} — comfortable</span>`;
  } else {
    projHtml = `<span class="burn-cap">limit data not available yet</span>`;
  }
  return `<div class="burn"><div class="burn-rate">${rate}<span class="u">tokens / hr</span></div><div class="burn-proj">${projHtml}</div></div>`;
}

const tile = (label, valHtml, note) =>
  `<div class="tile"><div class="tile-label">${label}</div><div class="tile-val">${valHtml}</div><div class="tile-note">${note}</div></div>`;

function tilesHtml(a) {
  const t = (a && a.tokens) || {};
  return `<div class="stat-grid">`
    + tile('Tokens · 5h', a ? fmtTokensHtml(t.last5h) : '—', a ? fmtTokensHtml(t.week) + ' this week' : '')
    + tile('Tokens · today', a ? fmtTokensHtml(t.today) : '—', a ? a.sessionsToday + ' sessions' : '')
    + tile('Cache hit rate', a ? Math.round(a.cacheHitRate * 100) + '<span class="u">%</span>' : '—', 'why limits last')
    + tile('Est. value · wk', a ? fmtUSD(a.estValueWeek) : '—', 'at API rates')
    + `</div>`;
}

function tiles2Html(a) {
  if (!a) return '';
  return `<div class="stat-grid grid2">`
    + tile('Cache saved · wk', fmtUSD(a.cacheSavingsWeek), 'vs full input price')
    + tile('Est. value · today', fmtUSD(a.estValueToday), 'at API rates')
    + `</div>`;
}

function mixHtml(a) {
  if (!a || !a.tokenMix) return '';
  const m = a.tokenMix, total = (m.cacheRead + m.input + m.cacheWrite + m.output) || 1;
  const seg = (cls, v) => `<span class="seg ${cls}" style="width:${(v / total) * 100}%"></span>`;
  const leg = (cls, lab, v) => `<span><i class="dot ${cls}"></i>${lab} <b>${fmtTokensHtml(v)}</b></span>`;
  return `<div class="section-label">Token mix · this week</div><div class="mix"><div class="mix-bar">`
    + seg('seg-cr', m.cacheRead) + seg('seg-in', m.input) + seg('seg-cw', m.cacheWrite) + seg('seg-out', m.output)
    + `</div><div class="mix-legend">`
    + leg('dot-cr', 'Cache read', m.cacheRead) + leg('dot-in', 'Input', m.input) + leg('dot-cw', 'Cache write', m.cacheWrite) + leg('dot-out', 'Output', m.output)
    + `</div></div>`;
}

function toolHtml(tool) {
  const a = tool.activity;
  const sub = `${esc(tool.plan)}${tool.dataAt ? ' · ' + fmtAge(tool.dataAt) : ''}`;
  const empty = a && a.hasData === false
    ? `<div class="empty-note">Codex activity fills in as you use it — these grow with your sessions.</div>` : '';
  return `<section class="tool"><div class="tool-head"><span class="tool-name">${esc(tool.label)}</span><span class="tool-sub">${sub}</span></div>`
    + `<div class="gauges">${gaugeHtml(tool.limits.five_hour, '5-hour')}${gaugeHtml(tool.limits.seven_day, 'Weekly')}</div>`
    + burnHtml(tool) + tilesHtml(a) + mixHtml(a) + tiles2Html(a) + empty + `</section>`;
}

function renderHeadroom(h) {
  const el = document.getElementById('headroom');
  if (!h) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span class="lead is-crit">${esc(h.lowLabel)} is nearly out</span><span class="arrow">→</span>`
    + `<span>switch to <strong>${esc(h.bestLabel)}</strong>, <span class="room">${h.bestRemaining}% left</span> on the 5-hour</span>`;
}

function render() {
  if (!state) return;
  renderHeadroom(state.headroom);
  document.getElementById('tools').innerHTML = state.tools.map(toolHtml).join('');
  const freshest = state.tools.map((t) => t.dataAt).filter(Boolean).sort().pop();
  document.getElementById('age').textContent = freshest ? fmtAge(freshest) : 'no readings yet';
  document.getElementById('freshness').classList.toggle('stale', !freshest);
}

async function refresh() {
  try {
    const res = await fetch('/api/state', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    state = await res.json();
    render();
  } catch { document.getElementById('age').textContent = 'offline — retrying'; }
}

setInterval(() => { if (state) render(); }, 1000);
setInterval(refresh, REFRESH_MS);
refresh();
