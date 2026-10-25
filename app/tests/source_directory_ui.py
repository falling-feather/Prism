"""Users select an original directory; the editor performs parsing and object registration."""

from pathlib import Path
import json, os, tempfile
from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parents[1]
URL = os.environ.get("SVGFILM_URL", "http://127.0.0.1:8765").rstrip("/")
with tempfile.TemporaryDirectory(dir=APP / ".work") as temporary:
    root = Path(temporary) / "原始目录"
    root.mkdir()
    (root / "index.html").write_text(
        '<!doctype html><title>目录导入验证</title><canvas id="c" width="640" height="360"></canvas><script src="app.js"></script>',
        encoding="utf-8",
    )
    (root / "app.js").write_text(
        """const canvas=document.getElementById('c'),c=canvas.getContext('2d');function label(c,s,x,y){c.font='28px sans-serif';c.fillStyle='#26324f';c.fillText(s,x,y);}window.DUR=2;window.render=t=>{c.clearRect(0,0,640,360);c.fillStyle='#b14432';c.fillRect(50+t*10,100,70,90);label(c,'可编辑的源码文字',200,80);};window.READY=true;""",
        encoding="utf-8",
    )
    with sync_playwright() as pw:
        browser = pw.chromium.launch(channel="msedge", headless=True)
        try:
            page = browser.new_page()
            errors = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(URL)
            page.wait_for_function("window.studio?.ready", timeout=45000)
            page.locator("#sourceFolderInput").set_input_files(str(root))
            page.wait_for_function(
                'document.querySelector("#projectTitle").value.includes("目录导入验证")',
                timeout=120000,
            )
            page.locator("#sourceClose").click()
            p = page.evaluate("studio.getProject()")
            assert len(p["scenes"][0]["objects"]) >= 2
            assert p["scenes"][0]["texts"][0]["text"] == "可编辑的源码文字"
            assert p["sources"]["imported"]["files"].get("app.js")
            page.evaluate("async()=>{studio.seek(1);await studio.renderer.whenReady()}")
            page.locator("#toggleInspector").click()
            page.locator('[data-tab="text"]').click()
            page.locator("[data-text-id]").first.click()
            page.locator("#editText").fill("从目录直接修改")
            page.locator("#editText").press("Tab")
            page.evaluate("()=>studio.renderer.whenReady()")
            assert (
                page.evaluate("studio.getProject().scenes[0].texts[0].text")
                == "从目录直接修改"
            )
            tid = page.evaluate("studio.getProject().scenes[0].texts[0].objectId")
            before_height = page.evaluate(
                "(id)=>studio.renderer.node(id).getBoundingClientRect().height", tid
            )
            page.locator("#textSize").fill("42")
            page.locator("#textSize").press("Tab")
            page.evaluate("()=>studio.renderer.whenReady()")
            after_height = page.evaluate(
                "(id)=>studio.renderer.node(id).getBoundingClientRect().height", tid
            )
            assert after_height > before_height * 1.2, (before_height, after_height)
            with page.expect_download() as download:
                page.locator("#saveBtn").click()
            package = Path(temporary) / "源码编辑.prism"
            download.value.save_as(str(package))
            page.locator("#fileInput").set_input_files(str(package))
            page.wait_for_function(
                'studio.ready&&studio.getProject().scenes[0].texts[0].text==="从目录直接修改"',
                timeout=30000,
            )
            assert not errors, errors
        finally:
            browser.close()
print(
    json.dumps(
        {
            "directory_import": True,
            "source_elements": True,
            "editable_text": True,
            "saved_source_files": True,
            "package_roundtrip": True,
            "errors": errors,
        }
    )
)
