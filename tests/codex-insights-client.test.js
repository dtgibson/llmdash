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
  return {
    toggle(name, on) { on ? values.add(name) : values.delete(name); },
    contains(name) { return values.has(name); },
  };
}

function element(id) {
  let text = '';
  return {
    id, innerHTML: '', hidden: false, attrs: {}, textHistory: [],
    get textContent() { return text; },
    set textContent(value) { text = String(value); this.textHistory.push(text); },
    classList: classList(), dataset: {},
    addEventListener(type, handler) { this[`on${type}`] = handler; },
    querySelectorAll() { return []; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    closest() { return null; },
  };
}

function insightPayload(range = '7d', overrides = {}) {
  return {
    source: 'codex', scope: 'local-machine', range,
    generatedAt: '2026-07-12T20:00:00.000Z', hasData: true,
    account: {
      scope: 'account-wide',
      plan: { available: true, label: 'ChatGPT Pro' },
      credits: { available: true, status: 'available', balance: null, resetCreditsAvailable: 2 },
    },
    summary: {
      reasoning: { available: true, share: 0.18, tokens: 180, outputTokens: 1000 },
      turns: { available: true, count: 12, averageTokens: 4200 },
      sessions: { available: true, count: 3, averageTokens: 16800 },
      busiestDay: { available: true, day: '2026-07-12T00:00:00.000Z', tokens: 31000 },
    },
    mix: {
      models: { available: true, items: [{ label: 'gpt-5', tokens: 42000, tokenShare: 0.8, turns: 10 }] },
      effort: { available: true, items: [{ label: 'High', turns: 8, share: 0.67 }] },
      tools: { available: true, items: [{ label: 'Shell', invocations: 14, share: 0.5 }] },
    },
    context: {
      pressure: { available: true, peak: 0.84, supportedTurns: 4, turnsAtOrAbove80Pct: 1 },
      compactions: { available: true, count: 2, sessionsAffected: 1 },
    },
    latency: {
      total: { available: true, medianMs: 3400, p95Ms: 9200, samples: 10 },
      firstToken: { available: true, medianMs: 550, p95Ms: 1100, samples: 9 },
    },
    daily: [
      { day: '2026-07-11T00:00:00.000Z', reasoningShare: 0.12, averageTokensPerTurn: 3000 },
      { day: '2026-07-12T00:00:00.000Z', reasoningShare: 0.18, averageTokensPerTurn: 6200 },
    ],
    ...overrides,
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function makeBrowser(insightFetch) {
  const els = {
    headroom: element('headroom'), tools: element('tools'), hosts: element('hosts'),
    age: element('age'), freshness: element('freshness'), trends: element('trends'),
    'insights-surface': element('insights-surface'),
    'insights-status': element('insights-status'),
    'insights-range-copy': element('insights-range-copy'),
  };
  const buttons = ['24h', '7d', '30d'].map((range) => {
    const button = element(`insights-${range}`);
    button.dataset.range = range;
    button.classList = classList(range === '7d' ? ['active'] : []);
    button.closest = (selector) => selector === '.pill' ? button : null;
    button.setAttribute('aria-pressed', String(range === '7d'));
    return button;
  });
  const range = element('insights-range');
  range.querySelectorAll = (selector) => selector === '.pill' ? buttons : [];
  els['insights-range'] = range;

  const trendRange = element('range');
  els.range = trendRange;
  const footerSpans = [{ textContent: '' }, { textContent: '' }];
  const footer = { querySelectorAll: (selector) => selector === 'span' ? footerSpans : [] };
  const document = {
    getElementById: (id) => els[id] || null,
    querySelector: (selector) => selector === 'footer' ? footer : null,
  };
  const insightUrls = [];
  const intervals = [];
  const fetch = async (url) => {
    const value = String(url);
    if (value.startsWith('/api/codex-insights')) {
      insightUrls.push(value);
      return insightFetch(value, insightUrls.length);
    }
    if (value.startsWith('/api/hosts')) {
      return { ok: true, json: async () => ({ hosts: [], generatedAt: '2026-07-12T20:00:00.000Z' }) };
    }
    return { ok: true, json: async () => ({ tools: [], range: '7d' }) };
  };
  const sandbox = {
    document, fetch, console, Date, Math, JSON, Number, String, Array, Object, Map, Set,
    encodeURIComponent,
    setInterval: (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; },
    setTimeout: (callback, delay) => delay >= 1000 ? 0 : setTimeout(callback, delay),
    queueMicrotask,
  };
  vm.createContext(sandbox);
  vm.runInContext(appJs, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { sandbox, els, buttons, range, insightUrls, intervals };
}

test('Codex insight shell is dashboard-only, scoped, independently ranged, and initially honest', () => {
  const tools = indexHtml.indexOf('id="tools"');
  const hosts = indexHtml.indexOf('id="hosts"');
  const insights = indexHtml.indexOf('id="codex-insights"');
  const trends = indexHtml.indexOf('id="trends-title"');
  assert.ok(tools < insights && hosts < insights && insights < trends, 'insights sit after tools/hosts and before Trends');
  assert.match(indexHtml, /This machine · structured local Codex metadata/);
  assert.match(indexHtml, /id="insights-range" aria-label="Codex insight range"/);
  assert.match(indexHtml, /Reading local Codex session metadata…/);
  assert.match(indexHtml, /id="insights-status" role="status">Loading…<\/div>/);
  assert.doesNotMatch(indexHtml, /id="insights-surface"[^>]*aria-live/,
    'periodic refreshes do not re-announce the full insight surface');
  assert.doesNotMatch(indexHtml, /menu/i, 'dashboard markup adds no menu surface');
  assert.match(appJs, /setInterval\(\(\) => fetchCodexInsights\(\{ announce: false \}\)/,
    'timer refreshes stay quiet for screen readers');
});

test('supported aggregate renders account facts, summary, bounded mix, context, timing, and both accessible charts', async () => {
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => insightPayload() }));
  const html = els['insights-surface'].innerHTML;
  assert.match(html, /Account-wide/);
  assert.match(html, /ChatGPT Pro/);
  assert.match(html, /Credits available/);
  assert.match(html, /2 reset credits/);
  assert.match(html, /Reasoning share/);
  assert.match(html, />18%/);
  assert.match(html, /12 recorded turns/);
  assert.match(html, /Jul 12/);
  assert.match(html, /Models · token share/);
  assert.match(html, /Peak context pressure/);
  assert.match(html, /84%/);
  assert.match(html, /3\.4s median/);
  assert.equal((html.match(/class="insight-chart"/g) || []).length, 2);
  assert.match(html, /role="img" aria-labelledby="insight-reasoning-chart-title insight-reasoning-chart-desc"/);
  assert.match(html, /class="sr-only"/);
  assert.equal(els['insights-surface'].attrs['aria-busy'], 'false');
  assert.equal(els['insights-status'].textContent, 'Updated · last 7 days');
});

test('no-data keeps account facts and omits empty metrics and charts', async () => {
  const payload = insightPayload('7d', { hasData: false });
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.match(html, /Account-wide/);
  assert.match(html, /No supported Codex activity was recorded in the last 7 days on this machine\./);
  assert.doesNotMatch(html, /insights-summary/);
  assert.doesNotMatch(html, /insight-chart/);
});

test('tool, compaction, and timing evidence renders even when token summaries are unavailable', async () => {
  const payload = insightPayload('7d');
  payload.summary = {
    reasoning: { available: false, share: null, tokens: null, outputTokens: null },
    turns: { available: false, count: null, averageTokens: null },
    sessions: { available: false, count: null, averageTokens: null },
    busiestDay: { available: false, day: null, tokens: null },
  };
  payload.mix = {
    models: { available: false, items: [] },
    effort: { available: false, items: [] },
    tools: { available: true, items: [{ label: 'Shell', invocations: 1, share: 1 }] },
  };
  payload.context = {
    pressure: { available: false, peak: null, supportedTurns: null, turnsAtOrAbove80Pct: null },
    compactions: { available: true, count: 1, sessionsAffected: 1 },
  };
  payload.latency = {
    total: { available: true, medianMs: 100, p95Ms: 100, samples: 1 },
    firstToken: { available: true, medianMs: 25, p95Ms: 25, samples: 1 },
  };
  payload.daily = [];
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.doesNotMatch(html, /No supported Codex activity/);
  assert.match(html, /Shell/);
  assert.match(html, /Compactions/);
  assert.match(html, /100ms median/);
});

test('partial support preserves metric locations, distinguishes zero, escapes labels, and omits a thin chart', async () => {
  const payload = insightPayload('7d');
  payload.account.plan.label = '<img src=x onerror=alert(1)>';
  payload.summary.reasoning = { available: true, share: 0, tokens: 0, outputTokens: 10 };
  payload.summary.turns = { available: false, count: null, averageTokens: null };
  payload.summary.sessions = { available: true, count: 0, averageTokens: 0 };
  payload.summary.busiestDay = { available: false, day: null, tokens: null };
  payload.mix.models.items[0].label = '<script>evil()</script>';
  payload.mix.effort = { available: false, items: [] };
  payload.context.pressure = { available: false, peak: null, supportedTurns: 0, turnsAtOrAbove80Pct: 0 };
  payload.context.compactions = { available: true, count: 0, sessionsAffected: 0 };
  payload.latency.total = { available: false, medianMs: null, p95Ms: null, samples: 0 };
  payload.daily = [
    { day: '2026-07-11T00:00:00.000Z', reasoningShare: 0, averageTokensPerTurn: null },
    { day: '2026-07-12T00:00:00.000Z', reasoningShare: 0.1, averageTokensPerTurn: 10 },
  ];
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.match(html, />0%/);
  assert.match(html, /<div class="insight-metric-value">0<\/div>/, 'observed zero session count renders as zero');
  assert.ok((html.match(/Unavailable/g) || []).length >= 3, 'unsupported fields render literal Unavailable');
  assert.match(html, /Completed-task timing wasn&#39;t recorded|Completed-task timing wasn't recorded/);
  assert.doesNotMatch(html, /<img src=x|<script>evil/);
  assert.match(html, /&lt;img src=x/);
  assert.match(html, /&lt;script&gt;evil/);
  assert.equal((html.match(/class="insight-chart"/g) || []).length, 1, 'only the supported two-point trend renders');
});

test('all-zero chart descriptions report observed zero instead of the plotting floor', async () => {
  const payload = insightPayload('7d', { daily: [
    { day: '2026-07-11T00:00:00.000Z', reasoningShare: 0, averageTokensPerTurn: 0 },
    { day: '2026-07-12T00:00:00.000Z', reasoningShare: 0, averageTokensPerTurn: 0 },
  ] });
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.match(html, /Reasoning share ranged from 0% to 0% over 2 UTC days\./);
  assert.match(html, /Average tokens \/ turn ranged from 0 to 0 over 2 UTC days\./);
  assert.doesNotMatch(html, /ranged from 0% to 1%|ranged from 0 to 1 over/);
});

test('daily charts preserve calendar gaps and overlong timing is disclosed as capped', async () => {
  const payload = insightPayload('7d');
  payload.latency.total = { available: true, medianMs: 90_000_000, p95Ms: 100_000_000, samples: 2 };
  payload.daily = [
    { day: '2026-07-01T00:00:00.000Z', reasoningShare: 0.1, averageTokensPerTurn: 10 },
    { day: '2026-07-02T00:00:00.000Z', reasoningShare: 0.2, averageTokensPerTurn: 20 },
    { day: '2026-07-11T00:00:00.000Z', reasoningShare: 0.3, averageTokensPerTurn: 30 },
  ];
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.match(html, /insight-series-accent" points="18\.0,[^ ]+ 50\.4,/,
    'Jul 2 is positioned one tenth across the Jul 1–11 calendar span');
  assert.doesNotMatch(html, /<text x="50\.4"/, 'a clustered middle label is omitted');
  assert.match(html, /≥24h median/);
  assert.doesNotMatch(html, /1440m/);
});

test('duration rounding never emits a 60-second component', async () => {
  const payload = insightPayload();
  payload.latency.total = { available: true, medianMs: 119_999, p95Ms: 3_599_999, samples: 2 };
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.match(html, /2m median/);
  assert.match(html, /1h p95/);
  assert.doesNotMatch(html, /60s/);
});

test('a maximum-length opaque credit balance stays bounded and wrap-safe', async () => {
  const balance = 'A'.repeat(64);
  const payload = insightPayload();
  payload.account.credits.balance = balance;
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  assert.match(els['insights-surface'].innerHTML, new RegExp(`Balance ${balance}`));
  assert.match(styles, /\.insights-account > \*\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/s);
  assert.match(styles, /\.insights-account > \*\s*\{[^}]*unicode-bidi: isolate;/s);
});

test('credit labels strip bidi controls and reject inherited status names', async () => {
  const payload = insightPayload();
  payload.account.credits.balance = 'A\u202eB\u202c\u2028C';
  payload.account.credits.status = 'constructor';
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.doesNotMatch(html, /[\u202e\u202c\u2028]/u);
  assert.match(html, /Credit status unavailable/);
  assert.doesNotMatch(html, /Credits available|Unlimited|No credits/);
});

test('daily insights accept canonical UTC day buckets only', async () => {
  const payload = insightPayload('7d');
  payload.summary.busiestDay = { available: true, day: '0', tokens: 100 };
  payload.daily = [
    { day: '0', reasoningShare: 0.1, averageTokensPerTurn: 10 },
    { day: '2026-07-11T12:00:00.000Z', reasoningShare: 0.2, averageTokensPerTurn: 20 },
    { day: '2026-07-12T00:00:00.000Z', reasoningShare: 0.3, averageTokensPerTurn: 30 },
  ];
  const { els } = await makeBrowser(async () => ({ ok: true, json: async () => payload }));
  const html = els['insights-surface'].innerHTML;
  assert.doesNotMatch(html, /class="insight-chart"/);
  assert.match(html, /Busiest day[\s\S]*Unavailable/);
  assert.doesNotMatch(html, /Jan 1/);
});

test('range update keeps prior values visible and a stale response cannot replace the newer choice', async () => {
  const pending24 = deferred();
  const pending30 = deferred();
  const browser = await makeBrowser(async (url, call) => {
    if (call === 1) return { ok: true, json: async () => insightPayload('7d') };
    if (url.includes('range=24h')) return pending24.promise;
    if (url.includes('range=30d')) return pending30.promise;
    throw new Error(`unexpected ${url}`);
  });
  const { els, buttons, range } = browser;
  const initialHtml = els['insights-surface'].innerHTML;
  range.onclick({ target: buttons[0] });
  assert.equal(els['insights-status'].textContent, 'Updating…');
  assert.equal(els['insights-surface'].innerHTML, initialHtml, 'prior values remain visible while updating');
  range.onclick({ target: buttons[2] });
  assert.equal(els['insights-range-copy'].textContent, 'last 30 days');
  const newest = insightPayload('30d');
  newest.summary.turns.averageTokens = 30000;
  pending30.resolve({ ok: true, json: async () => newest });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const newestHtml = els['insights-surface'].innerHTML;
  assert.match(newestHtml, />30k</);
  pending24.resolve({ ok: true, json: async () => {
    const old = insightPayload('24h');
    old.summary.turns.averageTokens = 24000;
    return old;
  } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(els['insights-surface'].innerHTML, newestHtml, 'late 24h response is ignored');
  assert.equal(buttons[2].attrs['aria-pressed'], 'true');
  assert.equal(buttons[0].attrs['aria-pressed'], 'false');
});

test('endpoint failure stays isolated to one explicit insight error', async () => {
  const { els } = await makeBrowser(async () => ({ ok: false, json: async () => ({}) }));
  assert.equal(els['insights-status'].textContent, 'Unavailable');
  assert.match(els['insights-surface'].innerHTML, /Codex insights are unavailable right now — account limits above are unaffected\./);
  assert.doesNotMatch(els['insights-surface'].innerHTML, /insights-summary/);
});

test('persistent timer retries preserve the error without repeated status announcements', async () => {
  const browser = await makeBrowser(async () => ({ ok: false, json: async () => ({}) }));
  const { els, intervals } = browser;
  const statusWrites = els['insights-status'].textHistory.length;
  const insightTimer = intervals.find(({ callback }) => String(callback).includes('fetchCodexInsights'));
  assert.ok(insightTimer, 'the quiet insight refresh timer is registered');
  insightTimer.callback();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(els['insights-status'].textHistory.length, statusWrites);
  assert.equal(els['insights-status'].textContent, 'Unavailable');
  assert.match(els['insights-surface'].innerHTML, /Codex insights are unavailable right now/);
});

test('responsive, focus, motion, and flat-surface contracts remain explicit', () => {
  assert.match(styles, /\.insight-surface\s*\{[^}]*border: 1px solid var\(--border\)[^}]*background: var\(--panel-soft\)/s);
  assert.doesNotMatch(styles, /\.insight-(?:metric|chart|mix-row)[^{]*\{[^}]*box-shadow/s);
  assert.match(styles, /@media \(max-width: 700px\)[\s\S]*?\.insights-summary\s*\{\s*grid-template-columns: repeat\(2/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.insights-detail-grid, \.insights-daily\s*\{\s*grid-template-columns: 1fr/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.insights-head/);
  assert.match(styles, /\.insights-account > \*\s*\{[^}]*min-width: 0;[^}]*overflow-wrap: anywhere;/s);
  assert.match(styles, /\.insight-metric-label\s*\{[^}]*color: var\(--muted\)/s);
  assert.match(styles, /\.insight-chart svg text\s*\{[^}]*fill: var\(--muted\)/s);
  assert.match(styles, /\.pill:focus-visible\s*\{[^}]*outline:/s);
  assert.match(styles, /\.insight-mini i\s*\{[^}]*transition: width 220ms cubic-bezier/s);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
