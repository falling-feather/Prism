"""Large audio stays outside editable JSON and is included in portable packages."""

from pathlib import Path
import json, os, wave, zipfile
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("SVGFILM_URL", "http://127.0.0.1:8765").rstrip("/")
WORK = ROOT / ".work" / "canvas-validation"
WORK.mkdir(exist_ok=True)
media = WORK / "large-audio.wav"
package = WORK / "large-media.prism"
with wave.open(str(media), "wb") as audio:
    audio.setnchannels(2)
    audio.setsampwidth(2)
    audio.setframerate(48000)
    for _ in range(50):
        audio.writeframes(b"\0" * (48000 * 4))
assert media.stat().st_size > 8 * 1024**2
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_function("window.studio?.ready", timeout=45000)
    p = json.loads(
        (ROOT / "cases/universal/clockwork.svgfilm.json").read_text(encoding="utf-8")
    )
    page.evaluate("(p)=>studio.loadProject(p)", p)
    page.locator("#audioInput").set_input_files(str(media))
    page.wait_for_function("studio.getProject().audioTracks.length===1", timeout=30000)
    result = page.evaluate("studio.getProject()")
    track = result["audioTracks"][0]
    assert track.get("resourceId") and "dataUrl" not in track
    assert len(json.dumps(result).encode()) < 20000
    with page.expect_download() as downloaded:
        page.locator("#saveBtn").click()
    downloaded.value.save_as(str(package))
    with zipfile.ZipFile(package) as archive:
        manifest = json.loads(archive.read("project.svgfilm.json"))
        path = manifest["resources"][track["resourceId"]]["path"]
        assert archive.getinfo(path).file_size == media.stat().st_size
    page.locator("#fileInput").set_input_files(str(package))
    page.wait_for_function(
        'studio.getProject().audioTracks.length===1 && document.querySelector("#toast").textContent.includes("工程已导入")',
        timeout=30000,
    )
    assert not errors, errors
    browser.close()
print(
    json.dumps(
        {
            "large_audio_bytes": media.stat().st_size,
            "metadata_bytes": len(json.dumps(result).encode()),
            "package_roundtrip": True,
            "errors": errors,
        }
    )
)
