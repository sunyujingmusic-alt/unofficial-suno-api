# Suno API 当前完整使用说明

更新日期：2026-09-07。本文以当前源码和 `docs/current/` 契约为准；历史审计只用于追溯，不覆盖本文。

## 1. 运行与认证

服务默认监听 `127.0.0.1:3000`。Docker 使用镜像内置构建产物，不能把旧宿主 `.next` 挂载覆盖镜像。将自己的 `SUNO_COOKIE` 放在未跟踪 `.env`，代理按实际网络配置；不要把 Cookie、验证码密钥、签名 URL 或运行时响应提交到 GitHub。

从公开仓库根目录部署：

```bash
cp .env.example .env
# 填写自己的 SUNO_COOKIE；按网络需要配置代理。
docker compose up -d --build
curl -f http://127.0.0.1:3000/api/get_limit
```

Docker 将本地 `./output` 映射到 `/app/output`，Studio 状态单独持久化。本地 Node 运行使用 `npm install && npm run build && npm run start`；应安装 FFmpeg/ffprobe，并把示例中的 `/app/output` 改成当前用户可写目录。示例时区为 UTC，源码缺省时区为 Asia/Shanghai，以环境变量为准。

## 2. 创建、轮询和恢复

`/api/generate`、`/api/custom_generate`、Cover、Extend、Mashup 会访问 Suno 上游，可能消耗 credits 或改变账户状态。创建返回 clip ID 后，后续轮询或媒体失败都继续使用原 ID，不重复提交。`/api/custom_generate` 默认创建并等待，返回歌曲元数据和输出目录提示，不自动保存 MP3/WAV；`download_mp3`、`download_wav` 不会让该 HTTP 路由恢复旧的自动下载行为。

## 3. 普通歌曲播放与下载

使用 `GET /api/playback_audio?id=<clip-id>`。服务读取 `media_urls` 的 progressive HTTPS 媒体；不使用旧 `audio_url` 回退。`encoding=1.0.0` 时获取 Mango rights，用 JWT 派生密钥，以 clip ID 作为 AAD 解包 key/IV，再用 AES-CTR 解密。返回通常是 M4A/Opus 原播放容器。保存时使用响应 Content-Type 或 `X-Suno-Playback-File-Extension`，不要只修改文件后缀。

播放音频属于短时媒体流程；加密流失败后重新获取，不做 Range 拼接，也不会转入官方 Download。需要 MP3/WAV 时使用 FFmpeg 本地转码。WAV 是播放源解码后的 PCM，不是原始无损母带。

## 4. 账户归档

`POST /api/archive_account` 或 `npm run download:account` 的普通 MP3/WAV 已完全使用播放路径：`media_urls → Mango rights → 本地解密 → FFmpeg → 哈希校验及可用时的 ffprobe 检查 → 原子发布`。不调用 `/api/billing/clips/<id>/download/`、`convert_wav` 或 `wav_file`，播放失败不回退。清单和 metadata 写入 `mp3_source` / `wav_source: suno_playback_audio`；只有带该来源标记且校验通过的文件才复用，旧文件不会被静默改标。

先运行 `npm run download:account -- --dry-run --limit 5`。`--limit` 只限制候选数量，不表示扫描完整账户；需要达到完整账户末尾应检查 `stop_reason=end_of_feed`。默认并发 1，最大 3；保留 manifest、`.archive.lock` 和输出目录。失败格式可重跑，不能因此重新 Create。封面仍有自己的 URL 刷新与 Range 恢复。

播放归档文件仅供个人、非商业使用，不得用于 Spotify 上架或短视频盈利。本工具不授予或验证商用授权，也不产生官方下载交易。官方下载的新歌曲可能附带 Suno C2PA 来源凭证；本工具不生成或保证保留该凭证。C2PA 表示来源，不等同版权归属。官方查验：[suno.com/suno-credentials](https://suno.com/suno-credentials)。

## 5. 分轨和 Studio

Song Auto Split 与 Studio Multitrack 是专用的分轨/工程渲染流程，不通过普通播放流获得。它们可以使用 HTTP Range 下载 ZIP、校验 ZIP/WAV、持久化 inflight 并复用结果；不要将其与普通 MP3/WAV 归档混用。Studio paid/unverified 写入默认关闭。

## 6. 上传、隐私和故障处理

`upload_reference` 的 `audio_url` 是输入来源字段，此次播放下载收紧不影响它。不要公开 Suno Cookie、2Captcha 密钥、代理凭据、Mango rights、媒体 URL、clip/project ID 组合或原始响应。遇到 `media_urls`、encoding、Mango 协议变化时先保存脱敏测试向量，再修改实现。健康检查用 `/api/get_limit`；创建异常时优先查看已有 clip ID 和持久化归档状态，不盲目重试付费操作。

## 7. 相关文档

- [API reference](API_REFERENCE.md)
- [Playback media](SUNO_PLAYBACK_MEDIA.md)
- [Account archive](SUNO_ACCOUNT_ARCHIVE.md)
- [Runtime SOP](SUNO_API_RUNTIME_SOP.md)
- [Stems and Studio](STEMS_HTTP_API_AND_CLI.md)

## 8. HTTP 能力索引

| 能力 | 入口 | 使用要点 |
| --- | --- | --- |
| 账户与歌曲读取 | `/api/get_limit`、`/api/workspaces`、`/api/clip`、`/api/get`、`/api/feed_by_ids` | 使用当前会话；按已有 ID 恢复 |
| 创建 | `/api/generate`、`/api/custom_generate` | 提交一次后保留返回 ID |
| Cover / Extend / Mashup | `/api/cover_generate`、`/api/extend_audio`、`/api/mashup_generate` | 使用来源 clip；请求字段见 API reference |
| 上传与拼接 | `/api/upload_reference`、`/api/concat` | 上传支持文件或 URL；拼接可能触发 Studio 渲染 |
| 普通播放 | `/api/playback_audio` | 返回播放容器，不承诺原始母带 |
| 账户归档 | `/api/archive_account` | POST 执行，GET 查询持久化状态 |
| 分轨 | `/api/song_auto_stems_download`、`/api/studio_multitrack` | 专用 ZIP 路径，保留 inflight 与复用记录 |
| Studio | `/api/studio/projects/*`、`/api/studio/media/*`、`/api/studio/export`、`/api/studio/multitrack`、`/api/studio/generate` | Full Song/Selected Range 导出返回 Library clip；多轨导出才是 ZIP |
| Transport | `/api/studio/transport/*` | 依赖已登录并加载工程的浏览器/CDP，与普通播放下载不同 |

## 9. 检查与版本规则

播放协议、账户归档和 TypeScript 检查命令：`npm run test:playback`、`npm run test:archive`、`node node_modules/typescript/lib/tsc.js --noEmit --incremental false`。这些测试不代表真实账户下载或扣点实验。失败时检查接口返回、manifest 和会话有效性；不要通过重新 Create 恢复下载。

本文与增量记录优先于历史审计中已废止的下载描述。历史分轨/浏览器验收结果仅用于追溯；当前实现和具体状态码以 API reference、专用契约和源码为准。
