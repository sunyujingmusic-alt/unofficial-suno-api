# Suno API Final — Open-Source Production Snapshot

This directory is the sanitized open-source snapshot prepared from the production
runtime on August 11, 2026. It is an unofficial Suno integration for research,
automation, and interoperability testing.

It is not affiliated with, authorized by, or endorsed by Suno. Use only with
your own account and follow Suno's terms, copyright rules, and local law.

## What is included

The snapshot contains the current generic API and CLI implementation for:

- account credits, workspaces, clip lookup, polling, and feed-by-ID queries;
- prompt-mode and custom-mode song generation;
- create precheck and supported 2Captcha-assisted challenge handling;
- reference-audio upload;
- Cover generation;
- Extend / Remix generation;
- two-source Mashup generation;
- Studio concat of ordered clips;
- resumable download of the authenticated account's song library;
- Song Auto Split stems in WAV or MP3;
- Studio Multitrack ZIP rendering and download;
- Studio projects, versions, revisions, media analysis, export, multitrack, and
  gated paid generation.

The historical non-original audio-slicing upload route is not included.

## What is intentionally excluded

The open-source package does not contain:

- `.env`, live cookies, cookie backups, API keys, proxy credentials, or tokens;
- production output, downloaded music, ZIP files, `.part` files, manifests, or
  Studio state;
- local browser profiles, captured signed URLs, runtime logs, or packet captures;
- `.next`, `node_modules`, historical build trees, or private backup directories;
- machine-specific home-directory or external-volume defaults.

## Beginner deployment guide

For a zero-to-deployment Docker Desktop tutorial written for users without a
software engineering background, see:

- [中文：从 0 开始手动部署教程](docs/BEGINNER_DEPLOYMENT_GUIDE_ZH.md)

## Quick start

Requirements:

- Node.js 20 or newer, or Docker with Docker Compose;
- a valid cookie for your own Suno account;
- `ffmpeg`/`ffprobe` and `unzip` for local media validation when not using Docker;
- optional 2Captcha credentials for unattended challenge handling.

### Docker Compose

```bash
cp .env.example .env
# Edit .env and set SUNO_COOKIE. Keep the file private.
docker compose up --build -d
```

Open the local documentation page:

```text
http://127.0.0.1:3000/docs
```

The container health check uses `/docs`, which verifies the local service
without making a request to Suno.

### Local Node.js

```bash
cp .env.example .env
npm ci
npm run dev
```

### First read-only checks

```bash
curl http://127.0.0.1:3000/api/get_limit
curl http://127.0.0.1:3000/api/workspaces
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

`create_precheck` is diagnostic. It does not generate a song and does not prove
that a later create request has succeeded.

## Account library archive

The account archive is the recommended way to download and maintain a local,
incremental copy of the authenticated account's songs.

### Basic command

```bash
npm run download:account
```

The default command:

- scans the account feed with cursor pagination;
- selects clips whose upstream status is `complete`;
- downloads both MP3 and WAV;
- writes through `<file>.part` and atomically publishes only verified files;
- supports HTTP Range resume when the media server supports it;
- records byte size, SHA-256, response metadata, and `ffprobe` evidence;
- writes a canonical `manifest.json`;
- writes a separate `runs/<run_id>.json` report for every execution;
- locks one output directory so scheduled and manual jobs cannot overwrite each
  other;
- retries transient 408, 429, 5xx, and Cloudflare 52x failures with bounded
  exponential backoff and jitter;
- refreshes expired signed media URLs before retrying a download;
- resumes missing or failed formats without regenerating a song.

### Download exactly 20 completed songs

For a direct host-side run:

```bash
npm run download:account -- \
  --target-complete 20 \
  --output-dir ./output/suno-account-archive-test20
```

For a Docker-hosted API:

```bash
npm run download:account -- \
  --via-local-api \
  --api-base http://127.0.0.1:3000 \
  --target-complete 20 \
  --output-dir /app/output/suno-account-archive-test20
```

The container path `/app/output/...` is persisted to the repository's
`./output/...` directory by Docker Compose.

### Complete-account scan

To continue until the feed ends, omit both `--limit` and `--target-complete`:

```bash
npm run download:account -- \
  --output-dir ./output/suno-account-archive
```

Important distinction:

- `--limit 20` stops after 20 listed candidates. Some may be incomplete.
- `--target-complete 20` continues pagination until 20 completed clips are
  selected.
- no limit performs a complete account-feed scan, subject to `--max-pages`.

`target_complete_reached` is a successful fixed-size batch, but it is not proof
that the whole account feed was scanned.

### Useful archive options

```text
--formats mp3,wav
--mp3-only
--wav-only
--covers
--target-complete N
--limit N
--page-size N
--max-pages N
--cursor CURSOR
--include-incomplete
--concurrency 1|2|3
--redownload
--no-resume
--recover-stale-lock
--max-run-history N
--via-local-api
--local-api-request-timeout SECONDS
--local-api-recovery-wait SECONDS
--dry-run
```

The default concurrency is `1`; `3` is the hard ceiling. Use higher concurrency
only after a small acceptance run.

### Disconnected local API recovery

With `--via-local-api`, a long archive may outlive the caller's initial HTTP
connection. If the connection times out or breaks, the CLI:

1. does not submit another archive request;
2. queries the read-only status endpoint for the same output directory;
3. confirms that the persisted run start time matches the current invocation;
4. waits for the existing lock to be released;
5. returns the original run's final report.

An explicit API 4xx/5xx response is not treated as a disconnect and fails
immediately.

### Output layout

```text
output/suno-account-archive/
  manifest.json
  runs/
    <run-id>.json
  clips/
    <date>/
      <clip-id>/
        metadata.json
        <title>_<clip-id>.mp3
        <title>_<clip-id>.wav
        <title>_<clip-id>.jpg
```

The `clips` object in `manifest.json` is keyed by Suno clip ID. `media_files`
provides a flat index for downstream applications.

See [docs/ACCOUNT_ARCHIVE.md](docs/ACCOUNT_ARCHIVE.md) for the full operational
contract.

## Song creation and polling

The default model string in this snapshot is `chirp-fenix`. Model availability
is controlled by Suno and the authenticated account.

### Prompt mode

```bash
curl -X POST http://127.0.0.1:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "A bright instrumental theme",
    "make_instrumental": true,
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

### Custom mode

```bash
curl -X POST http://127.0.0.1:3000/api/custom_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Example Song",
    "prompt": "[Verse]\nExample lyric",
    "tags": "indie pop, warm vocal, earworm chorus",
    "make_instrumental": false,
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

`custom_generate` returns clip IDs and clip metadata. Account archive or a
separate media downloader should handle durable downloads.

### Poll or retrieve clips

```bash
curl 'http://127.0.0.1:3000/api/clip?id=CLIP_ID'
curl 'http://127.0.0.1:3000/api/get?ids=CLIP_ID_1,CLIP_ID_2'
curl -X POST http://127.0.0.1:3000/api/feed_by_ids \
  -H 'Content-Type: application/json' \
  -d '{"clip_ids":["CLIP_ID_1","CLIP_ID_2"]}'
```

Once a create request returns clip IDs, recovery should poll those IDs. Do not
blindly create again after an ambiguous client timeout.

## Captcha handling

- `POST /api/create_precheck` reads Suno's current challenge state.
- `POST|PATCH /api/captcha_coordinates` supports image-coordinate workflows and
  bad-answer reporting.
- The actual create implementation performs supported challenge solving and
  submission in the same API instance.
- `TWOCAPTCHA_API_KEY` is optional and must remain private.
- A solved task is not the final success criterion. Create succeeds only when
  Suno returns non-empty clip IDs.

## Reference audio, Cover, Extend, Mashup, and concat

These are account-changing or credit-consuming operations.

### Upload reference audio

Multipart upload:

```bash
curl -X POST http://127.0.0.1:3000/api/upload_reference \
  -F 'file=@/absolute/path/reference.wav' \
  -F 'title=Reference Audio' \
  -F 'wait_upload=true'
```

The response includes the uploaded source clip ID.

### Cover

```bash
curl -X POST http://127.0.0.1:3000/api/cover_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "cover_clip_id": "SOURCE_CLIP_ID",
    "title": "Example Cover",
    "lyrics": "[Instrumental]\n[Electric guitar lead]",
    "style": "instrumental rock, energetic drums",
    "make_instrumental": true,
    "wait_audio": true
  }'
```

Cover supports optional persona, model, vocal gender, style weight, weirdness,
audio weight, and workspace selection.

### Extend / Remix

```bash
curl -X POST http://127.0.0.1:3000/api/extend_audio \
  -H 'Content-Type: application/json' \
  -d '{
    "audio_id": "SOURCE_CLIP_ID",
    "continue_at": 60,
    "prompt": "[Verse]\nContinuation",
    "tags": "alternative rock",
    "title": "Extended Version",
    "wait_audio": true
  }'
```

### Mashup

Mashup requires exactly two clip IDs:

```bash
curl -X POST http://127.0.0.1:3000/api/mashup_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "mashup_clip_ids": ["CLIP_ID_1", "CLIP_ID_2"],
    "title": "Example Mashup",
    "lyrics": "",
    "style": "electronic pop",
    "make_instrumental": true,
    "wait_audio": true
  }'
```

### Studio concat

`POST /api/concat` builds an ordered Studio timeline from two or more clips and
renders a merged full-length clip.

## Song stems and Studio Multitrack

The production path is pure HTTP. Browser/CDP behavior is an explicitly optional
fallback and is disabled by default.

### Song Auto Split

```bash
npm run stems -- song --clip-id CLIP_ID --format wav
npm run stems -- song --clip-id CLIP_ID --format mp3
```

Or:

```bash
curl -X POST http://127.0.0.1:3000/api/song_auto_stems_download \
  -H 'Content-Type: application/json' \
  -d '{"clip_id":"CLIP_ID","stem_format":"wav","backend":"http"}'
```

The API discovers or creates the stem bank, renders through HTTP, downloads the
ZIP, validates archive integrity, and reuses a verified local archive on rerun.
MIDI is not part of the pure-HTTP production contract.

### Studio Multitrack from a `studio_export` clip

```bash
npm run stems -- studio --clip-id STUDIO_EXPORT_CLIP_ID
```

The API resolves the exact Studio project/version, renders the multitrack ZIP,
checks SHA-256, tests the ZIP, verifies WAV entries, and records a manifest.

Do not use `--force` as a generic retry. A normal rerun resumes `.inflight`
state or reuses a verified archive. `--force` intentionally requests a new
render.

## Suno Studio API

Studio uses a separate ID domain from normal Workspace projects:

- Workspace Project ID: library/workspace organization.
- Studio Project ID: Studio timeline and save/render operations.
- Revision/Version IDs: immutable or historical Studio state.
- Clip ID: media asset or generated/exported result.

Do not substitute one ID type for another.

### Suno Studio 2.0 playback transport

This release adds API support for the updated Suno Studio 2.0 runtime control
logic. The transport bridge reads the current Studio page through Chrome DevTools
Protocol and exposes playback status plus control commands:

本次更新的核心内容是：适配 Suno Studio 2.0 版本的运行控制逻辑，
包括播放、暂停、停止、跳转和状态读取。

```text
GET  /api/studio/transport/status
POST /api/studio/transport/play
POST /api/studio/transport/pause
POST /api/studio/transport/stop
POST /api/studio/transport/seek
```

The Studio 2.0 path uses the page DSP v2 timeline, including fractional seconds
and manual BPS automation, instead of approximating time with fixed BPM. Older
`playback_controller_v1` pages remain a fallback where available.

The bridge can probe multiple Chrome CDP sources:

```env
SUNO_STUDIO_TRANSPORT_CDP_CANDIDATES=http://host.docker.internal:18801,http://host.docker.internal:18800
SUNO_STUDIO_TRANSPORT_URL_PREFIX=https://suno.com/studio
SUNO_STUDIO_TRANSPORT_TIMEOUT_MS=15000
```

Each configured Chrome source should contain at most one loaded Suno Studio
project page. The first ready candidate is cached and reused until it becomes
invalid.

### Read and manage Studio state

```text
GET  /api/studio/projects
POST /api/studio/projects
GET  /api/studio/projects/:projectId
POST /api/studio/projects/:projectId
GET  /api/studio/projects/:projectId/versions
GET  /api/studio/projects/:projectId/versions/:versionId
GET  /api/studio/revisions/:revisionId
POST /api/studio/revisions/:revisionId/clone
GET  /api/studio/media/:clipId
POST /api/studio/media/:clipId?kind=downbeats_streaming
```

The project save route forces the URL Studio Project ID into Suno's wire field
named `project_id` and rejects Workspace IDs.

### Export and multitrack

- `POST /api/studio/export` renders a full song or selected beat range to a
  Suno Library clip. It does not automatically download a local file.
- `POST /api/studio/multitrack` renders a state payload and can atomically
  download and validate a Multitrack ZIP.
- `POST /api/studio_multitrack` starts from a completed `studio_export` clip ID
  and resolves project metadata automatically.

### Paid Studio generation

`POST /api/studio/generate` is disabled by default. A first submission requires:

1. `SUNO_STUDIO_ENABLE_PAID_GENERATION=1`;
2. a configured `SUNO_STUDIO_PAID_API_TOKEN`;
3. a matching request authorization token;
4. `confirm_paid_generation=true`;
5. a stable `idempotency_key`.

The idempotency record is persisted. Once clip IDs exist, resume is polling-only
and never creates a second paid job.

### Unverified Studio writes

Archive/unarchive/bookmark/metadata and revision clone remain separately gated.
Editor actions listed by `GET /api/studio/unverified_actions` are not exposed as
an arbitrary upstream proxy.

Keep `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0` unless you have independently
verified and explicitly authorized a specific write.

See [docs/STUDIO_AND_STEMS.md](docs/STUDIO_AND_STEMS.md).

## HTTP route inventory

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/get_limit` | Account credits/quota |
| GET | `/api/workspaces` | Workspace list |
| POST | `/api/create_precheck` | Diagnostic challenge state |
| POST/PATCH | `/api/captcha_coordinates` | Image challenge coordinates/reporting |
| POST | `/api/generate` | Prompt-mode create |
| POST | `/api/custom_generate` | Custom-mode create |
| POST | `/api/upload_reference` | Reference-audio upload |
| POST | `/api/cover_generate` | Cover |
| POST | `/api/extend_audio` | Extend / Remix |
| POST | `/api/mashup_generate` | Two-clip Mashup |
| POST | `/api/concat` | Ordered Studio concat |
| GET | `/api/get` | Clips by comma-separated IDs |
| GET | `/api/clip` | Single clip |
| POST | `/api/feed_by_ids` | Clips by JSON ID list |
| GET/POST | `/api/archive_account` | Archive status / archive execution |
| POST | `/api/song_auto_stems_download` | Auto Split stems |
| POST | `/api/studio_multitrack` | Multitrack from `studio_export` clip |
| GET/POST | `/api/studio/projects` | List/create Studio projects |
| GET/POST | `/api/studio/projects/:projectId` | Read/save/gated mutations |
| GET | `/api/studio/projects/:projectId/versions` | Version list |
| GET | `/api/studio/projects/:projectId/versions/:versionId` | Version detail |
| GET | `/api/studio/revisions/:revisionId` | Revision detail |
| POST | `/api/studio/revisions/:revisionId/clone` | Gated clone |
| GET/POST | `/api/studio/media/:clipId` | Studio media analysis |
| POST | `/api/studio/export` | Library export |
| POST | `/api/studio/multitrack` | State-based Multitrack |
| GET/POST | `/api/studio/generate` | Resume/start gated paid generation |
| GET | `/api/studio/transport/status` | Suno Studio 2.0 playback status |
| POST | `/api/studio/transport/play` | Suno Studio 2.0 play |
| POST | `/api/studio/transport/pause` | Suno Studio 2.0 pause |
| POST | `/api/studio/transport/stop` | Suno Studio 2.0 stop / return to start |
| POST | `/api/studio/transport/seek` | Suno Studio 2.0 seek by seconds or beats |
| GET | `/api/studio/unverified_actions` | Safety catalog |

See [docs/API_REFERENCE.md](docs/API_REFERENCE.md) for request boundaries.

## Environment and security

Start from [`.env.example`](.env.example). Never commit:

- `SUNO_COOKIE`;
- `TWOCAPTCHA_API_KEY`;
- proxy usernames/passwords;
- `SUNO_STUDIO_PAID_API_TOKEN`;
- request authorization headers;
- signed media URLs;
- runtime state, manifests, or downloaded media that reveal private account
  activity.

The Docker service binds to `127.0.0.1` by default. Do not expose the service to
the public Internet without your own authentication, rate limiting, TLS, and
network policy.

## Validation

```bash
npm ci
npm run test:archive
npm run test:studio-transport
npx tsc --noEmit
npm run build
docker build -t suno-api-open-source:test .
```

Live create, upload, Cover, Extend, Mashup, stems extraction, and paid Studio
operations can consume credits or mutate the account. They are not appropriate
for an unauthenticated CI job.

The packaging-time verification record is available in
[VERIFICATION.md](VERIFICATION.md).

## Project structure

```text
src/app/api/       Next.js API routes
src/lib/           Suno, archive, stems, Studio, and Studio 2.0 transport implementation
scripts/           account archive, stems, and Studio CLIs
tests/             non-paid archive and Studio transport tests
docs/              public operational documentation
output/            generated at runtime and git-ignored
studio-state/      generated at runtime and git-ignored
```

## License and attribution

This repository is licensed under the [MIT License](LICENSE).

Third-party dependencies and portions originating from other projects retain
their applicable copyright notices and licenses. See
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
