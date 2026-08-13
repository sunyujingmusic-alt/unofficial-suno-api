# unofficial-suno-api 从 0 开始手动部署教程

> 面向没有软件工程基础的音乐人<br>
> 推荐方式：Docker Desktop<br>
> 教程核对版本：公开仓库 `main` 分支，2026 年 8 月 12 日，提交 `2b6d986`

项目地址：

https://github.com/sunyujingmusic-alt/unofficial-suno-api

---

## ⚠️ 免责声明 (Disclaimer)

本项目为一个非官方的开源研究项目，仅用于学习和技术交流。<br>
本项目与 Suno.ai 官方没有任何关联、授权或背书。<br>
请勿将本项目用于任何违反 Suno 官方服务条款（TOS）的商业用途。若因使用本项目造成任何侵权或账号封禁，由使用者自行承担责任。

请只操作你自己的 Suno 账号，并确保你有权使用、上传和下载相关音频。

---

## 一、这份教程会帮你完成什么

完成本教程后，你的电脑上会运行一个本地 Suno API。

它的地址默认是：

```text
http://127.0.0.1:3000
```

你可以：

- 在浏览器中查看接口说明；
- 读取自己 Suno 账号的剩余额度；
- 让本机 Agent 或自动化工具调用 Suno；
- 提交歌曲生成任务；
- 上传参考音频；
- 使用 Cover、Extend / Remix、Mashup 等功能；
- 下载账号曲库中的 MP3 和 WAV；
- 使用歌曲分轨和部分 Studio 功能。

这里部署的是“接口服务”，不是带有完整按钮界面的音乐软件。部署成功后，主要由 Agent、脚本或接口调用工具使用它。

---

## 二、为什么推荐使用 Docker

你不需要理解 Docker 的内部原理。

可以把它理解成一个已经准备好的“软件运行箱”：

- 项目需要的 Node.js 会在箱子里准备好；
- `ffmpeg`、`ffprobe`、`unzip` 等工具会在箱子里准备好；
- 不需要你逐个安装编程环境；
- Windows 和 macOS 可以使用基本相同的启动命令；
- 以后停止、重启和升级比较容易。

本教程只讲最适合新手的 Docker 部署方式。

---

## 三、开始前需要准备什么

请准备：

1. 一台 Windows 或 macOS 电脑；
2. 可以正常登录的个人 Suno 账号；
3. Chrome 浏览器；
4. 可以正常访问 GitHub、Docker 和 Suno 的网络；
5. 至少预留约 10 GB 磁盘空间；
6. 如果需要自动处理部分 Create 验证码，可选准备一个 2Captcha 账号和 API Key。

建议把项目放在电脑本地磁盘，不要一开始就放进 OneDrive、iCloud Drive 或其他同步盘，以免遇到权限、同步冲突或大文件重复上传。

---

## 四、安装 Docker Desktop

Windows 和 macOS 只需要选择与你电脑对应的一部分操作。

### 4.1 Windows 安装方法

#### 第 1 步：下载 Docker Desktop

打开 Docker 官方安装页面：

https://docs.docker.com/desktop/setup/install/windows-install/

普通 Intel 或 AMD Windows 电脑通常选择 Windows x86_64 / AMD64 版本。

#### 第 2 步：运行安装程序

双击下载的安装文件。

如果安装程序让你选择运行方式，保留 WSL 2 相关选项。

安装期间 Windows 可能要求：

- 允许管理员权限；
- 安装或更新 WSL；
- 注销或重新启动电脑。

按照屏幕提示操作即可。

#### 第 3 步：如果提示 WSL 需要更新

右键开始菜单，打开“终端（管理员）”或“Windows PowerShell（管理员）”，输入：

```powershell
wsl --update
```

等待执行完成，然后重新启动电脑，再打开 Docker Desktop。

#### 第 4 步：启动 Docker Desktop

在开始菜单中打开 Docker Desktop。

第一次运行时可能需要接受许可协议。等待 Docker Desktop 显示 Docker Engine 已经运行。

不要在 Docker Desktop 还在启动时继续后面的步骤。

#### 第 5 步：检查是否安装成功

打开 PowerShell，依次输入：

```powershell
docker --version
```

```powershell
docker compose version
```

只要两条命令都能显示版本号，说明 Docker 基础安装完成。

---

### 4.2 macOS 安装方法

#### 第 1 步：确认 Mac 芯片

点击屏幕左上角苹果菜单，选择“关于本机”。

查看“芯片”或“处理器”：

- 显示 Apple M1、M2、M3、M4、M5 等，选择 Apple silicon 版本；
- 显示 Intel，选择 Intel 版本。

#### 第 2 步：下载 Docker Desktop

打开 Docker 官方安装页面：

https://docs.docker.com/desktop/setup/install/mac-install/

下载与你的芯片对应的版本。

#### 第 3 步：安装

双击下载的 `.dmg` 文件，把 Docker 图标拖入“应用程序”文件夹。

然后从“应用程序”中打开 Docker。

macOS 可能会要求：

- 确认打开从互联网下载的应用；
- 输入当前 Mac 的登录密码；
- 允许 Docker 安装网络或虚拟化组件。

按照提示允许即可。

#### 第 4 步：等待 Docker 启动

等待菜单栏中的 Docker 图标显示已经运行。

#### 第 5 步：检查是否安装成功

打开“终端”，依次输入：

```bash
docker --version
```

```bash
docker compose version
```

两条命令都能显示版本号，就可以继续。

---

## 五、下载项目

### 第 1 步：打开 GitHub 项目

打开：

https://github.com/sunyujingmusic-alt/unofficial-suno-api

### 第 2 步：下载 ZIP

在项目页面中：

1. 点击绿色的 `Code` 按钮；
2. 点击 `Download ZIP`；
3. 等待下载完成。

### 第 3 步：解压

找到下载的 ZIP 文件并解压。

解压后的文件夹通常叫：

```text
unofficial-suno-api-main
```

为了以后好找，建议把它移动到桌面，并改名为：

```text
unofficial-suno-api
```

后面的命令都要在这个项目文件夹中执行。

---

## 六、获取自己的 Suno Cookie

### 6.1 Cookie 是什么

Cookie 是浏览器登录 Suno 后保存的登录凭证。

本项目使用它代表你自己的浏览器登录状态，与 Suno 后台通信。

> **Cookie 的敏感程度接近账号密码。**

绝对不要：

- 把 Cookie 发到论坛、微信群或聊天群；
- 把 Cookie 发给陌生人帮你部署；
- 在教程截图中露出 Cookie；
- 把包含 Cookie 的 `.env` 上传到 GitHub；
- 让 Agent 在聊天回复中打印 Cookie；
- 使用“复制为 cURL”后把整段内容公开。

### 6.2 使用 Chrome 获取完整 Cookie

#### 第 1 步：登录 Suno

使用 Chrome 打开：

```text
https://suno.com
```

完成登录，并确认你可以正常看到自己的 Library 或 Create 页面。

#### 第 2 步：打开开发者工具

Windows 按：

```text
Ctrl + Shift + I
```

macOS 按：

```text
Command + Option + I
```

也可以在网页空白处右键，选择“检查”。

#### 第 3 步：打开 Network

在开发者工具顶部点击：

```text
Network
```

如果没有看到 Network，可以点击顶部的 `>>` 再选择它。

#### 第 4 步：只看接口请求

点击 Network 中的：

```text
Fetch/XHR
```

然后刷新 Suno 页面。

Windows 刷新快捷键：

```text
Ctrl + R
```

macOS 刷新快捷键：

```text
Command + R
```

#### 第 5 步：选择 Suno 后台请求

在请求列表中，选择一个发往下面域名的请求：

```text
studio-api.prod.suno.com
```

常见请求名称可能包含：

```text
billing
info
project
feed
me
```

不要选择图片、字体或广告请求。

#### 第 6 步：找到 Cookie

点击该请求后：

1. 打开 `Headers`；
2. 找到 `Request Headers`；
3. 找到名为 `cookie` 的一行。

如果没有看到，可以：

- 点击 Request Headers 旁边的 `view source`；
- 换一个 `studio-api.prod.suno.com` 的 Fetch/XHR 请求；
- 再刷新一次网页；
- 确认你已经登录 Suno。

#### 第 7 步：复制 Cookie 的值

只复制 `cookie:` 后面的完整内容，不要把 `cookie:` 这个单词一起复制。

正确的 Cookie 通常很长，内部包含许多用分号分隔的项目。

不要只复制其中某一个小段，也不要手动删除内容。本项目初始化登录时需要完整 Cookie，其中应包含 Suno 当前登录所需的 Clerk 客户端凭证。

复制完成后，不要把它粘贴到聊天窗口。下一步直接放入本机 `.env` 文件。

---

## 七、创建并填写 `.env` 配置文件

`.env` 是这个项目的私人配置文件。

项目已经提供了一个模板：

```text
.env.example
```

我们要复制模板，并把副本命名为：

```text
.env
```

### 7.1 Windows 操作

#### 第 1 步：在项目文件夹中打开 PowerShell

打开 `unofficial-suno-api` 文件夹。

点击文件资源管理器顶部的地址栏，输入：

```text
powershell
```

按回车。

这样打开的 PowerShell 会自动位于当前项目文件夹。

#### 第 2 步：复制配置模板

输入：

```powershell
Copy-Item .env.example .env
```

#### 第 3 步：用记事本打开

输入：

```powershell
notepad .env
```

---

### 7.2 macOS 操作

#### 第 1 步：进入项目文件夹

打开“终端”，输入：

```bash
cd
```

先输入 `cd`，再按一下空格键，但暂时不要按回车。

然后把 Finder 中的 `unofficial-suno-api` 文件夹直接拖进终端窗口，按回车。

#### 第 2 步：复制配置模板

输入：

```bash
cp .env.example .env
```

#### 第 3 步：用文本编辑打开

输入：

```bash
open -e .env
```

macOS 默认会隐藏以点开头的文件，所以从 Finder 中看不到 `.env` 并不代表它不存在。

---

### 7.3 填入 Cookie

在 `.env` 中找到：

```text
SUNO_COOKIE=
```

修改成：

```text
SUNO_COOKIE='把刚才复制的完整 Cookie 粘贴在这里'
```

例如下面只是格式示意，不是真实 Cookie：

```text
SUNO_COOKIE='name1=value1; name2=value2; name3=value3'
```

注意：

- `=` 两边不要加空格；
- Cookie 必须在同一行；
- 不要把示例文字保留在文件中；
- 建议用英文单引号包住完整 Cookie；
- 英文单引号会让 Cookie 中的 `$` 等字符按原样传入容器；
- 不要在已经使用英文单引号时擅自把 `$` 改成 `$$`，否则会改变 Cookie 原值；
- 保存文件后关闭编辑器。

对于第一次部署，其他配置先保持模板默认值。

建议中国时区用户把：

```text
SUNO_OUTPUT_TIMEZONE=UTC
```

改为：

```text
SUNO_OUTPUT_TIMEZONE=Asia/Shanghai
```

这只影响本地输出记录中的时间显示，不影响 Suno 账号。

---

## 八、2Captcha 要不要配置

### 8.1 最简单的答案

不一定。

如果你目前只想：

- 启动 API；
- 查看额度；
- 查询 Workspace；
- 查询已有歌曲；
- 下载自己的歌曲；

可以先不配置 2Captcha。

2Captcha 主要影响 Create、Cover、Extend、Mashup 等可能遇到验证码的操作。

### 8.2 为什么 Create 可能需要它

每次 Create 前，API 会先询问 Suno 当前是否要求验证码。

可能出现三种情况：

1. Suno 当前不要求验证码，API 可以直接继续 Create；
2. Suno 要求 Turnstile，配置 2Captcha 后，API 可以尝试自动处理；
3. Suno 要求必须在同一浏览器环境中完成的 hCaptcha 图片挑战，默认会返回 `BROWSER_CAPTCHA_REQUIRED`，而不是假装已经成功。

2Captcha 返回“已解题”不等于歌曲已经创建成功。只有 Suno 最终返回非空歌曲 clip ID，才代表 Create 真正提交成功。

### 8.3 配置 2Captcha

你需要自行注册 2Captcha，并为账号充值少量余额。

在 `.env` 中找到：

```text
TWOCAPTCHA_API_KEY=
```

填写成：

```text
TWOCAPTCHA_API_KEY='你的 2Captcha API Key'
```

保留：

```text
SUNO_CREATE_CAPTCHA_METHOD=auto
```

`auto` 表示让 API 根据 Suno 当前返回的验证码版本自动选择处理方式。

保留：

```text
SUNO_CREATE_HCAPTCHA_TOKEN_MODE=browser
```

它表示遇到要求同一浏览器环境的图片验证码时，明确告诉调用者需要浏览器参与。

### 8.4 新手不要随意填写的项目

下面这些配置第一次部署时保持空白：

```text
SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL=
SUNO_CREATE_USER_TIER=
SUNO_CREATE_HCAPTCHA_RQDATA=
SUNO_CREATE_HCAPTCHA_API_DOMAIN=
SUNO_CREATE_CAPTCHA_ACTION=
SUNO_CREATE_CAPTCHA_CDATA=
SUNO_CREATE_CAPTCHA_PAGEDATA=
```

它们的作用是：

| 配置 | 作用 | 新手建议 |
|---|---|---|
| `SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL` | 让 Suno 请求与 2Captcha 解题使用同一个可访问的 HTTP/HTTPS 代理 | 不懂代理绑定时留空 |
| `SUNO_CREATE_USER_TIER` | 手动覆盖 Create 元数据中的账号套餐等级 | 默认会自动读取，留空 |
| `SUNO_CREATE_HCAPTCHA_TOKEN_MODE` | 决定 hCaptcha 使用浏览器模式还是旧式处理模式 | 保持 `browser` |
| Sitekey、rqdata、action 等 | 适配 Suno 当前验证码参数 | 没有明确抓包依据时不要改 |

`SUNO_CREATE_CAPTCHA_SHARED_PROXY_URL` 不是普通的本机代理开关。不要把 `127.0.0.1` 随便填进去，因为 2Captcha 服务器无法访问你电脑自己的 `127.0.0.1`。

---

## 九、第一次启动 Suno API

确保：

- Docker Desktop 正在运行；
- PowerShell 或终端当前位于项目文件夹；
- `.env` 已经保存；
- `.env` 中已经填写自己的完整 Suno Cookie。

### 9.1 Windows 启动命令

在项目文件夹的 PowerShell 中输入：

```powershell
docker compose up -d --build
```

### 9.2 macOS 启动命令

在项目文件夹的终端中输入：

```bash
docker compose up -d --build
```

### 9.3 第一次启动要等多久

第一次启动需要：

- 下载基础运行镜像；
- 下载项目依赖；
- 编译项目；
- 创建并启动容器。

根据电脑和网络情况，可能需要几分钟到更长时间。

终端暂时没有新内容时不要急着关闭。只要没有明确出现红色错误，可以继续等待。

看到类似下面的内容，通常表示容器已经启动：

```text
Container suno-api Started
```

---

## 十、检查部署是否成功

检查要分成两层。

第一层检查“本地程序是否正常启动”；第二层检查“是否已经成功连接你的 Suno 账号”。

### 10.1 检查容器状态

Windows 和 macOS 都输入：

```bash
docker compose ps
```

等待一会儿后，`suno-api` 的状态应该包含：

```text
Up
```

并最终显示：

```text
healthy
```

刚启动时显示 `health: starting` 属于正常现象。等待 30 到 60 秒，再执行一次 `docker compose ps`。

### 10.2 检查本地文档页

在浏览器打开：

```text
http://127.0.0.1:3000/docs
```

如果能看到 `Suno API Final / Pure HTTP Rewrite` 和接口列表，说明：

- Docker 容器正在运行；
- 本地 3000 端口可以访问；
- 项目本身已经成功启动。

这个页面能打开，不代表 Cookie 一定有效，还要继续下一步。

### 10.3 检查 Suno 登录和额度

在浏览器打开：

```text
http://127.0.0.1:3000/api/get_limit
```

成功时会看到一段 JSON，常见字段包括：

```json
{
  "credits_left": 1000,
  "period": "...",
  "monthly_limit": 10000,
  "monthly_usage": 9000
}
```

数字只是示意，以你的账号实际结果为准。

只要返回的是账号额度信息，而不是 `error`，就说明：

- `.env` 已经被容器读取；
- Cookie 可以建立 Suno 登录会话；
- 本地 API 已经能连接 Suno 后台。

### 10.4 如果提示 Cookie 失效

常见错误类似：

```text
Failed to get session id, you may need to update SUNO_COOKIE
```

请：

1. 回到 Chrome；
2. 确认 Suno 仍然处于登录状态；
3. 重新按照第六章获取完整 Cookie；
4. 更新 `.env` 中的 `SUNO_COOKIE`；
5. 保存；
6. 回到项目文件夹执行：

```bash
docker compose up -d --force-recreate
```

然后重新打开额度接口检查。

---

## 十一、检查 Create 前的验证码状态

这个检查不会生成歌曲，也不会消耗一次歌曲生成任务。

### 11.1 Windows PowerShell

输入：

```powershell
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/api/create_precheck" | ConvertTo-Json -Depth 10
```

### 11.2 macOS 终端

输入：

```bash
curl -sS -X POST http://127.0.0.1:3000/api/create_precheck
```

### 11.3 如何看结果

如果看到：

```json
{
  "required": false,
  "ready_for_create": true
}
```

表示 Suno 当前没有要求验证码。

如果看到：

```json
{
  "required": true,
  "captcha_provider": "turnstile",
  "ready_for_create": false
}
```

表示当前 Create 进入验证码分支。这个诊断接口只报告状态，不会提前解题。真正的 Create 请求会在同一个 API 实例中尝试解题并立即提交。

如果是 hCaptcha 图片挑战，可能需要在已登录的 Suno 浏览器中手动完成一次验证，再重新尝试。Suno 的验证策略会变化，不能保证一次人工验证可以维持多久。

---

## 十二、可选：提交一次真正的歌曲生成测试

> 这一节会真实调用 Suno，并可能消耗账号额度。

第一次测试建议：

- 生成纯音乐；
- 不手动指定模型，让 API 使用当前默认值；
- 只提交一次；
- 等待返回结果；
- 不要因为终端暂时没有输出就连续重复提交。

### 12.1 Windows PowerShell

先输入：

```powershell
$body = @{
  prompt = "A short bright instrumental theme with piano, strings and gentle drums"
  make_instrumental = $true
  wait_audio = $true
} | ConvertTo-Json
```

再输入：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/api/generate" `
  -ContentType "application/json" `
  -Body $body | ConvertTo-Json -Depth 20
```

### 12.2 macOS 终端

输入：

```bash
curl -X POST http://127.0.0.1:3000/api/generate \
  -H 'Content-Type: application/json' \
  -d '{
    "prompt": "A short bright instrumental theme with piano, strings and gentle drums",
    "make_instrumental": true,
    "wait_audio": true
  }'
```

### 12.3 成功标准

Create 的最终成功标准是返回结果中出现非空的歌曲 clip ID。

如果已经拿到 clip ID，后续轮询或下载失败时，应继续查询这些已有 ID，不要直接再次 Create，否则可能重复消耗额度。

查询一个 clip：

```text
http://127.0.0.1:3000/api/clip?id=把_CLIP_ID_放在这里
```

### 12.4 为什么第一次测试不指定模型

Suno 可用模型会随账号权限和官方更新发生变化。

项目允许请求中传入 `model` 字符串，但模型名称属于上游观察值，不是长期不变的官方契约。

第一次只测试部署是否可用时，省略 `model` 最稳妥。确认基础流程正常后，再根据项目 README 和你的账号实际可用模型指定版本。

---

## 十三、让本机 Agent 调用

只要 Agent 与 Suno API 运行在同一台电脑，就可以把下面信息交给 Agent：

```text
本机 Suno API Base URL:
http://127.0.0.1:3000

接口说明:
http://127.0.0.1:3000/docs

调用前先用 GET /api/get_limit 检查登录状态。
Create 拿到 clip ID 后必须保存 ID；后续失败优先轮询已有 ID，不要盲目重复 Create。
```

不要把 `.env` 文件或 Suno Cookie 交给不可信 Agent。

不要为了让远程 Agent 访问而直接把：

```text
SUNO_API_BIND=127.0.0.1
```

改成：

```text
SUNO_API_BIND=0.0.0.0
```

项目本身没有为公开互联网暴露场景提供完整的登录认证、TLS、限流和访问控制。新手应保持只允许本机访问。

---

## 十四、可选：下载自己账号中的歌曲

Docker 部署后，可以调用已经运行的：

```text
POST /api/archive_account
```

来执行曲库归档，不需要另外安装 Node.js。

### 14.1 先做 5 首歌曲的只读预检

#### Windows PowerShell

先输入：

```powershell
$archiveBody = @{
  dry_run = $true
  target_complete = 5
  output_dir = "/app/output/archive-preflight"
} | ConvertTo-Json
```

再输入：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/api/archive_account" `
  -ContentType "application/json" `
  -Body $archiveBody | ConvertTo-Json -Depth 20
```

#### macOS 终端

```bash
curl -X POST http://127.0.0.1:3000/api/archive_account \
  -H 'Content-Type: application/json' \
  -d '{
    "dry_run": true,
    "target_complete": 5,
    "output_dir": "/app/output/archive-preflight"
  }'
```

这一步会列出歌曲并写入归档记录，但不会下载音频。

### 14.2 测试下载 5 首完整歌曲

#### Windows PowerShell

```powershell
$archiveBody = @{
  target_complete = 5
  output_dir = "/app/output/archive-test5"
} | ConvertTo-Json
```

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/api/archive_account" `
  -ContentType "application/json" `
  -Body $archiveBody | ConvertTo-Json -Depth 20
```

#### macOS 终端

```bash
curl -X POST http://127.0.0.1:3000/api/archive_account \
  -H 'Content-Type: application/json' \
  -d '{
    "target_complete": 5,
    "output_dir": "/app/output/archive-test5"
  }'
```

默认会尝试下载 MP3 和 WAV。

WAV 可能需要先触发 Suno 后台转换，再轮询等待 WAV 准备完成，因此通常比 MP3 慢。

### 14.3 下载整个账号曲库

确认 5 首测试正常后再执行。

#### Windows PowerShell

```powershell
$archiveBody = @{
  output_dir = "/app/output/suno-account-archive"
} | ConvertTo-Json
```

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:3000/api/archive_account" `
  -ContentType "application/json" `
  -Body $archiveBody | ConvertTo-Json -Depth 20
```

#### macOS 终端

```bash
curl -X POST http://127.0.0.1:3000/api/archive_account \
  -H 'Content-Type: application/json' \
  -d '{
    "output_dir": "/app/output/suno-account-archive"
  }'
```

请求 JSON 中不填写 `limit` 或 `target_complete` 字段时，会继续扫描到账号曲库列表末尾，但仍受安全页数上限保护。

完整曲库可能运行很久。请保持 Docker Desktop 运行，不要关闭终端或让电脑进入深度睡眠。即使终端连接中断，也不要立即重复提交；先查看下面的归档状态。

在浏览器打开：

```text
http://127.0.0.1:3000/api/archive_account?output_dir=/app/output/suno-account-archive
```

这个只读接口会显示该输出目录当前保存的状态。

下载结果会出现在项目文件夹的：

```text
output/suno-account-archive
```

其中包括：

```text
manifest.json
runs/
clips/
```

`manifest.json` 是长期归档记录。以后再次执行相同命令时，默认会跳过已经存在并通过检查的文件，只处理新增或缺失内容。

只有明确想重新下载已有文件时，才在请求 JSON 中增加：

```json
{
  "skip_existing": false
}
```

不要同时运行两个指向同一个输出文件夹的归档任务。

---

## 十五、日常停止、启动和查看日志

以下命令都要在项目文件夹中执行。

### 查看当前状态

```bash
docker compose ps
```

### 停止服务

```bash
docker compose stop
```

这不会删除下载文件。

### 再次启动

```bash
docker compose start
```

### 重启

```bash
docker compose restart
```

### 修改 `.env` 后重新创建容器

```bash
docker compose up -d --force-recreate
```

### 查看最近 100 行日志

```bash
docker compose logs --tail=100 suno-api
```

### 持续查看日志

```bash
docker compose logs -f suno-api
```

按：

```text
Ctrl + C
```

可以退出日志查看，不会停止 API。

### 删除容器但保留本地文件

```bash
docker compose down
```

项目的 `output` 和 `studio-state` 文件夹仍会保留。

不要随意使用带 `-v` 的删除命令，也不要随意删除 `output`、`studio-state`、`manifest.json` 或任务进行中的 `.part` 文件。

---

## 十六、以后如何升级项目

使用 ZIP 部署的新手，可以这样升级。

### 第 1 步：停止旧版本

在旧项目文件夹执行：

```bash
docker compose down
```

### 第 2 步：备份私人数据

至少保留：

```text
.env
output
studio-state
```

不要把 `.env` 上传到网盘公开链接。

### 第 3 步：重新下载最新版 ZIP

从 GitHub 项目页面重新选择：

```text
Code > Download ZIP
```

解压到一个新的文件夹。

### 第 4 步：迁移本机配置和数据

把旧项目中的以下内容移动或复制到新项目对应位置：

```text
.env
output
studio-state
```

如果新版 `.env.example` 增加了配置项，建议先比较新版模板，再把自己的私人配置填写到新的 `.env` 中。

### 第 5 步：重新构建

在新项目文件夹执行：

```bash
docker compose up -d --build
```

然后重新检查：

```text
http://127.0.0.1:3000/docs
```

```text
http://127.0.0.1:3000/api/get_limit
```

---

## 十七、常见问题排查

### 问题 1：提示找不到 `docker`

常见信息：

```text
docker: command not found
```

或：

```text
docker 不是内部或外部命令
```

处理方法：

1. 确认 Docker Desktop 已安装；
2. 完全退出并重新打开 PowerShell 或终端；
3. 启动 Docker Desktop；
4. 再执行 `docker --version`。

### 问题 2：提示无法连接 Docker daemon

常见原因是 Docker Desktop 没有启动完成。

先打开 Docker Desktop，等它显示 Engine running，再执行启动命令。

### 问题 3：`docker compose up` 下载或构建失败

如果错误中出现：

```text
timeout
TLS handshake timeout
failed to fetch
npm install
node:lts-bookworm
```

通常是 Docker 下载镜像或依赖时的网络问题。

处理顺序：

1. 确认浏览器可以访问 GitHub 和 Docker Hub；
2. 在 Docker Desktop 设置中检查 Proxies；
3. 如果使用代理软件，让 Docker Desktop 使用正确的 HTTP/HTTPS 代理；
4. 重新执行：

```bash
docker compose up -d --build
```

`.env` 中的 `DOCKER_HTTP_PROXY` 主要用于已经启动的容器访问外网，不一定能解决镜像拉取和构建阶段的问题。构建阶段优先检查 Docker Desktop 自己的代理设置。

### 问题 4：容器启动了，但访问不了 3000 端口

先执行：

```bash
docker compose ps
```

再查看日志：

```bash
docker compose logs --tail=100 suno-api
```

如果电脑上的 3000 端口已经被其他程序占用，在 `.env` 中把：

```text
SUNO_API_PORT=3000
```

改成：

```text
SUNO_API_PORT=3001
```

保存后执行：

```bash
docker compose up -d --force-recreate
```

新的访问地址是：

```text
http://127.0.0.1:3001/docs
```

后续所有示例中的 `3000` 也要相应改成 `3001`。

### 问题 5：文档页正常，但额度接口报错

这说明本地程序已经启动，问题集中在：

- Cookie 不完整；
- Cookie 已过期；
- 复制了错误请求的 Cookie；
- `.env` 没有保存；
- 容器没有在修改 `.env` 后重新创建；
- 容器无法访问 Suno 或 Clerk。

重新获取 Cookie 后，执行：

```bash
docker compose up -d --force-recreate
```

### 问题 6：Cookie 中有 `$`

使用英文单引号包住完整 Cookie：

```text
SUNO_COOKIE='完整 Cookie'
```

这种写法会把 `$` 按原样传入容器，不需要改动 Cookie 内容。

如果 Docker Compose 仍然报告变量插值错误，请检查：

1. 两端是否真的是英文半角单引号 `'`；
2. 是否漏掉了末尾单引号；
3. 是否误用了中文弯引号 `‘’`；
4. Cookie 是否被粘贴成了多行。

不要因此把 Cookie 发给别人检查。

### 问题 7：容器访问 Suno 需要本机代理

假设你的代理软件提供 HTTP 或 mixed 端口 `7890`，可以在 `.env` 中填写：

```text
DOCKER_HTTP_PROXY=http://host.docker.internal:7890
DOCKER_HTTPS_PROXY=http://host.docker.internal:7890
```

端口 `7890` 只是示例，必须换成你自己的实际端口。

容器里的 `127.0.0.1` 指向容器自己，不是宿主电脑，所以不要写：

```text
DOCKER_HTTP_PROXY=http://127.0.0.1:7890
```

部分代理软件还需要允许来自 Docker 虚拟环境的连接。只开放必要范围，不要把本地代理直接暴露到公网。

修改后执行：

```bash
docker compose up -d --force-recreate
```

### 问题 8：Create 提示没有配置 2Captcha

常见错误：

```text
CAPTCHA_SOLVE_FAILED: 2Captcha API key not configured
```

表示 Suno 当前要求验证码，但 `.env` 中没有有效的：

```text
TWOCAPTCHA_API_KEY
```

配置并保存后，重新创建容器。

### 问题 9：提示 `BROWSER_CAPTCHA_REQUIRED`

这不是 Docker 安装失败。

它表示 Suno 当前要求在同一浏览器环境中完成图片 hCaptcha，而本地纯 HTTP Create 流程不能把一次独立解题安全地冒充成同一浏览器上下文。

可以尝试：

1. 在 Chrome 中登录同一个 Suno 账号；
2. 在 Suno Create 页面手动完成一次验证码；
3. 再重新调用 API；
4. 如果仍然失败，保留返回内容和脱敏日志，等待适配当前 Suno 验证策略。

不要公开 Cookie、验证码 token 或完整请求头。

### 问题 10：2Captcha 显示解题完成，但没有歌曲

“解题完成”只是中间状态。

真正成功必须同时满足：

- Suno 接受 Create；
- 返回非空 clip ID。

如果请求已经返回 clip ID，后续只轮询这些 ID。

如果没有 clip ID，查看：

```bash
docker compose logs --tail=200 suno-api
```

分享日志前必须检查并遮盖账号、项目、歌曲和凭证相关私人信息。

### 问题 11：生成模型报错

第一次测试请不要传 `model`。

模型可用性由 Suno 当前服务和账号权限控制。某个模型字符串曾经可用，不代表以后仍然可用，也不代表所有账号都能使用。

### 问题 12：下载 WAV 比 MP3 慢

这是正常情况之一。

MP3 通常可以直接从歌曲媒体地址下载。WAV 可能需要：

1. 请求 Suno 准备或转换 WAV；
2. 轮询处理状态；
3. 等 `wav_file_url` 准备完成；
4. 再开始下载。

归档中某一首 WAV 暂时失败，不会抹掉已经成功下载的 MP3。以后重新执行相同归档命令，会继续处理缺失项目。

---

## 十八、部署完成后的安全检查

请逐项确认：

- [ ] `.env` 没有发给任何人；
- [ ] Cookie 没有出现在截图、帖子或聊天记录中；
- [ ] `TWOCAPTCHA_API_KEY` 没有公开；
- [ ] API 仍然绑定 `127.0.0.1`；
- [ ] 没有把 3000 端口直接映射到公网；
- [ ] 只使用自己的 Suno 账号；
- [ ] 只上传和处理自己有权使用的音频；
- [ ] Create 拿到 clip ID 后会保存 ID，不盲目重复提交；
- [ ] `output` 和 `manifest.json` 被视为私人曲库资料；
- [ ] 分享日志前已经检查并移除私人数据。

如果 Cookie 意外泄露，应立即终止相关登录会话，并重新登录 Suno 获取新的 Cookie。

---

## 十九、最常用命令速查

所有命令都在项目文件夹中执行。

### 第一次构建并启动

```bash
docker compose up -d --build
```

### 查看状态

```bash
docker compose ps
```

### 查看日志

```bash
docker compose logs --tail=100 suno-api
```

### 停止

```bash
docker compose stop
```

### 启动

```bash
docker compose start
```

### 重启

```bash
docker compose restart
```

### 修改 `.env` 后应用配置

```bash
docker compose up -d --force-recreate
```

### 重新编译最新版代码

```bash
docker compose up -d --build
```

### 本地文档

```text
http://127.0.0.1:3000/docs
```

### 检查额度

```text
http://127.0.0.1:3000/api/get_limit
```

### 下载整个账号曲库

```text
POST http://127.0.0.1:3000/api/archive_account

JSON:
{"output_dir":"/app/output/suno-account-archive"}
```

---

## 二十、判断是否真正部署成功

同时满足下面四项，才算完成了基础部署：

1. `docker compose ps` 显示 `suno-api` 正在运行并最终健康；
2. `http://127.0.0.1:3000/docs` 可以打开；
3. `http://127.0.0.1:3000/api/get_limit` 返回自己账号的额度信息；
4. 日志中没有持续重复出现的认证或网络错误。

Create 属于下一层验收。它还会受到账号额度、模型权限和 Suno 当前验证码策略影响。基础部署成功，不等于每一次上游 Create 都一定不会遇到验证或服务变化。
