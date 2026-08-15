# Studio and Stems Guide

## Production boundary

Song Auto Split and Studio Multitrack default to direct HTTP. Browser/CDP
fallback is disabled unless explicitly requested and enabled.

Successful HTTP stem responses should include:

- `ok: true`;
- `backend: "http"`;
- `browser_fallback_used: false`;
- an existing output path and manifest path;
- a SHA-256 value matching the downloaded archive.

## Song Auto Split

```bash
npm run stems -- song --clip-id CLIP_ID --format wav
npm run stems -- song --clip-id CLIP_ID --format mp3
```

Normal reruns reuse a verified archive or resume `.inflight` state. Use
`--force` only when a fresh upstream extraction/render is intentional.

## Studio Multitrack from a clip

```bash
npm run stems -- studio --clip-id STUDIO_EXPORT_CLIP_ID
```

The clip must identify a completed Studio export. The runtime resolves the
Studio project/version, retrieves state, renders, downloads, tests the ZIP,
validates WAV entries, and persists a manifest.

## State-based Studio Multitrack

`POST /api/studio/multitrack` accepts:

- `studio_project_id`;
- captured `state`;
- optional time bounds and output configuration.

It locks by request fingerprint and reuses output only when integrity checks
still pass.

## Studio export

`POST /api/studio/export` supports:

- `full_song`;
- `selected_time_range` with `start_beats` and `end_beats`.

It renders and saves a clip to the Suno Library. It is not a local download
endpoint.

## Studio project state

The API supports:

- project list/create/read/save;
- version list/read;
- revision read;
- media waveform, downbeats, MIDI, aligned lyrics, novelty, stems, and project
  association where upstream data is available.

The save adapter treats the URL ID as a Studio Project ID and rejects Workspace
Project IDs in that field.

## Suno Studio 2.0 runtime transport

This version adds a Studio Transport bridge for the updated Suno Studio 2.0
playback runtime. It is intended for synchronizing external tools to the
currently open Studio timeline without calling Create, Cover, Extend, export, or
other credit-consuming endpoints.

本次更新的核心内容是适配 Suno Studio 2.0 版本的运行控制逻辑：状态读取、
播放、暂停、停止和跳转都通过当前 Studio 页面内的运行时控制器完成。

Routes:

```text
GET  /api/studio/transport/status
POST /api/studio/transport/play
POST /api/studio/transport/pause
POST /api/studio/transport/stop
POST /api/studio/transport/seek
```

`status` returns:

- playing state;
- position in beats;
- position in full floating-point seconds;
- song start seconds;
- timeline presence / playing state;
- observed timestamp;
- Studio project ID when available;
- browser source.

Studio 2.0 timing uses the page DSP v2 model. Manual timing and BPS automation
are converted using the same timing shape observed in Studio, rather than using
a fixed `beats * 60 / bpm` approximation. Legacy `playback_controller_v1` pages
remain a fallback where available.

`seek` accepts exactly one unit:

```json
{ "seconds": 12.5 }
```

or:

```json
{ "beats": 32 }
```

The bridge reads a Chrome DevTools Protocol target for the Studio page. It can
probe multiple Chrome sources in order:

```env
SUNO_STUDIO_TRANSPORT_CDP_CANDIDATES=http://host.docker.internal:18801,http://host.docker.internal:18800
SUNO_STUDIO_TRANSPORT_URL_PREFIX=https://suno.com/studio
SUNO_STUDIO_TRANSPORT_TIMEOUT_MS=15000
```

Typical usage is:

- `18801`: a user/system Chrome instance launched with remote debugging;
- `18800`: an OpenClaw-managed or otherwise managed Chrome instance.

Every configured CDP source should have at most one loaded Suno Studio project
page. If a source has multiple Studio pages, the bridge returns HTTP 409 instead
of guessing which timeline to control.

CLI wrappers:

```bash
npm run studio-opencli -- transport-status
npm run studio-opencli -- transport-play
npm run studio-opencli -- transport-pause
npm run studio-opencli -- transport-stop
npm run studio-opencli -- transport-seek-seconds 12.5
npm run studio-opencli -- transport-seek-beats 32
```

This transport path controls the visible Studio page. Play/pause/stop/seek will
move the user's Studio timeline, so do not run these commands against someone
else's active browser session.

## Paid generation

Paid Studio generation starts disabled. A new submission requires:

- `SUNO_STUDIO_ENABLE_PAID_GENERATION=1`;
- a configured shared paid token;
- a matching request authorization;
- `confirm_paid_generation=true`;
- a valid idempotency key.

Submission records are durable. If clip IDs were obtained, all recovery is
poll-only.

## Unverified writes

Project archive/unarchive/bookmark/metadata and revision clone are protected by
a separate gate. Other editor actions are cataloged but not forwarded.

Do not turn on unverified writes as a general compatibility switch.

## Credit safety

Auto Split, Cover, Mashup, Extend, generation, export, and other upstream
operations may consume credits or mutate account state. Run read-only checks
and dry-runs first, then perform the smallest explicit acceptance request.
