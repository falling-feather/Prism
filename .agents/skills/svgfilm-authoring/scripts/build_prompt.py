"""Build the standalone prompt from the maintained protocol and full example."""
from pathlib import Path
import argparse,re
SKILL=Path(__file__).resolve().parents[1]
def build():
    parts=['# SVGFilm AI 引导协议 · 0.4.0\n\n你正在为 映物 Prism 制作可编辑视频。请先遵守以下工程接口，再执行用户另行给出的题材、风格与文稿要求。交付自包含 `.svgfilm.json` 或含独立素材的 `.prism`；不要只交播放视频。本文包含 SVG 与 Canvas 协议和完整示例，无需安装 Skill 或读取其他链接。\n\n本文件由工作区 Skill 的权威参考自动生成。']
    for name in ['project','svg','animation','canvas','delivery']:
        parts.append((SKILL/'references'/f'{name}.md').read_text(encoding='utf-8').strip())
    example=(SKILL/'assets/minimal.svgfilm.json').read_text(encoding='utf-8').strip()
    parts.append('# 完整可导入 SVG 示例\n\n这是继续兼容的0.3工程，6秒、两幕、无音轨。可替换图文和关键帧；初始清单由工作台登记。\n\n```json\n'+example+'\n```')
    canvas=(SKILL/'assets/minimal-canvas.svgfilm.json').read_text(encoding='utf-8').strip()
    parts.append('# 完整可导入 Canvas 示例\n\n这是0.4程序动画，支持对象变换、文字、颜色与速度参数。\n\n```json\n'+canvas+'\n```')
    parts.append('# 给生成 AI 的交付要求\n\n请交付工程文件及简短验证说明。保留可编辑文字和稳定ID，采用上述动画字段；没有运行工作台时明确标记未运行验证。用户只需要纯SVG时，可交付可编辑静态素材，但应说明它不等于完整动画工程。')
    # Keep the standalone artifact free from relative links that need the Skill folder.
    return re.sub(r'\[([^\]]+)\]\((?!https?://|#)[^)]+\)',r'\1','\n\n---\n\n'.join(parts))+'\n'
if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args();output=args.output.resolve()
    if not output.parent.is_dir():ap.error('输出父目录不存在，请指定已存在的项目目录')
    output.write_text(build(),encoding='utf-8');print(str(output))
