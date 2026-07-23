import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const indexHtml = fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8');
const settingsHtml = fs.readFileSync(path.join(root, 'public', 'settings.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'public', 'settings.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'public', 'styles.css'), 'utf8');
const accountConfigJs = fs.readFileSync(path.join(root, 'src', 'account-config.js'), 'utf8');

const LINKS = {
  accountConfig: {
    view: '/api/config/reset-billing?resource=account-config&download=0',
    download: '/api/config/reset-billing?resource=account-config&download=1',
  },
  subscriptions: {
    view: '/api/config/reset-billing?resource=subscriptions&download=0',
    download: '/api/config/reset-billing?resource=subscriptions&download=1',
  },
  rateCard: {
    view: '/api/config/reset-billing?resource=rate-card&download=0',
    download: '/api/config/reset-billing?resource=rate-card&download=1',
  },
};

function relativeLuminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => Number.parseInt(part, 16) / 255);
  const linear = channels.map((value) => (value <= 0.04045
    ? value / 12.92
    : ((value + 0.055) / 1.055) ** 2.4));
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

function view(overrides = {}) {
  return {
    schemaVersion: 1,
    version: 3,
    etag: '"account-config-v1-3-test"',
    csrfToken: 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG',
    resetSchedule: null,
    recurringPlans: [],
    resetSelection: {
      source: 'unavailable', nextResetAt: null, liveStatus: 'missing',
      configuredStatus: 'missing', corroboratedByModelCap: false,
    },
    sources: {
      accountConfig: { status: 'current', reason: null },
      subscriptions: { status: 'valid', reason: null },
    },
    paths: {
      accountConfig: '/safe/data/account-config.json',
      subscriptions: '/safe/data/subscriptions.json',
      rateCard: '/safe/app/config/api-rates.json',
    },
    links: LINKS,
    ...overrides,
  };
}

function classList() {
  const values = new Set();
  return {
    add(...names) { names.forEach((name) => values.add(name)); },
    remove(...names) { names.forEach((name) => values.delete(name)); },
    toggle(name, force) {
      if (force === undefined) force = !values.has(name);
      force ? values.add(name) : values.delete(name);
      return force;
    },
    contains(name) { return values.has(name); },
  };
}

function fakeElement(id = '', tag = 'div') {
  const attrs = new Map();
  const listeners = new Map();
  const children = [];
  const el = {
    id, tagName: tag.toUpperCase(), hidden: false, disabled: false, checked: false,
    value: '', textContent: '', className: '', classList: classList(), children,
    firstChild: { textContent: '' }, options: [], href: '',
    addEventListener(type, handler) { listeners.set(type, handler); this[`on${type}`] = handler; },
    setAttribute(name, value) { attrs.set(name, String(value)); if (name === 'href') this.href = String(value); },
    getAttribute(name) { return attrs.get(name) ?? null; },
    removeAttribute(name) { attrs.delete(name); if (name === 'href') this.href = ''; },
    append(...nodes) { children.push(...nodes); if (!this.firstChild && nodes.length) this.firstChild = nodes[0]; },
    focus() { this.focused = true; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  return el;
}

function stateResponse(payload, { contentLength = null } = {}) {
  const body = JSON.stringify(payload);
  return {
    ok: true,
    status: 200,
    headers: {
      get(name) {
        return name.toLowerCase() === 'content-length' ? contentLength : null;
      },
    },
    text: async () => body,
  };
}

function renderedText(node) {
  return `${node && node.textContent ? node.textContent : ''}${node && Array.isArray(node.children)
    ? node.children.map(renderedText).join('') : ''}`;
}

async function browser(fetchImpl, { DateImpl = Date, stateImpl = null } = {}) {
  const els = new Map();
  const resourceIds = Object.keys({
    'account-config-view': 1, 'account-config-download': 1,
    'subscriptions-view': 1, 'subscriptions-download': 1,
    'rate-card-view': 1, 'rate-card-download': 1,
  });
  function get(id) {
    if (!els.has(id)) {
      const el = fakeElement(id, id.includes('action') ? 'select' : id.includes('form') ? 'form' : 'div');
      if (id === 'settings-live-value' || id === 'settings-configured-value') el.firstChild = { textContent: '' };
      if (id.endsWith('-action')) {
        const options = {
          set: fakeElement('', 'option'), cancel: fakeElement('', 'option'), none: fakeElement('', 'option'),
        };
        options.set.value = 'set'; options.cancel.value = 'cancel'; options.none.value = 'none';
        el.options = Object.values(options);
        el.querySelector = (selector) => selector.includes('"set"') ? options.set
          : selector.includes('"cancel"') ? options.cancel : options.none;
        el.value = 'none';
      }
      els.set(id, el);
    }
    return els.get(id);
  }
  const form = get('settings-form');
  form.querySelectorAll = () => [];
  const document = {
    getElementById: get,
    querySelectorAll(selector) {
      return selector === '.settings-resource-actions a' ? resourceIds.map(get) : [];
    },
    createElement(tag) { return fakeElement('', tag); },
    createTextNode(text) { return { textContent: text }; },
    createDocumentFragment() { return fakeElement('', 'fragment'); },
  };
  const calls = [];
  const fetch = async (url, options = {}) => {
    const normalizedUrl = String(url);
    calls.push({ url: normalizedUrl, options });
    if (normalizedUrl === '/api/state') {
      return stateImpl ? stateImpl(normalizedUrl, options, calls.length) : stateResponse({ tools: [] });
    }
    return fetchImpl(normalizedUrl, options, calls.length);
  };
  const sandbox = {
    document, fetch, console, Date: DateImpl, Math, JSON, Number, String, Array, Object, Set, Map, Intl,
    window: { setTimeout: (callback) => { callback(); return 0; } },
  };
  vm.createContext(sandbox);
  vm.runInContext(settingsJs, sandbox);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { get, calls, form, elementIds: () => [...els.keys()] };
}

test('dashboard navigation and standalone settings shell follow the approved hierarchy', () => {
  assert.match(indexHtml, /href="\/settings\.html"[^>]*>Manage reset &amp; billing/);
  assert.match(settingsHtml, /href="\/">← Dashboard/);
  assert.ok(settingsHtml.indexOf('settings-reset-title') < settingsHtml.indexOf('settings-plans-title'));
  assert.ok(settingsHtml.indexOf('settings-plans-title') < settingsHtml.indexOf('settings-resources-title'));
  assert.match(settingsHtml, /id="settings-time-zone" type="text"/);
  assert.match(settingsHtml, /id="settings-schedule-enabled" type="checkbox"/);
  assert.match(settingsHtml, /<option value="cancel"/);
  assert.match(settingsHtml, /Changes close the open history record/);
  assert.match(accountConfigJs, /later boundary for the open plan/);
  assert.match(settingsJs, /There is no open plan to cancel\./);
  assert.doesNotMatch(settingsHtml, /Changes close the current record/);
  assert.doesNotMatch(accountConfigJs, /later boundary for the current plan/);
  assert.doesNotMatch(settingsJs, /There is no current plan to cancel\./);
  assert.doesNotMatch(settingsHtml, /\$100\.00|\$20\.00|value="2026-/);
});

test('settings styles are namespaced, responsive, focused, and reduced-motion compatible', () => {
  assert.match(styles, /\.settings-surface\s*\{/);
  assert.match(styles, /\.settings-field input:focus-visible/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*\.settings-resource/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /\.settings-surface\s*\{[^}]*box-shadow/s);
  assert.match(styles, /\.settings-page\s*\{[^}]*--settings-live:\s*#137c3e/s);
  assert.match(styles, /@media \(prefers-color-scheme: dark\)[\s\S]*\.settings-page\s*\{\s*--settings-live:\s*#55cb7b/);
  assert.match(styles, /\.settings-selection\.is-live\s*\{[^}]*border-left-color:\s*var\(--settings-live\)/s);
  assert.match(styles, /\.settings-selection\.is-live \.settings-source-pill\s*\{[^}]*color:\s*var\(--settings-live\)/s);
  assert.match(styles, /\.settings-section-head > span\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(styles, /\.settings-source-pill\s*\{[^}]*color:\s*var\(--muted\)/s);
  assert.match(styles, /\.settings-field-help\s*\{\s*color:\s*var\(--muted\)/);
  assert.match(styles, /\.settings-resource small\s*\{[^}]*color:\s*var\(--muted\)/s);
});

test('settings muted text meets AA contrast on every panel surface', () => {
  const pageBlocks = [...styles.matchAll(/\.settings-page\s*\{([^}]*)\}/g)];
  const lightBlock = pageBlocks[0]?.[1] || '';
  const darkBlock = pageBlocks[1]?.[1] || '';
  const lightMuted = lightBlock.match(/--muted:\s*(#[0-9a-f]{6})/i)?.[1];
  const darkMuted = darkBlock.match(/--muted:\s*(#[0-9a-f]{6})/i)?.[1];
  assert.ok(lightMuted && darkMuted, 'settings define explicit light and dark muted text tokens');

  const surfaces = {
    light: ['#ffffff', '#f8fafc', '#eaf0ff', '#fff2df', '#e8f6ed', '#fdebec', '#e8edf3'],
    dark: ['#151b22', '#11171e', '#18243e', '#2b2114', '#14291d', '#32191c', '#252e39'],
  };
  for (const background of surfaces.light) {
    assert.ok(contrastRatio(lightMuted, background) >= 4.5,
      `${lightMuted} on ${background} must meet WCAG AA`);
  }
  for (const background of surfaces.dark) {
    assert.ok(contrastRatio(darkMuted, background) >= 4.5,
      `${darkMuted} on ${background} must meet WCAG AA`);
  }
});

test('GET renders provenance, display-only paths, and only API-returned fixed links', async () => {
  const configured = view({
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    resetSelection: {
      source: 'configured', nextResetAt: '2026-07-25T06:00:00.000Z',
      liveStatus: 'missing', configuredStatus: 'usable', corroboratedByModelCap: true,
    },
  });
  const { get, calls, form } = await browser(async () => ({ ok: true, status: 200, json: async () => configured }));
  assert.equal(calls[0].url, '/api/config/reset-billing');
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(form.hidden, false);
  assert.equal(get('settings-source-pill').textContent, 'Configured');
  assert.equal(get('settings-schedule-enabled').checked, true);
  assert.equal(get('settings-time-zone').value, 'America/Los_Angeles');
  assert.equal(get('account-config-path').textContent, '/safe/data/account-config.json');
  assert.equal(get('account-config-view').href, LINKS.accountConfig.view);
  assert.equal(get('rate-card-download').href, LINKS.rateCard.download);
});

test('Claude freshness is read independently from state and reports an explicit stale age', async () => {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2026-07-23T19:00:00.000Z']));
    }

    static now() { return Date.parse('2026-07-23T19:00:00.000Z'); }
  }
  const configured = view({
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
  });
  const state = {
    tools: [{
      source: 'claude-code',
      freshness: {
        capturedAt: '2026-07-23T18:45:00.000Z', freshForMs: 300000, staleAfterMs: 600000,
      },
      limitsDiagnostic: { reason: 'stale-reading' },
    }],
  };
  const { get, calls, form } = await browser(
    async () => ({ ok: true, status: 200, json: async () => configured }),
    { DateImpl: FixedDate, stateImpl: async () => stateResponse(state) },
  );

  const stateCall = calls.find((call) => call.url === '/api/state');
  assert.ok(stateCall, 'freshness uses the existing state contract');
  assert.equal(stateCall.options.cache, 'no-store');
  assert.equal(calls[0].url, '/api/config/reset-billing', 'configuration loading starts independently first');
  assert.equal(form.hidden, false, 'state freshness does not gate configuration');
  assert.match(renderedText(get('settings-freshness-note')), /Claude usage is stale · 15m old\./);
  assert.match(renderedText(get('settings-freshness-note')), /never refreshes or re-labels the usage percentage/);
});

test('oversized state metadata is rejected without hiding usable configuration', async () => {
  const configured = view();
  let stateBodyRead = false;
  const { get, calls, form } = await browser(
    async () => ({ ok: true, status: 200, json: async () => configured }),
    {
      stateImpl: async () => ({
        ok: true,
        status: 200,
        headers: { get: (name) => name.toLowerCase() === 'content-length' ? '131073' : null },
        text: async () => { stateBodyRead = true; return '{"tools":[]}'; },
      }),
    },
  );

  assert.ok(calls.some((call) => call.url === '/api/state'));
  assert.equal(stateBodyRead, false, 'declared oversize is rejected before reading the body');
  assert.equal(form.hidden, false);
  assert.equal(get('settings-source-pill').textContent, 'Unavailable');
  assert.match(renderedText(get('settings-freshness-note')), /Claude usage freshness could not be checked\./);
});

test('future-effective plan change keeps today active and targets the scheduled open record', async () => {
  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : ['2026-07-23T19:00:00.000Z']));
    }
  }
  const active = {
    tool: 'claude', amountCents: 10000, effectiveStartDate: '2026-07-01',
    effectiveEndDate: '2026-08-01', billingAnchorDay: 1,
  };
  const scheduled = {
    tool: 'claude', amountCents: 20000, effectiveStartDate: '2026-08-01',
    effectiveEndDate: null, billingAnchorDay: 1,
  };
  const initial = view({ recurringPlans: [active, scheduled] });
  const saved = view({
    version: 4,
    etag: '"account-config-v1-4-future-cancel"',
    recurringPlans: [active, { ...scheduled, effectiveEndDate: '2026-09-01' }],
  });
  const { get, calls, form } = await browser(async (url, options) => options.method === 'PUT'
    ? { ok: true, status: 200, json: async () => saved }
    : { ok: true, status: 200, json: async () => initial }, { DateImpl: FixedDate });

  assert.equal(get('claude-current-amount').textContent, '$100.00 / month');
  assert.match(get('claude-current-dates').textContent, /^Current since Jul 1, 2026/);
  assert.match(get('claude-current-dates').textContent,
    /ends Aug 1, 2026 \(exclusive\).*Next scheduled: \$200\.00 \/ month from Aug 1, 2026/);
  assert.equal(get('claude-amount').value, '200.00', 'the editor follows the open history tail');
  assert.equal(get('claude-date').value, '2026-09-01', 'the default follows the scheduled plan start');
  assert.equal(get('claude-action').options.find((option) => option.value === 'set').textContent,
    'Schedule another change');

  get('claude-action').value = 'cancel';
  get('claude-action').onchange();
  get('claude-confirm').checked = true;
  get('claude-confirm').oninput();
  await form.onsubmit({ preventDefault() {} });

  const body = JSON.parse(calls.find((call) => call.options.method === 'PUT').options.body);
  assert.deepEqual(body.billingChanges, [{
    action: 'cancel', tool: 'claude', effectiveDate: '2026-09-01', confirmed: true,
  }]);
  assert.match(get('claude-confirm-copy').textContent, /scheduled Claude recurring plan/);
});

test('last-valid account configuration is an explicit recovery-only view and cannot save', async () => {
  const recovery = view({
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    sources: {
      accountConfig: { status: 'last-valid', reason: 'invalid_content' },
      subscriptions: { status: 'valid', reason: null },
    },
  });
  const { get, calls, form } = await browser(async () => ({
    ok: true, status: 200, json: async () => recovery,
  }));

  assert.equal(form.hidden, false, 'the last valid values remain available for review');
  assert.equal(get('account-config-status').textContent, 'Serving the last valid file');
  assert.equal(get('settings-version').textContent, 'account-config.json · last valid v3 · read only');
  assert.equal(get('settings-banner-title').textContent, 'Recovery required · read only');
  assert.match(get('settings-banner-copy').textContent,
    /last valid version is shown for recovery review only[\s\S]*saving is disabled/i);
  assert.equal(get('settings-schedule-enabled').disabled, true);
  assert.equal(get('settings-weekday').disabled, true);
  assert.equal(get('claude-action').disabled, true);
  assert.equal(get('codex-action').disabled, true);
  assert.equal(get('claude-confirm').disabled, true);
  assert.equal(get('settings-save').disabled, true);

  // Even a forged/programmatic draft cannot cross the read-only client guard.
  get('settings-reset-time').value = '22:00';
  get('claude-action').value = 'set';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(calls.some((call) => call.options.method === 'PUT'), false);
  assert.equal(get('settings-banner-title').textContent, 'Recovery required · read only');
});

test('a valid schedule save sends exact version and CSRF proof, then adopts the returned version', async () => {
  const initial = view();
  const saved = view({
    version: 4,
    etag: '"account-config-v1-4-test"',
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    resetSelection: {
      source: 'configured', nextResetAt: '2026-07-25T06:00:00.000Z',
      liveStatus: 'missing', configuredStatus: 'usable', corroboratedByModelCap: false,
    },
  });
  const { get, calls, form } = await browser(async (url, options) => options.method === 'PUT'
    ? { ok: true, status: 200, json: async () => saved }
    : { ok: true, status: 200, json: async () => initial });

  get('settings-schedule-enabled').checked = true;
  get('settings-schedule-enabled').onchange();
  get('settings-weekday').value = '5';
  get('settings-reset-time').value = '23:00';
  get('settings-time-zone').value = 'America/Los_Angeles';
  get('settings-time-zone').oninput();
  await form.onsubmit({ preventDefault() {} });

  const put = calls.find((call) => call.options.method === 'PUT');
  assert.ok(put);
  assert.equal(put.options.headers['If-Match'], initial.etag);
  assert.equal(put.options.headers['X-LLMDash-CSRF'], initial.csrfToken);
  assert.deepEqual(JSON.parse(put.options.body), {
    schemaVersion: 1,
    baseVersion: 3,
    resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' },
    billingChanges: [],
  });
  assert.equal(get('settings-version').textContent, 'account-config.json · v4');
  assert.equal(get('settings-banner-title').textContent, 'Configuration saved');
});

test('412 conflict preserves the visible draft and disables repeated save until reload', async () => {
  const initial = view({ resetSchedule: { isoWeekday: 5, localTime: '23:00', timeZone: 'America/Los_Angeles' } });
  const { get, form } = await browser(async (url, options) => options.method === 'PUT'
    ? { ok: false, status: 412, json: async () => ({ error: 'version_conflict', currentVersion: 4 }) }
    : { ok: true, status: 200, json: async () => initial });

  get('settings-reset-time').value = '22:30';
  get('settings-reset-time').oninput();
  await form.onsubmit({ preventDefault() {} });

  assert.equal(get('settings-reset-time').value, '22:30');
  assert.equal(get('settings-banner-title').textContent, 'A newer version is available');
  assert.equal(get('settings-conflict-actions').hidden, false);
  assert.equal(get('settings-save').disabled, true);
});

test('invalid IANA input is associated with the field and never issues a PUT', async () => {
  const { get, calls, form } = await browser(async () => ({ ok: true, status: 200, json: async () => view() }));
  get('settings-schedule-enabled').checked = true;
  get('settings-schedule-enabled').onchange();
  get('settings-weekday').value = '5';
  get('settings-reset-time').value = '23:00';
  get('settings-time-zone').value = 'UTC+08:00';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(calls.some((call) => call.options.method === 'PUT'), false);
  assert.equal(get('settings-time-zone').getAttribute('aria-invalid'), 'true');
  assert.equal(get('settings-time-zone-error').hidden, false);
});

test('422 paths map back to the submitted field without losing the draft', async () => {
  const { get, form } = await browser(async (url, options) => options.method === 'PUT'
    ? { ok: false, status: 422, json: async () => ({
      error: 'validation_failed',
      fieldErrors: [{ path: 'resetSchedule.timeZone', message: 'Use a canonical IANA zone.' }],
    }) }
    : { ok: true, status: 200, json: async () => view() });
  get('settings-schedule-enabled').checked = true;
  get('settings-schedule-enabled').onchange();
  get('settings-weekday').value = '5';
  get('settings-reset-time').value = '23:00';
  get('settings-time-zone').value = 'America/Los_Angeles';
  await form.onsubmit({ preventDefault() {} });
  assert.equal(get('settings-time-zone').value, 'America/Los_Angeles');
  assert.equal(get('settings-time-zone-error').textContent, 'Use a canonical IANA zone.');
  assert.equal(get('settings-time-zone-error').hidden, false);
  assert.equal(get('settings-banner-title').textContent, 'The server rejected these fields');
});

test('422 ignores inherited billing field names without mis-targeting a field', async () => {
  const hostilePaths = [
    'billingChanges[0].constructor',
    'billingChanges.0.toString',
    'billingChanges[0].__proto__',
  ];

  for (const hostilePath of hostilePaths) {
    const { get, form, elementIds } = await browser(async (url, options) => options.method === 'PUT'
      ? { ok: false, status: 422, json: async () => ({
        error: 'validation_failed',
        fieldErrors: [{ path: hostilePath, message: 'Do not route this error.' }],
      }) }
      : { ok: true, status: 200, json: async () => view() });

    get('claude-action').value = 'set';
    get('claude-action').onchange();
    get('claude-amount').value = '20.00';
    get('claude-date').value = '2026-08-01';
    get('claude-anchor').value = '1';
    get('claude-confirm').checked = true;
    get('claude-confirm').oninput();
    const idsBeforeSubmit = new Set(elementIds());

    await assert.doesNotReject(() => form.onsubmit({ preventDefault() {} }));

    assert.deepEqual(elementIds().filter((id) => !idsBeforeSubmit.has(id)), [],
      `${hostilePath} must not be converted into a DOM id`);
    for (const fieldId of ['claude-amount', 'claude-date', 'claude-anchor', 'claude-confirm', 'claude-action']) {
      assert.equal(get(fieldId).getAttribute('aria-invalid'), null,
        `${hostilePath} must not target ${fieldId}`);
    }
    assert.equal(get('settings-banner-title').textContent, 'The server rejected these fields');
  }
});

test('cancel sends only the fixed cancel shape and explicit confirmation', async () => {
  const plan = {
    tool: 'claude', amountCents: 20000, effectiveStartDate: '2026-07-01',
    effectiveEndDate: null, billingAnchorDay: 1,
  };
  const initial = view({ recurringPlans: [plan] });
  const saved = view({ version: 4, etag: '"account-config-v1-4-cancel"', recurringPlans: [plan] });
  const { get, calls, form } = await browser(async (url, options) => options.method === 'PUT'
    ? { ok: true, status: 200, json: async () => saved }
    : { ok: true, status: 200, json: async () => initial });
  get('claude-action').value = 'cancel';
  get('claude-action').onchange();
  get('claude-confirm').checked = true;
  get('claude-confirm').oninput();
  await form.onsubmit({ preventDefault() {} });
  const body = JSON.parse(calls.find((call) => call.options.method === 'PUT').options.body);
  assert.deepEqual(Object.keys(body.billingChanges[0]), ['action', 'tool', 'effectiveDate', 'confirmed']);
  assert.equal(body.billingChanges[0].action, 'cancel');
  assert.equal(body.billingChanges[0].tool, 'claude');
  assert.equal(body.billingChanges[0].confirmed, true);
});

test('client contract contains explicit 422 mapping, cancel payload, and non-path link allowlisting', () => {
  assert.match(settingsJs, /response\.status === 422/);
  assert.match(settingsJs, /billingChanges\\\.\(\\d\+\)/);
  assert.match(settingsJs, /\{ action: 'cancel', tool, effectiveDate, confirmed: true \}/);
  assert.match(settingsJs, /const apiLinks = new Set\(flattenStrings\(view\.links\)\)/);
  assert.doesNotMatch(settingsJs, /href\s*=\s*resourcePath/);
});
