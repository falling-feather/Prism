"""Export actual timeline edits and inspect decoded frames/audio, not just metadata."""
from pathlib import Path
import array,base64,io,json,math,os,struct,subprocess,time,urllib.request,wave
from playwright.sync_api import sync_playwright
ROOT=Path(__file__).resolve().parents[1]
URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765').rstrip('/')
sound=io.BytesIO()
with wave.open(sound,'wb') as w:
    w.setparams((1,2,48000,0,'NONE','none'))
    w.writeframes(b''.join(struct.pack('<h',int(12000*math.sin(2*math.pi*880*i/48000)) if .2<=i/48000<.4 else 0) for i in range(48000)))
def scene(id):return {'id':id,'sourceId':id,'name':id,'in':0,'out':1,'hold':0,'texts':[],'objects':[],'objectOverrides':{},'subtitles':[]}
p={'schema':'svgfilm-project','schemaVersion':'0.2.0','projectId':'timeline-export','title':'精细时间轴导出验证','canvas':{'width':1280,'height':720,'fps':30},'sources':{id:{'type':'svg','duration':1,'svg':f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="{color}"/></svg>'} for id,color in [('a','#d63b3b'),('b','#3ba653')]},'scenes':[scene('a'),scene('b')],'audioTracks':[{'id':'voice','name':'时间验证音轨','kind':'voice','dataUrl':'data:audio/wav;base64,'+base64.b64encode(sound.getvalue()).decode(),'start':0,'offset':0,'duration':1,'mediaDuration':1,'volume':.7,'fadeIn':0,'fadeOut':0}]}
with sync_playwright() as pw:
    browser=pw.chromium.launch(channel='msedge',headless=True);page=browser.new_page()
    page.goto(URL);page.wait_for_function('window.studio?.ready')
    edited=page.evaluate('''async p=>{
      const T=await import('./src/timeline.mjs'),P=await import('./src/project.mjs');
      T.applyEdit(p,{kind:'scene',id:'a'},'end',.1);
      T.applyEdit(p,{kind:'scene',id:'b'},'end',.3);
      T.applyEdit(p,{kind:'audio',id:'voice'},'start',.05);
      T.applyEdit(p,{kind:'audio',id:'voice'},'end',.28);
      P.validateProject(p);return p;
    }''',p)
    browser.close()
request=urllib.request.Request(URL+'/api/exports',data=json.dumps({'project':edited,'width':640,'start':0,'end':.1+.2}).encode(),headers={'Content-Type':'application/json'})
with urllib.request.urlopen(request) as r:job=json.load(r)['id']
for _ in range(60):
    with urllib.request.urlopen(URL+'/api/exports/'+job) as r:status=json.load(r)
    if status['status'] in ('complete','failed','cancelled'):break
    time.sleep(1)
assert status['status']=='complete',status
movie=ROOT/'.work/timeline-export.mp4'
with urllib.request.urlopen(URL+'/api/exports/'+job+'/download') as r:movie.write_bytes(r.read())
report=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=nb_read_frames,duration','-of','json',str(movie)]))['streams'][0]
assert int(report['nb_read_frames'])==9,report
assert abs(float(report['duration'])-.3)<1e-6,report
pixels=subprocess.check_output(['ffmpeg','-v','error','-i',str(movie),'-an','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
def center(frame):
    offset=(frame*640*360+180*640+320)*3
    return list(pixels[offset:offset+3])
assert center(2)[0]>center(2)[1]*2,center(2)
assert center(3)[1]>center(3)[0]*2,center(3)
samples=array.array('f');samples.frombytes(subprocess.check_output(['ffmpeg','-v','error','-i',str(movie),'-vn','-ac','1','-ar','48000','-f','f32le','pipe:1']))
def rms(start,end):
    values=samples[int(start*48000):int(end*48000)]
    return math.sqrt(sum(x*x for x in values)/len(values))
assert rms(.07,.17)<.001,rms(.07,.17)
assert rms(.22,.26)>.08,rms(.22,.26)
assert rms(.29,.3)<.002,rms(.29,.3)
print(json.dumps({'frames':9,'seconds':.3,'cut_frame_colors':[center(2),center(3)],'audio_rms':[rms(.07,.17),rms(.22,.26),rms(.29,.3)],'job':job}))
