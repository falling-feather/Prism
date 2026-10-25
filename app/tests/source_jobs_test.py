from pathlib import Path
import io, tempfile, unittest, zipfile, sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from source_jobs import SourceJobs


class SourceJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(
            dir=Path(__file__).resolve().parents[1] / ".work"
        )
        self.root = Path(self.temp.name)
        self.jobs = SourceJobs(self.root)

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, entries):
        result = io.BytesIO()
        with zipfile.ZipFile(result, "w") as archive:
            for name, data in entries:
                info = zipfile.ZipInfo(name)
                info.filename = name
                archive.writestr(info, data)
        result.seek(0)
        return result

    def test_source_paths_cannot_escape_job_directory(self):
        for name in ["../outside.js", "/outside.js", "C:/outside.js"]:
            with self.assertRaisesRegex(ValueError, "路径"):
                self.jobs.create(self.archive([(name, "bad")]))
            self.assertFalse(self.jobs.busy.locked())
        self.assertFalse((self.root / "outside.js").exists())

    def test_unsupported_files_and_missing_entry_release_import_lock(self):
        for entries in [[("run.exe", "bad")], [("app.js", "code")]]:
            with self.assertRaises(ValueError):
                self.jobs.create(self.archive(entries))
            self.assertFalse(self.jobs.busy.locked())

    def test_cancel_targets_only_the_selected_job(self):
        folder = self.root / "job"
        folder.mkdir()
        self.jobs.jobs["test"] = {"folder": folder, "status": "running"}
        self.jobs.cancel("test")
        self.assertTrue((folder / "cancel").is_file())
        with self.assertRaises(ValueError):
            self.jobs.cancel("unknown")


if __name__ == "__main__":
    unittest.main()
