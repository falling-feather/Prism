"""The preview must fit its grid allocation and never intercept timeline input."""
from pathlib import Path
import json, os
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765/')
CASES=[(1700,900),(1920,800),(2560,1100),(1366,768),(1280,480),
       (1360,720),(1133,600),(760,700),(390,844)]

with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1700,'height':900})
    errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
    page.goto(URL);page.wait_for_function('window.studio?.ready');page.locator('#toggleTimeline').click();page.evaluate('studio.seek(4.8)')
    results=[]
    for width,height in CASES:
        page.set_viewport_size({'width':width,'height':height})
        geometry=page.evaluate('''async()=>{
          await new Promise(requestAnimationFrame);
          const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();
            return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
          const svg=document.querySelector('#stage'),m=svg.getScreenCTM(),v=svg.viewBox.baseVal;
          const a=new DOMPoint(v.x,v.y).matrixTransform(m),b=new DOMPoint(v.x+v.width,v.y+v.height).matrixTransform(m);
          const timeline=rect('.timeline'),ruler=rect('#ruler');
          const hit=document.elementFromPoint(innerWidth/2,ruler.top+ruler.height/2);
          return {workspace:rect('.workspace'),viewer:rect('.viewer-panel'),area:rect('#stageArea'),
            stage:rect('#stage'),timeline,frame:{left:a.x,top:a.y,right:b.x,bottom:b.y},
            scaleX:m.a,scaleY:m.d,timelineInteractive:!!hit?.closest('.timeline'),bodyWidth:document.body.scrollWidth};
        }''')
        label=f'{width}x{height}'
        assert geometry['viewer']['bottom']<=geometry['timeline']['top']+.5,(label,geometry)
        assert geometry['stage']['bottom']<=geometry['area']['bottom']+.5,(label,geometry)
        assert geometry['frame']['bottom']<=geometry['area']['bottom']+.5,(label,geometry)
        assert geometry['frame']['top']>=geometry['area']['top']-.5,(label,geometry)
        assert geometry['frame']['left']>=geometry['area']['left']-.5,(label,geometry)
        assert geometry['frame']['right']<=geometry['area']['right']+.5,(label,geometry)
        assert abs(geometry['scaleX']-geometry['scaleY'])<.0001,(label,geometry)
        assert geometry['timelineInteractive'],(label,geometry)
        if width>620:assert geometry['timeline']['bottom']<=height+.5,(label,geometry)
        assert geometry['bodyWidth']<=width,(label,geometry)
        results.append(label)
    # Returning to the reported size must not retain an oversized layout.
    page.set_viewport_size({'width':1700,'height':900})
    page.locator('#playBtn').click();page.wait_for_function('studio.time>5.0');page.locator('#playBtn').click()
    page.evaluate('studio.seek(4.8)');page.locator('#splitBtn').click()
    assert page.evaluate('studio.getProject().scenes.length')==19
    # A portrait source must also fit without covering the timeline.
    page.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 1280"><rect width="720" height="1280" fill="#e7e5da"/></svg>'));}''')
    bounds=page.evaluate('''()=>{const s=document.querySelector('#stage'),m=s.getScreenCTM();return{bottom:new DOMPoint(720,1280).matrixTransform(m).y,timeline:document.querySelector('.timeline').getBoundingClientRect().top};}''')
    assert bounds['bottom']<bounds['timeline'],bounds
    assert not errors,errors
    browser.close()
    print(json.dumps({'viewports':results,'timeline_click_play_split':True,'portrait_fit':True,'page_errors':errors}))
