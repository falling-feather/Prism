"""Read a local render(t) Canvas source project into independently editable objects."""

from pathlib import Path
from http.server import ThreadingHTTPServer
from threading import Thread
import argparse, json, subprocess, uuid, shutil
from asset_store import AssetStore
import server

APP = Path(__file__).resolve().parents[1]
INSPECT = r"""async input=>{
  const {createCanvasAdapter}=await import('./src/canvas-adapter.mjs');
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');document.body.append(svg);
  const host=document.createElementNS(svg.namespaceURI,'g');svg.append(host);
  window.sourceInspector=createCanvasAdapter('imported',input.source,host,input.project);
  return sourceInspector.describe();
}"""
SAMPLE = r"""async time=>{
  const result=await sourceInspector.inspect(time);
  try{return result.objects.map(o=>o.declaration).filter(Boolean);}finally{result.bitmap.close();}
}"""


def import_source(
    directory,
    output,
    subtitles=None,
    stage=None,
    scan_step=2,
    cancel=None,
    query="",
    source_name=None,
):
    directory = Path(directory).resolve()
    output = Path(output).resolve()
    if not directory.is_dir() or not output.parent.is_dir():
        raise ValueError("源码或输出父目录不存在")
    if output.exists():
        raise ValueError("输出已存在，请选择新文件名")
    if not shutil.which("node"):
        raise ValueError("源码分析需要 Node.js 24 或更新版本")
    if not (
        APP / "tools/source-import/node_modules/@babel/parser/package.json"
    ).is_file():
        raise ValueError(
            "请先运行 npm install --prefix app/tools/source-import 安装源码分析组件"
        )
    stage = (
        Path(stage).resolve()
        if stage
        else APP / ".work" / ("source-import-" + uuid.uuid4().hex[:12])
    )
    stage.mkdir(exist_ok=True)
    draft = stage / "source-draft.json"

    def check_cancel():
        if cancel and Path(cancel).is_file():
            raise InterruptedError("源码分析已取消")

    check_cancel()
    subprocess.run(
        [
            "node",
            str(APP / "tools/source-import/read-project.mjs"),
            str(directory),
            str(draft),
            query,
        ],
        check=True,
    )
    data = json.loads(draft.read_text(encoding="utf-8"))
    store = AssetStore(APP / ".work/assets")
    resources = {}
    for item in data["resources"]:
        check_cancel()
        file = Path(item["path"]).resolve()
        if not file.is_relative_to(directory):
            raise ValueError("素材超出源码目录")
        with file.open("rb") as stream:
            resources[item["alias"]] = store.put(
                stream, file.stat().st_size, item["mime"], item["name"]
            )
    assets = {key: key for key in resources}
    files = {}
    for item in data["sourceFiles"]:
        check_cancel()
        file = Path(item["path"]).resolve()
        if not file.is_relative_to(directory):
            raise ValueError("源码文件超出导入目录")
        with file.open("rb") as stream:
            resources[item["alias"]] = store.put(
                stream, file.stat().st_size, "application/octet-stream", item["name"]
            )
        files[item["name"]] = item["alias"]
    source = {
        "type": "canvas-source-v1",
        "canvas": {"width": data["width"], "height": data["height"]},
        "duration": 7200,
        "program": data["program"],
        "objects": [],
        "assets": assets,
        "fonts": data["fonts"],
        "files": files,
    }
    project = {
        "schema": "svgfilm-project",
        "schemaVersion": "0.4.0",
        "projectId": "source-" + uuid.uuid4().hex,
        "title": (data.get("title") or source_name or directory.name) + " · 源码编辑",
        "canvas": {
            "width": data["width"],
            "height": data["height"],
            "fps": 24,
            "background": "#26324f",
        },
        "sources": {"imported": source},
        "resources": resources,
        "scenes": [],
        "audioTracks": [],
        "captionStyle": {
            "size": 36,
            "font": "Microsoft YaHei, sans-serif",
            "fill": "#f3efe4",
        },
    }
    http = ThreadingHTTPServer(("127.0.0.1", 0), server.Handler)
    thread = Thread(target=http.serve_forever, daemon=True)
    thread.start()
    declarations = {}
    ranges = {}
    variants = {}
    sample_count = 0
    try:
        from playwright.sync_api import sync_playwright

        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            try:
                page = browser.new_page()
                page.goto(f"http://127.0.0.1:{http.server_port}/")
                metadata = page.evaluate(
                    INSPECT, {"source": source, "project": project}
                )
                source["duration"] = metadata["duration"]
                intrinsic = {"width": metadata["width"], "height": metadata["height"]}
                if intrinsic != source["canvas"]:
                    if not all(
                        isinstance(v, int) and 64 <= v <= 4096
                        for v in intrinsic.values()
                    ):
                        raise ValueError("源码设置的Canvas尺寸超出支持范围")
                    page.evaluate("sourceInspector.dispose()")
                    source["canvas"] = intrinsic
                    project["canvas"].update(intrinsic)
                    metadata = page.evaluate(
                        INSPECT, {"source": source, "project": project}
                    )
                shots = metadata.get("shots") or [
                    {"start": start, "end": min(start + 15, metadata["duration"]), "name": f"时间片段 {i + 1}"}
                    for i, start in enumerate(range(0, int(metadata["duration"]) + 1, 15))
                    if start < metadata["duration"]
                ]
                for i, shot in enumerate(shots):
                    check_cancel()
                    if shot["end"] - shot["start"] < 0.01:
                        continue
                    samples = [
                        shot["start"],
                        shot["start"] + min(0.05, (shot["end"] - shot["start"]) / 4),
                        (shot["start"] + shot["end"]) / 2,
                        shot["end"] - min(0.05, (shot["end"] - shot["start"]) / 4),
                    ]
                    samples.extend(
                        t + 1 / 48
                        for t in metadata.get("anchors", [])
                        if shot["start"] <= t < shot["end"] - 1 / 48
                    )
                    time = shot["start"] + scan_step
                    while time < shot["end"]:
                        samples.append(time)
                        time += scan_step
                    samples = sorted(set(round(t, 7) for t in samples))
                    fidelity = page.evaluate(
                        "time=>sourceInspector.compareOriginal(time)",
                        (shot["start"] + shot["end"]) / 2,
                    )
                    if fidelity > 1:
                        raise ValueError(
                            f"镜头 {i + 1} 与原始画面对照不一致（差异 {fidelity:.3f}），源码可能依赖累积状态"
                        )
                    for time in samples:
                        check_cancel()
                        sample_count += 1
                        for item in page.evaluate(SAMPLE, time):
                            key = item["id"]
                            declarations.setdefault(key, item)
                            interval = [shot["start"], shot["end"]]
                            if interval not in ranges.setdefault(key, []):
                                ranges[key].append(interval)
                            if "text" in item and not any(
                                v["start"] == shot["start"]
                                for v in variants.setdefault(key, [])
                            ):
                                variants[key].append(
                                    {
                                        "start": shot["start"],
                                        "end": shot["end"],
                                        "text": item["text"],
                                    }
                                )
                    project["scenes"].append(
                        {
                            "id": f"source-shot-{i + 1:03d}",
                            "sourceId": "imported",
                            "name": shot["name"],
                            "in": shot["start"],
                            "out": shot["end"],
                            "hold": 0,
                            "objects": [],
                            "texts": [],
                            "objectOverrides": {},
                            "subtitles": [],
                        }
                    )
                    if i % 10 == 0 or i == len(shots) - 1:
                        print(
                            json.dumps(
                                {
                                    "shot": i + 1,
                                    "total": len(shots),
                                    "objects": len(declarations),
                                }
                            ),
                            flush=True,
                        )
                    (stage / "discovery-progress.json").write_text(
                        json.dumps(
                            {
                                "shots": i + 1,
                                "total": len(shots),
                                "objects": len(declarations),
                                "samples": sample_count,
                            }
                        ),
                        encoding="utf-8",
                    )
                limitations = page.evaluate("sourceInspector.describe()").get(
                    "limitations", []
                )
                page.evaluate("sourceInspector.dispose()")
            finally:
                browser.close()
    finally:
        http.shutdown()
        http.server_close()
        thread.join(timeout=3)
    for key, item in declarations.items():
        item["ranges"] = ranges[key]
        if key in variants:
            item["textVariants"] = variants[key]
    source["objects"] = list(declarations.values())
    source["importInfo"] = {"sampledTimes": sample_count, "limitations": limitations}
    if not source["objects"]:
        raise ValueError("没有识别到独立绘制对象，不能将整幅画面冒充拆解结果")
    (stage / "project-data.json").write_text(
        json.dumps(project, ensure_ascii=False), encoding="utf-8"
    )
    # Reuse the application's authoritative validation and subtitle time rules.
    script = stage / "save-project.mjs"
    script.write_text(
        'import fs from "node:fs";\nimport {validateProject,serializeProject,importSrt} from '
        + json.dumps((APP / "src/project.mjs").as_uri())
        + ";\nconst p=JSON.parse(fs.readFileSync("
        + json.dumps(str(stage / "project-data.json"))
        + ',"utf8"));\n'
        + (
            "importSrt(p,fs.readFileSync("
            + json.dumps(str(Path(subtitles).resolve()))
            + ',"utf8"));\n'
            if subtitles
            else ""
        )
        + "validateProject(p);fs.writeFileSync("
        + json.dumps(str(output))
        + ',serializeProject(p),"utf8");',
        encoding="utf-8",
    )
    subprocess.run(["node", str(script)], check=True)
    report = {
        "objects": len(source["objects"]),
        "texts": sum("text" in o for o in source["objects"]),
        "scenes": len(project["scenes"]),
        "samples": sample_count,
        "duration": source["duration"],
        "output": str(output),
        "limitations": limitations,
    }
    (stage / "import-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--subtitles", type=Path)
    parser.add_argument("--stage", type=Path)
    parser.add_argument("--scan-step", type=float, default=2)
    parser.add_argument("--cancel", type=Path)
    parser.add_argument("--query", default="")
    parser.add_argument("--source-name")
    args = parser.parse_args()
    try:
        if not 0 < args.scan_step <= 10:
            raise ValueError("扫描步长须在0到10秒之间")
        print(
            json.dumps(
                import_source(
                    args.directory,
                    args.out,
                    args.subtitles,
                    args.stage,
                    args.scan_step,
                    args.cancel,
                    args.query,
                    args.source_name,
                ),
                ensure_ascii=False,
            )
        )
    except Exception as error:
        parser.exit(1, str(error) + "\n")
