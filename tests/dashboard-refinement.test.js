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

test('semantic order is limits, shared range, Claude story, then Codex story', () => {
  const limits = indexHtml.indexOf('id="single-limits"');
  const range = indexHtml.indexOf('id="details-heading"');
  const claude = indexHtml.indexOf('id="claude-tool-group"');
  const codex = indexHtml.indexOf('id="codex-tool-group"');
  const notes = indexHtml.indexOf('id="limit-notes"');
  const insights = indexHtml.indexOf('id="codex-insights"');
  const codexTrends = indexHtml.indexOf('id="codex-trends-title"');
  assert.ok(limits >= 0 && limits < notes && notes < range && range < claude && claude < codex && codex < insights && insights < codexTrends);
  assert.match(appJs, /<div class="limit-tools">\$\{lanes\.join\(''\)\}<\/div>`\s*\+ `<div class="limit-notes">/,
    'multi-host diagnostics also follow the complete limits grid');
  assert.match(indexHtml, /aria-labelledby="claude-details-title"[\s\S]*id="claude-details-title"/);
  assert.match(indexHtml, /aria-labelledby="codex-details-title"[\s\S]*id="codex-details-title"/);
  assert.doesNotMatch(styles, /\border\s*:/, 'CSS never visually reorders supporting content ahead of limits');
});

test('Codex short-window absence has a fixed unavailable slot, not a percentage gauge', () => {
  assert.match(appJs, /codexShort[\s\S]*No short-window reading/);
  assert.doesNotMatch(appJs, /limit-card[^`]*aria-label/, 'visible card copy is not duplicated through a generic-container label');
  assert.match(appJs, /limit-unavailable">Unavailable/);
  assert.match(appJs, /unavailable-rule/);
});

test('range controls, narrow reflow, themes, and reduced motion stay explicit', () => {
  assert.match(indexHtml, /data-range="7d" aria-pressed="true"/);
  assert.match(appJs, /setAttribute\('aria-pressed', String\(selected\)\)/);
  assert.match(styles, /\.pill:focus-visible\s*\{[^}]*outline:/s);
  assert.match(styles, /\.pill:active\s*\{[^}]*box-shadow:/s);
  assert.match(styles, /\.limit-tools\s*\{[^}]*grid-template-columns: repeat\(2/s, 'desktop compares both tool lanes');
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.limit-tools\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/,
    'tool lanes stack on compact screens');
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.window-grid, \.gauges\.window-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s,
    'each compact tool lane retains two windows');
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.page-shell\s*\{[^}]*100% - 22px/s, '320px uses bounded phone gutters');
  assert.match(styles, /\.limit-card\s*\{[^}]*min-width: 0/s);
  assert.match(styles, /\.limit-card \.win-reset\s*\{[^}]*white-space: normal[^}]*overflow-wrap: anywhere/s,
    'reset copy can wrap at narrow desktop and mobile widths');
  assert.match(styles, /\.pill\s*\{[^}]*min-width: 32px[^}]*min-height: 32px/s,
    'range controls keep a 32px interaction floor');
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.model-limit-head/);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});
