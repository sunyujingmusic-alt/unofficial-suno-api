# Suno API Final Guide

This guide documents only the currently verified runtime.
Anything removed from this file should be treated as intentionally out of scope, not forgotten.

For the full end-to-end technical write-up, see:
- `docs/archive/SUNO_API_FULL_TECHNICAL_AUDIT_2026-03-26.md`

## Supported endpoints

- `GET /api/get_limit`
- `GET /api/workspaces` (`?show_trashed=true|1` supported)
- `POST /api/create_precheck`
- `POST /api/captcha_coordinates`
- `PATCH /api/captcha_coordinates`
- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/cover_generate`
- `POST /api/extend_audio`
- `POST /api/mashup_generate`
- `POST /api/song_auto_stems_download`
- `POST /api/studio_multitrack`
- `POST /api/studio/multitrack`
- `POST /api/studio/export`
- `POST /api/studio/generate`
- `GET|POST /api/studio/projects`
- `GET|POST /api/studio/projects/{studio_project_id}`
- `GET /api/studio/projects/{studio_project_id}/versions`
- `GET /api/studio/projects/{studio_project_id}/versions/{version_id}`
- `GET /api/studio/revisions/{revision_id}`
- `POST /api/studio/revisions/{revision_id}/clone`
- `GET|POST /api/studio/media/{clip_id}`
- `GET /api/studio/unverified_actions`
- `GET /api/get?ids=...`
- `POST /api/feed_by_ids`
- `POST /api/upload_reference`
- `GET /api/playback_audio?id=<clip-id>`

## Supported local commands

- `npm run download:account`: archive the authenticated Suno account library
  into a resumable MP3/WAV archive. See `docs/current/SUNO_ACCOUNT_ARCHIVE.md`.

## Verified behavior

- Create currently uses upstream `POST https://studio-api-prod.suno.com/api/generate/v2-web/` through the local `/api/custom_generate` and `/api/generate` routes
- Polling / clip reads currently use `/api/feed/v3`
- `create_precheck` is a diagnostic wrapper around raw `/api/c/check`; it reports `required:true` without solving because a token cannot cross the HTTP request boundary safely
- `captcha_version=1` is an in-page hCaptcha image challenge and normally returns `BROWSER_CAPTCHA_REQUIRED`; the external browser harness keeps the challenge and Create submission in one authenticated page
- `captcha_version=2` uses 2Captcha API v2, solver User-Agent binding, and Suno create in one runtime instance
- `/api/captcha_coordinates` exposes 2Captcha API v2 `CoordinatesTask` for the browser flow; its PATCH method calls `reportIncorrect`
- `verification_status=pending_create` means a token exists but Suno has not accepted it yet
- Default hot-song output root is `./output/hot-songs`; if that
  external-disk path is unavailable, the runtime falls back to
  `./output/hot-songs-fallback`. Override with
  `SUNO_HOT_SONG_OUTPUT_DIR` and `SUNO_HOT_SONG_OUTPUT_FALLBACK_DIR`.
- Default output timestamp timezone is `Asia/Shanghai` unless `SUNO_OUTPUT_TIMEZONE` is overridden
- `custom_generate` can wait for completion and download MP3/WAV to the host-visible output directory
- `cover_generate` uses the same create pipeline with `task=cover` or `task=vox_cover`, accepts `cover_clip_id`, and can optionally inherit / assign the source clip workspace
- `extend_audio` uses the same create pipeline with `task=extend`, accepts `audio_id` and `continue_at`, and can optionally inherit / assign the source clip workspace
- `mashup_generate` uses the same create pipeline with browser-verified `task=mashup_condition`, requires exactly two IDs in `mashup_clip_ids`, and can inherit / assign the first source clip workspace
- `song_auto_stems_download` is pure HTTP by default. It needs only `clip_id`, discovers or creates a stem bank, polls returned IDs, renders WAV/MP3, resumes HTTP downloads, validates at least two media entries, and writes or repairs a JSON manifest. MIDI currently returns 501.
- `studio_multitrack` is pure HTTP by default. It needs a completed `studio_export` clip ID, resolves `raw.metadata.studio_project_id`, reads the exact project state, renders a WAV Multitrack ZIP, and records every track's WAV format plus SHA256 in a sibling manifest.
- `/api/studio/multitrack` is the state-based direct Studio adapter from §25.10. It accepts a Studio project UUID plus captured state, derives missing bounds, fingerprints the exact render request, reuses a verified local ZIP, and otherwise validates the downloaded ZIP with SHA-256, `unzip -tq`, WAV count, and representative-WAV `ffprobe`. Same-fingerprint work is locked; the currently verified format is `wav`.
- `/api/studio/export` maps Full Song and Selected Time Range to the direct `render-state` endpoint. The semantic result is a Library Clip ID, polled through `/api/feed/v3`; it is not a local file download.
- `/api/studio/generate` maps Instrument/Cover to `stem_condition`/`cover_stem_condition`. It is off by default and requires the server paid gate, request confirmation, and a matching `X-Suno-Studio-Token`. A reused idempotency key only polls stored Clip IDs and never recreates the generation.
- Studio Project/Version routes distinguish Workspace Project IDs from Studio Project IDs. The `/api/studio/save-project` wire field `project_id` is forced from the URL Studio ID. Revision clone and archive/unarchive/bookmark/metadata are disabled unverified writes unless the separate gate is explicitly enabled.
- Read-only Studio media kinds are `waveform`, `downbeats`, `midi`, `aligned_lyrics`, `novelty`, `stems`, `stems_pages`, and `projects`; `downbeats_streaming` is the only supported POST kind.
- Both routes use per-clip filesystem locks. Requests for the same archive wait up to `SUNO_STEMS_QUEUE_TIMEOUT_MS` (30 minutes by default), while unrelated clips and all other API operations can run concurrently.
- Stems reuse is keyed only by clip ID and format. `song_title` cannot bypass reuse. Preserve the ZIP and manifest because a cold Auto split was observed to cost 50 credits; verified reuse does not click Extract or consume another 50 credits.
- `upload_reference` supports either JSON `audio_url` uploads or `multipart/form-data` file uploads, and can optionally initialize a clip and assign it to a workspace
- `download:account` lists the account library through `/api/feed/v3`, downloads MP3 directly, triggers Suno-side WAV preparation through `convert_wav`, polls `wav_file_url`, and records resumable local state in `manifest.json`.
- `playback_audio` reads the current progressive `media_urls` entry instead of the replacement `/api/forbidden` `audio_url`. For `encoding=1.0.0`, it requests `/api/mango/rights`, unwraps the content key and IV with SHA-256(JWT) plus AES-GCM using the clip ID as AAD, decrypts the original M4A/Opus payload with AES-CTR big-endian, and never calls Suno Download, WAV conversion, Export, or stems.
- `custom_generate` and `generate` currently export `maxDuration = 600`
- current `wait_audio` cadence is: wait 90s after create success, then poll every 15s, up to 10 rounds
- As of the 2026-04-08 browser captures, the current V5.5 create request uses `mv = chirp-fenix`; legacy `v5`/`chirp-crow` inputs are normalized to `chirp-fenix` before submission
- Workspace is optional. Only `project_id` or `project_name` creates/uses a workspace; with neither, the payload omits `project_id` and relies on Suno's account default
- Recent browser evidence also shows a short captcha trust window: after one successful manual image-captcha solve, later creates in the same browser session could succeed with `token = null`, including after page refresh and a new create window
- The 2026-07-20 controlled browser recovery returned two complete clips while `challenge_detected=false` and `solver_tasks=[]`. It proves the trust-window submission path, not live `CoordinatesTask` acceptance by Suno.

## Out of scope

The following are intentionally not part of this build:

- legacy browser-assisted API routes inside this HTTP service (the external recovery harness is separate)
- swagger-era compatibility surface
- unverified Studio editor writes (Speed/Reverse/Crop/Fade, Extract Stems, Remove FX, Import/Record, Warp, Alternate Takes)
- Playwright-driven server runtime

## Minimal example

### Check credits

```bash
curl http://127.0.0.1:3000/api/get_limit
```

### Copy ordinary playback audio

```bash
curl -fL 'http://127.0.0.1:3000/api/playback_audio?id=<clip-id>' \
  -o ./output/playback.m4a
```

This route is for the currently playable clip and requires the authenticated
Suno cookie configured in the server environment. It does not use the Suno
Download button or any Download/Export/WAV/stems endpoint. The returned file
is the original playback container, commonly M4A with Opus audio.

### Download Auto split stems by song ID

```bash
curl -X POST http://127.0.0.1:3000/api/song_auto_stems_download \
  -H 'Content-Type: application/json' \
  -d '{
    "clip_id": "c86b4e11-b3fe-4b18-9fe3-1049f9d64256",
    "stem_format": "wav"
  }'
```

Use `"dry_run": true` to inspect clip metadata and existing stem banks without extraction or render. A successful response returns `output_path`, `manifest_path`, and `zip_entries`. Repeating the same clip ID and format returns `reused: true` after ZIP validation; a missing or stale manifest is rebuilt automatically. Invalid parameters return structured HTTP 400, and same-clip lock contention returns retryable HTTP 429.

### Download Studio Multitrack by studio_export clip ID

```bash
curl -X POST http://127.0.0.1:3000/api/studio_multitrack \
  -H 'Content-Type: application/json' \
  -d '{
    "clip_id": "eb307b0d-57e6-49b2-99ba-86349b228c2d"
  }'
```

The clip must be `complete`, must have `type=studio_export`, and must contain a valid `studio_project_id`. The API does not accept an arbitrary Studio URL. Default calls reuse the verified archive by clip ID; use `"force_redownload": true` only when a fresh render of the current Studio project state is intentional. Use `"dry_run": true` to validate authenticated metadata, exact project identity, timeline bounds, and track count without submitting render.

### Archive account library

```bash
npm run download:account -- --limit 30
npm run download:account -- --redownload
npm run download:account -- --target-complete 100 --concurrency 2
npm run download:account -- --via-local-api --api-base http://127.0.0.1:3000 \
  --dry-run --target-complete 2
```

Default mode is incremental. It skips completed MP3/WAV files that still exist
locally and downloads only new, missing, or previously failed formats.

`--limit` counts listed candidates and does not prove a full-account scan.
`--target-complete` counts selected clips whose Suno status is `complete`;
`manifest.json` and `runs/<run_id>.json` record `listing.stop_reason` and
`listing.account_scan_complete` so a bounded batch cannot be mistaken for a
complete account archive. The archive uses `.archive.lock`, `.part` files,
HTTP Range resume, atomic publication, SHA-256/`ffprobe` validation, bounded
retry/backoff, and a maximum worker concurrency of three.

When the authenticated cookie exists only inside the running Docker service,
add `--via-local-api` (or `--api-base`) to send the request to
`POST /api/archive_account`; the route reuses the service's authenticated
session. Use `--dry-run` for a read-only preflight. The route accepts archive
options only and constrains output paths to configured output roots.

`GET /api/archive_account?output_dir=...` is a read-only status route for the
same archive root. If a long local API request loses its caller connection,
the CLI reads this status, waits only for the persisted run that began with
that invocation, and returns its final report without resubmitting the archive.
Use `--local-api-request-timeout <sec>` only to set an initial-call guard;
the default is no forced initial timeout. `--local-api-recovery-wait <sec>`
sets the bounded status-monitor window (default 3700 seconds).

### Check current challenge status

```bash
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

### Custom generate with downloads

```bash
curl -X POST http://127.0.0.1:3000/api/custom_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "[Verse]\\n示例歌词\\n[Chorus]\\n示例副歌",
    "style": "Mandopop, bright pop",
    "title": "example_song",
    "model": "chirp-fenix",
    "download_mp3": true,
    "download_wav": true
  }'
```

If no `output_dir` is provided, output will be created under:

`./output/hot-songs/<timestamp>_<slug>`

If `./output/hot-songs` is not writable, the same directory name is
created under `./output/hot-songs-fallback/<timestamp>_<slug>`.

The default timestamp uses `Asia/Shanghai`. You can override that with `SUNO_OUTPUT_TIMEZONE`.
