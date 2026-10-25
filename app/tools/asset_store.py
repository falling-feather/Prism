"""Content-addressed local media and portable project packages."""

from pathlib import Path, PurePosixPath
import base64, copy, hashlib, json, os, re, tempfile, zipfile

MAX_PACKAGE = 4 * 1024**3
MAX_MEDIA = 2 * 1024**3
MAX_PROJECT = 120 * 1024**2
MIME = re.compile(
    r"^(image/(png|jpeg|webp|gif)|(?:audio|video|model)/[\w.+-]+|font/(ttf|otf|woff|woff2)|application/(json|octet-stream))$"
)
ASSET_ID = re.compile(r"^[a-f0-9]{64}$")


class AssetStore:
    def __init__(self, root):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True)

    def path(self, asset_id):
        if not isinstance(asset_id, str) or not ASSET_ID.fullmatch(asset_id):
            raise ValueError("素材编号无效")
        path = self.root / (asset_id + ".bin")
        if not path.is_file():
            raise ValueError("本机素材缺失，请重新导入工程包")
        return path

    def put(self, stream, size, mime, name):
        if not MIME.fullmatch(mime or "") or not 0 < size <= MAX_MEDIA:
            raise ValueError("素材类型无效或超过 2 GiB")
        if mime.startswith(("image/", "font/")) and size > 80 * 1024**2:
            raise ValueError("单个图片或字体超过 80 MiB")
        digest = hashlib.sha256()
        file = tempfile.NamedTemporaryFile(dir=self.root, suffix=".tmp", delete=False)
        staging = Path(file.name)
        try:
            with file:
                remaining = size
                while remaining:
                    data = stream.read(min(1024**2, remaining))
                    if not data:
                        raise ValueError("素材数据不完整")
                    file.write(data)
                    digest.update(data)
                    remaining -= len(data)
            asset_id = digest.hexdigest()
            target = self.root / (asset_id + ".bin")
            if target.exists():
                staging.unlink()
            else:
                os.replace(staging, target)
            metadata = {
                "assetId": asset_id,
                "mime": mime,
                "name": str(name)[:255],
                "byteLength": size,
            }
            meta_path = self.root / (asset_id + ".json")
            if not meta_path.exists():
                with tempfile.NamedTemporaryFile(
                    mode="w",
                    encoding="utf-8",
                    dir=self.root,
                    suffix=".tmp",
                    delete=False,
                ) as meta:
                    json.dump(metadata, meta, ensure_ascii=False)
                metadata_staging = Path(meta.name)
                try:
                    os.replace(metadata_staging, meta_path)
                finally:
                    metadata_staging.unlink(missing_ok=True)
            return metadata
        finally:
            staging.unlink(missing_ok=True)

    def metadata(self, asset_id):
        self.path(asset_id)
        return json.loads(
            (self.root / (asset_id + ".json")).read_text(encoding="utf-8")
        )

    def import_package(self, stream):
        with zipfile.ZipFile(stream) as archive:
            entries = archive.infolist()
            names = [x.filename for x in entries]
            if len(names) != len(set(names)) or len(names) > 20000:
                raise ValueError("工程包包含重复条目或条目过多")
            if sum(x.file_size for x in entries) > MAX_PACKAGE:
                raise ValueError("工程包解压后超过 4 GiB")
            manifests = [
                x
                for x in entries
                if x.filename.endswith(".svgfilm.json")
                or x.filename in ("project.json", "project.svgfilm.json")
            ]
            if len(manifests) != 1 or manifests[0].file_size > MAX_PROJECT:
                raise ValueError("工程包须包含唯一且小于 120 MiB 的工程清单")
            project = json.loads(archive.read(manifests[0]).decode("utf-8-sig"))
            resources = project.get("resources", {})
            if not isinstance(resources, dict) or len(resources) > 5000:
                raise ValueError("素材清单无效")
            # Check every path before ingesting any media. Never extract arbitrary archive paths.
            for resource in resources.values():
                value = resource.get("path")
                if not value:
                    if resource.get("assetId"):
                        raise ValueError("可移植工程包缺少素材文件")
                    continue
                path = PurePosixPath(value)
                if (
                    path.is_absolute()
                    or ".." in path.parts
                    or "\\" in value
                    or ":" in value
                    or value not in names
                ):
                    raise ValueError("工程包素材路径无效或文件缺失")
                if resource.get("dataUrl") or resource.get("assetId"):
                    raise ValueError("素材存在重复来源")
                entry = archive.getinfo(value)
                if entry.is_dir() or not 0 < entry.file_size <= MAX_MEDIA:
                    raise ValueError("工程包素材大小无效")
            for key, resource in list(resources.items()):
                if not resource.get("path"):
                    continue
                entry = archive.getinfo(resource["path"])
                with archive.open(entry) as media:
                    resources[key] = self.put(
                        media,
                        entry.file_size,
                        resource["mime"],
                        resource.get("name", key),
                    )
            return project

    def write_package(self, project, target, files=None):
        project = copy.deepcopy(project)
        entries = {}
        total = 0
        for key, resource in project.get("resources", {}).items():
            if not MIME.fullmatch(resource.get("mime", "")):
                raise ValueError("素材类型无效：" + key)
            if files is not None or resource.get("assetId"):
                source = (
                    files[key] if files is not None else self.path(resource["assetId"])
                )
                if files is not None:
                    digest = hashlib.sha256()
                    with source.open("rb") as media:
                        for chunk in iter(lambda: media.read(1024**2), b""):
                            digest.update(chunk)
                    asset_id = digest.hexdigest()
                else:
                    asset_id = resource["assetId"]
                content = source
                size = source.stat().st_size
            else:
                content = base64.b64decode(
                    resource["dataUrl"].split(",", 1)[1], validate=True
                )
                size = len(content)
                asset_id = hashlib.sha256(content).hexdigest()
            if not 0 < size <= MAX_MEDIA:
                raise ValueError("单素材超出容量：" + key)
            if resource["mime"].startswith(("image/", "font/")) and size > 80 * 1024**2:
                raise ValueError("单图片或字体超出容量：" + key)
            name = "assets/" + asset_id
            if name not in entries:
                entries[name] = content
                total += size
            project["resources"][key] = {
                "name": resource["name"],
                "mime": resource["mime"],
                "path": name,
            }
        manifest = json.dumps(project, ensure_ascii=False).encode("utf-8")
        if (
            len(manifest) > MAX_PROJECT
            or total + len(manifest) + 512 * len(entries) + 1024 > MAX_PACKAGE
        ):
            raise ValueError("工程包超出容量，请减少素材后保存")
        with zipfile.ZipFile(
            target,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=1,
            allowZip64=True,
        ) as archive:
            for name, content in entries.items():
                if isinstance(content, Path):
                    archive.write(content, name)
                else:
                    archive.writestr(name, content)
            archive.writestr("project.svgfilm.json", manifest)

    def inline(self, project):
        project = copy.deepcopy(project)
        estimate = len(json.dumps(project, ensure_ascii=False).encode("utf-8"))
        for resource in project.get("resources", {}).values():
            if resource.get("assetId"):
                estimate += (self.path(resource["assetId"]).stat().st_size + 2) // 3 * 4
        if estimate > MAX_PROJECT:
            raise ValueError("素材超过单文件 HTML 容量，请保存工程包或导出 MP4")
        for resource in project.get("resources", {}).values():
            if resource.get("assetId"):
                path = self.path(resource.pop("assetId"))
                resource["dataUrl"] = (
                    "data:"
                    + resource["mime"]
                    + ";base64,"
                    + base64.b64encode(path.read_bytes()).decode("ascii")
                )
        return project
