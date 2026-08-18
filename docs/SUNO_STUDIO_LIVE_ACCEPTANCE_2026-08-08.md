# Suno Studio API 真实验收记录

**日期：** 2026-08-08
**服务：** Suno API Finder / `suno-api-final`
**实现原则：** 直接 HTTP API 为主；CLI 只作本地薄封装和路由验收。
**授权范围：** 用户明确授权真实创建提交和 Credits 消耗。
**保密范围：** 本文不记录 Cookie、API Token、Studio Token、Clip ID、Project ID、媒体 URL、完整 state 或原始响应。

## 1. 结论

本轮已验证：

- Instrument 真实创建成功。
- Cover 真实创建成功。
- Full Song Export 成功保存到 Suno Library。
- Selected Time Range Export 成功保存到 Suno Library。
- Multitrack ZIP 成功生成、下载、原子落盘并通过完整性检查。
- 正式生产镜像已切换到包含兼容修复的版本。
- 正式生产付费生成和未验证写入开关已恢复关闭。

唯一明确的业务差异是：虽然 Instrument/Cover 生成本身成功，4 个新 Clip 均未观察到自动插入指定的新建 Studio Project。

## 2. 测试隔离

- 使用独立候选容器和独立 state。
- 真实请求走候选容器的 `/api/studio/*`，未使用 CLI 直接连接 Suno。
- Instrument 与 Cover 使用不同的唯一幂等键。
- 相同幂等键没有再次 POST；状态恢复只允许读取账本和轮询。
- 测试结束后停止并删除隔离容器。
- 测试 Token、payload、原始响应和临时 state 已删除。

## 3. Credits

| 阶段 | Credits |
|---|---:|
| 测试前 | 7781 |
| Instrument 后 | 7777 |
| Cover 后 / 全部测试结束 | 7773 |

Instrument 消耗 4，Cover 消耗 4，真实付费生成合计消耗 8 Credits。

## 4. Instrument

| 项目 | 结果 |
|---|---|
| HTTP | 200 |
| `new_submission` | `true` |
| 最终账本状态 | `complete` |
| Clip 数 | 2 |
| Clip 终态 | 2/2 `complete` |
| Credits | 7781 → 7777 |
| Studio Project 自动插入观察 | 2/2 `false` |

没有重放相同幂等键。

## 5. Cover

| 项目 | 结果 |
|---|---|
| HTTP | 200 |
| `new_submission` | `true` |
| 最终账本状态 | `complete` |
| Clip 数 | 2 |
| Clip 终态 | 2/2 `complete` |
| Credits | 7777 → 7773 |
| Studio Project 自动插入观察 | 2/2 `false` |

没有重放相同幂等键。

## 6. Export

### 6.1 Full Song

- HTTP 200。
- `mode=full_song`。
- 最终 Library Clip 为 `complete`。
- 音频 URL 存在。
- 语义为“渲染并保存到 Suno Library”，不声称本地下载。

首次兼容测试表明当前上游即使在 Full Song 模式也要求 `start_beats/end_beats`。正式实现已从 Studio state 自动推导时间线边界，再提交 `render-state`。

### 6.2 Selected Time Range

- HTTP 200。
- `mode=selected_time_range`。
- 最终 Library Clip 为 `complete`。
- 音频 URL 存在。
- 语义同样是保存到 Suno Library。

上游初始 render job 字段可能仍为 `queued`；验收以轮询得到的最终 `clip.status=complete` 为准。

## 7. Multitrack

| 项目 | 结果 |
|---|---|
| HTTP | 200 |
| `reused` | `false` |
| `upstream_submitted` | `true` |
| 文件大小 | 52,244,220 bytes |
| SHA-256 | 已生成，长度和文件复算有效 |
| ZIP 检查 | `pass` |
| WAV 数量 | 14 |
| `.part-*` 残留 | 0 |
| 锁残留 | 0 |

代表 WAV：

| 项目 | 值 |
|---|---|
| Container | WAV |
| Codec | PCM 32-bit float |
| Sample rate | 48,000 Hz |
| Channels | 2 |
| Duration | 约 43 秒 |

兼容修复：

1. 当前 Multitrack 上游请求需要 `title`；服务现在提供标题并将其纳入请求指纹。
2. SMB 输出目录可能产生 `.smbdelete*`，导致锁目录短暂不能删除。服务现在执行有界重试；若业务结果已经成功，只降级告警，不再返回误导性的 HTTP 500。

## 8. 正式部署

| 项目 | 值 |
|---|---|
| 服务 | `suno-api` |
| 地址 | `127.0.0.1:3000` |
| 当前镜像 | `sha256:6d018666785626c6a525be0ccfb786f23fa5b877bc37f46e865ebfe65ea8d2e3` |
| 当前镜像 tag | `suno-api-final:studio-livefix-20260808-205426` |
| 回滚镜像 | `sha256:fdad48ec380e5ffc01bba6e7f35134fe4d31ba2aae544e1eb339590cfffa8548` |
| 回滚 tag | `suno-api-final:pre-studio-livefix-20260808-2139` |
| 回滚 `.next` | `.next.before-studio-livefix-20260808-2139` |

部署后：

- 容器 `running|healthy`。
- `/api/get_limit` 为 HTTP 200，Credits 为 7773。
- `/api/studio/projects` 为 HTTP 200，返回 20 个工程。
- 工程详情为 HTTP 200。
- `/api/studio/unverified_actions` 为 HTTP 200，15 个动作保持 `not_forwarded`。
- CLI `doctor --live` 为 7/7。
- CLI `projects` 和 `unverified_actions` 薄封装读取成功。

## 9. 正式安全状态

```text
SUNO_STUDIO_ENABLE_PAID_GENERATION=0
SUNO_STUDIO_ENABLE_UNVERIFIED_WRITES=0
SUNO_STUDIO_PAID_API_TOKEN 为空
```

关闭闸门验证：

- 新幂等键的 Generate 请求返回 HTTP 403，明确表示没有发送上游请求。
- Export 空请求返回 HTTP 400，在本地参数校验阶段停止。
- Multitrack 空请求返回 HTTP 400，在本地参数校验阶段停止。

## 10. 证据与清理

保留的无敏感材料：

`/Volumes/素材/TEMP/chu/SunoStudioExports/acceptance-20260808-205426`

其中包含：

- 验证后的 Multitrack ZIP。
- `ACCEPTANCE.md`。
- `acceptance-summary.json`。

已清理：

- 隔离容器。
- 临时 Token。
- 测试 payload。
- 原始响应。
- 完整 Studio state。
- 本地临时锁和代表性解压文件。

## 11. 后续运维要求

1. 日常生产保持两个写开关为 `0`。
2. 再次授权付费生成时必须使用新的业务幂等键。
3. 未知提交状态只能恢复/轮询，不能自动再次 POST。
4. 不把“生成完成”解释为“自动插入 Studio Project 已完成”；必须单独检查工程状态。
5. Multitrack 首先复用已通过完整性验证的相同指纹 ZIP，除非明确要求 `force_render=true`。
6. 不使用 `git reset --hard`、`git restore .` 或 `docker compose down -v` 处理回滚。
