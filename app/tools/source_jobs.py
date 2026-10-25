"""Managed source-directory analysis jobs. No story-specific import code."""

from pathlib import Path, PurePosixPath
import json, subprocess, sys, threading, uuid, zipfile
from asset_store import MAX_PACKAGE, MAX_PROJECT


class SourceJobs:
    def __init__(self, app):
        self.app = Path(app)
        self.root = self.app / ".work" / "source-imports"
        self.jobs = {}
        self.busy = threading.Lock()

    def create(self, archive, name=None):
        if not self.busy.acquire(blocking=False):
            raise ValueError("已有源码工程正在分析")
        token = uuid.uuid4().hex
        folder = self.root / token
        source = folder / "source"
        try:
            source.mkdir(parents=True)
            with zipfile.ZipFile(archive) as bundle:
                entries = bundle.infolist()
                names = [e.filename for e in entries]
                if (
                    len(names) > 10000
                    or len(set(names)) != len(names)
                    or sum(e.file_size for e in entries) > MAX_PACKAGE
                ):
                    raise ValueError("源码包过大或包含重复路径")
                for entry in entries:
                    path = PurePosixPath(entry.filename)
                    if (
                        path.is_absolute()
                        or ".." in path.parts
                        or "\\" in entry.filename
                        or ":" in entry.filename
                    ):
                        raise ValueError("源码路径超出工程目录")
                    if entry.is_dir():
                        continue
                    target = source.joinpath(*path.parts).resolve()
                    if not target.is_relative_to(source.resolve()):
                        raise ValueError("源码路径无效")
                    if target.suffix.lower() not in {
                        ".html",
                        ".htm",
                        ".css",
                        ".js",
                        ".mjs",
                        ".cjs",
                        ".json",
                        ".png",
                        ".jpg",
                        ".jpeg",
                        ".webp",
                        ".ttf",
                        ".otf",
                        ".woff",
                        ".woff2",
                        ".txt",
                    }:
                        raise ValueError("源码包含不支持的文件类型")
                    if entry.file_size > MAX_PROJECT:
                        raise ValueError("单个源码或素材文件过大")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with bundle.open(entry) as incoming, target.open("wb") as output:
                        import shutil

                        shutil.copyfileobj(incoming, output, 1024**2)
            if not (source / "index.html").is_file():
                raise ValueError("工程根目录缺少 index.html")
            self.jobs[token] = {
                "status": "queued",
                "progress": 5,
                "message": "正在解析源码与素材",
                "folder": folder,
                "name": str(name or "源码工程")[:200],
            }
            threading.Thread(target=self.run, args=(token,), daemon=True).start()
            return token
        except Exception:
            self.busy.release()
            raise

    def run(self, token):
        job = self.jobs[token]
        folder = job["folder"]
        job["status"] = "running"
        try:
            command = [
                sys.executable,
                "-X",
                "utf8",
                str(self.app / "tools/import_canvas_source.py"),
                str(folder / "source"),
                "--out",
                str(folder / "project.json"),
                "--stage",
                str(folder / "analysis"),
                "--cancel",
                str(folder / "cancel"),
                "--source-name=" + job["name"],
            ]
            with (folder / "analysis.log").open("w", encoding="utf-8") as log:
                process = subprocess.Popen(
                    command,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding="utf-8",
                    cwd=self.app.parent,
                )
                for line in process.stdout:
                    log.write(line)
                    log.flush()
                    try:
                        data = json.loads(line)
                        if "shot" in data:
                            job.update(
                                progress=10 + 85 * data["shot"] / data["total"],
                                message=f"分析镜头 {data['shot']} / {data['total']}，识别 {data['objects']} 个对象",
                            )
                        if "output" in data:
                            job["result"] = {
                                k: v for k, v in data.items() if k != "output"
                            }
                    except json.JSONDecodeError:
                        pass
                code = process.wait()
            if (folder / "cancel").exists():
                job.update(status="cancelled", message="源码分析已取消")
            elif code:
                lines = (
                    (folder / "analysis.log").read_text(encoding="utf-8").splitlines()
                )
                detail = next(
                    (line for line in reversed(lines) if line.strip()), "分析失败"
                )
                job.update(status="failed", message=detail[-600:])
            else:
                job.update(
                    status="complete",
                    progress=100,
                    message="源码元素已识别，可开始编辑",
                )
        except Exception as error:
            job.update(status="failed", message=str(error))
        finally:
            self.busy.release()

    def get(self, token):
        job = self.jobs.get(token)
        if not job:
            raise ValueError("源码分析任务不存在")
        return {key: value for key, value in job.items() if key != "folder"}

    def project(self, token):
        job = self.jobs.get(token)
        if not job or job["status"] != "complete":
            raise ValueError("源码工程尚未完成分析")
        return job["folder"] / "project.json"

    def cancel(self, token):
        job = self.jobs.get(token)
        if not job:
            raise ValueError("源码分析任务不存在")
        (job["folder"] / "cancel").touch()
