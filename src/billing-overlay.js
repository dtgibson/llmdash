const DAY_MS = 86_400_000;
const PICOS_PER_CENT = 10_000_000_000n;

function dateParts(value) {
  const [year, month, day] = String(value).split('-').map(Number);
  return { year, month, day };
}

function dateFromOrdinal(ordinal) {
  const value = new Date(ordinal * DAY_MS);
  return `${String(value.getUTCFullYear()).padStart(4, '0')}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function ordinal(value) {
  const { year, month, day } = dateParts(value);
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function addDays(value, count) { return dateFromOrdinal(ordinal(value) + count); }

function absoluteMonth(year, month) { return year * 12 + month - 1; }

function monthParts(index) {
  const year = Math.floor(index / 12);
  return { year, month: index - year * 12 + 1 };
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function monthlyBoundary(year, month, anchorDay) {
  const day = Math.min(anchorDay, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function isMonthlyBoundary(date, anchorDay) {
  const { year, month } = dateParts(date);
  return date === monthlyBoundary(year, month, anchorDay);
}

// Expand only cycles which can intersect the caller's bounded analysis window.
// The anchor is re-applied to every month, so February never causes drift.
export function expandRecurringPlans(plans, { startDate, endDate } = {}) {
  if (!Array.isArray(plans) || !startDate || !endDate || endDate < startDate) return [];
  const windowStartMonth = absoluteMonth(dateParts(startDate).year, dateParts(startDate).month);
  const windowEndMonth = absoluteMonth(dateParts(endDate).year, dateParts(endDate).month);
  const entries = [];
  plans.forEach((plan, planIndex) => {
    const first = dateParts(plan.effectiveStartDate);
    const firstMonth = absoluteMonth(first.year, first.month);
    // One month before the visible start is enough to catch the cycle which
    // began in the prior month and still intersects the first analysis day.
    const firstOffset = Math.max(0, windowStartMonth - firstMonth - 1);
    const lastOffset = Math.min(1212, windowEndMonth - firstMonth + 1);
    for (let offset = firstOffset; offset <= lastOffset; offset++) {
      const current = monthParts(firstMonth + offset);
      const next = monthParts(firstMonth + offset + 1);
      let cycleStart = monthlyBoundary(current.year, current.month, plan.billingAnchorDay);
      let cycleEndExclusive = monthlyBoundary(next.year, next.month, plan.billingAnchorDay);
      if (cycleStart < plan.effectiveStartDate) cycleStart = plan.effectiveStartDate;
      if (plan.effectiveEndDate !== null && cycleEndExclusive > plan.effectiveEndDate) {
        cycleEndExclusive = plan.effectiveEndDate;
      }
      if (cycleEndExclusive <= cycleStart) continue;
      const cycleEnd = addDays(cycleEndExclusive, -1);
      if (cycleEnd < startDate || cycleStart > endDate) continue;
      entries.push({
        tool: plan.tool,
        amountPicos: BigInt(plan.amountCents) * PICOS_PER_CENT,
        startDate: cycleStart,
        endDate: cycleEnd,
        allocationStartDate: cycleStart,
        allocationEndDate: cycleEnd,
        confirmed: true,
        source: 'configured-recurring',
        sourceIndex: planIndex * 2048 + offset,
        planCreatedInVersion: plan.createdInVersion,
      });
      if (plan.effectiveEndDate !== null && cycleEndExclusive >= plan.effectiveEndDate) break;
    }
  });
  return entries.sort(compareEntries);
}

function compareEntries(left, right) {
  return left.tool.localeCompare(right.tool)
    || left.startDate.localeCompare(right.startDate)
    || (left.source === right.source ? 0 : left.source === 'legacy-fixed' ? -1 : 1)
    || left.endDate.localeCompare(right.endDate)
    || (left.sourceIndex || 0) - (right.sourceIndex || 0);
}

function normalizeLegacy(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => ({
    ...entry,
    allocationStartDate: entry.startDate,
    allocationEndDate: entry.endDate,
    source: 'legacy-fixed',
  }));
}

function subtractCoverage(entry, blocking) {
  let fragments = [{ start: ordinal(entry.startDate), end: ordinal(entry.endDate) }];
  for (const block of blocking) {
    const from = ordinal(block.startDate);
    const to = ordinal(block.endDate);
    const next = [];
    for (const fragment of fragments) {
      if (to < fragment.start || from > fragment.end) {
        next.push(fragment);
        continue;
      }
      if (from > fragment.start) next.push({ start: fragment.start, end: from - 1 });
      if (to < fragment.end) next.push({ start: to + 1, end: fragment.end });
    }
    fragments = next;
    if (!fragments.length) break;
  }
  return fragments.map((fragment) => ({
    ...entry,
    startDate: dateFromOrdinal(fragment.start),
    endDate: dateFromOrdinal(fragment.end),
  }));
}

// Explicit legacy periods are historical facts. They win for each covered
// calendar day; recurring cycles are clipped around them while retaining the
// original cycle allocation denominator.
export function overlayBillingSources(legacyEntries, recurringEntries) {
  const legacy = normalizeLegacy(legacyEntries);
  const recurring = [];
  for (const entry of Array.isArray(recurringEntries) ? recurringEntries : []) {
    const blocking = legacy.filter((row) => row.tool === entry.tool
      && row.startDate <= entry.endDate && row.endDate >= entry.startDate);
    recurring.push(...subtractCoverage(entry, blocking));
  }
  return [...legacy, ...recurring].sort(compareEntries);
}

const ACCOUNT_STATES = new Set(['current', 'last-valid', 'empty', 'unavailable']);

export function buildBillingOverlay({
  legacy,
  accountConfig,
  accountConfigState,
  accountConfigReason,
  startDate,
  endDate,
} = {}) {
  const legacyValid = legacy?.status === 'valid';
  const configShapeAvailable = accountConfig && typeof accountConfig === 'object'
    && Array.isArray(accountConfig.recurringPlans);
  // Older pure callers supplied only the parsed config; infer "current" for
  // compatibility. Runtime callers pass the snapshot state so retained data
  // remains usable without being mislabeled as a current on-disk source.
  const accountState = accountConfigState === undefined
    ? (configShapeAvailable ? 'current' : 'unavailable')
    : ACCOUNT_STATES.has(accountConfigState) ? accountConfigState : 'unavailable';
  const configAvailable = configShapeAvailable && accountState !== 'unavailable';
  const recurring = configAvailable
    ? expandRecurringPlans(accountConfig.recurringPlans, { startDate, endDate }) : [];
  const entries = overlayBillingSources(legacyValid ? legacy.entries : [], recurring);
  const sourceReasons = [];
  if (!legacyValid && legacy?.reason) sourceReasons.push(legacy.reason);
  if (accountState === 'last-valid' || !configAvailable) {
    sourceReasons.push(accountConfigReason || 'account_config_unavailable');
  }
  const anyValidSource = legacyValid || configAvailable;
  return {
    status: anyValidSource ? 'valid' : (legacy?.status || 'unavailable'),
    reason: anyValidSource ? null : (legacy?.reason || 'subscription_missing'),
    entries,
    diagnostics: legacyValid ? [...(legacy.diagnostics || [])] : [],
    sourceReasons: [...new Set(sourceReasons)].sort(),
    sources: {
      legacy: legacyValid ? 'current' : (legacy?.status || 'unavailable'),
      recurring: configAvailable ? accountState : 'unavailable',
    },
  };
}

export const billingOverlayConstants = Object.freeze({ picosPerCent: PICOS_PER_CENT });
