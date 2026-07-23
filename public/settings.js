// Reset and billing settings. This page edits only the fixed, versioned local
// account configuration exposed by /api/config/reset-billing.
(() => {
  'use strict';

  const API = '/api/config/reset-billing';
  const STATE_API = '/api/state';
  const STATE_MAX_BYTES = 128 * 1024;
  const STATE_MAX_TOOLS = 32;
  const TOOLS = ['claude', 'codex'];
  const WEEKDAYS = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const RESOURCE_LINKS = Object.freeze({
    'account-config-view': '/api/config/reset-billing?resource=account-config&download=0',
    'account-config-download': '/api/config/reset-billing?resource=account-config&download=1',
    'subscriptions-view': '/api/config/reset-billing?resource=subscriptions&download=0',
    'subscriptions-download': '/api/config/reset-billing?resource=subscriptions&download=1',
    'rate-card-view': '/api/config/reset-billing?resource=rate-card&download=0',
    'rate-card-download': '/api/config/reset-billing?resource=rate-card&download=1',
  });
  const BILLING_ERROR_SUFFIXES = Object.freeze({
    amountUsd: 'amount',
    effectiveDate: 'date',
    billingAnchorDay: 'anchor',
    confirmed: 'confirm',
    action: 'action',
    tool: 'action',
  });

  const byId = (id) => document.getElementById(id);
  const form = byId('settings-form');
  if (!form) return;

  const loading = byId('settings-loading');
  const loadError = byId('settings-load-error');
  const surface = byId('settings-surface');
  const banner = byId('settings-banner');
  const bannerTitle = byId('settings-banner-title');
  const bannerCopy = byId('settings-banner-copy');
  const bannerIcon = byId('settings-banner-icon');
  const conflictActions = byId('settings-conflict-actions');
  const announcer = byId('settings-announcer');
  const saveButton = byId('settings-save');
  const discardButton = byId('settings-discard');
  const scheduleEnabled = byId('settings-schedule-enabled');
  const weekday = byId('settings-weekday');
  const resetTime = byId('settings-reset-time');
  const timeZone = byId('settings-time-zone');

  let baseView = null;
  let openPlans = { claude: null, codex: null };
  let requestSequence = 0;
  let submitting = false;
  let conflicted = false;
  let claudeUsageFreshness = { status: 'checking', ageMs: null };

  function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validDateString(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1) return false;
    return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function normalizeView(raw) {
    if (!isRecord(raw) || raw.schemaVersion !== 1
      || (raw.version !== null && (!Number.isSafeInteger(raw.version) || raw.version < 0))) {
      throw new Error('invalid configuration response');
    }
    if (raw.etag !== null && (typeof raw.etag !== 'string'
      || raw.etag.length < 2 || raw.etag.length > 512 || raw.etag.startsWith('W/'))) {
      throw new Error('invalid configuration response');
    }
    if ((raw.version === null) !== (raw.etag === null)) throw new Error('invalid configuration response');
    if (typeof raw.csrfToken !== 'string' || raw.csrfToken.length < 16 || raw.csrfToken.length > 1024) {
      throw new Error('invalid configuration response');
    }

    let resetSchedule = null;
    if (raw.resetSchedule !== null) {
      const schedule = raw.resetSchedule;
      if (!isRecord(schedule) || !Number.isInteger(schedule.isoWeekday)
        || schedule.isoWeekday < 1 || schedule.isoWeekday > 7
        || typeof schedule.localTime !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)
        || typeof schedule.timeZone !== 'string' || schedule.timeZone.length < 1 || schedule.timeZone.length > 128) {
        throw new Error('invalid configuration response');
      }
      resetSchedule = {
        isoWeekday: schedule.isoWeekday,
        localTime: schedule.localTime,
        timeZone: schedule.timeZone,
      };
    }

    if (!Array.isArray(raw.recurringPlans) || raw.recurringPlans.length > 512) {
      throw new Error('invalid configuration response');
    }
    const recurringPlans = raw.recurringPlans.map((plan) => {
      if (!isRecord(plan) || !TOOLS.includes(plan.tool)
        || !Number.isSafeInteger(plan.amountCents) || plan.amountCents < 1 || plan.amountCents > 100000000
        || !validDateString(plan.effectiveStartDate)
        || (plan.effectiveEndDate !== null && !validDateString(plan.effectiveEndDate))
        || !Number.isInteger(plan.billingAnchorDay) || plan.billingAnchorDay < 1 || plan.billingAnchorDay > 31) {
        throw new Error('invalid configuration response');
      }
      return {
        tool: plan.tool,
        amountCents: plan.amountCents,
        effectiveStartDate: plan.effectiveStartDate,
        effectiveEndDate: plan.effectiveEndDate,
        billingAnchorDay: plan.billingAnchorDay,
      };
    });

    const selection = raw.resetSelection;
    if (!isRecord(selection) || !['live', 'configured', 'unavailable'].includes(selection.source)
      || (selection.nextResetAt !== null
        && (typeof selection.nextResetAt !== 'string' || !Number.isFinite(Date.parse(selection.nextResetAt))))) {
      throw new Error('invalid configuration response');
    }

    const sources = isRecord(raw.sources) ? raw.sources : {};
    const accountSource = isRecord(sources.accountConfig) ? sources.accountConfig : null;
    const accountStatus = accountSource && typeof accountSource.status === 'string'
      ? accountSource.status : '';
    const accountServing = accountSource && typeof accountSource.serving === 'string'
      ? accountSource.serving : '';
    const recoveryOnly = accountStatus === 'last-valid' || accountServing === 'last-valid';
    const currentOrEmpty = accountStatus === 'current' || accountServing === 'current'
      || accountStatus === 'empty' || accountServing === 'empty';
    const hasWriteProof = Number.isSafeInteger(raw.version) && typeof raw.etag === 'string';

    return {
      schemaVersion: 1,
      version: raw.version,
      etag: raw.etag,
      editable: hasWriteProof && currentOrEmpty && !recoveryOnly,
      recoveryOnly,
      csrfToken: raw.csrfToken,
      resetSchedule,
      recurringPlans,
      resetSelection: {
        source: selection.source,
        nextResetAt: selection.nextResetAt,
        liveStatus: typeof selection.liveStatus === 'string' ? selection.liveStatus : 'unavailable',
        configuredStatus: typeof selection.configuredStatus === 'string' ? selection.configuredStatus : 'unavailable',
        corroboratedByModelCap: selection.corroboratedByModelCap === true,
      },
      sources,
      paths: isRecord(raw.paths) ? raw.paths : {},
      links: isRecord(raw.links) || Array.isArray(raw.links) ? raw.links : {},
    };
  }

  function setBanner(kind, title, copy, withConflictActions = false) {
    banner.className = `settings-banner${kind ? ` is-${kind}` : ''}`;
    bannerIcon.textContent = kind === 'saved' ? '✓' : kind === 'conflict' || kind === 'error' ? '!' : 'i';
    bannerTitle.textContent = title;
    bannerCopy.textContent = copy;
    conflictActions.hidden = !withConflictActions;
    banner.hidden = false;
  }

  function hideBanner() {
    banner.hidden = true;
    conflictActions.hidden = true;
  }

  function announce(copy) {
    announcer.textContent = '';
    window.setTimeout(() => { announcer.textContent = copy; }, 0);
  }

  function flattenStrings(value, depth = 0, output = []) {
    if (output.length >= 64 || depth > 4) return output;
    if (typeof value === 'string') output.push(value);
    else if (Array.isArray(value)) value.slice(0, 32).forEach((item) => flattenStrings(item, depth + 1, output));
    else if (isRecord(value)) Object.values(value).slice(0, 32).forEach((item) => flattenStrings(item, depth + 1, output));
    return output;
  }

  function resourcePath(paths, filename) {
    const candidates = flattenStrings(paths);
    return candidates.find((candidate) => candidate === filename || candidate.endsWith(`/${filename}`)) || 'Path unavailable';
  }

  function findSource(sources, terms) {
    for (const [key, value] of Object.entries(sources)) {
      const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
      if (terms.some((term) => normalized.includes(term)) && isRecord(value)) return value;
    }
    return null;
  }

  function sourceStatusCopy(source, emptyFallback) {
    const status = source && typeof source.status === 'string' ? source.status : '';
    const serving = source && typeof source.serving === 'string' ? source.serving : '';
    if (status === 'current' || serving === 'current') return 'Current validated file';
    if (status === 'valid' || serving === 'valid') return 'Validated read-only file';
    if (status === 'last-valid' || serving === 'last-valid') return 'Serving the last valid file';
    if (status === 'empty' || serving === 'empty') return 'Empty · no file saved yet';
    if (status === 'unavailable' || serving === 'unavailable') return 'Unavailable';
    return emptyFallback;
  }

  function renderResources(view) {
    byId('account-config-path').textContent = resourcePath(view.paths, 'account-config.json');
    byId('subscriptions-path').textContent = resourcePath(view.paths, 'subscriptions.json');
    byId('rate-card-path').textContent = resourcePath(view.paths, 'api-rates.json');

    const accountSource = findSource(view.sources, ['accountconfig']);
    const subscriptionsSource = findSource(view.sources, ['subscription', 'legacy']);
    byId('account-config-status').textContent = sourceStatusCopy(accountSource,
      view.version === 0 ? 'Empty · no file saved yet' : 'Validated account configuration');
    byId('subscriptions-status').textContent = sourceStatusCopy(subscriptionsSource, 'Legacy fixed periods · read only');

    const apiLinks = new Set(flattenStrings(view.links));
    for (const [id, expected] of Object.entries(RESOURCE_LINKS)) {
      const link = byId(id);
      if (apiLinks.has(expected)) {
        link.href = expected;
        link.removeAttribute('aria-disabled');
        if (id.endsWith('-download')) link.setAttribute('download', '');
      } else {
        link.removeAttribute('href');
        link.removeAttribute('download');
        link.setAttribute('aria-disabled', 'true');
      }
    }
  }

  function formatDateOnly(value) {
    if (!validDateString(value)) return 'Unknown date';
    try {
      return new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
        .format(new Date(`${value}T00:00:00.000Z`));
    } catch { return value; }
  }

  function browserTimeZone() {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; }
    catch { return 'UTC'; }
  }

  function formatReset(value, zone) {
    if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
    try {
      return new Intl.DateTimeFormat(undefined, {
        timeZone: zone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(value));
    } catch { return null; }
  }

  function usageAgeCopy(ageMs) {
    const minutes = Math.floor(Math.max(0, ageMs) / 60000);
    if (minutes < 1) return 'less than 1m';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    if (hours < 24) return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
    const days = Math.floor(hours / 24);
    const hourRemainder = hours % 24;
    return hourRemainder ? `${days}d ${hourRemainder}h` : `${days}d`;
  }

  function freshnessCopy() {
    const { status, ageMs } = claudeUsageFreshness;
    if (status === 'fresh') return `Claude usage is fresh · captured ${usageAgeCopy(ageMs)} ago.`;
    if (status === 'aging') return `Claude usage is aging · ${usageAgeCopy(ageMs)} old.`;
    if (status === 'stale') return `Claude usage is stale · ${usageAgeCopy(ageMs)} old.`;
    if (status === 'missing') return 'No Claude usage reading is available.';
    if (status === 'unavailable') return 'Claude usage freshness could not be checked.';
    return 'Checking Claude usage freshness.';
  }

  function setFreshnessNote() {
    const note = byId('settings-freshness-note');
    note.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = freshnessCopy();
    note.append(strong, document.createTextNode(' Saving a fallback changes reset timing only; it never refreshes or re-labels the usage percentage.'));
  }

  function utf8LengthAboveLimit(value, limit) {
    let bytes = 0;
    for (let index = 0; index < value.length; index += 1) {
      const code = value.charCodeAt(index);
      if (code <= 0x7f) bytes += 1;
      else if (code <= 0x7ff) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff
        && index + 1 < value.length
        && value.charCodeAt(index + 1) >= 0xdc00
        && value.charCodeAt(index + 1) <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else bytes += 3;
      if (bytes > limit) return true;
    }
    return false;
  }

  async function boundedJson(response, limit = STATE_MAX_BYTES) {
    const declared = response.headers && typeof response.headers.get === 'function'
      ? response.headers.get('content-length') : null;
    if (typeof declared === 'string' && /^\d+$/.test(declared.trim())
      && Number(declared) > limit) {
      throw new Error('state response too large');
    }

    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks = [];
      let total = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!(value instanceof Uint8Array)) throw new Error('invalid state response');
          total += value.byteLength;
          if (total > limit) {
            try { await reader.cancel(); } catch { /* best effort */ }
            throw new Error('state response too large');
          }
          chunks.push(value);
        }
      } finally {
        if (typeof reader.releaseLock === 'function') reader.releaseLock();
      }
      const bytes = new Uint8Array(total);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    }

    // Minimal browser harnesses may not expose ReadableStream. Keep the same
    // byte cap on their already-decoded text fallback.
    if (typeof response.text !== 'function') throw new Error('invalid state response');
    const text = await response.text();
    if (typeof text !== 'string' || utf8LengthAboveLimit(text, limit)) {
      throw new Error('state response too large');
    }
    return JSON.parse(text);
  }

  function normalizeClaudeFreshness(raw) {
    if (!isRecord(raw) || !Array.isArray(raw.tools)) throw new Error('invalid state response');
    let claude = null;
    const count = Math.min(raw.tools.length, STATE_MAX_TOOLS);
    for (let index = 0; index < count; index += 1) {
      const tool = raw.tools[index];
      if (isRecord(tool) && tool.source === 'claude-code') {
        claude = tool;
        break;
      }
    }
    if (!claude) return { status: 'missing', ageMs: null };
    const freshness = claude.freshness;
    if (!isRecord(freshness) || freshness.capturedAt === null) {
      return { status: 'missing', ageMs: null };
    }
    if (typeof freshness.capturedAt !== 'string' || freshness.capturedAt.length > 64) {
      throw new Error('invalid state response');
    }
    const capturedAt = Date.parse(freshness.capturedAt);
    const freshForMs = freshness.freshForMs;
    const staleAfterMs = freshness.staleAfterMs;
    if (!Number.isFinite(capturedAt)
      || !Number.isFinite(freshForMs) || freshForMs < 0
      || !Number.isFinite(staleAfterMs) || staleAfterMs < freshForMs) {
      throw new Error('invalid state response');
    }
    const ageMs = Math.max(0, Date.now() - capturedAt);
    const status = ageMs > staleAfterMs ? 'stale' : ageMs > freshForMs ? 'aging' : 'fresh';
    return { status, ageMs };
  }

  async function loadClaudeFreshness() {
    try {
      const response = await fetch(STATE_API, {
        cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error('state unavailable');
      claudeUsageFreshness = normalizeClaudeFreshness(await boundedJson(response));
    } catch {
      claudeUsageFreshness = { status: 'unavailable', ageMs: null };
    }
    setFreshnessNote();
  }

  function renderSelection(view) {
    const selection = view.resetSelection;
    const selectedSource = selection.source;
    const scheduleZone = view.resetSchedule && view.resetSchedule.timeZone;
    const displayZone = scheduleZone || browserTimeZone();
    const selectedTime = formatReset(selection.nextResetAt, displayZone);
    const selectionBox = byId('settings-selection');
    selectionBox.classList.remove('is-live', 'is-configured', 'is-unavailable');
    selectionBox.classList.add(`is-${selectedSource}`);

    const label = selectedSource === 'live' ? 'Live' : selectedSource === 'configured' ? 'Configured' : 'Unavailable';
    byId('settings-selection-label').textContent = `Selected source · ${label}`;
    byId('settings-source-pill').textContent = label;
    byId('settings-selection-time').textContent = selectedTime || 'No next reset available';
    const corroboration = selection.corroboratedByModelCap ? ' · corroborated by a model-specific cap' : '';
    byId('settings-selection-detail').textContent = selectedSource === 'live'
      ? `Provider-reported account reset · displayed in ${displayZone}${corroboration}`
      : selectedSource === 'configured'
        ? `Calculated fallback · ${displayZone}${corroboration}`
        : 'No usable provider reset or configured fallback.';

    const liveUsable = selectedSource === 'live' && selectedTime;
    byId('settings-live-value').firstChild.textContent = liveUsable ? selectedTime : 'Unavailable';
    byId('settings-live-detail').textContent = liveUsable ? 'current provider evidence' : 'no usable account reset';
    renderConfiguredProvenance(false);
    setFreshnessNote();
  }

  function renderConfiguredProvenance(asDraft = true) {
    const value = byId('settings-configured-value').firstChild;
    const detail = byId('settings-configured-detail');
    if (!scheduleEnabled.checked) {
      value.textContent = 'Not configured';
      detail.textContent = asDraft && baseView && baseView.resetSchedule ? 'unsaved removal' : 'no saved fallback';
      return;
    }
    const day = WEEKDAYS[Number(weekday.value)] || 'Select day';
    value.textContent = `${day} · ${resetTime.value || '—'}`;
    const suffix = timeZone.value || 'time zone required';
    detail.textContent = asDraft && baseView && !sameSchedule(readScheduleDraft(), baseView.resetSchedule)
      ? `unsaved draft · ${suffix}` : suffix;
  }

  function formatAmount(cents) {
    try {
      return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
        .format(cents / 100);
    } catch { return `$${(cents / 100).toFixed(2)}`; }
  }

  function localDateString(from = new Date()) {
    return `${from.getFullYear()}-${String(from.getMonth() + 1).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
  }

  function planStateAtToday(plans, tool, today = localDateString()) {
    const rows = plans.filter((plan) => plan.tool === tool)
      .sort((a, b) => a.effectiveStartDate.localeCompare(b.effectiveStartDate));
    return {
      active: rows.find((plan) => plan.effectiveStartDate <= today
        && (plan.effectiveEndDate === null || today < plan.effectiveEndDate)) || null,
      scheduled: rows.filter((plan) => plan.effectiveStartDate > today),
      open: rows.find((plan) => plan.effectiveEndDate === null) || null,
    };
  }

  function nextBoundary(anchor, from = new Date()) {
    if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) return '';
    let year = from.getFullYear();
    let month = from.getMonth() + 1;
    const today = `${year}-${String(month).padStart(2, '0')}-${String(from.getDate()).padStart(2, '0')}`;
    for (let tries = 0; tries < 14; tries += 1) {
      const day = Math.min(anchor, new Date(Date.UTC(year, month, 0)).getUTCDate());
      const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (candidate > today) return candidate;
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return '';
  }

  function nextBoundaryForOpenPlan(plan) {
    const today = localDateString();
    const after = plan.effectiveStartDate > today ? plan.effectiveStartDate : today;
    const [year, month, day] = after.split('-').map(Number);
    return nextBoundary(plan.billingAnchorDay, new Date(year, month - 1, day, 12));
  }

  function renderPlan(tool, state) {
    const amount = byId(`${tool}-current-amount`);
    const dates = byId(`${tool}-current-dates`);
    const action = byId(`${tool}-action`);
    const setOption = action.querySelector('option[value="set"]');
    const cancelOption = action.querySelector('option[value="cancel"]');
    const { active, scheduled, open } = state;
    const nextScheduled = scheduled[0] || null;
    openPlans[tool] = open;

    if (active) {
      amount.textContent = `${formatAmount(active.amountCents)} / month`;
      const end = active.effectiveEndDate === null
        ? 'no end date'
        : `ends ${formatDateOnly(active.effectiveEndDate)} (exclusive)`;
      dates.textContent = `Current since ${formatDateOnly(active.effectiveStartDate)} · anchor day ${active.billingAnchorDay} · ${end}`;
    } else if (nextScheduled) {
      amount.textContent = 'Not currently active';
      dates.textContent = 'No recurring plan is active today';
    } else {
      amount.textContent = 'Not configured';
      dates.textContent = 'No current recurring plan';
    }

    if (nextScheduled) {
      const laterCount = scheduled.length - 1;
      dates.textContent += ` · Next scheduled: ${formatAmount(nextScheduled.amountCents)} / month from ${formatDateOnly(nextScheduled.effectiveStartDate)} · anchor day ${nextScheduled.billingAnchorDay}`;
      if (laterCount > 0) {
        dates.textContent += ` · ${laterCount} later scheduled ${laterCount === 1 ? 'change' : 'changes'}`;
      }
    }

    if (open) {
      const openIsFuture = open.effectiveStartDate > localDateString();
      setOption.textContent = openIsFuture ? 'Schedule another change' : 'Change plan';
      cancelOption.textContent = openIsFuture ? 'Schedule cancellation' : 'Cancel plan';
      cancelOption.disabled = baseView ? !baseView.editable : false;
      byId(`${tool}-amount`).value = (open.amountCents / 100).toFixed(2);
      byId(`${tool}-anchor`).value = String(open.billingAnchorDay);
      byId(`${tool}-date`).value = nextBoundaryForOpenPlan(open);
    } else {
      setOption.textContent = active || nextScheduled ? 'Schedule next plan' : 'Start plan';
      cancelOption.textContent = 'Cancel plan';
      cancelOption.disabled = true;
      byId(`${tool}-amount`).value = '';
      byId(`${tool}-anchor`).value = '';
      byId(`${tool}-date`).value = '';
    }
    action.value = 'none';
    action.disabled = baseView ? !baseView.editable : false;
    byId(`${tool}-confirm`).checked = false;
    byId(`${tool}-confirm`).disabled = baseView ? !baseView.editable : false;
    updatePlanEditor(tool, false);
  }

  function updatePlanEditor(tool, focus = false) {
    const action = byId(`${tool}-action`).value;
    const editor = byId(`${tool}-editor`);
    const amountField = byId(`${tool}-amount-field`);
    const anchorField = byId(`${tool}-anchor-field`);
    const amount = byId(`${tool}-amount`);
    const anchor = byId(`${tool}-anchor`);
    const date = byId(`${tool}-date`);
    const confirm = byId(`${tool}-confirm`);
    const isSet = action === 'set';
    const isCancel = action === 'cancel';
    const editable = !baseView || baseView.editable;
    editor.hidden = action === 'none' || !editable;
    amountField.hidden = !isSet;
    anchorField.hidden = !isSet;
    amount.disabled = !editable || !isSet;
    anchor.disabled = !editable || !isSet;
    date.disabled = !editable || action === 'none';
    confirm.disabled = !editable || action === 'none';

    if (isCancel && openPlans[tool]) {
      if (!date.value) date.value = nextBoundaryForOpenPlan(openPlans[tool]);
      const scheduled = openPlans[tool].effectiveStartDate > localDateString() ? ' scheduled' : '';
      byId(`${tool}-confirm-copy`).textContent = `I confirm cancellation of the${scheduled} ${tool === 'claude' ? 'Claude' : 'Codex'} recurring plan on this effective boundary.`;
    } else if (isSet) {
      const next = openPlans[tool] && openPlans[tool].effectiveStartDate > localDateString() ? ' next scheduled' : '';
      byId(`${tool}-confirm-copy`).textContent = `I confirm this${next} recurring ${tool === 'claude' ? 'Claude' : 'Codex'} amount and effective date.`;
    }
    if (focus && editable && action !== 'none') (isSet ? amount : date).focus();
  }

  function setScheduleFieldsEnabled() {
    const enabled = scheduleEnabled.checked && (!baseView || baseView.editable);
    byId('settings-schedule-fields').classList.toggle('is-disabled', !enabled);
    [weekday, resetTime, timeZone].forEach((field) => { field.disabled = !enabled; });
    renderConfiguredProvenance(true);
  }

  function hydrate(view) {
    baseView = view;
    conflicted = false;
    byId('settings-version').textContent = view.recoveryOnly
      ? `account-config.json · last valid v${view.version} · read only`
      : view.editable ? `account-config.json · v${view.version}` : 'account-config.json · unavailable';
    scheduleEnabled.disabled = !view.editable;
    scheduleEnabled.checked = view.resetSchedule !== null;
    weekday.value = view.resetSchedule ? String(view.resetSchedule.isoWeekday) : '';
    resetTime.value = view.resetSchedule ? view.resetSchedule.localTime : '';
    timeZone.value = view.resetSchedule ? view.resetSchedule.timeZone : '';
    setScheduleFieldsEnabled();

    const planStates = {
      claude: planStateAtToday(view.recurringPlans, 'claude'),
      codex: planStateAtToday(view.recurringPlans, 'codex'),
    };
    TOOLS.forEach((tool) => renderPlan(tool, planStates[tool]));
    const legacySource = findSource(view.sources, ['subscription', 'legacy']);
    const legacyCopy = sourceStatusCopy(legacySource, 'legacy fixed-period source status unavailable').toLowerCase();
    byId('settings-history-note').textContent = '';
    const historyStrong = document.createElement('strong');
    historyStrong.textContent = 'History stays immutable.';
    byId('settings-history-note').append(historyStrong,
      document.createTextNode(` ${view.recurringPlans.length} recurring version${view.recurringPlans.length === 1 ? '' : 's'} · ${legacyCopy}. Anchor days 29–31 clamp at month end without drifting.`));

    renderSelection(view);
    renderResources(view);
    clearErrors();
    updateDirtyState();
  }

  function sameSchedule(a, b) {
    if (a === null || b === null) return a === b;
    return a.isoWeekday === b.isoWeekday && a.localTime === b.localTime && a.timeZone === b.timeZone;
  }

  function readScheduleDraft() {
    if (!scheduleEnabled.checked) return null;
    return {
      isoWeekday: Number(weekday.value),
      localTime: resetTime.value,
      timeZone: timeZone.value.trim(),
    };
  }

  function isDirty() {
    if (!baseView || !baseView.editable) return false;
    if (!sameSchedule(readScheduleDraft(), baseView.resetSchedule)) return true;
    return TOOLS.some((tool) => byId(`${tool}-action`).value !== 'none');
  }

  function updateDirtyState() {
    const dirty = isDirty();
    const planChanges = TOOLS.filter((tool) => byId(`${tool}-action`).value !== 'none').length;
    const scheduleChanged = baseView && !sameSchedule(readScheduleDraft(), baseView.resetSchedule);
    const bits = [];
    if (scheduleChanged) bits.push('reset schedule');
    if (planChanges) bits.push(`${planChanges} plan ${planChanges === 1 ? 'action' : 'actions'}`);
    byId('settings-change-summary').textContent = dirty ? `Unsaved ${bits.join(' · ')}` : 'No unsaved changes';
    const readOnly = !baseView || !baseView.editable;
    saveButton.disabled = readOnly || !dirty || submitting || conflicted;
    discardButton.disabled = readOnly || !dirty || submitting || conflicted;
  }

  function clearErrors() {
    form.querySelectorAll('[aria-invalid="true"]').forEach((field) => field.removeAttribute('aria-invalid'));
    form.querySelectorAll('.settings-field-error').forEach((error) => { error.hidden = true; });
  }

  function fieldError(fieldId, message) {
    const field = byId(fieldId);
    const error = byId(`${fieldId}-error`);
    if (field) field.setAttribute('aria-invalid', 'true');
    if (error) {
      if (typeof message === 'string' && message.length > 0 && message.length <= 300) error.textContent = message;
      error.hidden = false;
    }
    return field;
  }

  function parseAmount(value) {
    if (!/^(?:0|[1-9]\d{0,6})(?:\.\d{1,2})?$/.test(value)) return null;
    const [whole, fraction = ''] = value.split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents >= 1 && cents <= 100000000 ? cents : null;
  }

  function canonicalAmount(cents) {
    return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  }

  function validCanonicalTimeZone(value) {
    if (!value || value.length > 128 || /[\u0000-\u001f\u007f]/.test(value)) return false;
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: value }).resolvedOptions().timeZone === value;
    } catch { return false; }
  }

  function dateParts(value) {
    if (!validDateString(value)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return { year, month, day };
  }

  function isBillingBoundary(value, anchor) {
    const parts = dateParts(value);
    if (!parts || !Number.isInteger(anchor) || anchor < 1 || anchor > 31) return false;
    const lastDay = new Date(Date.UTC(parts.year, parts.month, 0)).getUTCDate();
    return parts.day === Math.min(anchor, lastDay);
  }

  function validateDraft() {
    clearErrors();
    let firstInvalid = null;
    const schedule = readScheduleDraft();
    if (schedule) {
      if (!Number.isInteger(schedule.isoWeekday) || schedule.isoWeekday < 1 || schedule.isoWeekday > 7) {
        firstInvalid ||= fieldError('settings-weekday');
      }
      if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)) {
        firstInvalid ||= fieldError('settings-reset-time');
      }
      if (!validCanonicalTimeZone(schedule.timeZone)) {
        firstInvalid ||= fieldError('settings-time-zone');
      }
    }

    const billingChanges = [];
    for (const tool of TOOLS) {
      const action = byId(`${tool}-action`).value;
      if (action === 'none') continue;
      const current = openPlans[tool];
      const effectiveDate = byId(`${tool}-date`).value;
      const confirmed = byId(`${tool}-confirm`).checked;
      let dateValid = validDateString(effectiveDate);

      if (action === 'set') {
        const cents = parseAmount(byId(`${tool}-amount`).value);
        const anchor = Number(byId(`${tool}-anchor`).value);
        if (cents === null) firstInvalid ||= fieldError(`${tool}-amount`);
        if (!Number.isInteger(anchor) || anchor < 1 || anchor > 31) {
          firstInvalid ||= fieldError(`${tool}-anchor`);
        }
        if (dateValid && Number.isInteger(anchor)) dateValid = isBillingBoundary(effectiveDate, anchor);
        if (dateValid && current) {
          dateValid = effectiveDate > current.effectiveStartDate
            && isBillingBoundary(effectiveDate, current.billingAnchorDay);
        }
        if (!dateValid) firstInvalid ||= fieldError(`${tool}-date`, current
          ? `Choose a date after the open plan starts that is a billing boundary for anchor day ${current.billingAnchorDay} and the new anchor.`
          : 'Choose a date that matches the new billing anchor.');
        if (!confirmed) firstInvalid ||= fieldError(`${tool}-confirm`);
        if (cents !== null && Number.isInteger(anchor) && dateValid && confirmed) {
          billingChanges.push({
            action: 'set',
            tool,
            amountUsd: canonicalAmount(cents),
            effectiveDate,
            billingAnchorDay: anchor,
            confirmed: true,
          });
        }
      } else if (action === 'cancel') {
        if (!current) {
          firstInvalid ||= fieldError(`${tool}-action`, 'There is no open plan to cancel.');
          dateValid = false;
        }
        if (dateValid && current) {
          dateValid = effectiveDate > current.effectiveStartDate
            && isBillingBoundary(effectiveDate, current.billingAnchorDay);
        }
        if (!dateValid) firstInvalid ||= fieldError(`${tool}-date`, current
          ? `Choose a later boundary for the open plan's anchor day ${current.billingAnchorDay}.`
          : 'Enter a valid cancellation boundary.');
        if (!confirmed) firstInvalid ||= fieldError(`${tool}-confirm`);
        if (current && dateValid && confirmed) {
          billingChanges.push({ action: 'cancel', tool, effectiveDate, confirmed: true });
        }
      }
    }
    return { valid: firstInvalid === null, firstInvalid, schedule, billingChanges };
  }

  function normalizeFieldErrors(value) {
    const output = [];
    if (Array.isArray(value)) {
      for (const item of value.slice(0, 32)) {
        if (isRecord(item)) output.push({
          path: typeof item.path === 'string' ? item.path : typeof item.field === 'string' ? item.field : '',
          message: typeof item.message === 'string' ? item.message : '',
        });
      }
    } else if (isRecord(value)) {
      for (const [path, detail] of Object.entries(value).slice(0, 32)) {
        if (typeof detail === 'string') output.push({ path, message: detail });
        else if (Array.isArray(detail)) output.push({ path, message: detail.find((item) => typeof item === 'string') || '' });
        else if (isRecord(detail)) output.push({ path, message: typeof detail.message === 'string' ? detail.message : '' });
      }
    }
    return output;
  }

  function applyServerErrors(fieldErrors, submittedChanges) {
    let first = null;
    for (const error of normalizeFieldErrors(fieldErrors)) {
      const path = error.path.replace(/\[(\d+)\]/g, '.$1');
      let fieldId = null;
      if (path.endsWith('resetSchedule.isoWeekday')) fieldId = 'settings-weekday';
      else if (path.endsWith('resetSchedule.localTime')) fieldId = 'settings-reset-time';
      else if (path.endsWith('resetSchedule.timeZone')) fieldId = 'settings-time-zone';
      else {
        const match = path.match(/billingChanges\.(\d+)\.([A-Za-z]+)$/);
        if (match) {
          const change = submittedChanges[Number(match[1])];
          const tool = change && TOOLS.includes(change.tool) ? change.tool : null;
          const suffix = Object.prototype.hasOwnProperty.call(BILLING_ERROR_SUFFIXES, match[2])
            ? BILLING_ERROR_SUFFIXES[match[2]] : null;
          if (tool && suffix) fieldId = `${tool}-${suffix}`;
        }
      }
      if (fieldId) first ||= fieldError(fieldId, error.message);
    }
    return first;
  }

  function setSubmitting(active) {
    submitting = active;
    surface.setAttribute('aria-busy', String(active));
    saveButton.textContent = active ? 'Saving…' : 'Save changes';
    updateDirtyState();
  }

  async function responseJson(response) {
    try { return await response.json(); }
    catch { return null; }
  }

  async function loadConfig({ initial = false, fromConflict = false } = {}) {
    const request = ++requestSequence;
    if (initial) {
      loading.hidden = false;
      loadError.hidden = true;
      form.hidden = true;
    } else {
      surface.setAttribute('aria-busy', 'true');
      setBanner(fromConflict ? 'conflict' : '', 'Loading current configuration…',
        fromConflict ? 'Your draft remains visible until the latest version loads.' : 'Reading the fixed local configuration.');
    }
    try {
      const response = await fetch(API, { cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' } });
      if (!response.ok) throw new Error('load failed');
      const view = normalizeView(await responseJson(response));
      if (request !== requestSequence) return;
      hydrate(view);
      loading.hidden = true;
      loadError.hidden = true;
      form.hidden = false;
      surface.setAttribute('aria-busy', 'false');
      if (view.recoveryOnly) {
        setBanner('error', 'Recovery required · read only',
          'The current account-config.json could not be validated. The last valid version is shown for recovery review only. Repair or replace the file, then reload; saving is disabled.');
        announce('The last valid account configuration is shown read only. Recovery is required before saving.');
      } else if (view.editable) {
        hideBanner();
        announce(`Configuration version ${view.version} loaded.`);
      } else {
        setBanner('error', 'Account configuration is unavailable',
          'The file could not be validated and no last-valid version is available. Resource links remain read only; saving is disabled.');
        announce('Account configuration is unavailable. Saving is disabled.');
      }
    } catch {
      if (request !== requestSequence) return;
      surface.setAttribute('aria-busy', 'false');
      if (!baseView) {
        loading.hidden = true;
        form.hidden = true;
        loadError.hidden = false;
        announce('Configuration is unavailable. Nothing has been changed.');
      } else if (fromConflict) {
        conflicted = true;
        setBanner('conflict', 'Latest version could not be loaded',
          'Your draft is still visible and unchanged. Try reloading again before saving.', true);
        updateDirtyState();
      } else {
        setBanner('error', 'Refresh failed', 'The loaded configuration and your visible draft are unchanged.');
      }
    }
  }

  async function saveConfig(event) {
    event.preventDefault();
    if (!baseView || !baseView.editable || submitting || conflicted || !isDirty()) return;
    const result = validateDraft();
    if (!result.valid) {
      setBanner('error', 'Review the highlighted fields', 'No changes were saved. Correct each field and confirm every plan action.');
      banner.focus();
      if (result.firstInvalid) result.firstInvalid.focus();
      announce('Validation failed. Review the highlighted fields.');
      return;
    }

    const requestBody = {
      schemaVersion: 1,
      baseVersion: baseView.version,
      resetSchedule: result.schedule,
      billingChanges: result.billingChanges,
    };
    setSubmitting(true);
    setBanner('', 'Saving configuration…', `Validating version ${baseView.version} and writing one atomic local update.`);
    try {
      const response = await fetch(API, {
        method: 'PUT',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          'If-Match': baseView.etag,
          'X-LLMDash-CSRF': baseView.csrfToken,
        },
        body: JSON.stringify(requestBody),
      });
      const payload = await responseJson(response);
      if (response.status === 412 || response.status === 428 || response.status === 403) {
        conflicted = true;
        setBanner('conflict', response.status === 412 ? 'A newer version is available' : 'Configuration proof expired',
          response.status === 412
            ? `This form opened at version ${baseView.version}. Your draft is still visible; reload the latest version before saving.`
            : 'The service may have restarted. Your draft is still visible; reload to obtain the current version and save proof.', true);
        announce('Configuration conflict. Reload the latest version before saving.');
        return;
      }
      if (response.status === 422) {
        clearErrors();
        const first = applyServerErrors(payload && payload.fieldErrors, result.billingChanges);
        setBanner('error', 'The server rejected these fields',
          'Nothing was saved. Review the highlighted fields; the last valid configuration is unchanged.');
        banner.focus();
        if (first) first.focus();
        announce('The server rejected one or more configuration fields.');
        return;
      }
      if (!response.ok) throw new Error('save failed');
      const saved = normalizeView(payload);
      hydrate(saved);
      setBanner('saved', 'Configuration saved',
        `Version ${saved.version} is active. The reset schedule and plan actions were written atomically.`);
      announce(`Configuration saved. Version ${saved.version} is active.`);
    } catch {
      setBanner('error', 'Configuration was not saved',
        `Your draft is still visible. Version ${baseView.version} remains the last confirmed configuration; try again when the service is available.`);
      announce('Configuration was not saved. Your draft is unchanged.');
    } finally {
      setSubmitting(false);
    }
  }

  function populateTimeZones() {
    if (typeof Intl.supportedValuesOf !== 'function') return;
    let zones = [];
    try { zones = Intl.supportedValuesOf('timeZone'); }
    catch { return; }
    const list = byId('settings-time-zone-options');
    const fragment = document.createDocumentFragment();
    zones.forEach((zone) => {
      const option = document.createElement('option');
      option.value = zone;
      fragment.append(option);
    });
    list.append(fragment);
  }

  scheduleEnabled.addEventListener('change', () => {
    setScheduleFieldsEnabled();
    clearErrors();
    if (!conflicted && baseView && baseView.editable) hideBanner();
    updateDirtyState();
  });
  [weekday, resetTime, timeZone].forEach((field) => field.addEventListener('input', () => {
    renderConfiguredProvenance(true);
    field.removeAttribute('aria-invalid');
    const error = byId(`${field.id}-error`);
    if (error) error.hidden = true;
    if (!conflicted && baseView && baseView.editable) hideBanner();
    updateDirtyState();
  }));
  TOOLS.forEach((tool) => {
    byId(`${tool}-action`).addEventListener('change', () => {
      clearErrors();
      updatePlanEditor(tool, true);
      byId(`${tool}-confirm`).checked = false;
      if (!conflicted && baseView && baseView.editable) hideBanner();
      updateDirtyState();
    });
    [`${tool}-amount`, `${tool}-date`, `${tool}-anchor`, `${tool}-confirm`].forEach((id) => {
      byId(id).addEventListener('input', () => {
        byId(id).removeAttribute('aria-invalid');
        const error = byId(`${id}-error`);
        if (error) error.hidden = true;
        if (!conflicted && baseView && baseView.editable) hideBanner();
        updateDirtyState();
      });
    });
  });
  form.addEventListener('submit', saveConfig);
  discardButton.addEventListener('click', () => {
    if (!baseView || conflicted) return;
    hydrate(baseView);
    setBanner('', 'Changes discarded', `Version ${baseView.version} values are restored.`);
    announce('Unsaved changes discarded.');
  });
  byId('settings-reload').addEventListener('click', () => loadConfig({ fromConflict: true }));
  byId('settings-keep-reviewing').addEventListener('click', () => {
    conflictActions.hidden = true;
    announce('Draft remains visible in read-only review. Reload before saving.');
  });
  byId('settings-load-retry').addEventListener('click', () => loadConfig({ initial: true }));
  document.querySelectorAll('.settings-resource-actions a').forEach((link) => {
    link.addEventListener('click', (event) => {
      if (link.getAttribute('aria-disabled') === 'true') event.preventDefault();
    });
  });

  populateTimeZones();
  loadConfig({ initial: true });
  loadClaudeFreshness();
})();
