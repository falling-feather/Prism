"""Real fast/compat exports: frame clock, audio, automatic fallback and cancellation."""
from pathlib import Path
import array,base64,copy,io,json,math,os,subprocess,time,urllib.request,wave
ROOT=Path(__file__).resolve().parents[1];URL=os.environ.get('SVGFILM_URL','http://127.0.0.1:8765').rstrip('/')
p=json.loads((ROOT.parent/'.agents/skills/svgfilm-authoring/assets/minimal.svgfilm.json').read_text(encoding='utf-8'))
def request(path,data=None):
    req=urllib.request.Request(URL+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json'})
    with urllib.request.urlopen(req) as response:return json.load(response)
def export(project,mode,name,end=2,width=1280):
    begin=time.perf_counter();job=request('/api/exports',{'project':project,'width':width,'start':0,'end':end,'exportMode':mode})['id']
    for _ in range(180):
        status=request('/api/exports/'+job)
        if status['status'] in ('complete','failed','cancelled'):break
        time.sleep(.2)
    assert status['status']=='complete',status
    file=ROOT/'.work'/('fast-'+name+'.mp4')
    with urllib.request.urlopen(URL+'/api/exports/'+job+'/download') as response:file.write_bytes(response.read())
    info=json.loads(subprocess.check_output(['ffprobe','-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=nb_read_frames,width,height,duration,r_frame_rate','-of','json',str(file)]))['streams'][0]
    return status,info,file,round(time.perf_counter()-begin,3)
status,info,fast,elapsed=export(p,'fast','basic')
assert status.get('exportMode')=='fast',status
assert int(info['nb_read_frames'])==60,info
assert status.get('performance',{}).get('maxEncodeQueue',99)<=4,status
_,compat_info,compat,compat_elapsed=export(p,'compatibility','reference')
assert compat_info['nb_read_frames']==info['nb_read_frames']
def frame(file,t):return subprocess.check_output(['ffmpeg','-v','error','-ss',str(t),'-i',str(file),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
a,b=frame(fast,1),frame(compat,1)
assert len(a)==len(b);mae=sum(abs(x-y) for x,y in zip(a,b))/len(a);assert mae<3,mae
fractional=copy.deepcopy(p);fractional['canvas']['fps']=29.97
_,info,_,_=export(fractional,'fast','fractional',end=.51,width=1920);assert int(info['nb_read_frames'])==16 and info['width']==1920,info
# A complex effect takes the explicit compatibility route in automatic mode.
effect=copy.deepcopy(p);effect['sources']['motion']['svg']=effect['sources']['motion']['svg'].replace('</svg>','<defs><filter id="blur"><feGaussianBlur stdDeviation="1"/></filter></defs></svg>')
status,_,_,_=export(effect,'auto','fallback',end=3.1);assert status['exportMode']=='compatibility' and 'filter' in status.get('fallbackReason',''),status
status,_,_,_=export(p,'auto','short',end=.2);assert status['exportMode']=='compatibility' and '短片' in status.get('fallbackReason',''),status
# Both outputs use the same global audio timing and source offset.
sound=io.BytesIO()
with wave.open(sound,'wb') as w:
    w.setparams((1,2,8000,0,'NONE','none'));samples=array.array('h',(int(10000*math.sin(2*math.pi*440*i/8000)) if .3<=i/8000<.7 else 0 for i in range(8000)));w.writeframes(samples.tobytes())
with_audio=copy.deepcopy(p);with_audio['audioTracks']=[{'id':'a','name':'tone','dataUrl':'data:audio/wav;base64,'+base64.b64encode(sound.getvalue()).decode(),'start':.2,'offset':.1,'duration':.8,'volume':.5,'fadeIn':0,'fadeOut':0,'mediaDuration':1}]
_,_,audio_file,_=export(with_audio,'fast','audio',end=1)
audio=array.array('f');audio.frombytes(subprocess.check_output(['ffmpeg','-v','error','-i',str(audio_file),'-vn','-ac','1','-ar','8000','-f','f32le','pipe:1']))
def rms(start,end):v=audio[int(start*8000):int(end*8000)];return math.sqrt(sum(x*x for x in v)/len(v))
assert rms(.05,.3)<.001 and rms(.45,.65)>.05 and rms(.85,.95)<.001
long=copy.deepcopy(p);long['scenes'][0]['hold']=100
job=request('/api/exports',{'project':long,'width':1280,'start':0,'end':100,'exportMode':'fast'})['id']
for _ in range(200):
    status=request('/api/exports/'+job)
    if status.get('exportMode')=='fast' and status.get('progress',0)>=4:break
    assert status['status'] not in ('failed','complete'),status
    time.sleep(.1)
assert status.get('progress',0)>=4,status
cancel_begin=time.perf_counter();request('/api/exports/'+job+'/cancel',{})
for _ in range(80):
    status=request('/api/exports/'+job)
    if status['status']=='cancelled':break
    time.sleep(.1)
assert status['status']=='cancelled',status
assert time.perf_counter()-cancel_begin<8
assert not list((ROOT/'.work/jobs'/job).glob('*.h264'))
print(json.dumps({'fast_job_seconds':elapsed,'compat_job_seconds':compat_elapsed,'pixel_mae':mae,'frames':60,'fractional_fps_1080p':True,'fallback':True,'audio_clock':True,'cancel':True}))
