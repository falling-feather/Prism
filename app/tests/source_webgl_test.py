"""A generic two-pass WebGL compositor must retain edits in its 2D texture."""
from pathlib import Path
import json, os, subprocess, sys, tempfile, time, unittest, urllib.request
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from import_canvas_source import import_source
from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parents[1]
URL = os.environ.get('SVGFILM_URL', 'http://127.0.0.1:8892').rstrip('/')
CODE = r"""
const canvas=document.getElementById('c'), gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true});
const layer=document.createElement('canvas');layer.width=640;layer.height=360;const c=layer.getContext('2d');
function card(c,x){c.fillStyle='#ef4422';c.fillRect(x,120,80,100);}
function label(c,s){c.font='28px sans-serif';c.fillStyle='#ffffff';c.fillText(s,240,90);}
const shader=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);return s;};
const p=gl.createProgram();
gl.attachShader(p,shader(gl.VERTEX_SHADER,`#version 300 es
in vec2 a;out vec2 uv;void main(){uv=a*.5+.5;gl_Position=vec4(a,0,1);}`));
gl.attachShader(p,shader(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float;in vec2 uv;out vec4 color;uniform sampler2D picture;void main(){color=texture(picture,uv);}`));
gl.bindAttribLocation(p,0,'a');gl.linkProgram(p);gl.useProgram(p);
const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);gl.enableVertexAttribArray(0);gl.vertexAttribPointer(0,2,gl.FLOAT,false,0,0);
function texture(){const t=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);return t;}
const input=texture(), intermediate=texture();gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,640,360,0,gl.RGBA,gl.UNSIGNED_BYTE,null);
const f=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,intermediate,0);
window.DUR=4;window.render=t=>{
 c.fillStyle='#112233';c.fillRect(0,0,640,360);card(c,60+t*10);label(c,'Texture label');
 const unit=t>.75?1:0;gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,input);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,layer);
 gl.useProgram(p);gl.uniform1i(gl.getUniformLocation(p,'picture'),unit);gl.viewport(0,0,640,360);gl.bindFramebuffer(gl.FRAMEBUFFER,f);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
 gl.bindTexture(gl.TEXTURE_2D,intermediate);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
};window.READY=true;
"""

class WebGLSourceTests(unittest.TestCase):
    def test_edit_before_texture_upload_and_roundtrip(self):
        with tempfile.TemporaryDirectory(dir=APP/'.work') as temporary:
            root=Path(temporary); source=root/'source';source.mkdir()
            (source/'index.html').write_text('<canvas id="c" width="640" height="360"></canvas><script type="module" src="main.js"></script>',encoding='utf-8')
            (source/'main.js').write_text(CODE,encoding='utf-8')
            output=root/'project.json'
            report=import_source(source,output,stage=root/'analysis',scan_step=1)
            self.assertGreaterEqual(report['objects'],3)
            self.assertGreaterEqual(report['texts'],1)
            project=json.loads(output.read_text(encoding='utf-8'))
            with sync_playwright() as pw:
                browser=pw.chromium.launch(channel='msedge',headless=True)
                try:
                    page=browser.new_page();page.goto(URL);page.wait_for_function('window.studio?.ready',timeout=45000)
                    page.evaluate('(p)=>studio.loadProject(p)',project)
                    page.evaluate('()=>studio.renderer.renderAsync(1)')
                    pixel="xy=>{const c=document.querySelector('#stage canvas');return [...c.getContext('2d').getImageData(Math.floor(xy[0]*c.width/640),Math.floor(xy[1]*c.height/360),1,1).data]}"
                    self.assertGreater(page.evaluate(pixel,[90,160])[0],200)
                    target=page.evaluate("studio.getProject().scenes[0].objects.find(o=>o.label==='图解 · card').id")
                    page.evaluate("async id=>{const p=studio.getProject();p.scenes[0].objectOverrides[id]={dx:100};p.scenes[0].texts[0].text='Edited texture';await studio.loadProject(p);await studio.renderer.renderAsync(1)}",target)
                    self.assertLess(page.evaluate(pixel,[90,160])[0],50)
                    self.assertGreater(page.evaluate(pixel,[200,160])[0],200)
                    saved=page.evaluate('JSON.stringify(studio.getProject())')
                    page.evaluate('s=>studio.loadProject(JSON.parse(s))',saved)
                    self.assertEqual(page.evaluate('studio.getProject().scenes[0].texts[0].text'),'Edited texture')
                    edited=json.loads(saved)
                finally: browser.close()
            def request(path,value=None,raw=None):
                data=json.dumps(value).encode('utf-8') if value is not None else raw
                headers={'Content-Type':'application/json' if value is not None else 'application/zip'}
                return urllib.request.urlopen(urllib.request.Request(URL+path,data=data,headers=headers),timeout=120)
            package=json.load(request('/api/package',{'project':edited}))
            packed=request(package['url']).read()
            restored=json.load(request('/api/import',raw=packed))
            self.assertEqual(restored['scenes'],edited['scenes'])
            for mode in ['compatibility','fast']:
                token=json.load(request('/api/exports',{'project':restored,'width':640,'start':.5,'end':1,'exportMode':mode}))['id']
                deadline=time.monotonic()+90
                while True:
                    status=json.load(request('/api/exports/'+token))
                    if status['status'] in ('complete','failed','cancelled'):break
                    self.assertLess(time.monotonic(),deadline,status);time.sleep(.25)
                self.assertEqual(status['status'],'complete',status)
                video=root/(mode+'.mp4');video.write_bytes(request('/api/exports/'+token+'/download').read())
                probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-count_frames','-select_streams','v','-show_entries','stream=nb_read_frames','-of','json',str(video)],encoding='utf-8'))
                self.assertEqual(probe['streams'][0]['nb_read_frames'],'12')
                rgb=subprocess.check_output(['ffmpeg','-v','error','-i',str(video),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
                self.assertLess(rgb[(160*640+90)*3],60)
                self.assertGreater(rgb[(160*640+200)*3],180)
            print(json.dumps({'webglPackageRoundtrip':True,'webglExportModes':['compatibility','fast'],'frames':12,'editedPixels':True}))

if __name__=='__main__':unittest.main()
