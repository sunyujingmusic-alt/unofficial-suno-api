# Suno 分轨纯 HTTP API 与 CLI 生产说明

## 结论与边界

当前正式分轨链路已经由浏览器操作改为服务端纯 HTTP：

- Song Auto split：支持按普通歌曲 `clip_id` 获取或创建分轨，并下载 WAV/MP3 ZIP。
- Studio Multitrack：支持按 `studio_export` 类型的 `clip_id` 解析项目并下载完整 WAV 多轨 ZIP。
- 两条正式链路都不需要 Chrome、CDP、页面点击、浏览器登录态或浏览器下载目录。
- `suno-stems` 只是这两个 HTTP API 的命令行客户端，不承载 Suno 协议、轮询、下载或恢复逻辑。
- MIDI 分轨属于另一套转录协议，纯 HTTP 版本尚未实现，当前明确返回 HTTP 501，不能把它当成已支持能力。

浏览器实现暂时保留在代码中用于对照诊断。只有直接调用 API 并显式传入 `backend=browser` 才会使用；`backend=auto` 还必须显式开启 `allow_browser_fallback`。正式 CLI 固定发送 `backend=http`，不会自动回退浏览器。

## 统一 CLI

```bash
suno-stems song --clip-id ID --format wav
suno-stems song --clip-id ID --format mp3
suno-stems studio --clip-id ID
```

常用参数：

| 参数 | 作用 |
| --- | --- |
| `--api-base URL` | API 地址，默认读取 `SUNO_API_BASE_URL`，否则使用 `http://127.0.0.1:3000` |
| `--download-dir PATH` | 服务端可见的绝对输出目录，不是调用方本机下载目录 |
| `--dry-run` | 只检查上游元数据和可执行状态，不提交 extraction/render |
| `--force` | 忽略已经验证的最终 ZIP，主动执行一次新 render；必须谨慎使用 |
| `--keep-inflight` | 成功后保留 `.inflight` 证据目录 |
| `--extract-timeout-ms N` | Song 新分轨生成等待上限 |
| `--download-timeout-ms N` | 每次 HTTP 下载尝试的超时 |
| `--queue-timeout-ms N` | 等待同一 clip 文件锁的上限 |

CLI 会拒绝未知参数、非法 UUID、非法格式、非正整数和不适用于 Studio 的 `--format`。API 不可达时退出码为 3，API 返回业务错误时退出码为 1，成功时退出码为 0。所有结果以 JSON 输出，适合被 Agent、Shell 或调度器解析。

项目内运行：

```bash
cd <repo-root>
node scripts/suno-stems.mjs song --clip-id ID --format wav
```

## API 契约

### Song Auto split

```http
POST /api/song_auto_stems_download
Content-Type: application/json
```

```json
{
  "clip_id": "8864ca22-9145-469e-a737-cd7e665b42d6",
  "stem_format": "wav",
  "backend": "http",
  "dry_run": false,
  "force_redownload": false
}
```

生产支持的 `stem_format` 为 `wav` 和 `mp3`。归档幂等键是 `clip_id + stem_format`；标题不参与幂等判断。

### Studio Multitrack

```http
POST /api/studio_multitrack
Content-Type: application/json
```

```json
{
  "clip_id": "92493ab6-bc85-4fb2-b7ed-097d9530878a",
  "backend": "http",
  "dry_run": false,
  "force_redownload": false
}
```

输入必须是 `status=complete`、`type=studio_export`，并含有效 `raw.metadata.studio_project_id` 的 clip。API 不接受调用方伪造的 Studio URL 或项目 ID，避免下载到浏览器最后打开的其他项目。

## Song HTTP 链路

```text
clip_id
  -> GET clip metadata
  -> GET /api/clip/{clip_id}/stems/pages
  -> GET /api/clip/{clip_id}/stems?page=N
  -> 复用最佳的完整 stem bank
  -> 如果不存在：持久化 transaction_uuid 和提交意图
  -> POST /api/generate/v2-web/ (task=gen_stem，仅提交一次)
  -> 持久化返回的 stem clip IDs
  -> POST /api/feed/v3 轮询所有 stem clips
  -> 再次发现并选择完整 stem bank
  -> 构造多轨 Studio state
  -> POST /api/studio/render-state-multitrack
  -> 持久化 render download URL
  -> HTTP Range 断点下载 ZIP
  -> ZIP/音频/文件数量校验
  -> SHA256 + manifest
  -> 原子发布最终 ZIP
```

stem bank 会先按完整、非静音轨数量排序，再优先选择较新的 page。`is_loudness_under_threshold=true` 的静音轨不会进入最终 render。轨道按 Lead Vocals、Backing Vocals、Drums、Bass、Guitar、Keyboard、Percussion、Strings、Synth、Other 等稳定顺序输出。

首次不存在 stem bank 时，`gen_stem` 可能返回两组十二轨。API 持久化全部 ID，但只选择一个完整且非静音轨数量最优的 bank 进入 ZIP。

## Studio HTTP 链路

```text
studio_export clip_id
  -> POST /api/feed/v3
  -> 校验 complete/type/studio_project_id
  -> GET /api/studio/project/{studio_project_id}
  -> 校验返回 project.id
  -> 从 project.state.tracks 计算完整时间范围
  -> POST /api/studio/render-state-multitrack (format=wav)
  -> 持久化 render download URL
  -> HTTP Range 断点下载 ZIP
  -> 校验每个 WAV
  -> SHA256 + manifest
  -> 原子发布最终 ZIP
```

纯 HTTP Studio 导出不调用浏览器版的 `save-project`，因此不会因为浏览器当前项目错误而污染其他 Studio 项目，也不会为一次下载额外创建项目版本。

## 并发、幂等与恢复

服务使用文件级跨进程锁，而不是进程内浏览器队列：

- Song 锁：`download_dir/.locks/song-<clip_id>-<format>.lock`
- Studio 锁：`download_dir/.locks/studio-<clip_id>.lock`
- 同一个幂等键的并发请求被合并为“一个执行、其余等待后复用”。
- 不同 clip、不同 Song 格式、Create、Cover、Extend、Mashup、轮询和普通下载可并行执行。
- 超过等待时间返回 retryable HTTP 429；超过陈旧阈值的锁可自动清理。
- 活跃锁每 30 秒刷新心跳，并带唯一 owner token；释放动作只删除自己持有的锁，防止长下载被误判陈旧或旧进程误删新 owner 的锁。

最终 ZIP 和相邻 `.zip.json` manifest 是第一层持久幂等记录。每次复用仍重新检查文件大小、ZIP 完整性、条目和 SHA256；manifest 缺失或过期时会从已验证 ZIP 原子重建。

`.inflight/<clip_id>-<run_uuid>/run_evidence.json` 是第二层恢复记录：

1. 已提交 `gen_stem` 并拿到 clip IDs：重启后接管这些 ID 的轮询，不再创建新的 transaction UUID。
2. 只持久化了提交意图和 transaction UUID：先长时间查询 Suno 是否已经产生 stem bank；需要重放提交时仍使用同一个 transaction UUID，不创建新事务。
3. 已拿到 render URL、ZIP 未完成：从 `.part` 文件按 HTTP Range 续传，不重新 extraction/render。
4. ZIP 已完整、尚未原子发布：重新校验并完成最终 ZIP 与 manifest 发布，不访问 extraction/render。

`force_redownload=true` 会绕过最终归档复用和 `.inflight` 接管，仅用于明确需要重新 render 的运维场景。不要把它作为失败重试参数。

## HTTP 重试和下载一致性

- Studio API 查询/render 最多 4 次，401 会刷新会话；408、425、429、5xx、连接重置和超时按退避重试。
- `gen_stem` 是扣点 mutation，不在 HTTP 方法内部自动重试；提交前先持久化 transaction UUID。
- clip 状态轮询使用相同 ID，临时空结果或网络错误不会触发新 extraction。
- ZIP 下载最多 5 次；已有 `.part` 时发送 `Range: bytes=<offset>-`。
- 服务端返回 206 时追加，返回 200 时安全地从头覆盖，返回 416 且本地已有内容时进入完整 ZIP 校验。
- 只有 ZIP 校验完成后才原子替换最终文件，旧的有效产物不会被半包覆盖。

## 成功判定

不能把拿到 render URL 或 HTTP 200 当成最终成功。必须同时满足：

1. API 返回 `ok=true`。
2. `backend=http` 且 `browser_fallback_used=false`。
3. 最终 ZIP 非空并通过 `unzip -tqq`。
4. Song ZIP 至少包含两条请求格式的非空音频；Studio ZIP 每个条目都是有效 WAV。
5. Studio 每个 WAV 的 codec、采样率、声道数和位深均写入 manifest。
6. 最终 ZIP 的 SHA256 与 API、manifest 一致。
7. 相同请求再次调用返回 `reused=true`，没有新 extraction/render。

## 真实验收基线（2026-08-01）

### Studio 冷路径纯 HTTP

- clip ID：`92493ab6-bc85-4fb2-b7ed-097d9530878a`
- 项目轨数：13
- 结果：13 个有效 WAV，48 kHz、双声道、32-bit float
- `backend=http`，`browser_fallback_used=false`
- 即使传入不可用 CDP 地址仍成功
- credits delta：0
- ZIP 大小：52227548 bytes
- SHA256：`c34eff16e2bcf580270911319f00b2893d92cef49463e113555b4e930b9a9881`

### Song 已有 stem bank

- clip ID：`3fb0b328-13a0-499b-90d7-7ec54629b92e`
- 未提交 extraction，输出 7 个有效 WAV
- SHA256：`e0bd9dc1fa762a338080edc68ec415cbeed321d2546d3d57f022779b9040f895`
- 第二次调用 `reused=true`，未 render、未扣点
- 同一 bank 的 MP3 冷 render 也通过：7 个 MP3，5820198 bytes，SHA256 `192c2abe007fade0f6d205be7e4029bcd6e18d5e2de1dd35a2b0cafe04a69b15`
- MP3 调用的 `generation.submitted=false`，credits 11661 -> 11661，证明格式切换不会重复 extraction

### Song 首次 extraction

- clip ID：`8864ca22-9145-469e-a737-cd7e665b42d6`
- 初始 stem bank 数量为 0
- 只提交一次 `gen_stem`，返回 24 个 clip ID
- 24 个 clip 全部完成，最终选择 8 个非静音轨
- ZIP 大小：319154307 bytes
- SHA256：`173b5811d4bac18e6c88c59d8722594ae22518adeb3ed76b0cbee56d7c4604db`
- credits：11721 -> 11671，首次 extraction 实际消耗 50 点
- 第二次通过统一 CLI 调用返回 `reused=true`，credits 保持 11671

### CLI 验收

```bash
suno-stems song --clip-id 8864ca22-9145-469e-a737-cd7e665b42d6 --format wav \
  --download-dir ./output/suno-stems-http-test

suno-stems studio --clip-id 92493ab6-bc85-4fb2-b7ed-097d9530878a --dry-run
```

第一条命中上述 ZIP 并返回 `reused=true`；第二条通过 HTTP 读取到 13 轨项目，未提交 render。两条均为 `backend=http`、`browser_fallback_used=false`。

完整 `.inflight` ZIP 恢复也做了独立模拟：最终 ZIP 暂不存在但 `run_evidence.json` 与完整下载包存在时，统一 CLI 返回 `recovered=true`，恢复后的 SHA256 与原包完全一致，且没有再次 extraction/render。

跨进程锁也做了真实阻塞测试：预先持有目标 Studio clip 的 lock 后，以 `queue_timeout_ms=1000` 调用 CLI，API 在约 1 秒后返回 HTTP 429、`STUDIO_HTTP_BUSY`、`retryable=true`；释放锁后不留测试目录。

## 运维

构建、部署和健康检查：

```bash
cd <repo-root>
docker compose build suno-api
docker compose up -d --force-recreate suno-api
docker compose ps
curl http://127.0.0.1:3000/api/get_limit
```

默认目录：

```text
SUNO_STEMS_DOWNLOAD_DIR=./output/suno-stems-downloads
SUNO_STUDIO_MULTITRACK_DOWNLOAD_DIR=./output/suno-studio-multitrack-downloads
SUNO_STEMS_QUEUE_TIMEOUT_MS=1800000
SUNO_STEMS_BROWSER_FALLBACK=false
```

Docker 必须把 `./output` 按相同绝对路径挂载进容器。API 的 `download_dir` 是服务端路径，因此远程调用方不能传入只有客户端可见的路径。

故障处理顺序：

1. 先用原参数重试，不加 `force_redownload`。
2. 查看返回的 `error.code`、`retryable` 和 `.inflight/run_evidence.json`。
3. 已有 stem IDs 时只接管轮询；已有 render URL 时只接管下载。
4. 检查最终 ZIP、manifest 和 SHA256，再决定是否成功。
5. 只有确认需要新的上游 render 时才使用 `--force`。
6. 不要删除 Song 的最终 ZIP、manifest 或有效 `.inflight` 证据；冷 extraction 在真实验收中消耗 50 点。

日志和 manifest 不得写入 Cookie、Bearer token、代理凭据、邮箱、2Captcha key 或原始请求头。对外错误只允许返回有界、脱敏的诊断字段。

## 与 Skill 的关系

API 是唯一正式能力层。Skill 不得复制 `gen_stem`、Studio state、轮询、HTTP Range 下载、ZIP 校验或恢复实现；它只负责选择 `song`/`studio`、收集 clip ID、调用 `suno-stems`，并按 `ok/reused/recovered/output_path/manifest_path/sha256` 判定结果。API 契约变化后再同步 Skill，不能为了兼容 Skill 限制 API。
