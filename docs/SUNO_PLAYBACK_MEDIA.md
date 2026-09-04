# Suno ordinary playback media

The current Suno web player no longer exposes a usable `audio_url` for many
clips. The field may be `https://studio-api.prod.suno.com/api/forbidden` even
when the song plays normally in the browser. The playable source is instead the
progressive item in `media_urls`.

## Endpoint

```http
GET /api/playback_audio?id=<clip-id>
```

The local route requires the same authenticated server session used by the
other Suno endpoints. It returns the original playback media as a binary
response. A common response is `audio/mp4` containing M4A/Opus.

## Protocol

1. Resolve the clip through the current feed/clip API.
2. Select an HTTPS `media_urls` item with `delivery=progressive`.
3. Reject unknown `encoding` values instead of guessing a new algorithm.
4. For `encoding=1.0.0`, request:

   ```http
   POST https://studio-api-prod.suno.com/api/mango/rights
   Content-Type: application/json

   {"content_params":{"content_id":"<clip-id>","content_type":"clip"}}
   ```

5. Derive the user key as `SHA-256(current JWT)`.
6. Base64-decode `key` and `iv`; each is `12-byte nonce + ciphertext + 16-byte GCM tag`.
7. Unwrap both values with AES-256-GCM and the clip ID as additional authenticated data.
8. Fetch the CloudFront progressive payload and decrypt it with AES-CTR using
   the unwrapped content key and IV. The counter is 128-bit big-endian.
9. Validate that the cleartext is a recognized MP4/M4A, WebM, or MP3 container
   before returning it.

## Security and operations

- Keep `SUNO_COOKIE` and optional captcha credentials in an untracked `.env`.
- Do not forward Suno Cookie values to the media CDN; the implementation uses
  the current Bearer token for the playback request and keeps cookies on the
  authentication domain.
- Do not replace this route with the Suno Download button. Download, WAV,
  Export, and stems flows are separate interfaces with different limits or
  credit behavior.
- Preserve the clip ID when retrying. The clip ID is both the rights lookup ID
  and AES-GCM AAD, so mixing IDs causes authentication failure.
- If Suno changes `media_urls`, `encoding`, Mango rights, or the cipher mode,
  capture the browser's ordinary Play request again and add a fixed test vector
  before changing production code.
- The route is not an authorization bypass. Callers must have permission to
  play and retain the content under Suno's terms.

## Local example

```bash
curl -fL 'http://127.0.0.1:3000/api/playback_audio?id=<clip-id>' \
  -o ./output/playback.m4a
ffprobe -v error -show_entries format=duration:stream=codec_name \
  -of json ./output/playback.m4a
```

The server does not store signed media URLs in JSON state. Temporary encrypted
media is processed in memory or short-lived local files and the final response
contains only the decrypted ordinary playback media.
