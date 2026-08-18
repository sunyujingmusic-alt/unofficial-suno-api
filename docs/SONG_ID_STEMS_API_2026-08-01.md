# Song ID Stems API

> Historical record: this file describes the earlier browser-backed acceptance implementation. It is retained as evidence only. The current production contract is pure HTTP and is documented in `docs/STEMS_HTTP_API_AND_CLI_2026-08-01.md`; do not use the Chrome/CDP commands or dependencies below for current operations.

## Result

The production Suno API at `http://127.0.0.1:3000` can locate a Suno song from its clip ID, reuse the signed-in managed Chrome session, create or reuse Auto split stems, and download a verified ZIP.

Endpoint:

```http
POST /api/song_auto_stems_download
Content-Type: application/json
```

Minimal WAV request:

```json
{
  "clip_id": "c86b4e11-b3fe-4b18-9fe3-1049f9d64256",
  "stem_format": "wav"
}
```

`clip_id` may also be supplied inside a Suno song URL through `url`. `stem_format` accepts `wav`, `mp3`, or `midi`; WAV is the format verified end to end on 2026-08-01. MP3 and MIDI are implemented against the same live format selector but were not separately downloaded during this acceptance test.

## Verified production result

- Song: `借你一盏灯`
- Clip ID: `c86b4e11-b3fe-4b18-9fe3-1049f9d64256`
- Output ZIP: `/Volumes/TR200/suno-stems-downloads/借你一盏灯 [c86b4e11-b3fe-4b18-9fe3-1049f9d64256] Stems (WAV).zip`
- ZIP size: `264313032` bytes
- ZIP validation: `unzip -tqq` passed
- Stem count: 10 WAV files
- Manifest: sibling `.zip.json`
- First successful extraction consumed 50 Suno credits in this observation
- A repeated request returned `reused=true` without another Extract and without another credit change
- A forced cold-path audit (the verified local ZIP was temporarily removed) completed from a new browser tab, produced another valid 10-WAV ZIP of `229551518` bytes, and consumed another 50 credits because the local idempotency artifact had deliberately been hidden

Verified entries:

```text
0 Lead Vocals.wav
1 Backing Vocals.wav
2 Drums.wav
3 Bass.wav
4 Guitar.wav
5 Keyboard.wav
6 Percussion.wav
7 Strings.wav
8 Synth.wav
9 Other.wav
```

## Runtime dependencies

- Production container: `suno-api`
- API port: `127.0.0.1:3000`
- Host Chrome CDP: `127.0.0.1:18800`
- Container CDP URL: `http://host.docker.internal:18800`
- Output root: `/Volumes/TR200/suno-stems-downloads`
- Docker bind mount: `/Volumes/TR200 -> /Volumes/TR200`

The Chrome CDP session must already be authenticated to Suno. A direct HTTP Cookie is not sufficient for this browser-backed route.

## Execution flow

```text
clip_id
  -> https://suno.com/song/<clip_id>
  -> Download
  -> Get Stems / MIDI
  -> Auto split
  -> Extract (only when stems are not already ready)
  -> wait for the stem list
  -> Download options
  -> select exactly one requested format
  -> final Download
  -> dedicated .inflight directory
  -> ZIP integrity and entry validation
  -> final clip-id-specific ZIP + manifest
```

## Production controls

- Requests are serialized around the shared browser download state.
- Queue wait defaults to 30 minutes and can be changed with `SUNO_STEMS_QUEUE_TIMEOUT_MS` or `queue_timeout_ms`.
- Each request gets its own `.inflight/<clip-id>-<uuid>` directory.
- Failed runs retain `.inflight` evidence.
- Successful runs clean their own `.inflight` directory unless `cleanup_run_dir=false`.
- A verified final ZIP is keyed by clip ID and format, then reused idempotently.
- `song_title` is only an optional browser-location hint. It is not part of the idempotency key and cannot force a second archive or Extract for the same clip ID and format.
- Reuse still runs `unzip -tqq` and requires at least two audio/MIDI entries.
- A missing, invalid, or stale sibling manifest is regenerated from the verified ZIP before reuse returns success.
- String booleans (`"true"`, `"false"`, `"1"`, `"0"`) are parsed explicitly; invalid booleans and non-finite, fractional, or out-of-range numeric parameters return HTTP 400.
- Invalid IDs and formats return structured HTTP 400 errors.
- Browser contention returns retryable HTTP 429 `STEMS_BROWSER_BUSY`.
- Public errors are bounded and redacted. Browser page state, recorder calls, email addresses, Clerk URLs, cookies, and tokens are never returned.
- Successful responses contain outcome fields only; raw browser state and network-call diagnostics are not exposed.

## Bugs fixed during acceptance

1. The stem dialog state originally truncated element text to 300 characters. `Download` occurs after the long stem list, so completed extraction was misread as still running. Dialogs now retain a separate full text field.
2. The final format panel is not a separate ARIA dialog. It is an unlabelled `450 x 630` container nested inside the main `750 x 1080` stem dialog. The old selector clicked the outer Download button again. The final click now anchors to the smallest visible container containing `Select files to download` and a Download button.
3. MP3 and WAV are selected by default. The route now explicitly selects only the requested format and deselects the other formats.
4. After Escape closes stale overlays, the page state is now re-read before locating the song menu.
5. Browser download events now use the correct `Browser\.download*` pattern and downloads are isolated from old files.
6. New tabs can briefly destroy their JavaScript execution context while navigating. These transient CDP errors are now retried instead of becoming an immediate false `SUNO_PAGE_NOT_READY` failure.
7. Song actions, the Download submenu, and the Stems dialog now have explicit readiness waits, removing the race where a page title was ready but its menu controls were not.
8. Caller-supplied titles could previously bypass local reuse. Archive lookup now scans by the exact clip-ID-and-format suffix, independent of title.
9. Generic failures previously risked returning raw page state. Error details now use an allowlist plus redaction and size bounds.

## Credit and retention rule

Treat the first Auto split for a clip as a credit-consuming operation. In both production observations it cost 50 credits. Keep the final ZIP and its sibling manifest under the configured output root: they are the durable idempotency record. If that ZIP is moved or deleted, the API correctly treats the next call as a cold request and Suno may charge another 50 credits even when that song was split in an earlier browser session.

## Success criteria

Do not report success from a visible stem list or a Download click alone. Require all of the following:

1. HTTP 200 with `ok=true`.
2. Final ZIP exists and is non-empty.
3. `unzip -tqq` passes.
4. ZIP contains at least two audio/MIDI files.
5. Sibling manifest exists and matches clip ID, format, size, and entries.
6. A repeated identical request returns `reused=true` without a second Extract.
7. The production container image ID matches `suno-api-final:latest` and reports Docker health `healthy`.

Final production audit on 2026-08-01 also verified:

- 6 focused unit tests passed (validation, boolean parsing, numeric bounds, archive identity, title normalization, and error redaction).
- One dry-run held the shared browser lock while three concurrent 1-second queue requests each returned retryable HTTP 429.
- Cover, Extend, Mashup, and Stems route probes each returned HTTP 200 for `OPTIONS` after the final image deployment.
