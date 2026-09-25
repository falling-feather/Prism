"""Real pointer checks for smart timeline editing; only public UI and project API."""
from pathlib import Path
import base64,io,json,os,wave
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765/')
sound=io.BytesIO()
with wave.open(sound,'wb') as w:w.setparams((1,2,8000,0,'NONE','none'));w.writeframes(b'\0\0'*48000)
def scene(id):return {'id':id,'sourceId':'source','name':id,'in':0,'out':10,'hold':0,'texts':[],'objects':[],'objectOverrides':{},'subtitles':[]}
p={'schema':'svgfilm-project','schemaVersion':'0.2.0','projectId':'timeline-test','title':'时间轴测试','canvas':{'width':1280,'height':720,'fps':30},'sources':{'source':{'type':'svg','duration':10,'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><text x="100" y="100" font-size="40">剪辑测试</text></svg>'}},'scenes':[scene('a'),scene('b')],'audioTracks':[{'id':'voice','kind':'voice','name':'配音','dataUrl':'data:audio/wav;base64,'+base64.b64encode(sound.getvalue()).decode(),'start':8,'offset':0,'duration':3,'mediaDuration':6,'volume':.5,'fadeIn':.5,'fadeOut':.5}]}
p['scenes'][0]['subtitles']=[{'id':'first','text':'第一句','start':1,'end':3},{'id':'second','text':'第二句','start':4,'end':6}]
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True);page=browser.new_page(viewport={'width':1700,'height':1000});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL);page.wait_for_function('window.studio?.ready');page.evaluate('(p)=>studio.loadProject(p)',p);page.locator('#toggleTimeline').click()
    assert page.locator('#timelineMagnet').count()==1
    page.locator('#timelineZoom').focus();page.keyboard.press('End')
    assert page.locator('.clip[data-clip="0"]').bounding_box()['width']/10/30>=7,'zoom must expose individual frames'
    def x(time):return page.evaluate('''t=>{const body=document.querySelector('#timelineBody').getBoundingClientRect(),clip=document.querySelector('.clip[data-clip="0"]').getBoundingClientRect(),p=studio.getProject(),s=p.scenes[0];return body.left+t*clip.width/(s.out-s.in+s.hold);}''',time)
    page.locator('#timelineMagnet').click();page.evaluate('studio.seek(1)');r=page.locator('#playhead i').bounding_box();y=r['y']+5
    page.mouse.move(r['x']+5,y);page.mouse.down();page.mouse.move(x(1.5),y,steps=4)
    assert 1.4<page.evaluate('studio.time')<1.6,'playhead must update before mouseup'
    page.mouse.move(x(2.5),y,steps=4);assert 2.4<page.evaluate('studio.time')<2.6;page.mouse.up()
    page.locator('#timelineMagnet').click();bar=page.locator('.subclip[data-si="0"][data-li="0"]');r=bar.bounding_box();y=r['y']+15
    page.mouse.move(r['x']+r['width']/2,y);page.mouse.down();page.mouse.move(x(3.483),y,steps=5)
    assert page.locator('#snapGuide').is_visible();assert '播放头' in page.locator('#snapGuide').inner_text();page.mouse.up()
    assert page.evaluate('studio.getProject().scenes[0].subtitles[0].start')==2.5
    page.locator('#undoBtn').click();assert page.evaluate('studio.getProject().scenes[0].subtitles[0].start')==1
    page.locator('#timelinePrecision').select_option('millisecond');r=bar.bounding_box();y=r['y']+15;page.keyboard.down('Alt');page.mouse.move(r['x']+r['width']/2,y);page.mouse.down();page.mouse.move(x(3.48),y,steps=5)
    assert not page.locator('#snapGuide').is_visible(),(page.locator('#timelineSelectedName').inner_text(),page.locator('#snapGuide').inner_text(),y,bar.bounding_box());page.mouse.up();page.keyboard.up('Alt')
    assert abs(page.evaluate('studio.getProject().scenes[0].subtitles[0].start')-2.48)<.005
    previous=page.evaluate('studio.getProject().scenes[0].subtitles[0].start');page.keyboard.press('Alt+ArrowRight')
    assert abs(page.evaluate('studio.getProject().scenes[0].subtitles[0].start')-previous-1/30)<1e-8
    page.locator('#timelinePrecision').select_option('frame');page.locator('#timelineValue').fill('00:00:02:10');page.locator('#applyTimelineTime').click()
    assert abs(page.evaluate('studio.getProject().scenes[0].subtitles[0].start')-70/30)<1e-8
    page.locator('#fitTimeline').click();voice=page.locator('.audioclip[data-ai="0"]');r=voice.bounding_box();y=r['y']+15
    page.mouse.move(r['x']+3,y);page.mouse.down();page.mouse.move(x(8.5)+3,y,steps=5);page.mouse.up()
    a=page.evaluate('(()=>{const {dataUrl,...a}=studio.getProject().audioTracks[0];return a})()');assert abs(a['offset']-.5)<1e-8 and abs(a['duration']-2.5)<1e-8,a
    r=voice.bounding_box();page.mouse.move(r['x']+r['width']-3,y);page.mouse.down();page.mouse.move(x(14.5),y,steps=5);page.mouse.up();a=page.evaluate('(()=>{const {dataUrl,...a}=studio.getProject().audioTracks[0];return a})()');assert abs(a['start']+a['duration']-14)<1e-8,a
    clip=page.locator('.clip[data-clip="0"]');r=clip.bounding_box();y=r['y']+15;page.mouse.move(r['x']+r['width']-3,y);page.mouse.down();page.mouse.move(x(8)-3,y,steps=5);page.mouse.up()
    assert page.evaluate('studio.getProject().scenes[0].out')==8
    assert page.evaluate('studio.getProject().audioTracks[0].start')==8.5
    second=page.locator('.clip[data-clip="1"]');r=second.bounding_box();y=r['y']+15;page.mouse.move(r['x']+r['width']/2,y);page.mouse.down();page.mouse.move(x(1),y,steps=6);page.mouse.up()
    assert page.evaluate('studio.getProject().scenes[0].id')=='b'
    with page.expect_download() as event:page.locator('#saveBtn').click()
    saved=ROOT/'.work/timeline-edited.svgfilm.json';event.value.save_as(str(saved));page.reload();page.wait_for_function('window.studio?.ready');page.locator('#fileInput').set_input_files(str(saved));page.wait_for_function("studio.getProject().title==='时间轴测试'")
    assert page.evaluate('studio.getProject().scenes[0].id')=='b';assert not errors,errors
    browser.close();print(json.dumps({'continuous_playhead':True,'frame_zoom':True,'snap_and_alt':True,'frame_nudge':True,'timecode':True,'audio_trim':True,'scene_trim_reorder':True,'save_reload':True,'errors':errors}))
