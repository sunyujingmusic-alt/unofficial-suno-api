# unofficial-suno-api

<p align="center">
  <a href="#chinese">中文</a> |
  <a href="#english">English</a>
</p>

## ⚠️ 免责声明 (Disclaimer)

**中文**

本项目为一个非官方的开源研究项目，仅用于学习和技术交流。  
本项目与 Suno.ai 官方没有任何关联、授权或背书。  
请勿将本项目用于任何违反 Suno 官方服务条款（TOS）的商业用途。若因使用本项目造成任何侵权或账号封禁，由使用者自行承担责任。

**English**

This project is an unofficial open-source research project intended only for learning and technical exchange.  
This project is not affiliated with, authorized by, or endorsed by Suno.ai.  
Do not use this project for any commercial purpose that violates Suno's official Terms of Service (TOS). Any infringement, account suspension, or other consequence caused by using this project is solely the user's responsibility.

<a id="chinese"></a>

## 中文

### 项目简介

`unofficial-suno-api` 是一个非官方的 Suno HTTP 运行时，聚焦于当前已验证的
create、poll、workspace、captcha、clip 读取和 `final_song.json` 中间件能力。

### 功能概览

- 使用 `SUNO_COOKIE` 完成认证、会话保活和当前 create/poll 所需的动态
  Browser-Token。
- 通过 `GET /api/get_limit` 查询额度。
- 通过 `GET /api/workspaces` 列出工作区。
- 通过 `POST /api/generate` 发起 prompt 模式生成。
- 通过 `POST /api/custom_generate` 发起 custom 模式生成。
- 通过 `POST /api/create_from_final_song` 严格校验并写出
  `final_song.json`，然后继续 create。
- 通过 `POST /api/create_precheck` 先检查 create 是否进入验证码分支。
- 通过 `POST /api/captcha_coordinates` 和 `PATCH /api/captcha_coordinates`
  对接 2Captcha 的图片点选求解与错误回报。
- 通过 `POST /api/feed_by_ids`、`GET /api/get?ids=...`、
  `GET /api/clip?id=...` 轮询和读取 clip。

### 本地 HTTP 接口

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

### 模型指定

只有下面三个 create 接口支持显式指定模型：

- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/create_from_final_song`

规则如下：

- 模型参数名始终是 `model`。
- `model` 始终放在请求 JSON 的顶层。
- 不要传 `model_name`，不要传 `mv`，也不要传 `final_song.model`。
- 如果不传 `model`，这个仓库当前默认使用 `chirp-fenix`。
- 当前这份开源 API 没有对外暴露“查询全部可用 model 列表”的 HTTP 接口。
- 这个仓库不在 README 里维护一份本地模型白名单；`model` 的值会直接转发到
  Suno create payload，最终能不能用仍取决于 Suno 上游和你的账号权限。
- 下面这些值是本地抓包和历史实现里观察到的常见请求值，不是 Suno 官方公开稳定
  契约，也不代表你的账号一定全部可用：

| 版本 | `model` 值 |
|------|------------|
| V3.5 | `chirp-v3-5` |
| V4 | `chirp-v4` |
| V4.5 | `chirp-auk` |
| V4.5+ | `chirp-bluejay` |
| V4.5-all | `chirp-auk-turbo` |
| V5 | `chirp-crow` |
| V5.5 | `chirp-fenix` |
| 自定义名称 | 原样透传 |
- 这个仓库真正稳定承诺的只有一件事：顶层 `model` 字符串会被原样转发到 Suno
  create payload 的 `mv` 字段。

#### Example: `POST /api/generate`

模型指定参数：

- 参数名：`model`
- 位置：顶层 JSON 字段

```bash
curl -X POST http://127.0.0.1:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Mandopop male vocal, warm guitars, emotional chorus",
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

#### Example: `POST /api/custom_generate`

模型指定参数：

- 参数名：`model`
- 位置：顶层 JSON 字段

```bash
curl -X POST http://127.0.0.1:3000/api/custom_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Example Song",
    "prompt": "First lyric line\nSecond lyric line\nThird lyric line",
    "tags": "Mandopop, emotional male vocal, mid-tempo, clean guitar, warm drums",
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

#### Example: `POST /api/create_from_final_song`

模型指定参数：

- 参数名：`model`
- 位置：顶层 JSON 字段
- 注意：`model` 要和 `final_song` 并列，不要写进 `final_song` 里面

```bash
curl -X POST http://127.0.0.1:3000/api/create_from_final_song \
  -H 'Content-Type: application/json' \
  -d '{
    "final_song": {
      "title": "Example Song",
      "lyrics": "First lyric line\nSecond lyric line\nThird lyric line",
      "styles": "Mandopop, emotional male vocal, mid-tempo, clean guitar, warm drums"
    },
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

### Create 验证码与 2Captcha

create 不是拿着 cookie 就一定能直接过。这个仓库把 Suno 的 `/api/c/check` 视为
明确的 create 前置环节，但要区分“诊断接口”和“真正 create 所在实例”：

1. `POST /api/create_precheck` 只是诊断，它会调用 `createPrecheck(..., false)`，
   只告诉你当前要不要验证码，不会替后续 create 缓存 token
2. 真正的 create 路由在内部会重新跑一次 precheck
3. 然后再按 `captcha_version` 分流
4. 最后由同一个上下文继续提交 create

边界可以直接记成下面这张表：

| 场景 | `POST /api/create_precheck` 的意义 | 真正 create 时怎么做 | 必须绑定的上下文 |
|------|-----------------------------------|------------------------|------------------|
| `required: false` | 当前无需 challenge | 直接继续 create | 无 |
| `required: true, captcha_version: 2` | 提前告诉你会遇到 Turnstile | 同一个 `SunoApi` 实例里调用 2Captcha，再立刻继续 create | 同一个服务端实例 |
| `required: true, captcha_version: 1` 且 `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser` | 提前告诉你会遇到图片点选 | `POST /api/captcha_coordinates` 只负责给点击坐标，真正 challenge 提交仍要在浏览器页面里完成 | 同一个已登录浏览器上下文 |
| `required: true, captcha_version: 1` 且 `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=legacy` | 提前告诉你会遇到图片点选 | 服务端尝试直接向 2Captcha 要 hCaptcha token，再继续 create | 同一个服务端实例，但稳定性仍受上游 challenge 形态影响 |

#### 2Captcha 在这里到底做什么

- 对 `captcha_version=2` 的 Turnstile，这个仓库可以在服务端通过 2Captcha API v2
  自动求解，然后在同一个 `SunoApi` 实例里继续 create。
- 对 `captcha_version=1` 的 hCaptcha 图片点选，当前默认推荐模式是
  `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser`。这时
  `POST /api/captcha_coordinates` 会调用 2Captcha 的 `CoordinatesTask`
  返回点击坐标，帮助浏览器侧“跳过手动找点和手动点击”的过程，但真正的 challenge
  提交仍然应该发生在同一个浏览器上下文里。
- 如果你显式把 `SUNO_CREATE_HCAPTCHA_TOKEN_MODE` 设为 `legacy`，服务端会尝试
  直接通过 2Captcha 获取 hCaptcha token；但图片点选挑战是否稳定可用，仍受上游
  challenge 形态和上下文约束影响，所以默认模式仍是 `browser`。

#### 为什么 2Captcha 很重要

- 有效 cookie 只能证明账号登录态存在，不代表 create 一定不会进验证码分支。
- 没有 2Captcha，自动化 create 很容易在验证码环节卡住，尤其是批量任务或无人值守
  任务。
- 对图片点选验证码来说，2Captcha 的价值不是“无视验证码”，而是把人工点击过程尽量
  自动化，减少人工介入。
- 对 Turnstile 来说，2Captcha 是这套 create 自动化链路里真正的服务端求解能力。
- `2Captcha ready` 只代表 solver 给出了结果，不代表 Suno 已接受验证。只有
  Suno create 成功返回 `song_ids`，才算验证码真正通过。

#### 相关环境变量与优先级

| 变量 | 作用 | 实际优先级 / 边界 |
|------|------|------------------|
| `TWOCAPTCHA_API_KEY` | 开启 2Captcha 自动求解 | 任何服务端验证码自动化都依赖它 |
| `SUNO_CREATE_CAPTCHA_METHOD` | solver 偏好：`auto` / `hcaptcha` / `turnstile` | 默认 `auto`；如果你手动指定的值和 `/api/c/check` 返回的 `captcha_version` 冲突，运行时会以 Suno 返回结果为准 |
| `SUNO_CREATE_HCAPTCHA_TOKEN_MODE` | `captcha_version=1` 时怎么处理 hCaptcha | 默认 `browser`；这时服务端不会替浏览器提交 challenge。只有设成 `legacy` 才会尝试服务端 token 流程 |
| `SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL` | 给运行时和 2Captcha 绑定同一个公网出口 IP | 仅在你确实需要共享公网出口时才设置；必须是 2Captcha 也能访问的公网 `http(s)` 代理，不能是 `localhost` 或仅局域网可见地址 |
| `SUNO_CREATE_USER_TIER` | 覆盖 create metadata 里的 `user_tier` | 留空时，运行时会自动读取 `/api/billing/info/` 并缓存结果；只有在你明确要覆盖时再手填 |
| `SUNO_CREATE_TURNSTILE_SITEKEY` | 覆盖 Turnstile sitekey | 默认值已内置，通常不用改 |
| `SUNO_CREATE_HCAPTCHA_SITEKEY` | 覆盖 hCaptcha sitekey | 默认值已内置，通常不用改 |
| `SUNO_CREATE_CAPTCHA_PAGEURL` | 覆盖 captcha 任务使用的页面地址 | 默认是 `https://suno.com/create` |
| `SUNO_CREATE_HCAPTCHA_RQDATA` / `SUNO_CREATE_HCAPTCHA_API_DOMAIN` / `SUNO_CREATE_CAPTCHA_ACTION` / `SUNO_CREATE_CAPTCHA_CDATA` / `SUNO_CREATE_CAPTCHA_PAGEDATA` | 高级 challenge 参数覆盖 | 只有在 Suno 上游 challenge 参数变化、且你明确知道要对齐什么时才需要设置 |

### 关键路由说明

- `POST /api/create_from_final_song`
  - 源码：[`src/app/api/create_from_final_song/route.ts`](src/app/api/create_from_final_song/route.ts)
  - 作用：严格校验 `final_song.json` 只包含 `title`、`lyrics`、`styles` 三个字段，
    并把它写到输出目录后，再继续 custom create。

### 快速开始

#### Docker Compose

```bash
cp .env.example .env
# Fill SUNO_COOKIE in .env.
docker compose up --build
```

打开：

```text
http://127.0.0.1:3000/docs
```

#### 本地 Node.js 运行

```bash
cp .env.example .env
npm install
npm run dev
```

#### 简单自检

```bash
curl http://127.0.0.1:3000/api/get_limit
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

注意：`create_precheck` 只是诊断，不等于 create 已成功。

### `final_song.json` 字段契约

`final_song.json` 必须严格是一个 JSON 对象，并且只能有这三个字段：

```json
{
  "title": "Song title",
  "lyrics": "Lyrics or prompt text",
  "styles": "Style tags"
}
```

校验规则只有这些：

- JSON 顶层必须是对象，不能是数组或原始值
- 字段必须且只能是 `title`、`lyrics`、`styles`
- 三个字段的值都必须是字符串

### 环境变量

必填：

```text
SUNO_COOKIE=
```

常用可选项：

```text
SUNO_API_PORT=3000
SUNO_WORKSPACE=
SUNO_OUTPUT_DIR=/app/output
SUNO_OUTPUT_TIMEZONE=Asia/Shanghai
TWOCAPTCHA_API_KEY=
HTTP_PROXY=
HTTPS_PROXY=
```

完整变量说明和注释见 [`.env.example`](.env.example)。

### License

MIT。

本项目以 MIT License 发布。项目早期实现曾参考或基于
[SunoAI-API/Suno-API](https://github.com/SunoAI-API/Suno-API)，后续已通过
Vibe Coding 被大幅重写并扩展为 `unofficial-suno-api`。更多说明见
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

<a id="english"></a>

## English

### Overview

`unofficial-suno-api` is an unofficial Suno HTTP runtime focused on the
currently verified create, poll, workspace, captcha, clip-read,
clip-merge rendering, reference-upload, and `final_song.json` middleware
paths.

### Capability Summary

- Authenticate with `SUNO_COOKIE`, keep the session alive, and attach the
  dynamic browser token required by current create/poll requests.
- Read quota through `GET /api/get_limit`.
- List workspaces through `GET /api/workspaces`.
- Create prompt-mode songs through `POST /api/generate`.
- Create custom-mode songs through `POST /api/custom_generate`.
- Validate and write `final_song.json`, then continue create through
  `POST /api/create_from_final_song`.
- Run `POST /api/create_precheck` before create to detect whether the request is
  entering a captcha branch.
- Use `POST /api/captcha_coordinates` and `PATCH /api/captcha_coordinates` as
  2Captcha helpers for image-click captcha coordinates and bad-result reports.
- Poll and read clips through `POST /api/feed_by_ids`, `GET /api/get?ids=...`,
  and `GET /api/clip?id=...`.
### Local HTTP Endpoints

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

### Model Selection

Only these three create endpoints support explicit model selection:

- `POST /api/generate`
- `POST /api/custom_generate`
- `POST /api/create_from_final_song`

Rules:

- The model parameter name is always `model`.
- `model` is always a top-level JSON field in the request body.
- Do not send `model_name`, do not send `mv`, and do not send
  `final_song.model`.
- If `model` is omitted, this repository currently defaults to `chirp-fenix`.
- The current open-source API does not expose a public HTTP endpoint for
  listing all available model values.
- This repository does not maintain a separate local model whitelist in README.
  The `model` string is forwarded to Suno's create payload, and actual
  usability still depends on upstream availability plus your account's access.
- The values below are commonly observed request identifiers from local captures
  and historical implementation notes. They are not an official Suno stability
  guarantee, and they do not mean every account can use every value:

| Version | `model` value |
|---------|---------------|
| V3.5 | `chirp-v3-5` |
| V4 | `chirp-v4` |
| V4.5 | `chirp-auk` |
| V4.5+ | `chirp-bluejay` |
| V4.5-all | `chirp-auk-turbo` |
| V5 | `chirp-crow` |
| V5.5 | `chirp-fenix` |
| custom name | forwarded as-is |
- The only stable repository-level contract is this: the top-level `model`
  string is forwarded to Suno's create payload as `mv`.

#### Example: `POST /api/generate`

Model parameter for this route:

- parameter name: `model`
- location: top-level JSON field

```bash
curl -X POST http://127.0.0.1:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "Mandopop male vocal, warm guitars, emotional chorus",
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

#### Example: `POST /api/custom_generate`

Model parameter for this route:

- parameter name: `model`
- location: top-level JSON field

```bash
curl -X POST http://127.0.0.1:3000/api/custom_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Example Song",
    "prompt": "First lyric line\nSecond lyric line\nThird lyric line",
    "tags": "Mandopop, emotional male vocal, mid-tempo, clean guitar, warm drums",
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

#### Example: `POST /api/create_from_final_song`

Model parameter for this route:

- parameter name: `model`
- location: top-level JSON field
- note: place `model` beside `final_song`, not inside it

```bash
curl -X POST http://127.0.0.1:3000/api/create_from_final_song \
  -H 'Content-Type: application/json' \
  -d '{
    "final_song": {
      "title": "Example Song",
      "lyrics": "First lyric line\nSecond lyric line\nThird lyric line",
      "styles": "Mandopop, emotional male vocal, mid-tempo, clean guitar, warm drums"
    },
    "model": "chirp-fenix",
    "wait_audio": true
  }'
```

### Create Captcha and 2Captcha

Create is not guaranteed to pass just because the cookie is valid. This
repository treats Suno's `/api/c/check` as an explicit pre-create step, but it
is important to distinguish the diagnostic route from the real create instance:

1. `POST /api/create_precheck` is diagnostic only. It calls
   `createPrecheck(..., false)` and does not cache a token for the later create
2. the real create routes run their own precheck again
3. then branch by `captcha_version`
4. then continue create in that same context

Use this table as the boundary map:

| Case | What `POST /api/create_precheck` means | What the real create path does | Required bound context |
|------|----------------------------------------|--------------------------------|------------------------|
| `required: false` | no challenge right now | continue create directly | none |
| `required: true, captcha_version: 2` | Turnstile will be required | solve through 2Captcha and immediately continue create in the same `SunoApi` instance | same server-side instance |
| `required: true, captcha_version: 1` with `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser` | image-click hCaptcha will be required | `POST /api/captcha_coordinates` only returns click points; the actual challenge submission still happens in the browser page | same authenticated browser context |
| `required: true, captcha_version: 1` with `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=legacy` | image-click hCaptcha will be required | server tries to obtain an hCaptcha token and continue create | same server-side instance, but stability still depends on upstream challenge shape |

#### What 2Captcha actually does here

- For `captcha_version=2` Turnstile, this repository can solve the challenge on
  the server through 2Captcha API v2 and then continue create in the same
  `SunoApi` instance.
- For `captcha_version=1` hCaptcha image-click flows, the current default and
  recommended mode is `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser`. In that mode,
  `POST /api/captcha_coordinates` uses 2Captcha `CoordinatesTask` to return the
  click coordinates so the browser side can skip manual point-finding and
  manual clicking as much as possible, but the actual challenge submission
  should still happen inside the same browser context.
- If you explicitly set `SUNO_CREATE_HCAPTCHA_TOKEN_MODE=legacy`, the server
  will try to obtain an hCaptcha token through 2Captcha directly. That path may
  still be constrained by upstream challenge behavior and context expectations,
  which is why the default remains `browser`.

#### Why 2Captcha matters

- A valid cookie only proves login state; it does not guarantee that create
  will avoid captcha.
- Without 2Captcha, unattended create jobs can easily stall in captcha
  branches.
- For image-click captcha, 2Captcha is the automation path for reducing manual
  interaction; it is not a reason to ignore the same-browser requirement.
- For Turnstile, 2Captcha is the server-side solve path that makes automatic
  create possible.
- A `2Captcha ready` response only means the solver returned a result. The
  captcha is only truly accepted when Suno create succeeds and returns
  `song_ids`.

#### Related environment variables and precedence

| Variable | Purpose | Effective precedence / boundary |
|----------|---------|---------------------------------|
| `TWOCAPTCHA_API_KEY` | enables 2Captcha automation | any server-side captcha automation depends on it |
| `SUNO_CREATE_CAPTCHA_METHOD` | solver preference: `auto` / `hcaptcha` / `turnstile` | default is `auto`; if your manual override conflicts with `/api/c/check`, runtime follows Suno's reported captcha version |
| `SUNO_CREATE_HCAPTCHA_TOKEN_MODE` | how `captcha_version=1` is handled | default is `browser`; only `legacy` enables the server-side token attempt |
| `SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL` | binds the runtime and 2Captcha to the same public exit IP | set it only when shared public egress is actually required; it must be a public `http(s)` proxy reachable by 2Captcha, not `localhost` or LAN-only |
| `SUNO_CREATE_USER_TIER` | overrides `user_tier` inside create metadata | if empty, runtime reads `/api/billing/info/` and caches the result |
| `SUNO_CREATE_TURNSTILE_SITEKEY` | overrides the Turnstile sitekey | the repository already has a default |
| `SUNO_CREATE_HCAPTCHA_SITEKEY` | overrides the hCaptcha sitekey | the repository already has a default |
| `SUNO_CREATE_CAPTCHA_PAGEURL` | overrides the page URL used for captcha tasks | default is `https://suno.com/create` |
| `SUNO_CREATE_HCAPTCHA_RQDATA` / `SUNO_CREATE_HCAPTCHA_API_DOMAIN` / `SUNO_CREATE_CAPTCHA_ACTION` / `SUNO_CREATE_CAPTCHA_CDATA` / `SUNO_CREATE_CAPTCHA_PAGEDATA` | advanced challenge-parameter overrides | only set these when Suno's upstream challenge parameters have changed and you know exactly what you need to mirror |

### Key Route Notes

- `POST /api/create_from_final_song`
  - Source: [`src/app/api/create_from_final_song/route.ts`](src/app/api/create_from_final_song/route.ts)
  - Purpose: strictly validate that `final_song.json` contains exactly
    `title`, `lyrics`, and `styles`, write it to the output directory, then
    continue custom create.

### Quick Start

#### Docker Compose

```bash
cp .env.example .env
# Fill SUNO_COOKIE in .env.
docker compose up --build
```

Open:

```text
http://127.0.0.1:3000/docs
```

#### Local Node.js Run

```bash
cp .env.example .env
npm install
npm run dev
```

#### Quick checks

```bash
curl http://127.0.0.1:3000/api/get_limit
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

Note: `create_precheck` is diagnostic only. It does not mean create has already
succeeded.

### `final_song.json` Field Contract

`final_song.json` must be one JSON object with exactly these three fields:

```json
{
  "title": "Song title",
  "lyrics": "Lyrics or prompt text",
  "styles": "Style tags"
}
```

Validation rules:

- the top-level JSON value must be an object, not an array or primitive
- the only allowed keys are `title`, `lyrics`, and `styles`
- all three values must be strings

### Environment

Required:

```text
SUNO_COOKIE=
```

Common optional values:

```text
SUNO_API_PORT=3000
SUNO_WORKSPACE=
SUNO_OUTPUT_DIR=/app/output
SUNO_OUTPUT_TIMEZONE=Asia/Shanghai
TWOCAPTCHA_API_KEY=
HTTP_PROXY=
HTTPS_PROXY=
```

For the full variable list and inline comments, see [`.env.example`](.env.example).

### License

MIT.

This project is published under the MIT License. Early implementation work was
referenced from and/or based on
[SunoAI-API/Suno-API](https://github.com/SunoAI-API/Suno-API), and was later
substantially rewritten and expanded through Vibe Coding into
`unofficial-suno-api`. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

---

<a id="latest-production-snapshot-20260811"></a>

## 最新生产版开源快照（2026-08-11）

旧版 README 的全部内容保留在上方。本节介绍 2026 年 8 月 11 日从当前生产
Suno API 整理、脱敏并重新打包的最新开源版本。

新版完整源码位于：

[`suno-api-final-open-source-20260811/`](suno-api-final-open-source-20260811/)

新版独立使用说明：

[`suno-api-final-open-source-20260811/README.md`](suno-api-final-open-source-20260811/README.md)

### 本次开源包的边界

新版包含当前通用生产能力的源码、命令行工具、非付费测试、Docker 配置和公开
文档，但不包含：

- `.env`、Suno Cookie、Cookie 历史备份；
- 2Captcha Key、代理账号密码、Studio Token；
- 本机用户名、NAS 路径或 `/Volumes/...` 生产挂载；
- 已下载歌曲、分轨 ZIP、manifest、`.part`、Studio 运行状态；
- `.next`、`node_modules`、日志、抓包和历史备份；
- 已被正式版删除的非原创音频切片上传功能。

新版默认输出到项目内的 `output/`，Studio 状态默认保存在
`studio-state/`。Docker 默认只监听 `127.0.0.1`。

### 新版能力总览

新版包含以下完整能力：

1. 账号额度、Workspace 和 Clip 查询；
2. prompt 模式 Create；
3. 自定义歌词、歌名和 Styles 的 Custom Create；
4. Create 前验证码状态检查及可选 2Captcha 流程；
5. Clip ID 轮询和已知 ID 的恢复；
6. 上传参考音频；
7. Cover；
8. Extend / Remix；
9. 两首歌曲 Mashup；
10. 多个 Clip 的 Studio Concat；
11. 下载账号中的全部歌曲；
12. Song Auto Split WAV/MP3 分轨；
13. Studio Multitrack；
14. Studio Project、Version、Revision、Media、Export；
15. 带安全门、幂等记录和轮询恢复的 Studio 付费生成；
16. 未验证 Studio 写操作的独立安全隔离。

### 快速启动

```bash
cd suno-api-final-open-source-20260811
cp .env.example .env
# 只在本机 .env 中填写自己的 SUNO_COOKIE，不要提交该文件。
docker compose up --build -d
```

本地说明页：

```text
http://127.0.0.1:3000/docs
```

Docker 健康检查使用 `/docs`，不会通过 `/api/get_limit` 访问 Suno 上游，因此
“容器是否健康”和“当前国际网络/Suno 是否可访问”是两个独立判断。

### 重点功能：下载账号中的全部歌曲

命令：

```bash
npm run download:account
```

该功能不是简单批量保存链接，而是一套可长期增量运行的账号曲库归档系统：

- 通过 cursor 连续翻页读取账号曲库；
- 默认只选择 Suno 状态为 `complete` 的 Clip；
- 同时下载 MP3 和 WAV，也可以只选其中一种格式；
- WAV 不存在时先触发上游转换，再轮询 WAV URL；
- 使用 `<file>.part` 写入，验证完成后才原子重命名；
- 上游支持时使用 HTTP Range 续传；
- 对文件记录大小、SHA-256 和响应信息；
- 有 `ffprobe` 时验证 MP3/WAV 是否可解析；
- 下载失败不会重新 Create 歌曲；
- 正常重跑只补新歌曲、缺失格式或上次失败项；
- 每个输出目录都有锁，防止定时任务和人工任务互相覆盖；
- transient 408、429、5xx、Cloudflare 52x、连接中断使用有限退避重试；
- 签名 URL 过期时刷新 Clip 元数据后重试；
- 每完成一个 Clip 都更新 manifest 和本轮报告。

#### 下载固定 20 首已完成歌曲

本机直接执行：

```bash
npm run download:account -- \
  --target-complete 20 \
  --output-dir ./output/suno-account-archive-test20
```

通过 Docker 中正在运行的本地 API 执行：

```bash
npm run download:account -- \
  --via-local-api \
  --api-base http://127.0.0.1:3000 \
  --target-complete 20 \
  --output-dir /app/output/suno-account-archive-test20
```

Docker 中的 `/app/output` 会映射到开源目录的 `./output`。

#### 下载整个账号曲库

不传 `--limit` 和 `--target-complete`：

```bash
npm run download:account -- \
  --output-dir ./output/suno-account-archive
```

三个口径必须区分：

- `--limit 20`：最多读取 20 个候选项，其中可能有未完成 Clip；
- `--target-complete 20`：继续翻页，直到选择 20 个已完成 Clip；
- 不传限制：继续扫描，直到账号 feed 结束或达到 `--max-pages`。

因此 `stop_reason=target_complete_reached` 表示固定数量测试完成，不表示已经扫描
完账号全部历史歌曲。只有到达 feed 尾部才能把本轮称为完整账号扫描。

#### 断连恢复

`--via-local-api` 的首次 HTTP 连接可能早于长任务结束。新版会在真正的连接中断或
客户端超时后：

1. 不重复提交归档任务；
2. 查询相同输出目录的持久状态；
3. 核对本轮开始时间，避免误读旧任务；
4. 等待同一个锁对应的任务结束；
5. 返回原任务的最终 `runs/<run_id>.json`。

本地 API 已经明确返回 4xx/5xx 时会立即失败，不会被误判为断连并进行长时间
轮询。

#### 归档产物

```text
output/suno-account-archive/
  manifest.json
  runs/
    <run-id>.json
  clips/
    <date>/
      <clip-id>/
        metadata.json
        <title>_<clip-id>.mp3
        <title>_<clip-id>.wav
        <title>_<clip-id>.jpg
```

`manifest.json` 是长期维护的总账；`runs/<run_id>.json` 是单次执行报告。
`media_files` 是方便其他软件读取的扁平媒体索引。

完整归档说明：

[`docs/ACCOUNT_ARCHIVE.md`](suno-api-final-open-source-20260811/docs/ACCOUNT_ARCHIVE.md)

### Create、验证码和轮询

- `POST /api/generate`：prompt 模式 Create；
- `POST /api/custom_generate`：歌名、歌词、Styles 的 Custom Create；
- `POST /api/create_precheck`：只检查当前验证码状态；
- `POST|PATCH /api/captcha_coordinates`：图片坐标验证码及错误回报；
- `GET /api/clip?id=...`：单 Clip 查询；
- `GET /api/get?ids=...`：逗号分隔的多个 ID；
- `POST /api/feed_by_ids`：JSON 数组形式查询多个 ID。

`create_precheck` 不是 Create 成功证明。真正的 Create 会在同一个 API 实例内完成
所需的验证码分支和提交。

一旦 Create 已返回 Clip ID，后续故障应使用这些 ID 恢复轮询或下载，不应因为
一次轮询、HTTP 连接或下载超时而盲目再次 Create。

### 上传参考音频和 Cover

先上传本地文件：

```bash
curl -X POST http://127.0.0.1:3000/api/upload_reference \
  -F 'file=@/absolute/path/reference.wav' \
  -F 'title=Reference Audio' \
  -F 'wait_upload=true'
```

再使用返回的源 Clip ID：

```bash
curl -X POST http://127.0.0.1:3000/api/cover_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "cover_clip_id": "SOURCE_CLIP_ID",
    "title": "Example Cover",
    "lyrics": "[Instrumental]\n[Electric guitar lead]",
    "style": "instrumental rock, energetic drums",
    "make_instrumental": true,
    "wait_audio": true
  }'
```

Cover 还支持 persona、模型、vocal gender、style weight、weirdness、
audio weight 和 Workspace 参数。

上传音频会在账号中创建源 Clip；Cover 可能消耗额度。

### Extend / Remix

`POST /api/extend_audio` 使用已有 `audio_id` 和可选的 `continue_at` 延续歌曲，
并支持歌词、Styles、负面标签、模型和 Workspace 参数。

### Mashup

`POST /api/mashup_generate` 必须提供恰好两个 Clip ID：

```json
{
  "mashup_clip_ids": ["CLIP_ID_1", "CLIP_ID_2"],
  "title": "Example Mashup",
  "lyrics": "",
  "style": "electronic pop",
  "make_instrumental": true,
  "wait_audio": true
}
```

### Studio Concat

`POST /api/concat` 接收至少两个按顺序排列的 Clip。每项可带 `clip_id`、
`order` 和 `duration`。未提供 duration 时，服务会先读取 Clip 元数据，再构造
Studio 时间线并渲染合并结果。

### Song Auto Split 分轨

命令：

```bash
npm run stems -- song --clip-id CLIP_ID --format wav
npm run stems -- song --clip-id CLIP_ID --format mp3
```

HTTP 接口：

```text
POST /api/song_auto_stems_download
```

生产默认路径是纯 HTTP：发现或创建 stem bank、提交 render、轮询、下载 ZIP、
校验 ZIP、记录 SHA-256，并在重跑时复用已验证结果。

普通重跑会恢复 `.inflight` 或复用完整归档；`--force` 会明确要求新 render，
不应把它当作通用重试开关。

### Studio Multitrack

从完成的 `studio_export` Clip ID 下载：

```bash
npm run stems -- studio --clip-id STUDIO_EXPORT_CLIP_ID
```

对应接口：

- `POST /api/studio_multitrack`：从 `studio_export` Clip 自动解析 Studio
  Project 和 Version；
- `POST /api/studio/multitrack`：调用者直接提供 Studio Project ID 和 state。

下载完成后会验证 SHA-256、ZIP 完整性、WAV 条目和代表性 WAV 的
`ffprobe` 结果。浏览器/CDP 只保留为显式可选回退，默认关闭。

### Suno Studio 能力

新版公开以下 Studio 接口：

- `GET|POST /api/studio/projects`
- `GET|POST /api/studio/projects/:projectId`
- `GET /api/studio/projects/:projectId/versions`
- `GET /api/studio/projects/:projectId/versions/:versionId`
- `GET /api/studio/revisions/:revisionId`
- `POST /api/studio/revisions/:revisionId/clone`
- `GET|POST /api/studio/media/:clipId`
- `POST /api/studio/export`
- `POST /api/studio/multitrack`
- `GET|POST /api/studio/generate`
- `GET /api/studio/unverified_actions`

需要特别区分：

- Workspace Project ID：普通曲库/Workspace 分类；
- Studio Project ID：Studio 时间线、保存和渲染；
- Version/Revision ID：Studio 历史状态；
- Clip ID：音频或导出结果。

这些 ID 不能互换。保存 Studio Project 时，适配器会把 URL 中的 Studio ID
写入 Suno wire payload 名为 `project_id` 的字段，并拒绝 Workspace ID。

#### Studio Export

`POST /api/studio/export` 支持：

- Full Song；
- Selected Time Range（需要 `start_beats` 和 `end_beats`）。

它把结果保存成 Suno Library Clip，不等同于本地文件下载。

#### Studio 付费生成

`POST /api/studio/generate` 默认关闭。首次提交同时需要：

1. `SUNO_STUDIO_ENABLE_PAID_GENERATION=1`；
2. 配置 `SUNO_STUDIO_PAID_API_TOKEN`；
3. 请求携带匹配授权；
4. `confirm_paid_generation=true`；
5. 稳定、唯一的 `idempotency_key`。

服务会持久保存提交记录。一旦取得 Clip ID，恢复操作只轮询，不会重新发起第二次
付费生成。

#### 未验证 Studio 写操作

Archive、Unarchive、Bookmark、Metadata、Revision Clone 使用独立安全门。
其他编辑器动作只通过 `/api/studio/unverified_actions` 列出，不提供任意上游
转发接口。

默认应保持：

```text
SUNO_STUDIO_ENABLE_PAID_GENERATION=0
SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0
```

完整 Studio 和分轨说明：

[`docs/STUDIO_AND_STEMS.md`](suno-api-final-open-source-20260811/docs/STUDIO_AND_STEMS.md)

### 最新版 HTTP 路由清单

| Method | Route | 功能 |
|---|---|---|
| GET | `/api/get_limit` | 额度 |
| GET | `/api/workspaces` | Workspace |
| POST | `/api/create_precheck` | 验证码状态 |
| POST/PATCH | `/api/captcha_coordinates` | 图片验证码 |
| POST | `/api/generate` | Prompt Create |
| POST | `/api/custom_generate` | Custom Create |
| POST | `/api/upload_reference` | 上传参考音频 |
| POST | `/api/cover_generate` | Cover |
| POST | `/api/extend_audio` | Extend / Remix |
| POST | `/api/mashup_generate` | Mashup |
| POST | `/api/concat` | Studio Concat |
| GET | `/api/get` | 多 ID 查询 |
| GET | `/api/clip` | 单 Clip 查询 |
| POST | `/api/feed_by_ids` | JSON 多 ID 查询 |
| GET/POST | `/api/archive_account` | 归档状态/执行 |
| POST | `/api/song_auto_stems_download` | Song Auto Split |
| POST | `/api/studio_multitrack` | Clip 驱动的 Multitrack |
| GET/POST | `/api/studio/projects` | Studio Project |
| GET/POST | `/api/studio/projects/:projectId` | 读取/保存/受控操作 |
| GET | `/api/studio/projects/:projectId/versions` | Version 列表 |
| GET | `/api/studio/projects/:projectId/versions/:versionId` | Version |
| GET | `/api/studio/revisions/:revisionId` | Revision |
| POST | `/api/studio/revisions/:revisionId/clone` | 受控 Clone |
| GET/POST | `/api/studio/media/:clipId` | Media 分析 |
| POST | `/api/studio/export` | Studio Export |
| POST | `/api/studio/multitrack` | State 驱动的 Multitrack |
| GET/POST | `/api/studio/generate` | 付费生成/恢复 |
| GET | `/api/studio/unverified_actions` | 未验证动作目录 |

完整字段边界：

[`docs/API_REFERENCE.md`](suno-api-final-open-source-20260811/docs/API_REFERENCE.md)

### 安全注意事项

- 只使用自己的账号；
- 不要提交 `.env`；
- 不要公开 Cookie、2Captcha Key、代理凭据和 Studio Token；
- 不要记录或分享带签名的临时媒体 URL；
- Create、Cover、Extend、Mashup、上传、分轨和 Studio 操作可能消耗额度或
  改变账号状态；
- 不要把本服务直接暴露到公网；如确需远程使用，必须自行增加 TLS、认证、
  限流和网络访问控制；
- Suno 是上游非公开接口，字段和行为可能变化，升级前应先做只读检查和最小测试。

### 新版验证命令

```bash
npm ci
npm run test:archive
npx tsc --noEmit
npm run build
docker build -t suno-api-open-source:test .
```

开源包内不包含真实账号凭据，因此 CI 不应执行会消耗额度或改变账号状态的实时
Create、Cover、Mashup、上传、分轨和 Studio 付费操作。
