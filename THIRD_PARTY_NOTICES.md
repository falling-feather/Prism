# 依赖与示例说明

映物的项目代码采用根目录的 MIT 许可证。以下外部工具不会随仓库打包，其许可由各自项目维护：

| 依赖 | 用途 | 来源 |
| --- | --- | --- |
| Python | 本机服务与视频导出 | https://www.python.org/ |
| Playwright for Python | 浏览器渲染和自动化验证 | https://github.com/microsoft/playwright-python |
| Microsoft Edge | Windows 预览与离线视频渲染 | https://www.microsoft.com/edge |
| FFmpeg / ffprobe | 视频编码、声音混合和媒体信息 | https://ffmpeg.org/ |
| PowerShell | Windows 启动脚本 | https://github.com/PowerShell/PowerShell |

`app/cases/cell_structure/native_source/` 保留运行内置细胞示例所需的绘图代码、分镜、背景音乐与原始 MIDI。它是项目的专用历史示例，通用作者请使用 SVGFilm 0.3 工程协议。旧版成片、字体轮廓缓存和制作过程报告不包含在公开仓库中。

字体使用系统已安装字体，不分发字体文件或音色库。用户导入的图片、音频、字体和工程仍遵循各自来源的许可，项目 MIT 许可证不替代它们的授权。
