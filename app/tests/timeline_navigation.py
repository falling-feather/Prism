"""Pointer lifecycle, zoom anchoring and valid subframe selection in actual Edge."""
import copy,json,os
from playwright.sync_api import sync_playwright
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765/')
def scene(id,out=10):
    return {'id':id,'sourceId':'s','name':id,'in':0,'out':out,'hold':0,'texts':[],'objects':[],'objectOverrides':{},'subtitles':[]}
project={'schema':'svgfilm-project','schemaVersion':'0.2.0','projectId':'navigation','title':'时间轴导航验证','canvas':{'width':1280,'height':720,'fps':30},'sources':{'s':{'type':'svg','duration':10,'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect x="300" y="200" width="200" height="200" fill="#46735c"/></svg>'}},'scenes':[scene('a'),scene('b')],'audioTracks':[]}
project['scenes'][0]['subtitles']=[{'id':'line','text':'操作验证','start':1,'end':3}]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':960});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.wait_for_function('window.studio?.ready');page.evaluate('(p)=>studio.loadProject(p)',project)
    page.locator('#toggleTimeline').click();page.locator('#timelineMagnet').click()
    page.locator('#timelineZoom').focus();page.keyboard.press('End')
    page.evaluate('studio.seek(1)');page.locator('#playheadTimecode').focus()
    head=page.locator('#playhead i').bounding_box();scroll=page.locator('#timelineScroll').bounding_box()
    page.mouse.move(head['x']+7,head['y']+4);page.mouse.down();page.mouse.move(scroll['x']+scroll['width']-2,head['y']+4)
    page.wait_for_function("document.querySelector('#timelineScroll').scrollLeft>40")
    assert page.evaluate('studio.time')>5
    page.keyboard.press('Escape');page.mouse.up()
    assert page.evaluate('studio.time')==1,'Escape cancels a scrub even while the time input has focus'
    page.locator('#fitTimeline').click()
    clip=page.locator('.subclip');clip.click();page.locator('#timelineValue').focus()
    before=page.evaluate('JSON.stringify(studio.getProject())');box=clip.bounding_box()
    for key in ['Escape','Control+z']:
        page.mouse.move(box['x']+box['width']/2,box['y']+15);page.mouse.down();page.mouse.move(box['x']+box['width']/2+50,box['y']+15)
        assert page.locator('#timelineGhost').is_visible()
        page.keyboard.press(key);page.mouse.up()
        assert not page.locator('#timelineGhost').is_visible()
        assert page.evaluate('JSON.stringify(studio.getProject())')==before
    # A normal drag is one undo operation and supports redo.
    page.mouse.move(box['x']+box['width']/2,box['y']+15);page.mouse.down();page.mouse.move(box['x']+box['width']/2+50,box['y']+15);page.mouse.up()
    after=page.evaluate('JSON.stringify(studio.getProject())');assert after!=before
    page.locator('#undoBtn').click();assert page.evaluate('JSON.stringify(studio.getProject())')==before
    page.locator('#redoBtn').click();assert page.evaluate('JSON.stringify(studio.getProject())')==after
    # Ctrl+wheel keeps the time under the cursor anchored.
    scroll=page.locator('#timelineScroll').bounding_box();anchor=scroll['x']+scroll['width']*.45
    def time_at(x):
        return page.evaluate('''x=>{const p=studio.getProject(),s=p.scenes[0],scale=document.querySelector('.clip').getBoundingClientRect().width/(s.out-s.in+s.hold);return (x-document.querySelector('#timelineBody').getBoundingClientRect().left)/scale;}''',x)
    at=time_at(anchor);page.mouse.move(anchor,scroll['y']+15);page.keyboard.down('Control');page.mouse.wheel(0,-220);page.keyboard.up('Control')
    page.wait_for_function("Number(document.querySelector('#zoomLabel').textContent.replace('%',''))>900")
    assert abs(time_at(anchor)-at)<.02,(at,time_at(anchor))
    # A legal short scene with no global frame sample must remain selectable.
    short=copy.deepcopy(project);short['scenes']=[scene('a',1.02),scene('tiny',.01),scene('c')]
    page.evaluate('(p)=>studio.loadProject(p)',short);page.locator('[data-scene-index="1"]').click()
    assert page.locator('.scene-card.active').get_attribute('data-scene-index')=='1'
    assert 1.02<=page.evaluate('studio.time')<1.03
    # Frame-exact decimal boundaries agree in the renderer, list and timeline.
    short['scenes']=[scene('a',.1),scene('b',.2),scene('c')]
    page.evaluate('(p)=>studio.loadProject(p)',short);page.locator('#playheadTimecode').fill('00:00:00:09');page.locator('#playheadTimecode').press('Enter')
    assert page.locator('.scene-card.active').get_attribute('data-scene-index')=='2'
    assert page.locator('.clip.active').get_attribute('data-clip')=='2'
    assert not errors,errors
    browser.close()
    print(json.dumps({'edge_autoscroll':True,'cancel_from_inputs':True,'undo_redo':True,'anchored_zoom':True,'subframe_selection':True,'decimal_boundaries':True,'errors':errors}))
