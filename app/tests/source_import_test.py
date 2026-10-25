"""Two unrelated Canvas source layouts must become editable without adding source-specific branches."""

from pathlib import Path
import base64, binascii, json, os, struct, sys, tempfile, unittest, zlib

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
from import_canvas_source import import_source
from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parents[1]
URL = os.environ.get("SVGFILM_URL", "http://127.0.0.1:8765").rstrip("/")
PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg=="
)


class SourceImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=APP / ".work")
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def fixture(self, name, code):
        root = self.root / name
        root.mkdir()
        (root / "index.html").write_text(
            '<!doctype html><canvas id="c" width="640" height="360"></canvas><script type="module" src="app.js"></script>',
            encoding="utf-8",
        )
        (root / "app.js").write_text(code, encoding="utf-8")
        return root

    def test_conditional_image_group_and_cached_buffer_keep_pixels_and_hierarchy(self):
        root=self.fixture('conditional',"""
const c=document.getElementById('c').getContext('2d');let cache;
const im=new Image();await new Promise(resolve=>{im.onload=resolve;im.src='pixel.png';});
function shape(c){c.fillStyle='#dd3322';c.fillRect(100,100,70,90);}
function group(c,t){
 if(t<.8 && !cache){cache=document.createElement('canvas');cache.width=640;cache.height=360;const g=cache.getContext('2d');g.fillStyle='#228844';g.fillRect(0,0,640,360);}
 if(cache)c.drawImage(cache,0,0);else{c.fillStyle='#228844';c.fillRect(0,0,640,360);}
 shape(c);if(t>1)c.drawImage(im,400,0,1,1);
}
window.DUR=3;window.render=t=>{c.clearRect(0,0,640,360);group(c,t);};
""")
        def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',binascii.crc32(kind+data)&0xffffffff)
        (root/'pixel.png').write_bytes(b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\xff\xff\xff'))+chunk(b'IEND',b''))
        output=self.root/'conditional.json';import_source(root,output,stage=self.root/'analysis')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='msedge',headless=True)
            try:
                page=browser.new_page();page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
                self.assertTrue(page.evaluate('(p)=>studio.loadProject(p)',json.loads(output.read_text(encoding='utf-8'))))
                for time in [.2,2.3,.3]:
                    page.evaluate('(t)=>studio.renderer.renderAsync(t,{pixelRatio:1})',time)
                    self.assertEqual(page.evaluate("[...document.querySelector('#stage canvas').getContext('2d').getImageData(20,20,1,1).data]"),[34,136,68,255])
            finally:browser.close()

    def test_exact_first_frame_objects_are_registered(self):
        root=self.fixture('first-frame',"""
const c=document.getElementById('c').getContext('2d');
window.DUR=1;window.render=t=>{c.clearRect(0,0,640,360);if(t===0){c.fillStyle='#bb3322';c.fillRect(10,10,60,60);}else{c.fillStyle='#225577';c.fillRect(200,100,80,80);}};
""")
        output=self.root/'first.json';report=import_source(root,output,stage=self.root/'first-analysis')
        self.assertEqual(report['objects'],2)
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='msedge',headless=True)
            try:
                page=browser.new_page();page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
                self.assertTrue(page.evaluate('(p)=>studio.loadProject(p)',json.loads(output.read_text(encoding='utf-8'))))
                page.evaluate('()=>studio.renderer.renderAsync(0)')
            finally:browser.close()

    def test_measurement_and_segment_recycling_preserve_native_canvas_styles(self):
        root=self.fixture('style-state',"""
const c=document.getElementById('c').getContext('2d');c.textBaseline='middle';
window.DUR=17;window.render=t=>{c.clearRect(0,0,640,360);if(t<1)c.textBaseline=t===0?'middle':'top';c.fillStyle=c.textBaseline==='middle'?'#dd3322':'#2244aa';c.fillRect(40,40,100,100);};
""")
        output=self.root/'styles.json';import_source(root,output,stage=self.root/'style-analysis')
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='msedge',headless=True)
            try:
                page=browser.new_page();page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
                self.assertTrue(page.evaluate('(p)=>studio.loadProject(p)',json.loads(output.read_text(encoding='utf-8'))))
                red=page.evaluate("document.querySelector('#stage canvas').getContext('2d').getImageData(80,80,1,1).data[0]")
                self.assertEqual(red,221)
                for time in [.5,16]:
                    page.evaluate('(t)=>studio.renderer.renderAsync(t,{pixelRatio:1})',time)
                    self.assertEqual(page.evaluate("[...document.querySelector('#stage canvas').getContext('2d').getImageData(80,80,1,1).data]"),[34,68,170,255])
            finally:browser.close()

    def test_direct_text_inside_an_image_helper_is_independently_editable(self):
        root=self.fixture('nested-labels',"""
const c=document.getElementById('c').getContext('2d'),layer=document.createElement('canvas');layer.width=640;layer.height=360;layer.getContext('2d').fillRect(0,0,640,360);
function panel(c){c.drawImage(layer,0,0);c.font='28px sans-serif';c.fillStyle='#ffffff';c.fillText('First label',100,100);c.fillText('Second label',100,160);}
window.DUR=2;window.render=t=>{c.clearRect(0,0,640,360);panel(c);};
""")
        output=self.root/'labels.json';report=import_source(root,output,stage=self.root/'label-analysis')
        self.assertEqual(report['texts'],2)
        project=json.loads(output.read_text(encoding='utf-8'))
        self.assertEqual({o['text']['text'] for o in project['sources']['imported']['objects'] if 'text' in o},{'First label','Second label'})

    def test_helpers_and_compositing_keep_editable_objects(self):
        helper = self.fixture(
            "helper",
            """
const canvas=document.getElementById('c'),c=canvas.getContext('2d');
function person(c,who,x,y){c.fillStyle='#d34532';c.fillRect(x,y,70,100);return 70;}
function label(c,s,x,y,size=28,col='#26324f'){c.font=size+'px sans-serif';c.fillStyle=col;c.fillText(s,x,y);return c.measureText(s).width;}
window.DUR=3;window.render=t=>{c.clearRect(0,0,640,360);const w=person(c,'hero',80+t*12,100);label(c,'Source text',w+220,75);};window.READY=true;
""",
        )
        buffered = self.fixture(
            "buffered",
            """
const canvas=document.getElementById('c'),c=canvas.getContext('2d');
const layer=document.createElement('canvas');layer.width=640;layer.height=360;const a=layer.getContext('2d');
window.DUR=3;window.render=t=>{
 a.clearRect(0,0,640,360);a.fillStyle='#315f74';a.fillRect(40,100,70,80);
 a.font='26px sans-serif';a.strokeStyle='#ffffff';a.strokeText('Buffered text',160,90);a.fillStyle='#26324f';a.fillText('Buffered text',160,90);
 a.beginPath();a.moveTo(80,250);a.lineTo(250,250);a.lineWidth=5;a.strokeStyle='#d34532';a.stroke();
 c.clearRect(0,0,640,360);c.save();c.translate(t*10,0);c.drawImage(layer,0,0);c.restore();
};window.READY=true;
""",
        )
        outputs = []
        for root in [helper, buffered]:
            output = self.root / (root.name + ".svgfilm.json")
            report = import_source(
                root, output, stage=self.root / (root.name + "-stage"), scan_step=1
            )
            self.assertGreaterEqual(report["objects"], 2)
            self.assertGreaterEqual(report["texts"], 1)
            outputs.append(json.loads(output.read_text(encoding="utf-8")))
        with sync_playwright() as pw:
            browser = pw.chromium.launch(channel="msedge", headless=True)
            try:
                page = browser.new_page(viewport={"width": 1440, "height": 960})
                page.goto(URL)
                page.wait_for_function("window.studio?.ready", timeout=45000)
                for project in outputs:
                    page.evaluate("(p)=>studio.loadProject(p)", project)
                    page.evaluate(
                        "async()=>{studio.seek(1);await studio.renderer.whenReady()}"
                    )
                    objects = page.evaluate("studio.getProject().scenes[0].objects")
                    self.assertGreaterEqual(len(objects), 2)
                    text = page.evaluate("studio.getProject().scenes[0].texts[0]")
                    page.evaluate(
                        """async input=>{const p=studio.getProject();p.scenes[0].texts[0].text='Edited source';const target=p.scenes[0].objects.find(o=>o.id===input.objectId);p.scenes[0].objectOverrides[target.id]={dx:25};await studio.loadProject(p);await studio.renderer.renderAsync(1);}""",
                        text,
                    )
                    self.assertEqual(
                        page.evaluate(
                            '(id)=>studio.renderer.node(id).getAttribute("data-source-text")',
                            text["objectId"],
                        ),
                        "Edited source",
                    )
                    if project["title"].startswith("buffered"):
                        rect = next(
                            o
                            for o in page.evaluate(
                                "studio.getProject().scenes[0].objects"
                            )
                            if o["label"] == "图解 · fillRect"
                        )
                        read_pixel = """xy=>{const c=document.querySelector('#stage canvas');return [...c.getContext('2d').getImageData(Math.floor(xy[0]*c.width/640),Math.floor(xy[1]*c.height/360),1,1).data]}"""
                        page.evaluate("()=>studio.renderer.renderAsync(1)")
                        self.assertEqual(page.evaluate(read_pixel, [55, 140])[3], 255)
                        page.evaluate(
                            """async id=>{const p=studio.getProject();p.scenes[0].objectOverrides[id]={dx:25};await studio.loadProject(p);await studio.renderer.renderAsync(1);}""",
                            rect["id"],
                        )
                        self.assertEqual(page.evaluate(read_pixel, [55, 140])[3], 0)
                        self.assertEqual(page.evaluate(read_pixel, [135, 140])[3], 255)
                    self.assertIn(
                        "translate(25 ",
                        page.evaluate(
                            '(id)=>studio.renderer.wrapper(id).getAttribute("transform")',
                            text["objectId"],
                        ),
                    )
                    saved = page.evaluate("JSON.stringify(studio.getProject())")
                    page.evaluate("(s)=>studio.loadProject(JSON.parse(s))", saved)
                    self.assertEqual(
                        page.evaluate("studio.getProject().scenes[0].texts[0].text"),
                        "Edited source",
                    )
            finally:
                browser.close()


if __name__ == "__main__":
    unittest.main()
