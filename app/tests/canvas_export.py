"""Portable assets, byte ranges and actual mixed SVG/Canvas MP4 output."""

from pathlib import Path
import io, json, math, os, struct, subprocess, time, urllib.request, wave
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("SVGFILM_URL", "http://127.0.0.1:8765").rstrip("/")
WORK = ROOT / ".work" / "canvas-validation"
WORK.mkdir(exist_ok=True)


def request(path, data=None, headers=None):
    req = urllib.request.Request(URL + path, data=data, headers=headers or {})
    return urllib.request.urlopen(req, timeout=120)


def post(path, value):
    with request(
        path, json.dumps(value).encode(), {"Content-Type": "application/json"}
    ) as response:
        return json.load(response)


buffer = io.BytesIO()
with wave.open(buffer, "wb") as audio:
    audio.setnchannels(1)
    audio.setsampwidth(2)
    audio.setframerate(48000)
    audio.writeframes(
        b"".join(
            struct.pack("<h", int(9000 * math.sin(i * 2 * math.pi * 440 / 48000)))
            for i in range(96000)
        )
    )
wav = buffer.getvalue()
with request(
    "/api/assets", wav, {"X-Prism-Mime": "audio/wav", "X-Prism-Name": "voice.wav"}
) as response:
    resource = json.load(response)
with request(
    "/api/assets/" + resource["assetId"], headers={"Range": "bytes=10-29"}
) as response:
    assert response.status == 206 and response.read() == wav[10:30]
p = json.loads(
    (ROOT / "cases/universal/mixed.svgfilm.json").read_text(encoding="utf-8")
)
for scene in p["scenes"]:
    scene["in"] = 0.2
    scene["out"] = 0.6
p["resources"]["voice"] = resource
p["audioTracks"] = [
    {
        "id": "voice",
        "name": "音轨",
        "resourceId": "voice",
        "kind": "voice",
        "start": 0.1,
        "offset": 0.2,
        "duration": 1,
        "mediaDuration": 2,
        "volume": 0.7,
        "fadeIn": 0,
        "fadeOut": 0,
        "muted": False,
    }
]
with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_function("window.studio?.ready", timeout=45000)
    page.evaluate("(p)=>studio.loadProject(p)", p)
    p = page.evaluate("studio.getProject()")
    p["scenes"][0]["objectOverrides"]["clockwork:o:dial"] = {"dx": 30, "scale": 0.8}
    high = browser.new_page(viewport={"width": 1280, "height": 720})
    high.route(
        "**/api/exports/resolution-check/project?visual=1",
        lambda route: route.fulfill(
            content_type="application/json", body=json.dumps(p)
        ),
    )
    high.goto(URL + "/render.html?job=resolution-check")
    high.wait_for_function("window.exporter?.ready", timeout=45000)
    assert high.evaluate('document.querySelector("canvas").width') == 1280
    assert not errors, errors
    browser.close()
package = post("/api/package", {"project": p})
with request(package["url"]) as response:
    packed = response.read()
with request("/api/import", packed, {"Content-Type": "application/zip"}) as response:
    restored = json.load(response)
assert restored["sources"] == p["sources"] and restored["scenes"] == p["scenes"]
assert restored["audioTracks"][0]["resourceId"] == "voice"
outputs = []
for mode in ["compatibility", "fast"]:
    job = post(
        "/api/exports",
        {"project": restored, "width": 640, "start": 0, "end": 1.2, "exportMode": mode},
    )["id"]
    deadline = time.monotonic() + 90
    while True:
        with request("/api/exports/" + job) as response:
            status = json.load(response)
        if status["status"] in ("complete", "failed", "cancelled"):
            break
        assert time.monotonic() < deadline, status
        time.sleep(0.25)
    assert status["status"] == "complete", status
    out = WORK / f"mixed-{mode}.mp4"
    with request("/api/exports/" + job + "/download") as response:
        out.write_bytes(response.read())
    probe = json.loads(
        subprocess.check_output(
            [
                "ffprobe",
                "-v",
                "error",
                "-count_frames",
                "-show_entries",
                "stream=codec_type,nb_read_frames",
                "-of",
                "json",
                str(out),
            ],
            text=True,
            encoding="utf-8",
        )
    )
    assert (
        next(s for s in probe["streams"] if s["codec_type"] == "video")[
            "nb_read_frames"
        ]
        == "29"
    ), probe
    pcm = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-i",
            str(out),
            "-vn",
            "-f",
            "s16le",
            "-ac",
            "1",
            "-ar",
            "48000",
            "pipe:1",
        ]
    )
    values = struct.unpack("<" + "h" * (len(pcm) // 2), pcm)
    assert max(abs(v) for v in values[12000:20000]) > 3000
    rgb = subprocess.check_output(
        [
            "ffmpeg",
            "-v",
            "error",
            "-ss",
            "0",
            "-i",
            str(out),
            "-frames:v",
            "1",
            "-f",
            "rawvideo",
            "-pix_fmt",
            "rgb24",
            "pipe:1",
        ]
    )
    outputs.append(rgb)
    red = [
        (i // 3 % 640, i // 3 // 640)
        for i in range(0, len(rgb), 3)
        if rgb[i] > 140
        and rgb[i + 1] < 130
        and rgb[i + 2] < 110
        and rgb[i] > rgb[i + 1] * 1.5
    ]
    assert len(red) > 100
    cx = sum(x for x, y in red) / len(red)
    cy = sum(y for x, y in red) / len(red)
    assert abs(cx - (350 + math.sin(math.radians(12)) * 34)) < 3, (cx, cy)
    assert abs(cy - (210 - math.cos(math.radians(12)) * 34)) < 3, (cx, cy)
assert len(outputs[0]) == len(outputs[1]) == 640 * 360 * 3
mae = sum(abs(a - b) for a, b in zip(*outputs)) / len(outputs[0])
assert mae < 3, mae
print(
    json.dumps(
        {
            "package_roundtrip": True,
            "resource_range": True,
            "modes": ["compatibility", "fast"],
            "frames": 29,
            "audio": True,
            "frame_mae": mae,
        }
    )
)
