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

// Tool identity is a fixed presentation mapping. The glyphs remain useful in
// monochrome, while the literal classes provide the approved tinted rail.
function toolToneClass(tool) {
  if (tool && tool.source === 'claude-code') return 'tool-claude';
  if (tool && tool.source === 'codex') return 'tool-codex';
  return '';
}
function toolNameHtml(tool) {
  const mark = tool && tool.source === 'claude-code' ? '◆' : tool && tool.source === 'codex' ? '▲' : '';
  const markHtml = mark ? `<span class="tool-mark" aria-hidden="true">${mark}</span>` : '';
  return `<span class="tool-name">${markHtml}<span>${esc(tool.label)}</span></span>`;
}

function toolDetailsTitleId(tool) {
  return tool && tool.source === 'claude-code' ? 'claude-details-title'
    : tool && tool.source === 'codex' ? 'codex-details-title' : 'tool-details-title';
}

function gaugeHtml(win, label, tool) {
  if (!win) {
    const codexShort = tool && tool.source === 'codex' && label === '5-hour';
    const note = codexShort ? 'No short-window reading' : 'No current window reading';
    return `<div class="panel limit-card unavailable">`
      + `<div class="panel-head limit-card-head"><span class="win-label window-label">${esc(label)}</span><span class="win-reset reset">not reported</span></div>`
      + `<div class="limit-unavailable">Unavailable</div><div class="sub limit-meta">${note}</div>`
      + `<div class="unavailable-rule" aria-hidden="true"></div></div>`;
  }
  const rem = Math.floor(win.remainingPct), used = Math.ceil(win.usedPct), cls = statusClass(rem);
  const maxed = win.remainingPct <= 0;
  const resetIn = win.resetsAt ? fmtDur(Date.parse(win.resetsAt) - Date.now()) : '—';
  const sub = maxed ? `<span class="is-crit">limit reached</span>` : `remaining · ${used}% used`;
  // A maxed window shows a full red bar (limit consumed), not an empty/blank bar.
  const barWidth = maxed ? 100 : win.remainingPct;
  return `<div class="panel limit-card">`
    + `<div class="panel-head limit-card-head"><span class="win-label window-label">${esc(label)}</span><span class="win-reset reset">resets in ${resetIn}</span></div>`
    + `<div class="remaining limit-value is-${cls}">${rem}<span class="unit">%</span></div><div class="sub limit-meta">${sub}</div>`
    + `<div class="bar" aria-hidden="true"><div class="bar-fill fill-${cls}" style="width:${barWidth}%"></div></div></div>`;
}

// One window's pacing row: [name column] [pacing sentence] [status pill].
// Each window is evaluated independently — a maxed window reads "limit reached"
// on its own row and never suppresses the other window's row (FR-04 / FR-08).
function pacingLine(label, win, proj, unavailableCopy = '') {
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
    text = `limit data not available yet`
      + (unavailableCopy ? `<span class="burn-cap">${unavailableCopy}</span>` : '');
  }
  const pill = pillLabel ? `<span class="burn-pill ${pillCls}">${pillLabel}</span>` : `<span></span>`;
  return `<div class="burn-line"><span class="burn-win">${label}</span>`
    + `<span class="burn-text">${text}</span>${pill}</div>`;
}

function burnHtml(tool) {
  const a = tool.activity, proj = tool.projection || {};
  const hasActivity = a && a.hasData !== false;
  const rateHtml = hasActivity ? `<span class="burn-rate">${fmtTokensHtml(a.burnTokensPerHour)}<span class="u">tokens / hr · this machine</span></span>` : '';
  // Both pacing predictors shown at once: 5-hour and weekly.
  const shortUnavailable = tool.source === 'codex' && !tool.limits.five_hour
    ? 'Codex did not report a short window' : '';
  const lines = pacingLine('5-hour', tool.limits.five_hour, proj.five_hour, shortUnavailable)
    + pacingLine('Weekly', tool.limits.seven_day, proj.seven_day);
  return `<div class="burn" aria-label="${esc(tool.label)} pacing"><div class="burn-head"><strong>Pacing</strong>${rateHtml}</div>`
    + `<div class="burn-proj">${lines}</div></div>`;
}

function windowLabel(key) {
  if (key === 'five_hour') return '5-hour cap';
  if (key === 'seven_day') return 'Weekly cap';
  return 'Model cap';
}

function modelLimitsHtml(tool) {
  const caps = Array.isArray(tool.modelLimits) ? tool.modelLimits : [];
  const items = caps.filter((m) => m && Number.isFinite(Number(m.usedPct)));
  if (!items.length) return '';
  const rows = items.map((m) => {
    const usedPct = Math.min(100, Math.max(0, Number(m.usedPct)));
    const remainingPct = Math.min(100, Math.max(0, Number.isFinite(Number(m.remainingPct)) ? Number(m.remainingPct) : 100 - usedPct));
    const rem = Math.floor(remainingPct), used = Math.ceil(usedPct), cls = statusClass(rem);
    const maxed = remainingPct <= 0;
    const resetMs = m.resetsAt ? Date.parse(m.resetsAt) : NaN;
    const resetIn = Number.isFinite(resetMs) ? fmtDur(resetMs - Date.now()) : '—';
    const barWidth = maxed ? 100 : remainingPct;
    const sub = maxed ? `<span class="is-crit">limit reached</span>` : `${used}% used`;
    return `<div class="model-limit"><div class="model-limit-head"><div class="model-limit-namewrap">`
      + `<span class="model-name">${esc(m.label || m.model || 'Model')}</span>`
      + `<span class="model-window">${esc(windowLabel(m.window))}</span></div>`
      + `<div class="model-limit-metric"><span class="model-remaining is-${cls}">${rem}<span class="unit">%</span></span>`
      + `<span class="model-reset">resets in ${resetIn}</span></div></div>`
      + `<div class="model-limit-sub">${sub}</div><div class="bar model-bar"><div class="bar-fill fill-${cls}" style="width:${barWidth}%"></div></div></div>`;
  }).join('');
  return `<section class="model-limits subsection"><div class="subsection-head"><h3>Model-specific caps</h3>`
    + `<span class="subsection-scope"><span class="scope-tag">Account-wide</span>supplemental limits</span></div>`
    + `<div class="model-limit-grid">${rows}</div>`
    + `<div class="model-limit-note">These caps are specific to ${esc(tool.label)} models; they do not add account-wide budget.</div></section>`;
}

const tile = (label, valHtml, note) =>
  `<div class="tile"><div class="tile-label">${label}</div><div class="tile-val">${valHtml}</div><div class="tile-note">${note}</div></div>`;

function tilesHtml(a) {
  const t = (a && a.tokens) || {};
  return `<div class="stat-grid">`
    + tile('Tokens · 5h', a ? fmtTokensHtml(t.last5h) : '—', a ? fmtTokensHtml(t.week) + ' this week' : '')
    + tile('Tokens · today', a ? fmtTokensHtml(t.today) : '—', a ? a.sessionsToday + ' sessions' : '')
    + tile('Cache hit rate', a ? Math.round(a.cacheHitRate * 100) + '<span class="u">%</span>' : '—', a && a.cachedIsSubsetOfInput ? 'cached ÷ input' : 'why limits last')
    + tile('Sessions · today', a ? String(a.sessionsToday) : '—', 'local transcript sessions')
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
// The auto-refresh failure causes, each mapped to one FIXED sentence (the
// verbatim copy table in pipeline/claude-auto-refresh/design-spec.md). The
// cause code crosses the wire as an enum and is NEVER rendered raw — an
// unmapped value falls back to the generic sentence. `remedy` is the manual
// remedy verb: "refresh the reading manually" with a stale reading, "capture
// the first reading manually" when no reading has ever arrived.
const AUTOREFRESH_CAUSE_SENTENCES = {
  'spawn-error': (remedy) => `The <code>claude</code> command couldn't be run: set <code>LLMDASH_CLAUDE_CMD</code> to the absolute path from <code>which claude</code> and restart the service, or open a Claude Code CLI session to ${remedy}.`,
  'timeout': (remedy) => `Refresh attempts are timing out before a reading arrives — open a Claude Code CLI session to ${remedy}.`,
  'parse-failed': (remedy) => `The <code>/usage</code> screen couldn't be read (a Claude Code update may have changed it) — open a Claude Code CLI session to ${remedy}.`,
  'no-reading-produced': (remedy) => `Refresh attempts finish without producing a reading — open a Claude Code CLI session to ${remedy}.`,
};
const AUTOREFRESH_FALLBACK_SENTENCE = (remedy) => `Refresh attempts keep failing — open a Claude Code CLI session to ${remedy}.`;

function limitsNoteHtml(tool) {
  const d = tool.limitsDiagnostic;
  if (!d) return '';
  // Auto-refresh diagnostics first — the branch order mirrors the server's
  // precedence (failing > disabled > stale). Both render with the shipped
  // data-quality note component in its existing slot; the opening fragment
  // carries the staleness sentence itself, so nothing doubles up. The age
  // re-derives from capturedAt on each render tick, like the stale note.
  if (d.reason === 'auto-refresh-failing' || d.reason === 'auto-refresh-disabled') {
    const capturedAt = (tool.freshness && tool.freshness.capturedAt) || d.capturedAt;
    const age = fmtAge(capturedAt); // null when no reading has ever arrived
    const opening = age ? `— ${age}; the limits above may have moved since.` : `— no reading has arrived yet.`;
    const remedy = age ? 'refresh the reading manually' : 'capture the first reading manually';
    if (d.reason === 'auto-refresh-disabled') {
      return `<div class="stale-note"><strong>Auto-refresh is off</strong> (<code>LLMDASH_CLAUDE_AUTOREFRESH=0</code>) ${opening} Unset the variable and restart to re-enable, or open a Claude Code CLI session to ${remedy}.</div>`;
    }
    // Own-key lookup only: a plain [d.cause] would also hit inherited Object
    // keys ('constructor', '__proto__', …), bypassing the intended fallback.
    const sentence = (Object.prototype.hasOwnProperty.call(AUTOREFRESH_CAUSE_SENTENCES, d.cause)
      ? AUTOREFRESH_CAUSE_SENTENCES[d.cause] : AUTOREFRESH_FALLBACK_SENTENCE)(remedy);
    return `<div class="stale-note"><strong>Auto-refresh is failing</strong> ${opening} ${sentence}</div>`;
  }
  if (d.reason === 'stale-reading') {
    // The age re-derives from capturedAt on each render tick, so the note's
    // stated age never freezes between fetches.
    const capturedAt = (tool.freshness && tool.freshness.capturedAt) || d.capturedAt;
    return `<div class="stale-note"><strong>Stale reading</strong> — ${fmtAge(capturedAt)}; the limits above may have moved since. Open a Claude Code CLI session to refresh the reading (the desktop app doesn't render the statusline that reports these limits).</div>`;
  }
  let text;
  if (d.reason === 'no-statusline-reading') {
    text = `No statusline reading has arrived yet — these gauges fill in when a ${esc(tool.label)} session renders its status line (that's what reports the account-wide limits to llmdash); auto-refresh also captures one automatically within a few minutes of Claude activity. Open a Claude Code CLI session to capture the first reading.`;
  } else if (d.reason === 'codex-cmd-failed') {
    text = `The configured codex command (<code>${esc(d.cmd || 'codex')}</code>) couldn't be run${d.detail ? ` (${esc(d.detail)})` : ''}, so live limits can't be read. Set <code>LLMDASH_CODEX_CMD</code> to the absolute path from <code>which codex</code> and restart the service — the macOS installer does this when re-run.`;
  } else {
    text = `No ${esc(tool.label)} limit reading yet — limits appear once the app-server responds to the dashboard's poll or a session records them locally.`;
  }
  return `<div class="empty-note">${text}</div>`;
}

function toolCoreHtml(tool, activityScope = 'this machine', titleId = toolDetailsTitleId(tool)) {
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
    ? (tilesHtml(a) + mixHtml(a))
    : `<div class="empty-note">No ${esc(tool.label)} sessions have been recorded on this machine yet — token stats fill in once you use ${esc(tool.label)} here (read from its local session logs).</div>`;
  const summary = tool.source === 'claude-code'
    ? 'Pacing · activity · model caps · trends'
    : 'Pacing · activity · deeper insights · trends';
  const idAttr = titleId ? ` id="${titleId}"` : '';
  return `<div class="tool-group-head"><h2${idAttr}>${toolNameHtml(tool)}</h2><span class="group-summary">${summary} · ${sub}</span></div>`
    + burnHtml(tool)
    + `<section class="subsection activity-section"><div class="subsection-head"><h3>Activity</h3>`
    + `<span class="subsection-scope"><span class="scope-tag">${esc(activityScope)}</span>local ${esc(tool.label)} session logs</span></div>`
    + activityBlock + `</section>`
    + modelLimitsHtml(tool);
}

function limitLaneHtml(tool, scopeCopy = '') {
  const tone = toolToneClass(tool);
  const scope = scopeCopy || `${esc(tool.plan)}${tool.dataAt ? ' · ' + fmtAge(tool.dataAt) : ''}`;
  return `<section class="limit-tool tool ${tone}" aria-label="${esc(tool.label)} account limits">`
    + `<div class="limit-tool-head">${toolNameHtml(tool)}<span class="tool-sub plan">${scope}</span></div>`
    + `<div class="gauges window-grid">${gaugeHtml(tool.limits.five_hour, '5-hour', tool)}${gaugeHtml(tool.limits.seven_day, 'Weekly', tool)}</div>`
    + `</section>`;
}

// Limit diagnostics qualify the account comparison, but never interrupt it.
// Render every known tool/window slot first, then name the affected tool and
// show its diagnostic below the complete comparison.
function limitNoteHtml(tool, scopeCopy = '') {
  const note = limitsNoteHtml(tool);
  if (!note) return '';
  const scope = scopeCopy ? `<span class="limit-note-scope">${scopeCopy}</span>` : '';
  return `<div class="limit-note ${toolToneClass(tool)}"><div class="limit-note-head">`
    + `${toolNameHtml(tool)}${scope}</div>${note}</div>`;
}

function limitNotesHtml(entries) {
  return (entries || []).map(({ tool, scopeCopy = '' }) => limitNoteHtml(tool, scopeCopy)).join('');
}

// Fallback used by the zero-DOM unit harness. The product page renders the
// stable tool-group shells from index.html so the independent insights surface
// is never replaced by the one-second limit countdown tick.
function toolHtml(tool) {
  return limitLaneHtml(tool) + `<section class="tool tool-group ${toolToneClass(tool)}">${toolCoreHtml(tool)}</section>`;
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

// ── Multi-host rendering (host × tool, host is the OUTER loop) ────────────────
// Every host's tools render through the EXISTING toolHtml()/gauge/burn/tiles/mix
// path (no fork). The only new chrome is the host-group card, the account-limits
// banner (detect-and-collapse), the same-account annotation, and the offline
// callout. Every peer-supplied field is esc()'d; no peer field touches a style.

// A tool's account-identity key: the pair of window reset epochs, bucketed by
// TOL so clock skew / staggered captures don't split one account into two. Two
// machines on the same account share the same account-wide reset windows, so
// their resetsAt epochs match; different accounts have independent windows.
// Returns null when the tool has no usable limit reading (it can't be grouped).
const ACCT_TOL_MS = 60_000; // one poll interval
function accountKey(tool) {
  if (!tool || !tool.limits) return null;
  const epoch = (w) => {
    const win = tool.limits[w];
    if (!win || !win.resetsAt) return null;
    const ms = Date.parse(win.resetsAt);
    return Number.isFinite(ms) ? Math.round(ms / ACCT_TOL_MS) : null;
  };
  const fh = epoch('five_hour'), sd = epoch('seven_day');
  if (fh == null && sd == null) return null; // no reading → not groupable
  return `${fh}|${sd}`;
}

// Group reachable hosts by account key, PER tool source. Returns, per source, a
// Map of key → [hostEntries]. Only reachable hosts with a usable reading for
// that tool participate; an offline host or a no-reading tool never joins a
// group. Pure over the combined payload — recomputed each render (reset epochs
// roll over). Exposed for unit tests.
function groupAccounts(hosts) {
  const bySource = {}; // source → Map(key → [{ host, tool }])
  for (const h of hosts) {
    if (!h.reachable || !h.state || !Array.isArray(h.state.tools)) continue;
    for (const tool of h.state.tools) {
      const key = accountKey(tool);
      if (key == null) continue;
      const src = tool.source;
      if (!bySource[src]) bySource[src] = new Map();
      if (!bySource[src].has(key)) bySource[src].set(key, []);
      bySource[src].get(key).push({ host: h, tool });
    }
  }
  return bySource;
}

// Natural join of ESCAPED host labels: "A", "A &amp; B", "A, B &amp; C". The
// "&" separator is emitted as the &amp; entity to match design.html verbatim
// (a literal & in innerHTML is tolerated but the mockup uses the entity).
function joinLabels(labels) {
  const e = labels.map(esc);
  if (e.length <= 1) return e.join('');
  if (e.length === 2) return `${e[0]} &amp; ${e[1]}`;
  return `${e.slice(0, -1).join(', ')} &amp; ${e[e.length - 1]}`;
}

// A tool lane showing ONLY the two account windows. Pacing and every local
// statistic stay below the complete limit comparison.
function limitsOnlyHtml(tool, scopeCopy = '') {
  return limitLaneHtml(tool, scopeCopy);
}

// One host-local tool story with no gauges. Its account readings are always in
// the multi-host limits overview above every host section.
function activityOnlyHtml(tool, hostLabel) {
  return `<section class="tool tool-group ${toolToneClass(tool)}">${toolCoreHtml(tool, hostLabel, null)}</section>`;
}

// Every unique reachable account identity renders here before any per-machine
// activity. Same-account reset identities collapse to one lane; genuinely
// different accounts stay distinct and name their host membership.
function accountOverviewHtml(hosts, groups) {
  const lanes = [];
  const entries = [];
  const represented = new Set();
  for (const src of ['claude-code', 'codex']) {
    const map = groups[src];
    if (!map) continue;
    for (const members of map.values()) {
      const rep = members.slice().sort((a, b) =>
        (Date.parse(b.tool.dataAt || 0) || 0) - (Date.parse(a.tool.dataAt || 0) || 0))[0];
      for (const member of members) represented.add(`${member.host.host}|${src}`);
      const membership = members.length > 1
        ? `identical on ${joinLabels(members.map((member) => member.host.label))}`
        : `from ${esc(rep.host.label)}`;
      const scopeCopy = `${esc(rep.tool.plan)} · ${membership}`;
      lanes.push(limitsOnlyHtml(rep.tool, scopeCopy));
      entries.push({ tool: rep.tool, scopeCopy });
    }
  }
  // A reachable tool with no usable reset identity still gets two honest slots;
  // it simply cannot be collapsed with another machine's account.
  for (const host of hosts) {
    if (!host.reachable || !host.state || !Array.isArray(host.state.tools)) continue;
    for (const tool of host.state.tools) {
      if (represented.has(`${host.host}|${tool.source}`)) continue;
      const scopeCopy = `${esc(tool.plan)} · from ${esc(host.label)}`;
      lanes.push(limitsOnlyHtml(tool, scopeCopy));
      entries.push({ tool, scopeCopy });
    }
  }
  if (!lanes.length) return '';
  return `<section class="limits-overview multi-limits" aria-labelledby="multi-limits-title">`
    + `<div class="limits-heading"><div><div class="section-kicker">Account limits</div>`
    + `<h1 id="multi-limits-title">Claude Code and Codex</h1></div>`
    + `<p class="scope-copy"><strong>Account-wide</strong> · matching account readings are shown once; different accounts remain labeled.</p></div>`
    + `<div class="limit-tools">${lanes.join('')}</div>`
    + `<div class="limit-notes">${limitNotesHtml(entries)}</div></section>`;
}

// hostDiagnostic reason → offline callout copy. Own-key (hasOwnProperty) lookup;
// escaped detail; enum reason/cause map to fixed copy, never rendered raw. Names
// which host and why (FR-09); never a gauge of zeros.
const PEER_CAUSE_FRAGMENTS = {
  'timeout': (t) => `no response within ${t}s`,
  'connect': () => `the connection couldn't be made`,
  'http-4': () => `it returned a client error`,
  'http-5': () => `it returned a server error`,
  'bad-json': () => `its response couldn't be read`,
  'oversized': () => `its response was too large`,
  'redirect': () => `it tried to redirect the read elsewhere`,
};
function causeFragment(cause, timeoutS) {
  if (typeof cause === 'string') {
    if (Object.prototype.hasOwnProperty.call(PEER_CAUSE_FRAGMENTS, cause)) return PEER_CAUSE_FRAGMENTS[cause](timeoutS);
    if (/^http-4\d\d$/.test(cause)) return PEER_CAUSE_FRAGMENTS['http-4']();
    if (/^http-5\d\d$/.test(cause)) return PEER_CAUSE_FRAGMENTS['http-5']();
  }
  return `it couldn't be read`;
}

// The `detail` is appended in parentheses ONLY for peer-error causes where it
// adds specifics (an HTTP status, a byte cap). For a timeout/connect the cause
// fragment already says it, so the raw detail would just restate it — omit it.
const CAUSES_WITH_SELF_EVIDENT_FRAGMENT = new Set(['timeout', 'connect']);
function hostOfflineNoteHtml(host, timeoutS) {
  const d = host.hostDiagnostic || {};
  const addr = `${esc(host.host)}:${esc(String(host.port))}`;
  const last = host.fetchedAt ? fmtAge(host.fetchedAt) : null;
  const lastClause = last ? ` Last polled ${last.replace(/^updated /, '')}.` : '';
  const detail = (d.detail && !CAUSES_WITH_SELF_EVIDENT_FRAGMENT.has(d.cause)) ? ` (${esc(d.detail)})` : '';
  if (d.reason === 'peer-error') {
    const frag = causeFragment(d.cause, timeoutS);
    return `<div class="host-offline-note"><strong>${esc(host.label)} returned an error</strong> — ${frag} (<code>peer-error</code>)${detail}.${lastClause} `
      + `Its reading isn't shown while it's erroring; the other hosts are unaffected. Check that llmdash is running correctly on <code>${addr}</code>.</div>`;
  }
  // peer-unreachable (default)
  const frag = causeFragment(d.cause, timeoutS);
  return `<div class="host-offline-note"><strong>${esc(host.label)} is unreachable</strong> — ${frag} (<code>peer-unreachable</code>)${detail}.${lastClause} `
    + `Its limits and activity aren't shown while it's offline; the other hosts are unaffected. Check that the machine is awake and llmdash is running on <code>${addr}</code>.</div>`;
}

// One host group (a .host card). A reachable host renders its tools; whether it
// shows its own limit gauges or the same-account annotation depends on grouping.
function hostGroupHtml(host, ctx) {
  const cls = 'host' + (host.self ? ' host-self' : '') + (host.reachable ? '' : ' host-offline');
  const addr = `${esc(host.host)}:${esc(String(host.port))}`;
  const youPill = host.self ? ` <span class="host-you">you</span>` : '';

  let stateHtml, headState;
  if (host.pending) {
    // Seeded but not yet polled this run — a brief transient before the first
    // fan-out result lands. Honest "polling", never a fabricated reading.
    headState = `<span class="host-state"><span class="pulse"></span>polling…</span>`;
    stateHtml = `<div class="empty-note">Waiting for the first reading from this host…</div>`;
  } else if (!host.reachable) {
    const pillWord = (host.hostDiagnostic && host.hostDiagnostic.reason === 'peer-error') ? 'error' : 'unreachable';
    headState = `<span class="host-state is-offline"><span class="pulse"></span><span class="host-pill pill-crit">${pillWord}</span></span>`;
    stateHtml = hostOfflineNoteHtml(host, ctx.timeoutS);
  } else {
    const age = ctx.freshestOf(host);
    headState = `<span class="host-state"><span class="pulse"></span>${age ? esc(age.replace(/^updated /, 'updated ')) : 'no readings yet'}</span>`;
    stateHtml = reachableHostBody(host, ctx);
  }

  return `<div class="${cls}"><div class="host-head">`
    + `<span class="host-name">${esc(host.label)}</span>${youPill}`
    + `<span class="host-addr">${addr}</span>${headState}</div>${stateHtml}</div>`;
}

// The body of a reachable host is always host-first and tool-grouped. All
// account gauges—shared and distinct—already appeared in the overview above.
function reachableHostBody(host, ctx) {
  const tools = (host.state && Array.isArray(host.state.tools)) ? host.state.tools.slice() : [];
  tools.sort((a, b) => ['claude-code', 'codex'].indexOf(a.source) - ['claude-code', 'codex'].indexOf(b.source));
  const parts = [];
  for (const tool of tools) {
    const key = accountKey(tool);
    const shared = key != null && ctx.sharedKeys[tool.source] && ctx.sharedKeys[tool.source].has(key);
    let annotation = `<span>this account's meters are shown above</span>`;
    if (shared) {
      const others = ctx.groups[tool.source].get(key)
        .map((member) => member.host.label).filter((label) => label !== host.label);
      annotation = `<span>same account as <span class="ref">${joinLabels(others)}</span>; the shared meters are shown once, up top</span>`;
    }
    parts.push(`<div class="same-acct"><span class="lead">Account limits above</span>— ${annotation}</div>`);
    parts.push(activityOnlyHtml(tool, host.self ? 'This machine' : host.label));
  }
  return parts.join('');
}

// Kept as a small compatibility helper for focused render tests and callers;
// multi-host production rendering now keeps every gauge in accountOverviewHtml.
function fullHostToolHtml(tool, host) {
  return activityOnlyHtml(tool, host.self ? 'This machine' : host.label);
}

const LEGEND_HTML = `<div class="legend-strip">`
  + `<span class="li"><b>Account limits</b> — the account's numbers; matching accounts are shown once before every host.</span>`
  + `<span class="li"><b>Per-machine activity</b> — tokens, sessions, cache, value from each machine's own session logs. Genuinely different per host.</span>`
  + `</div>`;

function renderHosts(combined) {
  const hostsEl = document.getElementById('hosts');
  const toolsEl = document.getElementById('tools');
  const headEl = document.getElementById('headroom');
  const hosts = (combined && Array.isArray(combined.hosts)) ? combined.hosts : [];
  const singleLimits = document.getElementById('single-limits');
  const detailsHeading = document.getElementById('details-heading');
  const toolGroups = document.getElementById('tool-groups');
  const claudeGroup = document.getElementById('claude-tool-group');
  const codexGroup = document.getElementById('codex-tool-group');
  const claudeDetails = document.getElementById('claude-details');
  const codexDetails = document.getElementById('codex-details');
  const limitNotes = document.getElementById('limit-notes');

  const renderStaticGroups = (tools, localOnly = false) => {
    const bySource = new Map((tools || []).map((tool) => [tool.source, tool]));
    const claude = bySource.get('claude-code');
    const codex = bySource.get('codex');
    if (claudeGroup) claudeGroup.hidden = !claude;
    if (codexGroup) codexGroup.hidden = !codex;
    if (claudeDetails) {
      claudeDetails.innerHTML = claude
        ? (localOnly
          ? `<div class="tool-group-head"><h2>${toolNameHtml(claude)}</h2><span class="group-summary">Trends · this machine</span></div>`
          : toolCoreHtml(claude, 'this machine', null)) : '';
    }
    if (codexDetails) {
      codexDetails.innerHTML = codex
        ? (localOnly
          ? `<div class="tool-group-head"><h2>${toolNameHtml(codex)}</h2><span class="group-summary">Deeper insights · trends · this machine</span></div>`
          : toolCoreHtml(codex, 'this machine', null)) : '';
    }
    if (detailsHeading) detailsHeading.hidden = !claude && !codex;
    if (toolGroups) toolGroups.hidden = !claude && !codex;
    return Boolean(claudeDetails || codexDetails);
  };

  // Single-host mode: one account comparison, then two stable tool-group
  // shells. Keeping the shells stable prevents the independent insights
  // surface from being replaced by the one-second countdown render.
  if (hosts.length === 1 && hosts[0].self && hosts[0].state) {
    hostsEl.innerHTML = '';
    const st = hosts[0].state;
    renderHeadroom(st.headroom);
    if (singleLimits) singleLimits.hidden = false;
    const limitEntries = (st.tools || []).map((tool) => ({ tool }));
    const lanes = limitEntries.map(({ tool }) => limitLaneHtml(tool)).join('');
    const notes = limitNotesHtml(limitEntries);
    if (limitNotes) limitNotes.innerHTML = notes;
    const hasStaticGroups = renderStaticGroups(st.tools || []);
    // Minimal-DOM unit harnesses don't instantiate index.html; retain a
    // complete fallback render there without changing the product DOM.
    toolsEl.innerHTML = hasStaticGroups ? lanes : lanes + (limitNotes ? '' : `<div class="limit-notes-inline">${notes}</div>`) + (st.tools || []).map((tool) =>
      `<section class="tool tool-group ${toolToneClass(tool)}">${toolCoreHtml(tool)}</section>`).join('');
    const freshest = (st.tools || []).map((t) => t.dataAt).filter(Boolean).sort().pop();
    document.getElementById('age').textContent = freshest ? fmtAge(freshest) : 'no readings yet';
    document.getElementById('freshness').classList.toggle('stale', !freshest);
    setFooterMode(false);
    return;
  }

  // Multi-host mode: every unique account lane first, followed by host-first
  // local tool stories. Offline stations are dimmed and sorted last.
  toolsEl.innerHTML = '';
  if (singleLimits) singleLimits.hidden = true;
  if (limitNotes) limitNotes.innerHTML = '';
  headEl.hidden = true; // headroom is a per-host, cross-tool cue; not shown at the aggregate level
  const groups = groupAccounts(hosts);
  const sharedKeys = {}; // source → Set(keys that group ≥2 hosts)
  for (const src of Object.keys(groups)) {
    sharedKeys[src] = new Set();
    for (const [key, members] of groups[src]) if (members.length >= 2) sharedKeys[src].add(key);
  }
  const timeoutS = (combined.peerTimeoutMs ? Math.round(combined.peerTimeoutMs / 1000) : 3);
  const ctx = {
    groups, sharedKeys, timeoutS,
    freshestOf: (h) => {
      const t = (h.state && h.state.tools) ? h.state.tools.map((x) => x.dataAt).filter(Boolean).sort().pop() : null;
      return t ? fmtAge(t) : (h.fetchedAt ? fmtAge(h.fetchedAt) : null);
    },
  };
  const overview = accountOverviewHtml(hosts, groups);
  const orderedHosts = hosts.slice().sort((a, b) => {
    if (Boolean(a.reachable) !== Boolean(b.reachable)) return a.reachable ? -1 : 1;
    if (Boolean(a.self) !== Boolean(b.self)) return a.self ? -1 : 1;
    return 0;
  });
  const cards = orderedHosts.map((h) => hostGroupHtml(h, ctx)).join('');
  hostsEl.innerHTML = overview + cards + LEGEND_HTML;

  // Preserve local Codex insights and both local trend groups in multi-host
  // mode without mixing them into a peer's activity. They follow the host-first
  // read and remain explicitly scoped to this machine.
  const self = hosts.find((host) => host.self && host.reachable && host.state);
  renderStaticGroups(self && self.state ? self.state.tools || [] : [], true);

  // Header freshness: "N hosts · updated <age> ago" from the freshest reachable
  // host's newest capture.
  const reachable = hosts.filter((h) => h.reachable && h.state);
  const freshest = reachable.flatMap((h) => (h.state.tools || []).map((t) => t.dataAt))
    .filter(Boolean).sort().pop();
  const ageStr = freshest ? fmtAge(freshest).replace(/^updated /, '') : 'no readings yet';
  document.getElementById('age').textContent = `${hosts.length} hosts · ${freshest ? 'updated ' + ageStr : ageStr}`;
  document.getElementById('freshness').classList.toggle('stale', !freshest);
  setFooterMode(true);
}

// The footer honesty line switches between single-host and multi-host framing.
// Single-host: "Activity: local session logs"; multi-host: "Activity: per
// machine · N hosts over Tailscale".
function setFooterMode(multi) {
  const f = document.querySelector('footer');
  if (!f) return;
  const spans = f.querySelectorAll('span');
  if (spans.length < 2) return;
  if (multi) {
    spans[0].textContent = 'Limits: account-wide · Activity: per machine · Codex day buckets: UTC';
    const n = state && Array.isArray(state.hosts) ? state.hosts.length : 0;
    spans[1].textContent = `${n} hosts over Tailscale`;
  } else {
    spans[0].textContent = 'Limits: account-wide · Activity: local session logs · Codex day buckets: UTC';
    spans[1].textContent = 'served over Tailscale';
  }
}

function render() {
  if (!state) return;
  renderHosts(state);
}

async function refresh() {
  try {
    const res = await fetch('/api/hosts', { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    state = await res.json();
    render();
  } catch { document.getElementById('age').textContent = 'offline — retrying'; }
}

setInterval(() => { if (state) render(); }, 1000);
setInterval(refresh, REFRESH_MS);
refresh();

// --- Deeper Codex insights (this machine only) ---
// This section is deliberately independent from both the host fan-out and the
// global Trends range. The endpoint contains normalized aggregates only; the
// client still treats every field as untrusted before it reaches HTML or a
// data-driven width.
const INSIGHTS_REFRESH_MS = 120_000;
const INSIGHT_RANGE_COPY = Object.freeze({
  '24h': 'last 24 hours',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
});
const CREDIT_STATUS_COPY = Object.freeze({
  unlimited: 'Unlimited',
  available: 'Credits available',
  none: 'No credits',
});
let INSIGHT_RANGE = '7d';
let insightRequestSequence = 0;
let insightHasRendered = false;
let insightHasFailed = false;

function safeInsightNumber(value, max = Number.MAX_SAFE_INTEGER) {
  return Number.isFinite(value) && value >= 0 ? Math.min(value, max) : null;
}

function safeInsightCount(value) {
  const n = safeInsightNumber(value);
  return n == null ? null : Math.floor(n);
}

function safeInsightRatio(value) {
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : null;
}

function boundedInsightLabel(value, fallback = 'Other') {
  if (typeof value !== 'string') return fallback;
  const normalized = value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').trim();
  const clean = [...normalized].slice(0, 64).join('');
  return clean || fallback;
}

function fmtInsightNumber(value) {
  const n = safeInsightNumber(value);
  if (n == null) return null;
  if (n >= 1e9) return (n / 1e9).toFixed(n >= 10e9 ? 0 : 1).replace(/\.0$/, '') + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(n >= 10e6 ? 0 : 1).replace(/\.0$/, '') + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(n >= 10e3 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return Math.round(n).toLocaleString();
}

function fmtInsightDuration(value) {
  const ms = safeInsightNumber(value);
  if (ms == null) return null;
  if (ms > 86_400_000) return '≥24h';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}s`;
  const roundedSeconds = Math.round(ms / 1000);
  if (roundedSeconds < 60) return `${roundedSeconds}s`;
  if (roundedSeconds >= 3600) {
    const roundedMinutes = Math.round(roundedSeconds / 60);
    const hours = Math.floor(roundedMinutes / 60);
    const minutes = roundedMinutes % 60;
    return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  const minutes = Math.floor(roundedSeconds / 60);
  const seconds = roundedSeconds % 60;
  return seconds ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function insightDayMs(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(value)) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value) return null;
  return ms;
}

function fmtInsightDay(value) {
  const ms = insightDayMs(value);
  if (ms == null) return null;
  return new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function plural(value, singular, many = `${singular}s`) {
  return value === 1 ? singular : many;
}

function insightAccountHtml(account) {
  const plan = account && account.plan && account.plan.available === true
    ? boundedInsightLabel(account.plan.label, '') : '';
  const credits = account && account.credits;
  const creditStatus = credits && credits.available === true
    && Object.prototype.hasOwnProperty.call(CREDIT_STATUS_COPY, credits.status)
    ? CREDIT_STATUS_COPY[credits.status] : 'Credit status unavailable';
  const bits = [`<strong>Account-wide</strong>`, `<span>${esc(plan || 'Plan unavailable')}</span>`, `<span>${creditStatus}</span>`];
  if (credits && credits.available === true && typeof credits.balance === 'string') {
    const balance = boundedInsightLabel(credits.balance, '');
    if (balance) bits.push(`<span>Balance ${esc(balance)}</span>`);
  }
  const resetCount = credits && credits.available === true
    ? safeInsightCount(credits.resetCreditsAvailable) : null;
  if (resetCount != null) bits.push(`<span>${resetCount.toLocaleString()} reset ${plural(resetCount, 'credit')}</span>`);
  return `<div class="insights-account">${bits.join('')}</div>`;
}

function insightMetricHtml(label, available, value, note, unavailableCopy) {
  if (!available) {
    return `<div class="insight-metric"><div class="insight-metric-label">${label}</div>`
      + `<div class="insight-metric-value insight-unavailable">Unavailable</div>`
      + `<div class="insight-metric-note">${unavailableCopy}</div></div>`;
  }
  return `<div class="insight-metric"><div class="insight-metric-label">${label}</div>`
    + `<div class="insight-metric-value">${value}</div><div class="insight-metric-note">${note}</div></div>`;
}

function insightSummaryHtml(summary) {
  const s = summary || {};
  const reasoning = s.reasoning || {};
  const reasoningShare = safeInsightRatio(reasoning.share);
  const reasoningTokens = safeInsightNumber(reasoning.tokens);
  const outputTokens = safeInsightNumber(reasoning.outputTokens);
  const reasoningAvailable = reasoning.available === true && reasoningShare != null
    && reasoningTokens != null && outputTokens != null;

  const turns = s.turns || {};
  const turnCount = safeInsightCount(turns.count);
  const turnAverage = safeInsightNumber(turns.averageTokens);
  const turnsAvailable = turns.available === true && turnCount != null && turnAverage != null;

  const sessions = s.sessions || {};
  const sessionCount = safeInsightCount(sessions.count);
  const sessionAverage = safeInsightNumber(sessions.averageTokens);
  const sessionsAvailable = sessions.available === true && sessionCount != null && sessionAverage != null;

  const busiest = s.busiestDay || {};
  const busiestDay = fmtInsightDay(busiest.day);
  const busiestTokens = safeInsightNumber(busiest.tokens);
  const busiestAvailable = busiest.available === true && busiestDay != null && busiestTokens != null;

  return `<div class="insights-summary">`
    + insightMetricHtml('Reasoning share', reasoningAvailable,
      `${Math.round((reasoningShare || 0) * 100)}%`,
      `${fmtInsightNumber(reasoningTokens) || '0'} of ${fmtInsightNumber(outputTokens) || '0'} output tokens`,
      `Reasoning/output counts weren't recorded by this Codex version.`)
    + insightMetricHtml('Tokens / turn', turnsAvailable,
      fmtInsightNumber(turnAverage) || '0',
      `${turnCount == null ? 0 : turnCount.toLocaleString()} recorded ${plural(turnCount, 'turn')}`,
      `Supported turn boundaries weren't recorded for this range.`)
    + insightMetricHtml('Sessions', sessionsAvailable,
      sessionCount == null ? '0' : sessionCount.toLocaleString(),
      `${fmtInsightNumber(sessionAverage) || '0'} avg / session`,
      `Supported session usage wasn't recorded for this range.`)
    + insightMetricHtml('Busiest day', busiestAvailable,
      esc(busiestDay || ''),
      `${fmtInsightNumber(busiestTokens) || '0'} tokens · UTC`,
      `Daily token totals weren't recorded for this range.`)
    + `</div>`;
}

function insightMixGroupHtml(kind, group) {
  const specs = {
    models: { title: 'Models · token share', max: 6, countKey: 'turns', shareKey: 'tokenShare', noun: 'tagged turn' },
    effort: { title: 'Effort · turns', max: 5, countKey: 'turns', shareKey: 'share', noun: 'tagged turn' },
    tools: { title: 'Tools · invocations', max: 6, countKey: 'invocations', shareKey: 'share', noun: 'recorded invocation' },
  };
  const spec = specs[kind];
  if (!spec) return '';
  if (!group || group.available !== true || !Array.isArray(group.items)) {
    return `<div class="insight-mix-group"><div class="insight-mix-head"><strong>${spec.title}</strong><span>Unavailable</span></div>`
      + `<div class="insight-mix-empty">This metadata wasn't recorded by this Codex version.</div></div>`;
  }
  const items = group.items.slice(0, spec.max).map((item) => {
    const count = item && safeInsightCount(item[spec.countKey]);
    const share = item && safeInsightRatio(item[spec.shareKey]);
    if (count == null || share == null) return null;
    return { label: boundedInsightLabel(item.label), count, share };
  }).filter(Boolean);
  const total = items.reduce((sum, item) => Math.min(Number.MAX_SAFE_INTEGER, sum + item.count), 0);
  const head = `<div class="insight-mix-head"><strong>${spec.title}</strong><span>${total.toLocaleString()} ${plural(total, spec.noun)}</span></div>`;
  if (!items.length) return `<div class="insight-mix-group">${head}<div class="insight-mix-empty">0 recorded</div></div>`;
  const rows = items.map((item) => {
    const pct = Math.round(item.share * 100);
    const value = kind === 'tools' ? item.count.toLocaleString()
      : `${pct}%<small>${item.count.toLocaleString()} ${plural(item.count, 'turn')}</small>`;
    return `<div class="insight-mix-row"><b title="${esc(item.label)}">${esc(item.label)}</b>`
      + `<div class="insight-mini" aria-hidden="true"><i style="width:${pct}%"></i></div>`
      + `<span class="insight-mix-value">${value}</span></div>`;
  }).join('');
  return `<div class="insight-mix-group">${head}${rows}</div>`;
}

function insightFactHtml(label, note, available, value, sub, unavailableCopy) {
  return `<div><dt>${label}<small>${available ? note : unavailableCopy}</small></dt>`
    + `<dd class="${available ? '' : 'insight-unavailable'}">${available ? value : 'Unavailable'}`
    + (available && sub ? `<small>${sub}</small>` : '') + `</dd></div>`;
}

function insightDetailsHtml(data) {
  const mix = data.mix || {};
  const context = data.context || {};
  const pressure = context.pressure || {};
  const peak = safeInsightRatio(pressure.peak);
  const supportedTurns = safeInsightCount(pressure.supportedTurns);
  const highTurns = safeInsightCount(pressure.turnsAtOrAbove80Pct);
  const pressureAvailable = pressure.available === true && peak != null
    && supportedTurns != null && highTurns != null;

  const compactions = context.compactions || {};
  const compactionCount = safeInsightCount(compactions.count);
  const compactedSessions = safeInsightCount(compactions.sessionsAffected);
  const compactionsAvailable = compactions.available === true && compactionCount != null
    && compactedSessions != null;

  const latency = data.latency || {};
  const totalLatency = latency.total || {};
  const totalMedian = fmtInsightDuration(totalLatency.medianMs);
  const totalP95 = fmtInsightDuration(totalLatency.p95Ms);
  const totalSamples = safeInsightCount(totalLatency.samples);
  const totalAvailable = totalLatency.available === true && totalMedian != null
    && totalP95 != null && totalSamples != null;

  const firstLatency = latency.firstToken || {};
  const firstMedian = fmtInsightDuration(firstLatency.medianMs);
  const firstP95 = fmtInsightDuration(firstLatency.p95Ms);
  const firstSamples = safeInsightCount(firstLatency.samples);
  const firstAvailable = firstLatency.available === true && firstMedian != null
    && firstP95 != null && firstSamples != null;

  return `<div class="insights-detail-grid">`
    + `<section class="insights-detail"><div class="insights-detail-title">Work mix</div>`
    + insightMixGroupHtml('models', mix.models)
    + insightMixGroupHtml('effort', mix.effort)
    + insightMixGroupHtml('tools', mix.tools) + `</section>`
    + `<section class="insights-detail"><div class="insights-detail-title">Context &amp; timing</div><dl class="insights-facts">`
    + insightFactHtml('Peak context pressure', `${supportedTurns || 0} ${plural(supportedTurns, 'turn')} had explicit windows`, pressureAvailable,
      `${Math.round((peak || 0) * 100)}%`, `${highTurns || 0} ${plural(highTurns, 'turn')} ≥80%`,
      `An explicit context window wasn't recorded.`)
    + insightFactHtml('Compactions', 'across affected sessions', compactionsAvailable,
      (compactionCount || 0).toLocaleString(), `${compactedSessions || 0} affected ${plural(compactedSessions, 'session')}`,
      `Compaction events weren't recorded.`)
    + insightFactHtml('Total duration', `${totalSamples || 0} completed ${plural(totalSamples, 'turn')}`, totalAvailable,
      `${totalMedian} median`, `${totalP95} p95`,
      `Completed-task timing wasn't recorded by this Codex version.`)
    + insightFactHtml('Time to first token', `${firstSamples || 0} completed ${plural(firstSamples, 'turn')}`, firstAvailable,
      `${firstMedian} median`, `${firstP95} p95`,
      `First-token timing wasn't recorded by this Codex version.`)
    + `</dl></section></div>`;
}

function insightChartHtml(kind, daily) {
  const spec = kind === 'reasoning'
    ? { key: 'reasoningShare', title: 'Reasoning share', src: 'daily · output tokens', cls: 'insight-series-accent', format: (v) => `${Math.round(v * 100)}%`, floor: 0.01 }
    : { key: 'averageTokensPerTurn', title: 'Average tokens / turn', src: 'daily · recorded turns', cls: 'insight-series-teal', format: (v) => fmtInsightNumber(v) || '0', floor: 1 };
  const byDay = new Map();
  for (const row of Array.isArray(daily) ? daily.slice(0, 30) : []) {
    const ms = row ? insightDayMs(row.day) : null;
    const value = row && (kind === 'reasoning' ? safeInsightRatio(row[spec.key]) : safeInsightNumber(row[spec.key]));
    if (ms != null && value != null) byDay.set(ms, value);
  }
  const points = [...byDay].sort((a, b) => a[0] - b[0]);
  if (points.length < 2) return '';
  const x0 = 18, x1 = 342, y0 = 17, y1 = 88;
  const observedMax = Math.max(...points.map((point) => point[1]));
  const scaleMax = Math.max(spec.floor, observedMax);
  const firstDay = points[0][0], lastDay = points[points.length - 1][0];
  const sx = (day) => x0 + ((day - firstDay) / (lastDay - firstDay)) * (x1 - x0);
  const sy = (value) => y1 - (value / scaleMax) * (y1 - y0);
  const coords = points.map((point) => `${sx(point[0]).toFixed(1)},${sy(point[1]).toFixed(1)}`).join(' ');
  const middleIndex = Math.floor((points.length - 1) / 2);
  const middleX = sx(points[middleIndex][0]);
  const labelIndexes = [0];
  if (middleIndex > 0 && middleIndex < points.length - 1
    && middleX - x0 >= 72 && x1 - middleX >= 72) labelIndexes.push(middleIndex);
  labelIndexes.push(points.length - 1);
  const labels = labelIndexes.map((index) => {
    const label = fmtInsightDay(new Date(points[index][0]).toISOString()) || '';
    const anchor = index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle';
    return `<text x="${sx(points[index][0]).toFixed(1)}" y="108" text-anchor="${anchor}">${esc(label)}</text>`;
  }).join('');
  const minValue = Math.min(...points.map((point) => point[1]));
  const desc = `${spec.title} ranged from ${spec.format(minValue)} to ${spec.format(observedMax)} over ${points.length} UTC days.`;
  const textEquivalent = points.map((point) => {
    const day = fmtInsightDay(new Date(point[0]).toISOString()) || 'Unknown day';
    return `${day} ${spec.format(point[1])}`;
  }).join(', ');
  const id = kind === 'reasoning' ? 'insight-reasoning-chart' : 'insight-turn-chart';
  return `<section class="insight-chart"><div class="insight-chart-head"><strong>${spec.title}</strong><span>${spec.src}</span></div>`
    + `<svg viewBox="0 0 360 118" role="img" aria-labelledby="${id}-title ${id}-desc">`
    + `<title id="${id}-title">Daily ${spec.title.toLowerCase()}</title><desc id="${id}-desc">${esc(desc)}</desc>`
    + `<path class="gridline" d="M18 17H342M18 52H342M18 88H342"/>`
    + `<polyline class="insight-chart-series ${spec.cls}" points="${coords}"/>${labels}</svg>`
    + `<span class="sr-only">${esc(textEquivalent)}.</span></section>`;
}

function insightDailyHtml(daily) {
  const charts = [insightChartHtml('reasoning', daily), insightChartHtml('turns', daily)].filter(Boolean);
  return charts.length ? `<div class="insights-daily${charts.length === 1 ? ' insights-daily-single' : ''}">${charts.join('')}</div>` : '';
}

function renderCodexInsights(data, announce = true) {
  const surface = document.getElementById('insights-surface');
  if (!surface) return;
  const account = insightAccountHtml(data && data.account);
  if (!data || data.hasData !== true) {
    const rangeCopy = INSIGHT_RANGE_COPY[INSIGHT_RANGE].replace(/^last /, 'the last ');
    surface.innerHTML = account + `<div class="insights-state">No supported Codex activity was recorded in ${rangeCopy} on this machine.</div>`;
  } else {
    surface.innerHTML = account + insightSummaryHtml(data.summary)
      + insightDetailsHtml(data) + insightDailyHtml(data.daily);
  }
  surface.setAttribute('aria-busy', 'false');
  const status = document.getElementById('insights-status');
  if (status) {
    status.textContent = announce ? `Updated · ${INSIGHT_RANGE_COPY[INSIGHT_RANGE]}` : '';
    if (announce) {
      const request = insightRequestSequence;
      setTimeout(() => {
        if (request === insightRequestSequence && status.textContent.startsWith('Updated ·')) status.textContent = '';
      }, 2000);
    }
  }
}

function renderCodexInsightsError() {
  const surface = document.getElementById('insights-surface');
  if (!surface) return;
  surface.innerHTML = `<div class="insights-state insights-error">Codex insights are unavailable right now — account limits above are unaffected.</div>`;
  surface.setAttribute('aria-busy', 'false');
  const status = document.getElementById('insights-status');
  if (status) status.textContent = 'Unavailable';
}

async function fetchCodexInsights({ announce = true } = {}) {
  const surface = document.getElementById('insights-surface');
  if (!surface) return;
  const requestedRange = INSIGHT_RANGE;
  const request = ++insightRequestSequence;
  surface.setAttribute('aria-busy', 'true');
  const status = document.getElementById('insights-status');
  if (insightHasRendered) {
    if (status && announce) status.textContent = 'Updating…';
  } else if (announce) {
    if (status) status.textContent = 'Loading…';
    surface.innerHTML = `<div class="insights-state">Reading local Codex session metadata…</div>`;
  }
  try {
    const res = await fetch('/api/codex-insights?range=' + encodeURIComponent(requestedRange), { cache: 'no-store' });
    if (!res.ok) throw new Error('bad status');
    const data = await res.json();
    if (request !== insightRequestSequence) return;
    if (!data || data.source !== 'codex' || data.scope !== 'local-machine' || data.range !== requestedRange) {
      throw new Error('bad payload');
    }
    insightHasRendered = true;
    insightHasFailed = false;
    renderCodexInsights(data, announce);
  } catch {
    if (request !== insightRequestSequence) return;
    insightHasRendered = false;
    if (announce || !insightHasFailed) renderCodexInsightsError();
    else surface.setAttribute('aria-busy', 'false');
    insightHasFailed = true;
  }
}

function setupInsightRange() {
  const range = document.getElementById('insights-range');
  if (!range) return;
  range.addEventListener('click', (event) => {
    const button = event.target.closest('.pill');
    if (!button) return;
    const selectedRange = button.dataset.range;
    if (!Object.prototype.hasOwnProperty.call(INSIGHT_RANGE_COPY, selectedRange)
      || selectedRange === INSIGHT_RANGE) return;
    INSIGHT_RANGE = selectedRange;
    [...range.querySelectorAll('.pill')].forEach((pill) => {
      const selected = pill === button;
      pill.classList.toggle('active', selected);
      pill.setAttribute('aria-pressed', String(selected));
    });
    const copy = document.getElementById('insights-range-copy');
    if (copy) copy.textContent = INSIGHT_RANGE_COPY[selectedRange];
    fetchCodexInsights();
  });
}

setupInsightRange();
fetchCodexInsights();
setInterval(() => fetchCodexInsights({ announce: false }), INSIGHTS_REFRESH_MS);

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
    : `<polyline class="chart-series ${s.className}" points="${s.pts.map((p) => `${scaleX(p[0], t0, t1, x0, x1).toFixed(1)},${sy(p[1]).toFixed(1)}`).join(' ')}"/>`).join('');
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

const legendHtml = (items) => `<div class="legend">` + items.map(([cls, label]) => `<span><i class="legend-swatch legend-${cls}"></i>${label}</span>`).join('') + `</div>`;

function chartCard(title, src, svg, legend) {
  return `<div class="card"><div class="card-title">${title}</div><div class="card-src">${src}</div>`
    + (svg ? svg + (legend || '') : '<div class="nodata">not enough data yet</div>') + `</div>`;
}

function trendToolHtml(t, range) {
  return `<section class="trend-tool ${toolToneClass(t)}"><div class="trend-tool-head">${toolNameHtml(t)}</div>`
    + trendContentHtml(t, range) + `</section>`;
}

function trendContentHtml(t, range) {
  const fh = t.limits.five_hour || [], sd = t.limits.seven_day || [], daily = t.daily || [];
  const hasLimits = fh.length >= 2 || sd.length >= 2;
  const hasActivity = daily.length >= 1;
  if (!hasLimits && !hasActivity) {
    return `<div class="empty">Not enough data yet — ${esc(t.label)} trends fill in as you use it.</div>`;
  }
  const pct = (v) => Math.round(v) + '%';
  const xDomain = [Date.now() - rangeToMs(range), Date.now()];
  const cards = [];
  const burn = lineSVG([
    { pts: fh.map((p) => [Date.parse(p.t), p.remaining]), className: 'series-accent' },
    { pts: sd.map((p) => [Date.parse(p.t), p.remaining]), className: 'series-teal' },
  ], 100, pct, { xDomain });
  cards.push(chartCard('Limit remaining', 'account-wide · snapshots', burn, legendHtml([['accent', '5-hour'], ['teal', 'Weekly']])));
  // Only show the log-derived charts for tools that actually record activity.
  if (hasActivity) {
    const codex = t.source === 'codex';
    const tokens = barsSVG(daily, fmtNum);
    const rate = lineSVG([{ pts: daily.map((d) => [Date.parse(d.day), d.cacheHitRate * 100]), className: 'series-good' }], 100, pct, { xDomain });
    const crLab = codex ? 'Cached input' : 'Cache';
    cards.push(chartCard('Tokens per day', codex ? 'local logs · UTC buckets' : 'local logs', tokens, legendHtml([['cr', crLab], ['in', 'Input'], ['out', 'Output']])));
    cards.push(chartCard('Cache hit rate', codex ? 'local logs · cached ÷ input' : 'local logs', rate, ''));
  }
  const note = (hasLimits && !hasActivity)
    ? `<div class="empty-note">Token-based trends aren't available for ${esc(t.label)} — limits only.</div>`
    : '';
  return `<div class="charts">${cards.join('')}</div>${note}`;
}

async function fetchTrends() {
  try {
    const res = await fetch('/api/trends?range=' + encodeURIComponent(TREND_RANGE), { cache: 'no-store' });
    if (!res.ok) throw new Error('bad');
    const data = await res.json();
    const targets = {
      'claude-code': document.getElementById('trends-claude'),
      codex: document.getElementById('trends-codex'),
    };
    let renderedInGroups = false;
    for (const tool of Array.isArray(data.tools) ? data.tools : []) {
      const target = targets[tool.source];
      if (!target) continue;
      target.innerHTML = trendContentHtml(tool, data.range);
      renderedInGroups = true;
    }
    for (const [source, target] of Object.entries(targets)) {
      if (target && !(data.tools || []).some((tool) => tool.source === source)) {
        target.innerHTML = `<div class="empty">Not enough data yet — trends fill in as you use this tool.</div>`;
      }
    }
    const claudeCopy = document.getElementById('claude-trends-range');
    const codexCopy = document.getElementById('codex-trends-range');
    if (claudeCopy) claudeCopy.textContent = data.range;
    if (codexCopy) codexCopy.textContent = data.range;
    // Minimal-DOM and legacy embedding fallback.
    const fallback = document.getElementById('trends');
    if (!renderedInGroups && fallback) fallback.innerHTML = (data.tools || []).map((tool) => trendToolHtml(tool, data.range)).join('');
  } catch { /* keep the previous render */ }
}

function setupRange() {
  const r = document.getElementById('range');
  if (!r) return;
  r.addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    TREND_RANGE = btn.dataset.range || '7d';
    [...r.querySelectorAll('.pill')].forEach((p) => {
      const selected = p === btn;
      p.classList.toggle('active', selected);
      p.setAttribute('aria-pressed', String(selected));
    });
    fetchTrends();
  });
}

setupRange();
fetchTrends();
setInterval(fetchTrends, TREND_REFRESH_MS);

// --- Cost analysis ---------------------------------------------------------
// This surface has an independent range and request sequence. It renders only
// the poller-owned local snapshot; range clicks never trigger filesystem work.
let COST_RANGE = '30d';
let costRequestSequence = 0;
let costHasRendered = false;
const COST_REFRESH_MS = 120_000;
const COST_RANGES = new Set(['7d', '30d', '90d']);
const COST_METRICS = [
  ['subscription', 'Configured subscription spend'],
  ['observedCache', 'API-equivalent · observed cache'],
  ['noCache', 'API-equivalent · no cache'],
  ['cacheEffect', 'Cache effect · no cache − observed'],
];
const COST_REASON_COPY = Object.freeze({
  subscription_missing: 'No owner-confirmed subscription coverage is configured.',
  subscription_unreadable: 'The local subscription configuration could not be read.',
  subscription_invalid_file: 'The local subscription configuration is invalid.',
  subscription_invalid_entry: 'An invalid subscription period was excluded.',
  subscription_unconfirmed: 'An unconfirmed subscription period was excluded.',
  subscription_overlap: 'Overlapping subscription periods were excluded.',
  subscription_gap: 'The selected range has a subscription coverage gap.',
  rate_card_unreadable: 'The reviewed API rate card could not be read.',
  rate_card_invalid: 'The reviewed API rate card is invalid.',
  rate_invalid_entry: 'An invalid API rate was excluded.',
  rate_overlap: 'Overlapping API rates were excluded.',
  unknown_model: 'Usage from a model without an exact reviewed rate was excluded.',
  rate_missing: 'A required token-channel rate was unavailable.',
  timestamp_invalid: 'Usage with an invalid timestamp was excluded.',
  token_record_invalid: 'Usage with an invalid token tuple was excluded.',
  source_missing: 'A local usage root is not present.',
  source_unreadable: 'A local usage root could not be read.',
  source_traversal_error: 'Part of a local usage tree could not be traversed.',
  file_too_large: 'An oversized local usage file was omitted.',
  record_unsupported: 'An unsupported local usage record was omitted.',
  dedupe_fallback: 'Some records lack a stable cross-file identity.',
  scan_budget_depth: 'The bounded scan reached its directory-depth limit.',
  scan_budget_directories: 'The bounded scan reached its directory limit.',
  scan_budget_entries: 'The bounded scan reached its directory-entry limit.',
  scan_budget_files: 'The bounded scan reached its file-count limit.',
  scan_budget_file_bytes: 'The bounded scan reached its per-file byte limit.',
  scan_budget_total_bytes: 'The bounded scan reached its total byte limit.',
  scan_budget_lines: 'The bounded scan reached its line limit.',
  scan_budget_records: 'The bounded scan reached its accepted-record limit.',
  scan_budget_time: 'The bounded scan reached its time limit.',
  amount_overflow: 'The supported amount exceeded the safe display range.',
  cache_cold: 'Cost analysis is still warming.',
  refresh_failed: 'The latest refresh failed; the prior snapshot is still shown.',
});

function costStatus(metric) {
  return metric && ['complete', 'partial', 'unavailable'].includes(metric.status) ? metric.status : 'unavailable';
}

function costAmountText(metric, signed = false) {
  const micros = metric && Number.isSafeInteger(metric.amountMicros) ? metric.amountMicros : null;
  if (micros === null) return 'Unavailable';
  if (signed && micros === 0 && metric?.belowResolution === true
    && (metric.rawSign === -1 || metric.rawSign === 1)) {
    return `${metric.rawSign < 0 ? '−' : '+'}<$0.01`;
  }
  const absolute = Math.abs(micros);
  const prefix = signed && micros > 0 ? '+' : micros < 0 ? '−' : '';
  if (absolute > 0 && absolute < 10_000) return `${prefix}<$0.01`;
  const value = absolute / 1_000_000;
  const formatted = new Intl.NumberFormat(undefined, {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(value);
  return prefix + formatted;
}

function costAmountHtml(metric, signed = false) {
  const status = costStatus(metric);
  return `<span class="cost-amount${signed ? ' cost-signed' : ''}${status === 'unavailable' ? ' is-unavailable' : ''}">${esc(costAmountText(metric, signed))}</span>`;
}

function costBadge(metric) {
  const status = costStatus(metric);
  return `<span class="cost-badge is-${status}">${status}</span>`;
}

function costMetricNote(key, metric) {
  if (costStatus(metric) === 'unavailable') {
    const reason = Array.isArray(metric && metric.reasons)
      ? metric.reasons.find((item) => Object.hasOwn(COST_REASON_COPY, item)) : null;
    return reason ? COST_REASON_COPY[reason] : 'No supported amount is available.';
  }
  if (key === 'subscription') return 'owner-confirmed fixed access';
  if (key === 'observedCache') return 'same local records · observed cache';
  if (key === 'noCache') return 'same local records · normal input price';
  return 'signed effect · not a provider bill';
}

function costSummaryHtml(summary) {
  return `<div class="cost-summary">${COST_METRICS.map(([key, label]) => {
    const metric = summary && summary[key];
    return `<div class="cost-summary-cell"><div class="cost-metric-label">${esc(label)}</div>`
      + `<div class="cost-value-line">${costAmountHtml(metric, key === 'cacheEffect')}${costBadge(metric)}</div>`
      + `<div class="cost-metric-note">${esc(costMetricNote(key, metric))}</div></div>`;
  }).join('')}</div>`;
}

function costBreakdownRow(scopeName, scope) {
  const labels = { combined: 'Combined', claude: '◆ Claude', codex: '▲ Codex' };
  return `<div class="cost-breakdown-row"><div class="cost-scope-name scope-${scopeName}">${esc(labels[scopeName])}</div>`
    + COST_METRICS.map(([key]) => {
      const short = { subscription: 'Subscription', observedCache: 'Observed cache', noCache: 'No cache', cacheEffect: 'Cache effect' }[key];
      const metric = scope && scope.summary && scope.summary[key];
      return `<div class="cost-breakdown-metric"><span>${short}</span><strong>${costAmountHtml(metric, key === 'cacheEffect')}</strong>${costBadge(metric)}</div>`;
    }).join('') + `</div>`;
}

function costBreakdownHtml(scopes) {
  return `<section class="cost-block cost-breakdown" aria-labelledby="cost-breakdown-title">`
    + `<div class="cost-block-head"><h3 id="cost-breakdown-title">Reconciled breakdown</h3><span>Final cumulative values · USD</span></div>`
    + `<div class="cost-breakdown-grid">${['combined', 'claude', 'codex'].map((name) => costBreakdownRow(name, scopes[name])).join('')}</div></section>`;
}

function costDateLabel(iso, timeZone, withTime = false) {
  if (typeof iso !== 'string' && typeof iso !== 'number') return '—';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, withTime
      ? { timeZone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }
      : { timeZone, month: 'short', day: 'numeric' }).format(date);
  } catch { return '—'; }
}

function costChartHtml(scopeName, scope, data) {
  const width = 720, height = 230, x0 = 48, x1 = 650, y0 = 20, y1 = 184;
  const cumulative = Array.isArray(scope && scope.cumulative) ? scope.cumulative.slice(0, 90) : [];
  const specs = [
    ['subscription', 'Configured subscription spend', 'subscription'],
    ['observedCache', 'API-equivalent · observed cache', 'observed'],
    ['noCache', 'API-equivalent · no cache', 'no-cache'],
  ];
  const numericValues = cumulative.flatMap((row) => specs.map(([key]) => row?.[key]?.amountMicros)
    .filter((value) => Number.isSafeInteger(value) && value >= 0));
  const names = { combined: 'Combined', claude: 'Claude', codex: 'Codex' };
  const finalText = specs.map(([key, label]) => `${label}: ${costAmountText(scope?.summary?.[key])} (${costStatus(scope?.summary?.[key])})`).join('; ');
  if (!numericValues.length) {
    return `<section class="cost-chart cost-chart-${scopeName}"><div class="cost-chart-head"><h4>${names[scopeName]}</h4>${costBadge(scope?.summary?.observedCache)}</div>`
      + `<div class="cost-chart-empty">No supported cumulative API value is available for this scope. Subscription setup and evidence details remain below.</div>`
      + `<span class="sr-only">${esc(finalText)}</span></section>`;
  }
  const startMs = Date.parse(data.interval.start), endMs = Date.parse(data.interval.end);
  const maxMicros = Math.max(1, ...numericValues);
  const sx = (time) => x0 + ((time - startMs) / Math.max(1, endMs - startMs)) * (x1 - x0);
  const sy = (value) => y1 - (value / maxMicros) * (y1 - y0);
  const grid = [0, 0.5, 1].map((portion) => {
    const y = y1 - portion * (y1 - y0);
    const label = costAmountText({ amountMicros: Math.round(maxMicros * portion) });
    return `<line class="cost-gridline" x1="${x0}" y1="${y.toFixed(1)}" x2="${x1}" y2="${y.toFixed(1)}"/><text class="cost-axis-label" x="0" y="${(y + 4).toFixed(1)}">${esc(label)}</text>`;
  }).join('');
  const lines = specs.map(([key, , cls]) => {
    const firstMetric = cumulative.find((row) => Number.isSafeInteger(row?.[key]?.amountMicros))?.[key];
    const points = [{ time: startMs, value: 0, status: costStatus(firstMetric) }]
      .concat(cumulative.map((row) => ({
        time: Date.parse(row.at), value: row?.[key]?.amountMicros,
        status: costStatus(row?.[key]),
      })));
    let segments = '';
    for (let index = 1; index < points.length; index++) {
      const previous = points[index - 1], current = points[index];
      if (!Number.isFinite(previous.time) || !Number.isFinite(current.time)
        || !Number.isSafeInteger(previous.value) || !Number.isSafeInteger(current.value)) continue;
      const partial = previous.status !== 'complete' || current.status !== 'complete';
      segments += `<path class="cost-series series-${cls}${partial ? ' is-partial' : ''}" d="M${sx(previous.time).toFixed(1)} ${sy(previous.value).toFixed(1)} L${sx(current.time).toFixed(1)} ${sy(current.value).toFixed(1)}"/>`;
    }
    return segments;
  }).join('');
  const id = `cost-chart-${scopeName}`;
  const desc = `${names[scopeName]} cumulative cost comparison for ${data.range}. ${finalText}.`;
  const finals = specs.map(([key, label, cls]) => `<div><i class="cost-final-swatch series-${cls}"></i><span>${esc(label)}</span><strong>${esc(costAmountText(scope?.summary?.[key]))}</strong></div>`).join('');
  return `<section class="cost-chart cost-chart-${scopeName}"><div class="cost-chart-head"><h4>${names[scopeName]}</h4>${costBadge(scope?.summary?.observedCache)}</div>`
    + `<svg viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="${id}-title ${id}-desc"><title id="${id}-title">${names[scopeName]} cumulative comparison</title>`
    + `<desc id="${id}-desc">${esc(desc)}</desc>${grid}${lines}`
    + `<text class="cost-axis-label" x="${x0}" y="218">${esc(costDateLabel(data.interval.start, data.interval.timeZone))}</text>`
    + `<text class="cost-axis-label" x="${x1}" y="218" text-anchor="end">${esc(costDateLabel(data.interval.end, data.interval.timeZone))}</text></svg>`
    + `<div class="cost-chart-finals">${finals}</div><span class="sr-only">${esc(desc)}</span></section>`;
}

function costChartsHtml(data) {
  const legend = `<div class="cost-legend"><span><i class="legend-line series-subscription"></i>Configured subscription spend</span>`
    + `<span><i class="legend-line series-observed"></i>API-equivalent · observed cache</span>`
    + `<span><i class="legend-line series-no-cache"></i>API-equivalent · no cache</span></div>`;
  return `<section class="cost-block cost-charts" aria-labelledby="cost-charts-title"><div class="cost-block-head"><h3 id="cost-charts-title">Cumulative comparison</h3>`
    + `<span>starts at $0 · today is partial through generation time</span></div>${legend}`
    + costChartHtml('combined', data.scopes.combined, data)
    + `<div class="cost-tool-charts">${costChartHtml('claude', data.scopes.claude, data)}${costChartHtml('codex', data.scopes.codex, data)}</div></section>`;
}

function coverageCopy(scope, toolLabel) {
  const coverage = scope && scope.usageCoverage;
  if (!coverage) return 'Usage coverage unavailable.';
  const included = `${Number(coverage.comparableRecords || 0).toLocaleString()} of ${Number(coverage.recognizedRecords || 0).toLocaleString()} recognized records were comparable`;
  return coverage.denominatorKnown ? `${included}.` : `${Number(coverage.comparableRecords || 0).toLocaleString()} ${toolLabel} records were comparable; additional usage may be omitted.`;
}

function costDiagnosticsHtml(data) {
  const reasons = sortedClientReasons(
    data.scopes?.combined?.summary?.subscription?.reasons,
    data.scopes?.combined?.summary?.observedCache?.reasons,
    data.refresh?.reasons,
  );
  if (!reasons.length) return '';
  return `<div class="cost-diagnostics" role="note"><strong>Evidence notes</strong><ul>`
    + reasons.slice(0, 6).map((reason) => `<li>${esc(Object.hasOwn(COST_REASON_COPY, reason)
      ? COST_REASON_COPY[reason] : 'Some evidence could not be included.')}</li>`).join('') + `</ul></div>`;
}

function sortedClientReasons(...groups) {
  return [...new Set(groups.flat().filter((reason) => typeof reason === 'string'))].sort();
}

function costProvenanceHtml(data) {
  const combined = data.scopes.combined;
  const sub = combined.subscriptionCoverage || {};
  const pricing = data.provenance && data.provenance.pricing;
  const sources = Array.isArray(pricing && pricing.sources) ? pricing.sources.slice(0, 16) : [];
  const effectiveRates = Array.isArray(pricing && pricing.effectiveRates) ? pricing.effectiveRates.slice(0, 64) : [];
  const sourceCopy = sources.length ? sources.map((source) => esc(source.label)).join(' · ') : 'No reviewed rate applied to comparable records';
  const effectiveCopy = effectiveRates.length ? effectiveRates.map((rate) => {
    const from = costDateLabel(rate.effectiveFrom, data.interval.timeZone);
    const to = rate.effectiveTo ? costDateLabel(rate.effectiveTo, data.interval.timeZone) : 'current';
    return `${rate.tool === 'claude' ? 'Claude' : 'Codex'} ${rate.model} · ${from}–${to}`;
  }).join(' · ') : 'No effective rate interval applied';
  const coveredPct = Number.isFinite(sub.ratio) ? `${Math.round(sub.ratio * 100)}% of tool-time covered` : 'coverage unavailable';
  return `<section class="cost-block cost-provenance" aria-labelledby="cost-provenance-title"><div class="cost-block-head"><h3 id="cost-provenance-title">Evidence and provenance</h3><span>bounded local analysis</span></div>`
    + `<div class="cost-proof-grid"><div><span>Subscription coverage</span><strong>${esc(coveredPct)}</strong><p>${Number(sub.gapCount || 0)} bounded gap${Number(sub.gapCount || 0) === 1 ? '' : 's'} · owner-confirmed periods only</p></div>`
    + `<div><span>Usage and pricing coverage</span><strong>${esc(coverageCopy(data.scopes.claude, 'Claude'))}</strong><p>${esc(coverageCopy(data.scopes.codex, 'Codex'))}</p></div>`
    + `<div><span>Effective pricing</span><strong>${sourceCopy}</strong><p>${esc(effectiveCopy)}</p><p>Rate card reviewed ${esc(costDateLabel(pricing && pricing.cardAsOf, data.interval.timeZone))}</p></div></div>`
    + costDiagnosticsHtml(data)
    + `<div class="cost-setup"><strong>Subscription values are never inferred.</strong> Add explicit confirmed Claude and Codex periods to <code>\${LLMDASH_DATA_DIR}/subscriptions.json</code>. No billing portal or API key is read.</div></section>`;
}

function renderCostAnalysis(data, announce = true) {
  const surface = document.getElementById('cost-surface');
  if (!surface) return;
  const generated = fmtAge(data.generatedAt) || 'generation time unavailable';
  const intervalCopy = `${costDateLabel(data.interval.start, data.interval.timeZone)}–${costDateLabel(data.interval.end, data.interval.timeZone)} · through ${costDateLabel(data.interval.end, data.interval.timeZone, true)}`;
  const stale = data.refresh && data.refresh.status === 'stale'
    ? `<div class="cost-stale">Last refresh failed · showing the snapshot generated ${esc(costDateLabel(data.generatedAt, data.interval.timeZone, true))}</div>` : '';
  surface.innerHTML = stale
    + `<div class="cost-meta"><strong>This machine · Claude + Codex</strong><span>${esc(intervalCopy)}</span><span>${esc(data.interval.timeZone)}</span><span>${esc(generated)}</span></div>`
    + costSummaryHtml(data.scopes.combined.summary)
    + `<div class="cost-honesty"><strong>What these mean</strong><span>Subscription spend is configured access cost. API-equivalent values reprice recorded local work; they are estimates, not charges or invoices.</span></div>`
    + costBreakdownHtml(data.scopes)
    + costChartsHtml(data)
    + costProvenanceHtml(data);
  surface.setAttribute('aria-busy', 'false');
  const status = document.getElementById('cost-status');
  if (status) {
    status.textContent = announce ? `Updated · ${data.range}` : '';
    if (announce) {
      const request = costRequestSequence;
      setTimeout(() => {
        if (request === costRequestSequence && status.textContent.startsWith('Updated ·')) status.textContent = '';
      }, 2000);
    }
  }
}

function renderCostError() {
  const surface = document.getElementById('cost-surface');
  if (!surface || costHasRendered) return;
  surface.innerHTML = `<div class="cost-loading cost-error">Cost analysis is unavailable right now. Account limits, activity, and trends above are unaffected.</div>`;
  surface.setAttribute('aria-busy', 'false');
  const status = document.getElementById('cost-status');
  if (status) status.textContent = 'Cost analysis unavailable';
}

async function fetchCostAnalysis({ announce = true } = {}) {
  const surface = document.getElementById('cost-surface');
  if (!surface) return;
  const requestedRange = COST_RANGE;
  const request = ++costRequestSequence;
  surface.setAttribute('aria-busy', 'true');
  const status = document.getElementById('cost-status');
  if (status) status.textContent = costHasRendered ? 'Updating…' : 'Loading cost analysis…';
  try {
    const response = await fetch('/api/cost-analysis?range=' + encodeURIComponent(requestedRange), { cache: 'no-store' });
    if (!response.ok) throw new Error('bad status');
    const data = await response.json();
    if (request !== costRequestSequence) return;
    if (!data || data.schemaVersion !== 1 || data.source !== 'local-logs-and-owner-config'
      || data.scope !== 'local-machine' || data.range !== requestedRange || !data.interval
      || !data.scopes || !data.scopes.combined || !data.scopes.claude || !data.scopes.codex) throw new Error('bad payload');
    costHasRendered = true;
    renderCostAnalysis(data, announce);
  } catch {
    if (request !== costRequestSequence) return;
    if (surface) surface.setAttribute('aria-busy', 'false');
    if (status && costHasRendered) status.textContent = 'Refresh failed · showing prior snapshot';
    renderCostError();
  }
}

function setupCostRange() {
  const range = document.getElementById('cost-range');
  if (!range) return;
  range.addEventListener('click', (event) => {
    const button = event.target.closest('.pill');
    const selected = button && button.dataset.range;
    if (!button || !COST_RANGES.has(selected) || selected === COST_RANGE) return;
    COST_RANGE = selected;
    [...range.querySelectorAll('.pill')].forEach((pill) => {
      const active = pill === button;
      pill.classList.toggle('active', active);
      pill.setAttribute('aria-pressed', String(active));
    });
    fetchCostAnalysis();
  });
}

setupCostRange();
fetchCostAnalysis();
setInterval(() => fetchCostAnalysis({ announce: false }), COST_REFRESH_MS);
