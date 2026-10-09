# Seeing Trends warming and Codex scan state

Use the bundle's tailnet-only HTTPS preview after the coordinator confirms the
final version is running:
`https://hephaestus-developer.giraffe-chuckwalla.ts.net:8982/`.
No terminal or local Mac access is needed.

Scroll to the local Codex activity, deeper insights and Trends sections. Use the
existing 24h, 7d and 30d range switches. A first scan shows the existing reading
message; a failed scan says this machine's local Codex session logs could not be
read. If data was already read successfully, those values and charts remain with
an inline note. The next successful background refresh removes the note.

An empty, successfully scanned machine still shows the existing no-activity
message. The cache improvement is behind the scenes and does not change the
charts or controls. Controlled failure/recovery checks were completed with
disposable fixtures and recorded in `verification.json`; no live log changes are
needed for review.
