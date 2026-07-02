import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const pluginPath = path.join(here, '..', '..', 'scripts', 'menubar', 'llmdash.5s.js');
const fixturesDir = path.join(here, '..', 'fixtures', 'menubar');

// Rehydrate "@<ms>" timestamp placeholders relative to now (see the fixtures
// README) so freshness bands are deterministic.
export function rehydrate(v, now = Date.now()) {
  if (typeof v === 'string' && /^@-?\d+$/.test(v)) return new Date(now + Number(v.slice(1))).toISOString();
  if (Array.isArray(v)) return v.map((x) => rehydrate(x, now));
  if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = rehydrate(v[k], now); return o; }
  return v;
}
export function loadFixture(name, now = Date.now()) {
  return rehydrate(JSON.parse(fs.readFileSync(path.join(fixturesDir, `${name}.json`), 'utf8')), now);
}

// Start a loopback fixture server. Handler runs in THIS process, so the plugin
// must be spawned ASYNCHRONOUSLY (below) — a blocking spawnSync would freeze
// this event loop and the server could never accept the connection.
export function startServer(handler, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once('error', reject);
    server.listen(0, host, () => resolve({
      port: server.address().port,
      host,
      close: () => new Promise((r) => server.close(r)),
    }));
  });
}

// Run the plugin as SwiftBar does (a child process reading its env), async so
// the parent event loop stays live to serve the fixture server. Resolves with
// { status, stdout, stderr }.
export function runPlugin(env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [pluginPath], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}
