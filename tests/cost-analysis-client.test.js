import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');

function classList(initial = []) {
  const values = new Set(initial);
  return { toggle(name, on) { on ? values.add(name) : values.delete(name); }, contains: (name) => values.has(name) };
}
function element(id) {
  let text = '';
  return {
    id, innerHTML: '', hidden: false, attrs: {}, dataset: {}, classList: classList(),
    get textContent() { return text; }, set textContent(value) { text = String(value); },
    addEventListener(type, handler) { this[`on${type}`] = handler; },
    querySelectorAll() { return []; }, setAttribute(name, value) { this.attrs[name] = String(value); },
    closest() { return null; },
  };
}
function metric(amountMicros, status = 'complete', reasons = []) { return { status, amountMicros, reasons }; }
function effect(amountMicros, status = 'complete', reasons = []) {
  return { ...metric(amountMicros, status, reasons), rawSign: Math.sign(amountMicros || 0), belowResolution: false };
}
function scope(multiplier = 1) {
  const summary = {
    subscription: metric(10_000_000 * multiplier),
    observedCache: metric(20_000_000 * multiplier),
    noCache: metric(50_000_000 * multiplier),
    cacheEffect: effect(30_000_000 * multiplier),
  };
  const points = [1, 2, 3].map((step) => ({
    at: `2026-07-${String(13 + step).padStart(2, '0')}T22:00:00.000Z`,
    subscription: metric(Math.round(summary.subscription.amountMicros * step / 3)),
    observedCache: metric(Math.round(summary.observedCache.amountMicros * step / 3)),
    noCache: metric(Math.round(summary.noCache.amountMicros * step / 3)),
    cacheEffect: effect(Math.round(summary.cacheEffect.amountMicros * step / 3)),
  }));
  return {
    summary,
    usageCoverage: { status: 'complete', denominatorKnown: true, recognizedRecords: 12, comparableRecords: 12, recognizedTokens: 1000, comparableTokens: 1000, recordRatio: 1, tokenRatio: 1, deduplicatedRecords: 2, fallbackIdentityRecords: 0, reasons: [] },
    subscriptionCoverage: { status: 'complete', coveredMs: 100, requiredMs: 100, ratio: 1, gapCount: 0, gaps: [] },
    daily: [], cumulative: points,
  };
}
function payload(range = '30d') {
  return {
    schemaVersion: 1, source: 'local-logs-and-owner-config', scope: 'local-machine', currency: 'USD', range,
    generatedAt: '2026-07-16T22:00:00.000Z',
    interval: { start: '2026-06-17T07:00:00.000Z', end: '2026-07-16T22:00:00.000Z', timeZone: 'America/Los_Angeles', partialCurrentDay: true },
    refresh: { status: 'fresh', lastAttemptAt: '2026-07-16T22:00:00.000Z', reasons: [] },
    provenance: {
      subscription: { ownerConfirmed: true, coveredMs: 100, requiredMs: 100, gapCount: 0 },
      pricing: {
        cardAsOf: '2026-07-16T00:00:00.000Z',
        sources: [{ id: 'official', label: 'Official <pricing>', publishedAt: '2026-07-16T00:00:00.000Z' }],
        effectiveRates: [{ tool: 'claude', model: 'claude-test', effectiveFrom: '2026-01-01T00:00:00.000Z', effectiveTo: null, sourceId: 'official' }],
      },
    },
    scopes: { combined: scope(1), claude: scope(0.7), codex: scope(0.3) },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function browser(costFetch) {
  const els = {
    headroom: element('headroom'), tools: element('tools'), hosts: element('hosts'), age: element('age'),
    freshness: element('freshness'), trends: element('trends'),
    'cost-surface': element('cost-surface'), 'cost-status': element('cost-status'),
  };
  const buttons = ['7d', '30d', '90d'].map((rangeName) => {
    const button = element(`cost-${rangeName}`);
    button.dataset.range = rangeName;
    button.classList = classList(rangeName === '30d' ? ['active'] : []);
    button.closest = (selector) => selector === '.pill' ? button : null;
    return button;
  });
  const range = element('cost-range');
  range.querySelectorAll = (selector) => selector === '.pill' ? buttons : [];
  els['cost-range'] = range;
  const document = { getElementById: (id) => els[id] || null, querySelector: () => null };
  const costUrls = [];
  const intervals = [];
  const fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('/api/cost-analysis')) {
      costUrls.push(value);
      return costFetch(value, costUrls.length);
    }
    if (value.startsWith('/api/hosts')) return { ok: true, json: async () => ({ hosts: [], generatedAt: '2026-07-16T22:00:00Z' }) };
    if (value.startsWith('/api/codex-insights')) return { ok: true, json: async () => ({ source: 'codex', scope: 'local-machine', range: '7d', hasData: false, account: {} }) };
    return { ok: true, json: async () => ({ tools: [], range: '7d' }) };
  };
  const sandbox = {
    document, fetch, console, Date, Math, JSON, Number, String, Array, Object, Map, Set, Intl,
    encodeURIComponent, queueMicrotask,
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout: (callback, delay) => delay >= 1000 ? 0 : setTimeout(callback, delay),
  };
  vm.createContext(sandbox);
  vm.runInContext(appJs, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { els, buttons, range, costUrls, intervals };
}

test('cost shell is secondary, local-only, independently ranged, and honest before data arrives', () => {
  assert.ok(indexHtml.indexOf('id="single-limits"') < indexHtml.indexOf('id="cost-analysis"'));
  assert.ok(indexHtml.indexOf('id="tool-groups"') < indexHtml.indexOf('id="cost-analysis"'));
  assert.match(indexHtml, /Configured spend and API-equivalent value/);
  assert.match(indexHtml, /fixed subscription access and two counterfactual API estimates stay separate/);
  assert.match(indexHtml, /id="cost-range" role="group" aria-label="Cost analysis range"/);
  assert.match(indexHtml, /data-range="30d" aria-pressed="true"/);
  assert.match(indexHtml, /Reading the latest bounded local cost snapshot/);
  assert.doesNotMatch(indexHtml, /cost-surface[^>]*aria-live/);
});

test('complete payload renders separated totals, reconciliation, three accessible charts, and escaped provenance', async () => {
  const { els } = await browser(async () => ({ ok: true, json: async () => payload() }));
  const html = els['cost-surface'].innerHTML;
  for (const label of ['Configured subscription spend', 'API-equivalent · observed cache', 'API-equivalent · no cache', 'Cache effect · no cache − observed']) {
    assert.match(html, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(html, /\+\$30\.00/);
  assert.match(html, /estimates, not charges or invoices/);
  assert.equal((html.match(/role="img" aria-labelledby="cost-chart-/g) || []).length, 3);
  assert.match(html, /Configured subscription spend: \$10\.00 \(complete\)/);
  assert.doesNotMatch(html, /Official <pricing>/);
  assert.match(html, /Official &lt;pricing&gt;/);
  assert.match(html, /Claude claude-test · [^<]+–current/);
  assert.equal(els['cost-surface'].attrs['aria-busy'], 'false');
});

test('zero, sub-cent, unavailable, partial, and fixed diagnostics stay distinct', async () => {
  const data = payload();
  data.scopes.combined.summary.subscription = metric(0);
  data.scopes.combined.summary.observedCache = metric(9_999, 'partial', ['unknown_model', 'raw secret reason']);
  data.scopes.combined.summary.noCache = metric(null, 'unavailable', ['rate_card_unreadable']);
  data.scopes.combined.summary.cacheEffect = effect(-9_999, 'partial', ['unknown_model']);
  data.scopes.combined.usageCoverage.denominatorKnown = false;
  data.scopes.combined.usageCoverage.comparableRecords = 3;
  const { els } = await browser(async () => ({ ok: true, json: async () => data }));
  const html = els['cost-surface'].innerHTML;
  assert.match(html, /\$0\.00/);
  assert.match(html, /&lt;\$0\.01/);
  assert.match(html, /−&lt;\$0\.01/);
  assert.match(html, />Unavailable</);
  assert.match(html, />partial</);
  assert.match(html, /model without an exact reviewed rate was excluded/);
  assert.doesNotMatch(html, /raw secret reason/);
});

test('a signed sub-micro cache effect keeps its raw sign visible', async () => {
  const data = payload();
  data.scopes.combined.summary.cacheEffect = {
    status: 'complete', amountMicros: 0, rawSign: -1, belowResolution: true, reasons: [],
  };
  const { els } = await browser(async () => ({ ok: true, json: async () => data }));
  assert.match(els['cost-surface'].innerHTML, /−&lt;\$0\.01/);
  assert.doesNotMatch(els['cost-surface'].innerHTML, /Cache effect[\s\S]{0,200}\$0\.00/);
});

test('prototype-like diagnostic names cannot resolve inherited copy', async () => {
  const data = payload();
  data.scopes.combined.summary.observedCache = metric(null, 'unavailable', ['constructor']);
  const { els } = await browser(async () => ({ ok: true, json: async () => data }));
  const html = els['cost-surface'].innerHTML;
  assert.match(html, /No supported amount is available/);
  assert.match(html, /Some evidence could not be included/);
  assert.doesNotMatch(html, /native code|function Object/);
});

test('newer range wins while the prior surface remains visible during updates', async () => {
  const pending7 = deferred();
  const pending90 = deferred();
  const { els, buttons, range } = await browser(async (url) => {
    if (url.includes('range=7d')) return pending7.promise;
    if (url.includes('range=90d')) return pending90.promise;
    return { ok: true, json: async () => payload('30d') };
  });
  const original = els['cost-surface'].innerHTML;
  range.onclick({ target: buttons[0] });
  assert.equal(els['cost-surface'].innerHTML, original);
  assert.equal(els['cost-status'].textContent, 'Updating…');
  range.onclick({ target: buttons[2] });
  pending90.resolve({ ok: true, json: async () => payload('90d') });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const newest = els['cost-surface'].innerHTML;
  pending7.resolve({ ok: true, json: async () => payload('7d') });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(els['cost-surface'].innerHTML, newest);
  assert.equal(buttons[2].classList.contains('active'), true);
});

test('responsive, theme, focus, line-pattern, and reduced-motion contracts are explicit', () => {
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*\.cost-summary \{ grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*\.cost-tool-charts \{ grid-template-columns: 1fr/);
  assert.match(styles, /\.cost-series\.series-subscription[\s\S]*stroke-dasharray/);
  assert.match(styles, /\.cost-series\.series-no-cache[\s\S]*stroke-dasharray/);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /focus-visible/);
  assert.doesNotMatch(appJs, /Est\. value|Cache saved|cache savings/i);
});
