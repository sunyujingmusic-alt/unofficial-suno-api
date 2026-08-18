# Suno API Final 完整技术审计文档（2026-03-26）

> 这份文档是当前 `suno-api-final` 的**从头到尾完整技术说明**。
> 目标不是写营销介绍，而是把：
>
> - 当前 API 到底暴露了哪些接口
> - 每个接口内部如何调用上游
> - create / poll / download 的真实调用顺序
> - `c/check` 为 `true` 和 `false` 时分别怎么走
> - 当前已验证成功的链路与已修复的问题
> - 当前仍然需要怎样理解 challenge / captcha / timeout / retry
>
> 一次性写清楚，避免后续再被口头记忆或旧文档误导。

---

## 0. 当前结论先说在前面

截至 2026-03-26，当前 `suno-api-final` 的正式工作结论是：

1. **真实 create 端点是**：`POST https://studio-api.prod.suno.com/api/generate/v2-web/`
2. **真实 polling / clip read 端点是**：`POST https://studio-api.prod.suno.com/api/feed/v3`
3. **`POST /api/c/check` 不是 create 成功与否的硬失败判定**，而是 challenge / risk-control 状态探针
4. **当 raw `c/check` 返回 `{"required": true}` 时，当前运行时已验证可以通过 `2Captcha + Turnstile` 拿到 token，再继续真实 create 成功**
5. **当 raw `c/check` 返回 `{"required": false}` 时，当前运行时会直接 create，并已连续两轮 API 自测成功**
6. create 成功后的 post-create polling 之前存在脆弱点，但已经修复：
   - 已加入 `502/503/504` retry
   - 已修复空数组误判 completed 的问题
   - 已把 `wait_audio` 窗口从 `100s` 提高到 `180s`
   - 已把路由 `maxDuration` 提高到 `360`
7. 当前 3000 容器链路可暂时认定为：
   - **create 可用**
   - **poll 可用**
   - **wait_audio 可用**
   - **download（MP3/WAV）已在 completed clip 场景单独验证可用**

---

## 1. 当前本地暴露的 API 面

当前这个 build 只保留最小但已经验证过的接口集合。

### 1.1 当前本地暴露的 7 个接口

- `GET /api/get_limit`
- `GET /api/workspaces`
- `POST /api/create_precheck`
- `POST /api/generate`
- `POST /api/custom_generate`
- `GET /api/get?ids=...`
- `POST /api/feed_by_ids`

### 1.2 各接口的角色

#### `GET /api/get_limit`
查询当前账号 credits / 额度。

#### `GET /api/workspaces`
查询当前 Suno 项目 / workspace 列表。

#### `POST /api/create_precheck`
本地对外暴露的 challenge 检测入口，但它不是简单透传。
它内部会调用上游 raw `POST /api/c/check`，并且在 `required=true` 时会**直接尝试解题**。

#### `POST /api/generate`
Prompt 模式生成。
它最终也会落到统一的 create 流程，只是把 prompt 映射到 `gpt_description_prompt` 这一路。

#### `POST /api/custom_generate`
Custom 模式生成。
这是当前最重要的正式闭环入口：

- 精确歌词
- 风格 / tags
- 标题
- create
- wait_audio
- 下载 MP3 / WAV（可开关）

#### `GET /api/get?ids=...`
按 ids 查询 clips，本质也是走 `feed/v3`。

#### `POST /api/feed_by_ids`
按 ids 查询 clips，本质也是走 `feed/v3`。

---

## 2. 当前运行时结构

### 2.1 代码位置

- repo：`<repo-root>`
- 主核心文件：`src/lib/SunoApi.ts`

### 2.2 当前容器运行模式

当前 3000 容器由 `docker-compose.yml` 驱动，关键点如下：

- 服务名：`suno-api`
- 容器端口：`3000`
- 主机映射端口：默认 `3000`
- `public/` 挂载进容器
- 本地 `./.next` 挂载进容器
- NAS 路径 `/Volumes/素材/TEMP/chu` 挂载进容器

### 2.3 代理口径（很重要）

compose 中当前容器默认使用：

- `HTTP_PROXY=http://host.docker.internal:7890`
- `HTTPS_PROXY=http://host.docker.internal:7890`

这点必须和 host 侧区分开理解：

- **宿主机开发模式** 可以用 `127.0.0.1:7890`
- **Docker 容器模式** 不能把 `127.0.0.1:7890` 当宿主代理
- 容器里 `127.0.0.1` 指向容器自己，不是宿主机
- 所以容器里正确口径是：`host.docker.internal:7890`

这也是之前很多“host 可用、container 不通”的高频误区来源。

---

## 3. 认证 / 会话 / 请求上下文：create 前到底准备了什么

create 并不是拿到 cookie 就直接发一条 HTTP 请求那么简单。
当前运行时在真正 create 前，内部会准备多层上下文。

### 3.1 Cookie 来源

`new SunoApi(rawCookies)` 会优先使用：

1. 路由请求里传入的 cookies
2. 否则退回环境变量 `SUNO_COOKIE`

### 3.2 Device-Id

运行时会优先从 cookie 中取：

- `suno_device_id`
- `ajs_anonymous_id`

如果都没有，就生成一个新的 UUID。

### 3.3 Clerk Session Bootstrap

初始化流程：

1. `getAuthToken()`
2. `keepAlive()`

#### `getAuthToken()` 做什么
它会请求：

```http
GET https://clerk.suno.com/v1/client?_is_native=true&_clerk_js_version=5.15.0
```

并从返回里取：

- `last_active_session_id`

这一步拿到的是 Clerk 的 `sid`。

#### `keepAlive()` 做什么
它会请求：

```http
POST https://clerk.suno.com/v1/client/sessions/{sid}/tokens?_is_native=true&_clerk_js_version=5.15.0
```

得到：

- `jwt`

然后缓存到 `this.currentToken`，后续请求自动带：

```http
Authorization: Bearer <jwt>
```

### 3.4 每个 Suno API 请求都会动态带 Browser-Token

当前 `SunoApi.ts` 内部会为所有 `studio-api.prod.suno.com` 请求带：

```http
Browser-Token: {"token":"<base64url(timestamp-json)>"}
```

它的生成逻辑是：

- `Date.now()`
- `JSON.stringify({ timestamp })`
- base64url 编码
- 再包装成 `{"token":"..."}`

**关键理解：**
这不是 create body 里的 challenge token。
它更像 freshness header。

### 3.5 `__client_uat` 每次请求动态刷新

当前请求拦截器会给 Cookie 头中额外加入：

- `__client_uat=<当前 Unix 时间戳>`

### 3.6 Create Session Token

在 create 前，还会调用：

```http
POST https://studio-api.prod.suno.com/api/user/create_session_id/
```

请求体：

```json
{
  "session_properties": "{\"deviceId\":\"...\"}",
  "session_type": 1
}
```

返回的：

- `session_id`

会被缓存到：

- `metadata.create_session_token`

### 3.7 User Tier

运行时还会尝试请求：

```http
GET https://studio-api.prod.suno.com/api/billing/info/
```

提取 `user_tier` / `tier` 等信息，放入 create metadata。

---

## 4. `c/check` 到底怎么理解：raw 上游 vs 本地 wrapper

这是最容易被误解的地方，必须分两层说。

---

## 4.1 Raw 上游 `POST /api/c/check` 的含义

上游真实探针是：

```http
POST https://studio-api.prod.suno.com/api/c/check
Content-Type: application/json

{"ctype":"generation"}
```

它的返回里最重要的字段是：

- `required`

### A. 当 raw 返回 `{"required": false}`
表示：

- 当前没有要求额外 challenge token
- create 可以直接继续发往 `generate/v2-web`
- 当前两轮 API 稳定性自测都走了这条路径

### B. 当 raw 返回 `{"required": true}`
表示：

- 当前 generation 处于 challenge / risk-control 激活状态
- **这不等于 create 一定失败**
- 它的正确理解是：
  - 需要额外 challenge 处理
  - 处理完成后 create 仍可能成功

根据 2026-03-25 浏览器抓包，以及 2026-03-26 2Captcha 实测，当前正式口径是：

> raw `required=true` 不是硬失败条件，而是“需要 challenge token”这一事实的提示。

---

## 4.2 本地 wrapper `POST /api/create_precheck` 的含义

本地路由：

```http
POST http://127.0.0.1:3000/api/create_precheck
```

它调用的是 `SunoApi.createPrecheck()`，而 `createPrecheck()` 的逻辑不是“把 raw 结果原样返回”。

### 具体逻辑

1. 调 raw 上游 `POST /api/c/check`
2. 读取 raw `required`
3. 如果 raw `required=false`
   - 直接返回：

```json
{"required": false}
```

4. 如果 raw `required=true`
   - 直接进入 `solveTurnstile()`
   - 通过 2Captcha 提交 Turnstile 任务并轮询结果
   - 若成功拿到 token，则本地 wrapper 返回：

```json
{"required": false, "solved": true}
```

### 这意味着什么

也就是说：

- **raw 上游可能是 `required=true`**
- 但**本地 wrapper 最终仍可能返回 `required=false, solved=true`**

因为本地 wrapper 的语义其实是：

> “当前 create 前置 challenge 是否已经被本实例处理到可继续 create 的状态”

而不是：

> “raw 上游此刻最原始返回是什么”

这个区别必须写死，不然后面很容易被文档或日志带偏。

---

## 5. `c/check=false` 时的完整调用链

这是当前稳定性自测已连续成功的路径。

### 5.1 调用顺序

1. 客户端调用本地：`POST /api/custom_generate`
2. 本地路由进入 `customGenerateAndDownload()`
3. 内部调用 `create()`
4. `create()` 内部先做 `createPrecheck()`
5. raw `POST /api/c/check -> {"required": false}`
6. 不需要 captcha token
7. 组装 create payload
8. 调上游：`POST /api/generate/v2-web/`
9. 得到 2 个 clip ids
10. 若 `wait_audio=true`，继续轮询 `POST /api/feed/v3`
11. clips 到 `complete`
12. 若要求下载，则继续下载 MP3/WAV

### 5.2 今天已验证成功的两轮 API 自测

#### 第一轮
- HTTP 200
- 耗时：`37.505s`
- `song_ids`：
  - `d519b651-26f2-4cbd-8b75-9dd66b178c99`
  - `934677b3-b9cc-486f-a97e-89a3a15732da`
- 轮询轨迹：
  - `queued / queued`
  - `streaming / queued`
  - `complete / streaming`
  - `complete / complete`

#### 第二轮
- HTTP 200
- 耗时：`41.87s`
- `song_ids`：
  - `0a056447-7655-469a-aada-5f67c07b83b5`
  - `ccc66e88-270e-4f18-a882-4e8a13d35d40`
- 轮询轨迹：
  - `queued / queued`
  - `streaming / streaming`
  - `streaming / complete`
  - `complete / complete`

### 5.3 当前对这条路径的结论

结论已经很明确：

- `c/check=false` 时
- 当前 3000 API 版本
- `custom_generate -> generate/v2-web -> feed/v3 -> complete`

**当前已连续两轮稳定成功。**

---

## 6. `c/check=true` 时的完整调用链

这条路径已经被 2026-03-26 真实验证打通。

### 6.1 调用顺序

1. 客户端进入 `create()`
2. 内部先做 raw `POST /api/c/check`
3. raw 返回：

```json
{"required": true}
```

4. `createPrecheck()` 发现 challenge 激活，转入 `solveTurnstile()`
5. `solveTurnstile()` 使用 2Captcha：
   - 提交 Turnstile 任务
   - 每 5 秒轮询一次结果
   - 最长等待 120 秒
6. 若成功，拿到 `turnstileToken`
7. `create()` 继续发：

```http
POST /api/generate/v2-web/
```

并把 token 放进 create body 的：

- `token`

8. create 返回 200，并拿到 clips
9. 继续 `feed/v3` 轮询
10. 后续进入 completed / download 流程

### 6.2 2Captcha 这条链路当前已证实的事实

今天已经证实：

- `required=true` 时，并不是只能浏览器手点
- 服务器端可以通过 `2Captcha + Turnstile` 拿到有效 token
- 之后可以继续真实 create 成功

### 6.3 当前已验证成功的真实样例

真实成功样例 `song_ids`：

- `4cae35fd-e204-4c1e-affa-a5bf9197f814`
- `22bf6781-ea02-40b6-b4c2-c400996fa72a`

### 6.4 这个路径里曾经的关键 bug

当时误以为是 2Captcha 参数错误，但最后确认真正的关键 bug 是：

- 错误写法：`sleep(5000)`
- 正确写法：`sleep(5)`

因为 `sleep()` 的参数单位是“秒”，不是“毫秒”。

所以 `sleep(5000)` 实际上不是等 5 秒，而是等 5000 秒，导致整个验证码轮询看起来像卡死。

这个 bug 修掉之后，`required=true -> 2Captcha -> create success` 才真正跑通。

---

## 7. 真正的 create 调用：`generate/v2-web` 发了什么

当前统一 create 入口都汇聚到：

```ts
await this.client.post(`${BASE_URL}/api/generate/v2-web/`, payload)
```

### 7.1 当前 create payload 的关键字段

当前代码里 payload 主要包含：

```json
{
  "project_id": "...",
  "token": "<turnstileToken 或 null>",
  "generation_type": "TEXT",
  "title": "...",
  "tags": "...",
  "negative_tags": "...",
  "mv": "chirp-fenix",
  "prompt": "...",
  "gpt_description_prompt": "...",
  "make_instrumental": false,
  "metadata": {
    "web_client_pathname": "/create",
    "is_max_mode": false,
    "is_mumble": false,
    "create_mode": "custom 或 prompt",
    "user_tier": "...",
    "create_session_token": "...",
    "disable_volume_normalization": false
  },
  "transaction_uuid": "..."
}
```

### 7.2 custom 模式与 prompt 模式的差异

#### custom 模式
- `create_mode = custom`
- `title` 生效
- `tags` 生效
- `prompt` 放精确歌词
- `gpt_description_prompt` 通常为空

#### prompt 模式
- `create_mode = prompt`
- `title` 置空
- `tags` 不走 custom tags
- `prompt` 不走精确歌词意义
- `gpt_description_prompt` 放自然语言描述

### 7.3 模型字段

当前默认模型（按 2026-04-08 最新浏览器抓包口径更新）：

- `chirp-fenix`（`v5.5`）
- 旧的 `chirp-crow` 属于此前 `v5` 抓包口径

代码常量：

```ts
export const DEFAULT_MODEL = 'chirp-fenix'
```

---

## 8. post-create polling：`feed/v3` 现在怎么查状态

create 成功拿到 clips 后，如果 `wait_audio=true`，就进入 polling。

### 8.1 上游调用

```http
POST https://studio-api.prod.suno.com/api/feed/v3
```

请求体结构：

```json
{
  "filters": {
    "ids": {
      "presence": "True",
      "clipIds": ["id1", "id2"]
    }
  },
  "limit": 2
}
```

### 8.2 当前状态字段

轮询时当前观测到的典型状态包括：

- `submitted`
- `queued`
- `streaming`
- `complete`
- `error`

### 8.3 当前 `getFeedByIdsV3()` 的加固逻辑

今天已经加固为：

- 最多 `4` 次尝试
- 对 `502 / 503 / 504` 自动 retry
- 若返回 `0 clips` 且本轮预期不为空，也会 retry
- 每轮都记录结构化日志：
  - `attempt`
  - `expectedCount`
  - `returnedCount`
  - `statuses`

### 8.4 当前 `wait_audio` 逻辑

create 返回 clips 后，`create()` 内现在采用**贴近真实生成时长**的新节奏：

- create 成功后先等待：`90s`
- 然后开始轮询
- 每轮间隔：`15s`
- 总轮询次数：`10`
- 每轮前：`keepAlive(true)`
- 单次 `feed/v3` 请求 timeout：`15s`

判定逻辑：

- `allCompleted`：所有 clips 都是 `complete`
- `allError`：所有 clips 都是 `error`

若任一成立，则返回当前 `polled`。

### 8.5 当前轮询失败 / 达到上限时怎么处理

若某一轮 `feed/v3` 只是瞬时 timeout / 瞬时查询失败：

- 不再立刻把整次 `custom_generate` 打成 500
- 会先按 retryable poll failure 处理
- 然后继续按既定轮询节奏进入下一轮

若 10 轮都还没有全部进入终态：

- 会记录达到上限的日志
- 然后返回最后一轮非空 `last`

这意味着：

- create 已成功
- poll 也确实按节奏跑过
- 只是尚未在这套轮询窗口内全部 complete

也就是说 timeout / 未完成的位置依旧是：

> **create 成功之后，等待 clip 从 streaming/queued 进入 complete 的阶段**

不是 create 提交阶段本身。

---

## 9. 今天修掉的 post-create polling 问题

今天对这块做了两轮关键修复。

### 9.1 修复一：`b929371` Harden Suno post-create polling

主要内容：

1. `feed/v3` 增加 `502/503/504 retry`
2. 修掉空数组 `every()` 误判 completed 的坑
3. 轮询日志结构化
4. poll 前显式 keepAlive

### 9.2 修复二：`dc27821` Extend Suno wait_audio timeout window

主要内容：

1. `wait_audio` 从 `100s` 调到 `180s`
2. `custom_generate` 路由 `maxDuration` 从 `180` 提到 `360`
3. `generate` 路由 `maxDuration` 从 `180` 提到 `360`

### 9.3 修复三：`d52b514` Align Suno polling cadence with real generation timing

主要内容：

1. create 成功后，先等待 `90s` 再开始 poll
2. poll 间隔改为 `15s`
3. 最大轮询次数改为 `10`
4. 单次 `feed/v3` poll request timeout 调整为 `15s`
5. `custom_generate` 与 `generate` 路由 `maxDuration` 提到 `600`
6. 瞬时 poll timeout 不再直接把整次 create 误打成 500

### 9.4 当前对修复效果的判断

按新节奏使用《候补春天的列车》这份真实歌词再次 create，已返回 HTTP 200，并在第 3 轮 poll 时两首都到 `complete`。因此当前阶段可以把结论更新为：

> create 成功后的共同轮询段，按“90 秒后起轮询、15 秒间隔、最多 10 轮”的节奏，当前已验证稳定可用。

---

## 10. 下载链路：completed 之后 MP3 / WAV 怎么拿

下载只发生在 `customGenerateAndDownload()`。

### 10.1 默认输出目录

如果未显式传 `output_dir`，默认输出到：

```text
/Volumes/素材/TEMP/chu/热搜generate歌曲/<时间戳>_<slug>
```

时间戳默认时区：

- `Asia/Shanghai`

### 10.2 文件命名

每个 clip 文件前缀：

```text
01_<slug(title)>_<clip_id>
02_<slug(title)>_<clip_id>
```

### 10.3 MP3 下载流程

对每个 clip：

1. `prepareClipDownload(clip.id)`
   - 调：

```http
POST /api/billing/clips/{clipId}/download/
```

2. 若 `clip.audio_url` 存在，则直接下载到本地文件

### 10.4 WAV 下载流程

对每个 clip：

1. `prepareClipDownload(clip.id)`
2. 若 clip 上还没有 `wav_file_url`，则执行 `ensureWavFile()`
3. `ensureWavFile()` 内部：
   - `convertWav(clip.id)`
   - 调：

```http
POST /api/gen/{clipId}/convert_wav/
```

4. 然后轮询 `getWavFile(clip.id)`：

```http
GET /api/gen/{clipId}/wav_file/
```

5. 默认最多：
   - `20` 次
   - 每次间隔 `3s`
   - 也就是大约 `60s` 等待窗口
6. 拿到 `wav_file_url` 后再下载文件

### 10.5 当前下载结论

今天已经对一个已 completed 的 clip 单独验证成功：

- clip：`fb3bc270-4b3a-4e3c-b362-5f7005ba41f3`
- MP3 成功
- WAV 成功

因此当前对下载链路的正式口径是：

> **completed 之后的下载链路本身是通的。**

也就是说，今天后半段真正该排的不是下载，而是 create 后的 wait/poll。

---

## 11. 各本地路由的调用细节

---

## 11.1 `POST /api/custom_generate`

### 当前路由超时上限

- `maxDuration = 600`

### 请求体支持字段

- `prompt`
- `tags` 或 `style`
- `title`
- `make_instrumental`
- `model`
- `negative_tags`
- `project_id` / `projectId`
- `project_name` / `projectName`
- `output_dir` / `outputDir`
- `download_mp3` / `downloadMp3`
- `download_wav` / `downloadWav`

### 内部映射

- `style -> tags`
- `projectName -> project_name`
- `downloadMp3 -> download_mp3`
- `downloadWav -> download_wav`

### 当前路由超时上限

- `maxDuration = 600`

---

## 11.2 `POST /api/generate`

### 当前路由超时上限

- `maxDuration = 600`

### 请求体支持字段

- `prompt`
- `make_instrumental`
- `model`
- `wait_audio`

### 内部调用

走：

```ts
generate(prompt, makeInstrumental, model, waitAudio)
```

最后也会汇聚到统一 `create()`。

### 当前路由超时上限

- `maxDuration = 600`

---

## 11.3 `POST /api/create_precheck`

### 重要提醒

它不是 raw `c/check` 的透传。

### 当前可能返回的本地语义

#### 情况 1：raw `required=false`
本地返回：

```json
{"required": false}
```

#### 情况 2：raw `required=true` 且 2Captcha 已成功解出
本地返回：

```json
{"required": false, "solved": true}
```

#### 情况 3：raw `required=true` 但解题失败
本地会抛错，例如：

- `CAPTCHA_SOLVE_FAILED: ...`

所以必须记住：

> 本地 `create_precheck` 的返回，是“当前实例是否已经把 challenge 处理到可继续 create”的语义，不是 raw 上游原始值的镜像。

---

## 11.4 `GET /api/get?ids=...`

示例：

```bash
curl "http://127.0.0.1:3000/api/get?ids=id1,id2"
```

内部调用：

- `getFeedByIdsV3(ids)`
- 最终走上游 `POST /api/feed/v3`

---

## 11.5 `POST /api/feed_by_ids`

示例请求体：

```json
{
  "clipIds": ["id1", "id2"],
  "limit": 2
}
```

同样最终走上游：

- `POST /api/feed/v3`

---

## 11.6 `GET /api/workspaces`

支持：

- `?show_trashed=true`
- `?show_trashed=1`

内部调用上游：

```http
GET /api/project/me?page=...&query=&show_trashed=...
```

---

## 11.7 `GET /api/get_limit`

内部调用上游：

```http
GET /api/billing/info/
```

返回典型字段：

- `credits_left`
- `period`
- `monthly_limit`
- `monthly_usage`

---

## 12. 当前已知的关键技术事实

### 12.1 Browser-Token 不是 create body 里的 challenge token

根据 2026-03-25 的 bundle / 浏览器逆向结论：

- `Browser-Token` 更像 freshness header
- `generate/v2-web` body 里的长 `token` 才更接近 challenge proof
- 两者不是一回事

### 12.2 `generate/v2-web` body 里的 token 与 captcha 强相关

根据之前的逆向结论，它来源于浏览器侧的 captcha 验证流程返回值，而不是简单等同于 `Browser-Token`。

### 12.3 `Token validation failed` 的解释

当前应解释为：

- 上游拒绝了当前 create token
- 不应简单等同于“代理坏了”
- 更像 challenge token / 时效 / 上下文绑定问题

### 12.4 `required=true` 和 `Token validation failed` 不是一回事

这两个概念必须分开：

- `required=true`：说明 challenge 激活
- `Token validation failed`：说明你提交给 create 的 token 没被上游接受

前者是状态，后者是 create 阶段的拒绝结果。

---

## 13. 当前已知成功证据

### 13.1 `required=true` 路径成功证据

真实成功 `song_ids`：

- `4cae35fd-e204-4c1e-affa-a5bf9197f814`
- `22bf6781-ea02-40b6-b4c2-c400996fa72a`

这证明：

- `required=true`
- 2Captcha 解题
- `generate/v2-web` create

这一整条链路已经真实成功。

### 13.2 `required=false` 路径成功证据

连续两轮 API 自测成功：

- 第一轮：`37.505s`
- 第二轮：`41.87s`

这证明：

- 当前 3000 容器链路的 create + poll 已恢复稳定

### 13.3 下载链路成功证据

已完成 clip：

- `fb3bc270-4b3a-4e3c-b362-5f7005ba41f3`

结果：

- MP3 下载成功
- WAV 下载成功

这证明：

- completed 后的下载闭环是通的

---

## 14. 当前仍然需要记住的边界

### 14.1 `create_precheck` 不能再按“硬失败判定”理解

这是当前最重要的口径修正之一。

### 14.2 host 与 container 的代理口径不能混

- host：`127.0.0.1:7890`
- container：`host.docker.internal:7890`

### 14.3 不要把旧结论“create 走 feed/v3”当真

当前正式结论已经明确：

- `generate/v2-web` = create
- `feed/v3` = polling / read

### 14.4 timeout 环节的位置必须说准

当前 timeout（若再发生）指的是：

- create 成功之后
- wait_audio 等 clips 进入 terminal state 的阶段

不是：

- `c/check`
- `generate/v2-web` 提交本身
- 下载本身

---

## 15. 当前推荐的最小健康检查命令

### 15.1 credits

```bash
curl http://127.0.0.1:3000/api/get_limit
```

### 15.2 workspaces

```bash
curl http://127.0.0.1:3000/api/workspaces
```

### 15.3 challenge precheck

```bash
curl -X POST http://127.0.0.1:3000/api/create_precheck
```

### 15.4 custom generate

```bash
curl -X POST http://127.0.0.1:3000/api/custom_generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "[Verse]\\n示例歌词\\n[Chorus]\\n示例副歌",
    "style": "minimal pop, soft piano, clean vocal",
    "title": "example_song",
    "model": "chirp-fenix",
    "download_mp3": true,
    "download_wav": true
  }'
```

### 15.5 feed by ids

```bash
curl -X POST http://127.0.0.1:3000/api/feed_by_ids \
  -H 'Content-Type: application/json' \
  -d '{"clipIds":["id1","id2"],"limit":2}'
```

---

## 16. 当前代码快照里最重要的提交

- `3a9f1db` — `Fix 2Captcha Turnstile flow for create path`
- `2c8508f` — `Fix 2Captcha polling and trim debug logs`
- `b929371` — `Harden Suno post-create polling`
- `dc27821` — `Extend Suno wait_audio timeout window`
- `d52b514` — `Align Suno polling cadence with real generation timing`

这五个提交合起来，构成了当前 2026-03-26 这版可工作的核心基线。

---

## 17. 最终一句话口径

如果后面再有人问：

### “`c/check` 为 false 怎么样？”
答：

> 说明当前不需要 challenge token，create 可直接走 `generate/v2-web`；当前这条路径已连续两轮 API 自测成功。

### “`c/check` 为 true 怎么样？”
答：

> 说明 challenge 激活，不代表 create 必败。当前正式运行时会转入 `2Captcha + Turnstile`，拿到 token 后继续 create；这条路径也已经被真实成功验证过。

### “当前 API 到底稳不稳？”
答：

> 当前 3000 版的 create + poll 已经恢复稳定；completed 之后的 MP3/WAV 下载链路也已单独验证通过。

---

## 18. 相关文档

- `docs/SUNO_API_GUIDE.md`
- `docs/SUNO_API_RUNTIME_SOP.md`
- `docs/SUNO_API_FULL_TECHNICAL_AUDIT_2026-03-26.md`（本文件）
- `<workspace>/docs/suno-create-challenge-findings-2026-03-25.md`
- `memory/2026-03-26.md`

---

这份文档的目标不是“最短”，而是“以后回看时，不会再被关键语义误导”。
