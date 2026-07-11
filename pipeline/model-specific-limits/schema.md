# Schema: Model-Specific Limits

## Statusline Reading File

Existing account-wide shape is preserved:

```json
{
  "rate_limits": {
    "five_hour": { "used_percentage": 77, "resets_at": 1782976800 },
    "seven_day": { "used_percentage": 25, "resets_at": 1783144800 }
  },
  "capturedAt": "2026-07-02T06:42:00.000Z"
}
```

Model-specific caps add an optional top-level array:

```json
{
  "model_limits": [
    {
      "source": "claude-model:fable",
      "provider": "claude-code",
      "model": "fable",
      "label": "Fable",
      "window": "seven_day",
      "used_percentage": 49,
      "resets_at": 1783144800
    }
  ]
}
```

## API Tool Shape

Each tool now includes:

```json
{
  "modelLimits": [
    {
      "source": "claude-model:fable",
      "provider": "claude-code",
      "model": "fable",
      "label": "Fable",
      "window": "seven_day",
      "usedPct": 49,
      "remainingPct": 51,
      "resetsAt": "2026-07-04T06:00:00.000Z",
      "capturedAt": "2026-07-02T06:42:00.000Z"
    }
  ]
}
```

## Persistence

No database migration. Model cap history uses existing `usage_snapshots` rows:

- `source`: `claude-model:<model-slug>`
- `window`: the cap window, currently `seven_day`
- `used_pct`, `resets_at`, `captured_at`: existing columns

This keeps account-wide Claude snapshots at `source = claude-code` unchanged.
