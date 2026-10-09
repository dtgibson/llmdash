// Evaluation only: isolated fixtures and ephemeral loopback; no poller, peers,
// provider commands, live logs, or production process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

for (const key of Object.keys(process.env)) if (key.startsWith('LLMDASH_')) delete process.env[key];
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-warming-evaluation-'));
for (const directory of ['data', 'claude/projects', 'codex/sessions']) {
  fs.mkdirSync(path.join(temporary, directory), { recursive: true });
}
fs.writeFileSync(path.join(temporary, 'data/hosts.conf'), '');
Object.assign(process.env, {
  LLMDASH_HOST: '127.0.0.1', LLMDASH_PORT: '0', LLMDASH_HOSTS: '',
  LLMDASH_DATA_DIR: path.join(temporary, 'data'),
  LLMDASH_CLAUDE_DIR: path.join(temporary, 'claude'),
  LLMDASH_CODEX_DIR: path.join(temporary, 'codex'),
  LLMDASH_CLAUDE_AUTOREFRESH: '0',
  LLMDASH_CLAUDE_CMD: '/usr/bin/false', LLMDASH_CODEX_CMD: '/usr/bin/false',
});
const { server } = await import('../../src/server.js');
const { buildTrends, refreshClaudeTrendsAsync } = await import('../../src/trends.js');
const { refreshCodexAnalytics, computeCodexActivity, getCodexInsights } = await import('../../src/codex-stats.js');
const { getDb } = await import('../../src/db.js');
const now = Date.now();
const sessions = path.join(temporary, 'codex/sessions');
const db = getDb();
const originalPrepare = db.prepare;
let seriesQueries = 0;
db.prepare = function(sql, ...args) {
  if (sql.includes('captured_at >= ?')) seriesQueries++;
  return originalPrepare.call(this, sql, ...args);
};
const briefState = () => ({
  activity: { hasData: computeCodexActivity().hasData, generatedAt: computeCodexActivity().generatedAt,
    weekTokens: computeCodexActivity().tokens.week },
  insights: { hasData: getCodexInsights().hasData, generatedAt: getCodexInsights().generatedAt },
  trends: buildTrends('7d', now).tools.map(t => ({ source: t.source, activityState: t.activityState, dailyRows: t.daily.length })),
});
function repeatTrends(phase) {
  const observations = [];
  for (const range of ['24h', '7d', '30d']) {
    const before = seriesQueries;
    const answers = [0, 1, 2].map(offset => buildTrends(range, now + offset));
    observations.push({ phase, range, requests: answers.length, seriesQueries: seriesQueries - before,
      reusedAnswer: answers[0] === answers[1],
      generatedAtChanged: answers[0].generatedAt !== answers[1].generatedAt });
    assert.equal(answers[0] === answers[1], false);
    assert.equal(seriesQueries - before, 12);
  }
  return observations;
}
const get = route => new Promise((resolve, reject) => {
  const request = http.get({ host: '127.0.0.1', port: server.address().port, path: route }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => body += chunk);
    response.on('end', () => resolve({ status: response.statusCode, payload: JSON.parse(body) }));
  });
  request.on('error', reject);
});
const app = fs.readFileSync(fileURLToPath(new URL('../../public/app.js', import.meta.url)), 'utf8');
const insightRender = app.slice(app.indexOf('function renderCodexInsights('), app.indexOf('function renderCodexInsightsError('));
function insightText(data) {
  const surface = { innerHTML: '', setAttribute() {} };
  vm.runInNewContext(insightRender + '\nrenderCodexInsights(data, false);', {
    data, insightAccountHtml: () => '', document: { getElementById: id => id === 'insights-surface' ? surface : null },
  });
  return surface.innerHTML;
}

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const repeats = repeatTrends('both-cold');
  const initial = briefState();
  fs.rmdirSync(sessions);
  fs.writeFileSync(sessions, 'evaluation fixture: invalid sessions root');
  const failedAttempts = [refreshCodexAnalytics(now), refreshCodexAnalytics(now + 1)];
  assert.deepEqual(failedAttempts, [false, false]);
  const coldFailure = briefState();
  const failedInsights = await get('/api/codex-insights?range=7d');
  const failedTrends = await get('/api/trends?range=7d');
  assert.equal(failedInsights.status, 200);
  assert.equal(failedTrends.status, 200);
  assert.equal(coldFailure.activity.generatedAt, null);
  assert.equal(coldFailure.insights.generatedAt, null);
  assert.equal(coldFailure.trends.find(t => t.source === 'codex').activityState, 'warming');
  const renderedColdFailure = insightText(failedInsights.payload);
  assert.match(renderedColdFailure, /Reading local Codex session metadata/);

  fs.unlinkSync(sessions);
  fs.mkdirSync(sessions);
  const rollout = path.join(sessions, 'rollout-evaluation.jsonl');
  fs.writeFileSync(rollout, JSON.stringify({ type: 'event_msg', timestamp: new Date(now - 1000).toISOString(),
    payload: { type: 'token_count', info: { last_token_usage: {
      input_tokens: 100, cached_input_tokens: 40, output_tokens: 10,
    } } } }) + '\n');
  assert.equal(refreshCodexAnalytics(now + 2), true);
  assert.equal(computeCodexActivity().tokens.week, 110);
  const firstGood = briefState();
  repeats.push(...repeatTrends('claude-cold-codex-ready'));
  fs.renameSync(sessions, sessions + '-saved');
  fs.writeFileSync(sessions, 'evaluation fixture: invalid sessions root');
  assert.equal(refreshCodexAnalytics(now + 3), false);
  const transientFailure = briefState();
  assert.deepEqual(transientFailure, firstGood, 'last-good data survives, but no failure is exposed');
  fs.unlinkSync(sessions);
  fs.renameSync(sessions + '-saved', sessions);
  assert.equal(refreshCodexAnalytics(now + 4), true);
  const recovered = briefState();
  assert.equal(recovered.activity.weekTokens, 110);
  assert.notEqual(recovered.activity.generatedAt, firstGood.activity.generatedAt);
  assert.equal(await refreshClaudeTrendsAsync(now + 4), true);
  const ready = buildTrends('7d', now + 4);
  const readyAgain = buildTrends('7d', now + 5);
  assert.equal(ready, readyAgain, 'positive control: ready answers are cached');

  const report = {
    recordedAt: new Date().toISOString(), nodeVersion: process.version,
    confirmed: { warmingAnswersUncached: true, coldScanFailuresStillRenderReading: true,
      lastGoodDataRetained: true, recoveryWorks: true, readyAnswersCached: true },
    isolation: { inheritedLlmdashVariablesCleared: true, temporaryTrees: true, hostsConfEmpty: true,
      loopbackOnly: true, ephemeralPort: true, pollerStarted: false, autoRefreshDisabled: true,
      cliCommands: '/usr/bin/false', liveLogsRead: false, peerRequests: false },
    repeats, initial, failedAttempts, coldFailure,
    failedHttp: { insightsStatus: failedInsights.status, trendsStatus: failedTrends.status },
    renderedColdFailure, firstGood, transientFailure, recovered,
  };
  fs.writeFileSync(fileURLToPath(new URL('./evaluation.json', import.meta.url)), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ confirmed: report.confirmed, repeatCases: repeats.length,
    uncachedSeriesQueries: repeats.reduce((total, row) => total + row.seriesQueries, 0) }));
} finally {
  db.prepare = originalPrepare;
  if (server.listening) await new Promise(resolve => server.close(resolve));
  db.close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
