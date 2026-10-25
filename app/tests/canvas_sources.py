"""Real Edge checks for format-independent editing and Canvas programs."""

from pathlib import Path
import json, os, urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("SVGFILM_URL", "http://127.0.0.1:8765").rstrip("/")
WORK = ROOT / ".work" / "canvas-validation"
WORK.mkdir(exist_ok=True)
fixtures = {
    name: json.loads(
        (ROOT / "cases" / "universal" / f"{name}.svgfilm.json").read_text(
            encoding="utf-8"
        )
    )
    for name in ("clockwork", "cards", "mixed")
}

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page(viewport={"width": 1440, "height": 960})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_function("window.studio?.ready", timeout=45000)
    page.evaluate("(p)=>studio.loadProject(p)", fixtures["clockwork"])
    page.evaluate("()=>studio.renderer.whenReady()")
    assert page.evaluate("studio.getProject().scenes[0].objects.length") == 3
    page.evaluate("()=>studio.renderer.renderAsync(1)")
    matrix = '(()=>{const m=studio.renderer.node("clockwork:o:hand").getScreenCTM();return [m.a,m.b,m.c,m.d,m.e,m.f]})()'
    first = page.evaluate(matrix)
    page.evaluate("()=>studio.renderer.renderAsync(3)")
    third = page.evaluate(matrix)
    assert first != third
    page.evaluate("()=>studio.renderer.renderAsync(1)")
    assert first == page.evaluate(matrix)
    # Real hit testing and dragging must preserve the same history behavior as SVG.
    bounds = page.locator('[data-node-id="clockwork:o:dial"]').bounding_box()
    page.mouse.move(bounds["x"] + 20, bounds["y"] + bounds["height"] / 2)
    page.mouse.down()
    page.mouse.move(bounds["x"] + 50, bounds["y"] + bounds["height"] / 2 + 15, steps=5)
    page.mouse.up()
    page.evaluate("()=>studio.renderer.whenReady()")
    assert (
        page.evaluate(
            'studio.getProject().scenes[0].objectOverrides["clockwork:o:dial"].dx'
        )
        > 10
    )
    page.locator("#undoBtn").click()
    page.evaluate("()=>studio.renderer.whenReady()")
    assert (
        page.evaluate(
            'studio.getProject().scenes[0].objectOverrides["clockwork:o:dial"]'
        )
        is None
    )
    # Actual UI selection and typed parameter editing, including history.
    page.locator("#toggleInspector").click()
    page.locator('[data-tab="object"]').click()
    page.locator('[data-object-id="clockwork:o:hand"]').click()
    speed = page.locator('[data-parameter="speed"]')
    speed.fill("2")
    speed.press("Tab")
    page.evaluate("()=>studio.renderer.whenReady()")
    assert (
        page.evaluate(
            'studio.getProject().scenes[0].parameterOverrides["clockwork:o:hand"].speed'
        )
        == 2
    )
    page.locator("#undoBtn").click()
    assert (
        page.evaluate(
            'studio.getProject().scenes[0].parameterOverrides?.["clockwork:o:hand"]?.speed'
        )
        is None
    )
    page.locator("#redoBtn").click()
    assert (
        page.evaluate(
            'studio.getProject().scenes[0].parameterOverrides["clockwork:o:hand"].speed'
        )
        == 2
    )
    page.locator('[data-object-id="clockwork:o:dial"]').click()
    page.locator("#objX").fill("35")
    page.locator("#objX").press("Tab")
    page.evaluate("()=>studio.renderer.whenReady()")
    saved = page.evaluate("studio.getProject()")
    page.evaluate("(p)=>studio.loadProject(p)", saved)
    assert (
        page.evaluate(
            'studio.getProject().scenes[0].objectOverrides["clockwork:o:dial"].dx'
        )
        == 35
    )
    # A structurally different class-based scene with an image resource uses the same adapter.
    page.evaluate("(p)=>studio.loadProject(p)", fixtures["cards"])
    page.locator("#appendInput").set_input_files(
        str(ROOT / "cases/universal/cards.svgfilm.json")
    )
    page.wait_for_function("studio.getProject().scenes.length===2")
    assert page.evaluate(
        "studio.getProject().scenes[0].sourceId!==studio.getProject().scenes[1].sourceId"
    )
    page.locator("#undoBtn").click()
    assert page.evaluate("studio.getProject().scenes.length") == 1
    page.evaluate("()=>studio.renderer.renderAsync(2)")
    snapshot = page.evaluate("studio.renderer.snapshot()")
    assert (
        "<foreignObject" not in snapshot
        and "data:image/png;base64," in snapshot
        and "data-proxies=" not in snapshot
    )
    page.evaluate(
        """async text=>{const p=studio.getProject();p.scenes[0].texts[0].text=text;await studio.loadProject(p);}""",
        "修改后的多行文字\n继续保留动画",
    )
    # Multiple Canvas sources and SVG share one timeline and can seek in arbitrary order.
    page.evaluate("(p)=>studio.loadProject(p)", fixtures["mixed"])
    for t in [1, 8, 14, 2, 9, 15, 1]:
        page.evaluate("(t)=>studio.renderer.renderAsync(t)", t)
    page.evaluate("()=>{studio.seek(1);return studio.renderer.whenReady();}")
    page.locator('[data-object-id="clockwork:o:hand"]').click()
    page.locator("#toggleTimeline").click()
    page.screenshot(path=str(WORK / "mixed-editor.png"))
    # Portable player carries the same worker and resources, without a local service dependency.
    request = urllib.request.Request(
        URL + "/api/portable",
        data=json.dumps({"project": fixtures["mixed"]}).encode(),
        headers={"Content-Type": "application/json"},
    )
    portable = WORK / "mixed.html"
    portable.write_bytes(urllib.request.urlopen(request).read())
    offline = browser.new_page(viewport={"width": 640, "height": 360})
    offline.on("pageerror", lambda error: errors.append(str(error)))
    offline.goto(portable.as_uri())
    offline.wait_for_function(
        'document.querySelector("canvas")?.getContext("2d").getImageData(320,210,1,1).data[3]>0',
        timeout=15000,
    )
    assert not errors, errors
    browser.close()
print(
    json.dumps(
        {
            "canvas_editing": True,
            "parameters_history": True,
            "mixed_seek": True,
            "portable": True,
            "errors": errors,
        }
    )
)
