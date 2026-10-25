from pathlib import Path
import io, json, sys, tempfile, unittest, zipfile, subprocess
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from asset_store import AssetStore
from package_project import package_directory
import server


class AssetTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            dir=Path(__file__).resolve().parents[1] / ".work"
        )
        self.store = AssetStore(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def test_roundtrip_uses_content_addressed_assets(self):
        data = b"RIFF" + bytes(range(256)) * 400
        r = self.store.put(io.BytesIO(data), len(data), "audio/wav", "中文配音.wav")
        p = {
            "resources": {"voice": r},
            "sources": {},
            "audioTracks": [{"resourceId": "voice"}],
        }
        package = io.BytesIO()
        self.store.write_package(p, package)
        package.seek(0)
        imported = self.store.import_package(package)
        self.assertEqual(
            self.store.path(imported["resources"]["voice"]["assetId"]).read_bytes(),
            data,
        )
        self.assertEqual(imported["audioTracks"], p["audioTracks"])
        self.assertEqual(p["resources"]["voice"], r)

    def test_paths_and_duplicate_entries_are_rejected(self):
        for path in ["../secret.wav", "/root.wav", "C:/root.wav", "assets\\bad.wav"]:
            package = io.BytesIO()
            with zipfile.ZipFile(package, "w") as z:
                z.writestr(
                    "project.json",
                    json.dumps(
                        {"resources": {"a": {"path": path, "mime": "audio/wav"}}}
                    ),
                )
                z.writestr(path, b"data")
            package.seek(0)
            with self.assertRaisesRegex(ValueError, "路径"):
                self.store.import_package(package)

    def test_incomplete_upload_does_not_register_asset(self):
        with self.assertRaisesRegex(ValueError, "不完整"):
            self.store.put(io.BytesIO(b"a"), 5, "audio/wav", "bad")
        self.assertEqual(list(Path(self.temp.name).iterdir()), [])

    def test_unknown_ids_cannot_escape_store(self):
        for value in ["../x", "/etc/passwd", "a" * 64]:
            with self.assertRaises(ValueError):
                self.store.path(value)

    def test_duplicate_manifest_is_rejected(self):
        package = io.BytesIO()
        with zipfile.ZipFile(package, "w") as archive:
            archive.writestr("project.json", "{}")
            with self.assertWarns(UserWarning):
                archive.writestr("project.json", "{}")
        package.seek(0)
        with self.assertRaisesRegex(ValueError, "重复"):
            self.store.import_package(package)

    def test_source_directory_packages_program_and_relative_media(self):
        root = Path(self.temp.name) / "source"
        root.mkdir()
        (root / "program.js").write_text("return {render(){}};", encoding="utf-8")
        (root / "声音.wav").write_bytes(b"RIFF-wave-test")
        project = {
            "schema": "svgfilm-project",
            "schemaVersion": "0.4.0",
            "sources": {"demo": {"programFile": "program.js"}},
            "resources": {
                "voice": {"name": "声音.wav", "mime": "audio/wav", "path": "声音.wav"}
            },
        }
        (root / "project.json").write_text(
            json.dumps(project, ensure_ascii=False), encoding="utf-8"
        )
        output = Path(self.temp.name) / "movie.prism"
        package_directory(root, output)
        with output.open("rb") as stream:
            restored = self.store.import_package(stream)
        self.assertEqual(restored["sources"]["demo"]["program"], "return {render(){}};")
        self.assertNotIn("programFile", restored["sources"]["demo"])
        self.assertEqual(
            self.store.path(restored["resources"]["voice"]["assetId"]).read_bytes(),
            b"RIFF-wave-test",
        )

    def test_source_directory_rejects_program_outside_root(self):
        root = Path(self.temp.name) / "source"
        root.mkdir()
        (root.parent / "outside.js").write_text("ignored", encoding="utf-8")
        project = {
            "schema": "svgfilm-project",
            "schemaVersion": "0.4.0",
            "sources": {"demo": {"programFile": "../outside.js"}},
        }
        (root / "project.json").write_text(json.dumps(project), encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "超出工程目录"):
            package_directory(root, root.parent / "bad.prism")

    def test_offline_bundle_discovers_dependencies_from_registered_modules(self):
        root = Path(self.temp.name) / "bundle"
        (root / "src").mkdir(parents=True)
        (root / "src/dep.mjs").write_text("export const value = 41;", encoding="utf-8")
        (root / "src/entry.mjs").write_text(
            'import { value } from "./dep.mjs"; globalThis.answer = value+1;',
            encoding="utf-8",
        )
        with patch.object(server, "ROOT", root):
            code = server.bundle("entry")
        answer = subprocess.check_output(
            [
                "node",
                "-e",
                code
                + "\nsetImmediate(()=>process.stdout.write(String(globalThis.answer)));",
            ],
            text=True,
        )
        self.assertEqual(answer, "42")

    def test_export_budget_fails_before_creating_an_unreadable_package(self):
        data = b"x" * 4096
        resource = self.store.put(io.BytesIO(data), len(data), "audio/wav", "voice.wav")
        target = Path(self.temp.name) / "too-large.prism"
        with patch("asset_store.MAX_PACKAGE", 2048):
            with self.assertRaisesRegex(ValueError, "容量"):
                self.store.write_package({"resources": {"voice": resource}}, target)
        self.assertFalse(target.exists())


if __name__ == "__main__":
    unittest.main()
