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
