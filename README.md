# Suno API Final

Minimal Suno HTTP runtime focused on the currently verified path only.

## What this build currently does

- Create songs through `POST /api/generate/v2-web/`
- Poll / read clips through `/api/feed/v3`
- Copy the current ordinary playback media through `GET /api/playback_audio?id=<clip-id>`; encrypted `media_urls` are decrypted locally through Mango rights
- Archive the authenticated account library through `npm run download:account`
- Expose a small Next.js API surface:
  - `GET /api/get_limit`
  - `GET /api/workspaces`
  - supports `?show_trashed=true|1`
  - `POST /api/create_precheck`
  - `POST /api/captcha_coordinates`
  - `PATCH /api/captcha_coordinates` (report an upstream rejection)
  - `POST /api/generate`
  - `POST /api/custom_generate`
  - `POST /api/cover_generate`
  - `POST /api/extend_audio`
  - `POST /api/mashup_generate`
  - `POST /api/song_auto_stems_download`
  - `POST /api/studio_multitrack`
  - `POST /api/studio/multitrack` — direct Studio state → Multitrack ZIP
  - `POST /api/studio/export` — Full Song / Selected Time Range → Library Clip
  - `POST /api/studio/generate` — single-submit-gated Instrument/Cover + poll-only recovery
  - `GET|POST /api/studio/projects` and project/version routes
  - `GET|POST /api/studio/media/:clipId` — read-only media analysis
  - `GET /api/studio/unverified_actions` — P2 catalog only; no upstream write forwarding
  - `POST /api/upload_reference`
  - `GET /api/get?ids=...`
  - `GET /api/playback_audio?id=...` — copy and decrypt current ordinary playback media without calling Suno Download
  - `POST /api/feed_by_ids`
  - `GET|POST /api/archive_account` — authenticated account-library archive
    plus read-only persisted-run status
- In custom mode, wait for completion and optionally download MP3/WAV
- Account archive mode downloads MP3/WAV incrementally with verified `.part`
  resume, SHA-256/ffprobe evidence, atomic manifests, bounded retry/backoff,
  and an output-directory lock. `--target-complete <n>` counts selected
  complete clips; `--limit <n>` only counts listed candidates.
- Default hot-song output root:
  - `./output/hot-songs`

## Important notes

- This runtime now treats `create_precheck` / `/api/c/check` as the explicit first step of create.
- The public `/api/create_precheck` route is diagnostic only. It does not solve a captcha because a token created in that short-lived request cannot be reused by the later create request.
- Branching rule:
  - `required: false` → continue directly to create
  - `required: true, captcha_version: 1` → use the same authenticated browser page for the hCaptcha image challenge and Create submission
  - `required: true, captcha_version: 2` → solve Turnstile through 2Captcha API v2, then continue create in the same `SunoApi` instance
- For this runtime, `required: true` should be interpreted first as a challenge branch, not automatically as cookie invalidation or a broken create endpoint.
- Version 1 does not use a transferable token by default. `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=legacy` is an explicit compatibility opt-in; the normal path returns `BROWSER_CAPTCHA_REQUIRED` so the caller can keep image solving and submission in one browser context.
- Turnstile uses the 2Captcha JSON API v2. The create request adopts the solver-returned User-Agent and matching client hints before the token is submitted.
- Optional `SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL` switches to `TurnstileTask` so 2Captcha and Suno use the same public proxy; without it, `TurnstileTaskProxyless` provides User-Agent binding but not exact IP binding.
- Optional `SUNO_CREATE_CAPTCHA_ACTION`, `SUNO_CREATE_CAPTCHA_CDATA`, and `SUNO_CREATE_CAPTCHA_PAGEDATA` carry Cloudflare challenge-page context when those values are captured.
- A solver result is only `pending_create`; only a successful Suno create response proves that verification passed. Verification-related 422 responses are reported to 2Captcha with `reportIncorrect`.
- `/api/captcha_coordinates` submits a browser-captured challenge image as `CoordinatesTask`. A returned coordinate set is still not proof of verification; the hCaptcha frame must close and the subsequent Suno create must return song IDs.
- `POST /api/cover_generate` accepts `cover_clip_id` and optional `persona_id`, `lyrics`, `style`, `title`, `project_id`, `project_name`, and `force_workspace_assignment` to reproduce the Suno Cover path.
- `POST /api/extend_audio` accepts `audio_id`, `prompt`, `continue_at`, `tags`, `negative_tags`, `title`, `model`, `wait_audio`, and optional workspace arguments to reproduce the Suno Remix/extend path.
- `POST /api/mashup_generate` accepts exactly two source IDs in `mashup_clip_ids` plus optional lyrics, style, title, model, control sliders, wait, and workspace arguments. It maps to the browser-verified `task=mashup_condition` create contract.
- `POST /api/song_auto_stems_download` is pure HTTP by default. It discovers existing Suno stem banks or submits one `gen_stem` transaction, polls generated clip IDs, calls `render-state-multitrack`, downloads WAV/MP3 with resume/retry, validates the ZIP, writes SHA256 plus a manifest, and reuses results by clip ID plus format.
- `POST /api/studio_multitrack` is pure HTTP by default. It resolves `studio_project_id`, reads the exact project state through the Studio API, submits `render-state-multitrack`, validates every WAV header, writes SHA256 plus a manifest, and reuses results by clip ID.
- `POST /api/studio/multitrack` is the direct state-based Studio Multitrack adapter. It derives missing timeline bounds, fingerprints the exact request, serializes same-fingerprint work with a filesystem lock, reuses a verified ZIP, and otherwise performs atomic download + SHA-256 + `unzip -tq` + representative-WAV `ffprobe`. The currently verified format is `wav`.
- `POST /api/studio/export` follows the report's Library semantics: Full Song and Selected Time Range call `render-state`, return a Library Clip ID, and poll `/api/feed/v3`; they are not local-download routes.
- `POST /api/studio/generate` is disabled by default. A new paid submission requires `SUNO_STUDIO_ENABLE_PAID_GENERATION=1`, `confirm_paid_generation=true`, and a matching `X-Suno-Studio-Token`/`SUNO_STUDIO_PAID_API_TOKEN`. The idempotency record is reserved before the only upstream create POST; retries only poll persisted Clip IDs.
- P2 Project mutation adapters (`archive`, `unarchive`, `bookmark`, `metadata`) and Revision clone are also disabled by default through `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0`; the editor write list remains catalog-only.
- Neither production stems path requires Chrome, CDP, page state, click automation, or a browser download directory. The authenticated API session comes from the normal Suno API runtime.
- Song stems default to `./output/suno-stems-downloads`; Studio Multitrack defaults to `./output/suno-studio-multitrack-downloads`. Per-clip filesystem locks allow unrelated clips and all non-stems endpoints to run concurrently.
- Keep the verified ZIP and sibling manifest. A cold Auto split can cost 50 Suno credits; repeated requests reuse the local archive without another Extract, while moving or deleting that archive can make the next call credit-consuming again.
- Interrupted HTTP downloads and submitted stem IDs are persisted in `.inflight` and resumed without a second extraction transaction. Errors are structured, bounded, and redacted; same-clip lock contention is retryable HTTP 429.
- WAV and MP3 Song packaging are supported by the HTTP path. MIDI uses a different transcription contract and currently returns HTTP 501; it must not be advertised as complete.
- Explicit legacy `backend=browser` and opt-in `backend=auto` fallback remain temporarily available for diagnosis, but production defaults and the `suno-stems` CLI always use `backend=http`.
- `npm run download:account` is the production account-library archive command. It lists `/api/feed/v3`, downloads MP3 directly, triggers and polls WAV preparation through `convert_wav`/`wav_file`, and treats the older clip download preparation endpoint as best-effort.
- When `--via-local-api` loses the caller connection after dispatch, the CLI
  reads the same output directory's persisted status and final run report
  instead of blindly resubmitting. It only accepts a run whose start time
  matches the current invocation.
- The container runs the image's built `.next` output; only `public` and host output roots are mounted at runtime.
- The playback route reads `media_urls` rather than the replacement `/api/forbidden` `audio_url`; it never calls Suno Download, WAV, Export, or stems endpoints.
- `custom_generate` and `generate` currently export `maxDuration = 600` to stay aligned with the internal wait/poll path.

## Current execution model

- Model default: `chirp-fenix` (`v5.5` browser-captured default as of 2026-04-08; older `v5` captures used `chirp-crow`)
- Default hot-song output path is host-visible from the container
- Default output timestamp timezone: `Asia/Shanghai` (override with `SUNO_OUTPUT_TIMEZONE`)
- Optional create metadata override: `SUNO_CREATE_USER_TIER`
- Proxy rule:
  - host-side dev may use `127.0.0.1:7890` (for example ClashX on macOS)
  - container runtime must use `host.docker.internal:7890` instead of `127.0.0.1:7890`
  - otherwise the container points proxy traffic at its own loopback and Suno requests fail
- Docker runtime mounts:
  - `./.next -> /app/.next`
  - `./public -> /app/public`
  - `./output -> /app/output`
  - `./studio-state -> /app/.suno-studio-state`

## Validation baseline

A current successful end-to-end validation should look like:

1. `POST /api/create_precheck` runs first and returns the current challenge branch decision
2. if `captcha_version=1`, the caller uses the same-browser hCaptcha flow; if `captcha_version=2`, the runtime uses the Turnstile token flow
3. the selected path continues into create and returns or captures `song_ids`
4. returned clips reach `complete`
5. MP3 + WAV files exist on the host under the output directory when download flags are enabled

Anything outside this scope should be treated as unverified until re-tested.

## Documentation map

- `README.md` — repo overview
- `docs/SUNO_API_GUIDE.md` — supported endpoints and verified behavior
- `docs/SUNO_PLAYBACK_MEDIA.md` — current progressive playback and Mango decryption contract
- `docs/SUNO_API_RUNTIME_SOP.md` — operational runbook for dev/container/challenge handling
- `docs/SUNO_ACCOUNT_ARCHIVE.md` — account-library MP3/WAV archive command, manifest schema, resume behavior
- `docs/SUNO_STUDIO_FEATURE_GUIDE_2026-08-08.md` — detailed Studio function/API contracts and verification boundaries
- `docs/SUNO_STUDIO_OPERATIONS_RUNBOOK_2026-08-08.md` — detailed Studio operations, safety, backup, recovery, and rollback
- `docs/SONG_ID_STEMS_API_2026-08-01.md` — historical browser-backed Song acceptance record; superseded for current operations
- `docs/STUDIO_MULTITRACK_API_2026-08-01.md` — historical browser-backed Studio acceptance record; superseded for current operations
- `docs/STEMS_HTTP_API_AND_CLI_2026-08-01.md` — authoritative pure-HTTP stems contract, CLI, recovery states, acceptance evidence, and production operations
- `docs/SUNO_V55_CAPTURE_2026-04-08.md` — V5.5 browser capture notes, request fields, and captcha trust-window findings
