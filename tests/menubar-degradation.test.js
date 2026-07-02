import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchState, emit, FETCH_TIMEOUT_MS } from '../scripts/menubar/llmdash.5s.js';
import { startServer, runPlugin } from './helpers/menubar-run.js';

// A slow or unreachable dashboard must NEVER hang the menu bar and must NEVER
// fabricate a number: every failure mode lands on the offline glyph, exit 0.
// These drive the REAL http.get path against a scratch loopback fixture server
// — the spike's harness, in the test suite. The plugin is spawned ASYNC so this
// event loop stays live to serve (and to actually deliver the non-200 / bad
// body, rather than every case degenerating to the timeout path).
const here = path.dirname(fileURLToPath(import.meta.url));
const OFFLINE_TITLE = '▪ llmdash ⚠ | color=#8b8b8b';
const firstLine = (out) => out.split('\n')[0];

test('non-200 → offline glyph, exit 0, no number', async () => {
  let hit = false;
  const srv = await startServer((req, res) => { hit = true; res.writeHead(500); res.end('error'); });
  const r = await runPlugin({ LLMDASH_BADGE_HOST: '127.0.0.1', LLMDASH_PORT: String(srv.port) });
  await srv.close();
  assert.ok(hit, 'the 500 handler actually ran (not a timeout in disguise)');
  assert.equal(r.status, 0);
  assert.equal(firstLine(r.stdout), OFFLINE_TITLE);
  assert.doesNotMatch(r.stdout, /\d+%/);
});

test('malformed JSON body → offline glyph, exit 0, no number', async () => {
  const badBody = fs.readFileSync(path.join(here, 'fixtures', 'menubar', 'harness-badjson-body.txt'), 'utf8');
  let hit = false;
  const srv = await startServer((req, res) => {
    hit = true;
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(badBody);
  });
  const r = await runPlugin({ LLMDASH_BADGE_HOST: '127.0.0.1', LLMDASH_PORT: String(srv.port) });
  await srv.close();
  assert.ok(hit, 'the 200-with-bad-body handler actually ran');
  assert.equal(r.status, 0);
  assert.equal(firstLine(r.stdout), OFFLINE_TITLE);
  assert.doesNotMatch(r.stdout, /\d+%/);
});

test('connection refused (nothing listening) → offline glyph, exit 0', async () => {
  // Bind and immediately release a port so nothing is listening on it.
  const srv = await startServer((req, res) => res.end());
  const deadPort = srv.port;
  await srv.close();
  const r = await runPlugin({ LLMDASH_BADGE_HOST: '127.0.0.1', LLMDASH_PORT: String(deadPort) });
  assert.equal(r.status, 0);
  assert.equal(firstLine(r.stdout), OFFLINE_TITLE);
  assert.doesNotMatch(r.stdout, /\d+%/);
});

test('a hung server is bounded by FETCH_TIMEOUT_MS → rejects, never hangs', async () => {
  // The handler never responds; fetchState must reject within the timeout. Run
  // in-process (fetchState is pure of the child) so the hung server and the
  // fetch share this live event loop.
  const srv = await startServer(() => { /* intentionally no response */ });
  const t0 = Date.now();
  await assert.rejects(fetchState('127.0.0.1', srv.port));
  const elapsed = Date.now() - t0;
  await srv.close();
  assert.ok(elapsed < FETCH_TIMEOUT_MS + 1500, `fetch took ${elapsed}ms, expected ≲ ${FETCH_TIMEOUT_MS}ms`);
});

test('the offline output still offers the actions against the configured host:port', () => {
  const out = emit(null, { host: '100.64.0.9', port: '9999', offline: true });
  assert.match(out, /Dashboard offline — no server on 100\.64\.0\.9:9999/);
  assert.match(out, /Open dashboard \| href=http:\/\/100\.64\.0\.9:9999\//);
});
