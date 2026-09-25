"""Real Edge interaction and rendering regression checks; run against local server."""
import json, os, wave, math, struct, urllib.request
from pathlib import Path
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765')
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True)
    page=browser.new_page(viewport={'width':1440,'height':960})
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function('window.studio && window.studio.ready')
    page.locator('#toggleInspector').click();page.locator('#toggleTimeline').click();page.locator('#timelineMagnet').click()
    assert page.title().startswith('映物 · Prism')
    page.get_by_role('button',name='高尔基体：加工，再分拣',exact=True).click()
    page.get_by_role('button',name='文字',exact=True).click()
    assert page.get_by_text('一叠扁平囊',exact=True).count()>0
    page.get_by_role('button',name='一叠扁平囊',exact=True).click()
    page.locator('#editText').fill('扁平囊（课堂修订）')
    page.locator('#textSize').click()
    assert page.locator('#stage').text_content().find('扁平囊（课堂修订）')>=0
    page.locator('[data-caption="0"]').fill('教师可以直接修改字幕，不再出现旧字幕。')
    page.locator('[data-sub-start="0"]').click()
    assert page.locator('#stage [data-layer="captions"]').text_content()=='教师可以直接修改字幕，不再出现旧字幕。'
    page.get_by_role('button',name='组件',exact=True).click()
    page.get_by_role('button',name='高尔基体',exact=True).click()
    page.locator('#objX').fill('30');page.locator('#objY').click()
    page.locator('#objY').fill('-12');page.locator('#objScale').click()
    page.locator('#objScale').fill('1.1');page.locator('#objRotation').click()
    assert page.evaluate("studio.getProject().scenes[6].objectOverrides['cell-golgi:o6'].dx")==30
    # Actual pointer drag on an independent scene: numeric edits alone don't prove dragging.
    page.evaluate('studio.seek(112)')
    before=page.evaluate('studio.getProject().scenes[6].subtitles[0].start')
    bar=page.locator('.subclip[data-si="6"][data-li="0"]');bar.scroll_into_view_if_needed();box=bar.bounding_box()
    page.mouse.move(box['x']+box['width']/2,box['y']+15);page.mouse.down();page.mouse.move(box['x']+box['width']/2-4,box['y']+15,steps=3);page.mouse.up()
    assert abs(page.evaluate('studio.getProject().scenes[6].subtitles[0].start')-(before-.5))<.02
    page.evaluate('studio.seek(116)');page.locator('#splitBtn').click()
    assert page.evaluate('studio.getProject().scenes.length')==19
    assert page.evaluate('studio.getProject().scenes[7].in')==8
    page.get_by_role('button',name='高尔基体：加工，再分拣 · 后段',exact=True).click()
    page.get_by_role('button',name='镜头',exact=True).click()
    page.locator('#clipIn').fill('9');page.locator('#clipOut').fill('17');page.locator('#clipHold').fill('1');page.locator('#applyTrim').click()
    assert page.evaluate('studio.getProject().scenes[7].in')==9
    assert page.evaluate('studio.getProject().scenes[7].hold')==1
    page.locator('#undoBtn').click();assert page.evaluate('studio.getProject().scenes[7].in')==8
    page.locator('#redoBtn').click();assert page.evaluate('studio.getProject().scenes[7].in')==9
    page.locator('#undoBtn').click()
    page.get_by_role('button',name='声音',exact=True).click()
    page.locator('[data-a-mute="0"]').check()
    tone=ROOT/'.work'/'voice-test.wav'
    with wave.open(str(tone),'wb') as w:
        w.setparams((1,2,48000,0,'NONE','not compressed'))
        w.writeframes(b''.join(struct.pack('<h',int(7000*math.sin(i*2*math.pi*440/48000))) for i in range(6*48000)))
    page.locator('#addVoice').click();page.locator('#audioInput').set_input_files(str(tone))
    page.wait_for_function('studio.getProject().audioTracks.length===2')
    for key,value in [('duration','4'),('start','109'),('offset','0.25'),('fadeIn','1'),('fadeOut','1')]:
        page.locator(f'[data-a-index="1"][data-a-key="{key}"]').fill(value);page.locator('#projectTitle').click()
    with page.expect_download() as download:page.locator('#saveBtn').click()
    saved=ROOT/'.work'/'edited.svgfilm.json';download.value.save_as(str(saved))
    data=json.loads(saved.read_text(encoding='utf-8'));assert 'rows' not in data['scenes'][6]['subtitles'][0]
    page.reload();page.wait_for_function('window.studio?.ready');page.locator('#fileInput').set_input_files(str(saved))
    page.wait_for_function('studio.getProject().scenes.length===19')
    assert page.evaluate("studio.getProject().scenes[6].texts.some(t=>t.text==='扁平囊（课堂修订）')")
    assert page.evaluate("studio.getProject().scenes[6].objectOverrides['cell-golgi:o6'].scale")==1.1
    # Use real HTTP export services on this saved project, including audio and native motion.
    request=urllib.request.Request(URL+'/api/portable',data=json.dumps({'project':data}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request) as r: html=r.read()
    portable=ROOT/'.work'/'lesson.html';portable.write_bytes(html)
    standalone=browser.new_page();standalone.on('pageerror',lambda e:errors.append(str(e)));standalone.goto(portable.as_uri());standalone.wait_for_selector('svg [data-source-id]')
    assert standalone.locator('svg').text_content();standalone.close()
    page.locator('#fileInput').set_input_files(str(portable));page.wait_for_function('studio.getProject().scenes.length===19')
    page.get_by_role('button',name='高尔基体：加工，再分拣',exact=True).click()
    page.evaluate('studio.seek(111)');page.screenshot(path=str(ROOT/'.work'/'editor-desktop.png'))
    page.set_viewport_size({'width':760,'height':900});page.screenshot(path=str(ROOT/'.work'/'editor-narrow.png'))
    assert page.evaluate('document.body.scrollWidth<=innerWidth')
    source=ROOT/'.work'/'independent.svg'
    source.write_text('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect x="200" y="180" width="400" height="250" fill="#46735c"/><text x="200" y="130" font-size="40">独立课堂示意</text></svg>',encoding='utf-8')
    page.locator('#fileInput').set_input_files(str(source));page.wait_for_function('studio.getProject().scenes.length===1')
    page.get_by_role('button',name='镜头',exact=True).click();page.locator('#clipOut').fill('1');page.locator('#applyTrim').click()
    page.locator('#exportBtn').click();page.locator('#startExport').click()
    page.locator('#downloadExport').wait_for(state='visible',timeout=60000)
    with page.expect_download() as mp4:page.locator('#downloadExport').click()
    movie=ROOT/'.work'/'ui-export.mp4';mp4.value.save_as(str(movie));assert movie.stat().st_size>1000
    print(json.dumps({'loaded':True,'all_text_registry':True,'text_edit':True,'component_transform':True,'timeline_drag_split':True,'trim_undo_redo':True,'audio_import':True,'portable_save_reload':True,'offline_html':True,'ui_mp4_download':True,'page_errors':errors},ensure_ascii=False))
    assert not errors
    browser.close()
