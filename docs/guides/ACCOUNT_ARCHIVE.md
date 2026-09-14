# Account Archive Operational Guide

## Purpose

`npm run download:account` creates a durable local archive of songs visible to
the authenticated Suno account. It does not create or regenerate music.

## Recommended first run

```bash
npm run download:account -- \
  --dry-run \
  --target-complete 5 \
  --output-dir ./output/archive-preflight
```

Then run a real small batch:

```bash
npm run download:account -- \
  --target-complete 20 \
  --output-dir ./output/archive-test20
```

## Selection semantics

- `--limit N`: stop after N listed candidates.
- `--target-complete N`: keep paging until N `complete` clips are selected.
- neither flag: continue to the end of the feed.
- `--include-incomplete`: include non-complete clips in manifest/download
  attempts; this is off by default.

The run report records `stop_reason`, `has_more`, and
`account_scan_complete`. Only `end_of_feed` proves the current scan reached the
feed end.

## Download behavior

For each selected clip, reuse only verified files marked `suno_playback_audio`; otherwise fetch `media_urls`, obtain Mango rights when encrypted, decrypt, and convert with FFmpeg. Validate the converted file before atomic publication and persist the manifest. MP3 and WAV both follow this path. WAV is decoded playback PCM, not a lossless master.

Playback failures are recorded per format and a later run retries them from the start; encrypted audio is not resumed with HTTP Range. Only covers retain Range and URL-refresh behavior. Do not request official Download or upstream WAV conversion as a fallback.

## Retry policy

Listing and cover downloads retain bounded network retries. Failed playback retrieval, decryption or conversion is recorded per format; rerun the same archive to retry missing formats without creating a new song. Keep the manifest, source markers and output lock. See [current archive contract](../current/SUNO_ACCOUNT_ARCHIVE.md).

## Locking

Each output directory uses `.archive.lock`.

- Do not run two writers against the same output directory.
- Do not remove a lock merely because a large job is slow.
- `--recover-stale-lock` is only for a lock older than the configured stale
  threshold whose owner process no longer exists.

Different output directories are independent.

## Local API mode

```bash
npm run download:account -- \
  --via-local-api \
  --api-base http://127.0.0.1:3000 \
  --target-complete 20 \
  --output-dir /app/output/archive-test20
```

If the initial HTTP connection breaks, the CLI monitors:

```text
GET /api/archive_account?output_dir=...
```

It accepts a completed result only when the persisted run timestamp matches the
current invocation. An explicit 4xx/5xx response is returned immediately and is
not treated as a detached job.

## Manifest contract

`manifest.json` contains:

- archive schema/version and output paths;
- summary counts;
- latest listing state and cursor;
- per-clip metadata and archive status;
- per-format paths, SHA-256, byte counts, response metadata, and probe results;
- a flat `media_files` index;
- bounded run history.

`runs/<run_id>.json` is the authoritative report for one execution.

## Success criteria

For a fixed-size 20-song MP3+WAV acceptance run:

- `completed_count = 20`;
- `failed = 0`;
- `mp3_ready = 20`;
- `wav_ready = 20`;
- `media_file_count = 40`;
- no `.part` files remain;
- `.archive.lock` is absent;
- every indexed file exists, is non-empty, has a matching SHA-256, and passes
  `ffprobe`.
