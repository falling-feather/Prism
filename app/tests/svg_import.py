from playwright.sync_api import sync_playwright
import os
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765')
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge');p=b.new_page();p.goto(URL);p.wait_for_function('studio.ready')
    result=p.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><style>.shape{fill:#bb3311;stroke:#111;stroke-width:4px}.label{font-size:36px;fill:#345678}body{background:red}</style><rect class="shape" x="100" y="100" width="100" height="100"/><text class="label" x="100" y="80">修改文字</text></svg>'));const r=document.querySelector('#stage [data-source-id] rect'),t=document.querySelector('#stage [data-source-id] text');return{fill:getComputedStyle(r).fill,size:getComputedStyle(t).fontSize,textFill:getComputedStyle(t).fill,body:getComputedStyle(document.body).backgroundColor};}''')
    assert result['fill']=='rgb(187, 51, 17)',result
    assert result['size']=='36px',result
    assert result['textFill']=='rgb(52, 86, 120)',result
    assert result['body']!='rgb(255, 0, 0)',result
    result=p.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs');const make=w=>svgProject(`<svg xmlns="http://www.w3.org/2000/svg"><defs><rect id="shape" width="${w}" height="20"/></defs><use href="#shape"/></svg>`);let a=make(10),b=make(100);Object.assign(a.sources,b.sources);a.scenes.push(...b.scenes);await studio.loadProject(a);studio.seek(11);return document.querySelectorAll('#stage use')[1].getBBox().width;}''')
    assert result==100,('cross-source ID collision',result)
    result=p.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20"><tspan x="10" dy="0">First</tspan><tspan x="10" dy="30">Second</tspan></text></svg>'));return studio.getProject().scenes[0].texts[0].text;}''')
    assert result=='First\nSecond',('multiline text collapsed',result)
    result=p.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs'),{duplicateScene}=await import('./src/project.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="20" font-size="20"><tspan x="10" dy="0" fill="red">First</tspan><tspan x="10" dy="40" fill="blue">Second</tspan></text></svg>'));const q=studio.getProject();duplicateScene(q,0);q.scenes[1].texts[0].text='Edited';await studio.loadProject(q);studio.seek(11);studio.seek(0);return [...document.querySelectorAll('#stage [data-source-id] tspan')].map(e=>[e.textContent,e.getAttribute('dy'),getComputedStyle(e).fill]);}''')
    assert result==[['First','0','rgb(255, 0, 0)'],['Second','40','rgb(0, 0, 255)']],('return seek changed text layout',result)
    p.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect x="300" y="200" width="200" height="150" fill="red"/></svg>'));}''')
    box=p.locator('#stage [data-source-id] rect').bounding_box();x,y=box['x']+box['width']/2,box['y']+box['height']/2
    p.mouse.move(x,y);p.mouse.down();p.mouse.move(x+24,y+12,steps=4);p.mouse.up()
    overrides=p.evaluate('Object.values(studio.getProject().scenes[0].objectOverrides)')
    assert len(overrides)==1 and overrides[0]['dx']>0 and overrides[0]['dy']>0,overrides
    result=p.evaluate('''async()=>{const {svgProject}=await import('./src/renderer.mjs');const {snapshotProject}=await import('./src/project.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg"><text x="10 100 200" y="30 40 50" font-size="24">ABC</text></svg>'));const renderer=studio.renderer,old=snapshotProject(renderer.project);const id=old.scenes[0].texts[0].objectId;const initial=[renderer.node(id).getAttribute('x'),renderer.node(id).getAttribute('y')];renderer.project.scenes[0].texts[0].text='XYZ';renderer.render(1);renderer.updateProject(old);renderer.render(1);return{initial,restored:[renderer.node(id).getAttribute('x'),renderer.node(id).getAttribute('y')]};}''')
    assert result['initial']==result['restored'],result
    b.close();print('SVG styles, source ID isolation, multiline and coordinate-list restoration: passed')
