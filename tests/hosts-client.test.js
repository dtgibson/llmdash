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

async function renderWith(combined) {
  const els = {
    headroom: makeEl('headroom'), tools: makeEl('tools'), hosts: makeEl('hosts'),
    age: makeEl('age'), freshness: makeEl('freshness'), trends: makeEl('trends'),
    range: null,
  };
  const footer = makeFooter();
  const doc = {
    getElementById: (id) => els[id] || null,
    querySelector: (sel) => (sel === 'footer' ? footer : null),
  };
  let resolveDone;
  const done = new Promise((r) => { resolveDone = r; });
  const fetchStub = async (url) => {
    if (String(url).startsWith('/api/hosts')) {
      // Let render() run, then signal completion on the next microtask tick.
      queueMicrotask(() => setTimeout(resolveDone, 0));
      return { ok: true, json: async () => combined };
    }
    // /api/trends — return an empty shell so fetchTrends doesn't throw.
    return { ok: true, json: async () => ({ tools: [], range: '7d' }) };
  };
  const sandbox = {
    document: doc, fetch: fetchStub,
    setInterval: () => 0, setTimeout: (fn, ms) => { if (ms === 0) queueMicrotask(fn); return 0; },
    queueMicrotask, console, Date, Math, JSON, encodeURIComponent, Number, String, Array, Object,
  };
  vm.createContext(sandbox);
  vm.runInContext(appJs, sandbox);
  await done;
  return { els, footer };
}

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
const stateOf = (tools) => ({ tools, headroom: null, generatedAt: iso(0) });

test('single-host mode (1 self host) renders via #tools with NO host chrome (QA-18)', async () => {
  const combined = { hosts: [{ host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([claudeTool(3 * 3600_000, 3 * 86400_000)]) }], generatedAt: iso(0) };
  const { els, footer } = await renderWith(combined);
  assert.match(els.tools.innerHTML, /class="tool(?:\s|\")/, '#tools renders the tool block');
  assert.match(els.tools.innerHTML, /class="gauges"/, 'gauges actually render');
  assert.match(els.tools.innerHTML, /class="tool-mark" aria-hidden="true">◆</, 'Claude keeps the shared tool identity mark');
  assert.equal(els.hosts.innerHTML, '', 'no host chrome in single-host mode');
  assert.doesNotMatch(els.hosts.innerHTML, /acct|host-head/, 'no banner, no host header');
  assert.match(footer._spans[0].textContent, /Activity: local session logs/, 'single-host footer');
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
  const h = els.tools.innerHTML;
  assert.match(h, /model-specific limits/);
  assert.match(h, /51<span class="unit">%</);
  assert.doesNotMatch(h, /<img src=x onerror/, 'raw model label must not reach innerHTML');
  assert.match(h, /&lt;img src=x onerror/, 'model label is escaped');
});

test('multi-host same-account: ONE account banner, activity per host, no duplicated meter (QA-15/QA-17)', async () => {
  const shared = () => claudeTool(3 * 3600_000, 3 * 86400_000);
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([shared()]) },
    { host: '100.64.0.7', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-34_000), state: stateOf([shared()]) },
  ], generatedAt: iso(0) };
  const { els, footer } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  // The account banner appears exactly once.
  assert.equal((h.match(/class="acct"/g) || []).length, 1, 'exactly one account banner');
  assert.match(h, /Account limits/);
  assert.match(h, /identical on This machine &amp; Desktop/, 'scope names both same-account hosts, escaped');
  // The shared meter (a gauge with a 5-hour panel) appears once — in the banner.
  const bannerHtml = h.slice(h.indexOf('class="acct"'), h.indexOf('class="host '));
  assert.match(bannerHtml, /class="gauges"/, 'the shared gauge lives in the banner');
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

test('a different-account host renders its OWN meters in-group (reads distinct, QA-15)', async () => {
  const shared = () => claudeTool(3 * 3600_000, 3 * 86400_000);
  const different = claudeTool(1 * 3600_000, 6 * 86400_000);
  const combined = { hosts: [
    { host: 'local', label: 'This machine', port: 8787, self: true, reachable: true, hostDiagnostic: null, fetchedAt: iso(0), state: stateOf([shared()]) },
    { host: 'a', label: 'Desktop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-34_000), state: stateOf([shared()]) },
    { host: 'b', label: 'Work laptop', port: 8787, self: false, reachable: true, hostDiagnostic: null, fetchedAt: iso(-12_000), state: stateOf([different]) },
  ], generatedAt: iso(0) };
  const { els } = await renderWith(combined);
  const h = els.hosts.innerHTML;
  // Work laptop's card carries its own gauges + the "account limits · this machine" caption.
  const workIdx = h.indexOf('Work laptop');
  const workCard = h.slice(workIdx);
  assert.match(workCard, /account limits · this machine/, 'the different-account host labels its own numbers');
  assert.match(workCard, /class="gauges"/, 'and renders its own meters in-group');
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

test('the multi-host footer/legend copy is the approved verbatim (design-spec copy table)', () => {
  assert.match(appJs, /Account limits/);
  assert.match(appJs, /These are the account's numbers — the <b>same<\/b> across every machine/);
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
