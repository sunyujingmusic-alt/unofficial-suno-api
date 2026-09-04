# Unofficial Suno API

Self-hosted Next.js API adapters for the current Suno web/API session. The
repository includes the complete source, tests, Docker configuration, command
line tools, and public documentation needed to deploy the service from zero.

> This is an unofficial project. Use your own authenticated Suno session and
> follow Suno's terms and applicable law.

## Quick start with Docker

Prerequisites: Docker Desktop (or Docker Engine with Compose), a Suno account,
and that account's authenticated `SUNO_COOKIE` value.

```bash
git clone https://github.com/sunyujingmusic-alt/unofficial-suno-api.git
cd unofficial-suno-api
cp .env.example .env
# Edit .env and set SUNO_COOKIE to your own cookie.
docker compose up -d --build
```

Check the service and open the local API documentation:

```bash
docker compose ps
curl -f http://127.0.0.1:3000/api/get_limit
open http://127.0.0.1:3000/docs       # macOS
```

The API binds to `127.0.0.1:3000` by default. Change `SUNO_API_BIND` and
`SUNO_API_PORT` only when you understand the security implications. For a
step-by-step Chinese setup, see
[the beginner deployment guide](docs/guides/BEGINNER_DEPLOYMENT_GUIDE_ZH.md).

## Local Node.js run

Node.js LTS and `ffmpeg`/`ffprobe` are recommended for local development and
media validation:

```bash
cp .env.example .env
npm install
npm run build
npm run start
```

Use Docker for the reproducible runtime; use the local command when developing
or debugging source changes.

## API surface

- Create and read: `/api/generate`, `/api/custom_generate`,
  `/api/cover_generate`, `/api/extend_audio`, `/api/mashup_generate`,
  `/api/get`, `/api/feed_by_ids`, `/api/get_limit`, and `/api/workspaces`.
- Playback: `GET /api/playback_audio?id=<clip-id>`.
- Archive and stems: `/api/archive_account`,
  `/api/song_auto_stems_download`, and `/api/studio_multitrack`.
- Studio: `/api/studio/*`, `/api/studio_multitrack`, `/api/concat`, and
  `/api/upload_reference`.

The complete route contract, payloads, and status behavior are in the
[API reference](docs/current/API_REFERENCE.md).

## Playback media: no Suno Download call

The ordinary playback route is deliberately separate from Suno's **Download**
button and from WAV, Export, and stems workflows. It:

1. reads the authenticated clip and selects the progressive HTTPS entry in
   `media_urls`;
2. obtains Mango rights for encrypted playback (`encoding=1.0.0`);
3. unwraps the content key with AES-256-GCM and decrypts the media with
   AES-CTR; and
4. validates and returns the playable M4A/MP3/WebM bytes.

It never invokes Suno's Download endpoint or UI action. Save a playback file
with the local route instead:

```bash
curl -fL 'http://127.0.0.1:3000/api/playback_audio?id=<clip-id>' \
  -o ./output/playback.m4a
ffprobe -v error -show_entries format=duration:stream=codec_name \
  -of json ./output/playback.m4a
```

Read [the playback protocol notes](docs/current/SUNO_PLAYBACK_MEDIA.md) before
re-probing Suno. Signed media URLs are short-lived and must not be committed.

## Configuration and safety

- Keep `SUNO_COOKIE`, `TWOCAPTCHA_API_KEY`, and any Studio token in the ignored
  `.env`; never commit them.
- `SUNO_STUDIO_ENABLE_PAID_GENERATION=0` and
  `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0` are intentional safe defaults.
- If the host uses a proxy, a Docker container reaches it through
  `host.docker.internal`, not the container's `127.0.0.1`.
- `output/` and `studio-state/` are local runtime directories and are not part
  of the public source snapshot.
- Challenge results and HTTP `200` do not alone prove Create success; a valid
  `song_ids` response is the success signal.

## Documentation map

- [Documentation index](docs/README.md)
- [Current production docs](docs/current/README.md)
- [Task guides](docs/guides/README.md)
- [Historical archive](docs/archive/README.md)
- [Packaging metadata](docs/meta/README.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## Validation

```bash
npm run test:playback
npm run test:archive
npm run test:studio-transport
node node_modules/typescript/lib/tsc.js --noEmit
npm run build
docker compose config
```

These checks do not submit paid Suno operations. Only run live Create, Cover,
Extend, Mashup, extraction, or paid Studio tests with explicit authorization.
