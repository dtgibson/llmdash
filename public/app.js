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
  if (!Number.isFinite(ms)) return null;
  if (ms < 0) return 'just now'; // clock skew — clamp, never a negative age
  const s = Math.floor(ms / 1000);
  if (s < 60) return 'updated ' + s + 's ago';
  // Hour scale keeps the minutes ("updated 1h 24m ago", not "1h ago") so an
  // old reading states its age honestly; fmtDur already formats h+m and d+h.
  return 'updated ' + fmtDur(ms) + ' ago';
}

// Reading-age band, derived LIVE on each 1s render tick from the
// server-supplied thresholds (freshness.freshForMs / freshness.staleAfterMs)
// — the bands are never hardcoded client-side. A reading visibly crosses
// fresh → aging → stale between 60s fetches. Null freshness (Codex is not
// retrofitted) or no capture yet → no band treatment at all.
function ageBand(f) {
  if (!f || !f.capturedAt) return null;
  const age = Date.now() - Date.parse(f.capturedAt);
  if (!Number.isFinite(age)) return null;
  if (age > f.staleAfterMs) return 'stale';
  if (age > f.freshForMs) return 'aging';
  return 'fresh';
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function gaugeHtml(win, label) {
  if (!win) {
    return `<div class="panel"><div class="panel-head"><span class="win-label">${label}</span><span class="win-reset">—</span></div>`
      + `<div class="remaining">—<span class="unit">%</span></div><div class="sub">waiting for a reading</div>`
      + `<div class="bar"><div class="bar-fill" style="width:0"></div></div></div>`;
  }
  const rem = Math.floor(win.remainingPct), used = Math.ceil(win.usedPct), cls = statusClass(rem);
  const maxed = win.remainingPct <= 0;
  const resetIn = win.resetsAt ? fmtDur(Date.parse(win.resetsAt) - Date.now()) : '—';
  const sub = maxed ? `<span class="is-crit">limit reached</span>` : `remaining · ${used}% used`;
  // A maxed window shows a full red bar (limit consumed), not an empty/blank bar.
  const barWidth = maxed ? 100 : win.remainingPct;
  return `<div class="panel"><div class="panel-head"><span class="win-label">${label}</span><span class="win-reset">resets in ${resetIn}</span></div>`
    + `<div class="remaining is-${cls}">${rem}<span class="unit">%</span></div><div class="sub">${sub}</div>`
    + `<div class="bar"><div class="bar-fill fill-${cls}" style="width:${barWidth}%"></div></div></div>`;
}

// One window's pacing row: [name column] [pacing sentence] [status pill].
// Each window is evaluated independently — a maxed window reads "limit reached"
// on its own row and never suppresses the other window's row (FR-04 / FR-08).
function pacingLine(label, win, proj) {
  const resetIn = (win && win.resetsAt) ? fmtDur(Date.parse(win.resetsAt) - Date.now()) : null;
  let text, pillCls = '', pillLabel = '';
  if (win && win.remainingPct <= 0) {
    text = `<span class="is-crit">${label} limit reached</span>`
      + (resetIn ? `<span class="burn-cap">resets in ${resetIn}</span>` : '');
    pillCls = 'pill-crit'; pillLabel = 'limit reached';
  } else if (win && resetIn != null) {
    // We have a reading and a reset time, so we can speak to pacing.
    if (proj && proj.etaMs != null && proj.hitsBeforeReset) {
      text = `On pace to hit the ${label} limit in <strong>~${fmtDur(proj.etaMs - Date.now())}</strong>`
        + `<span class="burn-cap">before it resets in ${resetIn} — at risk</span>`;
      pillCls = 'pill-warn'; pillLabel = 'at risk';
    } else {
      // Projected to stay under, or no measurable burn yet (e.g. 0% used / fresh window).
      text = `On pace to stay under the ${label} limit`
        + `<span class="burn-cap">resets in ${resetIn} — comfortable</span>`;
      pillCls = 'pill-good'; pillLabel = 'on pace';
    }
  } else {
    // No reading, or a reading with no reset time — can't project honestly.
    text = `<span class="burn-cap">limit data not available yet</span>`;
  }
  const pill = pillLabel ? `<span class="burn-pill ${pillCls}">${pillLabel}</span>` : `<span></span>`;
  return `<div class="burn-line"><span class="burn-win">${label}</span>`
    + `<span class="burn-text">${text}</span>${pill}</div>`;
}

function burnHtml(tool) {
  const a = tool.activity, proj = tool.projection || {};
  const hasActivity = a && a.hasData !== false;
  const rateHtml = hasActivity ? `<div class="burn-rate">${fmtTokensHtml(a.burnTokensPerHour)}<span class="u">tokens / hr</span></div>` : '';
  // Both pacing predictors shown at once: 5-hour and weekly.
  const lines = pacingLine('5-hour', tool.limits.five_hour, proj.five_hour)
    + pacingLine('Weekly', tool.limits.seven_day, proj.seven_day);
  return `<div class="burn">${rateHtml}<div class="burn-proj">${lines}</div></div>`;
}

const tile = (label, valHtml, note) =>
  `<div class="tile"><div class="tile-label">${label}</div><div class="tile-val">${valHtml}</div><div class="tile-note">${note}</div></div>`;

function tilesHtml(a) {
  const t = (a && a.tokens) || {};
  return `<div class="stat-grid">`
    + tile('Tokens · 5h', a ? fmtTokensHtml(t.last5h) : '—', a ? fmtTokensHtml(t.week) + ' this week' : '')
    + tile('Tokens · today', a ? fmtTokensHtml(t.today) : '—', a ? a.sessionsToday + ' sessions' : '')
    + tile('Cache hit rate', a ? Math.round(a.cacheHitRate * 100) + '<span class="u">%</span>' : '—', a && a.cachedIsSubsetOfInput ? 'cached ÷ input' : 'why limits last')
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
  const m = a.tokenMix, subset = a.cachedIsSubsetOfInput;
  const total = (m.cacheRead + m.input + m.cacheWrite + m.output) || 1;
  const seg = (cls, v) => `<span class="seg ${cls}" style="width:${(v / total) * 100}%"></span>`;
  const leg = (cls, lab, v) => `<span><i class="dot ${cls}"></i>${lab} <b>${fmtTokensHtml(v)}</b></span>`;
  // For Codex, cached is a subset of input: "Input" already shows the non-cached
  // part and there is no separate cache-write channel.
  const crLabel = subset ? 'Cached input' : 'Cache read';
  const bar = seg('seg-cr', m.cacheRead) + seg('seg-in', m.input)
    + (subset ? '' : seg('seg-cw', m.cacheWrite)) + seg('seg-out', m.output);
  const legend = leg('dot-cr', crLabel, m.cacheRead) + leg('dot-in', 'Input', m.input)
    + (subset ? '' : leg('dot-cw', 'Cache write', m.cacheWrite)) + leg('dot-out', 'Output', m.output);
  const note = subset
    ? `<div class="mix-note">Cached is a subset of input (cached ÷ input = ${Math.round((a.cacheHitRate || 0) * 100)}%); total tokens = input + output. Reasoning is included in output. No cache-write channel for Codex.</div>`
    : '';
  return `<div class="section-label">Token mix · this week</div><div class="mix"><div class="mix-bar">`
    + bar + `</div><div class="mix-legend">` + legend + `</div>${note}</div>`;
}

// Why a tool's limit gauges are empty — or why the reading behind them may no
// longer be current. The reason comes from the server (it knows whether the
// codex command actually ran and how old the Claude reading is) — the client
// only maps a reason code to copy, never guesses. Renders whenever a
// diagnostic is present, INCLUDING while the gauges still show data
// (stale-reading: the last capture keeps rendering — flagged, never blanked).
// All dynamic values (cmd, detail) are escaped before touching innerHTML.
function limitsNoteHtml(tool) {
  const d = tool.limitsDiagnostic;
  if (!d) return '';
  if (d.reason === 'stale-reading') {
    // The age re-derives from capturedAt on each render tick, so the note's
    // stated age never freezes between fetches.
    const capturedAt = (tool.freshness && tool.freshness.capturedAt) || d.capturedAt;
    return `<div class="stale-note"><strong>Stale reading</strong> — ${fmtAge(capturedAt)}; the limits above may have moved since. Open a Claude Code CLI session to refresh the reading (the desktop app doesn't render the statusline that reports these limits).</div>`;
  }
  let text;
  if (d.reason === 'no-statusline-reading') {
    text = `No statusline reading has arrived yet — these gauges fill in when a ${esc(tool.label)} session renders its status line (that's what reports the account-wide limits to llmdash). Open a Claude Code CLI session to capture the first reading.`;
  } else if (d.reason === 'codex-cmd-failed') {
    text = `The configured codex command (<code>${esc(d.cmd || 'codex')}</code>) couldn't be run${d.detail ? ` (${esc(d.detail)})` : ''}, so live limits can't be read. Set <code>LLMDASH_CODEX_CMD</code> to the absolute path from <code>which codex</code> and restart the service — the macOS installer does this when re-run.`;
  } else {
    text = `No ${esc(tool.label)} limit reading yet — limits appear once the app-server responds to the dashboard's poll or a session records them locally.`;
  }
  return `<div class="empty-note">${text}</div>`;
}

function toolHtml(tool) {
  const a = tool.activity;
  // Reading-age status pill: warn "aging", crit "stale" — text first (NFR-08),
  // and the aging band never says "stale". Fresh renders no pill at all, so
  // the escalation is structural, not color-alone. Pill words are literals.
  const band = ageBand(tool.freshness);
  const agePill = band === 'stale' ? ' <span class="age-pill pill-crit">stale</span>'
    : band === 'aging' ? ' <span class="age-pill pill-warn">aging</span>'
    : '';
  const sub = `${esc(tool.plan)}${tool.dataAt ? ' · ' + fmtAge(tool.dataAt) : ''}${agePill}`;
  const hasActivity = a && a.hasData !== false;
  // Honest empty state: local session logs simply have nothing yet (both tools
  // DO record usage locally once used). Never claim the limits are live here —
  // the gauges above speak for themselves.
  const activityBlock = hasActivity
    ? (tilesHtml(a) + mixHtml(a) + tiles2Html(a))
    : `<div class="empty-note">No ${esc(tool.label)} sessions have been recorded on this machine yet — token stats fill in once you use ${esc(tool.label)} here (read from its local session logs).</div>`;
  return `<section class="tool"><div class="tool-head"><span class="tool-name">${esc(tool.label)}</span><span class="tool-sub">${sub}</span></div>`
    + `<div class="gauges">${gaugeHtml(tool.limits.five_hour, '5-hour')}${gaugeHtml(tool.limits.seven_day, 'Weekly')}</div>`
    + limitsNoteHtml(tool) + burnHtml(tool) + activityBlock + `</section>`;
}

function renderHeadroom(h) {
  const el = document.getElementById('headroom');
  if (!h) { el.hidden = true; return; }
  el.hidden = false;
  const lead = h.maxed
    ? `${esc(h.lowLabel)}'s ${esc(h.lowWindow)} limit is maxed`
    : `${esc(h.lowLabel)} is low on its ${esc(h.lowWindow)} (${h.lowRemaining}%)`;
  el.innerHTML = `<span class="lead is-crit">${lead}</span><span class="arrow">→</span>`
    + `<span>switch to <strong>${esc(h.bestLabel)}</strong>, <span class="room">${h.bestRemaining}% left</span></span>`;
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

// --- Trends (charts) ---
let TREND_RANGE = '7d';
const TREND_REFRESH_MS = 120_000;

function scaleX(t, t0, t1, x0, x1) { return t1 === t0 ? (x0 + x1) / 2 : x0 + ((t - t0) / (t1 - t0)) * (x1 - x0); }

function fmtNum(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return Math.round(n / 1e3) + 'k';
  return String(Math.round(n));
}
function fmtDateShort(ms) { return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }); }

const rangeToMs = (r) => ({ '24h': 24 * 3600_000, '7d': 7 * 86400_000, '30d': 30 * 86400_000 }[r] || 7 * 86400_000);

// opts: { xDomain:[min,max], pointLabel:fn, h }. xDomain anchors the x-axis to the
// selected time window (so changing the range visibly re-positions the data).
function lineSVG(seriesList, yMax, fmtY, opts = {}) {
  if (seriesList.every((s) => s.pts.length < 2)) return null;
  const h = opts.h || 120;
  const x0 = 30, x1 = 314, y0 = 14, y1 = h - 24;
  const ts = seriesList.flatMap((s) => s.pts).map((p) => p[0]);
  const t0 = opts.xDomain ? opts.xDomain[0] : Math.min(...ts);
  const t1 = opts.xDomain ? opts.xDomain[1] : Math.max(...ts);
  const sy = (v) => y1 - (Math.max(0, Math.min(yMax, v)) / (yMax || 1)) * (y1 - y0);
  const grid = [y0, (y0 + y1) / 2, y1].map((y) => `<line class="gridline" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`).join('');
  const lines = seriesList.map((s) => s.pts.length < 2 ? ''
    : `<polyline fill="none" stroke="${s.color}" stroke-width="2" points="${s.pts.map((p) => `${scaleX(p[0], t0, t1, x0, x1).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
  let labels = '';
  if (opts.pointLabel && seriesList[0].pts.length <= 12) {
    labels = seriesList[0].pts.map((p) => `<text x="${scaleX(p[0], t0, t1, x0, x1).toFixed(1)}" y="${(sy(p[1]) - 4).toFixed(1)}" text-anchor="middle">${opts.pointLabel(p[1])}</text>`).join('');
  }
  const ylab = `<text x="0" y="${y0 + 3}">${fmtY(yMax)}</text><text x="0" y="${y1}">${fmtY(0)}</text>`;
  const xlab = `<text x="${x0}" y="${h - 4}">${fmtDateShort(t0)}</text><text x="${x1}" y="${h - 4}" text-anchor="end">${fmtDateShort(t1)}</text>`;
  return `<svg viewBox="0 0 320 ${h}" role="img">${grid}${lines}${labels}${ylab}${xlab}</svg>`;
}

function barsSVG(days, fmtY, h = 120) {
  if (!days.length) return null;
  const x0 = 30, x1 = 314, y0 = 14, y1 = h - 24;
  const max = Math.max(1, ...days.map((d) => d.tokens));
  const step = (x1 - x0) / days.length, bw = Math.min(28, step - 4);
  const sh = (v) => (v / max) * (y1 - y0);
  const grid = [y0, y1].map((y) => `<line class="gridline" x1="${x0}" y1="${y}" x2="${x1}" y2="${y}"/>`).join('');
  const bars = days.map((d, i) => {
    const x = x0 + i * step + (step - bw) / 2;
    let top = y1, out = '';
    for (const [color, val] of [['var(--cr)', d.cacheRead], ['var(--in)', d.input], ['var(--out)', d.output]]) {
      const segH = sh(val); top -= segH;
      out += `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(0, segH).toFixed(1)}" fill="${color}"/>`;
    }
    return out;
  }).join('');
  const barLabels = days.length <= 12 ? days.map((d, i) => {
    const x = x0 + i * step + step / 2;
    return `<text x="${x.toFixed(1)}" y="${(y1 - sh(d.tokens) - 3).toFixed(1)}" text-anchor="middle">${fmtNum(d.tokens)}</text>`;
  }).join('') : '';
  const ylab = `<text x="0" y="${y0 + 3}">${fmtY(max)}</text><text x="0" y="${y1}">0</text>`;
  const xlab = `<text x="${x0}" y="${h - 4}">${fmtDateShort(Date.parse(days[0].day))}</text><text x="${x1}" y="${h - 4}" text-anchor="end">${fmtDateShort(Date.parse(days[days.length - 1].day))}</text>`;
  return `<svg viewBox="0 0 320 ${h}" role="img">${grid}${bars}${barLabels}${ylab}${xlab}</svg>`;
}

const legendHtml = (items) => `<div class="legend">` + items.map(([c, l]) => `<span><i style="background:${c}"></i>${l}</span>`).join('') + `</div>`;

function chartCard(title, src, svg, legend) {
  return `<div class="card"><div class="card-title">${title}</div><div class="card-src">${src}</div>`
    + (svg ? svg + (legend || '') : '<div class="nodata">not enough data yet</div>') + `</div>`;
}

function trendToolHtml(t, range) {
  const fh = t.limits.five_hour || [], sd = t.limits.seven_day || [], daily = t.daily || [];
  const hasLimits = fh.length >= 2 || sd.length >= 2;
  const hasActivity = daily.length >= 1;
  if (!hasLimits && !hasActivity) {
    return `<div class="tool-name">${esc(t.label)}</div><div class="empty">Not enough data yet — ${esc(t.label)} trends fill in as you use it.</div>`;
  }
  const pct = (v) => Math.round(v) + '%';
  const usd = (v) => '$' + Math.round(v);
  const xDomain = [Date.now() - rangeToMs(range), Date.now()];
  const cards = [];
  const burn = lineSVG([
    { pts: fh.map((p) => [Date.parse(p.t), p.remaining]), color: 'var(--accent)' },
    { pts: sd.map((p) => [Date.parse(p.t), p.remaining]), color: 'var(--teal)' },
  ], 100, pct, { xDomain });
  cards.push(chartCard('Limit remaining', 'account-wide · snapshots', burn, legendHtml([['var(--accent)', '5-hour'], ['var(--teal)', 'Weekly']])));
  // Only show the log-derived charts for tools that actually record activity.
  if (hasActivity) {
    const codex = t.source === 'codex';
    const tokens = barsSVG(daily, fmtNum);
    const rate = lineSVG([{ pts: daily.map((d) => [Date.parse(d.day), d.cacheHitRate * 100]), color: 'var(--good)' }], 100, pct, { xDomain });
    const valMax = Math.max(0.01, ...daily.map((d) => d.cost));
    const value = lineSVG([{ pts: daily.map((d) => [Date.parse(d.day), d.cost]), color: 'var(--accent)' }], valMax, usd, { xDomain, pointLabel: usd });
    const crLab = codex ? 'Cached input' : 'Cache';
    cards.push(chartCard('Tokens per day', codex ? 'local logs · UTC buckets' : 'local logs', tokens, legendHtml([['var(--cr)', crLab], ['var(--in)', 'Input'], ['var(--out)', 'Output']])));
    cards.push(chartCard('Cache hit rate', codex ? 'local logs · cached ÷ input' : 'local logs', rate, ''));
    cards.push(chartCard('Est. value / day', 'local logs · API rates', value, ''));
  }
  const note = (hasLimits && !hasActivity)
    ? `<div class="empty-note">Token-based trends aren't available for ${esc(t.label)} — limits only.</div>`
    : '';
  return `<div class="tool-name">${esc(t.label)}</div><div class="charts">${cards.join('')}</div>${note}`;
}

async function fetchTrends() {
  try {
    const res = await fetch('/api/trends?range=' + encodeURIComponent(TREND_RANGE), { cache: 'no-store' });
    if (!res.ok) throw new Error('bad');
    const data = await res.json();
    document.getElementById('trends').innerHTML = data.tools.map((t) => trendToolHtml(t, data.range)).join('');
  } catch { /* keep the previous render */ }
}

function setupRange() {
  const r = document.getElementById('range');
  if (!r) return;
  r.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    TREND_RANGE = btn.dataset.range || '7d';
    [...r.querySelectorAll('.pill')].forEach((p) => p.classList.toggle('active', p === btn));
    fetchTrends();
  });
}

setupRange();
fetchTrends();
setInterval(fetchTrends, TREND_REFRESH_MS);
