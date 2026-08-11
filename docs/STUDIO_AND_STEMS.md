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
