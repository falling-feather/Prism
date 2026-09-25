"""Validate a JSON project using the actual running workbench in an isolated browser."""
from pathlib import Path
import argparse,json,sys,urllib.parse,urllib.request

CHECK=r'''async input=>{
  const P=await import('./src/project.mjs');
  await studio.loadProject(input);
  const initial=studio.getProject(),times=[];
  const images=[...studio.renderer.svg.querySelectorAll('image')];
  for(const element of images){
    const src=element.getAttribute('href')||element.getAttribute('xlink:href');
    if(!src)throw Error('图片缺少素材地址');
    const img=new Image();img.src=src;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('图片解码超时')),10000);img.decode().then(()=>{clearTimeout(timer);resolve();},()=>{clearTimeout(timer);reject(Error('图片无法解码'));});});
  }
  for(const track of initial.audioTracks){
    const audio=new Audio();audio.preload='metadata';
    const length=await new Promise((resolve,reject)=>{
      const finish=(value,error)=>{clearTimeout(timer);audio.onloadedmetadata=audio.onerror=null;audio.removeAttribute('src');audio.load();error?reject(Error(error)):resolve(value);};
      const timer=setTimeout(()=>finish(null,'音频解码超时'),10000);
      audio.onloadedmetadata=()=>finish(audio.duration);audio.onerror=()=>finish(null,'音频无法解码：'+track.name);audio.src=track.dataUrl;
    });
    if(!Number.isFinite(length)||track.offset+track.duration>length+.05)throw Error('音频裁剪超出真实素材长度：'+track.name);
    if(track.mediaDuration!==undefined&&Math.abs(track.mediaDuration-length)>.05)throw Error('音频 mediaDuration 与实际素材不一致：'+track.name);
  }
  let start=0;
  for(const scene of initial.scenes){const length=P.length(scene);times.push(start,start+length/2,start+Math.max(0,length-1/initial.canvas.fps));start+=length;}
  const snapshot=t=>{studio.seek(t);const svg=studio.renderer.svg.cloneNode(true);svg.querySelectorAll('[data-source-id]').forEach(e=>{if(e.style.display==='none')e.remove();});return new XMLSerializer().serializeToString(svg);};
  for(const time of times){const first=snapshot(time);snapshot(0);if(snapshot(time)!==first)throw Error('重复寻帧得到不同画面：'+time);}
  const edited=P.clone(initial),scene=edited.scenes[0],checks={text:'not-present',component:'not-present'};
  if(scene.texts.length){scene.texts[0].text+=' [check]';checks.text='pending';}
  if(scene.objects.length){scene.objectOverrides[scene.objects[0].id]={...scene.objectOverrides[scene.objects[0].id],dx:17};checks.component='pending';}
  await studio.loadProject(edited);studio.seek(P.length(scene)/2);
  if(checks.text==='pending'){
    const node=studio.renderer.node(scene.texts[0].objectId);
    if(!node?.textContent.includes('[check]'))throw Error('文字修改没有反映到渲染节点');checks.text='pass';
  }
  if(checks.component==='pending'){
    const wrapper=studio.renderer.wrapper(scene.objects[0].id);
    if(!wrapper?.getAttribute('transform').startsWith('translate(17 '))throw Error('组件编辑没有反映到布局层');checks.component='pass';
  }
  const saved=P.serializeProject(studio.getProject());await studio.loadProject(JSON.parse(saved));
  if(P.serializeProject(studio.getProject())!==saved)throw Error('保存回读改变了编辑数据');
  if(JSON.stringify(studio.getProject().sources)!==JSON.stringify(initial.sources))throw Error('编辑改变了源素材或动画');
  await studio.loadProject(initial);
  return {schemaVersion:initial.schemaVersion,scenes:initial.scenes.length,samples:times.length,media:{images:images.length,audio:initial.audioTracks.length,status:'pass'},seek:'pass',edits:checks,roundTrip:'pass'};
}'''

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('project',type=Path);ap.add_argument('--url',default='http://127.0.0.1:8765')
    ap.add_argument('--browser',choices=['msedge','chrome','chromium'],default='msedge')
    ap.add_argument('--report',type=Path);ap.add_argument('--check-portable',action='store_true')
    args=ap.parse_args();report={'ok':False,'input':str(args.project.resolve())}
    try:
        url=args.url.rstrip('/')
        if urllib.parse.urlsplit(url).hostname not in ('127.0.0.1','localhost','::1'):raise ValueError('校验工具仅连接本机工作台')
        if args.report and args.report.resolve()==args.project.resolve():raise ValueError('报告路径不能覆盖输入工程')
        raw=args.project.read_bytes()
        if len(raw)>160*1024*1024:raise ValueError('输入超过160 MiB')
        project=json.loads(raw.decode('utf-8-sig'))
        with urllib.request.urlopen(url+'/api/health',timeout=5) as response:health=json.load(response)
        if health.get('version')!='0.3.0':raise ValueError('请启动0.3.0工作台服务后校验')
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser=pw.chromium.launch(headless=True,**({} if args.browser=='chromium' else {'channel':args.browser}))
            page=browser.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(url);page.wait_for_function('window.studio?.ready',timeout=45000)
            report.update(page.evaluate(CHECK,project));report['portable']='not-requested'
            if args.check_portable:
                response=page.request.post(url+'/api/portable',data={'project':project})
                if not response.ok:raise ValueError(response.text())
                offline=browser.new_page();offline.on('pageerror',lambda e:errors.append(str(e)))
                offline.set_content(response.text());offline.wait_for_selector('#stage[data-scene]')
                offline.locator('#stage').click();offline.wait_for_function("Number(document.querySelector('#stage').dataset.time)>0")
                offline.close();report['portable']='pass'
            browser.close()
            if errors:raise ValueError('; '.join(errors))
        report['ok']=True
    except Exception as error:report['error']=str(error)
    output=json.dumps(report,ensure_ascii=False,indent=2)
    if args.report:
        target=args.report.resolve()
        if target==args.project.resolve():print(output);return 1
        if not target.parent.is_dir():print(output);print('报告父目录不存在',file=sys.stderr);return 1
        target.write_text(output+'\n',encoding='utf-8')
    print(output);return 0 if report['ok'] else 1
if __name__=='__main__':raise SystemExit(main())
