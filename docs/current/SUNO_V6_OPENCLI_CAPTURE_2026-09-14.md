# Suno V6 OpenCLI Probe — 2026-09-14

This note records the read-only probe performed before the V6 compatibility update.
No Create, Cover, upload, captcha solve, or other credit-consuming action was run.

## Probe environment

- Target: `https://suno.com/create`
- OpenCLI: `1.7.2`
- Browser bridge: unavailable (`opencli doctor` reported the extension was not connected)
- OpenClaw CDP: `http://127.0.0.1:18800` was not listening in this session
- Public-page fallback: the page redirected to the unauthenticated home route; its loaded bundles were inspected read-only

## Findings

The public Suno bundle exposes the model tier mapping used by the web client:

| UI model | Upstream `mv` / `model_name` |
| --- | --- |
| Suno V6 | `chirp-hawk` |
| Suno V6 Wild | `chirp-hawk-wild` |
| Suno V6 Mini | `chirp-goose` |

The current page also advertises V6 content and the bundle keeps the generation
endpoint literal `/api/generate/v2-web/`. The existing runtime already posts to
that endpoint with the same `prompt`, `tags`, `title`, `negative_tags`,
`make_instrumental`, captcha, metadata, and transaction fields, so the upgrade
only changes model selection rather than the request transport contract.

## Compatibility decision

- Default model is now `chirp-hawk`.
- `SUNO_CREATE_MODEL` controls the default for requests that omit `model` and uses the same normalization rules.
- `v6`, `suno-v6`, and `hawk` normalize to `chirp-hawk`.
- `v6-wild`, `suno-v6-wild`, and `hawk-wild` normalize to `chirp-hawk-wild`.
- `v6-mini`, `suno-v6-mini`, and `goose` normalize to `chirp-goose`.
- Retired V5 aliases (`v5`, `v5.5`, `chirp-crow`, and `chirp-fenix`) normalize to
  `chirp-hawk` so existing clients do not send removed upstream IDs.

The probe intentionally stopped before any paid or authenticated Create action.
An authenticated live request capture can be added later when the managed Suno
CDP/browser bridge is available; it is not required to apply the verified model
ID mapping above.
