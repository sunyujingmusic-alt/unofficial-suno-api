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

## 账户归档更新：使用播放途径下载

账户归档（`/api/archive_account` 和 `npm run download:account`）已经调整为由播放途径承载：读取 `media_urls`，获取 Mango 播放权限、本地解密，并用 FFmpeg 转为 MP3/WAV。普通归档不再调用官方 Download、`convert_wav` 或 `wav_file`，不会通过这些接口扣除珍贵的官方下载点数。这描述的是本工具的请求路径，不是对 Suno 未来计费政策的保证。

**本项目使用限制：播放途径下载的文件不得用于商业变现，包括上架 Spotify、短视频盈利等。** 本工具只提供个人归档，不提供或验证商用授权。请注意两点：

1. **缺少官方下载凭证保证。** Suno 官方说明，今后从其网站下载的歌曲会附加 C2PA 内容凭证，标识其 Suno / AI 来源。本工具提取、解密并转码播放音频，不生成也不保证保留官方下载的 C2PA 凭证。C2PA 是来源信息，不能单独证明版权归属；缺失凭证也不能单独证明没有版权。
2. **不产生官方下载交易。** 本工具不调用计次 Download 接口，也不生成官方下载交易记录；归档成功不能作为获得商用授权的证明。下方官方凭证页面没有规定“只有扣除下载额度才获得商用授权”，实际授权应以 Suno 当时适用的条款和账户权益为准。

[查验 Suno 歌曲 C2PA 内容凭证的官方渠道](https://suno.com/suno-credentials)。该页面说明，此检测仅适用于今后下载的新歌曲，不追溯已下载的旧文件。

MP3 是播放源的本地有损转码；WAV 是播放源解码后的 PCM，并不是 Suno 原始无损母带。中断后可重新运行归档，已验证且标记为 `suno_playback_audio` 的文件可复用；旧归档文件不会仅因存在就被标记为播放来源。

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
