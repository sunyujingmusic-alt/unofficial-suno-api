# Suno API Final Runtime SOP

This document is the operational SOP for the currently verified `suno-api-final` runtime.

It focuses on three things only:

1. how to run the service in stable day-to-day mode
2. what is currently verified about create / polling / challenge handling
3. how to tell whether the runtime is healthy

---

## Recommended runtime modes

### 1. Host-side dev / debugging

Use when actively editing TypeScript or inspecting challenge behavior:

```bash
cd <repo-root>
npx next dev -p 3000
```

Notes:

- host-side `.env` may point proxy vars to `127.0.0.1:7890`
- this mode is best for rapid iteration and live debugging
- this is **not** the preferred long-running production-style mode

### 2. Preferred steady-state runtime: Docker container on port 3000

Use when code is already built and you want a stable resident service:

```bash
cd <repo-root>
npm run build
docker compose up -d --no-build suno-api
```

Current compose behavior:

- container serves `next start`
- local `.next` is mounted into container
- `public/` is mounted into container
- hot-song output root is bind-mounted to the host
- container proxy defaults to `http://host.docker.internal:7890`

### Host-vs-container proxy rule (important)

If the host uses a local desktop proxy such as ClashX on:

- `127.0.0.1:7890`

then the correct interpretation is:

- **host-side dev runtime** may use `127.0.0.1:7890`
- **container runtime** must use `host.docker.internal:7890`

Why:

- inside the container, `127.0.0.1` means the container loopback, not the host
- so `127.0.0.1:7890` inside Docker will usually fail to reach the host proxy
- `host.docker.internal:7890` is the correct way for the containerized API to reach the host-side ClashX proxy

This avoids the classic container problem where `127.0.0.1:7890` points to the container itself instead of the host.

---

## Health checks

### Credits / reachability

```bash
curl http://127.0.0.1:3000/api/get_limit
```

Healthy result should return JSON like:

```json
{"credits_left":6657,"period":"year","monthly_limit":10000,"monthly_usage":3344}
```

### Workspace listing

```bash
curl http://127.0.0.1:3000/api/workspaces
```

### Challenge state probe

```bash
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

Interpretation:

- local `{\"required\":false}` may mean either raw upstream `required:false`, or raw upstream `required:true` that the local runtime already solved
- local `{\"required\":false,\"solved\":true}` specifically means raw upstream challenge was active and was solved through 2Captcha in this runtime
- this result should not be treated as a raw passthrough mirror of upstream `/api/c/check`
- the raw upstream semantics still remain: `required:true` means challenge is active, not that create must fail

---

## Verified API behavior

### Create path

Verified real create endpoint:

```http
POST /api/generate/v2-web/
```

### Polling / clip read path

Verified polling endpoint:

```http
POST /api/feed/v3
```

### Current local surface exposed by this build

- `GET /api/get_limit`
- `GET /api/workspaces`
- `POST /api/create_precheck`
- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/song_auto_stems_download`
- `POST /api/studio_multitrack`
- `POST /api/studio/multitrack`
- `POST /api/studio/export`
- `POST /api/studio/generate` (disabled unless the explicit paid gate is enabled)
- `GET|POST /api/studio/projects` plus project/version routes
- `GET|POST /api/studio/media/{clip_id}`
- `GET /api/studio/unverified_actions`
- `GET /api/get?ids=...`
- `POST /api/feed_by_ids`

### Current local command surface

- `npm run download:account` archives the authenticated account library into a
  resumable MP3/WAV folder with `manifest.json` as the canonical ledger.

Detailed Studio references:

- `docs/SUNO_ACCOUNT_ARCHIVE.md` — account archive command and manifest schema
- `docs/SUNO_STUDIO_OPENCLI_RUNTIME.md` — implementation index
- `docs/SUNO_STUDIO_FEATURE_GUIDE_2026-08-08.md` — function/API guide
- `docs/SUNO_STUDIO_OPERATIONS_RUNBOOK_2026-08-08.md` — operations, recovery, and rollback

### Auto split stems by song ID

The production stems route is pure HTTP. It uses the same authenticated Suno API runtime as the other endpoints; Chrome/CDP is not a production dependency.

```bash
curl -X POST http://127.0.0.1:3000/api/song_auto_stems_download \
  -H 'Content-Type: application/json' \
  -d '{"clip_id":"SONG_ID","stem_format":"wav"}'
```

Operational rules:

- the same clip ID and format are protected by a cross-process filesystem lock; unrelated work can run concurrently
- output defaults to `/Volumes/TR200/suno-stems-downloads`
- success requires a non-empty ZIP, `unzip -t` success, at least two WAV/MP3 entries, and a sibling `.zip.json` manifest
- repeat calls for the same song ID and format reuse the verified ZIP and do not submit Extract again
- `song_title` is only an output filename hint; the reuse key is exactly clip ID plus format
- preserve the ZIP and sibling manifest because a cold Auto split was observed to cost 50 credits; moving or deleting the ZIP can make a later call charge again
- a missing or stale manifest is regenerated from the verified ZIP before a reuse response is returned
- public responses exclude authentication data and raw upstream payloads; errors are bounded and redacted
- failed runs retain their `.inflight` directory for diagnosis; successful runs clean it by default

### Studio Multitrack by studio_export clip ID

This route resolves the exact Studio project and renders it through HTTP. It does not accept a caller-supplied Studio URL because the clip metadata is the authoritative project mapping.

```bash
curl -X POST http://127.0.0.1:3000/api/studio_multitrack \
  -H 'Content-Type: application/json' \
  -d '{"clip_id":"STUDIO_EXPORT_CLIP_ID"}'
```

Operational rules:

- metadata lookup uses the existing authenticated `/api/feed/v3` path
- input must resolve to `status=complete`, `type=studio_export`, and a valid `raw.metadata.studio_project_id`
- the API fetches `/api/studio/project/<studio_project_id>`, requires the returned ID to match, and derives render bounds from the exact project state
- success requires HTTP 2xx plus `download_url` from `render-state-multitrack`
- success also requires a completed HTTP download, a non-empty ZIP, `unzip -tqq`, only non-empty WAV entries, valid WAV headers for every track, and SHA256
- output defaults to `/Volumes/TR200/suno-studio-multitrack-downloads`
- the final filename includes the clip ID and has a sibling `.zip.json` manifest containing project IDs, export evidence, per-track audio parameters, SHA256, and credits before/after when available
- repeat calls reuse the verified archive by clip ID and do not click Export again; `force_redownload=true` is the explicit opt-in for a new render of the project's current state
- `dry_run=true` performs metadata, exact-project, timeline, and track checks without submitting render
- pure-HTTP Multitrack render was observed not to consume credits and does not call `save-project`
- failed runs retain `.inflight/<clip-id>-<run-id>` for diagnosis, while successful runs clean it by default

If the endpoint returns `STUDIO_PROJECT_MISMATCH`, do not retry blindly. That error means the browser saved a different project from the one mapped by the input clip, so the produced ZIP must not be published or associated with the requested ID.

### Account library archive

Use this command to download the authenticated Suno account library:

```bash
npm run download:account
```

Operational rules:

- output defaults to `SUNO_ACCOUNT_ARCHIVE_DIR` or `output/suno-account-archive`
- default formats are MP3 and WAV
- WAV is prepared by calling `convert_wav`, then polling `wav_file_url`
- `manifest.json` is rewritten after every clip, so interrupted runs resume by rerunning the same command
- default reruns skip already completed files that still exist locally
- `--redownload` is the explicit opt-in for refreshing existing files
- `--target-complete <n>` continues feed pagination until `n` complete clips have
  been selected; it is distinct from `--limit <n>`, which only limits listed
  candidates. The result reports `stop_reason` and
  `account_scan_complete` explicitly.
- `--concurrency <1-3>` controls independent clip workers; unattended jobs
  should keep the default `1` until a small real run validates a higher value.
- `.archive.lock` is an output-directory process lock. Do not remove it while
  its recorded PID is alive; `--recover-stale-lock` is only for a dead owner
  older than two hours.
- Media is first written to `<file>.part`, resumed with HTTP Range when
  supported, validated by size/SHA-256/`ffprobe`, and atomically renamed.
- Listing, WAV preparation/polling, and downloads retry transient 408, 429,
  5xx/Cloudflare 52x, timeouts, and connection failures with bounded
  exponential backoff, jitter, and numeric `Retry-After`. A signed URL
  401/403/404 refreshes clip metadata once before retrying.
- Per-clip stage timings and retry counts are retained in schema-version-4
  manifest entries and run reports; signed URLs and credentials are never
  persisted.
- When the container has the authenticated session, the CLI can use the
  container-local API instead of requiring a host-side cookie:

  ```bash
  npm run download:account -- \
    --via-local-api \
    --api-base http://127.0.0.1:3000 \
    --dry-run --target-complete 2
  ```

  This mode is read-only with `--dry-run`; it reuses the container's existing
  authentication and never prints or exports the cookie.
- For a long real archive, the CLI no longer converts a dropped caller
  connection directly into a failed job. It monitors the read-only
  `GET /api/archive_account?output_dir=...` status for the same folder,
  verifies the persisted run started with this invocation, then returns the
  completed `runs/<run_id>.json` result. It never resubmits automatically.
- signed media URLs are not stored in the manifest or run report

---

## Challenge / captcha status

## Context-binding repair (2026-07-20)

Suno's observed create check is versioned: `captcha_version=1` is hCaptcha and `captcha_version=2` is Turnstile. They must not share a solver path.

- `/api/create_precheck` only reports whether a challenge is required; it never spends a solve that would be discarded when the request ends.
- Version 1 defaults to `BROWSER_CAPTCHA_REQUIRED`. The external harness captures the hCaptcha challenge, calls `/api/captcha_coordinates`, clicks the returned points, and submits Create in the same authenticated page.
- Version 2 uses 2Captcha API v2. `create()` performs challenge check, solve, and Suno submission in the same `SunoApi` instance.
- The solver-returned `userAgent` replaces both `User-Agent` and matching client-hint headers before Suno create metadata and the create request are sent.
- With `SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL`, both the Suno HTTP client and 2Captcha `TurnstileTask` use the same public HTTP(S) proxy.
- `action`, `cData`, and `chlPageData` can be supplied through `SUNO_CREATE_CAPTCHA_ACTION`, `SUNO_CREATE_CAPTCHA_CDATA`, and `SUNO_CREATE_CAPTCHA_PAGEDATA` when Suno exposes a managed Cloudflare challenge rather than a standalone Turnstile token gate.
- A 2Captcha `ready` response means only that the solver produced a token. The runtime records verification as `pending_create` until Suno accepts the create request.
- A verification-related Suno 422 calls 2Captcha API v2 `reportIncorrect` for the exact task id.
- The browser harness also reports an incorrect `CoordinatesTask` when selections leave the control in Skip state or the challenge image remains unchanged after submission.

Exact IP binding requires a public proxy that is reachable by both the local runtime and 2Captcha. Do not put `host.docker.internal`, `127.0.0.1`, or a LAN-only proxy in `SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL`.

### Current 2Captcha feature assessment

- `CoordinatesTask` is the general same-browser image-click method. Send a CSS-pixel screenshot no larger than 1000px on either side and 600 kB, plus an explicit English instruction.
- `GridTask` adds `rows`, `columns`, `previousId`, click limits, and `canNoAnswer`. It is a possible future optimization only after a live Suno grid challenge exposes stable tile geometry.
- `GridTask.imgType` computer-vision acceleration is documented only for reCAPTCHA and FunCaptcha. Do not set `imgType=recaptcha` for Suno hCaptcha.
- `reportIncorrect` is feedback and possible refund review; it does not repair a bad browser, IP, sitekey, or challenge context.
- The current API v2 index does not expose a dedicated hCaptcha token task. Legacy token mode remains opt-in and is not the default Suno path.

### Verification status

The March runtime was historically verified end-to-end for its then-current challenge path. A July regression proved that treating `captcha_version=1` as Turnstile produced 2Captcha tokens that Suno rejected with 422.

On 2026-07-20 the repaired same-browser route produced two complete clips and valid local MP3s, but no fresh image challenge appeared: `challenge_detected=false`, `solver_tasks=[]`. This validates the browser/account trust-window route only. A naturally occurring version-1 challenge is still required before claiming that live `CoordinatesTask` recognition passed Suno verification.

### Real successful validation result

Confirmed successful smoke-test `song_ids`:

- `4cae35fd-e204-4c1e-affa-a5bf9197f814`
- `22bf6781-ea02-40b6-b4c2-c400996fa72a`

Smoke test workspace/output root used during validation:

- `<workspace>/tmp/suno-2captcha-smoke`

### Important implementation note

The final blocker was not invalid 2Captcha parameters.
It was a polling bug:

- wrong: `sleep(5000)`
- correct: `sleep(5)`

Because `sleep()` expects seconds in this runtime, the wrong value caused the server to appear stuck after captcha task submission.

---

## Minimal validation flow

A healthy end-to-end validation now looks like:

1. `POST /api/create_precheck`
2. branch by `captcha_version`: version 1 stays in the authenticated browser; version 2 stays in one `SunoApi` instance
3. for a visible version-1 challenge, require `challenge_detected=true`, at least one `solver_task`, challenge closure, and a subsequent successful Suno generate response
4. for version 2, require a Suno-accepted create response after the 2Captcha token; `ready` alone is insufficient
5. submit only after title, lyrics, and styles are re-read and exactly match the requested values
6. runtime receives `song_ids`
7. after create success, `wait_audio` first waits 90s before polling
8. runtime polls every 15s, up to 10 rounds, while route `maxDuration` allows 600s
9. polling reaches `complete`
10. optional MP3/WAV downloads land on the host

---

## Operational guidance

### If host-side dev works but container 3000 fails immediately

First suspect container proxy target mismatch.

Common bad pattern:

- container inherits `HTTP_PROXY=http://127.0.0.1:7890`

Inside a container that points to the container loopback, not the host proxy.

Preferred fix:

- container runtime uses `http://host.docker.internal:7890`

### If logs stop after `2Captcha task submitted`

First suspect challenge polling logic, not 2Captcha credentials.

Specifically re-check:

- polling interval units
- whether `sleep()` expects seconds or milliseconds
- whether the code path ever logs `Turnstile token obtained`

### If create returns `Token validation failed`

Interpretation now should be:

- the challenge token was rejected upstream
- this is not the same thing as generic proxy failure
- compare:
  - challenge token freshness
  - auth/session state
  - exact create request timing/context

---

## Related documents

- `README.md` — short repo overview
- `docs/SUNO_API_GUIDE.md` — endpoint and behavior guide
- `docs/SUNO_API_RUNTIME_SOP.md` — this operational SOP
- external findings archive:
  - `suno-create-challenge-findings-2026-03-25.md`
  - `suno-api-final-2captcha-validation-2026-03-26.md`
