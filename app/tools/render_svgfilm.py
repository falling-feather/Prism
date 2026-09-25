"""Deterministic video export through the same browser renderer used by the editor."""
from pathlib import Path
import argparse,base64,json,shutil,subprocess,sys

def emit(progress,message):
    print(json.dumps({'progress':progress,'message':message},ensure_ascii=False),flush=True)

def audio_filters(tracks,start,seconds):
    filters=[];labels=[]
    for i,t in enumerate(tracks,1):
        chain=f'[{i}:a]atrim=start={t.get("offset",0)}:duration={t["duration"]},asetpts=PTS-STARTPTS'
        if t.get('fadeIn',0):chain+=f',afade=t=in:st=0:d={t["fadeIn"]}'
        if t.get('fadeOut',0):chain+=f',afade=t=out:st={t["duration"]-t["fadeOut"]}:d={t["fadeOut"]}'
        # Establish a sample clock after inserting silence; inherited frame PTS can otherwise trim it away.
        chain+=f',volume={t["volume"]},adelay={round(t["start"]*1000)}:all=1,asetpts=N/SR/TB[a{i}]'
        filters.append(chain);labels.append(f'[a{i}]')
    filters.append(''.join(labels)+f'amix=inputs={len(tracks)}:normalize=0:dropout_transition=0,apad,asetpts=N/SR/TB,atrim=start={start}:duration={seconds},asetpts=PTS-STARTPTS,alimiter=limit=0.95:level=false:latency=true[mix]')
    return ';'.join(filters)

def render(project_path,url,job,out,width,start,end,cancel):
    from playwright.sync_api import sync_playwright
    project=json.loads(project_path.read_text(encoding='utf-8'))
    fps=project['canvas']['fps'];height=round(width*project['canvas']['height']/project['canvas']['width']/2)*2
    if not shutil.which('ffmpeg'):raise RuntimeError('没有找到 FFmpeg，请将它加入 PATH')
    silent=out.with_name('silent.mp4');log=out.with_name('encoder.log');encoder=None;errors=[]
    def check_cancel():
        if cancel.exists():raise InterruptedError('导出已取消')
    try:
        with sync_playwright() as pw,log.open('wb') as stderr:
            browser=pw.chromium.launch(channel='msedge',headless=True)
            page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(url+'/render.html?job='+job)
            try:page.wait_for_function('window.exporter && window.exporter.ready',timeout=45000)
            except Exception:
                raise RuntimeError('; '.join(errors) or '渲染页面未能就绪')
            frames=page.evaluate('(seconds)=>exporter.frameCount(seconds)',end-start);seconds=frames/fps
            if not 1<=frames<=432000:raise ValueError('导出帧数超出范围')
            check_cancel();emit(2,'画面已载入，正在生成视频帧')
            encoder=subprocess.Popen(['ffmpeg','-y','-v','error','-f','image2pipe','-vcodec','png','-framerate',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(silent)],stdin=subprocess.PIPE,stderr=stderr)
            cdp=page.context.new_cdp_session(page)
            for i in range(frames):
                check_cancel();page.evaluate('(t)=>exporter.render(t)',start+i/fps)
                if errors:raise RuntimeError('; '.join(errors))
                image=cdp.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False,'fromSurface':True})['data']
                encoder.stdin.write(base64.b64decode(image))
                if i%max(1,int(fps))==0:emit(round(3+87*i/frames,1),f'正在渲染 {i+1} / {frames} 帧')
            encoder.stdin.close()
            if encoder.wait(timeout=120):raise RuntimeError(log.read_text(encoding='utf-8',errors='replace'))
            browser.close()
        check_cancel();emit(92,'正在合成音乐与配音')
        tracks=[t for t in project['audioTracks'] if not t.get('muted') and t['volume']>0 and t['start']<end and t['start']+t['duration']>start]
        if not tracks:shutil.copyfile(silent,out)
        else:
            command=['ffmpeg','-y','-v','error','-i',str(silent)]
            for i,t in enumerate(tracks,1):
                f=out.parent/f'audio-{i}.bin';f.write_bytes(base64.b64decode(t['dataUrl'].split(',',1)[1],validate=True));command+=['-i',str(f)]
            command+=['-filter_complex',audio_filters(tracks,start,seconds),'-map','0:v:0','-map','[mix]','-t',str(seconds),'-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)]
            with log.open('ab') as stderr:
                mux=subprocess.Popen(command,stderr=stderr)
                try:
                    while True:
                        check_cancel()
                        try:code=mux.wait(timeout=.2);break
                        except subprocess.TimeoutExpired:pass
                    if code:raise RuntimeError(log.read_text(encoding='utf-8',errors='replace'))
                finally:
                    if mux.poll() is None:mux.terminate();mux.wait(timeout=10)
        check_cancel()
        report=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,r_frame_rate','-of','json',str(out)]))
        out.with_suffix('.json').write_text(json.dumps({'frames':frames,'start':start,'end':end,'seconds':seconds,'media':report},ensure_ascii=False,indent=2),encoding='utf-8')
        emit(100,'导出完成，可下载 MP4')
    finally:
        if encoder is not None and encoder.poll() is None:
            try:encoder.stdin.close()
            except (BrokenPipeError,ValueError):pass
            encoder.terminate()
            try:encoder.wait(timeout=10)
            except subprocess.TimeoutExpired:encoder.kill();encoder.wait()
        silent.unlink(missing_ok=True)
        for f in out.parent.glob('audio-*.bin'):f.unlink()

if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--project',type=Path,required=True);ap.add_argument('--url',required=True);ap.add_argument('--job',required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--width',type=int,default=1280);ap.add_argument('--start',type=float,default=0);ap.add_argument('--end',type=float,required=True);ap.add_argument('--cancel',type=Path,required=True);a=ap.parse_args()
    try:render(a.project,a.url,a.job,a.out,a.width,a.start,a.end,a.cancel)
    except Exception as e:
        emit(0,str(e));sys.exit(2 if isinstance(e,InterruptedError) else 1)
