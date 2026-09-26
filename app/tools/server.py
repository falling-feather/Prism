"""Local editor, portable documents and bounded export jobs. Binds loopback only."""
from http.server import SimpleHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit,unquote,parse_qs
import argparse,io,json,math,mimetypes,re,shutil,subprocess,sys,threading,uuid,zipfile,webbrowser
ROOT=Path(__file__).resolve().parents[1]
WORK=ROOT/'.work'/'jobs'
JOBS={};BUSY=threading.Lock();PORT=8765
mimetypes.add_type('text/javascript','.mjs')

def portable(project):
    modules={};aliases={'animation':'Motion','project':'Project','svg-contract':'SvgContract','renderer':'Render','audio':'Sound'}
    for name in ('animation','project','svg-contract','renderer','audio','player'):
        code=(ROOT/'src'/f'{name}.mjs').read_text(encoding='utf-8')
        names=re.findall(r'export\s+(?:async\s+)?(?:const|let|function|class)\s+(\w+)',code)
        code=re.sub(r"""import\s*\{([^}]+)\}\s*from\s*['"]\./([\w-]+)\.mjs['"];""",lambda m:'const {'+m[1]+'}='+aliases[m[2]]+';',code)
        code=re.sub(r'\bexport\s+','',code)
        modules[name]=('const '+aliases[name]+'=(()=>{'+code+';return{'+','.join(names)+'};})();') if name!='player' else '(()=>{'+code+'})();'
    native='\n'.join((ROOT/'cases/cell_structure/native_source/src'/f).read_text(encoding='utf-8') for f in ('motion.js','art.js','organelles.js','scenes.js'))
    code=(native+'\n'+'\n'.join(modules.values())).replace('</script','<\\/script')
    data=json.dumps(project,ensure_ascii=False).replace('<','\\u003c')
    output=('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>映物 · Prism — 课堂播放</title><style>html,body{margin:0;width:100%;height:100%;background:#161d18;overflow:hidden}svg{display:block;width:100%;height:100%}</style><body><svg id="stage" aria-label="点击播放或暂停"></svg><script id="svgfilm-project" type="application/json">'+data+'</script><script>'+code+'</script></body></html>').encode('utf-8')
    if len(output)>160*1024*1024:raise ValueError('独立 HTML 超过 160 MB，请缩短音频或改为保存工程')
    return output

def check_request(d):
    if d.get('exportMode','compatibility') not in ('auto','fast','compatibility'):raise ValueError('不支持的导出方式')
    p=d.get('project',{})
    if p.get('schemaVersion') not in ('0.2.0','0.3.0') or p.get('schema')!='svgfilm-project':raise ValueError('请先通过工作台载入并保存为支持的工程')
    scenes=p.get('scenes',[])
    if not 1<=len(scenes)<=500:raise ValueError('镜头数量无效')
    total=sum(s['out']-s['in']+s.get('hold',0) for s in scenes)
    fps=p['canvas']['fps'];width=d.get('width',1280);start=d.get('start',0);end=d.get('end',total)
    if not all(isinstance(x,(int,float)) and math.isfinite(x) for x in (total,fps,width,start,end)):raise ValueError('导出参数无效')
    if not (0<total<=7200 and 1<=fps<=60 and width in (640,1280,1920) and 0<=start<end<=total+.001):raise ValueError('导出范围或清晰度无效')
    height=round(width*p['canvas']['height']/p['canvas']['width']/2)*2
    if not 2<=height<=4096:raise ValueError('此画幅的导出高度超出范围，请调整素材画幅')
    if len(json.dumps(p,ensure_ascii=False,separators=(',',':')).encode('utf-8'))>120*1024*1024:raise ValueError('工程超过 120 MB，请压缩音频')
    if len(p.get('audioTracks',[]))>16:raise ValueError('音轨过多')
    return p,width,start,end

def run_job(id,request):
    job=JOBS[id];folder=job['folder'];p,width,start,end=check_request(request)
    command=[sys.executable,'-X','utf8',str(ROOT/'tools/render_svgfilm.py'),'--project',str(folder/'project.json'),'--url',f'http://127.0.0.1:{PORT}','--job',id,'--out',str(folder/'video.mp4'),'--width',str(width),'--start',str(start),'--end',str(end),'--cancel',str(folder/'cancel'),'--mode',request.get('exportMode','compatibility')]
    try:
        job.update(status='running',message='正在载入画面');process=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',cwd=ROOT)
        with (folder/'render.log').open('w',encoding='utf-8') as log:
            for line in process.stdout:
                log.write(line);log.flush()
                try:
                    info=json.loads(line)
                    if isinstance(info,dict) and 'progress' in info:
                        job.update(progress=info['progress'],message=info.get('message',''))
                        for key in ('exportMode','fallbackReason','performance'):
                            if key in info:job[key]=info[key]
                except json.JSONDecodeError:pass
        code=process.wait()
        if (folder/'cancel').exists():job.update(status='cancelled',message='导出已取消');(folder/'video.mp4').unlink(missing_ok=True)
        elif code:job.update(status='failed',message=job.get('message') or '导出失败，请检查本机渲染环境')
        else:job.update(status='complete',progress=100,message=('快速导出完成' if job.get('exportMode')=='fast' else '兼容导出完成')+'，可下载 MP4')
    except Exception as e:job.update(status='failed',message=str(e))
    finally:BUSY.release()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs):super().__init__(*args,directory=str(ROOT),**kwargs)
    def log_message(self,*args):pass
    def send(self,data,status=200,type='application/json; charset=utf-8',filename=None):
        if not isinstance(data,bytes):data=json.dumps(data,ensure_ascii=False).encode('utf-8')
        self.send_response(status);self.send_header('Content-Type',type);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
        if filename:self.send_header('Content-Disposition',f'attachment; filename="{filename}"')
        self.end_headers();self.wfile.write(data)
    def allowed(self):
        hosts=(f'127.0.0.1:{PORT}',f'localhost:{PORT}')
        if self.headers.get('Host') not in hosts:return False
        origin=self.headers.get('Origin')
        return not origin or origin in tuple('http://'+h for h in hosts)
    def do_GET(self):
        if not self.allowed():return self.send({'error':'仅允许本机编辑器访问'},403)
        path=urlsplit(self.path).path
        if path=='/api/health':return self.send({'ready':True,'version':'0.3.1','schemaVersions':['0.2.0','0.3.0'],'exportModes':['auto','fast','compatibility'],'ffmpeg':bool(shutil.which('ffmpeg')),'activeExports':sum(j['status'] in ('queued','running') for j in JOBS.values())})
        match=re.fullmatch(r'/api/exports/([a-f0-9]{32})(?:/(project|download))?',path)
        if match:
            job=JOBS.get(match[1])
            if not job:return self.send({'error':'导出任务不存在'},404)
            if match[2]=='project':
                raw=(job['folder']/'project.json').read_bytes()
                if parse_qs(urlsplit(self.path).query).get('visual')==['1']:
                    project=json.loads(raw);project['audioTracks']=[];return self.send(project)
                return self.send(raw)
            if match[2]=='download':
                if job['status']!='complete':return self.send({'error':'视频尚未生成'},409)
                f=job['folder']/'video.mp4';self.send_response(200);self.send_header('Content-Type','video/mp4');self.send_header('Content-Length',str(f.stat().st_size));self.send_header('Content-Disposition','attachment; filename="lesson.mp4"');self.end_headers()
                with f.open('rb') as data:shutil.copyfileobj(data,self.wfile)
                return
            return self.send({k:v for k,v in job.items() if k!='folder'})
        target=(ROOT/unquote(path).lstrip('/')).resolve()
        if not target.is_relative_to(ROOT) or any(x in ('.venv','.work','.git') for x in target.relative_to(ROOT).parts):return self.send({'error':'文件不可访问'},403)
        return super().do_GET()
    def do_POST(self):
        if not self.allowed():return self.send({'error':'仅允许本机编辑器访问'},403)
        path=urlsplit(self.path).path
        cancel=re.fullmatch(r'/api/exports/([a-f0-9]{32})/cancel',path)
        if cancel:
            job=JOBS.get(cancel[1])
            if not job:return self.send({'error':'任务不存在'},404)
            if job['status'] in ('queued','running'):(job['folder']/'cancel').touch()
            return self.send({'ok':True})
        try:
            count=int(self.headers.get('Content-Length','0'))
            if not 0<count<=200*1024*1024:raise ValueError('文件过大或内容为空')
            raw=self.rfile.read(count)
            if path=='/api/import':
                with zipfile.ZipFile(io.BytesIO(raw)) as z:
                    if sum(i.file_size for i in z.infolist())>200*1024*1024:raise ValueError('工程包解压大小超过限制')
                    entries=[n for n in z.namelist() if n.endswith('.svgfilm.json') or n in ('project.json','project.svgfilm.json')]
                    if len(entries)!=1:raise ValueError('工程包需包含唯一的 project.svgfilm.json 或 project.json')
                    data=json.loads(z.read(entries[0]).decode('utf-8-sig'))
                return self.send(data)
            d=json.loads(raw.decode('utf-8-sig'));check_request(d)
            if path=='/api/portable':return self.send(portable(d['project']),type='text/html; charset=utf-8',filename='lesson.html')
            if path!='/api/exports':return self.send({'error':'接口不存在'},404)
            if not BUSY.acquire(blocking=False):return self.send({'error':'已有视频正在导出，请完成或取消后重试'},409)
            try:
                id=uuid.uuid4().hex;folder=WORK/id;folder.mkdir(parents=True,exist_ok=False);(folder/'project.json').write_text(json.dumps(d['project'],ensure_ascii=False),encoding='utf-8');JOBS[id]={'id':id,'folder':folder,'status':'queued','progress':0,'message':'等待渲染'};threading.Thread(target=run_job,args=(id,d),daemon=True).start()
            except Exception:BUSY.release();raise
            return self.send({'id':id},202)
        except Exception as e:return self.send({'error':str(e)},400)

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--port',type=int,default=8765);ap.add_argument('--open',action='store_true');args=ap.parse_args();PORT=args.port
    WORK.mkdir(parents=True,exist_ok=True)
    server=ThreadingHTTPServer(('127.0.0.1',PORT),Handler)
    if args.open:threading.Timer(.3,lambda:webbrowser.open(f'http://127.0.0.1:{PORT}')).start()
    print(f'Prism: http://127.0.0.1:{PORT}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:
        for job in JOBS.values():
            if job['status'] in ('queued','running'):(job['folder']/'cancel').touch()
        server.server_close()
