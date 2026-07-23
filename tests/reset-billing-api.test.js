import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-reset-api-'));
const dataDir = path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
fs.chmodSync(dataDir, 0o700);
process.env.LLMDASH_DATA_DIR = dataDir;
process.env.LLMDASH_CLAUDE_DIR = path.join(root, 'claude');
process.env.LLMDASH_CODEX_DIR = path.join(root, 'codex');
process.env.LLMDASH_CODEX_CMD = path.join(root, 'missing-codex');

const { server } = await import('../src/server.js');
const { isTrustedResetBillingAuthority } = await import('../src/reset-billing-api.js');
const { clearAccountConfigCache } = await import('../src/account-config.js');

let port;
test.before(async () => {
  clearAccountConfigCache();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    port = server.address().port;
    resolve();
  }));
});

function hit(target, { method = 'GET', headers = {}, body = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: target, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        buffer: Buffer.concat(chunks),
        text: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body !== null) req.end(body); else req.end();
  });
}

function writeHeaders(view, overrides = {}) {
  return {
    origin: `http://127.0.0.1:${port}`,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json; charset=utf-8',
    'x-llmdash-csrf': view.csrfToken,
    'if-match': view.etag,
    ...overrides,
  };
}

function requestBody(baseVersion = 0) {
  return JSON.stringify({
    schemaVersion: 1,
    baseVersion,
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    billingChanges: [{
      action: 'set', tool: 'claude', amountUsd: '100.00',
      effectiveDate: '2026-08-01', billingAnchorDay: 1, confirmed: true,
    }],
  });
}

test('trusted reset/billing authorities are anchored to the socket destination', () => {
  const req = (localAddress, localPort = 8787) => ({ socket: { localAddress, localPort } });
  const hostOptions = { machineHostname: 'Hephaestus.local', configuredHost: '0.0.0.0' };
  const trusted = (localAddress, authority, options = hostOptions) =>
    isTrustedResetBillingAuthority(req(localAddress), authority, options);

  assert.equal(trusted('127.0.0.1', 'localhost:8787'), true);
  assert.equal(trusted('::1', '[0:0:0:0:0:0:0:1]:8787'), true);
  assert.equal(trusted('192.168.0.110', '192.168.0.110:8787'), true);
  assert.equal(trusted('::ffff:192.168.0.110', '192.168.0.110:8787'), true);
  assert.equal(trusted('100.70.220.2', '100.70.220.2:8787'), true);
  assert.equal(trusted('192.168.0.110', 'hephaestus.local:8787'), true);
  assert.equal(trusted('192.168.0.110', 'HEPHAESTUS:8787'), true);
  assert.equal(trusted('192.168.0.110', 'dash.internal:8787', {
    machineHostname: 'Hephaestus.local', configuredHost: 'dash.internal',
  }), true);
  assert.equal(trusted('100.70.220.2', 'hephaestus.giraffe-chuckwalla.ts.net:8787'), true);
  assert.equal(trusted('100.70.220.2', 'renamed-node:8787'), true);
  assert.equal(trusted('fd7a:115c:a1e0::1a33:dc03', 'renamed.giraffe-chuckwalla.ts.net:8787'), true);

  assert.equal(trusted('192.168.0.110', 'rebind.attacker.example:8787'), false);
  assert.equal(trusted('192.168.0.110', 'hephaestus.giraffe-chuckwalla.ts.net:8787'), false);
  assert.equal(trusted('192.168.0.110', '192.168.0.111:8787'), false);
  assert.equal(trusted('192.168.0.110', 'localhost:8787'), false);
  assert.equal(trusted('192.168.0.110', '192.168.0.110:8788'), false);
  assert.equal(trusted('100.128.0.1', 'renamed.giraffe-chuckwalla.ts.net:8787'), false);
});

test('GET returns the bounded empty view, stable ETag, CSRF, paths, and six fixed links', async () => {
  const response = await hit('/api/config/reset-billing');
  assert.equal(response.status, 200);
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['access-control-allow-origin'], undefined);
  const view = JSON.parse(response.text);
  assert.equal(view.version, 0);
  assert.equal(view.sources.accountConfig.status, 'empty');
  assert.match(view.etag, /^"account-config-v1-0-/);
  assert.match(view.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Object.values(view.links).flatMap(Object.values).length, 6);
  assert.equal(view.paths.accountConfig, path.join(dataDir, 'account-config.json'));
});

test('same-origin CSRF/ETag PUT atomically saves one version and stale writes conflict', async () => {
  const initial = JSON.parse((await hit('/api/config/reset-billing')).text);
  const saved = await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(initial), body: requestBody(0),
  });
  assert.equal(saved.status, 200, saved.text);
  const view = JSON.parse(saved.text);
  assert.equal(view.version, 1);
  assert.equal(view.resetSchedule.localTime, '23:00');
  assert.equal(view.recurringPlans[0].amountCents, 10000);
  assert.notEqual(view.etag, initial.etag);
  assert.equal(fs.statSync(path.join(dataDir, 'account-config.json')).mode & 0o777, 0o600);

  const stale = await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(initial), body: requestBody(0),
  });
  assert.equal(stale.status, 412);
  assert.equal(JSON.parse(stale.text).currentVersion, 1);
});

test('untrusted Host cannot read config, tokens, resources, or write through a matching Origin', async () => {
  const authority = `rebind.attacker.example:${port}`;
  const blockedView = await hit('/api/config/reset-billing', { headers: { host: authority } });
  assert.equal(blockedView.status, 421);
  assert.deepEqual(JSON.parse(blockedView.text), { error: 'untrusted_host' });
  assert.doesNotMatch(blockedView.text, /csrfToken|etag|recurringPlans/);

  const blockedResource = await hit(
    '/api/config/reset-billing?resource=account-config&download=0',
    { headers: { host: authority } },
  );
  assert.equal(blockedResource.status, 421);

  const currentResponse = await hit('/api/config/reset-billing');
  const current = JSON.parse(currentResponse.text);
  const blockedWrite = await hit('/api/config/reset-billing', {
    method: 'PUT',
    headers: {
      ...writeHeaders(current), host: authority, origin: `http://${authority}`,
    },
    body: requestBody(current.version),
  });
  assert.equal(blockedWrite.status, 421);
  const after = JSON.parse((await hit('/api/config/reset-billing')).text);
  assert.equal(after.version, current.version);
  assert.equal(after.etag, current.etag);
});

test('PUT rejects foreign origins, bad CSRF, missing preconditions, duplicates, trailing data, and oversize bodies', async () => {
  const current = JSON.parse((await hit('/api/config/reset-billing')).text);
  const body = requestBody(current.version);
  assert.equal((await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(current, { origin: 'http://evil.example' }), body,
  })).status, 403);
  assert.equal((await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(current, { 'x-llmdash-csrf': 'wrong' }), body,
  })).status, 403);
  const missing = writeHeaders(current); delete missing['if-match'];
  assert.equal((await hit('/api/config/reset-billing', { method: 'PUT', headers: missing, body })).status, 428);

  const duplicate = `{"schemaVersion":1,"baseVersion":${current.version},"baseVersion":${current.version},"resetSchedule":null,"billingChanges":[]}`;
  assert.equal((await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(current), body: duplicate,
  })).status, 400);
  assert.equal((await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(current), body: `${body} true`,
  })).status, 400);
  assert.equal((await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(current), body: Buffer.alloc(32 * 1024 + 1, 0x20),
  })).status, 413);

  for (const malformed of ['true', '{"schemaVersion":1}']) {
    const response = await hit('/api/config/reset-billing', {
      method: 'PUT', headers: writeHeaders(current), body: malformed,
    });
    assert.equal(response.status, 422);
    assert.equal(JSON.parse(response.text).error, 'validation_failed');
  }
});

test('exact raw path/query/method matrix rejects nearby variants and preflight', async () => {
  assert.equal((await hit('/api/config/reset-billing', { method: 'HEAD' })).status, 405);
  assert.equal((await hit('/api/config/reset-billing', { method: 'OPTIONS' })).status, 405);
  assert.equal((await hit('/api/config/reset-billing/')).status, 404);
  assert.equal((await hit('/api/config/%72eset-billing')).status, 404);
  const bareGet = await hit('/api/config/reset-billing?');
  assert.equal(bareGet.status, 400);
  assert.deepEqual(JSON.parse(bareGet.text), { error: 'invalid_query' });
  assert.equal((await hit('/api/config/reset-billing?download=0&resource=account-config')).status, 400);
  assert.equal((await hit('/api/config/reset-billing?resource=unknown&download=0')).status, 400);
  assert.equal((await hit('/api/config/reset-billing?resource=account-config&download=0&x=1')).status, 400);
});

test('a bare query delimiter cannot write, while the exact no-query target still can', async () => {
  const currentResponse = await hit('/api/config/reset-billing');
  assert.equal(currentResponse.status, 200);
  const current = JSON.parse(currentResponse.text);
  const before = fs.readFileSync(path.join(dataDir, 'account-config.json'));
  const body = JSON.stringify({
    schemaVersion: 1,
    baseVersion: current.version,
    resetSchedule: current.resetSchedule,
    billingChanges: [{
      action: 'set', tool: 'codex', amountUsd: '20.00',
      effectiveDate: '2026-09-01', billingAnchorDay: 1, confirmed: true,
    }],
  });

  const rejected = await hit('/api/config/reset-billing?', {
    method: 'PUT', headers: writeHeaders(current), body,
  });
  assert.equal(rejected.status, 400);
  assert.deepEqual(JSON.parse(rejected.text), { error: 'invalid_query' });
  assert.deepEqual(fs.readFileSync(path.join(dataDir, 'account-config.json')), before);

  const unchanged = JSON.parse((await hit('/api/config/reset-billing')).text);
  assert.equal(unchanged.version, current.version);
  assert.equal(unchanged.etag, current.etag);

  const saved = await hit('/api/config/reset-billing', {
    method: 'PUT', headers: writeHeaders(current), body,
  });
  assert.equal(saved.status, 200, saved.text);
  const savedView = JSON.parse(saved.text);
  assert.equal(savedView.version, current.version + 1);
  assert.equal(savedView.recurringPlans.some((plan) => plan.tool === 'codex'), true);

  const refreshed = await hit('/api/config/reset-billing');
  assert.equal(refreshed.status, 200);
  assert.equal(JSON.parse(refreshed.text).version, savedView.version);
});

test('all three fixed resources use safe names and inline/download dispositions', async () => {
  fs.writeFileSync(path.join(dataDir, 'subscriptions.json'), JSON.stringify({
    schemaVersion: 1, currency: 'USD', subscriptions: [],
  }), { mode: 0o600 });
  const cases = [
    ['account-config', 'account-config.json'],
    ['subscriptions', 'subscriptions.json'],
    ['rate-card', 'api-rates.json'],
  ];
  for (const [resource, name] of cases) {
    const inline = await hit(`/api/config/reset-billing?resource=${resource}&download=0`);
    assert.equal(inline.status, 200, `${resource}: ${inline.text}`);
    assert.equal(inline.headers['content-disposition'], `inline; filename="${name}"`);
    assert.equal(Number(inline.headers['content-length']), inline.buffer.length);
    const download = await hit(`/api/config/reset-billing?resource=${resource}&download=1`);
    assert.equal(download.status, 200);
    assert.equal(download.headers['content-disposition'], `attachment; filename="${name}"`);
  }
});

test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
  clearAccountConfigCache();
  fs.rmSync(root, { recursive: true, force: true });
});
