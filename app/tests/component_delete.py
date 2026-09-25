"""Delete selected canvas objects without breaking sources, input editing or undo."""
from pathlib import Path
import copy,json,os
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
project=json.loads((ROOT.parent/'.agents/skills/svgfilm-authoring/assets/minimal.svgfilm.json').read_text(encoding='utf-8'))
project['scenes']=[project['scenes'][0],copy.deepcopy(project['scenes'][0])];project['scenes'][1]['id']='shared-source-copy'
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765')
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True);page=browser.new_page(viewport={'width':1440,'height':960});errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)));page.goto(URL);page.wait_for_function('window.studio?.ready')
    page.evaluate('(p)=>studio.loadProject(p)',project);page.evaluate('studio.seek(1)')
    body=page.locator('[data-node-id="motion:o:body"]');carrier=page.locator('[data-layout-id="motion:o:carrier"]');station=page.locator('[data-node-id="motion:o:station"]')
    body.click(position={'x':20,'y':20});assert page.locator('#deleteSelection').count()==1,'selected component needs a delete button'
    page.locator('#deleteSelection').click();assert not carrier.is_visible();assert not page.locator('#selectionActions').is_visible()
    assert page.evaluate("studio.getProject().scenes[0].objectOverrides['motion:o:carrier'].hidden")
    page.locator('#undoBtn').click();assert carrier.is_visible()
    page.locator('#redoBtn').click();assert not carrier.is_visible()
    page.locator('#undoBtn').click();body.click(position={'x':20,'y':20})
    # Text input and an open dialog must retain their normal key behavior.
    title=page.locator('#projectTitle');title.focus();page.keyboard.press('End');page.keyboard.press('Backspace');assert carrier.is_visible()
    page.locator('#exportBtn').click();page.keyboard.press('Delete');assert carrier.is_visible();page.locator('#exportDialog button[aria-label="关闭"]').click()
    # Seeking within this scene preserves canvas selection; timeline focus must prevent deletion.
    page.locator('#toggleTimeline').click();page.locator('#ruler').click(position={'x':10,'y':22});page.keyboard.press('Delete');assert carrier.is_visible()
    page.locator('#toggleTimeline').click();page.evaluate('studio.seek(1)');body.click(position={'x':20,'y':20});page.keyboard.press('Delete');assert not carrier.is_visible()
    page.locator('#undoBtn').click()
    # Shift selection forms one batch, and one undo restores the entire batch.
    body.click(position={'x':20,'y':20});station.click(modifiers=['Shift']);assert '2' in page.locator('#selectedCount').text_content()
    page.keyboard.press('Backspace');assert not carrier.is_visible() and not station.is_visible()
    deleted=page.evaluate('studio.getProject()');assert deleted['sources']==project['sources']
    page.locator('#undoBtn').click();assert carrier.is_visible() and station.is_visible()
    page.locator('#redoBtn').click();assert not carrier.is_visible() and not station.is_visible()
    # A second cut of the same source is unaffected, including when seeking back.
    page.evaluate('studio.seek(4)');assert carrier.is_visible() and station.is_visible()
    page.evaluate('studio.seek(1)');assert not carrier.is_visible() and not station.is_visible()
    with page.expect_download() as event:page.locator('#saveBtn').click()
    saved=ROOT/'.work/deleted-components.svgfilm.json';event.value.save_as(str(saved))
    page.reload();page.wait_for_function('window.studio?.ready')
    page.locator('#fileInput').set_input_files(str(saved));page.wait_for_function("studio.getProject().scenes[0].objectOverrides['motion:o:carrier']?.hidden")
    page.evaluate('studio.seek(1)');assert not carrier.is_visible() and not station.is_visible()
    # Source-preserving deletion also reaches the standalone shared renderer.
    response=page.request.post(URL+'/api/portable',data={'project':page.evaluate('studio.getProject()')});assert response.ok,response.text()
    offline=browser.new_page();offline.on('pageerror',lambda e:errors.append(str(e)));offline.set_content(response.text());offline.wait_for_selector('#stage[data-scene]')
    assert not offline.locator('[data-layout-id="motion:o:station"]').is_visible();offline.close()
    assert not errors,errors
    browser.close();print(json.dumps({'button':True,'keyboard_and_focus':True,'batch_undo_redo':True,'shared_source_isolation':True,'save_reload':True,'portable_output':True,'errors':errors}))
