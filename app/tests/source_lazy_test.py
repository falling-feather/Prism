"""Imported native images decode on demand; proxies and caches remain local to the cut."""
from pathlib import Path
import binascii,json,os,struct,sys,tempfile,unittest,zlib
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from import_canvas_source import import_source
from playwright.sync_api import sync_playwright
APP=Path(__file__).resolve().parents[1]
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8893')
def png(color):
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',binascii.crc32(kind+data)&0xffffffff)
    row=b'\0'+bytes([color,70,120,255])*1024
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1024,1024,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(row*1024))+chunk(b'IEND',b'')
class LazySourceTests(unittest.TestCase):
    def test_image_cache_and_selection_nodes_are_bounded(self):
        with tempfile.TemporaryDirectory(dir=APP/'.work') as temporary:
            root=Path(temporary);source=root/'source';source.mkdir()
            (source/'index.html').write_text('<canvas id="c" width="640" height="360"></canvas><script type="module" src="main.js"></script>',encoding='utf-8')
            for i in range(40):(source/f'{i}.png').write_bytes(png(20+i*5))
            (source/'main.js').write_text("""
const c=document.getElementById('c').getContext('2d'),images=[];
await Promise.all(Array.from({length:40},(_,i)=>new Promise(resolve=>{const im=new Image();im.onload=()=>{images[i]=im;resolve();};im.src=i+'.png';})));
const cached=document.createElement('canvas');cached.width=16;cached.height=16;cached.getContext('2d').drawImage(images[0],0,0,16,16);
const prepared=new Map();
function picture(c,who){if(!prepared.has(who)){const layer=document.createElement('canvas');layer.width=1024;layer.height=1024;prepared.set(who,layer);layer.getContext('2d').drawImage(images[who],0,0);}c.drawImage(prepared.get(who),40,40,280,280);}
window.DUR=40;window.render=t=>{c.clearRect(0,0,640,360);picture(c,Math.min(39,Math.floor(t)));c.drawImage(cached,500,100);};
""",encoding='utf-8')
            output=root/'project.json';import_source(source,output,stage=root/'analysis',scan_step=1)
            project=json.loads(output.read_text(encoding='utf-8'))
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='msedge',headless=True)
                try:
                    page=browser.new_page(viewport={'width':1000,'height':700});page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
                    page.evaluate('(p)=>studio.loadProject(p)',project);page.evaluate('()=>studio.renderer.renderAsync(.1,{pixelRatio:.5})')
                    stats=page.evaluate("studio.renderer.sources.get('imported').stats()")
                    self.assertEqual(stats['decodedImages'],1)
                    self.assertLess(stats['proxyObjects'],stats['sourceObjects'])
                    self.assertLess(stats['pixels'],640*360)
                    for i in range(40):
                        page.evaluate('(t)=>studio.renderer.renderAsync(t+.1)',i)
                        stats=page.evaluate("studio.renderer.sources.get('imported').stats()")
                        self.assertLessEqual(stats['imageBytes'],96*1024**2)
                        self.assertLessEqual(stats['pending'],1)
                        red=page.evaluate("()=>{const c=document.querySelector('#stage canvas');return c.getContext('2d').getImageData(Math.floor(100*c.width/640),Math.floor(100*c.height/360),1,1).data[0]}")
                        self.assertEqual(red,20+i*5)
                    self.assertLessEqual(stats['decodedImages'],24)
                    page.evaluate('async()=>{studio.renderer.render(39.2,{presentIntermediate:true});await studio.renderer.whenReady()}')
                    self.assertTrue(page.evaluate("studio.renderer.sources.get('imported').stats().previewOnly"))
                    page.evaluate('()=>studio.renderer.renderAsync(39.2,{pixelRatio:2})')
                    self.assertEqual(page.locator('#stage canvas').evaluate('(c)=>c.width'),1280)
                    self.assertFalse(page.evaluate("studio.renderer.sources.get('imported').stats().previewOnly"))
                    print(json.dumps({'decodedImages':stats['decodedImages'],'cacheMiB':stats['imageBytes']/1024**2,'proxyObjects':stats['proxyObjects'],'sourceObjects':stats['sourceObjects']}))
                finally:browser.close()
if __name__=='__main__':unittest.main()
