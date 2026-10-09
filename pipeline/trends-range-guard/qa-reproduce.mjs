// Evaluation-only reproduction: development Mac, ephemeral loopback listener,
// temporary snapshot/log trees, no poller or provider/peer process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

for (const key of Object.keys(process.env)) {
  if (key.startsWith('LLMDASH_')) delete process.env[key];
}
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-range-evaluation-'));
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
const { refreshCodexAnalytics } = await import('../../src/codex-stats.js');
const { getDb, insertSnapshot } = await import('../../src/db.js');
const now = Date.now();
for (const source of ['claude-code', 'codex']) {
  for (const window of ['five_hour', 'seven_day']) {
    for (const ageDays of [40, 20, 3, 0.5]) {
      insertSnapshot({ capturedAt: new Date(now - ageDays * 86400000).toISOString(),
        source, window, usedPct: 25, resetsAt: null });
    }
  }
}

const cases = [undefined, '', '24h', '7d', '30d', 'bogus', '7D', 'constructor',
  'toString', '__proto__', 'hasOwnProperty', '__defineGetter__', 'valueOf'];
const observations = [];
const hit = (range, method = 'GET') => new Promise((resolve, reject) => {
  const route = '/api/trends' + (range === undefined ? '' : '?range=' + encodeURIComponent(range));
  const request = http.request({ host: '127.0.0.1', port: server.address().port,
    path: route, method }, response => {
    let body = '';
    response.setEncoding('utf8');
    response.on('data', chunk => body += chunk);
    response.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); } catch {}
      resolve({ route, method, status: response.statusCode,
        contentType: response.headers['content-type'] ?? null,
        cacheControl: response.headers['cache-control'] ?? null,
        nosniff: response.headers['x-content-type-options'] ?? null,
        body: payload ? { range: payload.range, tools: payload.tools.map(tool => ({
          source: tool.source, activityState: tool.activityState, dailyRows: tool.daily.length,
          fiveHourRows: tool.limits.five_hour.length, sevenDayRows: tool.limits.seven_day.length,
        })) } : body });
    });
  });
  request.on('error', reject);
  request.end();
});

try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  for (const phase of ['cold', 'published-empty']) {
    if (phase === 'published-empty') {
      assert.equal(await refreshClaudeTrendsAsync(now), true);
      assert.equal(refreshCodexAnalytics(now, () => ({ usage: [], completions: [],
        compactions: [], tools: [], capabilities: {} })), true);
    }
    for (const range of cases) {
      const result = await hit(range);
      observations.push({ phase, ...result });
      if ([undefined, '', '24h', '7d', '30d', 'bogus', '7D'].includes(range)) {
        const expectedRange = ['24h', '7d', '30d'].includes(range) ? range : '7d';
        assert.equal(result.status, 200);
        assert.equal(result.body.range, expectedRange);
        for (const tool of result.body.tools) {
          assert.equal(tool.fiveHourRows, { '24h': 1, '7d': 2, '30d': 3 }[expectedRange]);
          assert.equal(tool.sevenDayRows, tool.fiveHourRows);
          assert.equal(tool.activityState, phase === 'cold' ? 'warming' : 'ready');
        }
      }
    }
    for (const range of ['constructor', '30d']) observations.push({ phase, ...await hit(range, 'HEAD') });
    for (const range of ['constructor', 'toString', '__proto__', 'bogus', undefined]) {
      try {
        const value = buildTrends(range, now);
        observations.push({ phase, directRange: range ?? '(omitted)', returnedRange: value.range });
      } catch (error) {
        observations.push({ phase, directRange: range, error: error.name + ': ' + error.message });
      }
    }
  }
  const report = { recordedAt: new Date().toISOString(), nodeVersion: process.version,
    confirmedBug: observations.filter(item => item.status === 500).length > 0,
    isolation: { loopbackOnly: true, ephemeralPort: true, temporaryData: true,
      inheritedLlmdashVariablesCleared: true, hostsConfEmpty: true,
      pollerStarted: false, autoRefreshDisabled: true, cliCommands: '/usr/bin/false' },
    observations };
  fs.writeFileSync(fileURLToPath(new URL('./qa-reproduction.json', import.meta.url)),
    JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ confirmedBug: report.confirmedBug,
    http500s: observations.filter(item => item.status === 500).length,
    http200s: observations.filter(item => item.status === 200).length,
    directErrors: observations.filter(item => item.error).length,
    observations: observations.length }));
} finally {
  if (server.listening) await new Promise(resolve => server.close(resolve));
  getDb().close();
  fs.rmSync(temporary, { recursive: true, force: true });
}
