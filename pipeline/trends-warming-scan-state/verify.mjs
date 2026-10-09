// Isolated HTTP/render smoke. No poller, providers, peers, live logs or devices.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

for (const key of Object.keys(process.env)) if (key.startsWith('LLMDASH_')) delete process.env[key];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-warming-verify-'));
for (const name of ['data', 'claude/projects', 'codex/sessions']) fs.mkdirSync(path.join(temporary, name), { recursive: true });
fs.writeFileSync(path.join(temporary, 'data/hosts.conf'), '');
Object.assign(process.env, {
  LLMDASH_HOST: '127.0.0.1', LLMDASH_PORT: '0', LLMDASH_HOSTS: '',
  LLMDASH_DATA_DIR: path.join(temporary, 'data'), LLMDASH_CLAUDE_DIR: path.join(temporary, 'claude'),
  LLMDASH_CODEX_DIR: path.join(temporary, 'codex'), LLMDASH_CLAUDE_AUTOREFRESH: '0',
  LLMDASH_CLAUDE_CMD: '/usr/bin/false', LLMDASH_CODEX_CMD: '/usr/bin/false',
});
const { server } = await import('../../src/server.js');
const { refreshCodexAnalytics, refreshCodexAnalyticsAsync } = await import('../../src/codex-stats.js');
const { refreshClaudeTrendsAsync } = await import('../../src/trends.js');
const { scanCodexRolloutsSteps } = await import('../../src/codex-events.js');
const { getDb } = await import('../../src/db.js');
const now = Date.now(), sessions = path.join(temporary, 'codex/sessions');
const app = fs.readFileSync(fileURLToPath(new URL('../../public/app.js', import.meta.url)), 'utf8');
const get = route => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port: server.address().port, path: route }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => body += chunk);
    response.on('end', () => {
      try {
        assert.equal(response.statusCode, 200);
        assert.equal(response.headers['cache-control'], 'no-store');
        resolve(JSON.parse(body));
      } catch (error) { reject(error); }
    });
  });
  request.on('error', reject);
});

async function observe(phase) {
  const [state, insights, trends] = await Promise.all([
    get('/api/state'), get('/api/codex-insights?range=7d'), get('/api/trends?range=7d'),
  ]);
  const tool = state.tools.find(t => t.source === 'codex');
  const trend = trends.tools.find(t => t.source === 'codex');
  const element = () => ({ innerHTML: '', textContent: '', setAttribute() {}, addEventListener() {}, querySelectorAll: () => [] });
  const elements = Object.fromEntries(['tools', 'hosts', 'headroom', 'freshness', 'age',
    'insights-surface', 'insights-status', 'trends-codex'].map(id => [id, element()]));
  const sandbox = {
    tool, console, document: { getElementById: id => elements[id] || null,
      querySelector: selector => selector === 'footer' ? { querySelectorAll: () => [] } : null },
    fetch: async route => ({ ok: true, json: async () => String(route).startsWith('/api/codex-insights') ? insights
      : String(route).startsWith('/api/trends') ? trends : { hosts: [], generatedAt: state.generatedAt } }),
    setInterval() { return 0; }, setTimeout() { return 0; }, clearTimeout() {}, queueMicrotask,
  };
  vm.createContext(sandbox);
  vm.runInContext(app, sandbox);
  await vm.runInContext('fetchTrends()', sandbox);
  await vm.runInContext('fetchCodexInsights({ announce: false })', sandbox);
  const rendered = {
    activity: vm.runInContext('toolCoreHtml(tool, undefined, undefined, null, false)', sandbox),
    insights: elements['insights-surface'].innerHTML, trends: elements['trends-codex'].innerHTML,
  };
  const row = { phase, scanState: tool.activity.scanState, activityState: trend.activityState,
    hasData: tool.activity.hasData, weekTokens: tool.activity.tokens.week,
    generatedAt: tool.activity.generatedAt, insightGeneratedAt: insights.generatedAt,
    trendActivityGeneratedAt: trend.activityGeneratedAt, rendered };
  assert.equal(insights.scanState, row.scanState);
  assert.equal(trend.activityState, row.scanState);
  assert.doesNotMatch(JSON.stringify({ state, insights, trends }), /llmdash-warming-verify-|rollout-private|sessionKey|turnKey/);
  return row;
}
const errorCopy = /local Codex session logs could not be read/;
function assertError(row, hasData = false) {
  assert.equal(row.scanState, 'error');
  assert.equal(row.hasData, hasData);
  for (const html of Object.values(row.rendered)) {
    assert.match(html, errorCopy);
    assert.doesNotMatch(html, /Reading this machine|Reading local Codex|No supported Codex activity|No Codex sessions/);
  }
}
const token = n => JSON.stringify({ type: 'event_msg', timestamp: new Date(now - 1000).toISOString(),
  payload: { type: 'token_count', info: { last_token_usage: { input_tokens: n, cached_input_tokens: 40, output_tokens: 10 } } } }) + '\n';

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const rows = [];
  const cold = await observe('cold'); rows.push(cold);
  assert.equal(cold.scanState, 'warming');
  assert.match(cold.rendered.insights, /Reading local Codex session metadata/);
  fs.rmdirSync(sessions); fs.writeFileSync(sessions, 'invalid synthetic root');
  assert.equal(refreshCodexAnalytics(now), false);
  const failed = await observe('cold-failure'); rows.push(failed); assertError(failed);
  assert.equal(failed.generatedAt, null);
  assert.equal(refreshCodexAnalytics(now + 1), false);
  const persistent = await observe('persistent-failure'); rows.push(persistent); assertError(persistent);
  let retrySettled = false, releaseRetry = false;
  const retry = refreshCodexAnalyticsAsync(now + 2, {
    pacer: { due: () => true, resume() {} },
    scanSteps: function *slowScan(since, options) {
      for (let i = 0; !releaseRetry && i < 10_000; i++) yield;
      assert.equal(releaseRetry, true, 'HTTP observation must run before retry completes');
      return yield* scanCodexRolloutsSteps(since, options);
    },
  }).then(ok => { retrySettled = true; return ok; });
  const inFlight = await observe('retry-in-flight'); rows.push(inFlight); assertError(inFlight);
  assert.equal(retrySettled, false);
  releaseRetry = true;
  assert.equal(await retry, false);
  fs.unlinkSync(sessions);
  assert.equal(refreshCodexAnalytics(now + 3), true);
  await refreshClaudeTrendsAsync(now + 3);
  const missing = await observe('missing-root-success'); rows.push(missing);
  assert.equal(missing.scanState, 'ready'); assert.equal(missing.hasData, false);
  assert.match(missing.rendered.activity, /No Codex sessions/);
  assert.match(missing.rendered.insights, /No supported Codex activity/);
  fs.mkdirSync(sessions);
  assert.equal(refreshCodexAnalytics(now + 4), true);
  const empty = await observe('empty-tree-success'); rows.push(empty);
  assert.equal(empty.scanState, 'ready'); assert.equal(empty.hasData, false);
  const file = path.join(sessions, 'rollout-private-fixture.jsonl');
  fs.writeFileSync(file, token(100));
  assert.equal(refreshCodexAnalytics(now + 5), true);
  const good = await observe('published'); rows.push(good);
  assert.equal(good.weekTokens, 110);
  assert.match(good.rendered.activity, /stat-grid/);
  assert.match(good.rendered.trends, /Tokens per day/);
  assert.match(good.rendered.trends, /<svg/);
  fs.renameSync(sessions, sessions + '-saved'); fs.writeFileSync(sessions, 'invalid synthetic root');
  assert.equal(refreshCodexAnalytics(now + 6), false);
  const transient = await observe('last-good-failure'); rows.push(transient); assertError(transient, true);
  for (const key of ['weekTokens', 'generatedAt', 'insightGeneratedAt', 'trendActivityGeneratedAt']) assert.equal(transient[key], good[key]);
  assert.match(transient.rendered.activity, /stat-grid/);
  assert.match(transient.rendered.trends, /Tokens per day/);
  assert.match(transient.rendered.insights, /insights-summary/);
  fs.unlinkSync(sessions); fs.renameSync(sessions + '-saved', sessions);
  assert.equal(refreshCodexAnalytics(now + 7), true);
  const recovered = await observe('recovered'); rows.push(recovered);
  assert.equal(recovered.scanState, 'ready'); assert.equal(recovered.weekTokens, 110);
  assert.notEqual(recovered.generatedAt, good.generatedAt);
  for (const html of Object.values(recovered.rendered)) assert.doesNotMatch(html, errorCopy);
  const report = { verifiedAt: new Date().toISOString(), nodeVersion: process.version,
    isolation: { inheritedLlmdashVariablesCleared: true, temporaryRoots: true, hostsConfEmpty: true,
      listener: '127.0.0.1:ephemeral', pollerStarted: false, autoRefreshDisabled: true,
      cliCommands: '/usr/bin/false', liveLogs: false, peers: false, physicalDevices: false },
    phases: rows.map(({ rendered, ...row }) => ({ ...row, renderChecksPassed: true })) };
  fs.writeFileSync(fileURLToPath(new URL('./verification.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ phases: rows.length, httpRequests: rows.length * 3,
    realScanner: true, activityInsightsTrendRenderPassed: true }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  getDb().close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
