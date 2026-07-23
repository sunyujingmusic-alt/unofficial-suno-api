# unofficial-suno-api Technical Notes

This file preserves the current open-source technical conclusions without
machine-specific paths or application-specific workflows.

## Current Create Path

The verified create endpoint is:

```text
POST https://studio-api.prod.suno.com/api/generate/v2-web/
```

The verified polling and clip-read endpoint is:

```text
POST https://studio-api.prod.suno.com/api/feed/v3
```

The local API wraps these with:

- `POST /api/create_from_final_song`
- `POST /api/custom_generate`
- `POST /api/generate`
- `POST /api/feed_by_ids`
- `GET /api/get?ids=...`
- `GET /api/clip?id=...`

## Auth Chain

The runtime reads cookies from the incoming request or `SUNO_COOKIE`, bootstraps
the Clerk session token, adds the dynamic Browser-Token timestamp, and keeps the
session alive before upstream calls.

## Create Precheck

Create begins with upstream:

```text
POST /api/c/check
```

The local `POST /api/create_precheck` route only reports the current challenge
state. It does not solve a captcha token because that token would be scoped to a
short-lived request and discarded before the later create call.

During real create, precheck and challenge solving happen in the same `SunoApi`
instance that sends `generate/v2-web`.

## Challenge Branches

- `required=false`: continue directly to create.
- `required=true, captcha_version=1`: hCaptcha image challenge. Keep solve and
  submit in one browser context.
- `required=true, captcha_version=2`: Turnstile. Use 2Captcha API v2 and submit
  create in the same runtime instance.

Verification is pending until Suno accepts create and returns `song_ids`.

## Final Song Middleware

`POST /api/create_from_final_song` is the recommended field-contract custom-song entry.
It validates and writes:

```text
<output_dir>/final_song.json
```

Then submits:

```text
title  -> title
lyrics -> prompt
styles -> tags/style
```

The middleware contract is intentionally limited to JSON shape and field
types: exactly `title`, `lyrics`, and `styles`, all strings. Lyrics structure,
title length, style length, Verse/Chorus sections, instrumental markers, and
outro labels are not hard API validation rules.

No upstream application workflow is required.

## Polling Rules

After create returns clips, poll by ids. Terminal states:

- all requested clips `complete`
- all requested clips `error`
- timeout

Temporary `502`, `503`, `504`, timeouts, and empty poll responses should be
treated as retryable during polling.

## Download Rules

Clip metadata may include:

- `audio_url`
- `image_url`
- `wav_file_url`

Whether to persist files locally is a caller policy. A download failure after
`song_ids` exist is not a reason to submit Create again.
