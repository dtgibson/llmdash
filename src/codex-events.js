import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

const MAX_SAFE = Number.MAX_SAFE_INTEGER;
const MAX_DATE_MS = 8_640_000_000_000_000;
const MAX_JSONL_LINE_CHARS = 1_048_576;
const MIB = 1024 * 1024;
const DEFAULT_SCAN_LIMITS = Object.freeze({
  maxDepth: 12,
  maxEntries: 100_000,
  maxFiles: 20_000,
  maxFileBytes: 256 * MIB,
  maxChangedBytesPerScan: 2 * 1024 * MIB,
  maxEventsPerFile: 250_000,
  maxEventsPerScan: 5_000_000,
  maxResultRecords: 500_000,
  maxCacheFiles: 20_000,
  maxCacheRecords: 500_000,
});
const TOOL_CATEGORIES = Object.freeze(['Shell', 'File edits', 'Search', 'MCP', 'Subagents', 'Other']);
const EMPTY_CAPABILITIES = Object.freeze({
  toolEvents: false,
  compactionEvents: false,
  turnBoundaries: false,
  reasoning: false,
  context: false,
  latency: false,
});

const parsedFileCache = new Map();

function scanLimits(overrides) {
  const source = object(overrides) || {};
  return Object.fromEntries(Object.entries(DEFAULT_SCAN_LIMITS).map(([key, fallback]) => {
    const value = source[key];
    return [key, typeof value === 'number' && Number.isFinite(value) && value >= 1
      ? Math.min(fallback, Math.floor(value)) : fallback];
  }));
}

function scanBudgetError() {
  const error = new Error('Codex session scan exceeded its safety budget');
  error.code = 'CODEX_SCAN_BUDGET';
  return error;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function safeInteger(value, { positive = false } = {}) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const normalized = Math.min(MAX_SAFE, Math.floor(value));
  return positive && normalized === 0 ? null : normalized;
}

function firstNumber(source, names) {
  for (const name of names) {
    if (Object.hasOwn(source, name)) return { present: true, value: safeInteger(source[name]) };
  }
  return { present: false, value: null };
}

function safeAdd(a, b) {
  return Math.min(MAX_SAFE, a + b);
}

function normalizedUsageTuple(value) {
  const source = object(value);
  if (!source) return null;
  const inputField = firstNumber(source, ['input_tokens', 'prompt_tokens', 'input']);
  const outputField = firstNumber(source, ['output_tokens', 'completion_tokens', 'output']);
  const cachedField = firstNumber(source, ['cached_input_tokens', 'cache_read_input_tokens', 'cached_tokens']);
  if (!inputField.present || !outputField.present) return null;
  if (inputField.value === null || outputField.value === null
    || (cachedField.present && cachedField.value === null)) return null;

  const input = inputField.value;
  const output = outputField.value;
  const cached = cachedField.value ?? 0;
  if (cached > input) return null;

  const reasoningField = firstNumber(source, ['reasoning_output_tokens', 'reasoning_tokens']);
  const reasoning = reasoningField.present && reasoningField.value !== null && reasoningField.value <= output
    ? reasoningField.value : null;
  return {
    input,
    cached,
    output,
    reasoning,
    reasoningSupported: reasoningField.present && reasoning !== null,
    total: safeAdd(input, output),
  };
}

function timestampMs(event, payload, ...fallbackNames) {
  const candidates = [event?.timestamp, payload?.timestamp, ...fallbackNames.map((name) => payload?.[name])];
  for (const value of candidates) {
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= MAX_DATE_MS) return Math.floor(value);
    if (typeof value !== 'string' || !value.trim()) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function internalIdentifier(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value)) return `n:${value}`;
  if (typeof value !== 'string' || value.length === 0 || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return `s:${value}`;
}

function normalizeSessionKey(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value)) return value;
  return 'session';
}

export function normalizeCodexModelLabel(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return 'Other';
  const model = value.trim().toLowerCase();
  if (!model || model.length > 48) return 'Other';

  // Preserve known model grammar, not merely a family prefix. Unknown GPT
  // suffixes degrade to the non-sensitive numeric family so a hostile model
  // field cannot smuggle arbitrary text into the aggregate API.
  const gpt = model.match(/^(gpt-\d{1,2}(?:\.\d{1,2}){0,2})(?:-(.+))?$/);
  if (gpt) {
    const suffix = gpt[2];
    if (!suffix || /^(?:codex(?:-(?:mini|max|spark))?|mini|nano|pro|turbo|sol|instant|thinking|chat-latest|\d{4}-\d{2}-\d{2})$/.test(suffix)) return model;
    return gpt[1];
  }
  if (/^o[1-9](?:-(?:mini|pro|preview))?$/.test(model)) return model;
  if (/^codex-(?:mini-latest|latest)$/.test(model)) return model;
  if (/^chatgpt-(?:4o|\d{1,2}(?:\.\d{1,2}){0,2})(?:-latest)?$/.test(model)) return model;
  return 'Other';
}

function normalizeEffort(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const effort = value.trim().toLowerCase().replaceAll('_', '-');
  if (effort === 'minimal') return 'Minimal';
  if (effort === 'low') return 'Low';
  if (effort === 'medium') return 'Medium';
  if (effort === 'high') return 'High';
  if (effort === 'xhigh' || effort === 'x-high') return 'X-high';
  return 'Other';
}

function classifyTool(value, namespace, callType) {
  if (callType === 'local_shell_call') return 'Shell';
  if (callType === 'web_search_call' || callType === 'tool_search_call') return 'Search';
  const name = typeof value === 'string' ? value.slice(0, 256).toLowerCase() : '';
  const ns = typeof namespace === 'string' ? namespace.slice(0, 128).toLowerCase() : '';
  if (name.startsWith('mcp__') || name.startsWith('mcp.') || name.includes('mcp_tool')
    || ns === 'mcp' || ns.startsWith('mcp__') || ns.startsWith('mcp.')) return 'MCP';
  if (/(?:^|[_.:/-])(spawn_agent|send_message|followup_task|wait_agent|interrupt_agent|list_agents|sub_agent)(?:$|[_.:/-])/.test(name)
    || name.includes('collaboration')) return 'Subagents';
  if (/(?:^|[_.:/-])(apply_patch|patch_apply|edit_file|write_file)(?:$|[_.:/-])/.test(name)) return 'File edits';
  if (/(?:^|[_.:/-])(exec_command|write_stdin|shell|terminal|bash|powershell)(?:$|[_.:/-])/.test(name)) return 'Shell';
  if (/(?:^|[_.:/-])(web_search|web__run|search_query|image_query|search)(?:$|[_.:/-])/.test(name)) return 'Search';
  return 'Other';
}

function tokenPayload(event, outerType, payload) {
  let candidates = [];
  if (outerType === 'event_msg' && payload?.type === 'token_count') candidates = [payload];
  else if (outerType === 'token_count') candidates = [payload, event];
  else if (object(event.token_count)) candidates = [event.token_count];
  for (const token of candidates) {
    if (!object(token)) continue;
    const info = object(token.info) || token;
    const last = object(info.last_token_usage) || object(token.last_token_usage) || object(token.usage);
    const usage = normalizedUsageTuple(last);
    if (!usage) continue;
    const cumulative = normalizedUsageTuple(object(info.total_token_usage) || object(token.total_token_usage));
    const directWindow = safeInteger(info.model_context_window ?? token.model_context_window, { positive: true });
    return { usage, cumulative, directWindow, token };
  }
  return null;
}

function fingerprintOf(usage, cumulative, contextWindow) {
  const tuple = (u) => u ? [u.input, u.cached, u.output, u.reasoning, u.total] : null;
  return JSON.stringify([tuple(usage), tuple(cumulative), contextWindow]);
}

function blankResult() {
  return {
    usage: [], completions: [], compactions: [], tools: [],
    capabilities: { ...EMPTY_CAPABILITIES },
  };
}

function *inputLines(input) {
  if (Array.isArray(input)) {
    yield *input;
    return;
  }
  if (typeof input !== 'string') return;

  // Walk in place so a bounded file does not also allocate an unbounded split
  // array. The event budgets below fail atomically rather than publishing a
  // partial session.
  let cursor = 0;
  while (cursor <= input.length) {
    const end = input.indexOf('\n', cursor);
    if (end < 0) {
      if (cursor < input.length) yield input.slice(cursor);
      break;
    }
    yield input.slice(cursor, end);
    cursor = end + 1;
  }
}

// Pure JSONL reducer. Raw IDs are used only as ephemeral map keys; records expose
// deterministic surrogate turn keys and never retain event payloads or content.
export function scanCodexSession(input, sessionKey = 'session', options = {}) {
  const result = blankResult();
  const sid = normalizeSessionKey(sessionKey);
  const limits = scanLimits(options.limits);
  const sharedBudget = object(options.eventBudget);
  const turns = new Map();
  const contexts = new Map();
  const fingerprintsByTurn = new Map();
  const seenCalls = new Set();
  const seenCompletions = new Set();
  const abortedTurns = new Set();
  const seenCanonicalCompactions = new Set();
  const seenFallbackCompactions = new Set();
  const canonicalCompactions = [];
  const fallbackCompactions = [];
  let sawCanonicalCompaction = false;
  let sessionContextWindow = null;
  let nextTurn = 0;
  let activeTurn = null;
  let activeLegacyContext = { model: null, effort: null, contextWindow: null };
  let lastFallbackFingerprint = null;
  let eventsSeen = 0;

  const turnFor = (raw) => {
    const id = internalIdentifier(raw);
    if (!id) return null;
    if (!turns.has(id)) turns.set(id, `turn-${++nextTurn}`);
    result.capabilities.turnBoundaries = true;
    return turns.get(id);
  };
  const contextFor = (turnKey) => {
    if (!turnKey) return activeLegacyContext;
    const own = contexts.get(turnKey);
    if (!own) return activeLegacyContext;
    return {
      model: own.model ?? activeLegacyContext.model,
      effort: own.effort ?? activeLegacyContext.effort,
      contextWindow: own.contextWindow ?? activeLegacyContext.contextWindow,
    };
  };
  const updateContext = (turnKey, patch) => {
    if (turnKey) {
      const previous = contexts.get(turnKey) || { model: null, effort: null, contextWindow: null };
      contexts.set(turnKey, {
        model: patch.model ?? previous.model,
        effort: patch.effort ?? previous.effort,
        contextWindow: patch.contextWindow ?? previous.contextWindow,
      });
    } else {
      activeLegacyContext = {
        model: patch.model ?? activeLegacyContext.model,
        effort: patch.effort ?? activeLegacyContext.effort,
        contextWindow: patch.contextWindow ?? activeLegacyContext.contextWindow,
      };
    }
  };

  for (const line of inputLines(input)) {
    let event;
    if (typeof line === 'string') {
      if (!line.trim()) continue;
      eventsSeen++;
      if (eventsSeen > limits.maxEventsPerFile) throw scanBudgetError();
      if (sharedBudget) {
        sharedBudget.count = safeInteger(sharedBudget.count) ?? 0;
        sharedBudget.count++;
        if (sharedBudget.count > limits.maxEventsPerScan) throw scanBudgetError();
      }
      if (line.length > MAX_JSONL_LINE_CHARS) continue;
      try { event = JSON.parse(line); } catch { continue; }
    } else {
      eventsSeen++;
      if (eventsSeen > limits.maxEventsPerFile) throw scanBudgetError();
      if (sharedBudget) {
        sharedBudget.count = safeInteger(sharedBudget.count) ?? 0;
        sharedBudget.count++;
        if (sharedBudget.count > limits.maxEventsPerScan) throw scanBudgetError();
      }
      event = line;
    }
    event = object(event);
    if (!event) continue;
    const outerType = typeof event.type === 'string' ? event.type : '';
    const rawPayload = object(event.payload);
    const payload = rawPayload || {};
    const innerType = typeof payload.type === 'string' ? payload.type : '';

    const isTaskStarted = (outerType === 'event_msg' && innerType === 'task_started') || outerType === 'task_started';
    const isTurnContext = outerType === 'turn_context' || (outerType === 'event_msg' && innerType === 'turn_context');
    const isTaskComplete = (outerType === 'event_msg' && innerType === 'task_complete') || outerType === 'task_complete';

    if (outerType === 'session_meta') {
      const contextWindow = safeInteger(payload.context_window ?? event.context_window, { positive: true });
      if (contextWindow !== null) {
        result.capabilities.context = true;
        sessionContextWindow = contextWindow;
        updateContext(null, { contextWindow });
      }
      continue;
    }

    if (isTaskStarted) {
      activeTurn = turnFor(payload.turn_id ?? event.turn_id);
      if (activeTurn) {
        abortedTurns.delete(activeTurn);
        seenCompletions.delete(activeTurn);
      }
      lastFallbackFingerprint = null;
      const contextWindow = safeInteger(payload.model_context_window ?? event.model_context_window, { positive: true });
      if (contextWindow !== null) {
        result.capabilities.context = true;
        updateContext(activeTurn, { contextWindow });
      }
      continue;
    }

    if (isTurnContext) {
      const explicitTurn = turnFor(payload.turn_id ?? event.turn_id);
      if (explicitTurn) {
        if (explicitTurn !== activeTurn) lastFallbackFingerprint = null;
        activeTurn = explicitTurn;
      }
      const model = normalizeCodexModelLabel(payload.model ?? event.model);
      const effort = normalizeEffort(payload.effort ?? event.effort);
      const contextWindow = safeInteger(payload.model_context_window ?? event.model_context_window, { positive: true });
      if (contextWindow !== null) result.capabilities.context = true;
      updateContext(activeTurn, { model, effort, contextWindow });
      continue;
    }

    const tokenData = tokenPayload(event, outerType, rawPayload);
    if (tokenData) {
      const explicitTurn = turnFor(payload.turn_id ?? tokenData.token.turn_id ?? event.turn_id);
      const turnKey = explicitTurn || activeTurn;
      const context = contextFor(turnKey) || activeLegacyContext;
      const contextWindow = tokenData.directWindow ?? context?.contextWindow ?? null;
      if (contextWindow !== null) result.capabilities.context = true;
      if (tokenData.usage.reasoningSupported) result.capabilities.reasoning = true;
      const tsMs = timestampMs(event, payload);
      if (tsMs === null) continue;
      const fingerprint = fingerprintOf(tokenData.usage, tokenData.cumulative, contextWindow);
      let duplicate = false;
      if (turnKey && tokenData.cumulative) {
        if (!fingerprintsByTurn.has(turnKey)) fingerprintsByTurn.set(turnKey, new Set());
        const seen = fingerprintsByTurn.get(turnKey);
        duplicate = seen.has(fingerprint);
        if (!duplicate) seen.add(fingerprint);
      } else {
        const fallback = `${turnKey ?? 'legacy'}\u0000${fingerprint}`;
        duplicate = fallback === lastFallbackFingerprint;
        lastFallbackFingerprint = fallback;
      }
      if (duplicate) continue;
      result.usage.push({
        tsMs, sessionKey: sid, turnKey,
        input: tokenData.usage.input,
        cached: tokenData.usage.cached,
        output: tokenData.usage.output,
        reasoning: tokenData.usage.reasoning,
        total: tokenData.usage.total,
        model: context?.model ?? null,
        effort: context?.effort ?? null,
        contextWindow,
      });
      continue;
    }

    if (isTaskComplete) {
      const task = rawPayload || event;
      const turnKey = turnFor(task.turn_id ?? event.turn_id) || activeTurn;
      if (turnKey && abortedTurns.has(turnKey)) {
        if (turnKey === activeTurn) activeTurn = null;
        lastFallbackFingerprint = null;
        continue;
      }
      const durationMs = safeInteger(task.duration_ms);
      const firstTokenMs = safeInteger(task.time_to_first_token_ms);
      if (durationMs !== null || firstTokenMs !== null) result.capabilities.latency = true;
      const tsMs = timestampMs(event, task, 'completed_at');
      const repeated = turnKey !== null && seenCompletions.has(turnKey);
      if (tsMs !== null && !repeated) {
        if (turnKey !== null) seenCompletions.add(turnKey);
        const context = contextFor(turnKey) || activeLegacyContext;
        result.completions.push({
          tsMs, sessionKey: sid, turnKey, durationMs, firstTokenMs,
          model: context?.model ?? null, effort: context?.effort ?? null,
        });
      }
      if (!turnKey || turnKey === activeTurn) activeTurn = null;
      lastFallbackFingerprint = null;
      continue;
    }

    if ((outerType === 'event_msg' && innerType === 'turn_aborted') || outerType === 'turn_aborted') {
      const turnKey = turnFor(payload.turn_id ?? event.turn_id) || activeTurn;
      if (turnKey) {
        abortedTurns.add(turnKey);
        for (let index = result.completions.length - 1; index >= 0; index--) {
          if (result.completions[index].turnKey === turnKey) result.completions.splice(index, 1);
        }
      }
      activeTurn = null;
      lastFallbackFingerprint = null;
      continue;
    }

    const responseItemTs = outerType === 'response_item' ? timestampMs(event, payload) : null;
    if (outerType === 'response_item' && responseItemTs !== null) result.capabilities.toolEvents = true;
    const isInvocation = outerType === 'response_item'
      && (innerType === 'function_call' || innerType === 'custom_tool_call'
        || innerType === 'local_shell_call' || innerType === 'web_search_call'
        || innerType === 'tool_search_call');
    if (isInvocation) {
      const callId = internalIdentifier(payload.call_id ?? payload.id ?? event.call_id);
      if (callId && seenCalls.has(callId)) continue;
      const tsMs = responseItemTs;
      if (tsMs === null) continue;
      if (callId) seenCalls.add(callId);
      const turnKey = turnFor(payload.turn_id ?? event.turn_id) || activeTurn;
      result.tools.push({
        tsMs, sessionKey: sid, turnKey,
        category: classifyTool(payload.name ?? event.name, payload.namespace ?? event.namespace, innerType),
      });
      continue;
    }

    const canonicalCompaction = outerType === 'compacted';
    const fallbackCompaction = outerType === 'event_msg' && innerType === 'context_compacted';
    if (canonicalCompaction || fallbackCompaction) {
      const tsMs = timestampMs(event, payload);
      if (tsMs === null) continue;
      result.capabilities.compactionEvents = true;
      if (canonicalCompaction) sawCanonicalCompaction = true;
      const compaction = rawPayload || event;
      const dedupeId = internalIdentifier(compaction.window_id ?? compaction.compaction_id ?? compaction.id);
      const seen = canonicalCompaction ? seenCanonicalCompactions : seenFallbackCompactions;
      if (dedupeId && seen.has(dedupeId)) continue;
      if (dedupeId) seen.add(dedupeId);
      (canonicalCompaction ? canonicalCompactions : fallbackCompactions).push({ tsMs, sessionKey: sid });
    }
  }

  // Context can appear after a record in legacy/current streams. Fill only
  // missing normalized fields; never retain the context event itself.
  for (const record of [...result.usage, ...result.completions]) {
    const context = record.turnKey ? contexts.get(record.turnKey) : null;
    if (context && record.model === null) record.model = context.model;
    if (context && record.effort === null) record.effort = context.effort;
    if (Object.hasOwn(record, 'contextWindow') && record.contextWindow === null) {
      record.contextWindow = context?.contextWindow ?? sessionContextWindow;
    }
  }
  result.capabilities.latency = result.completions.some((record) => record.durationMs !== null || record.firstTokenMs !== null);
  result.compactions = sawCanonicalCompaction ? canonicalCompactions : fallbackCompactions;
  return result;
}

function mergeCapabilities(target, source) {
  for (const key of Object.keys(EMPTY_CAPABILITIES)) target[key] ||= source?.[key] === true;
}

function recordOrder(a, b) {
  return a.tsMs - b.tsMs
    || String(a.sessionKey).localeCompare(String(b.sessionKey))
    || String(a.turnKey ?? '').localeCompare(String(b.turnKey ?? ''));
}

// Files are parsed in full before the lower timestamp bound is applied, so
// turn/model/context state immediately before the range remains available.
export function scanCodexRollouts(sinceMs, options = {}) {
  const lowerBound = typeof sinceMs === 'number' && Number.isFinite(sinceMs) ? Math.max(0, sinceMs) : 0;
  const io = options.fs || fs;
  const limits = scanLimits(options.limits);
  const nextCache = new Map(parsedFileCache);
  const sessionsDir = path.resolve(options.sessionsDir || config.codexSessionsDir);
  const pruneBeforeMs = typeof options.pruneBeforeMs === 'number' && Number.isFinite(options.pruneBeforeMs)
    ? Math.max(0, options.pruneBeforeMs) : null;
  const rootPrefix = sessionsDir.endsWith(path.sep) ? sessionsDir : `${sessionsDir}${path.sep}`;
  const files = [];
  const discovered = new Set();
  const unreadableSubtrees = [];
  let traversalFailed = false;
  let entriesSeen = 0;
  const visitEntry = (entry, directory, depth) => {
    entriesSeen++;
    if (entriesSeen > limits.maxEntries) throw scanBudgetError();
    const filePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (depth >= limits.maxDepth) throw scanBudgetError();
      walk(filePath, false, depth + 1);
    } else if (entry.isFile() && entry.name.startsWith('rollout-') && entry.name.endsWith('.jsonl')) {
      discovered.add(filePath);
      if (discovered.size > limits.maxFiles) throw scanBudgetError();
      let stat;
      try { stat = io.statSync(filePath); } catch (error) {
        const cached = nextCache.get(filePath);
        if (error?.code !== 'ENOENT' && cached && cached.mtimeMs >= lowerBound) {
          files.push({ filePath, stat: { mtimeMs: cached.mtimeMs, size: cached.size } });
        }
        return;
      }
      if (stat.mtimeMs >= lowerBound) files.push({ filePath, stat });
    }
  };
  const walk = (directory, root = false, depth = 0) => {
    let directoryHandle;
    let entries;
    try {
      if (typeof io.opendirSync === 'function') directoryHandle = io.opendirSync(directory);
      else entries = io.readdirSync(directory, { withFileTypes: true });
    } catch (error) {
      if (root) {
        // An absent root is authoritative deletion/logout state, not a
        // transient read failure. Publish an empty scan and let the broad
        // refresh prune cached parses instead of retaining deleted activity.
        if (error?.code !== 'ENOENT') traversalFailed = true;
      } else if (error?.code !== 'ENOENT') {
        unreadableSubtrees.push(directory.endsWith(path.sep) ? directory : `${directory}${path.sep}`);
      }
      return;
    }
    if (directoryHandle) {
      try {
        let entry;
        while ((entry = directoryHandle.readSync()) !== null) visitEntry(entry, directory, depth);
      } finally {
        try { directoryHandle.closeSync(); } catch {}
      }
    } else {
      for (const entry of entries) visitEntry(entry, directory, depth);
    }
  };
  walk(sessionsDir, true);
  if (traversalFailed) throw new Error('Codex sessions could not be read');

  // If a nested directory is temporarily unreadable, reuse its already parsed
  // files for this refresh. A cold unreadable subtree is skipped independently;
  // it never prevents readable sessions from publishing.
  const queued = new Set(files.map(({ filePath }) => filePath));
  for (const [cachedPath, parsed] of nextCache) {
    if (parsed.mtimeMs < lowerBound || queued.has(cachedPath)) continue;
    if (unreadableSubtrees.some((prefix) => cachedPath.startsWith(prefix))) {
      files.push({ filePath: cachedPath, stat: { mtimeMs: parsed.mtimeMs, size: parsed.size } });
      queued.add(cachedPath);
    }
  }

  // Narrow 24h/7d reads share this parser with the 30d poller refresh. They must
  // not evict older parsed files and force the next poll to re-read them. Only
  // the broad refresh supplies a retention bound; it also removes deleted files
  // within this scan root.
  if (pruneBeforeMs !== null) {
    for (const [cachedPath, parsed] of nextCache) {
      if (!cachedPath.startsWith(rootPrefix)) continue;
      if (unreadableSubtrees.some((prefix) => cachedPath.startsWith(prefix))) continue;
      if (!discovered.has(cachedPath) || parsed.mtimeMs < pruneBeforeMs) nextCache.delete(cachedPath);
    }
  }

  let changedBytes = 0;
  for (const { filePath, stat } of files) {
    const cached = nextCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) continue;
    if (typeof stat.size !== 'number' || !Number.isFinite(stat.size) || stat.size < 0
      || stat.size > limits.maxFileBytes) throw scanBudgetError();
    changedBytes += stat.size;
    if (changedBytes > limits.maxChangedBytesPerScan) throw scanBudgetError();
  }

  const result = blankResult();
  const eventBudget = { count: 0 };
  let resultRecords = 0;
  const appendRecord = (key, record) => {
    resultRecords++;
    if (resultRecords > limits.maxResultRecords) throw scanBudgetError();
    result[key].push({ ...record });
  };
  for (const { filePath, stat } of files) {
    let parsed = nextCache.get(filePath);
    if (!parsed || parsed.mtimeMs !== stat.mtimeMs || parsed.size !== stat.size) {
      let content;
      try { content = io.readFileSync(filePath, 'utf8'); } catch {
        // A prior complete parse is safer than dropping the whole refresh. With
        // no prior value, skip only this file and keep every readable session.
        if (parsed) {
          mergeCapabilities(result.capabilities, parsed.value.capabilities);
          for (const key of ['usage', 'completions', 'compactions', 'tools']) {
            for (const record of parsed.value[key]) if (record.tsMs >= lowerBound) appendRecord(key, record);
          }
        }
        continue;
      }
      const actualBytes = Buffer.byteLength(content, 'utf8');
      if (actualBytes > limits.maxFileBytes) throw scanBudgetError();
      changedBytes += actualBytes - stat.size;
      if (changedBytes > limits.maxChangedBytesPerScan) throw scanBudgetError();
      parsed = {
        mtimeMs: stat.mtimeMs,
        size: stat.size,
        value: scanCodexSession(content, path.basename(filePath), { limits, eventBudget }),
      };
      nextCache.set(filePath, parsed);
    }
    mergeCapabilities(result.capabilities, parsed.value.capabilities);
    for (const key of ['usage', 'completions', 'compactions', 'tools']) {
      for (const record of parsed.value[key]) if (record.tsMs >= lowerBound) appendRecord(key, record);
    }
  }
  for (const key of ['usage', 'completions', 'compactions', 'tools']) result[key].sort(recordOrder);

  const cachedRecordCount = (parsed) => ['usage', 'completions', 'compactions', 'tools']
    .reduce((count, key) => count + parsed.value[key].length, 0);
  let cacheRecords = [...nextCache.values()].reduce((count, parsed) => count + cachedRecordCount(parsed), 0);
  const evictionOrder = [...nextCache.entries()].sort((a, b) => a[1].mtimeMs - b[1].mtimeMs || a[0].localeCompare(b[0]));
  for (const [cachedPath, parsed] of evictionOrder) {
    if (nextCache.size <= limits.maxCacheFiles && cacheRecords <= limits.maxCacheRecords) break;
    nextCache.delete(cachedPath);
    cacheRecords -= cachedRecordCount(parsed);
  }
  parsedFileCache.clear();
  for (const [cachedPath, parsed] of nextCache) parsedFileCache.set(cachedPath, parsed);
  return result;
}

export function usageRecordsFromScan(scan) {
  return (Array.isArray(scan?.usage) ? scan.usage : []).map((record) => ({
    ...record,
    sessionId: record.sessionKey,
  }));
}

export function readCodexUsageRecords(sinceMs, options) {
  return usageRecordsFromScan(scanCodexRollouts(sinceMs, options));
}

export function clearCodexEventCache() {
  parsedFileCache.clear();
}

export { TOOL_CATEGORIES };
