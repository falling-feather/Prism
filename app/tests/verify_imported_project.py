"""Validate supplied source-import outputs without depending on any private project."""
from pathlib import Path
import argparse,json
from playwright.sync_api import sync_playwright

def verify(page, project):
    assert page.evaluate('(p)=>studio.loadProject(p)',project),'载入失败'
    duration=sum(s['out']-s['in']+s.get('hold',0) for s in project['scenes'])
    samples=[min(4,duration/2),duration*.16,duration*.5,duration*.84,duration-.2]
    metrics=[]
    for time in samples:
        page.evaluate('(t)=>studio.renderer.renderAsync(t,{pixelRatio:.5})',time)
        metrics.append(page.evaluate("studio.renderer.sources.get(studio.renderer.position.scene.sourceId).stats()"))
    time=samples[0];page.evaluate('(t)=>studio.renderer.renderAsync(t,{pixelRatio:.5})',time)
    targets=page.evaluate("""()=>{
      const scene=studio.renderer.position.scene,adapter=studio.renderer.sources.get(scene.sourceId),visible=o=>{
        const n=adapter.nodes.get(o.id),r=n?.getBoundingClientRect(),m=n?.closest('[data-motion-id]');
        return m?.style.display!=='none'&&r?.width>2&&r?.height>2&&r.right>0&&r.bottom>0;
      };
      return {object:scene.objects.filter(visible).find(o=>o.label.startsWith('人物'))?.id || scene.objects.filter(visible).at(-1)?.id,
        text:scene.texts.find(t=>visible({id:t.objectId}))?.id,scene:scene.id};
    }""")
    assert targets['object'],targets
    page.evaluate("window.__verifyBaseline=document.querySelector('#stage canvas').getContext('2d').getImageData(0,0,document.querySelector('#stage canvas').width,document.querySelector('#stage canvas').height).data")
    edited=page.evaluate('studio.getProject()');scene=next(s for s in edited['scenes'] if s['id']==targets['scene'])
    scene['objectOverrides'][targets['object']]={'dx':80}
    if targets['text']:next(t for t in scene['texts'] if t['id']==targets['text'])['text']='编辑验证'
    assert page.evaluate('(p)=>studio.loadProject(p)',edited)
    page.evaluate('(t)=>studio.renderer.renderAsync(t,{pixelRatio:.5})',time)
    changed=page.evaluate("""()=>{const c=document.querySelector('#stage canvas'),a=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let n=0;for(let i=0;i<a.length;i++)if(a[i]!==window.__verifyBaseline[i])n++;return n;}""")
    assert changed>100,changed
    saved=page.evaluate('JSON.stringify(studio.getProject())')
    assert page.evaluate('(s)=>studio.loadProject(JSON.parse(s))',saved)
    page.evaluate('(t)=>studio.renderer.renderAsync(t,{pixelRatio:.5})',time)
    page.evaluate('async t=>{studio.renderer.render(t,{presentIntermediate:true});await studio.renderer.whenReady()}',time)
    # Edits keep the complete capture path during playback.
    assert not page.evaluate("studio.renderer.sources.get(studio.renderer.position.scene.sourceId).stats().previewOnly")
    assert page.evaluate('(p)=>studio.loadProject(p)',project)
    page.evaluate('async t=>{studio.renderer.render(t,{presentIntermediate:true});await studio.renderer.whenReady()}',time)
    preview=page.evaluate("studio.renderer.sources.get(studio.renderer.position.scene.sourceId).stats()")
    assert preview['previewOnly']
    page.evaluate('delete window.__verifyBaseline')
    return {'title':project['title'],'changedChannels':changed,'samples':len(samples),'maxProxyObjects':max(m['proxyObjects'] for m in metrics),'sourceObjects':metrics[0]['sourceObjects'],'maxDecodedImages':max(m['decodedImages'] for m in metrics),'maxImageMiB':round(max(m['imageBytes'] for m in metrics)/1024**2,2),'previewRenderMs':round(preview['renderMs'],2),'pausedRenderMs':round(metrics[0]['renderMs'],2)}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('projects',nargs='+',type=Path);parser.add_argument('--url',default='http://127.0.0.1:8893');args=parser.parse_args()
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        try:
            page=browser.new_page(viewport={'width':1440,'height':960});page.goto(args.url);page.wait_for_function('window.studio?.ready',timeout=45000)
            for path in args.projects:print(json.dumps(verify(page,json.loads(path.read_text(encoding='utf-8'))),ensure_ascii=False),flush=True)
        finally:browser.close()
