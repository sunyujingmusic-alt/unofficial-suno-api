# Suno Studio API 功能说明

**适用仓库：** `suno-api-final`
**实现依据：** `Suno Studio OpenCLI 功能探索报告.md` §25.10
**实现日期：** 2026-08-08
**原则：** 工程、生成、媒体分析和导出以直接 HTTP API 为主实现；实时 Transport 是明确标注的 CDP Player Bridge。`studio-opencli.mjs` 只访问本地 API，不直接访问 Suno，也不重试任何 POST。

## 1. 功能边界与验证等级

本模块把 Studio 功能分为三层，避免把“Bundle 发现”误写成“业务已验证”：

| 等级 | 含义 | 本模块处理方式 |
|---|---|---|
| P0 | 报告中已有真实主链证据 | 提供正式 HTTP 适配器、状态轮询、落盘和完整性校验 |
| P1 | 只读或保存/版本主链已具备契约 | 提供固定路径适配器，严格区分 ID 语义 |
| P2 | 报告只发现入口、没有真实写入证据 | 只列目录；默认不转发，禁止自动探测 |

当前已并入：

- P0 Multitrack：`render-state-multitrack` → ZIP → 原子落盘 → SHA-256、`unzip -tq`、WAV 数量和代表性 `ffprobe`。
- P0 Export：`render-state`，支持 Full Song 和 Selected Time Range，返回 Library Clip ID 并用 `/api/feed/v3` 轮询。
- P0 Instrument/Cover：`generate/v2-web`，分别使用 `stem_condition` 和 `cover_stem_condition`。
- P1 Project/Version：列表、创建、读取、保存、版本读取、Revision 读取。
- 只读媒体：Waveform、Downbeats、MIDI、Aligned Lyrics v3、Novelty、Stems pages、Clip 所属 Studio Projects、Streaming Downbeats v2。
- Transport：播放、暂停、停止、秒/Beat 跳转和当前位置读取；优先通过新版 Studio 页面的 DSP v2 Context 完成，旧版 `playbackController` 保留为回退。
- P2 目录：Speed/Reverse/Crop/Fade、Extract Stems、Remove FX、Import/Record、Warp、Alternate Takes，以及 Revision clone 和 Project archive/bookmark/metadata 写操作。

报告中的 Instrument/Cover 真实扣点、Full Song/Selected Range Library Export、Multitrack ZIP 完整性证据最初属于探索阶段证据。2026-08-08 在用户明确授权后，又使用正式 HTTP 路由完成了一轮独立真实验收；Instrument 和 Cover 各只提交一次，各使用唯一幂等键，后续没有重放相同 POST。

## 2. ID 语义：必须严格区分

### 2.1 Workspace Project ID

这是 Suno 普通 Create/Instrument/Cover 生成所属的工作区 ID：

- 公开请求字段：`workspace_project_id`
- 上游 `generate/v2-web` 字段：`project_id`
- 不能填 Studio Project ID。

### 2.2 Studio Project ID

这是 Studio 工程本身的 ID：

- 公开请求字段：`studio_project_id`
- `render-state-multitrack` 的 `project_id`
- `/api/studio/project/{id}` 的 `{id}`
- `/api/studio/save-project` 的 wire 字段虽然也叫 `project_id`，但这里必须是 Studio Project ID。

### 2.3 其他 ID

- `studio_project_version_id`：Studio 工程版本 ID。
- `clip_id`：Suno 音频/生成结果 ID。
- `revision_id`：Studio Project Revision ID。
- `idempotency_key`：本服务本地幂等键，不是 Suno ID；应视为敏感恢复凭证。

## 3. HTTP API 目录

### 3.1 `POST /api/studio/multitrack`

直接调用 Studio 的 `render-state-multitrack`。

请求：

```json
{
  "studio_project_id": "00000000-0000-0000-0000-000000000000",
  "state": {
    "tracks": [
      {
        "clips": [
          { "startBeats": 0, "endBeats": 128 }
        ]
      }
    ]
  },
  "start_beats": 0,
  "end_beats": 128,
  "downbeats": [],
  "format": "wav",
  "output_path": "./output/studio-exports/example.zip",
  "download": true,
  "force_render": false
}
```

规则：

1. `studio_project_id` 必须是 UUID，Workspace ID 会被拒绝。
2. `state` 必须包含可推导的音频时间线；未传 `start_beats/end_beats` 时从 `tracks[].clips[]` 推导。
3. 当前上游契约要求 Multitrack 请求带 `title`；未传时服务生成安全默认标题，并将标题纳入请求指纹。
4. 当前只接受已验证的 `format=wav`。
5. 默认按工程、标题、时间线、downbeats、state 的 SHA-256 指纹生成稳定文件名。
6. 已有同一指纹且通过校验的 ZIP 直接复用，不再提交上游 render。
7. 同一指纹并发请求由文件锁保护，冲突返回 HTTP 429。
8. 下载先写 `.part-<uuid>`，完整性校验通过后才替换最终文件。
9. ZIP 必须可通过 `unzip -tq`，且至少包含一个 WAV；代表性 WAV 用 `ffprobe` 检查。
10. SMB 挂载可能短暂产生 `.smbdelete*`；成功结果不会再因为锁目录延迟清理而被覆盖成 HTTP 500。

成功响应的关键字段：

```json
{
  "project_id": "…",
  "request_fingerprint": "sha256…",
  "reused": false,
  "upstream_submitted": true,
  "local_path": "./output/studio-exports/example.zip",
  "file_size": 137975773,
  "sha256": "…",
  "container": "zip",
  "container_test": "pass",
  "entry_count": 12,
  "wav_count": 12,
  "representative_wav": { "format": {}, "streams": [] }
}
```

当 `download=false` 时只返回短时 `download_url`，并标记 `download_url_expires=true`；服务不会把签名 URL 写入恢复账本。

### 3.2 `POST /api/studio/export`

直接调用 Studio 的 `render-state`，语义是“渲染并保存到 Suno Library”，不是本地 ZIP 下载。

Full Song：

```json
{
  "mode": "full_song",
  "studio_project_id": "00000000-0000-0000-0000-000000000000",
  "state": { "tracks": [] },
  "title": "Studio export",
  "wait_audio": true
}
```

Selected Time Range：

```json
{
  "mode": "selected_time_range",
  "studio_project_id": "00000000-0000-0000-0000-000000000000",
  "state": { "tracks": [] },
  "start_beats": 64,
  "end_beats": 128,
  "downbeats": [],
  "wait_audio": true
}
```

服务：

- 只提交一次 `render-state`。
- Full Song 也会从 `state.tracks[].clips[]` 推导 `start_beats/end_beats`，以兼容当前上游契约。
- 从响应提取 Library Clip ID。
- 默认通过 `/api/feed/v3` 轮询，直到 `complete` 或明确失败。
- 返回 `clip_id`、状态和最终 Clip 元数据。
- 不声称本地音频文件已经生成；需要本地文件时使用 Multitrack 或已有下载 API。
- 验收时应以最终 `clip.status` 为准；上游初始 render job 字段可能仍显示 `queued`。

### 3.3 `POST /api/studio/generate`

这是唯一默认关闭的付费 Studio 生成入口。

Instrument 示例：

```json
{
  "idempotency_key": "studio-instrument-20260808-001",
  "mode": "instrument",
  "workspace_project_id": "00000000-0000-0000-0000-000000000000",
  "studio_project_id": "00000000-0000-0000-0000-000000000000",
  "stem_condition_clip_id": "00000000-0000-0000-0000-000000000000",
  "stem_control_tags": "Add Synth",
  "title": "Instrument take",
  "model": "chirp-fenix",
  "batch_size": 2,
  "confirm_paid_generation": true
}
```

Cover 额外字段：

```json
{
  "mode": "cover",
  "cover_clip_id": "00000000-0000-0000-0000-000000000000",
  "cover_start_s": 0,
  "cover_end_s": 30
}
```

三重闸门：

1. 服务端 `SUNO_STUDIO_ENABLE_PAID_GENERATION=1`。
2. 请求体 `confirm_paid_generation=true`。
3. `X-Suno-Studio-Token`（或 `Authorization: Bearer ...`）与服务端 `SUNO_STUDIO_PAID_API_TOKEN` 匹配。

Token 只做 SHA-256 常量时间比较，不写日志、不写账本、不返回响应。

生成状态机：

```text
reserved
  └─ submit_inflight ── submitted ── complete
                    │          └──── terminal_failure
                    └─ unknown_after_submit
```

- `reserved`：已占用幂等键，尚未发上游 POST。
- `submit_inflight`：已记录提交前 Credits 快照。
- `submitted`：已保存 Clip ID 和提交后 Credits 快照。
- `complete`：所有 Clip 完成，并完成工程插入观察。
- `terminal_failure`：上游返回明确失败，或轮询得到失败状态。
- `unknown_after_submit`：HTTP 客户端不确定 POST 是否抵达上游；绝不自动重建。

重复调用同一 `idempotency_key`：

- 请求指纹相同：返回原记录；有 Clip ID 时只轮询。
- 请求指纹不同：HTTP 409。
- 没有 Clip ID 的 `unknown_after_submit`：只能人工根据账本/上游状态处理，不允许自动再 POST。

`studio_project_id` 在该入口用于“生成后工程插入观察”，不是上游生成归属字段。当前真实验收中，生成结果均成功完成，但没有观察到 Suno 自动把新 Clip 插入指定 Studio Project；调用方不能把该观察字段当成自动插入承诺。

### 3.4 Project / Version / Revision

| 方法 | 路由 | 说明 |
|---|---|---|
| GET | `/api/studio/projects` | Studio 工程列表 |
| POST | `/api/studio/projects` | 创建工程；不是生成扣点探测 |
| GET | `/api/studio/projects/{studio_project_id}` | 读取工程 |
| POST | `/api/studio/projects/{studio_project_id}` | 默认 `action=save` 保存 state |
| GET | `/api/studio/projects/{studio_project_id}/versions` | 版本列表 |
| GET | `/api/studio/projects/{studio_project_id}/versions/{version_id}` | 指定版本 |
| GET | `/api/studio/revisions/{revision_id}` | Revision 读取 |
| POST | `/api/studio/revisions/{revision_id}/clone` | 未验证写操作，默认 403 |

工程保存请求必须提供 `state`。URL 中的 Studio ID 会被服务强制写入上游 `project_id`，调用方传入的 Workspace ID 会被拒绝。

`archive/unarchive/bookmark/metadata` 作为 Project POST 的 `action` 保留了固定 HTTP 适配器，但属于未验证写操作，必须额外满足：

- `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=1`
- `confirm_unverified_write=true`
- 共享 Studio Token 匹配

本次验收未启用该开关，也未向上游提交这些写请求。

### 3.5 只读媒体

`GET /api/studio/media/{clip_id}?kind=...` 支持：

- `waveform`
- `downbeats`
- `midi`
- `aligned_lyrics`
- `novelty`
- `stems`
- `stems_pages`
- `projects`

`POST /api/studio/media/{clip_id}?kind=downbeats_streaming` 只调用只读分析接口。它不是生成、导出或扣点接口。

### 3.6 Studio Transport

Transport 路由：

| 方法 | 路由 | 语义 |
|---|---|---|
| GET | `/api/studio/transport/status` | 读取当前播放状态、Beat 和秒位置 |
| POST | `/api/studio/transport/play` | 从当前位置播放，并验证播放头真实推进 |
| POST | `/api/studio/transport/pause` | 暂停并保留当前位置 |
| POST | `/api/studio/transport/stop` | 停止并回到工程 0 秒 |
| POST | `/api/studio/transport/seek` | 按秒或 Beat 跳转 |

Seek 请求必须二选一：

```json
{"seconds": 12.5}
```

```json
{"beats": 32}
```

字符串数字、`null`、非有限值、同时提供两个单位、未知字段，以及负秒数都会返回 HTTP 400。播放过程中 Seek 会短暂暂停、精确落点并恢复原播放状态。Seek 响应中的 `landed` 是精确落点快照；`after` 是恢复播放后的响应时实时位置，因此播放状态下二者可能相差少量自然推进时间。

状态响应只包含：

- `playing`
- `position_beats`
- `position_seconds`
- `song_start_seconds`
- Timeline 是否存在及是否播放
- 观测时间与固定来源标记
- `protocol`（`dsp_v2` 或 `playback_controller_v1`）及时间换算来源

不会返回页面 URL、工程 ID、Clip ID、Cookie、Token 或完整 Studio state。

实现边界：

```text
本地 /api/studio/transport/*
  → Chrome DevTools Protocol
  → 已登录且已打开的 Suno Studio 页面
  → DSP v2 Context（优先）
  → playbackController（旧页面回退）
```

本轮静态 Bundle、运行态对象和动作期间网络请求均未发现 Suno 后端 Transport HTTP 端点，因此没有把工程/导出 Direct HTTP 适配器误用为播放器控制。Transport 必须保持 Studio 页面打开；页面不存在、CDP 不可达，或 DSP v2 与旧控制器都未就绪时返回 HTTP 503。同时打开多个 Studio 页面时返回 HTTP 409，不猜测要控制哪个工程。

新版 DSP v2 只对 `manual` timing 工程开放；Bridge 从页面 `timing.bps` 与 BPS automation 计算完整浮点秒，秒 Seek 先精确换算为 Beat 再提交给页面，不以固定 BPM 近似。遇到 `follow-track` timing 时会明确拒绝而不返回错误的秒数。React 可能替换 DSP Context 和旧控制器对象，所以每次动作和状态读取都会重新定位当前有效实例，不长期缓存对象。所有 Transport 状态读取和动作在单个 Node 进程内串行执行，避免外部 APP 高频状态读取撞上 Seek/Pause 的中间态。

新页面可能尚未获得 WebAudio 用户激活。`play` 不只检查 `playing=true`，还会验证播放头真实推进；必要时使用一次 Studio 原生空格键激活。仍未推进时返回 HTTP 409，并要求先在 Studio 页面内点击一次。

## 4. CLI 说明

CLI 只访问 `SUNO_OPENCLI_BASE_URL`，默认 `http://127.0.0.1:3000`：

```bash
npm run studio-opencli -- doctor
npm run studio-opencli -- doctor --live
npm run studio-opencli -- projects
npm run studio-opencli -- project <studio_project_id>
npm run studio-opencli -- versions <studio_project_id>
npm run studio-opencli -- version <studio_project_id> <version_id>
npm run studio-opencli -- revision <revision_id>
npm run studio-opencli -- media <clip_id> waveform
npm run studio-opencli -- transport-status
npm run studio-opencli -- transport-play
npm run studio-opencli -- transport-pause
npm run studio-opencli -- transport-stop
npm run studio-opencli -- transport-seek-seconds 12.5
npm run studio-opencli -- transport-seek-beats 32
npm run studio-opencli -- export --payload export.json
npm run studio-opencli -- multitrack --payload multitrack.json
npm run studio-opencli -- generate --payload generate.json --confirm-paid
npm run studio-opencli -- resume <idempotency_key>
```

`doctor` 默认不发网络请求；`doctor --live` 只发 `OPTIONS`。CLI 不保存 Cookie，不拼接 Suno 上游 URL，不自动重试 POST。Transport 命令只调用本地 `/api/studio/transport/*`。

## 5. 明确未实现功能

以下功能仍只保留目录，不应被包装成“已实现”：

- Speed、Reverse、Crop、Fade
- Extract Stems 的 Studio 专用写入语义
- Remove FX
- Import Audio、Record Audio
- Warp Markers
- Alternate Takes

这些入口如果未来要验证，必须使用独立素材、单次写入闸门、前后积分快照和可回滚证据；当前版本不自动探测。

## 6. 2026-08-08 真实 HTTP 验收

本轮使用隔离容器和独立 state，通过正式 `/api/studio/*` HTTP 路由完成。CLI 没有直接访问 Suno，也没有承担真实提交。

| 功能 | HTTP | 最终结果 | Credits / 文件证据 |
|---|---:|---|---|
| Instrument | 200 | 2 个 Clip，2/2 `complete` | 7781 → 7777，消耗 4 |
| Cover | 200 | 2 个 Clip，2/2 `complete` | 7777 → 7773，消耗 4 |
| Full Song Export | 200 | 最终 Library Clip `complete`，音频地址存在 | 渲染保存到 Library，不声称本地下载 |
| Selected Time Range Export | 200 | 最终 Library Clip `complete`，音频地址存在 | 渲染保存到 Library，不声称本地下载 |
| Multitrack | 200 | ZIP 原子落盘并通过完整性检查 | 52,244,220 bytes，14 个 WAV |

Multitrack 代表文件实测为：

- 容器：WAV
- 编码：PCM 32-bit float
- 采样率：48 kHz
- 声道：2
- 时长：约 43 秒

安全结论：

- Instrument、Cover 分别只有一次真实创建提交；没有重放相同幂等键。
- 付费生成总计消耗 8 Credits。
- 生成账本两条记录均为 `complete`。
- 4 个新生成 Clip 均未观察到自动插入新建 Studio Project。
- Token、Cookie、Clip ID、Project ID、媒体 URL 和完整 Studio state 不写入验收文档。

本轮发现并修复了三个当前上游/运行环境兼容点：

1. Full Song 的 `render-state` 同样需要 `start_beats/end_beats`，现在从 state 自动推导。
2. Multitrack 当前需要 `title`，现在会提交标题并将其纳入幂等指纹。
3. SMB `.smbdelete*` 可能让锁目录延迟消失；现在采用重试和降级告警，不再把已成功下载的 ZIP 误报为 HTTP 500。

安全验收副本保存在：

`./output/studio-exports/acceptance-20260808-205426`

其中只保留 ZIP、无敏感摘要和完整性信息；测试 Token、payload、原始响应和临时 state 已清理。

## 7. 正式上线状态

截至 2026-08-13，本功能已并入正式 Suno API Finder：

- 正式目录：`<repo-root>`
- 正式服务：`http://127.0.0.1:3000`
- 正式镜像：`sha256:d3eabf888a959f2c4cf050e2ef0731d49d05830005d26fd2c2acb56959a78f4f`
- Transport 上线前回滚镜像：`suno-api-final:pre-studio-transport-20260813`
- 实现主体：Next.js `/api/studio/*` 直接 HTTP 适配器
- Transport 实现：`/api/studio/transport/*` → CDP → 当前已打开 Studio 页面的 DSP v2 Context（`playbackController` 仅作旧页面回退）
- CLI：`scripts/studio-opencli.mjs`，仅封装本地 HTTP API 和执行 `OPTIONS` 验收
- Swagger：17 个 paths，其中 12 个 Studio paths
- 持久化 state：`./studio-state`
- Multitrack 输出：`./output/studio-exports`

正式环境保持：

```text
SUNO_STUDIO_ENABLE_PAID_GENERATION=0
SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0
SUNO_STUDIO_PAID_API_TOKEN 未配置
```

因此当前可以安全使用只读接口、文档、路由发现和无扣点验收；任何 Instrument/Cover 付费生成或未验证写操作仍会在本地闸门处被拒绝。启用付费功能必须遵循运维手册中的单次授权 SOP，不能把重复真实扣点探测作为验收手段。

## 8. 2026-08-13 Transport 验收

Transport 没有触发生成、导出、保存或积分消耗。候选生产构建明确包含 5 个新路由，CLI `doctor --live` 为 12/12。

真实已打开 Studio 页面上的可恢复验收：

| 检查 | 结果 |
|---|---|
| 秒 Seek | 请求值与读回值误差 0 |
| Beat Seek | 请求值与读回值误差 0 |
| Play | `playing=true`，正式端口响应后继续推进约 0.60 秒 |
| 播放中 Seek | 精确 `landed` 误差 0，保持播放，随后继续推进约 0.42 秒 |
| Pause | `playing=false`，350 ms 观察窗口漂移 0 |
| Stop | `playing=false`，当前位置 0 秒，250 ms 后仍为 0 |
| 恢复 | 正式端口原播放状态恢复；原位置误差 0 |
| 缺少 Studio 页面 | HTTP 503 |
| 非数字 Seek | HTTP 400 |

这证明当前接口能够为后续视频窗口或时码桥接 APP 提供播放状态与位置源；它不承诺浏览器与外部音频引擎的采样级同步。
