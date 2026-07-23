import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

// Verify the multi-host client actually RENDERS (not just that the page loads) —
// the project's "renders, not just loads" convention. public/app.js is a browser
// script with no exports, so we run it in a vm with a minimal DOM stub and a
// stubbed fetch that returns a crafted /api/hosts payload, then assert the HTML
// it produced into #hosts (banner + host cards + offline callout) — real
// innerHTML, not a regex over the source.
const here = path.dirname(fileURLToPath(import.meta.url));
const appJs = fs.readFileSync(path.join(here, '..', 'public', 'app.js'), 'utf8');

// A tiny element stub: records innerHTML/textContent, supports the few DOM ops
// app.js uses (getElementById, querySelector, classList.toggle, addEventListener).
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', hidden: false,
    _class: new Set(),
    classList: { toggle(c, on) { on ? this._set.add(c) : this._set.delete(c); }, _set: new Set() },
    addEventListener() {}, querySelectorAll() { return []; }, closest() { return null; },
    dataset: {},
  };
}

// footer needs querySelectorAll('span') → two spans with textContent.
function makeFooter() {
  const spans = [{ textContent: '' }, { textContent: '' }];
  return { querySelectorAll: (sel) => (sel === 'span' ? spans : []), _spans: spans };
}

async function renderWith(combined, resetBillingView = null, {
  DateImpl = Date,
  resetBillingFetch = null,
} = {}) {
  const els = {
    headroom: makeEl('headroom'), tools: makeEl('tools'), hosts: makeEl('hosts'),
    age: makeEl('age'), freshness: makeEl('freshness'), trends: makeEl('trends'),
    'single-limits': makeEl('single-limits'), 'details-heading': makeEl('details-heading'),
    'limit-notes': makeEl('limit-notes'),
    'tool-groups': makeEl('tool-groups'),
    'claude-tool-group': makeEl('claude-tool-group'), 'codex-tool-group': makeEl('codex-tool-group'),
    'claude-details': makeEl('claude-details'), 'codex-details': makeEl('codex-details'),
    'trends-claude': makeEl('trends-claude'), 'trends-codex': makeEl('trends-codex'),
    'claude-trends-range': makeEl('claude-trends-range'), 'codex-trends-range': makeEl('codex-trends-range'),
    range: null,
  };
  const footer = makeFooter();
  const doc = {
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => (sel === 'footer' ? footer : null),
  };
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const fetchUrls = [];
  let resetBillingCall = 0;
  const fetchStub = async (url) => {
    const value = String(url);
    fetchUrls.push(value);
    if (value === '/api/config/reset-billing') {
      resetBillingCall += 1;
      if (resetBillingFetch) return resetBillingFetch(resetBillingCall);
      return { ok: true, json: async () => resetBillingView || {
        resetSchedule: null,
        resetSelection: { source: 'unavailable', nextResetAt: null },
      } };
    }
    if (value.startsWith('/api/hosts')) {
      // Let render() run, then signal completion on the next microtask tick.
      queueMicrotask(() => setTimeout(resolveDone, 0));
      return { ok: true, json: async () => combined };
    }
    // /api/trends — return an empty shell so fetchTrends doesn't throw.
    return { ok: true, json: async () => ({ tools: [], range: '7d' }) };
  };
  const intervals = [];
  const sandbox = {
    document: doc, fetch: fetchStub,
    setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
    setTimeout: (fn, ms) => { if (ms === 0) queueMicrotask(fn); return 0; },
    queueMicrotask, console, Date: DateImpl, Math, JSON, encodeURIComponent, Number, String, Array, Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(appJs, sandbox);
  await done;
  return { els, footer, intervals, fetchUrls, sandbox };
}

function controlledClock(initialNowMs) {
  let nowMs = initialNowMs;
  class ControlledDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  return {
    DateImpl: ControlledDate,
    set(value) { nowMs = value; },
  };
}

const jsonResponse = (value) => ({ ok: true, json: async () => value });
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

const iso = (ms) => new Date(Date.now() + ms).toISOString();
const claudeTool = (fhReset, sdReset) => ({
  source: 'claude-code', label: 'Claude Code', plan: 'Max', haveLimits: true,
  limits: {
    five_hour: { usedPct: 62, remainingPct: 38, resetsAt: iso(fhReset), capturedAt: iso(-30_000) },
    seven_day: { usedPct: 36, remainingPct: 64, resetsAt: iso(sdReset), capturedAt: iso(-30_000) },
  },
  modelLimits: [],
  projection: { five_hour: null, seven_day: null },
  activity: { hasData: true, tokens: { last5h: 18.4e6, week: 72e6, today: 44.1e6 }, sessionsToday: 9, cacheHitRate: 0.88, estValueWeek: 214.6, estValueToday: 52.3, cacheSavingsWeek: 61.2, tokenMix: { input: 10.1e6, output: 8.6e6, cacheRead: 45.4e6, cacheWrite: 7.9e6 } },
  freshness: { capturedAt: iso(-30_000), freshForMs: 300_000, staleAfterMs: 600_000 },
  limitsDiagnostic: null, dataAt: iso(-30_000),
});
const codexTool = (sdReset) => ({
  source: 'codex', label: 'Codex', plan: 'ChatGPT Pro', haveLimits: true,
  limits: {
    five_hour: null,
    seven_day: { usedPct: 41, remainingPct: 59, resetsAt: iso(sdReset), capturedAt: iso(-20_000) },
  },
  modelLimits: [], projection: { five_hour: null, seven_day: null },
  activity: { hasData: false }, freshness: null, limitsDiagnostic: null, dataAt: iso(-20_000),
});
const stateOf = (tools) => ({ tools, headroom: null, generatedAt: iso(0) });

function configuredResetView(nextResetAt) {
  return {
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    resetSelection: {
      source: 'configured', label: 'Configured', nextResetAt,
      liveStatus: 'missing', configuredStatus: 'usable', corroboratedByModelCap: false,
    },
  };
}

async function renderConfiguredResetBoundary() {
  const startMs = Date.now();
  const boundaryMs = startMs + 60_000;
  const recoveryMs = startMs + 7 * 86400_000;
  const clock = controlledClock(startMs);
  const tool = claudeTool(3 * 3600_000, 2 * 86400_000);
  tool.limits.seven_day.resetsAt = null;
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]),
  }], generatedAt: iso(0) };
  let resolveBoundaryFetch;
  const boundaryFetch = new Promise((resolve) => { resolveBoundaryFetch = resolve; });
  const rendered = await renderWith(combined, null, {
    DateImpl: clock.DateImpl,
    resetBillingFetch: (call) => {
      if (call === 1) return jsonResponse(configuredResetView(new Date(boundaryMs).toISOString()));
      if (call === 2) return boundaryFetch;
      return jsonResponse({ resetSchedule: null, resetSelection: {
        source: 'unavailable', nextResetAt: null,
      } });
    },
  });
  await flushAsync(); // let the initial reset selection clear its in-flight guard
  const tick = rendered.intervals.find(({ fn, ms }) => ms === 1000 && String(fn).includes('render()'));
  const periodic = rendered.intervals.find(({ fn, ms }) => ms === 60_000 && fn.name === 'refresh');
  assert.ok(tick, 'the countdown render tick is registered');
  assert.ok(periodic, 'the normal 60-second refresh is registered');
  return {
    ...rendered, clock, tick, periodic, boundaryMs, recoveryMs,
    resetFetchCount: () => rendered.fetchUrls
      .filter((url) => url === '/api/config/reset-billing').length,
    resolveBoundary(view = configuredResetView(new Date(recoveryMs).toISOString())) {
      resolveBoundaryFetch(jsonResponse(view));
    },
  };
}

test('configured reset refetches immediately at the exact reset boundary', async () => {
  const h = await renderConfiguredResetBoundary();
  assert.equal(h.resetFetchCount(), 1);
  assert.match(h.els.tools.innerHTML, /Weekly[\s\S]*Configured/);

  h.clock.set(h.boundaryMs - 1);
  h.tick.fn();
  assert.equal(h.resetFetchCount(), 1, 'the still-future occurrence does not refetch early');

  h.clock.set(h.boundaryMs);
  h.tick.fn();

  assert.equal(h.resetFetchCount(), 2,
    'nextResetAt === Date.now() starts the reset read without waiting for the 60-second poll');
  h.resolveBoundary();
  await flushAsync();
});

test('configured reset boundary keeps at most one reset request in flight', async () => {
  const h = await renderConfiguredResetBoundary();
  h.clock.set(h.boundaryMs);
  h.tick.fn();
  h.tick.fn();
  h.tick.fn();
  const periodicRefresh = h.periodic.fn();
  await flushAsync();

  assert.equal(h.resetFetchCount(), 2,
    'repeated render ticks and the periodic refresh share the boundary request');
  h.resolveBoundary();
  await periodicRefresh;
  await flushAsync();
  assert.equal(h.resetFetchCount(), 2);
});

test('configured reset boundary recovers as soon as the guarded refetch resolves', async () => {
  const h = await renderConfiguredResetBoundary();
  h.clock.set(h.boundaryMs);
  h.tick.fn();
  assert.match(h.els.tools.innerHTML,
    /Weekly<\/span><span class="win-reset reset">resets in —<\/span>/,
  'the expired reset is not presented as current while recovery is pending');

  h.resolveBoundary();
  await flushAsync();
  await flushAsync();

  assert.equal(h.resetFetchCount(), 2, 'recovery did not wait for or invoke the 60-second poll');
  assert.match(h.els.tools.innerHTML,
    /Weekly<\/span><span class="win-reset reset">Configured · [\s\S]* · resets in (?!—)/,
  'the newly resolved configured occurrence is rendered immediately');
});

test('configured local Claude weekly reset fills only the display/pacing gap and preserves stale honesty', async () => {
  const tool = claudeTool(3 * 3600_000, 2 * 86400_000);
  tool.limits.seven_day.resetsAt = null;
  tool.limits.seven_day.usedPct = 95;
  tool.limits.seven_day.remainingPct = 5;
  tool.projection.seven_day = null;
  tool.freshness.capturedAt = iso(-15 * 60_000);
  tool.limitsDiagnostic = { reason: 'stale-reading', capturedAt: tool.freshness.capturedAt };
  const before = JSON.stringify(tool.limits);
  const configuredAt = iso(2 * 86400_000);
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]),
  }], generatedAt: iso(0) };

  const { els, fetchUrls, sandbox } = await renderWith(combined, configuredResetView(configuredAt));
  assert.ok(fetchUrls.includes('/api/hosts'));
  assert.ok(fetchUrls.includes('/api/config/reset-billing'), 'configuration is fetched independently');
  assert.match(els.tools.innerHTML,
    /Weekly[\s\S]*Configured · [A-Z][a-z]{2}, [A-Z][a-z]{2} \d{1,2} at \d{1,2}:\d{2} (?:AM|PM) P[DS]T \/ America\/Los_Angeles · resets in/);
  assert.match(els['claude-details'].innerHTML,
    /On pace to hit the Weekly limit[\s\S]*Configured · [\s\S]*America\/Los_Angeles · before it resets in[\s\S]*at risk/);
  assert.match(els['limit-notes'].innerHTML, /Stale reading/, 'configured timing does not make usage fresh');
  assert.equal(JSON.stringify(tool.limits), before, 'provider window bytes stay untouched');
  sandbox.probeTool = tool;
  const key = vm.runInContext('accountKey(probeTool)', sandbox);
  assert.equal(key, `${Math.round(Date.parse(tool.limits.five_hour.resetsAt) / 60_000)}|null`,
    'configured timing never enters account identity');
});

test('a stale future Claude timestamp stays raw for account identity while configured timing drives display', async () => {
  const staleProviderAt = iso(30 * 60_000);
  const configuredAt = iso(2 * 86400_000);
  const tool = claudeTool(3 * 3600_000, 30 * 60_000);
  tool.limits.seven_day.resetsAt = staleProviderAt;
  tool.freshness.capturedAt = iso(-15 * 60_000);
  tool.limitsDiagnostic = { reason: 'stale-reading', capturedAt: tool.freshness.capturedAt };
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]),
  }], generatedAt: iso(0) };

  const { els, sandbox } = await renderWith(combined, configuredResetView(configuredAt));
  assert.match(els.tools.innerHTML, /Weekly[\s\S]*Configured[\s\S]*America\/Los_Angeles/);
  assert.doesNotMatch(els.tools.innerHTML, /Weekly[\s\S]*Provider reading/,
    'stale provider evidence must not outrank the resolved configured selection');
  assert.doesNotMatch(els.tools.innerHTML, /resets in (?:2[0-9]|30)m/,
    'the stale near-term provider countdown is not presented as the selected reset');
  assert.match(els['limit-notes'].innerHTML, /Stale reading/);
  assert.equal(tool.limits.seven_day.resetsAt, staleProviderAt, 'raw provider state remains unchanged');
  sandbox.probeTool = tool;
  assert.equal(vm.runInContext('accountKey(probeTool)', sandbox),
    `${Math.round(Date.parse(tool.limits.five_hour.resetsAt) / 60_000)}|${Math.round(Date.parse(staleProviderAt) / 60_000)}`,
    'account identity still uses the raw stale reset epoch');
});

test('a provider weekly reset wins a conflicting configured fallback and is labeled Live', async () => {
  const providerAt = iso(36 * 3600_000);
  const configuredAt = iso(4 * 86400_000);
  const tool = claudeTool(3 * 3600_000, 36 * 3600_000);
  tool.limits.seven_day.resetsAt = providerAt;
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]),
  }], generatedAt: iso(0) };
  const { els } = await renderWith(combined, configuredResetView(configuredAt));
  assert.match(els.tools.innerHTML, /Weekly[\s\S]*Live · resets in/);
  assert.doesNotMatch(els.tools.innerHTML, /Configured|America\/Los_Angeles/);
  assert.equal(tool.limits.seven_day.resetsAt, providerAt);
});

test('local fallback stays off unrelated peer lanes but follows a collapsed lane containing self', async () => {
  const local = claudeTool(3 * 3600_000, 2 * 86400_000);
  const peer = claudeTool(5 * 3600_000, 2 * 86400_000);
  local.limits.seven_day.resetsAt = null;
  peer.limits.seven_day.resetsAt = null;
  const separate = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([local]) },
    { host: 'peer', label: 'Remote', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-1_000), state: stateOf([peer]) },
  ], generatedAt: iso(0) };
  const configured = configuredResetView(iso(2 * 86400_000));
  const first = await renderWith(separate, configured);
  const remoteCard = first.els.hosts.innerHTML.slice(first.els.hosts.innerHTML.indexOf('<span class="host-name">Remote</span>'));
  assert.doesNotMatch(remoteCard, /Configured|America\/Los_Angeles/,
    'a local fallback never enters a different remote account lane or pacing story');

  peer.limits.five_hour.resetsAt = local.limits.five_hour.resetsAt;
  peer.dataAt = iso(1_000); // make the peer the representative of the collapsed lane
  const collapsed = await renderWith(separate, configured);
  const overview = collapsed.els.hosts.innerHTML.slice(0, collapsed.els.hosts.innerHTML.indexOf('class="host '));
  assert.equal((overview.match(/class="limit-tool tool/g) || []).length, 1);
  assert.match(overview, /identical on This machine &amp; Remote/);
  assert.match(overview, /Configured[\s\S]*America\/Los_Angeles/,
    'membership in the self account authorizes the display-only fallback on its collapsed lane');
});

test('single-host mode renders both tools limits-first with NO host chrome (QA-18)', async () => {
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claudeTool(3 * 3600_000, 3 * 86400_000), codexTool(5 * 86400_000)]) }], generatedAt: iso(0) };
  const { els, footer } = await renderWith(combined);
  assert.equal((els.tools.innerHTML.match(/class="limit-tool tool/g) || []).length, 2, 'two tool lanes render together');
  assert.equal((els.tools.innerHTML.match(/class="panel limit-card/g) || []).length, 4, 'four fixed account-window slots render first');
  assert.match(els.tools.innerHTML, /class="gauges window-grid"/, 'each lane keeps its two-window grid');
  assert.match(els.tools.innerHTML, /class="tool-mark" aria-hidden="true">◆</, 'Claude keeps the shared tool identity mark');
  assert.ok(els.tools.innerHTML.indexOf('Claude Code') < els.tools.innerHTML.indexOf('Codex'), 'tool order is stable');
  assert.match(els.tools.innerHTML, /Codex[\s\S]*5-hour[\s\S]*Unavailable/);
  assert.match(els.tools.innerHTML, /Unavailable[\s\S]*No short-window reading/);
  assert.doesNotMatch(els.tools.innerHTML, /class="stat-grid"/, 'supporting statistics do not interleave with the four slots');
  assert.match(els['claude-details'].innerHTML, /Pacing[\s\S]*Activity/);
  assert.match(els['codex-details'].innerHTML, /Pacing[\s\S]*Activity/);
  assert.equal(els.hosts.innerHTML, '', 'no host chrome in single-host mode');
  assert.doesNotMatch(els.hosts.innerHTML, /acct|host-head/, 'no banner, no host header');
  assert.match(footer._spans[0].textContent, /Activity: local session logs/, 'single-host footer');
});

test('single-host diagnostics follow all four account slots instead of splitting the tool lanes', async () => {
  const claude = claudeTool(3 * 3600_000, 3 * 86400_000);
  claude.limitsDiagnostic = { reason: 'stale-reading', capturedAt: iso(-900_000) };
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claude, codexTool(5 * 86400_000)]) }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  assert.equal((els.tools.innerHTML.match(/class="panel limit-card/g) || []).length, 4);
  assert.doesNotMatch(els.tools.innerHTML, /stale-note/, 'no diagnostic interrupts the comparison grid');
  assert.match(els['limit-notes'].innerHTML, /Claude Code[\s\S]*Stale reading/);
});

test('single-host mode renders model-specific caps and escapes model labels', async () => {
  const tool = claudeTool(3 * 3600_000, 3 * 86400_000);
  tool.modelLimits = [{
    source: 'claude-model:fable',
    provider: 'claude-code',
    model: 'fable',
    label: '<img src=x onerror=alert(1)>',
    window: 'seven_day',
    usedPct: 49,
    remainingPct: 51,
    resetsAt: iso(2 * 86400_000),
    capturedAt: iso(-30_000),
  }];
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]) }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els['claude-details'].innerHTML;
  assert.match(h, /Model-specific caps/);
  assert.match(h, /51<span class="unit">%</);
  assert.doesNotMatch(h, /<img src=x onerror/, 'raw model label must not reach innerHTML');
  assert.match(h, /&lt;img src=x onerror/, 'model label is escaped');
});

test('multi-host same-account: ONE limits overview, activity per host, no duplicated meter (QA-15/QA-17)', async () => {
  const shared = () => claudeTool(3 * 3600_000, 3 * 86400_000);
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([shared()]) },
    { host: '100.64.0.7', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-34_000), state: stateOf([shared()]) },
  ], generatedAt: iso(0) };
  const { els, footer } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  // The limits-first overview appears exactly once.
  assert.equal((h.match(/class="limits-overview multi-limits"/g) || []).length, 1, 'exactly one account overview');
  assert.match(h, /Account limits/);
  assert.match(h, /identical on This machine &amp; Desktop/, 'scope names both same-account hosts, escaped');
  // The shared meter appears once — before the first host.
  const bannerHtml = h.slice(h.indexOf('class="limits-overview'), h.indexOf('class="host '));
  assert.match(bannerHtml, /class="gauges window-grid"/, 'the shared gauge lives in the overview');
  assert.doesNotMatch(h.slice(h.indexOf('class="host ')), /class="gauges window-grid"/, 'host details never duplicate account gauges');
  // Each host card shows the same-account annotation instead of a duplicate meter.
  assert.equal((h.match(/class="same-acct"/g) || []).length, 2, 'both host cards annotate "shown above"');
  // Both hosts still render their per-machine ACTIVITY (tiles).
  assert.ok((h.match(/class="stat-grid"/g) || []).length >= 2, 'per-host activity renders');
  // The local host is first and marked "you".
  assert.match(h, /host-self/);
  assert.match(h, /class="host-you">you/);
  assert.match(footer._spans[0].textContent, /Activity: per machine/, 'multi-host footer');
  assert.match(footer._spans[1].textContent, /2 hosts over Tailscale/);
});

test('a different-account host keeps its own labeled lane in the overview (reads distinct, QA-15)', async () => {
  const shared = () => claudeTool(3 * 3600_000, 3 * 86400_000);
  const different = claudeTool(1 * 3600_000, 6 * 86400_000);
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([shared()]) },
    { host: 'a', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-34_000), state: stateOf([shared()]) },
    { host: 'b', label: 'Work laptop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-12_000), state: stateOf([different]) },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  const overview = h.slice(0, h.indexOf('class="host '));
  assert.equal((overview.match(/class="limit-tool tool/g) || []).length, 2, 'shared and distinct accounts each get one lane');
  assert.match(overview, /from Work laptop/, 'the distinct account names its host before activity');
  const workHost = h.slice(h.lastIndexOf('class="host"'));
  assert.doesNotMatch(workHost, /class="gauges window-grid"/, 'the host story does not repeat its meter');
  assert.match(workHost, /Account limits above/);
});

test('an offline host shows the NAMED callout, never a gauge/zero (QA-09/QA-11)', async () => {
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]) },
    { host: '100.64.0.9', label: 'Work laptop', port: 8787, self: false, reachable: false, hostDiagnostic: { reason: 'peer-unreachable', cause: 'timeout', detail: 'no response within 3000ms' }, fetchedAt: iso(-4 * 60_000), state: null },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  assert.match(h, /host-offline-note/, 'the offline callout renders');
  assert.match(h, /Work laptop is unreachable/);
  assert.match(h, /peer-unreachable/);
  assert.match(h, /100\.64\.0\.9:8787/, 'names the host:port to check');
  // The offline card must not paint a gauge or a fabricated number for that host.
  const offIdx = h.indexOf('host-offline');
  const offCard = h.slice(offIdx, h.indexOf('legend-strip'));
  assert.doesNotMatch(offCard, /class="gauges"/, 'no gauge for an offline host');
  assert.doesNotMatch(offCard, /class="stat-grid"/, 'no fabricated activity for an offline host');
});

test('a peer-supplied label with HTML is ESCAPED, never injected raw (NFR-03/NFR-04)', async () => {
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]) },
    { host: 'x', label: '<img src=x onerror=alert(1)>', port: 8787, self: false, reachable: false, hostDiagnostic: { reason: 'peer-error', cause: 'bad-json', detail: '<script>evil()</script>' }, fetchedAt: iso(-60_000), state: null },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  assert.doesNotMatch(h, /<img src=x onerror/, 'the raw label tag must never reach innerHTML');
  assert.doesNotMatch(h, /<script>evil/, 'the raw detail must never reach innerHTML');
  assert.match(h, /&lt;img src=x onerror/, 'the label is escaped');
  assert.match(h, /&lt;script&gt;evil/, 'the detail is escaped');
});

// ── Static lockstep + no-injection guards (the app-copy discipline) ──────────

test('app.js account-grouping stays in lockstep with src/host-view.js (verbatim key logic)', () => {
  const view = fs.readFileSync(path.join(here, '..', 'src', 'host-view.js'), 'utf8');
  // Both derive the identity key the same way: bucket reset epochs by ACCT_TOL.
  for (const src of [appJs, view]) {
    assert.match(src, /Math\.round\(ms \/ ACCT_TOL_MS\)/, 'both bucket epochs identically');
    assert.match(src, /60_000/, 'both use the 60s tolerance');
    assert.match(src, /fh == null && sd == null/, 'both treat no-reading as ungroupable');
  }
});

test('no peer-supplied field is interpolated into a style or raw HTML (NFR-04)', () => {
  // Every host label / diagnostic detail reaches innerHTML only via esc(); style
  // widths stay coerced numbers. Assert the render helpers esc() their inputs
  // and that a peer field never lands in a style="..." interpolation.
  assert.match(appJs, /esc\(host\.label\)/);
  assert.match(appJs, /esc\(String\(host\.port\)\)/);
  assert.match(appJs, /esc\(d\.detail\)/); // diagnostic detail escaped
  assert.match(appJs, /esc\(m\.label \|\| m\.model \|\| 'Model'\)/); // model labels escaped
  // The account-cause map is an OWN-KEY (hasOwnProperty) lookup, never raw.
  assert.match(appJs, /Object\.prototype\.hasOwnProperty\.call\(PEER_CAUSE_FRAGMENTS/);
  // No style attribute interpolates a host/label/detail field.
  assert.doesNotMatch(appJs, /style="[^"]*\$\{[^}]*(host|label|detail)/i);
});

test('the multi-host footer/legend copy preserves account and machine scope', () => {
  assert.match(appJs, /Account limits/);
  assert.match(appJs, /matching accounts are shown once before every host/);
  assert.match(appJs, /Account limits above/);
  assert.match(appJs, /the shared meters are shown once, up top/);
  assert.match(appJs, /Limits: account-wide · Activity: per machine · Codex day buckets: UTC/);
  assert.match(appJs, /is unreachable/);
  assert.match(appJs, /returned an error/);
});

test('the reserved auto-refresh reason names are NOT reused for peer failures', () => {
  // The peer-failure branch must use peer-unreachable/peer-error only.
  assert.match(appJs, /peer-unreachable/);
  assert.match(appJs, /peer-error/);
  const bannerRegion = appJs.slice(appJs.indexOf('PEER_CAUSE_FRAGMENTS'), appJs.indexOf('function hostOfflineNoteHtml') + 400);
  assert.doesNotMatch(bannerRegion, /auto-refresh-failing|auto-refresh-disabled/);
});

test('Codex with no sessions on a host shows the honest not-available note (no zeros, QA-14)', async () => {
  const shared = () => claudeTool(3 * 3600_000, 3 * 86400_000);
  const codexNoData = { source: 'codex', label: 'Codex', plan: 'ChatGPT Plus', haveLimits: false, limits: { five_hour: null, seven_day: null }, projection: { five_hour: null, seven_day: null }, activity: { hasData: false }, freshness: null, limitsDiagnostic: { reason: 'no-reading' }, dataAt: null };
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([shared()]) },
    { host: 'a', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-34_000), state: stateOf([shared(), codexNoData]) },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  assert.match(h, /No Codex sessions have been recorded on this machine yet/, 'honest not-available, not fabricated zeros');
});

test('the one-second limits tick preserves stable Codex insights and per-tool trend containers', async () => {
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claudeTool(3 * 3600_000, 3 * 86400_000), codexTool(5 * 86400_000)]) }], generatedAt: iso(0) };
  const { els, intervals } = await renderWith(combined);
  els['insights-surface'] = makeEl('insights-surface');
  els['insights-surface'].innerHTML = '<div>stable insight payload</div>';
  els['trends-claude'].innerHTML = '<div>stable Claude trend</div>';
  els['trends-codex'].innerHTML = '<div>stable Codex trend</div>';
  const tick = intervals.find(({ fn, ms }) => ms === 1000 && String(fn).includes('render()'));
  assert.ok(tick, 'the countdown render tick is registered');
  tick.fn();
  assert.equal(els['insights-surface'].innerHTML, '<div>stable insight payload</div>');
  assert.equal(els['trends-claude'].innerHTML, '<div>stable Claude trend</div>');
  assert.equal(els['trends-codex'].innerHTML, '<div>stable Codex trend</div>');
});
