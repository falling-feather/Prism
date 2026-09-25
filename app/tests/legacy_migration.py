from playwright.sync_api import sync_playwright
from pathlib import Path
import json,os
ROOT=Path(__file__).resolve().parents[1]
old=json.loads((ROOT/'案例_细胞结构.svgfilm.json').read_text(encoding='utf-8'))
old['scenes']=old['scenes'][:1];old['duration']=12
s=old['scenes'][0];s['title']='教师修改后的开场标题';s['topic']='教师修改后的主题说明'
for t in s['texts']:
    if t['role']=='title':t['text']=s['title']
    if t['role']=='topic':t['text']=s['topic']
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge');p=b.new_page();p.goto(os.environ.get('SVGFILM_URL','http://127.0.0.1:8765'));p.wait_for_function('studio.ready');p.evaluate('(p)=>studio.loadProject(p)',old)
    texts=p.evaluate('studio.getProject().scenes[0].texts.map(t=>t.text)')
    assert s['title'] in texts and s['topic'] in texts,texts
    p.evaluate('studio.seek(4)');assert s['title'] in p.locator('#stage').text_content()
    b.close();print('Legacy split title and topic migration: passed')
