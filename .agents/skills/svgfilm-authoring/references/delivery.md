# 交付、检查与互操作

## 主交付与可选封装

交付自包含 `作品名.svgfilm.json` 或完整 `.prism` 工程包。附上短说明：对应工作台0.4、来源类型、总时长与帧率、是否包含声音、已执行哪些检查。不要只交截图、当前帧SVG、MP4或单独的动画HTML。

- **ZIP／.svgfilm／.prism**：ZIP中放唯一 `project.svgfilm.json`，推荐置于根目录。资源清单通过path关联包内素材，不能只放文件而不登记。包本身及解压总大小不超过4 GiB，JSON清单不超过120 MiB。工作台保存含独立素材的工程时自动生成.prism。
- **HTML**：必须嵌入 `<script id="svgfilm-project" type="application/json">`，内容为同一工程JSON。为避免正文提前关闭script，将JSON中的 `<` 编码为 `\u003c`。工作台仅读取此数据，忽略HTML中的播放脚本。因此“能导入的HTML”不必能独立播放；需要独立播放器时由工作台导出HTML，捆绑其匹配版本运行时。
- **普通.svg**：作为单个静态镜头导入，原扩展名不携带animations数据；动画主交付依然必须是工程。

目录工程可以放 `project.json`、绘制程序和素材；在来源中用 `programFile` 指向程序体文件，在resources中用path指向素材。运行工作台的 `app/tools/package_project.py 工程目录 --out 作品.prism`，工具只读取、核对路径并打包，不执行程序。不要把完整网页HTML直接放入programFile。

独立HTML会携带运行时与允许容量内的素材；过大的工程应保存工程包或导出MP4。当前帧SVG中的Canvas部分是位图快照，后续对象编辑使用原工程。

## 真实校验工具

Skill自带 `scripts/check_project.py`，针对匹配版本的已运行工作台检查JSON或工程包。需要Python的Playwright及可用浏览器；当前工作区可直接使用工作台的 `.venv/Scripts/python.exe`，无需全局安装Skill或依赖。

在项目根目录运行（将路径替换为实际文件）：

```powershell
app/.venv/Scripts/python.exe -X utf8 .agents/skills/svgfilm-authoring/scripts/check_project.py 作品名.svgfilm.json --url http://127.0.0.1:8765 --report 校验结果.json
```

在其他环境可以用具有Playwright的Python运行同一个脚本，并以 `--browser chromium` 使用已安装的Chromium；默认msedge。`--check-portable`额外验证工作台捆绑的离线HTML。工具复用实际工作台的校验、渲染和编辑读写，不要求其他AI获得本次聊天历史或自行重写验证器。

校验不会覆盖输入工程，编辑检查在隔离浏览器中完成。报告区分导入、图片／音频解码与真实音源时长、确定性寻帧、文字／组件修改、保存回读与可选HTML。它不代替人工检查事实内容、字体外观、遮挡、字幕阅读速度，也不声称已经执行MP4导出或人工试听。

## 交付前自检

1. JSON可解析，所有来源和素材完整内嵌或随包提供，版本／来源类型正确；没有伪base64或本机绝对路径。
2. SVG节点或Canvas声明中的对象ID稳定、唯一，文字保留正文，引用存在。初始清单为空，或已有清单保持完整且对应来源。
3. 全片、剪辑、来源三个时钟区分正确。片头、镜头中部、切点、片尾／停留以及逆序寻帧都能渲染。
4. 导入后至少实际修改一段文字与一个组件，保存再导入；修改仍在、原动画仍在，字幕／声音时间没有错位。
5. 需要成片交付时，由工作台实际导出一段MP4，检查动画和声音；再按需求导出全片。工程始终与成片一起保留。

无法运行工作台时，明确写“仅完成静态结构自检，未进行工作台运行验证”。遇到未知动画需求先说明无法由现接口表达的部分，不用字段名看似相似的私有格式冒充兼容。

## 纯提示词模式

不支持Skill的AI可以阅读本项目的单文件《SVGFilm-AI-引导协议.md》，然后接收具体创作需求。该文件包含完整示例，不需要跟随相对链接。使用时说明：“先遵守这份工程协议，再执行我的题材和风格要求；主交付必须包含可编辑的.svgfilm.json。”

Skill协议参考是权威文档来源；单文件由 `python scripts/build_prompt.py --output <目标.md>` 生成，修改规范后重新生成，不分别手工修改两份。
