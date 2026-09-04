# Studio Multitrack API

> Historical record: this file describes the earlier browser-backed acceptance implementation. It is retained as evidence only. The current production contract is pure HTTP and is documented in `docs/current/STEMS_HTTP_API_AND_CLI_2026-08-01.md`; do not use the Chrome/CDP commands or dependencies below for current operations.

## Purpose

`POST /api/studio_multitrack` turns the verified Suno Studio `Export -> Multitrack` browser route into a production API keyed by a Suno `studio_export` clip ID.

The API never trusts a caller-supplied `/studio` URL. It resolves the exact Studio project from authenticated Suno clip metadata and proves the downloaded ZIP belongs to that project before publishing it as a completed result.

## Request

Minimal request:

```bash
curl -X POST http://127.0.0.1:3000/api/studio_multitrack \
  -H 'Content-Type: application/json' \
  -d '{"clip_id":"eb307b0d-57e6-49b2-99ba-86349b228c2d"}'
```

Supported fields:

| Field | Default | Meaning |
| --- | --- | --- |
| `clip_id` | required | Completed Suno clip whose type is `studio_export` |
| `dry_run` | `false` | Load and verify the exact Studio project without clicking Export |
| `force_redownload` | `false` | Ignore a valid local archive and intentionally submit a new Multitrack export |
| `download_dir` | `SUNO_STUDIO_MULTITRACK_DOWNLOAD_DIR` | Host-visible archive directory |
| `load_wait_ms` | `120000` | Maximum exact-project page load wait |
| `download_timeout_ms` | `300000` | Maximum ZIP download wait |
| `queue_timeout_ms` | `SUNO_STEMS_QUEUE_TIMEOUT_MS` | Maximum wait for the shared browser queue |
| `cleanup_run_dir` | `true` | Delete a successful `.inflight` directory; failed directories remain |
| `cdp` | `SUNO_BROWSER_CDP` | Managed signed-in Chrome CDP endpoint |

Camel-case aliases are accepted at the HTTP boundary. The documented snake-case form is canonical.

## Identity chain

```text
clip_id
  -> authenticated POST /api/feed/v3
  -> status=complete
  -> type=studio_export
  -> raw.metadata.studio_project_id
  -> /studio?initial_project_id=<studio_project_id>
  -> exact page title
  -> Export -> Multitrack
  -> render-state-multitrack 2xx + download_url
  -> save-project 2xx + id == studio_project_id
  -> Browser.downloadProgress completed
  -> verified WAV ZIP + manifest
```

The following identifiers are recorded separately and must not be interchanged:

- input `clip_id`: Studio-exported Suno clip
- `studio_project_id`: current Studio project selected through `initial_project_id`
- `source_studio_project_version_id`: project version recorded on the input clip
- `save_project_version_id`: new version created as a side effect of this Multitrack export

## Concurrency and idempotency

Song Auto split and Studio Multitrack both modify the browser-global download directory. Studio also persists selected-project state in the Suno origin. They therefore share one FIFO-style in-process promise queue.

The queue covers only browser-backed stems operations. Create, polling, MP3/WAV downloads, Cover, Extend, and Mashup do not enter it.

The completed archive identity is the input clip ID:

```text
<title> [<clip_id>] Studio Multitrack.zip
<title> [<clip_id>] Studio Multitrack.zip.json
```

On a repeated call, the API re-runs ZIP integrity, WAV-header, and SHA256 validation. A valid archive returns `reused=true` without opening Export. A stale or missing manifest is repaired. A corrupt archive is preserved for diagnosis and a fresh export is attempted. `force_redownload=true` is required to intentionally replace a valid archive.

The same archive check runs again after queue acquisition. Two concurrent requests for the same clip therefore coalesce operationally: the first exports, and the second reuses its verified result after leaving the queue.

## Download isolation and finalization

Each fresh run downloads into:

```text
<download_dir>/.inflight/<clip_id>-<random_uuid>/
```

The browser is configured through `Browser.setDownloadBehavior` only while holding the shared queue. After validation, the ZIP is staged beside the final destination and atomically renamed into place. The previous verified archive remains untouched until the replacement ZIP has passed validation.

Successful runs remove their `.inflight` directory by default. Failed runs retain it so partial ZIPs, `.crdownload` files, and timing evidence can be inspected.

## ZIP and audio validation

Success requires all of the following:

1. final file is non-empty
2. `unzip -tqq` passes
3. ZIP contains at least one entry
4. every entry is a non-empty `.wav` file
5. every WAV begins with a valid `RIFF/WAVE` header and a valid `fmt ` chunk
6. codec, sample rate, channel count, and bits per sample are recorded per track
7. SHA256 is calculated over the final ZIP bytes

The 2026-08-01 three-project acceptance baseline produced 25 valid tracks, all `pcm_f32le`, 48 kHz, 2 channels, and 32 bits per sample. The validator accepts other valid WAV parameters so a future Suno format change is visible in the manifest instead of being mislabeled as corrupt.

## Response and manifest

A completed or reused response includes:

- `clip_id`, `clip_title`, `studio_project_id`, and source project version
- `output_path` and `manifest_path`
- `track_count`, `zip_entries`, and per-track WAV parameters
- ZIP `sha256`
- curated export evidence without raw browser page or authentication data
- credits before, after, and delta when the quota probe succeeds
- `reused` to distinguish a new export from verified local reuse

The sibling manifest is the durable audit record. Raw recorder calls, cookies, authorization headers, browser page text, and Clerk responses are never returned or written to the manifest.

## Error model

Representative errors:

| Code | HTTP | Retry | Meaning |
| --- | ---: | --- | --- |
| `INVALID_CLIP_ID` | 400 | no | Missing or malformed clip ID |
| `STUDIO_CLIP_NOT_FOUND` | 404 | no | Suno returned no matching clip |
| `STUDIO_CLIP_NOT_COMPLETE` | 409 | depends on status | Clip has not completed |
| `NOT_A_STUDIO_EXPORT` | 422 | no | Clip does not map to a Studio export |
| `STUDIO_PROJECT_ID_MISSING` | 422 | no | Required Studio project metadata is absent |
| `STEMS_BROWSER_BUSY` | 429 | yes | Shared browser queue timeout |
| `SUNO_BROWSER_NOT_AUTHENTICATED` | 401 | no | Managed browser needs login |
| `STUDIO_PROJECT_NOT_READY` | 504 | yes | Exact project/title did not load in time |
| `STUDIO_PROJECT_MISMATCH` | 502 | no | `save-project` proves the wrong project was active |
| `STUDIO_RENDER_FAILED` | 502 | yes | Suno rejected Multitrack render |
| `STUDIO_DOWNLOAD_TIMEOUT` | 504 | yes | Render succeeded but ZIP did not complete |
| `STUDIO_ZIP_INVALID` | 502 | yes | ZIP integrity failed |
| `STUDIO_WAV_HEADER_INVALID` | 502 | yes | A ZIP entry is not a valid WAV |

Errors are structured as `{ok:false,error:{code,message,retryable,details?}}`. Details are bounded and redacted. Never add raw page state or recorder calls to public error responses.

## Runtime configuration

```text
SUNO_BROWSER_CDP=http://host.docker.internal:18800
SUNO_STUDIO_MULTITRACK_DOWNLOAD_DIR=./output/suno-studio-multitrack-downloads
SUNO_STEMS_QUEUE_TIMEOUT_MS=1800000
```

The host browser must already be signed into the same Suno account that owns the Studio project. Docker must mount `./output` at the same absolute path.

## Operational warning

Studio Multitrack did not consume credits in the three 2026-08-01 production tests, but every export called `save-project` and created a new version. A fresh export is therefore an account mutation even when the credits delta is zero. Keep default reuse enabled and use `force_redownload` deliberately.

## Production acceptance on 2026-08-01

The endpoint was built into the active `suno-api` runtime on port 3000 and verified against the following real input:

```text
clip_id=92493ab6-bc85-4fb2-b7ed-097d9530878a
studio_project_id=eb883d22-f641-47f9-addd-ed2a402c73dc
source_studio_project_version_id=58e0159f-6050-41cd-9fd1-6edd27d7f05d
```

Fresh export result:

```text
HTTP 200
reused=false
recovered=false
track_count=13
zip_size=137958912
sha256=d602e4d2d5730c6eaa1302e6175f53b6cacbfea2eaf94f48517c9674b93e3885
save_project_version_id=32d4bd15-6226-492c-a130-a709cf3d1afd
credits=12281 -> 12281 (delta 0)
```

All 13 tracks parsed as `pcm_f32le`, 48 kHz, 2 channels, and 32 bits per sample. Independent host-side `unzip -tqq`, entry count, SHA256, and manifest inspection matched the API response.

The immediately repeated request returned `reused=true` with the same SHA256 and save-project version evidence. It did not create a new inflight directory or click Export again.

The post-download recovery branch was also exercised without another Suno mutation: the verified final archive was temporarily represented as an inflight ZIP with its persisted run evidence, the final path was withheld, and the same API call returned `recovered=true`. It restored the identical SHA256, 13 tracks, project ID, save-project version ID, and credits evidence without opening Export. Test-only backup files were removed afterward.

Two simultaneous dry runs for different projects both returned HTTP 200 with their own exact `studio_project_id` and page title. This verified that the shared queue prevented project-selection interference.

A normal completed `type=gen` clip returned HTTP 422 with `NOT_A_STUDIO_EXPORT`, proving that the API does not accept ordinary song IDs as Studio projects.

The acceptance process also found and repaired two implementation defects before final sign-off:

1. exact button matching originally compared duplicated `innerText` and `textContent` as `Export | Export`; exact matching now accepts the canonical visible text
2. macOS `unzip -l` prints `MM-DD-YYYY`, while Debian prints `YYYY-MM-DD`; the ZIP size parser now accepts both and has a regression test

Export evidence is now persisted in `run_evidence.json` before final ZIP validation. A later request can complete an interrupted local validation/finalization from the same inflight ZIP without issuing another Studio Export.
