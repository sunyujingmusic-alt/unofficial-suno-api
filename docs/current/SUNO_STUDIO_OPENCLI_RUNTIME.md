# Suno Studio OpenCLI runtime

This document records the §25.10 implementation in `suno-api-final` as of
2026-08-08. For full contracts and operations, read:

- `docs/current/SUNO_STUDIO_FEATURE_GUIDE_2026-08-08.md` — detailed feature/API说明
- `docs/current/SUNO_STUDIO_OPERATIONS_RUNBOOK_2026-08-08.md` — detailed运维、验收、备份和回滚

The service uses the authenticated direct HTTP client. `scripts/studio-opencli.mjs`
is only a local HTTP wrapper and acceptance helper.

## Implemented surface

- `POST /api/studio/multitrack`
  - Sends `/api/studio/render-state-multitrack` directly.
  - Requires `studio_project_id` and a captured `state`.
  - Derives missing timeline bounds, uses a stable request fingerprint and a
    per-fingerprint lock, then reuses a verified local archive instead of
    submitting a duplicate render.
  - Downloads atomically by default, calculates file size/SHA-256, runs `unzip -tq`,
    requires WAV entries, and runs representative-WAV `ffprobe`.
- `POST /api/studio/export`
  - Sends `/api/studio/render-state` directly.
  - `mode=full_song` and `mode=selected_time_range` share the endpoint.
  - Returns the Library Clip ID and polls `/api/feed/v3`; it does not claim a local file.
- `POST /api/studio/generate`
  - Uses `/api/generate/v2-web/` with `stem_condition` or
    `cover_stem_condition`.
  - Requires an explicit `idempotency_key`, `workspace_project_id`,
    `confirm_paid_generation=true`, and the server gate
    `SUNO_STUDIO_ENABLE_PAID_GENERATION=1`.
  - Also requires `SUNO_STUDIO_PAID_API_TOKEN` and a matching
    `X-Suno-Studio-Token` header. The token is never logged or persisted.
  - Reserves the key before the one-and-only POST. Recovery and repeated keys only
    poll persisted Clip IDs; an ambiguous POST is marked `unknown_after_submit`.
  - Persists an allowlisted request summary, credit snapshots, Clip IDs, statuses,
    and project-insertion observations. Credentials, captcha tokens, transaction
    UUIDs, full state, prompts, and signed URLs are not persisted.
- Project/version HTTP adapters:
  - list/create, load, save, versions, specified version, and revision read.
  - Revision clone and archive/unarchive/bookmark/metadata adapters remain
    disabled unless the explicit unverified-write gate is enabled.
  - Workspace and Studio IDs are named separately at the public API. Suno's
    `/api/studio/save-project` wire field is called `project_id`, but the route
    supplies the Studio project ID there and rejects a Workspace ID.
- Read-only media adapters:
  - waveform, downbeats, MIDI, aligned lyrics v3, Novelty, Stems pages, Clip →
    Studio projects, and streaming downbeats v2.
- `GET /api/studio/unverified_actions`
  - Catalogues Speed/Reverse/Crop/Fade, Extract Stems, Remove FX, Import/Record,
    Warp, and Alternate Takes as intentionally not forwarded. Their payloads and
    write semantics were not verified in the report.

## Safety defaults

Docker sets `SUNO_STUDIO_ENABLE_PAID_GENERATION=0` unless explicitly overridden.
It also sets `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0` unless explicitly overridden.
The one paid route therefore cannot send an upstream request by default. A
separately authorized acceptance window on 2026-08-08 temporarily enabled the
gate in an isolated container, submitted Instrument once and Cover once with
different idempotency keys, and then removed the temporary credentials and
container. Production remains disabled.

Persistent state and downloads default to:

- `/app/.suno-studio-state` (Docker volume backed by `SunoStudioState`)
- `./output/studio-exports`

For host-side development, set `SUNO_STUDIO_STATE_DIR` and
`SUNO_STUDIO_OUTPUT_DIR` explicitly if those defaults are not writable.
The production Compose file preserves the existing `./output` mount for
Stems and adds the `.next` and durable Studio-state mounts.

## Non-billing acceptance

```bash
node node_modules/typescript/lib/tsc.js --noEmit
node node_modules/next/dist/bin/next build
node scripts/studio-opencli.mjs doctor
```

With a local server running, the CLI can perform route-only checks without
calling Suno:

```bash
SUNO_OPENCLI_BASE_URL=http://127.0.0.1:3000 \
  node scripts/studio-opencli.mjs doctor --live
```

The expected paid-generation safety check is HTTP 403 while the server gate is
off, with no `.suno-studio-state` record created and no upstream generation POST.
Do not enable the gate for a routine build or route acceptance check.

## Authorized live acceptance on 2026-08-08

- Instrument: HTTP 200, two clips, both `complete`, 4 Credits.
- Cover: HTTP 200, two clips, both `complete`, 4 Credits.
- Full Song and Selected Time Range exports: HTTP 200; final Library clips were
  `complete` and exposed audio URLs.
- Multitrack: HTTP 200; a 52,244,220-byte ZIP passed container validation and
  contained 14 WAV files. A representative WAV was PCM float, 48 kHz, stereo.
- The generated clips were not observed in the newly created Studio Project.
- No paid POST was retried with the same idempotency key.

The run also established that current Full Song exports require timeline bounds
and current Multitrack requests require a title. The HTTP adapter now derives
Full Song bounds from state and supplies/fingerprints the Multitrack title.
SMB `.smbdelete*` lock-cleanup delays are treated as warnings after bounded
retries so they cannot overwrite an otherwise successful Multitrack result.

The sanitized evidence is in
`./output/studio-exports/acceptance-20260808-205426`.
Temporary tokens, payloads, raw responses, and isolated state were deleted.

## Rollback

Rollback only the files introduced for this feature and the corresponding added
documentation/configuration lines. Do not run `git reset --hard`, `git restore .`,
or delete the repository's existing uncommitted changes. The current checkout
contains pre-existing modifications that must remain intact.
