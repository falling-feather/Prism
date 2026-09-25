"""The shipped checker must reject broken embedded media, not merely valid JSON."""
from pathlib import Path
import base64,copy,importlib.util,io,json,os,wave
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];SKILL=ROOT.parent/'.agents/skills/svgfilm-authoring'
spec=importlib.util.spec_from_file_location('checker',SKILL/'scripts/check_project.py');checker=importlib.util.module_from_spec(spec);spec.loader.exec_module(checker)
base=json.loads((SKILL/'assets/minimal.svgfilm.json').read_text(encoding='utf-8'))
audio=copy.deepcopy(base);audio['audioTracks']=[{'id':'bad','name':'坏音频','kind':'voice','dataUrl':'data:audio/wav;base64,AAAA','start':0,'offset':0,'duration':1,'mediaDuration':1,'volume':1,'fadeIn':0,'fadeOut':0}]
image=copy.deepcopy(base);image['sources']['motion']['svg']=image['sources']['motion']['svg'].replace('</svg>','<image id="broken" x="0" y="0" width="100" height="100" href="data:image/png;base64,AAAA"/></svg>')
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge',headless=True);page=b.new_page();page.goto(os.environ.get('SVGFILM_URL','http://127.0.0.1:8765'));page.wait_for_function('window.studio?.ready')
    for project,kind in [(audio,'音频'),(image,'图片')]:
        try:page.evaluate(checker.CHECK,project)
        except Exception as error:assert kind in str(error),str(error)
        else:raise AssertionError('损坏'+kind+'被误报为通过')
    sound=io.BytesIO()
    with wave.open(sound,'wb') as wav:wav.setparams((1,2,8000,0,'NONE','none'));wav.writeframes(b'\0\0'*8000)
    valid=copy.deepcopy(audio);valid['audioTracks'][0]['dataUrl']='data:audio/wav;base64,'+base64.b64encode(sound.getvalue()).decode()
    png=page.evaluate("document.createElement('canvas').toDataURL('image/png')")
    valid['sources']['motion']['svg']=valid['sources']['motion']['svg'].replace('</svg>',f'<image id="valid-image" width="10" height="10" href="{png}"/></svg>')
    report=page.evaluate(checker.CHECK,valid);assert report['roundTrip']=='pass' and report['media']=={'images':1,'audio':1,'status':'pass'},report
    b.close();print('invalid embedded audio/image rejected; valid project passed')
