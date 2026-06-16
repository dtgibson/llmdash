import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      captured_at TEXT NOT NULL,
      source TEXT NOT NULL,
      window TEXT NOT NULL,
      used_pct REAL NOT NULL,
      resets_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_usage_source_window_time
      ON usage_snapshots (source, window, captured_at);
  `);
  return db;
}

// Insert a snapshot unless the most recent one for this (source, window) is
// within the dedup window AND unchanged. Keeps the series meaningful and the
// file small (PRD OQ-03). Returns true if a row was written.
export function insertSnapshot({ capturedAt, source, window, usedPct, resetsAt }) {
  const d = getDb();
  const last = d.prepare(
    `SELECT captured_at, used_pct FROM usage_snapshots
     WHERE source = ? AND window = ? ORDER BY captured_at DESC LIMIT 1`
  ).get(source, window);
  if (last) {
    const ageMs = Date.parse(capturedAt) - Date.parse(last.captured_at);
    if (ageMs < config.dedupWindowMs && Number(last.used_pct) === Number(usedPct)) {
      return false;
    }
  }
  d.prepare(
    `INSERT INTO usage_snapshots (captured_at, source, window, used_pct, resets_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(capturedAt, source, window, usedPct, resetsAt ?? null);
  return true;
}

// Latest stored snapshot for each window of a source.
export function getLatestPerWindow(source) {
  const d = getDb();
  return d.prepare(
    `SELECT window, used_pct, resets_at, MAX(captured_at) AS captured_at
     FROM usage_snapshots WHERE source = ? GROUP BY window`
  ).all(source);
}

// A window's series since a given ISO timestamp (foundation for feature 3).
export function getSeries(source, window, sinceIso) {
  const d = getDb();
  return d.prepare(
    `SELECT captured_at, used_pct, resets_at FROM usage_snapshots
     WHERE source = ? AND window = ? AND captured_at >= ?
     ORDER BY captured_at ASC`
  ).all(source, window, sinceIso);
}
