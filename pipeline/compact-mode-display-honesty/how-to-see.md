## Seeing Compact Mode Display Honesty Locally

1. From the project folder, run:
   `node --test tests/menubar-display.test.js`

2. To inspect the output shape directly, run this compact display preview with an offline remote:
   ```sh
   node --input-type=module <<'NODE'
   import { computeMultiBadge, applyDisplay, emitDisplay, remotesFromCombined } from './scripts/menubar/llmdash.5s.js';
   const now = new Date().toISOString();
   const tool = (remainingPct) => ({
     source: 'claude-code',
     label: 'Claude Code',
     limits: { five_hour: { remainingPct, resetsAt: null }, seven_day: null },
     freshness: { capturedAt: now, freshForMs: 300000, staleAfterMs: 600000 },
     limitsDiagnostic: null,
   });
   const combined = { hosts: [
     { self: true, host: '127.0.0.1', port: 8787, label: 'This machine', reachable: true, state: { tools: [tool(80)] } },
     { self: false, host: 'studio', port: 8788, label: 'Studio', reachable: true, state: { tools: [tool(12)] } },
     { self: false, host: 'down', port: 8789, label: 'Down', reachable: false, hostDiagnostic: { reason: 'peer-unreachable' }, state: null },
   ] };
   const multi = computeMultiBadge(combined, { localMode: 'include' });
   const view = applyDisplay(multi, { hosts: 'all', layout: 'side-by-side', density: 'compact', group: 'host', toolMark: 'neutral' }, { epochMs: 0 });
   console.log(emitDisplay(view, multi, { remotes: remotesFromCombined(combined) }));
   NODE
   ```

3. The first line should be only the menu-bar glyph, starting with `▪` and compact host cells.

4. The second line should be exactly:
   `---`

5. The dropdown detail below that separator should still include the full scope line, such as:
   `Watching 3 machines · 1 not reachable`

6. In the dropdown's Display submenu, the layout and density sections should read as glyph settings: `Glyph layout`, `Glyph density`, `Wide (text glyph)`, and `Compact (tight glyph)`.
