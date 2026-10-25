# SVGFilm 0.3 工程协议入口

当前工作台为0.4，继续读取本页所述0.3工程。新来源、参数与独立素材规范见[0.4入口](SVGFilm_工程格式_v0.4.md)；下方参考指向持续维护的现行规范。

正式协议的唯一文档来源是工作区 [svgfilm-authoring Skill](../../.agents/skills/svgfilm-authoring/SKILL.md) 中的参考：

- [工程数据结构](../../.agents/skills/svgfilm-authoring/references/project.md)
- [SVG组件与文字接口](../../.agents/skills/svgfilm-authoring/references/svg.md)
- [声明式关键帧动画](../../.agents/skills/svgfilm-authoring/references/animation.md)
- [交付与真实运行校验](../../.agents/skills/svgfilm-authoring/references/delivery.md)

无需Skill的AI可直接阅读自动生成的[完整引导协议](../../docs/SVGFilm-AI-引导协议.md)。[6秒工程示例](../../.agents/skills/svgfilm-authoring/assets/minimal.svgfilm.json)可直接导入新版工作台。

0.3新增 `svg-keyframes-v1`，支持按来源时间求值的位移、统一缩放、旋转和透明度。工作台读取0.2并保留已有编辑；新生成动画必须声明0.3。普通SVG继续按静态镜头导入并解析图文，检测到脚本／动画时会提示动画未保留。

实际数据校验在 `src/project.mjs` 和 `src/animation.mjs`；SVG绑定校验在 `src/svg-contract.mjs`；预览与导出共享 `src/renderer.mjs`。本文件仅作入口，不维护第二份字段表。
