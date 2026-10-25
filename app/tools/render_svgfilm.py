"""Deterministic SVG export with bounded WebCodecs batches and a screenshot fallback."""
from pathlib import Path
import argparse,base64,json,shutil,subprocess,sys,time
from asset_store import AssetStore


def emit(progress,message,**details):
    print(json.dumps({'progress':progress,'message':message,**details},ensure_ascii=False),flush=True)


def audio_filters(tracks,start,seconds):
    filters=[];labels=[]
    for i,t in enumerate(tracks,1):
        chain=f'[{i}:a]atrim=start={t.get("offset",0)}:duration={t["duration"]},asetpts=PTS-STARTPTS'
        if t.get('fadeIn',0):chain+=f',afade=t=in:st=0:d={t["fadeIn"]}'
        if t.get('fadeOut',0):chain+=f',afade=t=out:st={t["duration"]-t["fadeOut"]}:d={t["fadeOut"]}'
        chain+=f',volume={t["volume"]},adelay={round(t["start"]*1000)}:all=1,asetpts=N/SR/TB[a{i}]'
        filters.append(chain);labels.append(f'[a{i}]')
    filters.append(''.join(labels)+f'amix=inputs={len(tracks)}:normalize=0:dropout_transition=0,apad,asetpts=N/SR/TB,atrim=start={start}:duration={seconds},asetpts=PTS-STARTPTS,alimiter=limit=0.95:level=false:latency=true[mix]')
    return ';'.join(filters)


def check_cancel(cancel):
    if cancel.exists():raise InterruptedError('导出已取消')


def stop_process(process):
    if process is not None and process.poll() is None:
        process.terminate()
        try:process.wait(timeout=5)
        except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)


def run_ffmpeg(command,log,cancel):
    with log.open('ab') as stderr:
        process=subprocess.Popen(command,stderr=stderr)
        try:
            while process.poll() is None:
                check_cancel(cancel)
                try:process.wait(timeout=.2)
                except subprocess.TimeoutExpired:pass
            if process.returncode:raise RuntimeError(log.read_text(encoding='utf-8',errors='replace')[-4000:])
        finally:stop_process(process)


def screenshot_video(page,path,log,cancel,width,height,start,fps,frames,errors):
    command=['ffmpeg','-y','-v','error','-f','image2pipe','-vcodec','png','-framerate',str(fps),'-i','pipe:0','-an','-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart',str(path)]
    with log.open('ab') as stderr:
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stderr=stderr)
        try:
            cdp=page.context.new_cdp_session(page)
            for i in range(frames):
                check_cancel(cancel);page.evaluate('(t)=>exporter.render(t)',start+i/fps)
                if errors:raise RuntimeError('; '.join(errors))
                data=cdp.send('Page.captureScreenshot',{'format':'png','captureBeyondViewport':False,'fromSurface':True,'optimizeForSpeed':True})['data']
                process.stdin.write(base64.b64decode(data))
                if i%max(1,int(fps))==0:emit(round(3+84*i/frames,1),f'兼容渲染 {i+1} / {frames} 帧',exportMode='compatibility')
            process.stdin.close()
            while process.poll() is None:
                check_cancel(cancel)
                try:process.wait(timeout=.2)
                except subprocess.TimeoutExpired:pass
            if process.returncode:raise RuntimeError(log.read_text(encoding='utf-8',errors='replace')[-4000:])
        finally:
            if not process.stdin.closed:
                try:process.stdin.close()
                except (BrokenPipeError,ValueError):pass
            stop_process(process)
    return {}


def fast_video(page,path,log,cancel,width,height,start,end,fps,frames,errors):
    raw=path.with_suffix('.h264');stats={}
    try:
        init_begin=time.perf_counter()
        init=page.evaluate('(options)=>exporter.fast.start(options)',{'width':width,'height':height,'start':start,'end':end})
        if not init['supported']:raise RuntimeError(init['reason'])
        if init['frames']!=frames:raise RuntimeError('快速导出帧数计划不一致')
        emit(3,'快速编码器已就绪',exportMode='fast')
        init_seconds=time.perf_counter()-init_begin
        batches_begin=time.perf_counter()
        completed=0
        with raw.open('wb') as output:
            while completed<frames:
                check_cancel(cancel);batch=page.evaluate('()=>exporter.fast.batch()')
                if errors:raise RuntimeError('; '.join(errors))
                if not completed<batch['completed']<=frames:raise RuntimeError('快速导出进度无效')
                # Only encoded H.264 crosses the process boundary, at most one second per batch.
                output.write(base64.b64decode(batch['data'],validate=True));completed=batch['completed'];stats=batch['stats']
                emit(round(3+84*completed/frames,1),f'快速渲染 {completed} / {frames} 帧',exportMode='fast')
        stats.update(encoderInitSeconds=round(init_seconds,3),batchSeconds=round(time.perf_counter()-batches_begin,3))
        check_cancel(cancel);emit(88,'正在封装视频',exportMode='fast')
        run_ffmpeg(['ffmpeg','-y','-v','error','-fflags','+genpts','-r',str(fps),'-f','h264','-i',str(raw),'-an','-c:v','copy','-movflags','+faststart',str(path)],log,cancel)
        return stats
    finally:
        try:
            if not page.is_closed():page.evaluate('()=>exporter.fast.close()')
        except Exception as cleanup_error:
            with log.open('a',encoding='utf-8') as note:note.write('\nFast encoder cleanup: '+str(cleanup_error)+'\n')
        raw.unlink(missing_ok=True)


def render(project_path,url,job,out,width,start,end,cancel,mode='compatibility'):
    from playwright.sync_api import sync_playwright
    began=time.perf_counter();project=json.loads(project_path.read_text(encoding='utf-8'))
    fps=project['canvas']['fps'];height=round(width*project['canvas']['height']/project['canvas']['width']/2)*2
    if mode not in ('auto','fast','compatibility'):raise ValueError('不支持的导出方式')
    if not shutil.which('ffmpeg'):raise RuntimeError('没有找到 FFmpeg，请将它加入 PATH')
    silent=out.with_name('silent.mp4');log=out.with_name('encoder.log');errors=[];selected=mode;fallback=None;stats={}
    log.write_text('',encoding='utf-8')
    try:
        check_cancel(cancel)
        with sync_playwright() as pw:
            browser=pw.chromium.launch(channel='msedge',headless=True)
            try:
                page=browser.new_page(viewport={'width':width,'height':height},device_scale_factor=1)
                page.expose_function('prismCancelled',lambda:cancel.exists())
                page.on('pageerror',lambda e:errors.append(str(e)))
                page.goto(url+'/render.html?job='+job)
                deadline=time.monotonic()+45
                while not page.evaluate('Boolean(window.exporter?.ready)'):
                    check_cancel(cancel)
                    if errors:raise RuntimeError('; '.join(errors))
                    if time.monotonic()>deadline:raise RuntimeError('渲染页面未能就绪')
                    page.wait_for_timeout(100)
                check_cancel(cancel)
                frames=page.evaluate('(seconds)=>exporter.frameCount(seconds)',end-start);seconds=frames/fps
                if not 1<=frames<=432000:raise ValueError('导出帧数超出范围')
                load_seconds=time.perf_counter()-began;visual_begin=time.perf_counter();check_cancel(cancel)
                if mode=='auto' and frames<90:
                    selected='compatibility';fallback='短片少于90帧，使用兼容模式避免编码器启动开销'
                    emit(2,'正在准备短片导出',exportMode=selected,fallbackReason=fallback)
                if mode=='fast' or (mode=='auto' and frames>=90):
                    try:
                        stats=fast_video(page,silent,log,cancel,width,height,start,end,fps,frames,errors);selected='fast'
                    except Exception as error:
                        check_cancel(cancel)
                        if mode=='fast':raise RuntimeError('快速导出失败：'+str(error)) from error
                        fallback=str(error)[:500];selected='compatibility'
                        emit(2,'快速通道不可用，正在切换兼容导出',exportMode=selected,fallbackReason=fallback)
                if selected=='compatibility':
                    emit(2,'正在准备兼容渲染',exportMode=selected)
                    stats=screenshot_video(page,silent,log,cancel,width,height,start,fps,frames,errors)
                visual_seconds=time.perf_counter()-visual_begin
            finally:browser.close()
        check_cancel(cancel);emit(92,'正在合成音乐与配音',exportMode=selected)
        mix_begin=time.perf_counter()
        tracks=[t for t in project['audioTracks'] if not t.get('muted') and t['volume']>0 and t['start']<end and t['start']+t['duration']>start]
        if not tracks:shutil.copyfile(silent,out)
        else:
            command=['ffmpeg','-y','-v','error','-i',str(silent)]
            for i,t in enumerate(tracks,1):
                resource=project.get('resources',{}).get(t.get('resourceId'),{})
                if resource.get('assetId'):
                    file=AssetStore(Path(__file__).resolve().parents[1]/'.work'/'assets').path(resource['assetId'])
                else:
                    file=out.parent/f'audio-{i}.bin';file.write_bytes(base64.b64decode((resource.get('dataUrl') or t['dataUrl']).split(',',1)[1],validate=True))
                command+=['-i',str(file)]
            command+=['-filter_complex',audio_filters(tracks,start,seconds),'-map','0:v:0','-map','[mix]','-t',str(seconds),'-c:v','copy','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)]
            run_ffmpeg(command,log,cancel)
        check_cancel(cancel)
        media=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration:stream=codec_type,codec_name,width,height,r_frame_rate,nb_frames','-of','json',str(out)]))
        video=next(s for s in media['streams'] if s['codec_type']=='video')
        if int(video.get('nb_frames',frames))!=frames:raise RuntimeError('成片帧数校验失败')
        performance={'totalSeconds':round(time.perf_counter()-began,3),'loadSeconds':round(load_seconds,3),'visualSeconds':round(visual_seconds,3),'mixSeconds':round(time.perf_counter()-mix_begin,3),**stats}
        out.with_suffix('.json').write_text(json.dumps({'frames':frames,'start':start,'end':end,'seconds':seconds,'media':media,'exportMode':selected,'fallbackReason':fallback,'performance':performance},ensure_ascii=False,indent=2),encoding='utf-8')
        emit(100,'导出完成，可下载 MP4',exportMode=selected,performance=performance)
    finally:
        silent.unlink(missing_ok=True)
        for file in out.parent.glob('audio-*.bin'):file.unlink()


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--project',type=Path,required=True);ap.add_argument('--url',required=True);ap.add_argument('--job',required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--width',type=int,default=1280);ap.add_argument('--start',type=float,default=0);ap.add_argument('--end',type=float,required=True);ap.add_argument('--cancel',type=Path,required=True);ap.add_argument('--mode',choices=['auto','fast','compatibility'],default='compatibility');a=ap.parse_args()
    try:render(a.project,a.url,a.job,a.out,a.width,a.start,a.end,a.cancel,a.mode)
    except Exception as error:emit(0,str(error));sys.exit(2 if isinstance(error,InterruptedError) else 1)
