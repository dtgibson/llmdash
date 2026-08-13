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

test('semantic order is complete Capacity now, diagnostics, then local tool stories', () => {
  const limits = indexHtml.indexOf('id="single-limits"');
  const identity = indexHtml.indexOf('id="account-identity"');
  const tools = indexHtml.indexOf('id="tools"');
  const supplementary = indexHtml.indexOf('id="supplementary-limits"');
  const deviceHealth = indexHtml.indexOf('id="device-health"');
  const range = indexHtml.indexOf('id="details-heading"');
  const claude = indexHtml.indexOf('id="claude-tool-group"');
  const codex = indexHtml.indexOf('id="codex-tool-group"');
  const notes = indexHtml.indexOf('id="limit-notes"');
  const insights = indexHtml.indexOf('id="codex-insights"');
  const codexTrends = indexHtml.indexOf('id="codex-trends-title"');
  assert.ok(limits >= 0 && limits < identity && identity < tools && tools < supplementary
    && supplementary < deviceHealth && deviceHealth < notes && notes < range && range < claude && claude < codex
    && codex < insights && insights < codexTrends);
  assert.match(appJs, /accountView\.overview[\s\S]*multi-operational[\s\S]*accountView\.diagnostics[\s\S]*\+ cards/,
    'multi-host account facts and all operational summaries precede diagnostics and activity');
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
  assert.match(styles, /\.limit-card\s*\{[^}]*display: grid[^}]*grid-template-rows: 0\.75rem 3\.1rem 2\.1rem 7px 1rem[^}]*min-width: 0/s,
    'desktop cards reserve the same five reading rows');
  assert.match(styles, /\.limit-reset-compact\s*\{[^}]*white-space: nowrap/s,
    'the in-card reset value uses a bounded one-line grammar');
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.limit-card\.panel\s*\{[^}]*grid-template-rows: 0\.7rem 2\.35rem 1\.9rem 6px 0\.9rem[^}]*row-gap: 6px/s,
    '390px and 320px cards retain deterministic compact rows');
  assert.match(styles, /\.burn-cap\s*\{[^}]*overflow-wrap: anywhere/s,
    'full reset evidence may wrap in pacing without widening the viewport');
  assert.doesNotMatch(appJs, /win-reset|resetCountdownCopy|showProvenance/,
    'quota cards do not receive the former unbounded evidence formatter');
  assert.match(styles, /\.pill\s*\{[^}]*min-width: 32px[^}]*min-height: 32px/s,
    'range controls keep a 32px interaction floor');
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.model-limit-head/);
  assert.match(styles, /\.supplement-grid\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/s,
    'other global limits use the approved flat two-column desktop band');
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.supplement-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/,
    'the global-limit band stacks without horizontal scrolling on phones');
  assert.doesNotMatch(indexHtml, /data-control="(?:evidence|accounts|viewport|theme)"/,
    'prototype-only review controls do not ship');
  assert.match(styles, /@media \(prefers-color-scheme: dark\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /transition-duration: 0\.01ms !important/);
});

test('named phone and desktop geometry stays within the supported viewport', () => {
  const geometry = (viewport) => {
    const shell = Math.min(860, viewport - (viewport <= 620 ? 22 : 32));
    const limitsInner = shell - 2 * (viewport <= 620 ? 11 : 20);
    const lane = viewport <= 620 ? limitsInner : (limitsInner - 18) / 2;
    const card = (lane - (viewport <= 620 ? 8 : 10)) / 2;
    return { viewport, shell, limitsInner, lane, card };
  };
  assert.deepEqual(geometry(320), {
    viewport: 320, shell: 298, limitsInner: 276, lane: 276, card: 134,
  });
  assert.deepEqual(geometry(892), {
    viewport: 892, shell: 860, limitsInner: 820, lane: 401, card: 195.5,
  });
  for (const box of [geometry(320), geometry(892)]) {
    assert.ok(box.shell <= box.viewport && box.limitsInner <= box.shell
      && box.lane <= box.limitsInner && box.card <= box.lane);
  }
  assert.match(styles, /\* \{ box-sizing: border-box; \}/);
  assert.match(styles, /\.page-shell \{ width: min\(860px, calc\(100% - 32px\)\)/);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.page-shell \{ width: min\(100% - 22px, 860px\)/);
  assert.match(styles, /\.limit-tools \{[^}]*repeat\(2, minmax\(0, 1fr\)\)[^}]*min-width: 0/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.limit-tools \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.operational-grid \{[^}]*minmax\(0, 1\.35fr\)[^}]*min-width: 0/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.operational-grid \{ grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.health-history svg \{[^}]*width: 100%[^}]*height: auto/s);
  assert.doesNotMatch(styles, /\.health-history svg \{[^}]*min-width:/s);
});

test('device health is one responsive, reduced-motion-aware host-scoped band', () => {
  const healthSource = appJs.slice(appJs.indexOf('function deviceMetricAge'),
    appJs.indexOf('// The reset/billing view'));
  assert.match(appJs, /function deviceHealthHtml\(health, hostLabel\)/);
  assert.ok(appJs.indexOf("healthMetricHtml('cpu'") < appJs.indexOf("healthMetricHtml('ram'")
    && appJs.indexOf("healthMetricHtml('ram'") < appJs.indexOf("healthMetricHtml('disk'"));
  assert.match(styles, /\.health-band\s*\{[^}]*repeat\(3, minmax\(0, 1fr\)\)/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.health-band\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /\.health-bar-fill\s*\{[^}]*transition: width 220ms cubic-bezier\(\.2, \.8, \.2, 1\)/s);
  assert.doesNotMatch(healthSource, /healthy|overloaded|\bsafe\b/i);
});

test('Capacity now moves pacing beside bounded accessible host health history', () => {
  assert.match(indexHtml, /section-kicker">Capacity now<[\s\S]*Headroom, allowances, and machines/);
  assert.match(appJs, /function operationalHostHtml\(host, localResetSelection = null, chartIndex = 0\)/);
  assert.match(appJs, /function healthHistoryHtml\(health, hostLabel, chartIndex = 0\)/);
  assert.match(appJs, /slice\(-60\)/, 'renderer defensively bounds history');
  assert.match(appJs, /CPU used is a solid line with circle markers[\s\S]*RAM used is dashed with square markers[\s\S]*disk available is dotted with diamond markers/i);
  assert.match(appJs, /Null cells say|Not measured|Missing metrics were not measured/);
  assert.match(appJs, /Process lifetime · up to 60 samples/);
  assert.match(styles, /\.operational-grid\s*\{[^}]*grid-template-columns: minmax\(240px, \.8fr\) minmax\(0, 1\.35fr\)/s);
  assert.match(styles, /\.health-series-ram\s*\{[^}]*stroke-dasharray/s);
  assert.match(styles, /\.health-series-disk\s*\{[^}]*stroke-dasharray/s);
  assert.match(styles, /@media \(max-width: 620px\)[\s\S]*?\.operational-grid\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/);
});
