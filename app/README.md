# 映物 Prism · 动画编辑工作台 v0.4.2 试用版

当前为 Logo 接入检查点：页头与浏览器标签页使用已去背景的品牌素材，窄屏显示独立图标。前端整体改版仍为概念图；素材位置与说明见 [品牌资源](assets/brand/README.md)。

## 打开工作台

双击 **启动工作台.bat**。它启动本机服务，并打开 http://127.0.0.1:8765 。直接打开 index.html 时会显示启动提示。

运行环境需要 Python、PowerShell 7、Microsoft Edge 和 PATH 中的 FFmpeg / ffprobe；首次启动会在本目录建立 .venv 并安装 requirements.txt。首次依赖安装需要网络，正常编辑无需在线素材服务。也可以使用仓库根目录的“启动映物.bat”。

## 教师操作

1. 从左侧选择镜头，播放或拖动下方播放头查看动态画面。
2. **文字**：列出全部画面文字；修改标注、标题、题目和答案，调整字号、颜色、位置与换行宽度。下面可编辑字幕内容和局部起止时间。
3. **组件**：点击画布或列表选中对象，直接拖动，或用右下角控制点缩放；支持数值位置、旋转、隐藏和恢复。
4. **时间轴**：连续拖动播放头，放大到帧；拖动字幕／音频移动，拖两端裁剪，磁吸辅助对齐。镜头条可拖动排序、两端裁剪；选中片段后出现精确时间、按帧微调和对齐操作。播放头处可拆分镜头。
5. **声音**：上传音乐／配音或主动录音；调整全片起点、音频源入点、长度、音量和淡入淡出。音轨位置使用全片时间，镜头剪辑不自动改动音轨起点。
6. **保存工程**：小工程得到 .svgfilm.json；含独立素材时保存为携带素材的 .prism 工程包，重新导入恢复修改。JSON清单预算120 MiB，工程包4 GiB；超限编辑会被拒绝并保留之前状态。
7. **导出视频**：选择当前镜头或全片、720p或1080p；生成MP4后点击下载。可取消进行中的导出。HTML导出总是包含全片，可以离线播放并再次导入编辑。

MP4增加三种导出方式：**自动加速**默认用于日常导出，少于90帧的短片采用兼容方式以减少启动开销；**快速导出**使用浏览器视频编码，存在细微字体抗锯齿差异；**兼容导出**使用原来的DOM截图方式。自动模式遇到不支持的编码配置或滤镜、遮罩、图案等效果时会明确提示并切换兼容方式。快速模式失败会显示错误，仍可手动选择兼容。音频混合、帧率和工程格式保持一致。

快速导出分批排空编码数据，最多4个待编码请求，单批编码数据上限16 MiB。编辑撤销共享不可变素材，普通编辑复用素材校验结果；修改后只刷新有变化的面板，播放头连续拖动按屏幕刷新合并。性能数据和适用边界见[优化记录](../docs/05-性能优化方案.md)。

空格播放／暂停，左右方向键逐帧，Ctrl+Z撤销，Ctrl+Shift+Z重做。编辑会在本浏览器保存草稿，可通过“恢复上次草稿”恢复；下载工程仍是跨电脑保存的方式。

## SVG 与 Canvas 混合编辑

已有原始网页动画时，可点击镜头列表上方的“源码目录”，选择工程或其上层文件夹。编辑器会分析源码、登记绘制对象，并保留原始素材和代码。当前支持具有render(t)入口的单主Canvas 2D及其WebGL后期合成工程，详见[原始源码目录读取](../docs/07-原始源码目录读取.md)。

首次使用源码读取需安装 Node.js，并在仓库根目录执行 `npm ci --prefix app/tools/source-import` 安装分析器依赖；本机验证使用 Node 24.20.0。基础工程编辑不需要该分析器。

- 先导入 [混合示例](cases/universal/mixed.svgfilm.json)。三个镜头分别使用参数化 Canvas、带图片的 Canvas 和 SVG 关键帧，沿用同一套播放、选择、文字、时间轴和保存操作。
- 选择“指针”，在“组件 → 动作与外观”中调整转速、长度；选择钟面可以改色。控件来自工程声明，其他作品可提供自己的数值、颜色、文字、开关或选项参数。修改不会重写来源程序，支持撤销。
- “追加工程”把另一工程的镜头放在末尾，并平移新增音轨。冲突编号自动重新绑定，已有工程的布局、文字与参数保留。
- 大于8 MiB的音频作为独立素材载入，不塞进编辑JSON。保存工程包包含全部登记素材；仅复制本机草稿或带assetId的JSON不能跨电脑恢复资源。
- Canvas 按当前预览／输出分辨率绘制。其当前帧SVG中包含位图；对象级继续编辑应保存原工程。独立HTML仍有容量上限，大工程请使用工程包或MP4。
- Canvas 来源需要稳定对象声明与规定的程序入口。普通网页HTML、视频和三维工程不能直接自动解构。旧网页源码接入方法见 [0.4协议](docs/SVGFilm_工程格式_v0.4.md)。

## 自由工作区与框选

- 默认收起属性面板与时间轴轨道，保留播放栏。画布上方“镜头／属性”控制两侧区域；右下方“展开时间轴／收起时间轴”控制轨道区域。
- 时间轴展开后，可上下拖动其上边缘调高；双击拖动条恢复默认高度。拖动条获得焦点后也可用上下方向键微调、Home／End调整到最小／最大。工作台记住本浏览器的布局，并根据工具条实际高度为画布保留空间。
- 在空白处拖框，或先点击“框选”再从任意位置拖框。完整包围的可见组件会被选中；父子同时框入时只操作父组。较大父组未被完整框入时，仍可选择被包围的内部组件。
- Shift点选可追加或取消组件；Shift框选追加到已有选择。Esc清除选择；拖动过程中Esc或Ctrl+Z取消当前手势，不改变已完成的编辑。
- 框选后，拖动选择框顶部标签一起移动；在“选择”工具下也可直接拖动选中组件。右下角控制点按当前缩放模式调整大小。
- **各自缩放**：每个组件围绕自己的当前可见中心缩放，中心位置保持不变。**整体缩放**：以整个选择框中心缩放，组件尺寸和彼此间距一起变化。画布下方或批量属性区都可切换模式、输入百分比。
- 轻量调整可直接使用选中工具条。点击“编辑所选”打开详细参数；双击组件进入内部部件编辑，也可手动勾选“深入部件”。批量属性支持相对位移、缩放、隐藏／显示和恢复变换。
- **删除组件**：选中后点击“删除所选”，或按Delete／Backspace；框选可批量删除，一次操作对应一步撤销。删除通过现有隐藏覆盖从当前镜头画面移除组件，保留来源素材和动画；其他镜头不受影响。可用Ctrl+Z撤销，或在组件面板选择该组件并取消“隐藏组件”恢复。输入框、导出弹窗和时间轴操作不会触发画布删除快捷键。

批量操作保留原有动画和组件结构；单次拖动或应用操作只产生一步撤销。这里的“整体缩放”不创建永久分组，保存后仍保留各组件的可编辑性。

## 精细时间轴

- **查看与缩放**：抓住橙色播放头或在标尺上按住拖动，可连续预览。缩放滑杆可放大到每帧可见；Ctrl＋滚轮以鼠标下的时刻为中心缩放。“适应全片”返回全局，“放大选段”查看当前片段。放大后的标尺明确显示“分:秒:帧”；拖到左右边缘会自动滚动。
- **磁吸与精度**：默认开启磁吸，可选近／标准／强距离，参考播放头、有效镜头／字幕／音频边缘。绿色参考线说明当前贴合位置；按 N 切换，拖动时按住 Alt 临时关闭。普通拖动按项目帧率取整，也可切换毫秒；已有亚帧参考点仍精确贴合，原工程不会被批量取整。
- **精确修改**：点击字幕、音频或镜头条才展开精细操作条，选择移动／裁剪开头／裁剪结尾，输入全片秒数或 `HH:MM:SS:帧`，点击“应用时间”。播放栏的时间码输入框用于定位播放头。非整数帧率使用非丢帧时间码编号。
- **逐帧与对齐**：左右方向键逐帧预览；选中片段后，Alt＋左右键微调当前操作的边缘或位置，Shift加速到10帧，也可点击“−1帧／+1帧”。对齐菜单支持首尾对齐播放头、裁至播放头、贴齐前一条同类字幕／声音；不合法的目标会提示，不会悄悄换成其他时间。
- **镜头与声音**：镜头顺序保持自动接续，拖动镜头条可换顺序；裁剪头部参考原镜头的裁剪时刻，松手后自动闭合并重定位字幕。音频左边缘裁剪同步推进源入点，延长不超过已知音源范围；全片音轨不会随镜头裁剪或排序自动平移。
- **撤销与深入编辑**：拖动时显示候选位置，松手才提交一步编辑；Esc／Ctrl＋Z可取消正在进行的拖动，已完成操作支持撤销／重做。双击片段或点击“详细参数”才打开侧边属性区；取消时间轴选择可收起精细操作条。缩放、磁吸和精度偏好保存在本浏览器。

## 导入范围

- SVGFilm v0.4 JSON，兼容迁移v0.2／v0.3，以及包含唯一工程JSON与资源清单的.prism／ZIP／.svgfilm包。
- 新版 `svg-keyframes-v1` 工程：稳定SVG组件ID，支持位移／缩放／旋转／透明度关键帧；教师布局修改叠加在动画外层，支持裁剪、保存回读和共同导出。
- 原版 cell-native-v1 工程自动迁移，保留已修改文字和可映射组件变换。无法对应的旧修改会明确报错。
- 普通 SVG 作为静态镜头，支持文字与图形编辑；原有安全绘图样式和 defs 引用保留，脚本与外部资源不执行。
- 由本工作台导出的标准 HTML 可恢复完整工程。任意第三方 HTML、视频或脚本 SVG 的动画逻辑不自动逆向恢复。

通用SVG场景自带素材；细胞原生动态场景使用随工作台分发的 cell-native-v1 组件。普通SVG仍作为静态素材，检测到其中的脚本／动画时会明确提示动画未保留。MP4 是观看结果，不能恢复对象编辑。

## 交给其他AI制作

读取工作区的 [svgfilm-authoring Skill](../.agents/skills/svgfilm-authoring/SKILL.md)，或直接把[完整引导协议](../docs/SVGFilm-AI-引导协议.md)交给不支持Skill的AI。要求它交付自包含 `.svgfilm.json`，再在本工作台导入。

可先导入[6秒完整示例](../.agents/skills/svgfilm-authoring/assets/minimal.svgfilm.json)，修改标题、移动组件、调整字幕，保存回读后导出视频。此Skill仅位于当前项目的 `.agents/skills`，未安装到全局。

这份协议约束开发接口，不包含题材、画风或文稿流程要求。本版提供规定的Canvas程序接口，不执行任意网页HTML，也不提供完整关键帧曲线编辑器；具体字段以[0.4协议入口](docs/SVGFilm_工程格式_v0.4.md)为准。

## 实际验收与限制

已验证：专业标注与字幕修改、组件数值与画布拖动、字幕拖动、镜头拆分和裁剪、撤销重做、音频导入、工程保存回读、独立HTML播放／回读、独立SVG工程MP4、原生动态与音频混合MP4。测试生成的视频留在本机，不随源码分发；范围见[验证记录](../docs/VALIDATION.md)。

默认使用本机楷体；预览与导出共用本机字体环境，跨电脑需安装对应字体。录音入口已实现，但本轮未进行真实麦克风录音验收；未接入在线TTS。没有宣称完成全片334秒重渲染或完整试听。工作台在本机运行，未发布为线上Sites。

## 开发与检查

数据与时间：src/project.mjs；时间轴规则与交互：src/timeline.mjs / timeline-controller.mjs；画面与导入：src/renderer.mjs；界面：src/editor.mjs / editor.css；声音预览：src/audio.mjs；本机服务：tools/server.py；视频与混音：tools/render_svgfilm.py。

```powershell
node --test tests/project.test.mjs
node --test tests/selection.test.mjs
node --test tests/timeline.test.mjs
node --test tests/animation.test.mjs
node --test tests/edit_state.test.mjs tests/fast_export.test.mjs
.venv/Scripts/python.exe -X utf8 tests/edit_performance_browser.py
.venv/Scripts/python.exe -X utf8 tests/fast_export.py
.venv/Scripts/python.exe -X utf8 tests/fast_visual.py
.venv/Scripts/python.exe -X utf8 tests/animation_browser.py
.venv/Scripts/python.exe -X utf8 tests/animation_export.py
.venv/Scripts/python.exe -X utf8 tests/protocol_checker.py
.venv/Scripts/python.exe -X utf8 tests/timeline_interactions.py
.venv/Scripts/python.exe -X utf8 tests/timeline_navigation.py
.venv/Scripts/python.exe -X utf8 tests/timeline_export.py
.venv/Scripts/python.exe -X utf8 tests/browser_smoke.py
.venv/Scripts/python.exe -X utf8 tests/layout_regression.py
.venv/Scripts/python.exe -X utf8 tests/workspace_selection.py
.venv/Scripts/python.exe -X utf8 tests/component_delete.py
.venv/Scripts/python.exe -X utf8 tests/svg_import.py
.venv/Scripts/python.exe -X utf8 tests/legacy_migration.py
.venv/Scripts/python.exe -X utf8 tests/audio_mix.py
.venv/Scripts/python.exe -X utf8 tests/export_smoke.py
```

浏览器检查使用真实 Edge 的 Playwright 会话。当前未提供专用 Browser 技能，因此使用常规 Playwright。API与项目规范以源码和项目根目录的工作台设计文档为准；docs 中旧 v0.1 核验记录属于历史资料。
