# Public API Reference

All examples assume:

```text
http://127.0.0.1:3000
```

The API is unofficial. Upstream request formats may change without notice.

## Read-only account and clip routes

- `GET /api/get_limit`
- `GET /api/workspaces?show_trashed=true`
- `GET /api/clip?id=<clip-id>`
- `GET /api/get?ids=<id-1>,<id-2>`
- `POST /api/feed_by_ids`
- `GET /api/archive_account?output_dir=<server-path>`

## Create routes

- `POST /api/create_precheck`: diagnostic challenge state.
- `POST /api/generate`: prompt-mode create.
- `POST /api/custom_generate`: title/lyrics/style custom create.

Create, Cover, Extend, Mashup, upload, concat, stems extraction, and Studio
generation may consume credits or change account state.

Once a response contains clip IDs, recovery must poll those IDs. Do not submit a
second create merely because a later poll or download timed out.

## Captcha routes

- `POST /api/captcha_coordinates`
- `PATCH /api/captcha_coordinates`

2Captcha support is optional. Keep credentials private. The definitive success
condition is a successful Suno operation with clip IDs, not a solver response.

## Reference audio

`POST /api/upload_reference` accepts:

- `multipart/form-data` with `file`; or
- JSON with `audio_url`.

Optional fields include upload filename, project, title, lyrics, stem-mix flag,
poll interval, and wait behavior.

## Cover

`POST /api/cover_generate` requires `cover_clip_id`.

Common optional fields:

- `lyrics` / `prompt`;
- `style` / `tags`;
- `title`;
- `make_instrumental`;
- `model`;
- `wait_audio`;
- `persona_id`;
- `vocal_gender`;
- `style_weight`;
- `weirdness_constraint`;
- `audio_weight`;
- Workspace project selection.

## Extend / Remix

`POST /api/extend_audio` requires `audio_id`.

Common optional fields:

- `continue_at`;
- `prompt` / `lyrics`;
- `tags` / `style`;
- `negative_tags`;
- `title`;
- `model`;
- `wait_audio`;
- Workspace project selection.

## Mashup

`POST /api/mashup_generate` requires exactly two IDs in
`mashup_clip_ids`. Aliases for a first and second clip are also accepted.

The remaining style, title, model, instrumental, weight, and workspace fields
parallel Cover.

## Concat

`POST /api/concat` requires at least two ordered clips. Each clip may include:

- `clip_id`;
- `order`;
- optional `duration`.

The server can resolve missing durations from clip metadata before building the
Studio timeline.

## Account archive

- `POST /api/archive_account`: execute an archive on the server.
- `GET /api/archive_account`: inspect persisted state for one output directory.

The server accepts output paths only inside `SUNO_OUTPUT_DIR` or
`SUNO_ACCOUNT_ARCHIVE_DIR`.

## Stems

- `POST /api/song_auto_stems_download`
- `POST /api/studio_multitrack`

Use `backend=http` for the production path. `backend=auto` uses browser fallback
only when explicitly enabled. `backend=browser` is a legacy/diagnostic path.

## Studio

- `GET|POST /api/studio/projects`
- `GET|POST /api/studio/projects/:projectId`
- `GET /api/studio/projects/:projectId/versions`
- `GET /api/studio/projects/:projectId/versions/:versionId`
- `GET /api/studio/revisions/:revisionId`
- `POST /api/studio/revisions/:revisionId/clone`
- `GET|POST /api/studio/media/:clipId`
- `POST /api/studio/export`
- `POST /api/studio/multitrack`
- `GET|POST /api/studio/generate`
- `GET /api/studio/transport/status`
- `POST /api/studio/transport/play`
- `POST /api/studio/transport/pause`
- `POST /api/studio/transport/stop`
- `POST /api/studio/transport/seek`
- `GET /api/studio/unverified_actions`

Workspace and Studio Project IDs are different ID types and are not
interchangeable.

### Studio 2.0 playback transport

The `/api/studio/transport/*` endpoints adapt the current Suno Studio 2.0
runtime control logic. They read and control the currently open Studio page
through Chrome DevTools Protocol:

本次更新的核心内容是适配 Suno Studio 2.0 版本的运行控制逻辑，包括
status/play/pause/stop/seek 这五类播放控制与状态读取能力。

- `status` returns playing state, beats, full floating-point seconds, timeline
  state, observed timestamp, Studio project ID, and selected browser source;
- `play`, `pause`, and `stop` act on the visible Studio timeline;
- `seek` accepts exactly one of `{ "seconds": number }` or `{ "beats": number }`.

Configure one or more Chrome CDP sources with
`SUNO_STUDIO_TRANSPORT_CDP_CANDIDATES`. Each source must expose at most one
loaded Studio project page.

## HTTP status behavior

- 2xx: request accepted or completed.
- 207: account archive finished with one or more per-clip failures.
- 4xx: invalid request, missing authorization, or disabled safety gate.
- 5xx: runtime or upstream failure.

Clients should preserve returned clip IDs and idempotency keys before retrying
read/poll/download stages.
