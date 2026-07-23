# unofficial-suno-api Runtime SOP

## Local Run

```bash
cp .env.example .env
# Fill SUNO_COOKIE in .env.
npm install
npm run dev
```

## Docker Run

```bash
cp .env.example .env
# Fill SUNO_COOKIE in .env.
docker compose up --build
```

The Compose file builds from source and mounts:

```text
./public -> /app/public
./output -> /app/output
```

Its healthcheck only verifies that the local Next.js HTTP server is responding.
It does not depend on a successful upstream Suno quota request.

## Health Checks

```bash
curl http://127.0.0.1:3000/api/get_limit
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

`create_precheck` is diagnostic only. Do not count it as a successful create.

## Minimal Create Validation

Healthy `create_from_final_song` behavior:

1. Validate `final_song` as exactly `title`, `lyrics`, and `styles`, with all
   three values as strings.
2. Write `<output_dir>/final_song.json`.
3. Run create precheck in the same API instance that will create the song.
4. Branch by captcha result.
5. Submit upstream `POST /api/generate/v2-web/`.
6. Receive `song_ids`.
7. Poll `/api/feed/v3` through local `feed_by_ids` until terminal clip status.

## Captcha Operations

Suno's create check is versioned:

- `captcha_version=1`: hCaptcha image challenge. Keep solving and Create
  submission in the same authenticated browser context.
- `captcha_version=2`: Turnstile. Solve through 2Captcha API v2 and continue in
  the same server-side `SunoApi` instance.
- `POST /api/create_precheck` is only diagnostic. Real create routes run their
  own precheck again so any token can be solved and used in the same request
  context.

Useful environment variables:

```text
TWOCAPTCHA_API_KEY=
SUNO_CREATE_CAPTCHA_METHOD=auto
SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL=
SUNO_CREATE_USER_TIER=
SUNO_CREATE_TURNSTILE_SITEKEY=0x4AAAAAADI7xDNyj-3LcIbi
SUNO_CREATE_HCAPTCHA_SITEKEY=d65453de-3f1a-4aac-9366-a0f06e52b2ce
SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser
```

Variable boundaries:

- `SUNO_CREATE_CAPTCHA_METHOD=auto` follows Suno's `/api/c/check` result.
  Manual `hcaptcha` or `turnstile` values are preferences, not a way to force a
  captcha type when Suno reports the other version.
- `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser` means the browser page must submit
  the hCaptcha challenge in the same authenticated browser context. The local
  `captcha_coordinates` route only helps obtain click coordinates.
- `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=legacy` makes the server attempt a direct
  hCaptcha token solve, but upstream challenge shape can still make that path
  unreliable.
- `SUNO_CREATE_USER_TIER` overrides create metadata. Leave it empty unless you
  intentionally need a fixed tier value; otherwise the runtime reads
  `/api/billing/info`.

Only use a shared captcha proxy when it is reachable from both this runtime and
2Captcha. Do not use `127.0.0.1`, `localhost`, or a LAN-only proxy for shared
public IP binding.

## Failure Rules

- No `song_ids`: create did not produce a usable submission. Retry create only
  after inspecting the exact error.
- Has `song_ids`, poll failed: do not submit again just to repair polling.
  Continue with `feed_by_ids`.
- Has `song_ids`, download failed: do not submit again just to repair download.
  Re-read the clips and download from `audio_url`.
- `2Captcha ready`: not proof of verification.
- `streaming`: not complete.

## Open Source Hygiene

Do not commit:

- `.env`
- real cookies or API keys
- browser profiles
- `output/`
- `.next/`
- `node_modules/`
- runtime logs
