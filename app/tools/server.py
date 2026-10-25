"""Local editor, portable documents and bounded export jobs. Binds loopback only."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, unquote, parse_qs, quote
import argparse, json, math, mimetypes, re, shutil, subprocess, sys, threading, uuid, webbrowser, tempfile
from asset_store import AssetStore, MAX_PACKAGE, MAX_MEDIA
from source_jobs import SourceJobs
from recent_imports import RecentImports

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / ".work" / "jobs"
JOBS = {}
BUSY = threading.Lock()
PORT = 8765
ASSETS = AssetStore(ROOT / ".work" / "assets")
SOURCE_JOBS = SourceJobs(ROOT)
RECENT_IMPORTS = RecentImports(ROOT / '.work' / 'recent-imports')
mimetypes.add_type("text/javascript", ".mjs")


def bundle(entry):
    modules = []
    names = []
    sources = {}
    visiting = set()
    imports = re.compile(
        r"""(?:import|export)\s*\{[^}]+\}\s*from\s*['"]\./([\w-]+)\.mjs['"];"""
    )

    def visit(name):
        if name in sources:
            return
        if name in visiting:
            raise ValueError("离线模块存在循环依赖：" + name)
        visiting.add(name)
        code = (ROOT / "src" / f"{name}.mjs").read_text(encoding="utf-8")
        for dependency in imports.findall(code):
            visit(dependency)
        visiting.remove(name)
        sources[name] = code
        names.append(name)

    visit(entry)
    aliases = {name: "Module_" + str(i) for i, name in enumerate(names)}
    for name in names:
        code = sources[name]
        exports = re.findall(
            r"export\s+(?:async\s+)?(?:const|let|function|class)\s+(\w+)", code
        )
        for values in re.findall(r"export\s*\{([^}]+)\}\s*from[^;]+;", code):
            exports.extend(x.strip() for x in values.split(","))
        code = re.sub(r"export\s*\{[^}]+\}\s*from[^;]+;", "", code)
        code = re.sub(
            r"""import\s*\{([^}]+)\}\s*from\s*['"]\./([\w-]+)\.mjs['"];""",
            lambda m: "const {" + m[1] + "}=" + aliases[m[2]] + ";",
            code,
        )
        code = re.sub(r"\bexport\s+", "", code)
        modules.append(
            (
                "const "
                + aliases[name]
                + "=(()=>{"
                + code
                + ";return{"
                + ",".join(exports)
                + "};})();"
            )
            if name != entry
            else "(async()=>{" + code + "})();"
        )
    return "\n".join(modules)


def portable(project):
    project = ASSETS.inline(project)
    modules = bundle("player")
    native = "\n".join(
        (ROOT / "cases/cell_structure/native_source/src" / f).read_text(
            encoding="utf-8"
        )
        for f in ("motion.js", "art.js", "organelles.js", "scenes.js")
    )
    code = (native + "\n" + modules).replace("</script", "<\\/script")
    data = json.dumps(project, ensure_ascii=False).replace("<", "\\u003c")
    worker = json.dumps(bundle("canvas-worker"), ensure_ascii=False).replace(
        "<", "\\u003c"
    )
    policy = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; frame-src 'self' about:; connect-src data:; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:"
    output = (
        '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="'
        + policy
        + '"><meta name="viewport" content="width=device-width,initial-scale=1"><title>映物 · Prism — 课堂播放</title><style>html,body{margin:0;width:100%;height:100%;background:#161d18;overflow:hidden}svg{display:block;width:100%;height:100%}</style><body><svg id="stage" aria-label="点击播放或暂停"></svg><script id="svgfilm-project" type="application/json">'
        + data
        + '</script><script id="prism-worker" type="application/json">'
        + worker
        + "</script><script>"
        + code
        + "</script></body></html>"
    ).encode("utf-8")
    if len(output) > 160 * 1024 * 1024:
        raise ValueError("独立 HTML 超过 160 MB，请缩短音频或改为保存工程")
    return output


def check_request(d):
    if d.get("exportMode", "compatibility") not in ("auto", "fast", "compatibility"):
        raise ValueError("不支持的导出方式")
    p = d.get("project", {})
    if (
        p.get("schemaVersion") not in ("0.2.0", "0.3.0", "0.4.0")
        or p.get("schema") != "svgfilm-project"
    ):
        raise ValueError("请先通过工作台载入并保存为支持的工程")
    scenes = p.get("scenes", [])
    if not 1 <= len(scenes) <= 500:
        raise ValueError("镜头数量无效")
    total = sum(s["out"] - s["in"] + s.get("hold", 0) for s in scenes)
    fps = p["canvas"]["fps"]
    width = d.get("width", 1280)
    start = d.get("start", 0)
    end = d.get("end", total)
    if not all(
        isinstance(x, (int, float)) and math.isfinite(x)
        for x in (total, fps, width, start, end)
    ):
        raise ValueError("导出参数无效")
    if not (
        0 < total <= 7200
        and 1 <= fps <= 60
        and width in (640, 1280, 1920)
        and 0 <= start < end <= total + 0.001
    ):
        raise ValueError("导出范围或清晰度无效")
    height = round(width * p["canvas"]["height"] / p["canvas"]["width"] / 2) * 2
    if not 2 <= height <= 4096:
        raise ValueError("此画幅的导出高度超出范围，请调整素材画幅")
    if (
        len(json.dumps(p, ensure_ascii=False, separators=(",", ":")).encode("utf-8"))
        > 120 * 1024 * 1024
    ):
        raise ValueError("工程超过 120 MB，请压缩音频")
    if len(p.get("audioTracks", [])) > 16:
        raise ValueError("音轨过多")
    for resource in p.get("resources", {}).values():
        if resource.get("assetId"):
            ASSETS.path(resource["assetId"])
    return p, width, start, end


def run_job(id, request):
    job = JOBS[id]
    folder = job["folder"]
    p, width, start, end = check_request(request)
    command = [
        sys.executable,
        "-X",
        "utf8",
        str(ROOT / "tools/render_svgfilm.py"),
        "--project",
        str(folder / "project.json"),
        "--url",
        f"http://127.0.0.1:{PORT}",
        "--job",
        id,
        "--out",
        str(folder / "video.mp4"),
        "--width",
        str(width),
        "--start",
        str(start),
        "--end",
        str(end),
        "--cancel",
        str(folder / "cancel"),
        "--mode",
        request.get("exportMode", "compatibility"),
    ]
    try:
        job.update(status="running", message="正在载入画面")
        process = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            cwd=ROOT,
        )
        with (folder / "render.log").open("w", encoding="utf-8") as log:
            for line in process.stdout:
                log.write(line)
                log.flush()
                try:
                    info = json.loads(line)
                    if isinstance(info, dict) and "progress" in info:
                        job.update(
                            progress=info["progress"], message=info.get("message", "")
                        )
                        for key in ("exportMode", "fallbackReason", "performance"):
                            if key in info:
                                job[key] = info[key]
                except json.JSONDecodeError:
                    pass
        code = process.wait()
        if (folder / "cancel").exists():
            job.update(status="cancelled", message="导出已取消")
            (folder / "video.mp4").unlink(missing_ok=True)
        elif code:
            job.update(
                status="failed",
                message=job.get("message") or "导出失败，请检查本机渲染环境",
            )
        else:
            job.update(
                status="complete",
                progress=100,
                message=(
                    "快速导出完成"
                    if job.get("exportMode") == "fast"
                    else "兼容导出完成"
                )
                + "，可下载 MP4",
            )
    except Exception as e:
        job.update(status="failed", message=str(e))
    finally:
        BUSY.release()


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, *args):
        pass

    def end_headers(self):
        if urlsplit(self.path).path == "/src/canvas-worker.mjs":
            self.send_header(
                "Content-Security-Policy",
                "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'; worker-src 'none'",
            )
        super().end_headers()

    def send_file(self, path, mime, filename=None):
        size = path.stat().st_size
        start = 0
        end = size - 1
        partial = False
        value = self.headers.get("Range")
        if value:
            match = re.fullmatch(r"bytes=(\d*)-(\d*)", value)
            if not match or not any(match.groups()):
                return self.send({"error": "无效的读取范围"}, 416)
            if match[1]:
                start = int(match[1])
                end = min(size - 1, int(match[2])) if match[2] else size - 1
            else:
                start = max(0, size - int(match[2]))
            if not 0 <= start <= end < size:
                return self.send({"error": "读取范围超出文件"}, 416)
            partial = True
        self.send_response(206 if partial else 200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(end - start + 1))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("X-Content-Type-Options", "nosniff")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        if filename:
            self.send_header(
                "Content-Disposition",
                "attachment; filename=\"project.prism\"; filename*=UTF-8''"
                + quote(filename, safe=""),
            )
        self.end_headers()
        if self.command == "HEAD":
            return
        with path.open("rb") as stream:
            stream.seek(start)
            remaining = end - start + 1
            while remaining:
                chunk = stream.read(min(1024 * 1024, remaining))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    break
                remaining -= len(chunk)

    def send(
        self, data, status=200, type="application/json; charset=utf-8", filename=None
    ):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", type)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if filename:
            self.send_header(
                "Content-Disposition", f'attachment; filename="{filename}"'
            )
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(data)

    def allowed(self):
        port = self.server.server_port
        hosts = (f"127.0.0.1:{port}", f"localhost:{port}")
        if self.headers.get("Host") not in hosts:
            return False
        origin = self.headers.get("Origin")
        return not origin or origin in tuple("http://" + h for h in hosts)

    def do_GET(self):
        if not self.allowed():
            return self.send({"error": "仅允许本机编辑器访问"}, 403)
        path = urlsplit(self.path).path
        if path == '/api/recent-imports':
            try: return self.send(RECENT_IMPORTS.list())
            except ValueError as error: return self.send({'error':str(error)},400)
        recent = re.fullmatch(r'/api/recent-imports/([a-f0-9]{24})/project',path)
        if recent:
            try: return self.send(RECENT_IMPORTS.project(recent[1]))
            except ValueError as error: return self.send({'error':str(error)},404)
        source = re.fullmatch(
            r"/api/source-imports/([a-f0-9]{32})(?:/(project))?", path
        )
        if source:
            try:
                if source[2]:
                    return self.send(SOURCE_JOBS.project(source[1]).read_bytes())
                return self.send(SOURCE_JOBS.get(source[1]))
            except ValueError as error:
                return self.send({"error": str(error)}, 404)
        if path == "/api/runtime/canvas-worker":
            return self.send(
                bundle("canvas-worker").encode("utf-8"),
                type="text/javascript; charset=utf-8",
            )
        if path == "/api/health":
            return self.send(
                {
                    "ready": True,
                    "version": "0.4.2",
                    "sourceDiscovery": True,
                    "recentImports": True,
                    "sourceImport": True,
                    "schemaVersions": ["0.2.0", "0.3.0", "0.4.0"],
                    "exportModes": ["auto", "fast", "compatibility"],
                    "ffmpeg": bool(shutil.which("ffmpeg")),
                    "activeExports": sum(
                        j["status"] in ("queued", "running") for j in JOBS.values()
                    ),
                }
            )
        asset = re.fullmatch(r"/api/assets/([a-f0-9]{64})", path)
        if asset:
            try:
                return self.send_file(
                    ASSETS.path(asset[1]), ASSETS.metadata(asset[1])["mime"]
                )
            except ValueError as error:
                return self.send({"error": str(error)}, 404)
        package = re.fullmatch(r"/api/packages/([a-f0-9]{32})", path)
        if package:
            file = ROOT / ".work" / "packages" / (package[1] + ".prism")
            if not file.is_file():
                return self.send({"error": "工程包不存在"}, 404)
            name = parse_qs(urlsplit(self.path).query).get("name", ["project.prism"])[0]
            return self.send_file(file, "application/zip", name)
        match = re.fullmatch(
            r"/api/exports/([a-f0-9]{32})(?:/(project|download))?", path
        )
        if match:
            job = JOBS.get(match[1])
            if not job:
                return self.send({"error": "导出任务不存在"}, 404)
            if match[2] == "project":
                raw = (job["folder"] / "project.json").read_bytes()
                if parse_qs(urlsplit(self.path).query).get("visual") == ["1"]:
                    project = json.loads(raw)
                    project["audioTracks"] = []
                    return self.send(project)
                return self.send(raw)
            if match[2] == "download":
                if job["status"] != "complete":
                    return self.send({"error": "视频尚未生成"}, 409)
                f = job["folder"] / "video.mp4"
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(f.stat().st_size))
                self.send_header(
                    "Content-Disposition", 'attachment; filename="lesson.mp4"'
                )
                self.end_headers()
                with f.open("rb") as data:
                    shutil.copyfileobj(data, self.wfile)
                return
            return self.send({k: v for k, v in job.items() if k != "folder"})
        target = (ROOT / unquote(path).lstrip("/")).resolve()
        if not target.is_relative_to(ROOT) or any(
            x in (".venv", ".work", ".git") for x in target.relative_to(ROOT).parts
        ):
            return self.send({"error": "文件不可访问"}, 403)
        return super().do_HEAD() if self.command == "HEAD" else super().do_GET()

    def do_HEAD(self):
        return self.do_GET()

    def do_POST(self):
        if not self.allowed():
            return self.send({"error": "仅允许本机编辑器访问"}, 403)
        path = urlsplit(self.path).path
        source_cancel = re.fullmatch(r"/api/source-imports/([a-f0-9]{32})/cancel", path)
        if source_cancel:
            try:
                SOURCE_JOBS.cancel(source_cancel[1])
                return self.send({"ok": True})
            except ValueError as error:
                return self.send({"error": str(error)}, 404)
        cancel = re.fullmatch(r"/api/exports/([a-f0-9]{32})/cancel", path)
        if cancel:
            job = JOBS.get(cancel[1])
            if not job:
                return self.send({"error": "任务不存在"}, 404)
            if job["status"] in ("queued", "running"):
                (job["folder"] / "cancel").touch()
            return self.send({"ok": True})
        try:
            count = int(self.headers.get("Content-Length", "0"))
            if path == "/api/source-imports":
                if not 0 < count <= MAX_PACKAGE:
                    raise ValueError("源码包超过 4 GiB")
                with tempfile.TemporaryFile(dir=ROOT / ".work") as package:
                    remaining = count
                    while remaining:
                        chunk = self.rfile.read(min(1024**2, remaining))
                        if not chunk:
                            raise ValueError("源码上传不完整")
                        package.write(chunk)
                        remaining -= len(chunk)
                    package.seek(0)
                    token = SOURCE_JOBS.create(
                        package,
                        unquote(self.headers.get("X-Prism-Source-Name", "源码工程")),
                    )
                return self.send({"id": token})
            if path == "/api/assets":
                if not 0 < count <= MAX_MEDIA:
                    raise ValueError("素材大小无效或超过 2 GiB")
                return self.send(
                    ASSETS.put(
                        self.rfile,
                        count,
                        self.headers.get("X-Prism-Mime", ""),
                        unquote(self.headers.get("X-Prism-Name", "media")),
                    )
                )
            if path == "/api/import":
                if not 0 < count <= MAX_PACKAGE:
                    raise ValueError("工程包超过 4 GiB")
                with tempfile.TemporaryFile(dir=ROOT / ".work") as package:
                    remaining = count
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk:
                            raise ValueError("工程包上传不完整")
                        package.write(chunk)
                        remaining -= len(chunk)
                    package.seek(0)
                    return self.send(ASSETS.import_package(package))
            if not 0 < count <= 200 * 1024 * 1024:
                raise ValueError("文件过大或内容为空")
            raw = self.rfile.read(count)
            d = json.loads(raw.decode("utf-8-sig"))
            check_request(d)
            if path == '/api/recent-imports':
                return self.send({'id':RECENT_IMPORTS.remember(d['project'],d.get('name','工程'),d.get('kind','file'),d.get('location',''))})
            if path == "/api/package":
                token = uuid.uuid4().hex
                folder = ROOT / ".work" / "packages"
                folder.mkdir(exist_ok=True)
                target = folder / (token + ".prism")
                try:
                    ASSETS.write_package(d["project"], target)
                except Exception:
                    target.unlink(missing_ok=True)
                    raise
                return self.send({"url": "/api/packages/" + token})
            if path == "/api/portable":
                return self.send(
                    portable(d["project"]),
                    type="text/html; charset=utf-8",
                    filename="lesson.html",
                )
            if path != "/api/exports":
                return self.send({"error": "接口不存在"}, 404)
            if not BUSY.acquire(blocking=False):
                return self.send({"error": "已有视频正在导出，请完成或取消后重试"}, 409)
            try:
                id = uuid.uuid4().hex
                folder = WORK / id
                folder.mkdir(parents=True, exist_ok=False)
                (folder / "project.json").write_text(
                    json.dumps(d["project"], ensure_ascii=False), encoding="utf-8"
                )
                JOBS[id] = {
                    "id": id,
                    "folder": folder,
                    "status": "queued",
                    "progress": 0,
                    "message": "等待渲染",
                }
                threading.Thread(target=run_job, args=(id, d), daemon=True).start()
            except Exception:
                BUSY.release()
                raise
            return self.send({"id": id}, 202)
        except Exception as e:
            return self.send({"error": str(e)}, 400)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--open", action="store_true")
    args = ap.parse_args()
    PORT = args.port
    WORK.mkdir(parents=True, exist_ok=True)
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    if args.open:
        threading.Timer(
            0.3, lambda: webbrowser.open(f"http://127.0.0.1:{PORT}")
        ).start()
    print(f"Prism: http://127.0.0.1:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        for job in JOBS.values():
            if job["status"] in ("queued", "running"):
                (job["folder"] / "cancel").touch()
        server.server_close()
