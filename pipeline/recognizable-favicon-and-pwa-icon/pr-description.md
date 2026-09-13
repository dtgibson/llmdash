## Recognizable Favicon and PWA Icon

### What this does
Adds the approved llmdash Double dash icon as a deterministic, project-owned
favicon, Apple touch icon, and standard/maskable PWA icon family. Both dashboard
surfaces now reference the local assets and manifest, and the existing Node
server serves every file through its explicit no-store, CSP-protected static
path with the correct MIME type.

### How to test
1. Run `node --test tests/icon-assets.test.js`.
2. Run `npm test`.
3. Start llmdash with `npm start` and open `http://127.0.0.1:8787/`.
4. Confirm the blue Double dash mark appears in the browser tab, then visit
   `http://127.0.0.1:8787/settings.html` and confirm the same mark remains.
5. Open `http://127.0.0.1:8787/manifest.webmanifest` and confirm the 192 px,
   512 px, and maskable 512 px icon records are present.
6. Regenerate or verify the committed exports with
   `node scripts/generate-web-icons.mjs --check`.

### Notes for reviewer
- `scripts/generate-web-icons.mjs` is the zero-dependency source of truth for the
  approved 100-unit Double dash geometry and writes committed production assets;
  the running app does not need an asset build step.
- The favicon exports use the approved rounded silhouette. Apple touch and PWA
  exports are opaque and full bleed so platform launchers can apply their own
  masks; the meaningful bars remain in the central safe region.
- No service worker, offline cache, install prompt, external dependency,
  provider branding, runtime flow, or menu-bar cue changed.
