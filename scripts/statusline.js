#!/usr/bin/env node
// Claude Code statusline script.
//
// Claude Code pipes a JSON status payload to this script on stdin every time it
// renders the status line. We capture the `rate_limits` block to a file the
// dashboard reads (the sanctioned way to get the authoritative 5-hour / weekly
// numbers), then print a concise status line back to stdout.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => { input += c; });
process.stdin.on('end', () => {
  let data = {};
  try { data = JSON.parse(input); } catch { /* not JSON; still print a line */ }

  // Side effect: capture rate limits for the dashboard.
  if (data && data.rate_limits) {
    try {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(
        config.rateLimitsFile,
        JSON.stringify({ rate_limits: data.rate_limits, capturedAt: new Date().toISOString() })
      );
    } catch { /* never break the status line on a write error */ }
  }

  // Primary output: a short, useful status line.
  const model = (data.model && (data.model.display_name || data.model.id)) || 'Claude';
  const dir = data.workspace && data.workspace.current_dir ? path.basename(data.workspace.current_dir) : '';
  const fh = data.rate_limits && data.rate_limits.five_hour;
  let usage = '';
  if (fh && typeof fh.used_percentage === 'number') {
    usage = ` · 5h ${Math.max(0, 100 - fh.used_percentage).toFixed(0)}% left`;
  }
  process.stdout.write(`${model}${dir ? ' · ' + dir : ''}${usage}`);
});
