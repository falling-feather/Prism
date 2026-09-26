"""Compare the fast raster path against DOM capture for supported SVG features."""
from pathlib import Path
import base64,io,json,os,struct,subprocess,zlib
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765').rstrip('/')
def chunk(tag,data):return struct.pack('>I',len(data))+tag+data+struct.pack('>I',zlib.crc32(tag+data)&0xffffffff)
png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0\xff\x00\x00'))+chunk(b'IEND',b'')
svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><defs><linearGradient id="paint"><stop stop-color="red" offset="0"/><stop stop-color="blue" offset="1"/></linearGradient><clipPath id="clip"><rect x="650" y="180" width="100" height="180"/></clipPath></defs><text id="title" x="80" y="100" font-size="40" fill="url(#paint)">透明画布 · 渐变文字 · 图片裁切</text><rect id="gradient" x="80" y="180" width="300" height="180" fill="url(#paint)"/><image id="image" x="650" y="180" width="200" height="180" clip-path="url(#clip)" href="data:image/png;base64,'+base64.b64encode(png).decode()+'"/></svg>'
p={'schema':'svgfilm-project','schemaVersion':'0.3.0','projectId':'visual','title':'visual','canvas':{'width':1280,'height':720,'fps':30,'background':'transparent'},'sources':{'s':{'type':'svg-keyframes-v1','duration':1,'svg':svg,'animations':[]}},'scenes':[{'id':'one','sourceId':'s','name':'one','in':0,'out':1,'hold':0,'objects':[],'texts':[],'objectOverrides':{},'subtitles':[]}],'audioTracks':[]}
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge',headless=True);page=b.new_page(viewport={'width':1280,'height':720});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.route('**/api/exports/*/project?visual=1',lambda route:route.fulfill(status=200,content_type='application/json',body=json.dumps(p)))
    page.goto(URL+'/render.html?job='+'a'*32);page.wait_for_function('window.exporter?.ready')
    page.evaluate('exporter.render(.5)');cdp=page.context.new_cdp_session(page)
    dom=base64.b64decode(cdp.send('Page.captureScreenshot',{'format':'png','fromSurface':True})['data'])
    result=page.evaluate('''async()=>{const result=await exporter.fast.start({width:1280,height:720,start:0,end:1});if(!result.supported)throw Error(result.reason);await exporter.fast.draw(.5);const image=exporter.fast.canvas.toDataURL('image/png').split(',')[1];exporter.fast.close();return image;}''')
    canvas=base64.b64decode(result)
    def pixels(data):return subprocess.check_output(['ffmpeg','-v','error','-i','pipe:0','-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],input=data)
    a,c=pixels(dom),pixels(canvas);assert len(a)==len(c)==1280*720*3
    regions=[(0,0,1280,720),(650,180,850,360),(70,45,1100,110)]
    errors_by_region=[]
    for x0,y0,x1,y1 in regions:
        diffs=[abs(a[(y*1280+x)*3+k]-c[(y*1280+x)*3+k]) for y in range(y0,y1) for x in range(x0,x1) for k in range(3)]
        error=sum(diffs)/len(diffs);assert error<3,error;errors_by_region.append(error)
    assert not errors,errors;b.close();print(json.dumps({'gradient_text_image_clip_transparency_mae':errors_by_region,'errors':errors}))
