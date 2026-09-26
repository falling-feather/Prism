"""Structural performance regressions: retained DOM, immutable history and coalesced seeks."""
from pathlib import Path
import json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765')
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge',headless=True);page=b.new_page(viewport={'width':1600,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
    result=page.evaluate('''async()=>{const P=await import('./src/project.mjs');const current=studio.renderer.project;const old=studio.renderer.node(studio.getProject().scenes[0].objects[0].id),p=P.snapshotProject(studio.renderer.project);p.scenes[0].name='独立编辑';studio.renderer.updateProject(p);studio.renderer.render(3);const result={same:old===studio.renderer.node(p.scenes[0].objects[0].id),immutable:Object.isFrozen(p.sources)};studio.renderer.updateProject(current);return result;}''')
    assert result=={'same':True,'immutable':True},result
    # Undo of a text edit should not rebuild all SVG sources or lose the edit.
    page.locator('#toggleInspector').click();page.locator('[data-text-id]').filter(has_text='细胞里面').first.click()
    page.evaluate("window.retainedNode=studio.renderer.node(studio.getProject().scenes[0].objects[0].id)")
    page.locator('#editText').fill('性能验证标题');page.locator('#textSize').click();page.locator('#undoBtn').click()
    assert page.evaluate('retainedNode===studio.renderer.node(studio.getProject().scenes[0].objects[0].id)')
    assert '性能验证标题' not in page.locator('#stage').text_content()
    # Caption DOM is retained until the visible caption or its style changes.
    assert page.evaluate('''()=>{studio.seek(2);const n=document.querySelector('[data-layer="captions"] text');studio.renderer.render(2.1);return n===document.querySelector('[data-layer="captions"] text');}''')
    page.locator('#toggleTimeline').click()
    result=page.evaluate('''async()=>{const r=document.querySelector('#ruler').getBoundingClientRect();const renderer=studio.renderer,original=renderer.render.bind(renderer);let count=0;renderer.render=(...a)=>{count++;return original(...a);};document.querySelector('#ruler').dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,clientX:r.left+8,clientY:r.top+22}));count=0;for(let i=0;i<80;i++)window.dispatchEvent(new PointerEvent('pointermove',{clientX:r.left+10+i/10,clientY:r.top+22}));await new Promise(requestAnimationFrame);window.dispatchEvent(new PointerEvent('pointerup'));renderer.render=original;return {count,time:studio.time};}''')
    assert result['count']<=3,result
    count=page.evaluate('studio.getProject().scenes.length')
    page.locator('#svgInput').set_input_files({'name':'invalid-size.svg','mimeType':'image/svg+xml','buffer':b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><text x="10" y="20" font-size="1">tiny</text></svg>'})
    page.wait_for_function("n=>studio.getProject().scenes.length!==n||document.querySelector('#toast').textContent.includes('字号')",arg=count)
    assert page.evaluate('studio.getProject().scenes.length')==count,'derived text metadata must be validated before commit'
    assert '字号' in page.locator('#toast').text_content()
    assert not errors,errors;b.close();print(json.dumps({'retained_scene_dom':True,'undo_reuses_sources':True,'caption_cache':True,'coalesced_seek':result,'errors':errors}))
