# API 播放归档更新与使用注意事项

更新日期：2026-09-07。本文记录本次会话已完成的源码、测试和部署变更，不以镜像标签中的日期代替实际更新日期。

## 本次修改

- 账户归档 `/api/archive_account`、CLI `npm run download:account` 的 MP3/WAV 均切换为播放媒体。
- `customGenerateAndDownload()` 内部方法也使用播放转码；公开 `/api/custom_generate` 仍仅创建、等待并返回元数据，不自动落盘，传入 download_mp3/download_wav 不会启用下载。
- 选择 `media_urls` 的 progressive HTTPS 来源，遵守允许域名；当前支持加密 encoding=1.0.0，无支持来源或未知编码时失败，不回退到 audio_url。
- 加密媒体请求 `/api/mango/rights`，以 JWT 派生用户密钥，AES-GCM 解包内容密钥和 IV，再通过 AES-CTR 解密。无需浏览器点击或录音。
- 不调用 `/api/billing/clips/<id>/download/`、`convert_wav`、`wav_file`；避免通过这些官方接口消耗下载点数，不承诺 Suno 未来计费规则不变。
- 本地 FFmpeg 转 MP3（libmp3lame）/ WAV（PCM s16le）；临时输入输出分别命名，转换后校验再原子替换。
- manifest 和单曲 metadata 保存 mp3_source/wav_source=suno_playback_audio；仅复用校验通过且有此标记的文件，旧无标记文件会重新获取，不会自动被当作播放来源。

## 使用与恢复

先执行 `npm run download:account -- --dry-run --limit 5` 检查扫描范围；实际归档执行 `npm run download:account -- --limit 5`。默认格式为 MP3/WAV，默认并发 1；持续归档应保留 manifest 和相同输出目录。不要把 limit 解释为已扫描完整账户。

单曲使用 `GET http://127.0.0.1:3000/api/playback_audio?id=<clip-id>`。该接口返回原播放容器，通常为 M4A/Opus；根据 Content-Type / X-Suno-Playback-File-Extension 保存，不能仅改后缀充当 MP3。需要 MP3/WAV 时用 FFmpeg 本地转换。WAV 是播放源解码后的 PCM，不是原始无损母带，转码不会恢复播放源已丢失的信息。

需要有效 Suno 会话、可访问的媒体/CDN、FFmpeg；建议安装 ffprobe 检查音频。失败会记录到归档结果，后续运行重试缺失格式，不重新生成歌曲。播放音频下载/解密/转码中断后重新开始该格式，不支持加密流 HTTP Range 拼接；封面与分轨 ZIP 保留各自断点逻辑。旧 WAV 轮询参数为兼容保留，对播放转码无效。不要擅自删除活跃归档锁。

Song Auto split 和 Studio Multitrack 是专用分轨/工程渲染导出，不通过普通播放流生成；其 render、ZIP、复用和可能的费用规则仍按专用契约。上传接口的 audio_url 是输入来源，未被此次移除。

## 使用限制与凭证

本项目限制播放归档文件仅供个人非商业使用，不得用于 Spotify 上架或短视频盈利。本工具不提供或验证商用授权，也不产生官方 Download 交易。Suno 官方说明今后下载的新歌曲附加 C2PA 来源凭证；本工具解密、转码播放源不生成或保证保留该凭证。C2PA 表达来源而非版权归属，缺少凭证本身不能证明没有版权。官方凭证页面没有说明“扣下载额度才获得商用授权”，实际授权以适用条款和账户权益为准。

官方查验渠道：https://suno.com/suno-credentials

## 本次验证与部署记录

三套源码（9 月 4 日备份、生产工作树、公开版）每套归档 6 项、播放 4 项测试和 TypeScript 检查通过。归档测试使用合成音频与真实 FFmpeg/ffprobe，覆盖 MP3/WAV、来源复用、旧文件迁移及失败不回退。公开构建、Docker 构建通过；生产 get_limit 正常、health healthy，构建包含播放归档且无旧 billing Download / convert_wav 调用。未在本次迁移执行真实账户全量下载或下载额度扣减实验；单元测试不等同真实 Mango 联网验收。

公开版 Docker 使用镜像内置 `.next` 构建产物；不要把宿主机旧 `.next` 挂载覆盖镜像。运行时请保留自己的会话环境和本地输出挂载。

公开版已推送提交 62ffb0759e634683193a6efc179c6d5178c890f9。公开仓库中的源码、文档和测试以 Git 提交为准；重新部署时从源码构建镜像并检查健康状态和播放归档，不要复用旧 `.next`。
