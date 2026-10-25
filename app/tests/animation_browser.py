"""New source contract through the real editor renderer, editing and portable output."""
from pathlib import Path
import copy,json,os,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765').rstrip('/')
p={'schema':'svgfilm-project','schemaVersion':'0.3.0','projectId':'moving-box','title':'通用动画验证','canvas':{'width':640,'height':360,'fps':30,'background':'#ffffff'},'sources':{'motion':{'type':'svg-keyframes-v1','duration':3,'svg':'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><g id="assembly" data-object="组件"><rect id="box" x="60" y="100" width="60" height="60" fill="#46735c"/><text id="label" x="60" y="85" font-size="24">可改标题</text></g><circle id="dot" cx="450" cy="160" r="20" fill="#b36543"/></svg>','animations':[{'target':'assembly','origin':[90,130],'tracks':{'x':[{'time':0,'value':0},{'time':3,'value':180}],'opacity':[{'time':0,'value':0},{'time':1,'value':1}]}}]}},'scenes':[{'id':'scene','sourceId':'motion','name':'运动镜头','in':0,'out':3,'hold':0,'texts':[],'objects':[],'objectOverrides':{},'subtitles':[{'id':'sub','text':'字幕可编辑','start':0,'end':3}]}],'audioTracks':[]}
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge',headless=True);page=b.new_page(viewport={'width':1440,'height':960});errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto(URL)
    try:page.wait_for_function('window.studio?.ready',timeout=45000)
    except Exception:print({'page_errors':errors,'message':page.locator('#toast').text_content()});raise
    page.evaluate('(p)=>studio.loadProject(p)',p)
    ids=page.evaluate('studio.getProject().scenes[0].objects.map(o=>o.id)')
    assert 'motion:o:assembly' in ids,ids
    def state(t):
        return page.evaluate('''t=>{studio.seek(t);const n=studio.renderer.node('motion:o:box'),m=n.getCTM(),motion=document.querySelector('[data-motion-id="assembly"]');return {x:m.e,opacity:Number(motion.getAttribute('opacity')),text:studio.renderer.node('motion:o:label').textContent};}''',t)
    a=state(0);mid=state(1.5);end=state(2.5);again=state(1.5)
    assert abs(mid['x']-a['x']-90)<1e-7,(a,mid)
    assert a['opacity']==0 and mid['opacity']==1;assert mid==again,(mid,again)
    # Real edit: select the moving object, move it and undo/redo without destroying motion.
    page.locator('#deepSelect').check();r=page.locator('[data-node-id="motion:o:box"]').bounding_box()
    x=r['x']+r['width']/2;y=r['y']+r['height']/2
    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+30,y+10,steps=5);page.mouse.up()
    modified=page.evaluate('studio.getProject()');assert modified['scenes'][0]['objectOverrides']['motion:o:box']['dx']>0
    page.locator('#undoBtn').click();assert page.evaluate('studio.getProject().scenes[0].objectOverrides')=={}
    page.locator('#redoBtn').click()
    modified=page.evaluate('studio.getProject()');modified['scenes'][0]['texts'][0]['text']='修改后的标题'
    # Reorder SVG nodes: semantic IDs and saved edits must keep binding to the same nodes.
    svg=modified['sources']['motion']['svg'];circle='<circle id="dot" cx="450" cy="160" r="20" fill="#b36543"/>'
    modified['sources']['motion']['svg']=svg.replace(circle,'').replace('<g id="assembly"',circle+'<g id="assembly"')
    page.evaluate('(p)=>studio.loadProject(p)',modified);assert state(1.5)['text']=='修改后的标题'
    saved=page.evaluate('JSON.stringify(studio.getProject())');page.evaluate('(text)=>studio.loadProject(JSON.parse(text))',saved);assert state(1.5)['text']=='修改后的标题'
    # A trim samples the original source clock; duplicate scene edits remain independent.
    trimmed=page.evaluate('''async()=>{const P=await import('./src/project.mjs');const p=studio.getProject();P.trimScene(p,0,1,3,1);await studio.loadProject(p);return p;}''')
    origin=state(0);later=state(.5);assert abs(later['x']-origin['x']-30)<1e-7
    held=state(2.5);assert abs(held['x']-state(2)['x'])<1e-7
    # Rejection is explicit and keeps the last valid project in place.
    invalid=[]
    for svg in [p['sources']['motion']['svg'].replace('id="box"',''),p['sources']['motion']['svg'].replace('id="dot"','id="box"'),p['sources']['motion']['svg'].replace('</svg>','<animate attributeName="opacity" from="0" to="1"/></svg>')]:
        q=copy.deepcopy(p);q['sources']['motion']['svg']=svg;invalid.append(q)
    q=copy.deepcopy(p);q['sources']['motion']['animations'][0]['target']='missing';invalid.append(q)
    for q in invalid:
        message=page.evaluate('''async p=>{try{await studio.loadProject(p);return '';}catch(e){return e.message;}}''',q)
        assert message,'invalid source was silently accepted'
        assert page.evaluate('studio.getProject().scenes[0].in')==1
    request=urllib.request.Request(URL+'/api/portable',data=json.dumps({'project':trimmed}).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(request) as response:html=response.read()
    file=ROOT/'.work/animated-portable.html';file.write_bytes(html)
    offline=b.new_page();offline.on('pageerror',lambda e:errors.append(str(e)));offline.goto(file.as_uri());offline.wait_for_selector('[data-motion-id="assembly"]');offline.locator('#stage').click()
    offline.wait_for_function("Number(document.querySelector('#stage').dataset.time)>.4")
    assert '修改后的标题' in offline.locator('#stage').text_content();offline.close()
    old=copy.deepcopy(p);old['schemaVersion']='0.2.0';old['sources']['motion']['type']='svg';del old['sources']['motion']['animations'];page.evaluate('(p)=>studio.loadProject(p)',old)
    assert page.evaluate('async()=>studio.getProject().schemaVersion===(await import("./src/project.mjs")).VERSION')
    gradient=copy.deepcopy(p)
    gradient['sources']['motion']['svg']=gradient['sources']['motion']['svg'].replace('<g id="assembly"','<defs><linearGradient id="paint"><stop offset="0" stop-color="red"/><stop offset="1" stop-color="blue"/></linearGradient></defs><g id="assembly"').replace('<text id="label"','<text fill="url(#paint)" id="label"')
    page.evaluate('(p)=>studio.loadProject(p)',gradient);gradient=page.evaluate('studio.getProject()')
    markup=gradient['sources']['motion']['svg'];gradient['sources']['motion']['svg']=markup.replace(circle,'').replace('<defs>',circle+'<defs>')
    page.evaluate('(p)=>studio.loadProject(p)',gradient)
    assert page.evaluate('''()=>{const t=studio.renderer.node('motion:o:label'),fill=getComputedStyle(t).fill,id=fill.match(/#([^"')]+)/)?.[1];return document.getElementById(id)?.localName;}''')=='linearGradient'
    ordinary='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><rect width="80" height="80"><animate attributeName="x" from="0" to="100" dur="2s"/></rect><text x="20" y="120" font-size="24">普通SVG文字</text></svg>'
    page.locator('#fileInput').set_input_files({'name':'ordinary.svg','mimeType':'image/svg+xml','buffer':ordinary.encode()})
    page.wait_for_function("studio.getProject().title==='ordinary'")
    assert '动画未保留' in page.locator('#toast').text_content()
    assert page.evaluate('studio.getProject().scenes[0].texts[0].text')=='普通SVG文字'
    assert page.evaluate('studio.getProject().scenes[0].objects.length')>=2
    assert not errors,errors
    b.close();print(json.dumps({'stable_ids':True,'seek_safe_motion':True,'real_edit_undo':True,'trim_hold':True,'save_reload':True,'invalid_rejected':True,'portable_animation':True,'old_migration':True,'errors':errors}))
