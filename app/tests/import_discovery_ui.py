"""Choose a parent, pick one project, cancel safely, then reopen its persisted local copy."""
from pathlib import Path
import json,os,tempfile
from playwright.sync_api import sync_playwright
APP=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8893')
with tempfile.TemporaryDirectory(dir=APP/'.work') as temporary:
    root=Path(temporary)/'视频总目录';root.mkdir()
    for name in ['目录甲','目录乙']:
        folder=root/'工程'/name;folder.mkdir(parents=True)
        (folder/'index.html').write_text(f'<title>{name}</title><canvas id="c" width="640" height="360"></canvas><script type="module" src="main.js"></script>',encoding='utf-8')
        (folder/'main.js').write_text("const c=document.getElementById('c').getContext('2d');window.DUR=2;window.render=t=>{c.clearRect(0,0,640,360);c.fillStyle='#cc4422';c.fillRect(50+t*10,80,60,100);};",encoding='utf-8')
    with sync_playwright() as pw:
        browser=pw.chromium.launch(channel='msedge',headless=True)
        try:
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
            page.locator('#importBtn').click();page.locator('#chooseSourceDirectory').click()
            page.locator('#sourceFolderInput').set_input_files(str(root))
            page.wait_for_function('document.querySelectorAll("#sourceCandidates button").length===2')
            page.locator('#sourceChoiceCancel').click()
            assert page.locator('#projectTitle').input_value()=='细胞里面，谁在忙？'
            page.locator('#sourceFolderInput').set_input_files(str(root))
            page.locator('#sourceCandidates button').filter(has_text='目录乙').click()
            page.wait_for_function('document.querySelector("#projectTitle").value.includes("目录乙")',timeout=120000)
            page.locator('#sourceClose').click();original=page.evaluate('studio.getProject().projectId')
            page.reload();page.wait_for_function('window.studio?.ready',timeout=45000)
            requests=[];page.on('request',lambda request:requests.append(request.url) if request.method=='POST' and request.url.endswith('/api/source-imports') else None)
            page.locator('#importBtn').click();page.locator('#recentImportList button').filter(has_text='目录乙').click()
            page.wait_for_function('document.querySelector("#projectTitle").value.includes("目录乙")')
            assert page.evaluate('studio.getProject().projectId')==original
            assert not requests,requests
            assert not errors,errors
            print(json.dumps({'parentDiscovery':True,'cancel':True,'pickOne':True,'recentReopenWithoutAnalysis':True,'pageErrors':errors}))
        finally:browser.close()
