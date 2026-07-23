import path from 'node:path';
import os from 'node:os';
import { isIP, SocketAddress } from 'node:net';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import {
  AccountConfigError, getAccountConfigSnapshot, refreshAccountConfig,
  saveAccountConfig, validateAccountConfigUpdate,
} from './account-config.js';
import { readClaudeLimits } from './claude-limits.js';
import { refreshCostAnalysis } from './cost-analysis.js';
import { selectReset } from './reset-schedule.js';
import { readSecureRegularFile } from './secure-config-file.js';
import { parseStrictJson } from './strict-json.js';
import { readSubscriptions, subscriptionBounds } from './subscriptions.js';
import { rateCardBounds } from './rate-card.js';

const ROUTE = '/api/config/reset-billing';
const BODY_CAP = 32 * 1024;
const VIEW_CAP = 128 * 1024;
const csrfToken = randomBytes(32).toString('base64url');
const FIXED_LINKS = Object.freeze({
  accountConfig: Object.freeze({
    view: `${ROUTE}?resource=account-config&download=0`,
    download: `${ROUTE}?resource=account-config&download=1`,
  }),
  subscriptions: Object.freeze({
    view: `${ROUTE}?resource=subscriptions&download=0`,
    download: `${ROUTE}?resource=subscriptions&download=1`,
  }),
  rateCard: Object.freeze({
    view: `${ROUTE}?resource=rate-card&download=0`,
    download: `${ROUTE}?resource=rate-card&download=1`,
  }),
});
const RESOURCE_QUERIES = new Map([
  ['resource=account-config&download=0', ['accountConfig', false]],
  ['resource=account-config&download=1', ['accountConfig', true]],
  ['resource=subscriptions&download=0', ['subscriptions', false]],
  ['resource=subscriptions&download=1', ['subscriptions', true]],
  ['resource=rate-card&download=0', ['rateCard', false]],
  ['resource=rate-card&download=1', ['rateCard', true]],
]);

function rawHeaderValues(req, name) {
  const wanted = name.toLowerCase();
  const values = [];
  const headers = Array.isArray(req.rawHeaders) ? req.rawHeaders : [];
  for (let index = 0; index + 1 < headers.length; index += 2) {
    if (String(headers[index]).toLowerCase() === wanted) values.push(String(headers[index + 1]));
  }
  if (!headers.length && req.headers?.[wanted] !== undefined) {
    const value = req.headers[wanted];
    if (Array.isArray(value)) values.push(...value.map(String));
    else values.push(String(value));
  }
  return values;
}

function validatedAuthority(req) {
  const values = rawHeaderValues(req, 'host');
  if (values.length !== 1) return null;
  const raw = values[0];
  if (!raw || raw !== raw.trim() || /[\s,@/\\]/.test(raw)) return null;
  try {
    const parsed = new URL(`http://${raw}`);
    if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.host;
  } catch { return null; }
}

function canonicalIp(value) {
  const family = isIP(value);
  if (!family) return null;
  try {
    const address = new SocketAddress({
      address: value, port: 0, family: family === 4 ? 'ipv4' : 'ipv6',
    }).address.toLowerCase();
    // A wildcard IPv6 listener reports IPv4 clients as mapped addresses on
    // some platforms. Treat that representation as the corresponding IPv4
    // destination so a normal literal IPv4 Host still matches.
    if (family === 6 && address.startsWith('::ffff:')) {
      const mapped = address.slice('::ffff:'.length);
      if (isIP(mapped) === 4) return { family: 4, address: mapped };
    }
    return { family, address };
  } catch { return null; }
}

function normalizedHostname(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/\.$/, '');
  return normalized && !canonicalIp(normalized) ? normalized : null;
}

function authorityParts(authority) {
  try {
    const parsed = new URL(`http://${authority}`);
    let hostname = parsed.hostname;
    if (hostname.startsWith('[') && hostname.endsWith(']')) hostname = hostname.slice(1, -1);
    const ip = canonicalIp(hostname);
    return {
      hostname: ip ? null : normalizedHostname(hostname),
      ip,
      port: Number(parsed.port || 80),
    };
  } catch { return null; }
}

function isLoopback(ip) {
  if (!ip) return false;
  if (ip.family === 4) return ip.address.split('.')[0] === '127';
  return ip.address === '::1';
}

function isTailnetIp(ip) {
  if (!ip) return false;
  if (ip.family === 4) {
    const [first, second] = ip.address.split('.').map(Number);
    return first === 100 && second >= 64 && second <= 127;
  }
  // Tailscale's stable IPv6 ULA prefix is fd7a:115c:a1e0::/48.
  return ip.address.startsWith('fd7a:115c:a1e0:');
}

function isMagicDnsName(hostname) {
  if (!hostname) return false;
  const labels = hostname.split('.');
  const dnsLabel = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
  // MagicDNS accepts the node's short name as well as its full
  // machine.tailnet.ts.net form. Both namespaces are trusted only when this
  // connection actually arrived at the machine's tailnet address.
  return (labels.length === 1 || (labels.length >= 4 && hostname.endsWith('.ts.net')))
    && labels.every((label) => dnsLabel.test(label));
}

export function isTrustedResetBillingAuthority(req, authority, {
  machineHostname = os.hostname(), configuredHost = config.host,
} = {}) {
  const requested = authorityParts(authority);
  const localIp = canonicalIp(req?.socket?.localAddress);
  const localPort = Number(req?.socket?.localPort);
  if (!requested || !localIp || !Number.isInteger(localPort)
      || requested.port !== localPort) return false;

  if (requested.ip) {
    return requested.ip.family === localIp.family && requested.ip.address === localIp.address;
  }
  if (requested.hostname === 'localhost') return isLoopback(localIp);

  const machine = normalizedHostname(machineHostname);
  const machineShort = machine?.split('.')[0] || null;
  const pinned = normalizedHostname(configuredHost);
  if (requested.hostname === machine || requested.hostname === machineShort
      || requested.hostname === pinned) return true;

  return isTailnetIp(localIp) && isMagicDnsName(requested.hostname);
}

function sameOrigin(req, authority) {
  const values = rawHeaderValues(req, 'origin');
  if (values.length !== 1 || values[0] === 'null') return false;
  try {
    const parsed = new URL(values[0]);
    return parsed.protocol === 'http:' && !parsed.username && !parsed.password
      && parsed.pathname === '/' && !parsed.search && !parsed.hash
      && parsed.host.toLowerCase() === authority.toLowerCase()
      && values[0] === parsed.origin;
  } catch { return false; }
}

function oneHeader(req, name) {
  const values = rawHeaderValues(req, name);
  return values.length === 1 ? values[0] : null;
}

function constantMatch(candidate, expected) {
  if (typeof candidate !== 'string') return false;
  const left = Buffer.from(candidate);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function jsonHeaders(extra = {}) {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extra,
  };
}

function sendJson(res, status, value, extra = {}) {
  let body = JSON.stringify(value);
  if (Buffer.byteLength(body) > VIEW_CAP) {
    status = 500;
    body = JSON.stringify({ error: 'response_too_large' });
  }
  res.writeHead(status, jsonHeaders({ 'content-length': Buffer.byteLength(body), ...extra }));
  res.end(body);
}

function reject(res, status, error, extras = {}) {
  console.warn(JSON.stringify({ event: 'reset-billing-request-rejected', error, status }));
  sendJson(res, status, { error, ...extras });
}

function currentResetSelection(snapshot, nowMs = Date.now()) {
  let live = null;
  try { live = readClaudeLimits(); } catch {}
  const capturedAtMs = live?.capturedAt ? Date.parse(live.capturedAt) : NaN;
  const ageMs = Number.isFinite(capturedAtMs) ? nowMs - capturedAtMs : Infinity;
  const current = Number.isFinite(ageMs) && ageMs >= -60_000 && ageMs <= config.claudeStaleAfterMs;
  return selectReset({
    nowMs,
    liveAccountReset: live ? {
      current,
      successful: true,
      resetsAt: live.windows?.seven_day?.resetsAt ?? null,
    } : null,
    configuredSchedule: snapshot.config?.resetSchedule ?? null,
    modelLimits: live?.modelLimits || [],
  });
}

let lastSelectionLog = '';
function logSelection(selection) {
  const key = `${selection.source}|${selection.liveStatus}|${selection.configuredStatus}|${selection.corroboratedByModelCap}`;
  if (key === lastSelectionLog) return;
  lastSelectionLog = key;
  console.info(JSON.stringify({
    event: 'reset-selection', source: selection.source,
    liveStatus: selection.liveStatus, configuredStatus: selection.configuredStatus,
    corroboratedByModelCap: selection.corroboratedByModelCap,
  }));
}

export function getResetBillingView({ refresh = true, nowMs = Date.now() } = {}) {
  const snapshot = refresh ? refreshAccountConfig() : getAccountConfigSnapshot();
  const selection = currentResetSelection(snapshot, nowMs);
  logSelection(selection);
  const legacy = readSubscriptions();
  return {
    schemaVersion: 1,
    version: snapshot.config?.version ?? null,
    etag: snapshot.etag,
    csrfToken,
    resetSchedule: snapshot.config?.resetSchedule ?? null,
    recurringPlans: snapshot.config?.recurringPlans ?? [],
    resetSelection: selection,
    sources: {
      accountConfig: { status: snapshot.state, reason: snapshot.reason },
      subscriptions: { status: legacy.status, reason: legacy.reason },
    },
    paths: {
      accountConfig: config.accountConfigFile,
      subscriptions: config.subscriptionsFile,
      rateCard: config.apiRatesFile,
    },
    links: FIXED_LINKS,
  };
}

function resourceDefinition(key) {
  if (key === 'accountConfig') return {
    file: config.accountConfigFile, root: config.dataDir, maxBytes: BODY_CAP, name: 'account-config.json',
  };
  if (key === 'subscriptions') return {
    file: config.subscriptionsFile, root: config.dataDir,
    maxBytes: subscriptionBounds.maxBytes, name: 'subscriptions.json',
  };
  return {
    file: config.apiRatesFile, root: path.dirname(config.apiRatesFile),
    maxBytes: rateCardBounds.maxBytes, name: 'api-rates.json',
  };
}

function sendResource(res, key, download) {
  const resource = resourceDefinition(key);
  let read;
  try { read = readSecureRegularFile(resource.file, { root: resource.root, maxBytes: resource.maxBytes }); }
  catch (error) {
    const missing = error?.code === 'SECURE_TARGET_MISSING';
    const status = missing ? 404 : error?.code === 'SECURE_TARGET_TOO_LARGE' ? 413 : 409;
    return reject(res, status, missing ? 'resource_missing' : 'resource_unavailable');
  }
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'content-disposition': `${download ? 'attachment' : 'inline'}; filename="${resource.name}"`,
    'content-length': read.buffer.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(read.buffer);
}

function readBody(req) {
  return new Promise((resolve, rejectPromise) => {
    const declared = oneHeader(req, 'content-length');
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > BODY_CAP)) {
      const error = new Error('body too large');
      error.code = 'BODY_TOO_LARGE';
      rejectPromise(error);
      return;
    }
    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on('data', (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > BODY_CAP) {
        settled = true;
        const error = new Error('body too large');
        error.code = 'BODY_TOO_LARGE';
        rejectPromise(error);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, bytes));
    });
    req.on('error', (error) => {
      if (settled) return;
      settled = true;
      rejectPromise(error);
    });
  });
}

function contentTypeAllowed(req) {
  const value = oneHeader(req, 'content-type');
  if (value === null) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === 'application/json' || normalized === 'application/json; charset=utf-8';
}

function fetchSiteAllowed(req) {
  const values = rawHeaderValues(req, 'sec-fetch-site');
  return values.length === 0 || (values.length === 1 && values[0].toLowerCase() === 'same-origin');
}

function precondition(req, snapshot) {
  const values = rawHeaderValues(req, 'if-match');
  if (values.length === 0) return { status: 428, error: 'precondition_required' };
  if (values.length !== 1 || values[0].startsWith('W/') || values[0].includes(',')) {
    return { status: 400, error: 'invalid_if_match' };
  }
  if (!snapshot.etag || values[0] !== snapshot.etag) return { status: 412, error: 'version_conflict' };
  return null;
}

export function isResetBillingRoute(rawTarget) {
  return typeof rawTarget === 'string' && rawTarget.split('?')[0] === ROUTE;
}

export async function handleResetBillingRequest(req, res) {
  const authority = validatedAuthority(req);
  if (!authority) return reject(res, 400, 'invalid_host');
  if (!isTrustedResetBillingAuthority(req, authority)) return reject(res, 421, 'untrusted_host');

  const target = String(req.url || '');
  const question = target.indexOf('?');
  const hasQuery = question >= 0;
  const rawPath = question < 0 ? target : target.slice(0, question);
  const rawQuery = question < 0 ? '' : target.slice(question + 1);
  if (rawPath !== ROUTE) return reject(res, 404, 'not_found');
  if (req.method !== 'GET' && req.method !== 'PUT') {
    res.setHeader('allow', 'GET, PUT');
    return reject(res, 405, 'method_not_allowed');
  }

  if (req.method === 'GET') {
    if (!hasQuery) {
      const view = getResetBillingView({ refresh: true });
      return sendJson(res, 200, view, view.etag ? { etag: view.etag } : {});
    }
    const mode = RESOURCE_QUERIES.get(rawQuery);
    if (!mode) return reject(res, 400, 'invalid_query');
    return sendResource(res, mode[0], mode[1]);
  }

  if (hasQuery) return reject(res, 400, 'invalid_query');
  if (!sameOrigin(req, authority) || !fetchSiteAllowed(req)) return reject(res, 403, 'origin_rejected');
  if (!constantMatch(oneHeader(req, 'x-llmdash-csrf'), csrfToken)) return reject(res, 403, 'csrf_rejected');
  if (!contentTypeAllowed(req)) return reject(res, 415, 'unsupported_media_type');
  const current = refreshAccountConfig();
  const proof = precondition(req, current);
  if (proof) return reject(res, proof.status, proof.error, {
    currentVersion: current.config?.version ?? null, etag: current.etag,
  });

  let body;
  try { body = await readBody(req); }
  catch (error) {
    return reject(res, error?.code === 'BODY_TOO_LARGE' ? 413 : 400,
      error?.code === 'BODY_TOO_LARGE' ? 'body_too_large' : 'body_read_failed');
  }
  let parsed;
  try { parsed = parseStrictJson(body, { maxDepth: 8 }); }
  catch (error) { return reject(res, 400, error?.code || 'invalid_json'); }
  try { validateAccountConfigUpdate(parsed); }
  catch (error) {
    if (error instanceof AccountConfigError) {
      return reject(res, 422, 'validation_failed', { fieldErrors: error.fieldErrors });
    }
    return reject(res, 422, 'validation_failed', { fieldErrors: [] });
  }
  if (parsed?.baseVersion !== current.config?.version) {
    return reject(res, 412, 'version_conflict', {
      currentVersion: current.config?.version ?? null, etag: current.etag,
    });
  }

  let saved;
  try { saved = saveAccountConfig(parsed); }
  catch (error) {
    if (error instanceof AccountConfigError) {
      if (error.code === 'version_conflict') return reject(res, 412, 'version_conflict', {
        currentVersion: getAccountConfigSnapshot().config?.version ?? null,
        etag: getAccountConfigSnapshot().etag,
      });
      if (error.code === 'source_unavailable' || error.code === 'version_exhausted'
        || error.code === 'commit_indeterminate') {
        return reject(res, 409, error.code);
      }
      return reject(res, 422, 'validation_failed', { fieldErrors: error.fieldErrors });
    }
    console.error(JSON.stringify({ event: 'reset-billing-save-failed', error: 'atomic_write_failed' }));
    return reject(res, 500, 'save_failed');
  }
  console.info(JSON.stringify({
    event: 'reset-billing-config-saved', timestamp: saved.config.updatedAt,
    changedFields: saved.changedFields, version: saved.config.version,
  }));
  // Keep log/config traversal off the request path. The validated config cache
  // is already live; recompute the cost snapshot immediately after this response
  // yields, rather than waiting up to one poll interval.
  setImmediate(() => {
    try { refreshCostAnalysis(); } catch {}
  });
  const view = getResetBillingView({ refresh: false });
  return sendJson(res, 200, view, { etag: view.etag });
}

export const resetBillingApi = Object.freeze({ route: ROUTE, bodyCap: BODY_CAP, viewCap: VIEW_CAP, links: FIXED_LINKS });
