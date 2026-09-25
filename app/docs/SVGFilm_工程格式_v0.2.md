# SVGFilm v0.2 工程约定

实际校验以 [project.mjs](../src/project.mjs) 的 `validateProject` 为准，时序以该文件的 `locate`、`splitScene`、`trimScene` 为准。旧版文档保留为历史资料。

工程顶层：`schema: "svgfilm-project"`、`schemaVersion: "0.2.0"`、`projectId`、`title`、`canvas`、`workflow`、`sources`、`scenes`、`audioTracks`。

- `sources` 为按稳定sourceId索引的素材。`type: "svg"` 携带完整 `svg` 字符串和来源 `duration`；不执行外部资源或脚本。`type: "cell-native-v1"` 携带原生 `scene` 参数、`duration` 和 `adapterVersion: 1`，绘图程序由同版本工作台提供。
- `scenes` 表示剪辑序列。每项有独立 `id`、`sourceId`、`name`、`in`、`out`、`hold`、`texts`、`objects`、`objectOverrides`、`subtitles`。片长是 `out-in+hold`。来源时间等于 `in+min(片内时间,out-in)`。复制镜头保留来源，但具有独立修改记录。
- `texts` 保存画面源字符串及 `id`、`objectId`、`x/y`、`size`、`font`、`fill`、`anchor`、`width`、来源局部 `start/end`。新导入SVG或原生来源可由renderer一次性登记完整清单；之后保存这些稳定ID。不可在保留旧ID时随意改变来源结构。
- `objects` 保存 `id`、显示名称 `label`、`parentId`、缩放中心 `cx/cy`。`objectOverrides[id]` 记录 `dx/dy/scale/rotation/hidden`，外层布局变换不覆盖内层原生动画变换。
- `subtitles` 保存 `id/text/start/end`，时间属于当前剪辑局部。`text` 是唯一内容来源，换行从文本及排版规则计算；不保存第二份 rows 内容。
- `audioTracks` 保存 `id/name/kind/dataUrl/start/offset/duration/mediaDuration/volume/muted/fadeIn/fadeOut`。start是全片时间，offset是音频源时间；音频以base64 data URL随工程携带。淡入淡出均为线性，两者重叠时包络相乘。

保存JSON即可跨同版本工作台回读。ZIP／.svgfilm封装包含唯一 `project.svgfilm.json`（也接受 `project.json`），其中素材仍自包含。独立播放HTML将同一工程放入 `script#svgfilm-project[type="application/json"]`，并捆绑相同渲染代码；导入时仅读取数据，不执行外来HTML脚本。

工程最大120 MiB；导入文件最大160 MiB，服务请求最大200 MiB，为JSON／HTML封装留出余量。单音频最大80 MiB，累计工程预算仍优先。当前最多500镜头、16音轨、2小时，渲染帧率1–60fps。具体数值由校验代码维护。

普通SVG只保证受支持的静态画面编辑；新题材复杂动画须提供经过集成的明确来源适配器。导出的当前帧SVG是快照，MP4是观看结果，都不能代替包含时间和来源数据的工程。
