# Suno Account Archive Command

This production command downloads songs from the authenticated Suno account into
a resumable local archive. The canonical state file is `manifest.json`.

## Command

```bash
npm run download:account
```

Default behavior:

- reads `SUNO_COOKIE` with this precedence: shell environment, `.env.local`,
  then `.env`
- lists the account library through Suno's cursor-paginated feed endpoint
- downloads both MP3 and WAV for each complete clip
- runs incrementally by default
- reads the previous `manifest.json`
- verifies reusable MP3/WAV with file size, SHA-256, and `ffprobe` when
  available before treating them as complete
- downloads new clips, missing files, and previously failed formats
- downloads through `<file>.part`, supports HTTP Range resume when Suno permits
  it, and atomically renames only verified files into place
- writes `manifest.json` and run reports atomically after every completed clip
- uses an output-directory lock so manual and scheduled archive runs cannot
  overwrite each other
- writes `runs/<run_id>.json` for the current execution
- never stores signed media URLs in JSON files

## Useful Options

```bash
npm run download:account -- --dry-run --limit 20
npm run download:account -- --output-dir ./output/suno-account-archive
npm run download:account -- --formats mp3,wav
npm run download:account -- --mp3-only
npm run download:account -- --wav-only
npm run download:account -- --covers
npm run download:account -- --page-size 50 --max-pages 200
npm run download:account -- --target-complete 100
npm run download:account -- --concurrency 2
npm run download:account -- --redownload
```

Options:

- `--dry-run`: list clips and write JSON state without downloading media.
- `--limit <n>`: stop after `n` listed candidates. It does **not** mean `n`
  completed downloads.
- `--target-complete <n>`: continue pagination until `n` clips whose Suno
  status is `complete` have been selected. This is the correct option for an
  exact completed-song batch. It cannot be combined with `--limit`.
- `--output-dir <path>`: change the archive root.
- `--formats mp3,wav`: choose one or both formats.
- `--covers`: also download cover images.
- `--page-size <n>`: Suno feed page size, capped at 100.
- `--max-pages <n>`: safety limit for account pagination.
- `--cursor <cursor>`: resume listing from a Suno feed cursor.
- `--include-incomplete`: include non-complete clips in the download attempt.
- `--redownload`: re-download previously archived media while keeping manifest
  history and stable output paths.
- `--no-resume`: rebuild this run without reading prior manifest state.
- `--no-skip-existing`: re-download files even when local files already exist.
- `--concurrency <1-3>`: number of independent clip workers. Default is `1`;
  use `2` only after a small-account acceptance run, and do not exceed `3`.
- `--recover-stale-lock`: recover an archive lock only when it is more than two
  hours old and its owner process is no longer running.
- `--max-run-history <n>`: retain the most recent `n` run summaries inside
  `manifest.json`; complete per-run JSON files remain in `runs/`.
- `--local-api-request-timeout <sec>`: optional guard for the initial
  `--via-local-api` HTTP wait. If it expires or the connection drops after the
  request started, the CLI does **not** submit again; it switches to persisted
  status monitoring for the same output directory.
- `--local-api-recovery-wait <sec>`: maximum persisted-status wait after a
  local API disconnect. Default: 3700 seconds.

## Incremental Resume Design

The archive folder is designed as a long-lived local ledger. A normal rerun days
later should:

1. acquire `.archive.lock`
2. read `manifest.json`
3. list the current Suno account library
4. match clips by Suno clip ID
5. verify reusable files rather than trusting a non-empty path
6. resume missing downloads from `.part` when Suno supports HTTP Range
7. download only new clips, missing files, or previously failed formats
8. atomically update the manifest and current run report after each clip
9. remove `.archive.lock` even when the run exits with an error

Use the default command for this behavior:

```bash
npm run download:account
```

Use this only when you explicitly want to refresh or overwrite existing media:

```bash
npm run download:account -- --redownload
```

## Local API Disconnect Recovery

`--via-local-api` sends the authenticated work to the Docker service. A long
archive must not be reported as failed merely because the caller's one HTTP
connection closes before the service returns.

When the initial `POST /api/archive_account` connection ends unexpectedly, the
CLI requests `GET /api/archive_account?output_dir=...` for the same archive
root. It accepts a recovered result only when the persisted run's `started_at`
matches the current CLI invocation, then:

1. waits while `.archive.lock` is held;
2. reads the final `runs/<run_id>.json` after the lock is released;
3. returns the original run's success or failure result without a second
   archive submission.

This protects against duplicate downloads and against accidentally treating an
older completed run in the same directory as the current request. The status
route is read-only and never exposes cookies, signed media URLs, or raw Suno
responses.

For a controlled recovery acceptance test:

```bash
npm run download:account -- \
  --via-local-api --api-base http://127.0.0.1:3000 \
  --local-api-request-timeout 1 \
  --target-complete 20 \
  --output-dir /Volumes/TR200/suno-account-archive-recovery-test
```

## Output Layout

```text
output/suno-account-archive/
  manifest.json
  runs/
    20260811153022.json
  clips/
    2026-08-11/
      <clip-id>/
        metadata.json
        <title>_<clip-id>.mp3
        <title>_<clip-id>.wav
        <title>_<clip-id>.jpg
```

Cover images are only present when `--covers` is enabled.

## `manifest.json`

`manifest.json` is the single canonical archive document. It is optimized for
Suno API archive stability first. External tools can import this document
directly instead of relying on a separate derived JSON file.

Top-level fields:

- `schema_version`: currently `4`
- `archive_type`: `suno_account_archive`
- `generated_by`
- `created_at`
- `updated_at`
- `output_dir`
- `manifest_path`
- `summary`
- `latest_listing`
- `media_files`
- `runs`
- `clips`

`clips` is keyed by Suno clip ID and stores one latest record per clip:

- title, create time, status, model name, duration
- `suno_page_url`
- local MP3/WAV/cover/metadata paths
- requested, completed, downloaded, existing, and planned formats
- archive status: `completed`, `partial`, `failed`, `skipped`, or `planned`
- `first_seen_at`, `last_seen_at`, `last_attempted_at`, `last_success_at`
- per-format error messages
- per-format integrity evidence: byte size, SHA-256, response metadata, and
  `ffprobe` result for audio files
- per-stage duration and retry counters

`media_files` is a flat index of completed local audio files. It is intentionally
generic and consumer-neutral:

- `media_id`: `<clip_id>:<format>`
- `clip_id`
- `suno_id`
- `file_name`
- `file_path`
- `format`: `mp3` or `wav`
- `suno_page_url`
- `suno_source`
- `title`
- `status`
- `archive_status`
- `created_at`
- `model_name`
- `paired_files`

Minimal shape:

```json
{
  "schema_version": 4,
  "archive_type": "suno_account_archive",
  "generated_by": "suno-api-final",
  "summary": {
    "total_known_clips": 1,
    "completed": 1,
    "mp3_ready": 1,
    "wav_ready": 1,
    "media_file_count": 2,
    "last_run_id": "20260811153022"
  },
  "media_files": [
    {
      "media_id": "clip_id_here:wav",
      "clip_id": "clip_id_here",
      "suno_id": "clip_id_here",
      "file_name": "song_clip_id_here.wav",
      "file_path": "/absolute/archive/path/song_clip_id_here.wav",
      "format": "wav",
      "suno_page_url": "https://suno.com/song/clip_id_here",
      "suno_source": "suno",
      "title": "Song title",
      "archive_status": "completed",
      "model_name": "chirp-fenix"
    }
  ],
  "clips": {
    "clip_id_here": {
      "id": "clip_id_here",
      "title": "Song title",
      "suno_page_url": "https://suno.com/song/clip_id_here",
      "mp3_path": "/absolute/archive/path/song_clip_id_here.mp3",
      "wav_path": "/absolute/archive/path/song_clip_id_here.wav",
      "requested_formats": ["mp3", "wav"],
      "completed_formats": ["mp3", "wav"],
      "archive_status": "completed",
      "errors": []
    }
  }
}
```

## `runs/<run_id>.json`

Per-execution report. Use it to inspect what one run listed, downloaded, reused,
or failed without losing the long-lived manifest history. It also contains:

- `listing.stop_reason`: `end_of_feed`, `target_complete_reached`,
  `limit_reached`, `max_pages_reached`, `missing_cursor`, or `cursor_loop`
- `listing.account_scan_complete`: true only when the command reached the end
  of the Suno feed; it is intentionally false for limited or target-count runs
  that still have another cursor
- completed archive-entry count, selected concurrency, and stage timing data

Do not interpret a limited run as a full-account archive. For example,
`has_more=true` plus `stop_reason=target_complete_reached` means the requested
batch finished, while the account scan remains incomplete.

## WAV Behavior

MP3 is downloaded from the clip's `audio_url`.

WAV requires preparation on Suno's side: the command triggers Suno's
`convert_wav` endpoint, polls `wav_file_url`, and downloads the WAV only after
Suno returns the prepared URL. If polling ends without a WAV URL, that clip is
recorded as a WAV error in `manifest.json` and the command continues.

Before asking Suno to convert again, the command first checks whether a WAV URL
already exists. Poll intervals expand gradually during a long wait. A later
normal incremental run retries only the still-missing WAV; it does not submit
or regenerate the song.

The older clip download preparation endpoint is treated as best-effort because
some account-library clips return 404 there while MP3 download and WAV
conversion still work normally.

For list, polling, WAV preparation, and media download, transient 408, 429,
5xx/Cloudflare 52x, timeout, and connection errors use bounded exponential
backoff with jitter and honor a numeric `Retry-After` header. If a signed media
URL returns 401, 403, or 404, the command refreshes that clip through Suno's
feed once and retries with the refreshed URL.

## Operational Rules

- Keep default concurrency at `1` for unattended production jobs. Raise it to
  `2` only after reviewing a small real run; `3` is the hard safety ceiling.
- Never delete `.archive.lock` merely because a process appears slow. Use
  `--recover-stale-lock` only after the two-hour stale threshold and confirming
  the recorded PID is not running.
- A `.part` file is recovery state, not a completed asset. Do not move it into
  another media system manually.
- `manifest.json` is an index, not the sole proof of a valid asset. Use the
  saved size/SHA-256/probe information when handing files to another system.
- If `ffprobe` is unavailable, downloads still verify size and SHA-256, but
  install `ffmpeg` before declaring a large archive media-valid.

## Safety Notes

- This is an authenticated account operation. Use only with your own Suno
  account and in accordance with Suno's terms.
- Do a small dry run first: `npm run download:account -- --dry-run --limit 5`.
- The command is intentionally single-process and conservative; rerunning it is
  the normal way to resume an interrupted archive.
