# Suno Studio API Finder 运维手册

**目标运行目录：** `<repo-root>`
**服务：** Docker Compose `suno-api`，默认监听 `127.0.0.1:3000`
**适用日期：** 2026-08-08
**核心安全要求：** 不重复真实扣点探测；任何付费生成都必须人工明确授权。

## 1. 运行架构

```text
调用方
  │ localhost HTTP
  ▼
Next.js /api/studio/*
  ├─ 工程/生成/导出/媒体 → 固定 HTTP 适配器 → studio-api.prod.suno.com
  └─ transport/* → CDP → 已登录且已打开的 Suno Studio 页面
                    → DSP v2 Context（优先）/ playbackController（旧页面回退）
```

`scripts/studio-opencli.mjs` 位于服务外层，只访问本地 `/api/studio/*`。它不是第二套实现，也不应配置 Suno Cookie 或上游 URL。

付费生成额外经过：

```text
服务端开关
  + 请求确认字段
  + X-Suno-Studio-Token
  → 预留幂等键 → 读取 Credits(before)
  → 单次 generate/v2-web POST
  → 保存 Clip ID → Credits(after)
  → feed/v3 只读轮询
```

## 2. 生产安全基线

默认值必须保持：

```dotenv
SUNO_STUDIO_ENABLE_PAID_GENERATION=0
SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0
SUNO_STUDIO_PAID_API_TOKEN=
SUNO_API_BIND=127.0.0.1
```

不要把服务直接暴露到公网。若确需 LAN 访问，应在反向代理层做访问控制，不要把 Next route 的 `Access-Control-Allow-Origin: *` 当作认证。

以下操作禁止作为普通验收：

- `POST /api/studio/generate` 带有效三重授权。
- 重复调用 Instrument/Cover 以“确认是否扣点”。
- 对已有项目反复执行 `render-state` 或 `render-state-multitrack`。
- `force_render=true` 的批量探测。
- 启用 P2 写开关后对真实工程试 payload。

本次功能合并的验收应只使用 TypeScript、Next build、`OPTIONS`、关闭闸门 HTTP 403、静态目录和本地 CLI。

## 3. 环境变量

| 变量 | 默认值 | 用途 | 运维要求 |
|---|---|---|---|
| `SUNO_STUDIO_DIRECT_BASE_URL` | `https://studio-api.prod.suno.com` | Studio 直接 HTTP 主机 | 只在确认上游迁移时修改 |
| `SUNO_STUDIO_ENABLE_PAID_GENERATION` | `0` | Instrument/Cover 总开关 | 日常必须为 `0` |
| `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES` | `0` | P2 Project/Revision 写开关 | 未做独立授权测试时必须为 `0` |
| `SUNO_STUDIO_PAID_API_TOKEN` | 空 | 本地二次授权 Token | 只放 `.env`/Keychain 注入，不能进 Git |
| `SUNO_STUDIO_STATE_DIR` | `/app/.suno-studio-state` | 生成幂等记录、锁 | 必须持久化 |
| `SUNO_STUDIO_OUTPUT_DIR` | `/Volumes/素材/TEMP/chu/SunoStudioExports` | Direct Multitrack 输出 | 必须持久化并定期备份 |
| `SUNO_STUDIO_STATE_HOST_DIR` | `/Volumes/素材/TEMP/chu/SunoStudioState` | Compose 宿主机挂载目录 | 创建后设为 0700 |
| `SUNO_API_BIND` | `127.0.0.1` | HTTP 绑定地址 | 公网部署需额外网关 |
| `SUNO_API_PORT` | `3000` | HTTP 端口 | 与现有服务保持一致 |
| `SUNO_BROWSER_CDP` | 现有值 | 旧诊断/兼容流程 | Studio Direct API 不依赖 |
| `SUNO_STUDIO_TRANSPORT_CDP` | 宿主机 `127.0.0.1:18800`；容器 `host.docker.internal:18800` | Transport CDP 默认地址 | 仅 Transport 使用 |
| `SUNO_STUDIO_TRANSPORT_CDP_CANDIDATES` | `18801,18800` | 候选 CDP 地址，先系统 Chrome 同步 Profile、后 OpenClaw Chrome | 每个候选最多只保留一个目标 Studio 工程 |
| `SUNO_STUDIO_TRANSPORT_URL_PREFIX` | `https://suno.com/studio` | 识别 Studio 页面 | 不写入响应或日志 |
| `SUNO_STUDIO_TRANSPORT_TIMEOUT_MS` | `15000` | CDP 连接/命令超时 | 不建议低于 1000 |
| `SUNO_STEMS_DOWNLOAD_DIR` | 现有值 | Song Stems 输出 | 不要删除既有配置 |
| `SUNO_STUDIO_MULTITRACK_DOWNLOAD_DIR` | 现有值 | 旧 Clip-ID Studio Multitrack 输出 | 与新 `/api/studio/multitrack` 分开 |

`SUNO_COOKIE`、`TWOCAPTCHA_API_KEY` 等现有凭证沿用原服务的安全注入方式。文档、日志、验收输出只能记录“存在/长度/哈希摘要”等安全元数据。

## 4. 目录与权限

宿主机建议：

```bash
mkdir -p "/Volumes/素材/TEMP/chu/SunoStudioState"
mkdir -p "/Volumes/素材/TEMP/chu/SunoStudioExports"
chmod 700 "/Volumes/素材/TEMP/chu/SunoStudioState"
chmod 750 "/Volumes/素材/TEMP/chu/SunoStudioExports"
```

状态目录结构：

```text
SunoStudioState/
└── submissions/
    └── sha256(idempotency_key).json
```

Direct Multitrack 运行锁位于 `SUNO_STUDIO_STATE_DIR/locks/`。下载过程中的 `.part-*` 文件只在异常时短暂保留；发现残留时先确认没有活跃请求，再清理。

生成记录只保存：

- schema 版本、幂等键和请求指纹
- 模式、必要 ID、标题和文本长度/哈希摘要
- Credits before/after/consumed
- Clip IDs、状态、工程插入观察
- 有界错误摘要

不保存 Cookie、Authorization、Captcha Token、交易 UUID、完整 Studio state、签名下载 URL 或原始 Headers。

## 5. 构建、启停和安全切换

### 5.1 不覆盖生产 `.next` 的静态验收

当前生产 Compose 不再把正式仓库的 `.next` 绑定到 `/app/.next`，运行容器使用镜像内不可变构建结果。仍建议完整 Next build 使用 Docker builder 或隔离目录，以免本地构建产物与候选镜像混淆；`tsc --noEmit` 只用于快速类型检查，不能替代生产构建。

不触碰生产构建目录的基础检查：

```bash
cd <repo-root>
git status --short --branch
docker compose config --quiet
npm run studio-opencli -- doctor
node -e 'const s=require("./public/swagger-suno-api.json"); console.log(Object.keys(s.paths).length)'
```

默认 `doctor` 不请求网络。`doctor --live` 也只向本地服务发送 `OPTIONS`，不会访问 Suno 上游。

完整 TypeScript/Next build 应在以下任一隔离位置完成：

- Dockerfile 的 builder stage；
- 临时 checkout；
- 不与生产容器共享 `.next` 和 `tsconfig.tsbuildinfo` 的 staging 目录。

### 5.2 构建候选镜像并提取候选 `.next`

先记录当前运行态和工作树，不覆盖任何未提交修改：

```bash
cd <repo-root>
git status --short --branch
docker inspect suno-api \
  --format 'image={{.Image}} status={{.State.Status}} health={{.State.Health.Status}}'
docker compose config --quiet
```

构建带时间戳的候选镜像。Docker build 使用 `.dockerignore` 排除宿主机 `.next`、`.env` 和 `node_modules`，不会清理生产 `.next`：

```bash
STAMP=$(date +%Y%m%d-%H%M%S)
CANDIDATE="suno-api-final:studio-$STAMP"
docker build -t "$CANDIDATE" .
```

从候选镜像提取与其依赖完全匹配的 `.next`：

```bash
STAGED_NEXT=".next.studio-stage-$STAMP"
CID=$(docker create "$CANDIDATE")
mkdir "$STAGED_NEXT"
docker cp "$CID:/app/.next/." "$STAGED_NEXT/"
docker rm "$CID"

test -f "$STAGED_NEXT/BUILD_ID"
test -f "$STAGED_NEXT/server/app-paths-manifest.json"
node - "$STAGED_NEXT/server/app-paths-manifest.json" <<'NODE'
const fs = require("fs");
const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const routes = Object.keys(manifest).filter((key) => key.includes("/api/studio"));
console.log({ studio_routes: routes.length });
if (routes.length < 10) process.exit(1);
NODE
```

### 5.3 备用端口无扣点验收

候选镜像先在 `127.0.0.1:3125` 启动，使用独立临时 state，且显式关闭两类写开关：

```bash
SMOKE_STATE=$(mktemp -d /tmp/suno-studio-state.XXXXXX)
chmod 700 "$SMOKE_STATE"

docker run -d --rm \
  --name suno-api-studio-smoke \
  --env-file .env \
  -e HTTP_PROXY=http://host.docker.internal:7890 \
  -e HTTPS_PROXY=http://host.docker.internal:7890 \
  -e http_proxy=http://host.docker.internal:7890 \
  -e https_proxy=http://host.docker.internal:7890 \
  -e NO_PROXY=127.0.0.1,localhost,host.docker.internal \
  -e no_proxy=127.0.0.1,localhost,host.docker.internal \
  -e SUNO_STUDIO_ENABLE_PAID_GENERATION=0 \
  -e SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0 \
  -e SUNO_STUDIO_STATE_DIR=/app/.suno-studio-state \
  -v "$SMOKE_STATE:/app/.suno-studio-state" \
  -p 127.0.0.1:3125:3000 \
  "$CANDIDATE"

SUNO_OPENCLI_BASE_URL=http://127.0.0.1:3125 \
  npm run studio-opencli -- doctor --live
curl -fsS http://127.0.0.1:3125/api/studio/unverified_actions
docker exec suno-api-studio-smoke sh -lc \
  'command -v ffprobe && command -v unzip'
```

验收完成后执行 `docker stop suno-api-studio-smoke`；由于容器带 `--rm`，停止后自动删除。不要对候选环境执行 Export、Multitrack 或带有效授权的 Generate。

### 5.4 生产原子切换

不要依赖“改名旧容器后再执行 Compose”来保留回滚容器。若旧容器带 Compose labels，`docker compose up` 仍可能识别并重建它。可靠回滚材料是：旧镜像时间戳 tag、旧 `.next` 目录、部署前工作树备份和持久化 state/output。

```bash
cd <repo-root>
STAMP=$(date +%Y%m%d-%H%M%S)
OLD_NEXT=".next.before-studio-$STAMP"
OLD_IMAGE="suno-api-final:pre-studio-$STAMP"

mkdir -p "/Volumes/素材/TEMP/chu/SunoStudioState"
mkdir -p "/Volumes/素材/TEMP/chu/SunoStudioExports"
chmod 700 "/Volumes/素材/TEMP/chu/SunoStudioState"

docker tag "$(docker inspect suno-api --format '{{.Image}}')" "$OLD_IMAGE"

docker stop suno-api
mv .next "$OLD_NEXT"
mv "$STAGED_NEXT" .next
docker tag "$CANDIDATE" suno-api-final:latest
docker compose up -d --no-build suno-api
```

等待 `healthy`，再执行第 6 节验收。旧镜像和旧 `.next` 在验收完成前都不得删除。若部署前另有不带 Compose labels 的手工旧容器，可以额外保留，但它不是回滚成立的前提。

不要使用 `docker compose down -v`；不要用 `git reset --hard` 或 `git restore .` 处理部署问题。

## 6. 健康检查与无扣点验收

基础检查：

```bash
curl -fsS http://127.0.0.1:3000/api/get_limit
curl -fsS http://127.0.0.1:3000/api/studio/unverified_actions
npm run studio-opencli -- doctor --live
```

关闭付费 gate 的安全检查：

```bash
curl -i -X POST http://127.0.0.1:3000/api/studio/generate \
  -H 'Content-Type: application/json' \
  -d '{"idempotency_key":"studio-gate-check-20260808","mode":"instrument","workspace_project_id":"00000000-0000-0000-0000-000000000000","stem_condition_clip_id":"00000000-0000-0000-0000-000000000000","stem_control_tags":"Add Synth","confirm_paid_generation":true}'
```

期望：

- HTTP 403。
- 不发 Suno `generate/v2-web`。
- 不创建提交记录。
- 不改变 Credits。

不要把有效 Cookie、真实 Project ID 或真实 Clip ID 放入这条关闭 gate 检查。

路由 `OPTIONS` 验收只确认本地路由已加载，不证明上游语义：

```bash
for route in \
  /api/studio/projects \
  /api/studio/export \
  /api/studio/multitrack \
  /api/studio/generate \
  /api/studio/unverified_actions \
  /api/studio/transport/status \
  /api/studio/transport/play \
  /api/studio/transport/pause \
  /api/studio/transport/stop \
  /api/studio/transport/seek; do
  curl -fsS -X OPTIONS -o /dev/null -w "$route %{http_code}\n" "http://127.0.0.1:3000$route"
done
```

### 6.1 Transport 无扣点验收

先确认受管 Chrome 与 Studio 页面：

```bash
curl -fsS http://127.0.0.1:18800/json/version >/dev/null
npm run studio-opencli -- transport-status
```

容器中必须使用 `host.docker.internal:18801` 或 `host.docker.internal:18800`。Bridge 会按候选顺序选择唯一的已就绪 Studio 页面，并在容器内将该主机名解析为 IP，以满足 Chrome DevTools 对 `Host` 请求头的限制。

动作测试会短暂改变用户播放头，必须遵循：

1. 先读取并保存原 `playing`、`position_seconds` 和 `position_beats`。
2. 使用邻近位置测试秒 Seek 与 Beat Seek。
3. Play 后再次读取状态，确认位置真实推进。
4. Pause 后等待至少 300 ms，确认位置冻结。
5. Stop 后确认位置为 0 秒。
6. 最后恢复原位置和原播放状态，并再次核对误差。

普通健康检查不要自动执行动作测试；`doctor --live` 只发送 `OPTIONS`。

## 7. 运行监控与日志

```bash
docker inspect suno-api --format '{{json .State.Health}}'
docker logs --since 10m suno-api
du -sh "/Volumes/素材/TEMP/chu/SunoStudioState" "/Volumes/素材/TEMP/chu/SunoStudioExports"
find "/Volumes/素材/TEMP/chu/SunoStudioState/locks" -maxdepth 1 -type d -print 2>/dev/null
```

日志中允许出现：路由、HTTP 状态、Clip ID、请求指纹、轮询状态、文件大小和 SHA-256。

日志中不得出现：Cookie、Authorization、Studio Token、2Captcha Key、Captcha Token、签名 URL、完整请求 state 或歌词正文。

## 8. 故障处理

### 8.1 HTTP 403

- `generate`：检查 `SUNO_STUDIO_ENABLE_PAID_GENERATION` 是否仍为 `0`；这是默认安全状态。
- P2 Project/Revision 写：检查 `SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES`；不要为了排查而打开。
- 关闭 gate 的 403 不需要重试，也不需要检查上游。

### 8.2 HTTP 401/503

- 401：检查请求头是否使用了正确的共享 Studio Token；不要在命令行回显 Token。
- 503：服务端没有配置 `SUNO_STUDIO_PAID_API_TOKEN`；保持付费 gate 关闭，先补齐安全注入。

### 8.3 HTTP 409 `unknown_after_submit`

这是最重要的付费恢复状态：

1. **禁止再次 POST。**
2. 使用 `GET /api/studio/generate?idempotency_key=...` 查看记录。
3. 如果已有 `clip_ids`，只调用 `resume=1` 轮询。
4. 如果没有 Clip ID，人工核对 Suno 侧状态和 Credits，再决定是否新建不同的业务幂等键；不能自动重建原请求。

### 8.4 HTTP 429 Multitrack lock

同一 state/project 指纹正在下载或渲染。等待原请求结束后重试本地 API；不要直接向 Suno 重发上游请求。若锁目录长期残留，先查看 `owner.json` 的 PID 和时间，确认容器无活跃任务后再删除对应锁目录。

### 8.5 ZIP 完整性失败

- 保留 `.part-*` 或当前失败证据，先记录错误。
- 检查 `unzip -tq <file>`。
- 检查 `ffprobe -v error <wav>`。
- 不要把未通过 `container_test=pass` 的 ZIP 发布给下游。
- 如需重新渲染，必须显式使用 `force_render=true`，并确认不是重复探测。

### 8.6 上游 401/Clerk 失效

只更新原 Suno Cookie/Clerk 注入，按原 Suno API Final SOP 重启；不要修改 Studio payload，也不要同时做付费探测。

### 8.7 Transport HTTP 503

- 确认 `127.0.0.1:18800/json/version` 可访问。
- 确认受管浏览器中已经打开一个 `https://suno.com/studio...` 工程页面。
- 确认页面加载完成、Timeline 有 Track，且新版页面使用 `manual` timing；`follow-track` timing 会被 Bridge 明确拒绝，避免把 Beat 误换算为秒。
- 容器内检查 `host.docker.internal` 能否解析；不要把宿主机的 `127.0.0.1:18800` 原样写给容器。
- 页面刷新或 React 重建期间可短暂返回 503；等待页面就绪后重新发起状态读取，不重启 Suno API，也不触发任何生成。

### 8.8 Transport HTTP 409

- Play 409：Studio 暴露了播放状态，但 WebAudio 未推进。先在 Studio 页面内点击一次，再重试。
- Seek/Pause/Stop 409：读取最新 `transport-status`，确认当前 Timeline 是否仍是目标工程。
- 不要通过反复发送空格键或高频 Seek 暴力重试。
- Bridge 只保证单 Node 进程内串行；如果未来部署多个 API 实例，必须增加跨实例锁或指定唯一 Transport Bridge 实例。

## 9. 备份、恢复和回滚

### 9.1 备份

代码发布前至少保存：

```bash
git status --short --branch
git diff --binary > /tmp/suno-api-final-working-tree.patch
git diff --cached --binary > /tmp/suno-api-final-index.patch
git ls-files --others --exclude-standard > /tmp/suno-api-final-untracked.txt
find . -type f -not -path './.git/*' -not -path './.next*/*' -print0 \
  | xargs -0 shasum -a 256 \
  | LC_ALL=C sort \
  > /tmp/suno-api-final-files-before.sha256
```

另行备份：

- 当前容器 image ID，并给旧镜像增加不可变时间戳 tag；
- 在切换窗口把旧 `.next` 原子改名为 `.next.before-studio-<timestamp>`；
- 若旧容器不受 Compose 管理，可改名保留；若带 Compose labels，不把它作为唯一回滚材料；
- `/Volumes/素材/TEMP/chu/SunoStudioState`
- `/Volumes/素材/TEMP/chu/SunoStudioExports`
- `.env` 的安全存储/Keychain 引用（不要复制到聊天或 Git）。

### 9.2 恢复

恢复顺序：

1. 停止 `suno-api`。
2. 恢复与代码版本匹配的 `.next`。
3. 恢复 state 目录和输出目录。
4. 启动容器并执行 `get_limit`、`unverified_actions`、OPTIONS 验收。
5. 不重新提交历史 `idempotency_key`。

### 9.3 回滚 Studio 功能

如果生产切换后健康检查失败，优先恢复“旧 `.next` + 旧镜像 tag”，然后让 Compose 重新创建服务：

```bash
STAMP=$(date +%Y%m%d-%H%M%S)

docker stop suno-api
mv .next ".next.failed-studio-$STAMP"
mv ".next.before-studio-<部署时间戳>" .next

docker tag "suno-api-final:pre-studio-<部署时间戳>" suno-api-final:latest
docker compose up -d --no-build suno-api
```

必须先恢复旧 `.next`，再启动旧镜像。回滚后检查 `127.0.0.1:3000`、`/api/get_limit` 和旧功能，不要在回滚窗口提交任何 Studio 上游 POST。

如果只需从源码中撤销 Studio 合并，只回滚本次 Studio 新增文件和对应配置/文档行：

- `src/app/api/studio/`
- `src/lib/StudioDirectApi.ts`
- `src/lib/StudioGenerationService.ts`
- `src/lib/StudioProjectApi.ts`
- `src/lib/studioHttp.ts`
- `src/lib/studioSecurity.ts`
- `src/lib/studioSubmissions.ts`
- `scripts/studio-opencli.mjs`
- Studio 文档和 Studio 相关 package/compose/README 行

不要执行：

```bash
git reset --hard
git restore .
docker compose down -v
```

因为目标仓库已有未提交的 Stems、Captcha、Cover、Mashup、Upload 和文档修改；回滚必须使用本次合并前的定向备份或人工反向补丁。

## 10. 付费功能启用 SOP（仅在明确授权时）

1. 记录当前 Credits（只记录数值，不记录 Cookie）。
2. 确认业务方给出唯一 `idempotency_key`、Workspace ID、Studio ID、Clip ID 和明确的 `confirm_paid_generation=true`。
3. 临时注入 `SUNO_STUDIO_PAID_API_TOKEN`，不要把 Token 写入命令历史。
4. 将 `SUNO_STUDIO_ENABLE_PAID_GENERATION` 从 `0` 改为 `1`，只对单个授权窗口生效。
5. 提交一次；记录返回的 Clip ID。
6. 后续只 `GET`/`resume=1` 轮询，不复制 POST。
7. 记录 after Credits、status、工程插入观察。
8. 任务结束立即恢复 `SUNO_STUDIO_ENABLE_PAID_GENERATION=0`，并安全重启/重新加载配置。

没有用户明确授权时，停留在第 1 步之前的无扣点验收。

## 11. 2026-08-08 正式部署记录

当前已经切换并验证：

| 项目 | 当前值 |
|---|---|
| 生产容器 | `suno-api` |
| 监听 | `127.0.0.1:3000` |
| 当前镜像 ID | `sha256:6d018666785626c6a525be0ccfb786f23fa5b877bc37f46e865ebfe65ea8d2e3` |
| 当前镜像保留 tag | `suno-api-final:studio-livefix-20260808-205426` |
| 直接上一镜像 ID | `sha256:fdad48ec380e5ffc01bba6e7f35134fe4d31ba2aae544e1eb339590cfffa8548` |
| 直接上一镜像回滚 tag | `suno-api-final:pre-studio-livefix-20260808-2139` |
| 直接上一 `.next` | `<repo-root>/.next.before-studio-livefix-20260808-2139` |
| 更早旧容器 | `suno-api-pre-studio-20260808-172705`，已停止保留 |
| Studio state | `/Volumes/素材/TEMP/chu/SunoStudioState` |
| Studio 输出 | `/Volumes/素材/TEMP/chu/SunoStudioExports` |

上线时的安全状态：

```text
SUNO_STUDIO_ENABLE_PAID_GENERATION=0
SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0
SUNO_STUDIO_PAID_API_TOKEN 未配置
```

真实与生产验收结果：

- 隔离授权窗口通过直接 HTTP API 完成一次 Instrument 和一次 Cover，分别消耗 4 Credits；Credits 由 7781 降至 7773。
- 两个生成请求各返回 2 个 Clip，4/4 最终状态均为 `complete`；没有重放相同幂等键。
- Full Song 和 Selected Time Range Export 均为 HTTP 200，最终 Library Clip 为 `complete`。
- Multitrack 为 HTTP 200；ZIP 52,244,220 bytes，`unzip` 完整性通过，包含 14 个 WAV，代表文件为 PCM float/48 kHz/双声道。
- 真实验收发现并修复 Full Song timeline bounds、Multitrack `title` 和 SMB `.smbdelete*` 锁清理兼容问题。
- 隔离付费容器、Token、payload、原始响应和临时 state 已清理；只保留无敏感摘要和验证后的 ZIP。
- 正式 `/api/get_limit` 为 HTTP 200，Credits 为 7773；Studio Projects 列表和工程详情均为 HTTP 200。
- 正式 CLI `doctor --live` 7/7；CLI `projects` 和 `unverified_actions` 薄封装读取成功。
- 正式 Generate 关闭闸门为 HTTP 403；Export/Multitrack 空请求在本地校验阶段返回 HTTP 400，没有发送上游请求。
- 正式运行时 `SUNO_STUDIO_ENABLE_PAID_GENERATION=0`、`SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0`、Studio Token 为空。

安全验收材料：

`/Volumes/素材/TEMP/chu/SunoStudioExports/acceptance-20260808-205426`

## 12. 2026-08-13 Studio Transport 正式部署记录

本轮只新增播放器 Transport，不触发 Create、Cover、Instrument、Export、Multitrack、工程保存或任何扣点操作。

| 项目 | 当前值 |
|---|---|
| 正式容器 | `suno-api` |
| 正式监听 | `127.0.0.1:3000` |
| 正式镜像 | `sha256:d3eabf888a959f2c4cf050e2ef0731d49d05830005d26fd2c2acb56959a78f4f` |
| 上线前镜像 | `sha256:6ae47495461a5c2d6f47500f008aba4296c9d3872cd301789d029dab2270ac27` |
| 回滚标签 | `suno-api-final:pre-studio-transport-20260813` |
| Transport CDP | 容器按 `18801 → 18800` 顺序连接唯一的已就绪 Studio 页面 |
| 页面匹配 | 只接受唯一一个 `https://suno.com/studio...` 页面 |

正式生产验收：

- Docker 健康状态为 `healthy`。
- `/api/get_limit` 为 HTTP 200，确认原核心服务仍可用。
- `/api/studio/transport/status` 为 HTTP 200。
- `studio-opencli doctor --live` 为 12/12。
- 秒 Seek 精确落点误差 0。
- Beat Seek 精确落点误差 0。
- Play 后继续推进约 0.60 秒。
- 播放中 Seek 的 `landed` 误差 0，保持播放，并继续推进约 0.42 秒。
- Pause 后观察窗口位置漂移 0。
- Stop 后位置为 0 秒，继续观察仍为 0。
- 测试结束恢复原播放状态和原位置，位置误差 0。
- 字符串形式的 Seek 数值被拒绝为 HTTP 400。
- 无匹配 Studio 页面时，在隔离候选容器验证为 HTTP 503。

生产切换使用已完成真实动作验收的候选镜像，旧镜像保留为不可变回滚标签。回滚时：

```bash
docker tag suno-api-final:pre-studio-transport-20260813 suno-api-final:latest
docker compose up -d --no-build --force-recreate suno-api
```

Transport 仍有明确运行边界：

- 必须保持唯一一个目标 Studio 工程页面打开。
- Suno 前端升级如果改变 DSP v2 React Context 或旧 `playbackController`，Transport 可能返回 503，需要重新探测。
- 当前串行锁只覆盖单个 Node 实例；多实例部署必须指定唯一 Bridge 或增加跨实例锁。
- 当前接口适合作为视频联动和时码桥接的位置源，不代表浏览器与 DAW 之间已经具备采样级同步。
