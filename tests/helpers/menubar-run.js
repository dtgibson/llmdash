import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
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
// { status, stdout, stderr }. `entry` overrides the script path passed as
// argv[1] (default: the real plugin path) — used to exercise symlink invocation.
export function runPlugin(env = {}, entry = pluginPath) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [entry], {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

// Run the plugin through a SYMLINK entry (how SwiftBar actually invokes it:
// setup-badge symlinks the plugin into SwiftBar's plugin dir). Regression guard
// for the ESM run-guard, which must de-symlink argv[1] or main() never fires.
export function runPluginViaSymlink(env = {}) {
  const linkDir = fs.mkdtempSync(path.join(os.tmpdir(), 'llmdash-badge-link-'));
  const link = path.join(linkDir, 'llmdash.5s.js');
  fs.symlinkSync(pluginPath, link);
  return runPlugin(env, link).finally(() => fs.rmSync(linkDir, { recursive: true, force: true }));
}
