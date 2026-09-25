---
name: svgfilm-authoring
description: Use when authoring or adapting editable SVG animations and SVGFilm project packages for import into 映物 Prism, or checking compatibility of an AI-generated project. Applies to project structure, node identity, timing, animation and media interfaces, independently of visual style and script-writing workflows.
---

# SVGFilm 工程交付协议

目标是交付能在 映物 Prism 中继续修改文字、组件、字幕、剪辑和声音的工程。成片播放正确与工程可编辑是两项不同的验收。此 Skill 只约束数据和接口，不决定题材、画风或脚本审批流程。

## 使用方式

1. 创建工程前阅读 [工程结构](references/project.md)、[SVG 对象接口](references/svg.md) 和 [动画接口](references/animation.md)。输出 `schemaVersion: "0.3.0"`，通用来源使用 `svg-keyframes-v1`。从 [完整示例](assets/minimal.svgfilm.json) 修改比猜测字段可靠。
2. SVG 中保留真实 `text` 和具有稳定 `id` 的组件。动画写入来源的 `animations`；教师修改使用剪辑的 `texts`／`objectOverrides`，动画与编辑互不覆盖。首次交付允许空的文字／对象清单，工作台会登记。
3. 按 [交付与验收](references/delivery.md) 提交自包含 `.svgfilm.json`。HTML／ZIP是可选封装；普通 SVG 与 MP4 不能替代动画工程。保持 JSON 可解析，不在数据中放注释、伪代码或占位资源。
4. 使用随包的 `scripts/check_project.py` 对匹配版本的本机工作台运行真实导入检查，处理报错后再交付。没有运行环境时，交付工程并明确标记“未进行工作台运行验证”；不能把人工字段检查说成已经导入成功。

## 修改已有工程

先保存用户现有版本。保留来源 ID、SVG ID、剪辑 ID 和已登记清单；修改图文时保持绑定。需要改变来源结构时先评估现有教师编辑的对应关系，不能通过清空清单或重编号丢弃修改。只有受支持的字段才会生效，未知动画不能包在 HTML 中期待自动执行。

## 本 Skill 的范围

支持通用位移、统一缩放、旋转和透明度关键帧。CSS／SMIL／任意 JavaScript、路径变形、3D、任意 MP4 对象恢复不属于此版本接口。若请求超出范围，指出具体缺口，先商定适配器扩展或可表达的效果，不能静默改成静态图。

完整提示词版由 `python scripts/build_prompt.py --output <协议.md>` 从这些参考和示例生成。此目录安装在项目 `.agents/skills`；不需要全局安装，也不依赖其他创作 Skill。无 Skill 载入能力的 AI 可直接读取生成的单文件协议。
