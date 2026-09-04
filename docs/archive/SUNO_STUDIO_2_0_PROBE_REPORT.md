# Suno Studio 2.0 探测报告

日期：2026-08-18
范围：Suno Studio 2.0 工程状态、clip 参数、媒体分析视图、运行时 transport 边界

## 结论先行

这轮探测已经确认：Suno Studio 2.0 的信息面不是单一的“歌曲对象”，而是由几层结构叠起来的：

1. 工程级 state，负责 timing、loop、selection、layout、library 面板等；
2. track 级结构，负责轨道类型、插件链、EQ、fader、arm/mute/solo；
3. clip 级结构，负责 clipId、asset、beats 区间、warp、fade、transposition、streaming 等；
4. 媒体分析层，负责 waveform、downbeats、MIDI、aligned lyrics、novelty、stems pages；
5. 运行时 transport 层，负责 play / pause / stop / seek / status，但前提是浏览器里已经加载了一个 Studio 页面。

目前已经能把“工程状态”和“clip 参数”拆开看清楚，但还不能把所有 clip 类型一次性统一成 AAF 级的交换格式；那还需要额外的导出映射层。

补一句更细的结论：这次还看到了 take-lane / version 级别的编辑元数据，说明 2.0 不只是“轨道 + clip”，还带有很明显的候选版本管理。
另外，本轮采样到的 `aligned_lyrics` 要么是空数组，要么只返回 `state`，没有找到非空的逐字对齐样本，所以不能把“逐字歌词已普遍可用”写进结论里。

## 本次使用的探测入口

- `scripts/studio-opencli.mjs doctor --live`
- `scripts/studio-opencli.mjs projects`
- `scripts/studio-opencli.mjs project <studioProjectId>`
- `scripts/studio-opencli.mjs versions <studioProjectId>`
- `scripts/studio-opencli.mjs version <studioProjectId> <versionId>`
- `scripts/studio-opencli.mjs media <clipId> <kind>`
- `scripts/studio-opencli.mjs transport-status`

## 扩展采样：更复杂的 Studio 2.0 工程

除了 `test video player` 这类双轨样本，本轮还补了一份更接近真实编排场景的 2.0 工程：

- Project ID: `3f187ce7-a930-4fe4-968e-949ed9753373`
- Title: `41 0440 sc`
- major_version: `2`
- trackCount: `15`
- timing: `manual`
- bps: `1.9833333333333334`
- lockBPS: `true`

这份工程最重要的不是“又多了一些轨道”，而是它把 2.0 的编辑层次暴露得更完整了：

- 主轨 `clip` 和 `takeLanes` 同时存在；
- 轨道里既有 `generatedInPlace` 的候选片段，也有主安排中的片段；
- `ratingBaseline` 记录了版本候选的基线；
- `dismissed` 表示版本候选是否在界面上被折叠/隐藏；
- `awaitingContentAlignment` 在样本中均为 `false`，说明这些候选都已进入可读状态；
- 同一个 `clipId` 可以在主轨和不同版本 lane 中复用，说明 `clipId` 更像音频资产 ID，外层 `clip.id` 才是轨道实例 ID。

这份工程里最典型的轨道族包括：

- `Woodwinds` / `Brass` / `Strings` / `Percussion` / `Keyboard` / `Guitar` / `Bass` / `Drums`
- `Backing_Vocals`
- `Vocals`
- `FX`
- `midi`

其中 `Woodwinds`、`FX`、`Vocals` 都能看到多个 take lane 版本，这对后续做导出映射非常关键：它说明 2.0 的“版本”已经不是简单历史记录，而是可以恢复成可比较、可筛选的安排分支。

## 运行时 transport 边界

本机 Suno API 服务是在线的，`doctor --live` 的路由检查通过。

但是 `transport-status` 在没有已加载 Studio 页面的情况下返回：

- HTTP 503
- `No loaded Suno Studio page was found; open a Studio project in the managed browser`

这说明 transport 层不是“API坏了”，而是明确依赖于一个已经打开并加载完成的 Studio 页面。

本次检查到的浏览器侧状态也与这个结论一致：

- 当前 in-app browser 中没有任何打开的 tab；
- 也没有找到可直接接手的已加载 Studio 页面；
- 代码里的默认识别前缀是 `https://suno.com/studio`，所以 transport 只会认这类页面。

换句话说，这轮探测能把工程状态、clip 参数、媒体分析层看清楚，但运行时 transport 还必须等到真正的 Studio 页面在线后才能继续补证据。

### 真实运行时验证

这次补到了一条真正加载完成的 `Suno Studio` 页面，transport 终于不再停留在 503 边界：

- 页面地址：`https://suno.com/studio?initial_project_id=c3e1100c-9340-430f-9a54-ea1d60130c3d`
- `browser_source`: `openclaw_managed`
- `protocol`: `dsp_v2`
- `source`: `studio_page_dsp_v2`
- `tempo_bpm`: `28.125`
- `timeline_present`: `true`

关键的实时状态读数：

- 初始 `transport-status`：
  - `playing: false`
  - `position_beats: 544`
  - `position_seconds: 255.18375906609006`
  - `song_start_seconds: -0.18375906609005566`

实际控制验证：

- `transport-play`
  - `changed: true`
  - `playing: false -> true`
  - `position_seconds` 有明显推进
- `transport-pause`
  - `changed: true`
  - `playing: true -> false`
- `transport-seek-seconds 12.5`
  - 成功落点：`position_seconds: 12.5`
  - 对应 `position_beats: 26.274647325674547`
- `transport-seek-seconds 0`
  - 成功落点：`position_seconds: 0`
  - 对应 `position_beats: -0.3920193409921187`

`transport-stop` 则表现出一个值得单独跟进的异常：

- 它在当前样本上返回 HTTP 409
- 错误原文：`Studio did not stop at 0 seconds`
- 这说明 stop 的验收条件比“seek 到 0 beats”更严格，实际在 `song_start_seconds` 有负偏移时更容易撞上边界
- 在这轮实测里，stop 没有稳定地把页面维持在“可通过 stop 验收”的静止态，因此后续还需要单独再挖一次 stop 的 DSP v2 细节

为了把现场恢复干净，后面又补了一次 `transport-pause`，把页面重新放回了 `playing: false`。

## 采样工程

### 采样 1：Studio 2.0 工程

- Project ID: `c3e1100c-9340-430f-9a54-ea1d60130c3d`
- Title: `test video player`
- major_version: `2`
- latest version: `96607945-fc7e-40ee-a748-c007042d3e13`

### 采样 2：Studio 1.x 对照工程

- Project ID: `8fc45839-f435-4ab4-aa4f-7081511b1f2e`
- Title: `41 1020 sc2`
- major_version: `1`

## Studio 2.0 工程 state 观察

`test video player` 这份 2.0 工程里，能够直接看到以下结构：

| 层级 | 观察到的关键字段 | 含义 |
|---|---|---|
| project | `majorVersion` | 2.0 工程标识 |
| project | `timing` | 手动 timing，支持浮点 BPS |
| project | `loop` | 工程循环区间 |
| project | `metronome` | 节拍器开关与幅度 |
| project | `timeSignatureChanges` | 拍号变化 |
| project | `midiCcMappings` | MIDI 控制映射 |
| project | `masterSignalChain` | 母线效果链 |
| project | `lyricsCorrectionsByClipId` | 按 clip 绑定的歌词修正 |
| project | `midiControllerSignalChain` | MIDI 控制器效果链 |
| project | `markersRegistry` | warp / beat 对应关系索引 |
| project | `libraryPanelState` | 侧边库面板状态 |
| project | `sections` | section 分段 |
| project | `tracks` | 轨道列表 |
| project | `layout` | 编辑器布局 |
| project | `selection` | 当前选择范围 |
| project | `editorPointerModes` | 音频 / MIDI 指针模式 |

### timing 细节

采样到的 2.0 工程 timing 是：

```json
{
  "type": "manual",
  "bps": 2.1333333333333333,
  "lockBPS": true,
  "bpsAutomation": []
}
```

这说明 2.0 的核心不是固定 BPM 近似，而是可以直接使用浮点 BPS 来驱动时间线。

### selection 细节

同一工程里，selection 既能指向轨道，也能指向 timeline。
本次样本里曾看到：

- `focusedArea: "tracks"`
- `focusedArea: "timeline"`

说明 selection 更像 UI / 编辑焦点状态，不是 clip 本身的属性。

## 轨道与 clip 参数观察

采样 2.0 工程中有 2 条轨道：

1. `Audio Track`
2. `MIDI Track`

### 轨道级共同字段

轨道上能稳定看到：

- `id`
- `name`
- `type`
- `color`
- `mute`
- `solo`
- `arm`
- `amplitude`
- `balance`
- `routingMode`
- `height`
- `eq`
- `faderAutomation`
- `takeLanes`
- `clipCreationIntents`
- `signalChain`

### clip 级共同字段

音频 clip 里能看到这些字段：

- `id`
- `clipId`
- `asset.id`
- `name`
- `startBeats`
- `endBeats`
- `readStartBeats`
- `mute`
- `amplitude`
- `fadeInBeats`
- `fadeOutBeats`
- `fadeInCurve`
- `fadeOutCurve`
- `transposition`
- `formantCorrection`
- `streaming`
- `reversed`
- `loop`
- `warp.enabled`
- `warp.markersHash`
- `generatedInPlace`
- `awaitingContentAlignment`
- `ratingBaseline`（在 take lane / version 里出现）
- `dismissed`（在 take lane / version 里出现）

这里有一个更准确的关系要单独写出来：

- `clip.id` 是轨道里这一条实例的 ID；
- `clipId` / `asset.id` 是可复用的音频资产 ID；
- 同一个 `clipId` 可以出现在主轨和多个 take lane 里；
- `startBeats`、`endBeats`、`readStartBeats` 决定这个实例在工程里的落点与读取窗口；
- `loop` 是实例自身的循环包络，不等于项目级 loop；
- `warp.markersHash` 把 clip 绑定到工程的 `markersRegistry`，所以 warp 不是孤立字段。

### 具体 clip 样本

本次样本里的音频 clip：

- clip name: `Cfq 24 44m50s-46m50s`
- `clipId`: `1c611baa-4ae9-4927-a469-f2ea436032d4`
- `startBeats`: `-0.3920193409921187`
- `endBeats`: `506.1923217468473`
- `readStartBeats`: `-0.3920193409921187`

这里最值得注意的是：

- `startBeats` 和 `readStartBeats` 一致，说明该 clip 没有额外的读取偏移；
- 该 clip 允许负起点，说明它可以跨越工程零点；
- `warp.markersHash` 能与工程级 `markersRegistry` 对上；
- clip 自身也有 `loop`，但这是 clip 的包络，不等于项目级 loop。

### take lane / version 的参数关系

在 `41 0440 sc` 这份更复杂的工程里，take lane 里能看到比主轨更多的版本结构：

| 字段 | 作用 |
|---|---|
| `takeLanes` | 同一轨道下的候选版本分支 |
| `ratingBaseline` | 版本候选的基线信息，含 `arrangementId`、`startBeats`、`endBeats`、`contentStartSeconds` |
| `generatedInPlace` | 是否是在原位生成的候选片段 |
| `dismissed` | 该版本是否在界面上被折叠/隐藏 |
| `awaitingContentAlignment` | 是否还在等待内容对齐 |
| `clipId` 复用 | 同一个音频资产可跨主轨/版本 lane 重用 |

从这个样本里可以直接看出，2.0 的“版本管理”已经不是纯 UI 装饰，而是可被后续导出/比对逻辑利用的结构化数据。

## 媒体分析层观察

对同一个 clip `1c611baa-4ae9-4927-a469-f2ea436032d4`，媒体分析层返回了不同的视图。

### waveform

- 返回键：`waveform_aggregates`
- 采样到 12 个 mip 层级

这说明波形不是单一分辨率，而是多级金字塔结构。

### downbeats

返回键：

- `state`
- `downbeats`
- `raw_downbeats`
- `downbeat_presence_confidence`
- `onset_map`

观察结果：

- `downbeats` 数量：507
- `raw_downbeats` 数量：507
- `downbeat_presence_confidence`：`1`
- `onset_map`：是一个秒值到 beat 映射的对象

首尾样本：

- 开头：`[0.18296, 1]`
- 结尾：`[237.66898, 3]`

说明 downbeat 序列是“时间秒数 + 拍号位置”的组合表示。

### MIDI

返回键：

- `state`
- `instruments`

观察结果：

- `instruments` 数量：2
- 每个 instrument 包含 `notes`
- note 结构包含：
  - `pitch`
  - `start`
  - `end`
  - `velocity`
  - `is_drum`

这是一层真实的 MIDI 事件序列，不是单纯的静态标签。

### aligned_lyrics

返回键：

- `state`
- `alignment`

本次样本里做了 8 个 clip 的抽样检查：

- `1c611baa-4ae9-4927-a469-f2ea436032d4`：`alignment` 为数组，但长度是 0
- `e75c1389-d1b0-4a0a-952d-798177105e53`：`alignment` 为数组，但长度是 0
- `e745351e-d8a1-48cd-ac18-e797340f0465`：只返回 `state`
- `de502b2d-3ef3-45fd-bace-da5daea9e980`：只返回 `state`
- `d8f947d8-c81b-48a4-be9e-08439cd3f6b9`：只返回 `state`
- `a6f6b0bd-0b96-471d-8629-38c4a5fcafb6`：只返回 `state`
- `559a442e-1d73-4c38-acf0-c4f2f2542892`：只返回 `state`
- `f2df4a9a-31dd-4435-828d-05c0f5a2de75`：只返回 `state`

结论：这批样本里没有找到非空的逐字对齐结果。
也就是说，`aligned_lyrics` 是一条条件性很强的媒体视图，不能把“有这个端点”直接等同于“每个 clip 都有逐字歌词数据”。

### novelty

返回键：

- `state`
- `peak_times`
- `segment_labels`
- `duration_s`

观察结果：

- `duration_s`: `237.8`
- `peak_times` 数量：11
- `segment_labels` 数量：12

这很像结构分段视图：峰值用于分段，label 用于片段标注。

### stems_pages

返回键：

- `pages`

这说明 stems 页是独立分页结构，但不保证每个普通 song clip 都能直接当 stems 读。

### stems

对这个普通 clip 直接请求 `kind=stems` 时，返回：

- HTTP 400
- `Invalid page number.`

结论：`stems` 不是任意 clip 都能用的通用分析视图，至少对普通 song clip 有前置条件。

## Studio 1.x 对照

采样到的 v1 工程 `41 1020 sc2` 显示：

- `major_version: 1`
- `timing.type: "follow-track"`
- `fallbackBPS: 2.2`
- `trackId: "ae354e21-87dd-495c-91e4-f113288de9df"`
- `trackCount: 4`

### v1 / v2 的关键差别

| 项目 | v1 样本 | v2 样本 |
|---|---|---|
| timing | `follow-track` + `fallbackBPS` | `manual` + `bps` + `lockBPS` |
| 工程焦点 | 更像跟随轨道/旧式工程 | 更像直接控制的 2.0 工程 |
| state 形态 | 采样中可见 `metadata`、`styleSummary` | 采样中更偏 live arrangement / timing |
| 轨道数 | 4 | 2 |

这说明 2.0 不是简单“换皮”，而是时间线组织方式更直接、更适合做 transport / video sync。

## 同一工程不同版本的差异

对 `c3e1100c-9340-430f-9a54-ea1d60130c3d` 的两个相邻版本做了对比：

- `1704592e-90ae-4393-9dd2-5a2079fe291e`
- `96607945-fc7e-40ee-a748-c007042d3e13`

它们的核心音乐状态是一样的：

- `timing` 完全一致：`manual / bps=2.1333333333333333 / lockBPS=true`
- `trackCount` 都是 `2`

真正变化的是 UI / 焦点层：

| 字段 | 旧版本 | 新版本 |
|---|---|---|
| `selection.focusBeats` | `256` | `294.86370644522515` |
| `selection.focusedArea` | `timeline` | `tracks` |
| `selection.focusedTrackId` | `81ce0e98-e172-448b-8164-2023a0d0ddd3` | `7d4e3ae3-64fa-4527-b7b0-9e03a20d3145` |
| `contextualWindowConfig.mainPanel` | `arrangement-editor` | `{}` |

所以这类版本差异更像“编辑焦点 / 界面状态变化”，不是“音乐内容或 clip 结构变化”。

## clip 之间的参数关联

目前最清楚的关联是这几种：

1. `clipId` / `asset.id` / track clip 本体之间是同一个音频资产链路；
2. `startBeats`、`endBeats`、`readStartBeats` 决定 clip 在工程里的落点；
3. `warp.markersHash` 对应 `markersRegistry`；
4. `timing.bps` 决定 beats ↔ seconds 的换算；
5. `selection`、`contextualWindowConfig`、`libraryPanelState` 是 UI / 编辑状态，不应和 clip 内容混为一谈；
6. `downbeats`、`novelty`、`midi`、`aligned_lyrics` 是同一 clip 的不同分析视图。

### clip 参数速查表

| 字段 | 属于哪层 | 作用 |
|---|---|---|
| `clipId` | 资产层 | 可复用的音频资产 ID |
| `asset.id` | 资产层 | 与 `clipId` 共同指向同一音频素材 |
| `clip.id` | 实例层 | 工程里的具体轨道实例 |
| `startBeats` / `endBeats` | 工程实例层 | 片段在工程时间线中的起止位置 |
| `readStartBeats` | 工程实例层 | 读取窗口起点，和 `startBeats` 可能不同 |
| `loop.startBeats` / `loop.endBeats` | 实例包络层 | 片段循环包络 |
| `warp.enabled` | 变形层 | 是否启用 warp |
| `warp.markersHash` | 变形层 | 连接到工程 `markersRegistry` 的索引 |
| `generatedInPlace` | 版本层 | 是否是在原位生成的候选片段 |
| `awaitingContentAlignment` | 版本层 | 是否仍在等待内容对齐 |
| `ratingBaseline` | 版本层 | take lane 候选的基线信息 |
| `dismissed` | 版本层/UI 层 | 候选版本是否被折叠或隐藏 |

## 目前已经确认，但还需要继续补的部分

1. `transport-status / play / pause / seek` 已经在真正加载的 Studio 页面上实测通过；后续只需要继续追 `stop` 的 DSP v2 边界。
2. 需要更多样本去覆盖：
   - 有 aligned lyrics 的 clip
   - 可直接读 stems 的 clip
   - 可能包含不同节拍 / 速度自动化的工程
3. 需要把当前观测到的 clip / media / state 结构进一步整理成“参数表”，方便后续做 AAF、DAWproject 或别的导出映射。

## 当前阶段结论

现在可以确定：

- Studio 2.0 的工程状态和 clip 参数已经可读；
- downbeats / MIDI / novelty / lyrics / waveform 的分析视图已经有稳定入口；
- transport 层已经在真实 Studio 页面上验证了 `play / pause / seek`，并发现了 `stop` 的 DSP v2 偏移边界；
- 这套信息足够作为后续“导出映射层”的基础；
- 但它还不是 AAF 成品输出。
