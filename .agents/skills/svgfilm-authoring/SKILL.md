---
name: svgfilm-authoring
description: Use when authoring or adapting editable SVG or Canvas animations and SVGFilm project packages for import into 映物 Prism, or checking compatibility of an AI-generated project. Applies to project structure, object identity, typed parameters, timing, animation and media interfaces, independently of visual style and script-writing workflows.
---

# SVGFilm 工程交付协议

目标是交付能在 映物 Prism 中继续修改文字、组件、参数、字幕、剪辑和声音的工程。当前工作台 0.4 支持 SVG 与 Canvas 程序来源混合；成片播放正确与工程可编辑是两项不同的验收。此 Skill 只约束数据和接口，不决定题材、画风或脚本审批流程。

## 使用方式

用户提供本机原始Canvas网页工程时，优先使用工作台的“源码目录”入口读取与拆解，不要求用户先手工转换格式。该入口读取具有render(t)／DUR接口的本地Canvas 2D及其WebGL后期合成工程；能力范围见项目docs/07-原始源码目录读取.md。下面的规范仍用于新生成工程及结构化交换。

1. 创建工程前阅读 [工程结构](references/project.md)。SVG 来源阅读 [SVG 对象接口](references/svg.md) 和 [动画接口](references/animation.md)，Canvas 来源阅读 [Canvas 接口](references/canvas.md)。新工程输出 `schemaVersion: "0.4.0"`；SVG 使用 `svg-keyframes-v1`，Canvas 使用 `canvas-program-v1`。原有 [SVG 示例](assets/minimal.svgfilm.json) 的 0.3 格式继续受支持。
2. SVG 中保留真实 `text` 和具有稳定 `id` 的组件。动画写入来源的 `animations`；教师修改使用剪辑的 `texts`／`objectOverrides`，动画与编辑互不覆盖。首次交付允许空的文字／对象清单，工作台会登记。
3. 按 [交付与验收](references/delivery.md) 提交自包含 `.svgfilm.json` 或包含独立素材的 `.prism` 工程包。普通 SVG 与 MP4 不能替代动画工程。保持 JSON 可解析，不在数据中放注释、伪代码或占位资源；Canvas 的可执行代码只放在其明确规定的 program 字段。
4. 使用随包的 `scripts/check_project.py` 对匹配版本的本机工作台运行真实导入检查，处理报错后再交付。没有运行环境时，交付工程并明确标记“未进行工作台运行验证”；不能把人工字段检查说成已经导入成功。

## 修改已有工程

先保存用户现有版本。保留来源 ID、SVG ID、剪辑 ID 和已登记清单；修改图文时保持绑定。需要改变来源结构时先评估现有教师编辑的对应关系，不能通过清空清单或重编号丢弃修改。只有受支持的字段才会生效，未知动画不能包在 HTML 中期待自动执行。

## 本 Skill 的范围

SVG 支持通用位移、统一缩放、旋转和透明度关键帧；Canvas 支持规定的程序绘制、稳定对象、真实文字与参数接口。CSS／SMIL、任意 HTML、3D、MP4 对象恢复不属于此版本内置接口。若请求超出范围，指出具体缺口，先商定适配器扩展或可表达的效果，不能静默改成静态图或仅包装成片。

完整提示词版由 `python scripts/build_prompt.py --output <协议.md>` 从这些参考和示例生成。此目录安装在项目 `.agents/skills`；不需要全局安装，也不依赖其他创作 Skill。无 Skill 载入能力的 AI 可直接读取生成的单文件协议。
