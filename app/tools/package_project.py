"""Package a source directory without executing its drawing programs."""

from pathlib import Path
import argparse, json
from asset_store import AssetStore, MIME, MAX_MEDIA, MAX_PACKAGE


def local_file(root, relative):
    if not isinstance(relative, str) or not relative or Path(relative).is_absolute():
        raise ValueError("须使用工程目录内的相对文件路径")
    result = (root / relative).resolve()
    if not result.is_relative_to(root) or not result.is_file():
        raise ValueError("素材或程序文件缺失，或路径超出工程目录：" + relative)
    return result


def package_directory(root, output):
    root = Path(root).resolve()
    output = Path(output).resolve()
    if not root.is_dir() or not output.parent.is_dir():
        raise ValueError("工程目录或输出父目录不存在")
    if output.exists():
        raise ValueError("输出文件已经存在，请使用新文件名")
    manifests = [
        p for p in (root / "project.svgfilm.json", root / "project.json") if p.is_file()
    ]
    if len(manifests) != 1:
        raise ValueError("目录须有唯一的 project.svgfilm.json 或 project.json")
    project = json.loads(manifests[0].read_text(encoding="utf-8-sig"))
    if (
        project.get("schema") != "svgfilm-project"
        or project.get("schemaVersion") != "0.4.0"
    ):
        raise ValueError("目录工程须使用 SVGFilm 0.4.0")
    for source in project.get("sources", {}).values():
        if "programFile" in source:
            if source.get("program"):
                raise ValueError("不能同时提供 program 和 programFile")
            program = local_file(root, source.pop("programFile"))
            if program.stat().st_size > 1024**2:
                raise ValueError("绘制程序超过 1 MiB")
            source["program"] = program.read_text(encoding="utf-8-sig")
    files = {}
    total = 0
    for key, resource in project.get("resources", {}).items():
        if not MIME.fullmatch(resource.get("mime", "")):
            raise ValueError("素材类型无效：" + key)
        file = local_file(root, resource.get("path"))
        size = file.stat().st_size
        if not 0 < size <= MAX_MEDIA:
            raise ValueError("素材大小无效：" + key)
        if resource["mime"].startswith(("image/", "font/")) and size > 80 * 1024**2:
            raise ValueError("单图片或字体超过 80 MiB：" + key)
        total += size
        files[key] = file
    if total > MAX_PACKAGE:
        raise ValueError("素材超过工程包容量 4 GiB")
    store = AssetStore(Path(__file__).resolve().parents[1] / ".work" / "assets")
    try:
        store.write_package(project, output, files)
    except Exception:
        output.unlink(missing_ok=True)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        package_directory(args.directory, args.out)
    except Exception as error:
        parser.exit(1, str(error) + "\n")
    print(str(args.out.resolve()))
