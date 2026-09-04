# Suno Create 新 Agent 速查卡

这张卡只回答一件事：`create` 这一步，遇到不同验证时该怎么分流、怎么判定成功。

## 先看这 4 个文件

- `<repo-root>/src/app/api/custom_generate/route.ts`
- `<repo-root>/src/app/api/captcha_coordinates/route.ts`
- `<repo-root>/src/lib/SunoApi.ts`
- `<workspace>/suno-create-web-cli/agent-harness/SUNO_CREATE.md`

## 一句话总规则

- `captcha_version=2`：走 HTTP 直提，Turnstile + 2Captcha API v2。
- `captcha_version=1`：走 OpenClaw 托管浏览器，hCaptcha 图片挑战 + 本地坐标接口。
- 真正成功的证据永远是 `song_ids`。

## 快速分流

| 结果 | 该走哪条路 | 关键动作 | 成功证据 |
|---|---|---|---|
| `captcha_version=2` / `turnstile` | HTTP `custom_generate` | 2Captcha API v2 解决 Turnstile | Suno 返回 `song_ids` |
| `captcha_version=1` / `hcaptcha` | OpenClaw 浏览器 | 截图 -> 本地 `/api/captcha_coordinates` -> 2Captcha -> 浏览器点击 | `challenge_detected=true` 且 challenge 关闭后返回 `song_ids` |
| 没有 challenge | 继续 HTTP / 浏览器提交 | 不要误判为“解题成功” | 只有 `song_ids` 才算 |

## Turnstile 这条线

`captcha_version=2` 时，不要切浏览器。

流程是：

1. `GET /api/get_limit`
2. `POST /api/create_precheck`
3. 进入 `custom_generate`
4. 2Captcha API v2 处理 Turnstile
5. Suno 最终返回 `song_ids`

注意：

- `ready` 不是成功，只是 `pending_create`
- 只有 `song_ids` 才算真的通过
- `422` / 验证失败要按重试或 `reportIncorrect` 处理

## hCaptcha 这条线

`captcha_version=1` 时，必须用 OpenClaw 托管浏览器，不要用系统浏览器。

流程是：

1. 在 OpenClaw 浏览器里填好 `title` / `lyrics` / `styles`
2. 点击 `Create`
3. 出现 hCaptcha 后，浏览器截屏
4. 发给本地接口：`http://127.0.0.1:3000/api/captcha_coordinates`
5. 这个本地接口再调用 2Captcha
6. 返回点击坐标
7. 浏览器在同一页面里点坐标 / 拖拽
8. challenge 关闭
9. 再继续 Suno create，拿到 `song_ids`

注意：

- 浏览器不是直接调 2Captcha
- 但本地 `captcha_coordinates` 接口确实会调 2Captcha
- 所以这条线本质上还是用了 2Captcha，只是隔了一层本地服务

## 本地 `captcha_coordinates` 做什么

接口文件：

- `<repo-root>/src/app/api/captcha_coordinates/route.ts`

它会：

- 读 `TWOCAPTCHA_API_KEY`
- 把截图发到 `https://api.2captcha.com/createTask`
- 轮询 `https://api.2captcha.com/getTaskResult`
- 返回 `task_id`、`coordinates`、`solve_count`、`elapsed_ms`
- `PATCH` 还会调 `reportIncorrect`

所以它不是纯本地识图，而是 2Captcha 转发层。

## 这些信号都不能单独算成功

- `ready`
- `challenge_detected=false`
- `streaming`
- 页面按钮可点
- 目录存在但 MP3 为空

## 真正的成功标准

### Turnstile

- `custom_generate` 返回有效 `song_ids`

### hCaptcha

- `challenge_detected=true`
- 至少有 solver task 记录
- challenge 在同一浏览器上下文关闭
- 后续 Suno 返回 `song_ids`

## 常见故障，先这么理解

| 现象 | 通常意味着什么 |
|---|---|
| `GET /api/get_limit` 502 | 本机 Suno API 或上游网络异常 |
| `captcha_coordinates` 503 | 没配 `TWOCAPTCHA_API_KEY` |
| `2Captcha ready` 但没 `song_ids` | 只到了中间态 |
| `challenge_detected=false` | 没遇到 challenge，不是解题成功 |
| challenge 一直不关 | 坐标错、页面状态不对、或要重新解 |

## 记住这 3 条

1. `song_ids` 才是成功。
2. `captcha_version=2` 不切浏览器。
3. `captcha_version=1` 只用 OpenClaw 浏览器，不用系统浏览器。
