# unofficial-suno-api Guide

## Supported Local Endpoints

- `GET /api/get_limit`
- `GET /api/workspaces`
- `POST /api/create_precheck`
- `POST /api/create_from_final_song`
- `POST /api/custom_generate`
- `POST /api/generate`
- `GET /api/get?ids=...`
- `POST /api/feed_by_ids`
- `GET /api/clip?id=...`
- `POST /api/captcha_coordinates`
- `PATCH /api/captcha_coordinates`

## Upstream Endpoints Used Internally

- Create: `POST https://studio-api.prod.suno.com/api/generate/v2-web/`
- Poll/read: `POST https://studio-api.prod.suno.com/api/feed/v3`
- Challenge check: `POST https://studio-api.prod.suno.com/api/c/check`
- Clip download preparation: `POST /api/billing/clips/{clipId}/download/`

## Recommended Custom Create Path

Use `POST /api/create_from_final_song` when the caller can produce a complete
song specification first.

Request:

```json
{
  "final_song": {
    "title": "Example Song",
    "lyrics": "First lyric line\nSecond lyric line\nThird lyric line",
    "styles": "Mandopop, emotional vocal, mid-tempo, clean guitar, warm drums"
  },
  "model": "chirp-fenix",
  "wait_audio": true
}
```

Response includes:

```json
{
  "final_song_json": "/app/output/<timestamp>_<title>/final_song.json",
  "song_ids": ["..."],
  "clips": []
}
```

The route writes `final_song.json` before create and submits the exact same
three values to Suno. Validation is limited to the JSON field contract: the
object must contain exactly `title`, `lyrics`, and `styles`, and each value must
be a string. Title length, lyric length, section labels, Verse/Chorus structure,
instrumental markers, outro labels, and style length are caller-side creative
policy choices, not middleware checks.

## Raw Custom Generate

`POST /api/custom_generate` remains available for callers that already manage
their own validation layer.

```json
{
  "title": "Example Song",
  "prompt": "Full lyrics",
  "style": "Mandopop, emotional vocal",
  "model": "chirp-fenix",
  "wait_audio": true
}
```

`custom_generate` returns `song_ids`, `output_dir`, workspace metadata, and
clips. It does not make `final_song.json` mandatory; use
`create_from_final_song` when you need that checkpoint.

## Completion Semantics

- `song_ids` means create was accepted.
- `streaming` is not complete.
- A completed business workflow should keep polling `feed_by_ids` until all
  requested clips are `complete` or terminally `error`.
- `audio_url` and `image_url` are returned in clip metadata when available.
- Local MP3/WAV download policy is caller-owned unless a route explicitly
  downloads files.

## Captcha Semantics

`POST /api/create_precheck` is diagnostic. It reports whether create currently
requires a challenge, but it intentionally does not solve or cache a token in
that short-lived request.

For create:

- `required=false`: continue directly to create.
- `captcha_version=1`: hCaptcha. The default runtime returns
  `BROWSER_CAPTCHA_REQUIRED` so a browser caller can solve and submit in the
  same authenticated page.
- `captcha_version=2`: Turnstile. The runtime can solve through 2Captcha API v2
  and continue create in the same `SunoApi` instance.
- real create routes rerun precheck inside the same `SunoApi` instance that
  will submit create; do not expect the diagnostic route to carry state across
  requests
- in `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser`, `POST /api/captcha_coordinates`
  only returns click points; the actual challenge submission still belongs to
  the browser page

A 2Captcha `ready` result means only that a solver produced a token or
coordinates. The definitive proof is a successful Suno create response with
`song_ids`.
