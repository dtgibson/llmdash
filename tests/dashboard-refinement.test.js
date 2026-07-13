import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const appJs = fs.readFileSync(path.join(root, 'public', 'app.js'), 'utf8');

test('dashboard presentation uses classes; inline styles are data-driven widths only', () => {
  assert.doesNotMatch(indexHtml, /\sstyle=/, 'static dashboard markup has no inline presentation styles');
  const inlineStyles = [...appJs.matchAll(/style="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(inlineStyles.length > 0, 'dynamic meter widths remain explicit');
  assert.ok(inlineStyles.every((value) => value.startsWith('width:')), 'only data-driven widths use inline style');
  assert.doesNotMatch(appJs, /style="background:/, 'chart legend colors are class-based');
});

test('dashboard hierarchy keeps gauges elevated and supporting layers quiet', () => {
  assert.match(styles, /radial-gradient\(/, 'the page has the approved atmospheric background');
  assert.match(styles, /\.tool::before\s*\{[^}]*background: var\(--tool-color\)/s, 'tool sections use a tinted rail');
  assert.match(styles, /\.panel\s*\{[^}]*box-shadow: var\(--gauge-shadow\)/s, 'gauges retain the primary elevation');
  assert.match(styles, /\.tile\s*\{[^}]*border: 0/s, 'activity tiles do not become nested cards');
  assert.match(styles, /\.host \.tool\s*\{[^}]*border: 0/s, 'host hierarchy does not add nested tool borders');
  assert.match(appJs, /'◆'.*'▲'/, 'Claude and Codex keep the approved identity marks');
});

test('range controls, narrow reflow, themes, and reduced motion stay explicit', () => {
  assert.match(indexHtml, /data-range="7d" aria-pressed="true"/);
  assert.match(appJs, /setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(styles, /\.pill:focus-visible\s*\{[^}]*outline:/s);
  assert.match(styles, /\.pill:active\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.gauges\s*\{\s*grid-template-columns: 1fr;/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.model-limit-head/);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});
