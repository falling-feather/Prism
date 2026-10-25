"""Asynchronous frame ordering, source failure rollback and runtime isolation."""

from pathlib import Path
import copy, json, os, time
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
URL = os.environ.get("SVGFILM_URL", "http://127.0.0.1:8765").rstrip("/")
p = json.loads(
    (ROOT / "cases/universal/clockwork.svgfilm.json").read_text(encoding="utf-8")
)


def program(code):
    project = copy.deepcopy(p)
    project["sources"]["clockwork"]["program"] = code
    return project


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel="msedge", headless=True)
    page = browser.new_page()
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    page.goto(URL)
    page.wait_for_function("window.studio?.ready", timeout=45000)
    # Install a separate source format at runtime. The workbench and timeline need no branches.
    custom = page.evaluate("""async()=>{
      const {sourceRegistry}=await import('./src/source-contract.mjs');
      const {registerAdapter}=await import('./src/adapter-registry.mjs');
      const {element}=await import('./src/svg-utils.mjs');
      sourceRegistry.register('contract-test-v1',{validate:s=>{if(!s.color)throw Error('missing color')}});
      registerAdapter('contract-test-v1',(id,source,host)=>{
        const oid=id+':o:panel',wrapper=element('g',{},host),node=element('rect',{'data-node-id':oid,x:40,y:70,width:160,height:100,fill:source.color},wrapper);
        return {host,objects:[{id:oid,label:'Panel',parentId:null,cx:120,cy:120}],texts:[],nodes:new Map([[oid,node]]),wrappers:new Map([[oid,wrapper]]),appliedOverrides:new Map(),renderSource:(_scene,time)=>node.setAttribute('x',40+time*10)};
      });
      return {schema:'svgfilm-project',schemaVersion:'0.4.0',projectId:'registry-check',title:'Registry',canvas:{width:640,height:360,fps:24,background:'#fff'},sources:{custom:{type:'contract-test-v1',duration:2,color:'#315f74'}},scenes:[{id:'one',sourceId:'custom',name:'Panel',in:0,out:2,hold:0,texts:[],objects:[],objectOverrides:{},subtitles:[]}],audioTracks:[]};
    }""")
    page.evaluate("(p)=>studio.loadProject(p)", custom)
    page.evaluate(
        """async()=>{const p=studio.getProject();p.scenes[0].objectOverrides['custom:o:panel']={dx:21};await studio.loadProject(p);await studio.renderer.renderAsync(1);}"""
    )
    assert (
        page.evaluate('studio.renderer.node("custom:o:panel").getAttribute("x")')
        == "50"
    )
    assert page.evaluate(
        'studio.renderer.wrapper("custom:o:panel").getAttribute("transform")'
    ).startswith("translate(21 ")
    isolated = program(
        """return {async render(c,t,a){
      let denied=false;try{indexedDB.open('svgfilm');}catch(error){denied=error.name==='SecurityError';}
      if(!denied)throw Error('Storage isolation failed');
      let network=false;try{await fetch("""
        + json.dumps(URL + "/api/health")
        + """,{mode:'no-cors'});}catch(error){network=true;}
      if(!network)throw Error('Network isolation failed');
      c.fillStyle='#315f74';c.fillRect(0,0,a.width,a.height);
    }};"""
    )
    page.evaluate("(p)=>studio.loadProject(p)", isolated)
    slow = program(
        """return {async render(c,t,a){await new Promise(r=>setTimeout(r,t<1?80:0));c.fillStyle='#ffffff';c.fillRect(0,0,a.width,a.height);a.object('dial',ctx=>{ctx.fillStyle='#ff0000';ctx.fillRect(210,100,220,220);},{x:t*10});}};"""
    )
    page.evaluate("(p)=>studio.loadProject(p)", slow)
    # Slow draws must still produce visible playback instead of discarding every frame.
    page.locator("#playBtn").click()
    page.wait_for_function(
        'studio.renderer.node("clockwork:o:dial").parentElement.getAttribute("transform")!=="matrix(1 0 0 1 0 0)"',
        timeout=5000,
    )
    page.locator("#playBtn").click()
    page.evaluate("()=>studio.renderer.whenReady()")
    during=page.evaluate("""async()=>{
      await studio.renderer.renderAsync(0);
      let t=.1;const producer=setInterval(()=>{studio.renderer.render(t);t+=.02;},10);
      try {
        await new Promise(resolve=>setTimeout(resolve,300));
        const transform=studio.renderer.node('clockwork:o:dial').parentElement.getAttribute('transform');
        const stats=studio.renderer.sources.get('clockwork').stats();
        return {transform,pending:stats.pending,queued:stats.queued};
      } finally {clearInterval(producer);await studio.renderer.whenReady();}
    }""")
    assert during['transform']!='matrix(1 0 0 1 0 0)',during
    assert during['pending']<=1 and during['queued'],during
    page.evaluate(
        """async()=>{studio.renderer.render(.1);studio.renderer.render(2);studio.renderer.render(3);await studio.renderer.whenReady();}"""
    )
    assert (
        page.evaluate(
            'studio.renderer.node("clockwork:o:dial").parentElement.getAttribute("transform")'
        )
        == "matrix(1 0 0 1 30 0)"
    )
    first_load = copy.deepcopy(slow)
    first_load["title"] = "earlier load"
    latest_load = copy.deepcopy(p)
    latest_load["title"] = "latest load"
    loaded = page.evaluate(
        """async ([a,b])=>{const first=studio.loadProject(a);await Promise.resolve();const second=studio.loadProject(b);await Promise.allSettled([first,second]);await studio.renderer.whenReady();return [studio.getProject().title,studio.renderer.project.title];}""",
        [first_load, latest_load],
    )
    assert loaded == ["latest load", "latest load"], loaded
    before = page.evaluate("JSON.stringify(studio.getProject())")
    broken = program("throw Error('deliberate initialization failure');")
    failure = page.evaluate(
        "p=>studio.loadProject(p).then(()=>null,error=>error.message)", broken
    )
    assert "deliberate initialization failure" in failure
    assert page.evaluate("JSON.stringify(studio.getProject())") == before
    page.evaluate("()=>studio.renderer.whenReady()")
    stuck = program("return {render(){while(true){}}};")
    page.evaluate(
        """p=>{window.runtimeFailure=null;studio.loadProject(p).then(()=>window.runtimeFailure='unexpected success',e=>window.runtimeFailure=e.message);}""",
        stuck,
    )
    started = time.monotonic()
    assert page.evaluate("1+1") == 2
    assert time.monotonic() - started < 2
    page.wait_for_function("window.runtimeFailure!==null", timeout=20000)
    assert "超过 10 秒" in page.evaluate("window.runtimeFailure")
    assert page.evaluate("JSON.stringify(studio.getProject())") == before
    page.evaluate("()=>studio.renderer.whenReady()")
    assert page.locator('iframe[title="动画绘制环境"]').count() == 1
    assert not errors, errors
    browser.close()
print(
    json.dumps(
        {
            "opaque_origin": True,
            "additional_adapter": True,
            "network_blocked": True,
            "latest_frame": True,
            "failure_rollback": True,
            "timeout_recovery": True,
            "errors": errors,
        }
    )
)
