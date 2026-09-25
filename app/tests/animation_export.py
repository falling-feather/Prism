"""Decode a real MP4 and check a teacher-adjusted animated component at two times."""
from pathlib import Path
import json,os,subprocess,time,urllib.request
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765').rstrip('/')
project=json.loads((ROOT.parent/'.agents/skills/svgfilm-authoring/assets/minimal.svgfilm.json').read_text(encoding='utf-8'))
with sync_playwright() as pw:
    b=pw.chromium.launch(channel='msedge',headless=True);page=b.new_page()
    page.goto(URL);page.wait_for_function('window.studio?.ready')
    project=page.evaluate('''async p=>{await studio.loadProject(p);p=studio.getProject();p.scenes[0].texts[0].text='动画导出核验';p.scenes[0].objectOverrides['motion:o:carrier']={dx:15,dy:-8};await studio.loadProject(p);return studio.getProject();}''',project)
    b.close()
request=urllib.request.Request(URL+'/api/exports',data=json.dumps({'project':project,'width':640,'start':0,'end':2.1}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request) as r:job=json.load(r)['id']
for _ in range(100):
    with urllib.request.urlopen(URL+'/api/exports/'+job) as r:status=json.load(r)
    if status['status'] in ('complete','failed','cancelled'):break
    time.sleep(1)
assert status['status']=='complete',status
movie=ROOT/'.work/protocol-animation.mp4'
with urllib.request.urlopen(URL+'/api/exports/'+job+'/download') as r:movie.write_bytes(r.read())
info=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,duration','-of','json',str(movie)]))['streams'][0]
assert int(info['nb_read_frames'])==63,info
centers=[]
for t in [.5,2]:
    pixels=subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(movie),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
    points=[((i//3)%640,(i//3)//640) for i in range(0,len(pixels),3) if pixels[i]<100 and 85<pixels[i+1]<180 and pixels[i+2]>140]
    assert len(points)>3000,len(points)
    center=[sum(p[axis] for p in points)/len(points) for axis in [0,1]];centers.append(center)
    u=t/2.5;eased=2*u*u if u<.5 else 1-(-2*u+2)**2/2
    assert abs(center[0]-(200+15+350*eased)*2/3)<3,center
    assert abs(center[1]-(260-8)*2/3)<3,center
print(json.dumps({'frames':63,'seconds':2.1,'animated_centers':centers,'teacher_offset_preserved':True,'file':str(movie)}))
