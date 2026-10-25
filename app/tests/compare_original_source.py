"""Compare imported frames to the unchanged real HTML entry, including native image caches."""
from functools import partial
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import argparse,base64,json
from playwright.sync_api import sync_playwright

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

def compare(browser, editor, source, project):
    server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(source.resolve())))
    thread=Thread(target=server.serve_forever,daemon=True);thread.start()
    original=browser.new_page(viewport={'width':1920,'height':1080})
    page_errors=[];failed=[]
    original.on('pageerror',lambda error:page_errors.append(str(error)))
    original.on('response',lambda response:failed.append({'status':response.status,'path':response.url.split('/',3)[-1]}) if response.status>=400 else None)
    try:
        original.goto(f'http://127.0.0.1:{server.server_port}/')
        try:original.wait_for_function('window.READY && typeof window.render==="function"',timeout=60000)
        except Exception:
            print(json.dumps({'source':source.name,'originalErrors':page_errors[:3],'failedRequests':failed[:3]}),flush=True)
            raise
        original.evaluate('()=>document.fonts.ready')
        original.evaluate('()=>window.render(0)')
        assert editor.evaluate('(p)=>studio.loadProject(p)',project)
        duration=original.evaluate('window.DUR');width=original.locator('canvas').first.evaluate('(c)=>c.width')
        errors=[]
        for time in [min(4,duration/2),duration*.5,duration-.2]:
            original.evaluate('(t)=>window.render(t)',time)
            editor.evaluate('input=>studio.renderer.renderAsync(input.time,{outputWidth:input.width})',{'time':time,'width':width})
            read="""selector=>{const source=document.querySelector(selector),c=document.createElement('canvas');c.width=256;c.height=144;const g=c.getContext('2d');g.drawImage(source,0,0,256,144);return [...g.getImageData(0,0,256,144).data]}"""
            a=original.evaluate(read,'canvas');b=editor.evaluate(read,'#stage canvas')
            error=sum(abs(x-y) for x,y in zip(a,b))/len(a);errors.append(round(error,4))
            if error>1:
                work=Path(__file__).resolve().parents[1]/'.work'/'native-comparison';work.mkdir(exist_ok=True)
                for label,page,selector in [('original',original,'canvas'),('imported',editor,'#stage canvas')]:
                    data=page.evaluate("selector=>document.querySelector(selector).toDataURL('image/png').split(',')[1]",selector)
                    (work/(source.name+'-'+label+'.png')).write_bytes(base64.b64decode(data))
            assert error<=1,{'source':source.name,'time':time,'nativeMAE':error}
        return {'source':source.name,'realHtmlSamples':3,'nativeMAE':errors}
    finally:
        original.close();server.shutdown();server.server_close()

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--sources',nargs='+',required=True,type=Path);parser.add_argument('--projects',nargs='+',required=True,type=Path);parser.add_argument('--url',default='http://127.0.0.1:8893');args=parser.parse_args()
    assert len(args.sources)==len(args.projects)
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        try:
            editor=browser.new_page();editor.goto(args.url);editor.wait_for_function('window.studio?.ready',timeout=45000)
            for source,path in zip(args.sources,args.projects):print(json.dumps(compare(browser,editor,source,json.loads(path.read_text(encoding='utf-8')))),flush=True)
        finally:browser.close()
