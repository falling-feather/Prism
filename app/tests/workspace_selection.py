"""Teacher workspace controls and real pointer batch editing, including nested groups."""
from pathlib import Path
from playwright.sync_api import sync_playwright
import json, os
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765/')
SVG='''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600">
<g id="left"><rect id="left-part" x="100" y="100" width="80" height="80" fill="#46735c"/></g>
<g id="right" transform="translate(300 0)"><rect id="right-part" x="100" y="100" width="80" height="80" fill="#b36543"/></g>
<rect id="outside" x="750" y="300" width="70" height="70" fill="#657ead"/></svg>'''
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1700,'height':950})
    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.wait_for_function('window.studio?.ready')
    assert page.locator('#toggleTimeline').count()==1,'timeline must be collapsible'
    assert not page.locator('.timeline-layout').is_visible()
    assert not page.locator('.inspector-panel').is_visible()
    page.locator('#toggleTimeline').click()
    before=page.locator('.timeline').bounding_box()['height']
    grip=page.locator('#timelineResize').bounding_box();x=grip['x']+grip['width']/2;y=grip['y']+3
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x,y-150,steps=5);page.mouse.up()
    after=page.locator('.timeline').bounding_box()['height'];assert after>before+130,(before,after)
    page.locator('#toggleTimeline').click();assert page.locator('.timeline').bounding_box()['height']<80
    page.locator('#toggleTimeline').click();assert abs(page.locator('.timeline').bounding_box()['height']-after)<2
    page.reload();page.wait_for_function('window.studio?.ready');assert abs(page.locator('.timeline').bounding_box()['height']-after)<2
    page.locator('#toggleTimeline').click()
    page.locator('#toggleScenes').click();assert not page.locator('.scenes-panel').is_visible()
    page.locator('#toggleScenes').click()
    page.evaluate('''async svg=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject(svg,'框选测试'));}''',SVG)
    def point(x,y):return page.evaluate('''([x,y])=>{const p=new DOMPoint(x,y).matrixTransform(document.querySelector('#stage').getScreenCTM());return{x:p.x,y:p.y};}''',[x,y])
    def boxes():return page.evaluate('''()=>Object.fromEntries(['left','right'].map(label=>{const s=studio.getProject().scenes[0],o=s.objects.find(o=>o.label===label),r=studio.renderer.node(o.id).getBoundingClientRect();return[label,{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}]}))''')
    page.locator('#marqueeMode').click();a=point(70,70);b=point(500,220)
    page.mouse.move(a['x'],a['y']);page.mouse.down();page.mouse.move(b['x'],b['y'],steps=7);page.mouse.up()
    assert page.locator('#selectedCount').inner_text().startswith('已选 2'),page.locator('#selectedCount').inner_text()
    assert page.locator('.selection-item').count()==2
    page.locator('#selectMode').click();outside=point(785,335)
    page.keyboard.down('Shift');page.mouse.click(outside['x'],outside['y']);page.keyboard.up('Shift')
    assert page.locator('#selectedCount').inner_text().startswith('已选 3')
    page.keyboard.down('Shift');page.mouse.click(outside['x'],outside['y']);page.keyboard.up('Shift')
    assert page.locator('#selectedCount').inner_text().startswith('已选 2')
    original=boxes()
    page.locator('#scaleMode').select_option('individual');page.locator('#selectionScale').fill('150');page.locator('#applySelectionScale').click()
    separate=boxes()
    for key in original:
        assert abs(separate[key]['x']-original[key]['x'])<1
        assert abs(separate[key]['y']-original[key]['y'])<1
        assert abs(separate[key]['w']/original[key]['w']-1.5)<.01
    page.locator('#scaleMode').select_option('group');page.locator('#selectionScale').fill('150');page.locator('#applySelectionScale').click()
    grouped=boxes();assert abs((grouped['right']['x']-grouped['left']['x'])/(separate['right']['x']-separate['left']['x'])-1.5)<.01
    # Dragging the selection label moves both objects by the same screen delta.
    label=page.locator('#selectionLabel').bounding_box();x=label['x']+label['width']/2;y=label['y']+label['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+35,y+20,steps=5);page.mouse.up()
    moved=boxes()
    for key in grouped:assert abs(moved[key]['x']-grouped[key]['x']-35)<1 and abs(moved[key]['y']-grouped[key]['y']-20)<1
    assert len(page.evaluate('Object.keys(studio.getProject().scenes[0].objectOverrides)'))==2,'nested parts must not receive a second transform'
    page.locator('#undoBtn').click();undone=boxes()
    for key in grouped:assert abs(undone[key]['x']-grouped[key]['x'])<1
    page.locator('#redoBtn').click()
    page.locator('#editSelection').click();assert page.locator('.inspector-panel').is_visible()
    assert page.locator('#batchMoveX').is_visible()
    page.locator('#toggleInspector').click()
    with page.expect_download() as event:page.locator('#saveBtn').click()
    file=ROOT/'.work/batch-edited.svgfilm.json';event.value.save_as(str(file))
    saved=json.loads(file.read_text(encoding='utf-8'))
    page.reload();page.wait_for_function('window.studio?.ready');page.locator('#fileInput').set_input_files(str(file));page.wait_for_function("studio.getProject().title==='框选测试'")
    assert page.evaluate('studio.getProject().scenes[0].objectOverrides')==saved['scenes'][0]['objectOverrides']
    page.screenshot(path=str(ROOT/'.work/workspace-batch.png'))
    deep_svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><g id="compound" transform="translate(200 140) rotate(30) scale(1.5 .75)"><rect id="a" width="60" height="50" fill="red"/><rect id="b" x="100" width="60" height="50" fill="blue"/></g><line id="line" x1="100" y1="400" x2="200" y2="400" stroke="black" stroke-width="3"/></svg>'
    page.evaluate('''async svg=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject(svg));}''',deep_svg)
    def box_for(label):return page.evaluate('''label=>{const s=studio.getProject().scenes[0],id=s.objects.find(o=>o.label===label).id,r=studio.renderer.node(id).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,left:r.left,top:r.top,right:r.right,bottom:r.bottom,w:r.width};}''',label)
    def marquee_rect(r):
        page.locator('#marqueeMode').click();page.mouse.move(r['left']-3,r['top']-3);page.mouse.down();page.mouse.move(r['right']+3,r['bottom']+3,steps=5);page.mouse.up()
    page.locator('#deepSelect').check();marquee_rect(box_for('compound'))
    assert page.locator('#selectedCount').inner_text().startswith('已选 2')
    original={k:box_for(k) for k in ('a','b')}
    label=page.locator('#selectionLabel').bounding_box();x=label['x']+8;y=label['y']+8
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y+18,steps=5);page.mouse.up()
    moved={k:box_for(k) for k in ('a','b')}
    for k in original:assert abs(moved[k]['x']-original[k]['x']-30)<1 and abs(moved[k]['y']-original[k]['y']-18)<1
    page.locator('#scaleMode').select_option('individual');page.locator('#selectionScale').fill('130');page.locator('#applySelectionScale').click()
    scaled={k:box_for(k) for k in ('a','b')}
    for k in moved:assert abs(scaled[k]['x']-moved[k]['x'])<1 and abs(scaled[k]['y']-moved[k]['y'])<1 and abs(scaled[k]['w']/moved[k]['w']-1.3)<.01
    before_cancel=page.evaluate('studio.getProject().scenes[0].objectOverrides')
    for key in ('Escape','Control+z'):
        label=page.locator('#selectionLabel').bounding_box();x=label['x']+8;y=label['y']+8
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+20,y+10,steps=3);page.keyboard.press(key);page.mouse.up()
        assert page.evaluate('studio.getProject().scenes[0].objectOverrides')==before_cancel,('gesture cancellation',key)
    for key in ('Escape','Control+z'):
        page.locator('#selectionScale').focus()
        label=page.locator('#selectionLabel').bounding_box();x=label['x']+8;y=label['y']+8
        page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+20,y+10,steps=3);page.keyboard.press(key);page.mouse.up()
        assert page.evaluate('studio.getProject().scenes[0].objectOverrides')==before_cancel,('focused-input gesture cancellation',key)
    page.locator('#deepSelect').uncheck();marquee_rect(box_for('a'))
    assert page.locator('#selectedCount').inner_text().startswith('已选 1')
    assert page.locator('#selectionLabel').inner_text()=='a','a fully enclosed child remains selectable when its parent is only partly enclosed'
    marquee_rect(box_for('line'));assert page.locator('#selectedCount').inner_text().startswith('已选 1')
    assert page.locator('#selectionLabel').inner_text()=='line'
    page.set_viewport_size({'width':390,'height':844});page.locator('#toggleTimeline').click();page.locator('#timelineResize').focus();page.keyboard.press('End')
    page.wait_for_timeout(100)
    assert page.locator('#stage').bounding_box()['height']>=100,'maximal timeline must reserve a usable canvas even with wrapped selection tools'
    page.locator('#clearSelection').click();page.locator('#timelineResize').focus();page.keyboard.press('End')
    page.locator('#selectMode').click();r=box_for('a');page.mouse.click(r['x'],r['y'])
    page.wait_for_timeout(100)
    assert page.locator('#stage').bounding_box()['height']>=100,'selecting a component must recompute the timeline height limit'
    page.set_viewport_size({'width':1700,'height':950});page.locator('#toggleTimeline').click()
    ghost='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><g id="component"><rect id="visible" x="100" y="100" width="80" height="80" fill="red"/><rect x="700" y="100" width="80" height="80" fill="blue" opacity="0"/></g></svg>'
    page.evaluate('''async svg=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject(svg));}''',ghost)
    r=box_for('visible');page.mouse.click(r['x'],r['y']);assert page.locator('#selectionLabel').inner_text()=='component'
    r=box_for('visible');page.locator('#scaleMode').select_option('individual');page.locator('#selectionScale').fill('150');page.locator('#applySelectionScale').click();after=box_for('visible')
    assert abs(after['x']-r['x'])<1 and abs(after['y']-r['y'])<1,('invisible child shifted visible center',r,after)
    page.evaluate('''async()=>{const{svgProject}=await import('./src/renderer.mjs');await studio.loadProject(svgProject('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 600"><text x="100" y="100" font-size="30">原文本</text><rect id="block" x="300" y="200" width="100" height="100" fill="green"/></svg>'));}''')
    if not page.locator('.inspector-panel').is_visible():page.locator('#toggleInspector').click()
    page.get_by_role('button',name='文字',exact=True).click();page.get_by_role('button',name='原文本',exact=True).click();page.locator('#editText').fill('保留此次修改')
    r=box_for('block');page.mouse.click(r['x'],r['y'])
    assert page.evaluate('studio.getProject().scenes[0].texts[0].text')=='保留此次修改','canvas selection must commit pending text input before rebuilding the inspector'
    page.locator('#closeInspector').click();r=box_for('block');page.mouse.dblclick(r['x'],r['y'])
    assert page.locator('.inspector-panel').is_visible() and page.locator('#deepSelect').is_checked()
    r=box_for('block');handle=page.locator('#resizeHandle').bounding_box();x=handle['x']+5;y=handle['y']+5
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+20,y+20,steps=5);page.mouse.up();after=box_for('block')
    assert after['w']>r['w']+25 and abs(after['x']-r['x'])<1 and abs(after['y']-r['y'])<1
    assert not errors,errors
    browser.close();print(json.dumps({'panels_resize_restore':True,'marquee_shift':True,'separate_and_group_scale':True,'batch_move':True,'nested_parents':True,'ancestor_dedup':True,'undo_redo_cancel':True,'visible_center':True,'narrow_canvas':True,'deep_edit_handle':True,'save_reload':True,'errors':errors}))
