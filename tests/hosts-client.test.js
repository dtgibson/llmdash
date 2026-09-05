import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { MAX_REMOTE_HOSTS, parseHosts } from '../src/hosts.js';

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
  includeAccountContainers = true,
} = {}) {
  const els = {
    headroom: makeEl('headroom'), tools: makeEl('tools'), hosts: makeEl('hosts'),
    age: makeEl('age'), freshness: makeEl('freshness'), trends: makeEl('trends'),
    'single-limits': makeEl('single-limits'), 'details-heading': makeEl('details-heading'),
    'device-health': makeEl('device-health'),
    'limit-notes': makeEl('limit-notes'),
    'tool-groups': makeEl('tool-groups'),
    'claude-tool-group': makeEl('claude-tool-group'), 'codex-tool-group': makeEl('codex-tool-group'),
    'claude-details': makeEl('claude-details'), 'codex-details': makeEl('codex-details'),
    'trends-claude': makeEl('trends-claude'), 'trends-codex': makeEl('trends-codex'),
    'claude-trends-range': makeEl('claude-trends-range'), 'codex-trends-range': makeEl('codex-trends-range'),
    range: null,
  };
  if (includeAccountContainers) {
    els['account-identity'] = makeEl('account-identity');
    els['supplementary-limits'] = makeEl('supplementary-limits');
  }
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
  accountLimits: { scope: 'account-wide', resetCredits: {
    available: false, status: 'unsupported', availableCount: null,
    expirations: [], missingExpirationCount: 0, capturedAt: null,
  } },
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
  modelLimits: [], accountLimits: { scope: 'account-wide', resetCredits: {
    available: false, status: 'unsupported', availableCount: null,
    expirations: [], missingExpirationCount: 0, capturedAt: null,
  } }, projection: { five_hour: null, seven_day: null },
  activity: { hasData: false }, freshness: null, limitsDiagnostic: null, dataAt: iso(-20_000),
});
const modelLimit = ({
  model, label, remainingPct, capturedAt = iso(-30_000), resetsAt = iso(2 * 86400_000),
}) => ({
  source: `claude-model:${model}`,
  provider: 'claude-code',
  model,
  label,
  window: 'seven_day',
  usedPct: 100 - remainingPct,
  remainingPct,
  resetsAt,
  capturedAt,
});
const resetSnapshot = ({
  availableCount,
  expirations = [],
  status = availableCount === 0 ? 'zero'
    : expirations.length < availableCount ? 'partial' : 'available',
  capturedAt = iso(-20_000),
  available = true,
}) => ({
  available,
  status,
  availableCount,
  expirations,
  missingExpirationCount: availableCount == null
    ? 0 : Math.max(0, availableCount - expirations.length),
  capturedAt,
});
const withResetCredits = (tool, snapshot) => {
  tool.accountLimits = { scope: 'account-wide', resetCredits: snapshot };
  return tool;
};
const stateOf = (tools) => ({ tools, headroom: null, generatedAt: iso(0) });
const healthState = (capturedAt = iso(-60_000)) => ({
  scope: 'device', pollIntervalMs: 60_000,
  cpu: { status: 'available', usedPct: 42, capturedAt, attemptedAt: capturedAt, updateStatus: 'ok', reason: null, intervalMs: 60_000 },
  ram: { status: 'unsupported', usedPct: null, capturedAt: null, attemptedAt: capturedAt, updateStatus: 'unsupported', reason: 'unsupported-platform' },
  disk: { status: 'available', availableBytes: 250 * (1024 ** 3), totalBytes: 1024 ** 4, availablePct: 24.4140625, target: 'data-volume', capturedAt, attemptedAt: capturedAt, updateStatus: 'ok', reason: null },
  history: [],
});

function configuredResetView(nextResetAt) {
  return {
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    resetSelection: {
      source: 'configured', label: 'Configured', nextResetAt,
      liveStatus: 'missing', configuredStatus: 'usable', corroboratedByModelCap: false,
    },
  };
}

function compactResetValues(html) {
  return [...html.matchAll(/<div class="limit-reset-compact"><span class="limit-reset-label">Reset ·<\/span><span class="limit-reset-value">([^<]+)<\/span><\/div>/g)]
    .map((match) => match[1]);
}

function assertBoundedCompactResets(html, expectedCount) {
  const values = compactResetValues(html);
  assert.equal(values.length, expectedCount, 'every quota card has one compact reset footer');
  for (const value of values) {
    assert.match(value, /^(?:—|now|\d+m|\d+h \d+m|\d+d \d+h)$/,
      `unexpected in-card reset grammar: ${value}`);
  }
  assert.doesNotMatch(html, /Configured|Live provider reading|Provider reading|America\//,
    'source, schedule, and timezone evidence stay out of quota cards');
  assert.doesNotMatch(html, /resets in/,
    'quota cards contain only the bounded duration, not pacing prose');
  return values;
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
  assertBoundedCompactResets(h.els.tools.innerHTML, 2);
  assert.match(h.els['device-health'].innerHTML, /Weekly[\s\S]*Configured[\s\S]*America\/Los_Angeles/,
    'full configured evidence is immediately available in pacing');

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
  assert.equal(compactResetValues(h.els.tools.innerHTML)[1], '—',
    'the expired reset is not presented as current while recovery is pending');
  assert.match(h.els['device-health'].innerHTML,
    /Weekly[\s\S]*Reset time not reported · pacing unavailable/);

  h.resolveBoundary();
  await flushAsync();
  await flushAsync();

  assert.equal(h.resetFetchCount(), 2, 'recovery did not wait for or invoke the 60-second poll');
  assert.notEqual(compactResetValues(h.els.tools.innerHTML)[1], '—',
    'the newly resolved occurrence restores the compact duration immediately');
  assert.match(h.els['device-health'].innerHTML,
    /Weekly[\s\S]*Configured · [\s\S]*America\/Los_Angeles[\s\S]*resets in/,
    'the newly resolved configured evidence is rendered immediately in pacing');
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
  const compact = assertBoundedCompactResets(els.tools.innerHTML, 2);
  assert.match(compact[1], /^\d+d \d+h$/);
  assert.match(els['device-health'].innerHTML,
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
  assertBoundedCompactResets(els.tools.innerHTML, 2);
  assert.match(els['device-health'].innerHTML, /Weekly[\s\S]*Configured[\s\S]*America\/Los_Angeles/);
  assert.doesNotMatch(els['device-health'].innerHTML, /Weekly[\s\S]*Provider reading/,
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
  assertBoundedCompactResets(els.tools.innerHTML, 2);
  assert.match(els['device-health'].innerHTML, /Weekly[\s\S]*Live provider reading · resets in/);
  assert.doesNotMatch(els['device-health'].innerHTML, /Configured|America\/Los_Angeles/);
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
  const overview = collapsed.els.hosts.innerHTML.slice(0, collapsed.els.hosts.innerHTML.indexOf('class="multi-operational"'));
  assert.equal((overview.match(/class="limit-tool tool/g) || []).length, 1);
  assert.match(overview, /identical on This machine &amp; Remote/);
  assertBoundedCompactResets(overview, 2);
  const localCapacityStart = collapsed.els.hosts.innerHTML.indexOf('Capacity now for This machine');
  const remoteCapacityStart = collapsed.els.hosts.innerHTML.indexOf('Capacity now for Remote');
  const localStory = collapsed.els.hosts.innerHTML.slice(localCapacityStart, remoteCapacityStart);
  const remoteStory = collapsed.els.hosts.innerHTML.slice(remoteCapacityStart,
    collapsed.els.hosts.innerHTML.indexOf('</section></section>', remoteCapacityStart) + 20);
  assert.match(localStory, /Configured[\s\S]*America\/Los_Angeles/,
    'membership in the self account keeps full fallback evidence in its pacing story');
  assert.doesNotMatch(remoteStory, /Configured|America\/Los_Angeles/,
    'local fallback evidence never enters the remote pacing story');
});

test('single-host mode renders both tools limits-first with NO host chrome (QA-18)', async () => {
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claudeTool(3 * 3600_000, 3 * 86400_000), codexTool(5 * 86400_000)]) }], generatedAt: iso(0) };
  const { els, footer } = await renderWith(combined);
  assert.equal((els.tools.innerHTML.match(/class="limit-tool tool/g) || []).length, 2, 'two tool lanes render together');
  assert.equal((els.tools.innerHTML.match(/class="panel limit-card/g) || []).length, 4, 'four fixed account-window slots render first');
  const compactResets = assertBoundedCompactResets(els.tools.innerHTML, 4);
  assert.equal(compactResets[2], '—', 'an unavailable current window never fabricates reset timing');
  assert.match(els.tools.innerHTML, /class="gauges window-grid"/, 'each lane keeps its two-window grid');
  assert.match(els.tools.innerHTML, /class="tool-mark" aria-hidden="true">◆</, 'Claude keeps the shared tool identity mark');
  assert.ok(els.tools.innerHTML.indexOf('Claude Code') < els.tools.innerHTML.indexOf('Codex'), 'tool order is stable');
  assert.match(els.tools.innerHTML, /Codex[\s\S]*5-hour[\s\S]*Unavailable/);
  assert.match(els.tools.innerHTML, /Unavailable[\s\S]*No short-window reading/);
  assert.doesNotMatch(els.tools.innerHTML, /class="stat-grid"/, 'supporting statistics do not interleave with the four slots');
  assert.doesNotMatch(els['claude-details'].innerHTML, /Pacing/);
  assert.doesNotMatch(els['codex-details'].innerHTML, /Pacing/);
  assert.match(els['device-health'].innerHTML, /Pacing[\s\S]*Device health/);
  assert.match(els['device-health'].innerHTML, /5-hour[\s\S]*Live provider reading · resets in/,
    'full live provenance stays in Claude pacing');
  assert.match(els['device-health'].innerHTML, /Weekly[\s\S]*Provider reading · resets in/,
    'full provider-reading provenance stays in Codex pacing');
  assert.equal(els.hosts.innerHTML, '', 'no host chrome in single-host mode');
  assert.doesNotMatch(els.hosts.innerHTML, /acct|host-head/, 'no banner, no host header');
  assert.match(els['device-health'].innerHTML, /Device health/);
  assert.match(footer._spans[0].textContent, /Activity: local session logs/, 'single-host footer');
});

test('single-host device health renders after limits with fixed metric order and visible states', async () => {
  const hostState = stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]);
  hostState.deviceHealth = healthState();
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: hostState,
  }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els['device-health'].innerHTML;
  assert.ok(h.indexOf('>CPU<') < h.indexOf('>RAM<') && h.indexOf('>RAM<') < h.indexOf('>Disk available<'));
  assert.match(h, /42<span class="health-unit">%/);
  assert.match(h, /250<span class="health-unit">GiB/);
  assert.match(h, /unsupported/i);
  assert.match(h, /minute-sampled snapshot/);
});

test('device-health freshness boundaries and failed last-good evidence remain visible', async () => {
  const now = Date.now();
  const clock = controlledClock(now);
  const hostState = stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]);
  hostState.deviceHealth = healthState(new Date(now - 2 * 60_000).toISOString());
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: hostState,
  }], generatedAt: iso(0) };
  const rendered = await renderWith(combined, null, { DateImpl: clock.DateImpl });
  assert.match(rendered.els['device-health'].innerHTML, />current</);
  clock.set(now + 1);
  rendered.intervals.find((entry) => entry.ms === 1_000).fn();
  assert.match(rendered.els['device-health'].innerHTML, />aging</);
  clock.set(now + 3 * 60_000 + 1);
  rendered.intervals.find((entry) => entry.ms === 1_000).fn();
  assert.match(rendered.els['device-health'].innerHTML, />stale</);
  hostState.deviceHealth.cpu.updateStatus = 'failed';
  hostState.deviceHealth.cpu.reason = 'counter-reset';
  rendered.intervals.find((entry) => entry.ms === 1_000).fn();
  assert.match(rendered.els['device-health'].innerHTML, /update failed · stale/);
  assert.match(rendered.els['device-health'].innerHTML, /Last update failed · value sampled/);
});

test('health history renders accessible segmented series and an exact bounded table', async () => {
  const hostState = stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]);
  hostState.deviceHealth = healthState();
  hostState.deviceHealth.history = [
    { capturedAt: iso(-180_000), cpuUsedPct: 20, ramUsedPct: 60, diskAvailablePct: 30 },
    { capturedAt: iso(-120_000), cpuUsedPct: null, ramUsedPct: 61, diskAvailablePct: 29 },
    { capturedAt: iso(0), cpuUsedPct: 40, ramUsedPct: null, diskAvailablePct: 28 },
  ];
  const combined = { hosts: [{
    host: 'local', label: '<Owner Mac>', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: hostState,
  }], generatedAt: iso(0) };
  const { els, sandbox } = await renderWith(combined);
  const html = els['device-health'].innerHTML;
  assert.match(html, /CPU used[\s\S]*RAM used[\s\S]*Disk available/);
  assert.match(html, /health-series-cpu" d="M[^L]+ M/, 'null/timestamp gaps start a new path segment');
  assert.match(html, /circle class="health-point health-point-cpu/);
  assert.match(html, /rect class="health-point health-point-ram/);
  assert.match(html, /path class="health-point health-point-disk/);
  assert.match(html, /Not measured/);
  assert.match(html, /&lt;Owner Mac&gt; device health history/);
  const table = html.match(/<tbody>[\s\S]*?<\/tbody>/)?.[0] || '';
  assert.equal((table.match(/<tr>/g) || []).length, 3);
  sandbox.probeHistory = hostState.deviceHealth.history;
  assert.match(vm.runInContext("healthSeriesPath(safeHealthHistory(probeHistory), 'cpuUsedPct', 60000).path", sandbox), /^M[^L]+ M/);
});

test('multi-host capacity keeps histories isolated and legacy history optional', async () => {
  const localState = stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]);
  localState.deviceHealth = healthState();
  localState.deviceHealth.history = [{ capturedAt: iso(-60_000), cpuUsedPct: 11, ramUsedPct: 22, diskAvailablePct: 33 }];
  const peerState = stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]);
  peerState.deviceHealth = healthState();
  peerState.deviceHealth.history = null;
  const combined = { hosts: [
    { host: 'local', label: 'Local Mac', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: localState },
    { host: 'peer', label: 'Peer Mac', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: peerState },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const html = els.hosts.innerHTML;
  assert.equal((html.match(/class="operational-host"/g) || []).length, 2);
  assert.equal((html.match(/class="health-history"/g) || []).length, 1);
  assert.equal((html.match(/History unavailable/g) || []).length, 1);
  const localStart = html.indexOf('Capacity now for Local Mac');
  const peerStart = html.indexOf('Capacity now for Peer Mac');
  assert.match(html.slice(localStart, peerStart), />11%</);
  assert.doesNotMatch(html.slice(peerStart), />11%</, 'the local sample never enters the peer history');
  assert.ok(html.indexOf('class="multi-operational"') < html.indexOf('class="host '), 'all urgent host summaries precede lower activity stories');
});

test('maximum configured hosts render bounded histories and no overflow host', async () => {
  const raw = Array.from({ length: MAX_REMOTE_HOSTS + 1 }, (_, i) => `peer-${i}=Peer ${i}`).join(',');
  const parsed = parseHosts(raw, { port: 8787, host: '0.0.0.0' }, null);
  assert.equal(parsed.hosts.length, MAX_REMOTE_HOSTS + 1, 'local plus sixteen remotes');
  assert.equal(parsed.errors[0].reason, 'host-limit-exceeded');
  const history = Array.from({ length: 60 }, (_, i) => ({
    capturedAt: iso(-(59 - i) * 60_000),
    cpuUsedPct: i, ramUsedPct: 100 - i, diskAvailablePct: 50,
  }));
  const hosts = parsed.hosts.map((configured) => {
    const state = stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]);
    state.deviceHealth = healthState();
    state.deviceHealth.history = history;
    return {
      ...configured, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state,
    };
  });
  const { els } = await renderWith({ hosts, generatedAt: iso(0) });
  const html = els.hosts.innerHTML;
  const hostCount = MAX_REMOTE_HOSTS + 1;
  assert.equal((html.match(/class="operational-host"/g) || []).length, hostCount);
  assert.equal((html.match(/class="health-history"/g) || []).length, hostCount);
  const tableBodies = [...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map((match) => match[1]);
  assert.equal(tableBodies.length, hostCount);
  assert.equal(tableBodies.reduce((sum, body) => sum + (body.match(/<tr>/g) || []).length, 0), hostCount * 60);
  assert.equal((html.match(/class="health-point /g) || []).length, hostCount * 3 * 60);
  assert.doesNotMatch(html, /Peer 16/);
});

test('missing and unavailable reset states keep compact cards honest and full evidence in pacing', async () => {
  const tool = claudeTool(3 * 3600_000, 2 * 86400_000);
  tool.limits.five_hour.remainingPct = 0;
  tool.limits.five_hour.usedPct = 100;
  tool.limits.seven_day.resetsAt = null;
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool, codexTool(5 * 86400_000)]),
  }], generatedAt: iso(0) };

  const { els } = await renderWith(combined);
  const values = assertBoundedCompactResets(els.tools.innerHTML, 4);
  assert.notEqual(values[0], '—', 'a maxed window retains its usable compact countdown');
  assert.equal(values[1], '—', 'a reading with no reset reports an em dash');
  assert.equal(values[2], '—', 'an unavailable window reports an em dash');
  assert.match(els.tools.innerHTML,
    /remaining limit-value is-crit">0[\s\S]*limit reached[\s\S]*fill-crit" style="width:100%/,
    'maxed semantics and the full consumed bar are unchanged');
  assert.match(els['device-health'].innerHTML,
    /5-hour limit reached[\s\S]*Live provider reading · resets in/);
  assert.match(els['device-health'].innerHTML,
    /Weekly[\s\S]*Reset time not reported · pacing unavailable/);
  assert.match(els['device-health'].innerHTML,
    /5-hour[\s\S]*Codex did not report a short window · pacing unavailable/);
});

test('an unavailable weekly window keeps configured evidence only in pacing', async () => {
  const tool = claudeTool(3 * 3600_000, 2 * 86400_000);
  tool.limits.seven_day = null;
  const configuredAt = iso(2 * 86400_000);
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]),
  }], generatedAt: iso(0) };

  const { els } = await renderWith(combined, configuredResetView(configuredAt));
  const values = assertBoundedCompactResets(els.tools.innerHTML, 2);
  assert.equal(values[1], '—', 'unavailable geometry never implies a reset value');
  assert.match(els.tools.innerHTML, /Weekly[\s\S]*Unavailable[\s\S]*No current window reading/);
  assert.doesNotMatch(els.tools.innerHTML, /Weekly[\s\S]*remaining limit-value/);
  assert.match(els['device-health'].innerHTML,
    /Weekly[\s\S]*Configured · [\s\S]*America\/Los_Angeles · resets in[\s\S]*usage reading unavailable/,
    'full configured evidence remains readable and associated in pacing');
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

test('multi-host diagnostics follow every operational summary and precede activity', async () => {
  const localTool = claudeTool(3 * 3600_000, 3 * 86400_000);
  localTool.limitsDiagnostic = { reason: 'stale-reading', capturedAt: iso(-900_000) };
  const peerTool = claudeTool(3 * 3600_000, 3 * 86400_000);
  const combined = { hosts: [
    { host: 'local', label: 'Local', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([localTool]) },
    { host: 'peer', label: 'Peer', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([peerTool]) },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const html = els.hosts.innerHTML;
  const operations = html.indexOf('class="multi-operational"');
  const diagnostics = html.indexOf('class="limit-notes capacity-diagnostics multi-capacity-diagnostics"');
  const activity = html.indexOf('class="host ');
  assert.ok(operations >= 0 && operations < diagnostics && diagnostics < activity);
  assert.match(html.slice(diagnostics, activity), /Claude Code[\s\S]*Stale reading/);
});

test('single-host mode renders model-specific caps and escapes model labels', async () => {
  const tool = claudeTool(3 * 3600_000, 3 * 86400_000);
  tool.modelLimits = [modelLimit({
    model: 'fable', label: '<img src=x onerror=alert(1)>', remainingPct: 51,
  })];
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]) }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els['supplementary-limits'].innerHTML;
  assert.match(h, /Claude model caps/);
  assert.match(h, /51<span class="unit">% left/);
  assert.doesNotMatch(h, /<img src=x onerror/, 'raw model label must not reach innerHTML');
  assert.match(h, /&lt;img src=x onerror/, 'model label is escaped');
  assert.doesNotMatch(els['claude-details'].innerHTML, /model-limit|model caps|&lt;img/i,
    'the account-wide cap is not repeated in lower machine-local details');
});

test('single-host top area shows three resets and every visible expiration date', async () => {
  const expirations = [iso(60 * 60_000), iso(2 * 60 * 60_000), iso(3 * 60 * 60_000)];
  const codex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 3, expirations,
  }));
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([codex]),
  }], generatedAt: iso(0) };

  const { els } = await renderWith(combined);
  const h = els['supplementary-limits'].innerHTML;
  assert.match(h, /Other global limits/);
  assert.match(h, /Codex reset credits/);
  assert.match(h, /<strong>3<\/strong><span>available<\/span>/);
  assert.equal((h.match(/<time class="expiry-date"/g) || []).length, 3);
  for (const expiry of expirations) {
    assert.match(h, new RegExp(`datetime="${expiry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  assert.doesNotMatch(h, /title="[^\"]*20\d\d/, 'dates are visible content, not tooltip-only');
});

test('identical reset expirations group only with their exact quantity', async () => {
  const first = iso(60 * 60_000);
  const second = iso(2 * 60 * 60_000);
  const codex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 3, expirations: [second, first, first],
  }));
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([codex]),
  }], generatedAt: iso(0) };

  const { els } = await renderWith(combined);
  const h = els['supplementary-limits'].innerHTML;
  assert.equal((h.match(/class="expiry-item"/g) || []).length, 2);
  assert.match(h, /2 resets expire in/);
  assert.ok(h.indexOf(`datetime="${first}"`) < h.indexOf(`datetime="${second}"`),
    'expiration groups stay soonest-first');
  assert.equal((h.match(new RegExp(`datetime="${first}"`, 'g')) || []).length, 1,
    'the exact duplicate instant is represented by one quantity-labeled row');
});

for (const fixture of [
  {
    name: 'authoritative zero',
    snapshot: resetSnapshot({ availableCount: 0 }),
    matches: [/<strong>0<\/strong><span>available<\/span>/, /No expiration dates/],
    misses: [/class="expiry-item"/, /Unavailable/],
  },
  {
    name: 'partial evidence',
    snapshot: resetSnapshot({ availableCount: 3, expirations: [iso(60 * 60_000), iso(2 * 60 * 60_000)] }),
    matches: [/>partial</, /1 expiration date is unavailable/, /<strong>3<\/strong><span>available<\/span>/],
  },
  {
    name: 'unsupported evidence',
    snapshot: {
      available: false, status: 'unsupported', availableCount: null,
      expirations: [], missingExpirationCount: 0, capturedAt: null,
    },
    matches: [/Unavailable/, />unsupported</, /not supported by this reading/],
  },
  {
    name: 'malformed evidence',
    snapshot: {
      available: false, status: 'malformed', availableCount: 'three',
      expirations: ['not-a-date'], missingExpirationCount: 0, capturedAt: null,
    },
    matches: [/Count unavailable/, />malformed</, /No count or expiration was guessed/],
    misses: [/NaN|not-a-date|three/],
  },
  {
    name: 'stale last-good evidence',
    snapshot: resetSnapshot({
      availableCount: 1, expirations: [iso(60 * 60_000)], capturedAt: iso(-20 * 60_000),
    }),
    diagnostic: { reason: 'stale-reading', capturedAt: iso(-20 * 60_000) },
    matches: [/>stale · /, /last good reset reading is old/, /<strong>1<\/strong><span>available<\/span>/],
  },
  {
    name: 'source error with last-good evidence',
    snapshot: resetSnapshot({
      availableCount: 1, expirations: [iso(60 * 60_000)], capturedAt: iso(-2 * 60_000),
    }),
    diagnostic: { reason: 'codex-cmd-failed', cmd: 'codex', detail: 'not found' },
    matches: [/source error/, /latest Codex account read failed/, /<strong>1<\/strong><span>available<\/span>/],
  },
]) {
  test(`Codex reset presentation distinguishes ${fixture.name}`, async () => {
    const codex = withResetCredits(codexTool(5 * 86400_000), fixture.snapshot);
    codex.limitsDiagnostic = fixture.diagnostic || null;
    const combined = { hosts: [{
      host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
      hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([codex]),
    }], generatedAt: iso(0) };
    const { els } = await renderWith(combined);
    const h = els['supplementary-limits'].innerHTML;
    for (const pattern of fixture.matches) assert.match(h, pattern);
    for (const pattern of fixture.misses || []) assert.doesNotMatch(h, pattern);
  });
}

test('one-second render tick removes a reset at its exact expiry boundary', async () => {
  const startMs = Date.now();
  const firstExpiry = new Date(startMs + 1000).toISOString();
  const secondExpiry = new Date(startMs + 60_000).toISOString();
  const clock = controlledClock(startMs);
  const codex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 2,
    expirations: [firstExpiry, secondExpiry],
    capturedAt: new Date(startMs - 1000).toISOString(),
  }));
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([codex]),
  }], generatedAt: iso(0) };

  const { els, intervals } = await renderWith(combined, null, { DateImpl: clock.DateImpl });
  assert.match(els['supplementary-limits'].innerHTML, /<strong>2<\/strong><span>available<\/span>/);
  assert.equal((els['supplementary-limits'].innerHTML.match(/class="expiry-item"/g) || []).length, 2);
  const tick = intervals.find(({ fn, ms }) => ms === 1000 && String(fn).includes('render()'));
  assert.ok(tick);
  clock.set(Date.parse(firstExpiry));
  tick.fn();
  assert.match(els['supplementary-limits'].innerHTML, /<strong>1<\/strong><span>available<\/span>/);
  assert.equal((els['supplementary-limits'].innerHTML.match(/class="expiry-item"/g) || []).length, 1);
  assert.doesNotMatch(els['supplementary-limits'].innerHTML, new RegExp(`datetime="${firstExpiry}"`));
});

test('same-account hosts select newest supplementary evidence on its own clocks', async () => {
  const localClaude = claudeTool(3 * 3600_000, 3 * 86400_000);
  const peerClaude = claudeTool(3 * 3600_000, 3 * 86400_000);
  peerClaude.limits.five_hour.resetsAt = localClaude.limits.five_hour.resetsAt;
  peerClaude.limits.seven_day.resetsAt = localClaude.limits.seven_day.resetsAt;
  localClaude.modelLimits = [modelLimit({
    model: 'fable', label: 'Fable', remainingPct: 12, capturedAt: iso(-5 * 60_000),
  })];
  peerClaude.modelLimits = [modelLimit({
    model: 'fable', label: 'Fable', remainingPct: 77, capturedAt: iso(-30_000),
  })];

  const localCodex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 1, expirations: [iso(60 * 60_000)], capturedAt: iso(-5 * 60_000),
  }));
  const peerCodex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 2,
    expirations: [iso(2 * 60 * 60_000), iso(3 * 60 * 60_000)],
    capturedAt: iso(-20_000),
  }));
  peerCodex.limits.seven_day.resetsAt = localCodex.limits.seven_day.resetsAt;
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([localClaude, localCodex]) },
    { host: 'peer', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-1000), state: stateOf([peerClaude, peerCodex]) },
  ], generatedAt: iso(0) };

  const { els } = await renderWith(combined);
  const overview = els.hosts.innerHTML.slice(0, els.hosts.innerHTML.indexOf('class="host '));
  assert.equal((overview.match(/Codex reset credits/g) || []).length, 1);
  assert.match(overview, /Fable[\s\S]*77<span class="unit">% left/);
  assert.doesNotMatch(overview, /Fable[\s\S]*12<span class="unit">% left/);
  assert.match(overview, /reset-count"><strong>2<\/strong><span>available<\/span>/);
  assert.doesNotMatch(overview, /reset-count"><strong>1<\/strong><span>available<\/span>/);
});

test('different accounts keep model caps and reset evidence in separate account blocks', async () => {
  const localClaude = claudeTool(3 * 3600_000, 3 * 86400_000);
  localClaude.modelLimits = [modelLimit({ model: 'fable', label: 'Fable', remainingPct: 81 })];
  const localCodex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 1, expirations: [iso(60 * 60_000)],
  }));
  const remoteClaude = claudeTool(60 * 60_000, 6 * 86400_000);
  remoteClaude.modelLimits = [modelLimit({ model: 'sonnet', label: 'Sonnet 4.5', remainingPct: 34 })];
  const remoteCodex = withResetCredits(codexTool(7 * 86400_000), resetSnapshot({
    availableCount: 3,
    expirations: [iso(2 * 60 * 60_000), iso(3 * 60 * 60_000), iso(4 * 60 * 60_000)],
  }));
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([localClaude, localCodex]) },
    { host: 'remote', label: 'Work laptop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-1000), state: stateOf([remoteClaude, remoteCodex]) },
  ], generatedAt: iso(0) };

  const { els } = await renderWith(combined);
  const blocks = els.hosts.innerHTML.split('<article class="account-block"').slice(1);
  assert.equal(blocks.length, 2);
  assert.match(blocks[0], /from This machine/);
  assert.match(blocks[0], /Fable/);
  assert.doesNotMatch(blocks[0], /Sonnet 4\.5/);
  assert.match(blocks[0], /reset-count"><strong>1<\/strong><span>available<\/span>/);
  assert.match(blocks[1], /from Work laptop/);
  assert.match(blocks[1], /Sonnet 4\.5/);
  assert.doesNotMatch(blocks[1], /Fable/);
  assert.match(blocks[1], /reset-count"><strong>3<\/strong><span>available<\/span>/);
});

test('global allowances appear once at the top and never duplicate in lower tool details', async () => {
  const claude = claudeTool(3 * 3600_000, 3 * 86400_000);
  claude.modelLimits = [
    modelLimit({ model: 'fable', label: 'Fable', remainingPct: 51 }),
    modelLimit({ model: 'sonnet', label: 'Sonnet 4.5', remainingPct: 64 }),
    modelLimit({ model: 'future-cap', label: 'Future global cap', remainingPct: 72 }),
  ];
  const codex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 1, expirations: [iso(60 * 60_000)],
  }));
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claude, codex]),
  }], generatedAt: iso(0) };

  const { els } = await renderWith(combined);
  const top = els['supplementary-limits'].innerHTML;
  assert.match(top, /Fable/);
  assert.match(top, /Sonnet 4\.5/);
  assert.match(top, /Future global cap/);
  assert.match(top, /Codex reset credits/);
  const lower = els['claude-details'].innerHTML + els['codex-details'].innerHTML;
  assert.doesNotMatch(lower, /Fable|Sonnet 4\.5|Future global cap|Codex reset credits|expiry-item/);
});

test('minimal-DOM fallback keeps the complete account story visible', async () => {
  const claude = claudeTool(3 * 3600_000, 3 * 86400_000);
  claude.modelLimits = [modelLimit({ model: 'fable', label: 'Fable', remainingPct: 51 })];
  const codex = withResetCredits(codexTool(5 * 86400_000), resetSnapshot({
    availableCount: 1, expirations: [iso(60 * 60_000)],
  }));
  const combined = { hosts: [{
    host: 'local', label: 'This machine', port: 8787, self: true, reachable: true,
    hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claude, codex]),
  }], generatedAt: iso(0) };

  const { els } = await renderWith(combined, null, { includeAccountContainers: false });
  assert.match(els.tools.innerHTML, /Shown once/);
  assert.match(els.tools.innerHTML, /Other global limits/);
  assert.match(els.tools.innerHTML, /Fable/);
  assert.match(els.tools.innerHTML, /Codex reset credits/);
  assert.match(els.tools.innerHTML, /<strong>1<\/strong><span>available<\/span>/);
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
  assert.equal((h.match(/class="device-section device-not-reported"/g) || []).length, 2,
    'legacy reachable hosts keep a health position without becoming offline');
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
  assert.match(appJs, /Limits and allowances: account-wide · Pacing and device health: per machine · Activity: per machine · Codex day buckets: UTC/);
  assert.match(appJs, /Health history: process lifetime · up to 60 samples/);
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

// ─────────────────────────────────────────────────────────────────────────────
// tailnet-bind-and-reporting-resilience (Part 2, dashboard surfaces)

test('a peer model cap with no capturedAt still renders — it inherits the member tool\'s dataAt as its evidence clock (FM-C4)', async () => {
  const local = claudeTool(3 * 3600_000, 3 * 86400_000);
  local.modelLimits = [modelLimit({ model: 'fable', label: 'Fable', remainingPct: 40, capturedAt: iso(-10 * 60_000) })];
  const peer = claudeTool(3 * 3600_000, 3 * 86400_000);
  peer.dataAt = iso(-30_000); // the peer's reading is newer than the local cap
  peer.freshness.capturedAt = peer.dataAt;
  const clockless = modelLimit({ model: 'fable', label: 'Fable', remainingPct: 7 });
  delete clockless.capturedAt; // an older peer build ships caps without their own timestamp
  peer.modelLimits = [clockless];
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([local]) },
    { host: '100.64.0.9', label: 'Work', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([peer]) },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  // Multi-host: the account overview (and its supplementary block) renders
  // inside #hosts under the account-1 suffix.
  const h = els.hosts.innerHTML;
  assert.match(h, /Claude model caps/);
  assert.match(h, /7<span class="unit">% left/, 'the newer (peer) cap wins by the inherited dataAt clock instead of being dropped');
  assert.doesNotMatch(h, /40<span class="unit">% left/);
});

test('a peer model cap with neither capturedAt nor a tool dataAt is skipped (no evidence clock, nothing guessed) (FM-C4)', async () => {
  const peer = claudeTool(3 * 3600_000, 3 * 86400_000);
  peer.dataAt = null;
  const clockless = modelLimit({ model: 'fable', label: 'Fable', remainingPct: 7 });
  delete clockless.capturedAt;
  peer.modelLimits = [clockless];
  const combined = { hosts: [
    { host: '100.64.0.9', label: 'Work', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([peer]) },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  assert.doesNotMatch(els.hosts.innerHTML + els['supplementary-limits'].innerHTML, /% left/);
});

test('model-cap-expired: the model-cap block names the cap and its last observation instead of claiming a complete reading (FM-C1)', async () => {
  const tool = claudeTool(3 * 3600_000, 3 * 86400_000);
  tool.limitsDiagnostic = { reason: 'model-cap-expired', model: '<b>fable</b>', lastCapturedAt: iso(-11 * 3600_000) };
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]) }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els['supplementary-limits'].innerHTML;
  assert.match(h, /<strong>The &lt;b&gt;fable&lt;\/b&gt; cap is no longer current<\/strong> — last observed 11h 0m ago/);
  assert.doesNotMatch(h, /<b>fable<\/b>/, 'the model field is escaped');
  assert.doesNotMatch(h, /complete current reading/);
  assert.doesNotMatch(h, /% left/, 'no value is revived');
  // The lowest-precedence code does not stack a data-quality note on the gauges.
  assert.doesNotMatch(els['limit-notes'].innerHTML, /model-cap|no longer current|Unavailable|No Claude Code limit reading/);
  assert.doesNotMatch(els.tools.innerHTML, /No Claude Code limit reading yet/);

  // With an established probe failure the cause rides along (own-key table; a
  // proto/unknown cause falls back to the generic sentence, never raw).
  tool.limitsDiagnostic.cause = 'parse-failed';
  let out = (await renderWith(combined)).els['supplementary-limits'].innerHTML;
  assert.match(out, /it is failing: The <code>\/usage<\/code> screen couldn&#39;t be read|it is failing: The <code>\/usage<\/code> screen couldn't be read/);
  tool.limitsDiagnostic.cause = '__proto__';
  out = (await renderWith(combined)).els['supplementary-limits'].innerHTML;
  assert.match(out, /Refresh attempts keep failing/);
  assert.doesNotMatch(out, /__proto__/);

  // When other caps still render, the expired one is disclosed under the list.
  tool.modelLimits = [modelLimit({ model: 'sonnet-4-5', label: 'Sonnet 4.5', remainingPct: 61 })];
  out = (await renderWith(combined)).els['supplementary-limits'].innerHTML;
  assert.match(out, /61<span class="unit">% left/);
  assert.match(out, /<p class="evidence-note"><strong>The &lt;b&gt;fable&lt;\/b&gt; cap is no longer current<\/strong>/);
});

test('auto-refresh-failing: the model-cap block names the probe cause when no caps are reported (FM-C1)', async () => {
  const tool = claudeTool(3 * 3600_000, 3 * 86400_000);
  tool.freshness.capturedAt = iso(-15 * 60_000);
  tool.limitsDiagnostic = { reason: 'auto-refresh-failing', cause: 'timeout', capturedAt: tool.freshness.capturedAt };
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([tool]) }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els['supplementary-limits'].innerHTML;
  assert.match(h, /<strong>No Claude Code model caps are reported<\/strong> — model caps arrive only through the <code>\/usage<\/code> auto-refresh, which is failing\. Refresh attempts are timing out/);
  assert.doesNotMatch(h, /complete current reading/);
  // The default empty state no longer asserts completeness either.
  tool.limitsDiagnostic = null;
  tool.freshness.capturedAt = iso(-30_000);
  const plain = (await renderWith(combined)).els['supplementary-limits'].innerHTML;
  assert.match(plain, /No additional Claude Code model caps are reported in the current reading/);
  assert.doesNotMatch(plain, /complete current reading/);
});

test('window-not-reported: the unavailable Codex card names the cause and the last sighting; the note slot stays quiet (FM-X1)', async () => {
  const codex = codexTool(5 * 86400_000);
  codex.freshness = { capturedAt: iso(-20_000), freshForMs: 120_000, staleAfterMs: 300_000 };
  codex.limitsDiagnostic = { reason: 'window-not-reported', window: 'five_hour', lastSeenAt: iso(-2 * 3600_000) };
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([codex]) }], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els.tools.innerHTML;
  assert.match(h, /5-hour[\s\S]*Unavailable[\s\S]*Not in the latest Codex response · last reported 2h 0m ago/);
  assert.doesNotMatch(h, /No short-window reading/);
  assert.match(h, /RESET ·|Reset ·/);
  assert.doesNotMatch(els['limit-notes'].innerHTML, /No Codex limit reading yet|window-not-reported/);
  assert.doesNotMatch(h, /No Codex limit reading yet/);
  // Without a last sighting the card still names the cause, with no fabricated age.
  codex.limitsDiagnostic.lastSeenAt = null;
  const bare = (await renderWith(combined)).els.tools.innerHTML;
  assert.match(bare, /Not in the latest Codex response<\/div>/);
  assert.doesNotMatch(bare, /last reported/);
  // The diagnostic names ONE window: the other card is untouched.
  codex.limitsDiagnostic = { reason: 'window-not-reported', window: 'seven_day', lastSeenAt: null };
  const other = (await renderWith(combined)).els.tools.innerHTML;
  assert.match(other, /No short-window reading/);
});

test('codex freshness (FM-X2): the shared aging/stale pill applies to Codex once the server supplies thresholds', async () => {
  const codex = codexTool(5 * 86400_000);
  codex.freshness = { capturedAt: iso(-7 * 60_000), freshForMs: 120_000, staleAfterMs: 300_000 };
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([codex]) }], generatedAt: iso(0) };
  // The reading-age pill lives in the tool group header (rendered into #codex-details).
  const group = async () => (await renderWith(combined)).els['codex-details'].innerHTML;
  let out = await group();
  assert.match(out, /Codex[\s\S]*<span class="age-pill pill-crit">stale<\/span>/);
  codex.freshness.capturedAt = iso(-3 * 60_000);
  out = await group();
  assert.match(out, /Codex[\s\S]*<span class="age-pill pill-warn">aging<\/span>/);
  assert.doesNotMatch(out, /pill-crit">stale/);
  codex.freshness.capturedAt = iso(-30_000);
  out = await group();
  assert.doesNotMatch(out, /age-pill/);
  // A peer on an older llmdash (null freshness) still renders with no band.
  codex.freshness = null;
  out = await group();
  assert.doesNotMatch(out, /age-pill/);
});
