/* Shared hand-drawn SVG primitives; biology and the new guide live in organelles.js.
 * Every visible object is SVG geometry. Labels are glyph paths, not font files.
 */
(function(root){'use strict';
 const NS='http://www.w3.org/2000/svg',C={paper:'#e7e5da',white:'#f2f0e6',ink:'#252720',soft:'#737469',light:'#c9cbbc',red:'#b33d32',pink:'#dca29a',green:'#687e60',mint:'#dde3d1',blue:'#718b95',water:'#dee6e2',rose:'#ecd9ce'};
 const R=M.round;
 function create(svg,glyphs){
  let serial=0,tracks=[],id='global';const buckets={global:tracks},counts={},textCounts={},textCatalog=[],objectCatalog=[];
  const n=(tag,attrs={},p)=>{const e=document.createElementNS(NS,tag);for(const[k,v]of Object.entries(attrs))if(v!==undefined)e.setAttribute(k,String(v));if(p)p.appendChild(e);return e};
  const defs=n('defs',{},svg);
  for(const[ch,g]of Object.entries(glyphs))n('path',{id:'glyph-'+ch.codePointAt(0).toString(16),d:g.d},defs);
  const group=(p,label='',attrs={})=>{const key=id+':o'+(counts[id]??0);counts[id]=(counts[id]??0)+1;const e=n('g',{'data-object':label,'data-node-id':key,...attrs},p);if(label)objectCatalog.push({id:key,label,parentId:p.closest?.('[data-node-id]')?.getAttribute('data-node-id')||null});return e};
  const track=(e,fn)=>{tracks.push({e,fn});return e};
  const motion=(p,label,fn,attrs={})=>track(group(p,label,attrs),fn);
  const show=(p,label,a=0,b=1e9)=>motion(p,label,(e,t)=>e.setAttribute('display',t>=a&&t<b?'inline':'none'));
  const pop=(p,label,a=0,d=.4,x=0,y=0)=>motion(p,label,(e,t)=>{const q=M.ease(M.p(t,a,d));e.setAttribute('opacity',q);e.setAttribute('transform',`translate(${x} ${R(y+8*(1-q))}) scale(${R(.97+.03*q)})`)});
  function compile(d){if(/[a-zAaHhVv]/.test(d))return null;let idx=0;const s=d.replace(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g,v=>{idx++;return '@'}).split('@');let nums=(d.match(/[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?/g)||[]).map(Number);return{s,nums,seed:serial++};}
  function deform(c,t,amp=.19){let out=c.s[0];c.nums.forEach((v,i)=>{const k=c.seed*13+i*3.7;out+=R(v+amp*(.7*Math.sin(t*5.1+k)+.3*Math.sin(t*9.7+k*.41)))+c.s[i+1]});return out}
  function p(parent,d,o={}){
   const b=o.b??.1,dur=o.dur??.55,fill=o.fill??'none';
   const e=n('path',{d,fill,stroke:o.stroke??C.ink,'stroke-width':o.w??2.1,'stroke-linecap':'round','stroke-linejoin':'round',pathLength:1,'data-role':o.role??'stroke'},parent);
   const c=o.wiggle===false?null:compile(d);
   if(o.dash)e.setAttribute('stroke-dasharray',o.dash);
   if(o.static){return e}
   track(e,(e,t,gt)=>{const q=M.p(t,b,dur);e.setAttribute('visibility',q>0?'visible':'hidden');if(!o.dash){e.setAttribute('stroke-dasharray','1 1');e.setAttribute('stroke-dashoffset',R(1-q))}if(fill!=='none')e.setAttribute('fill-opacity',R(M.p(q,.35,.45)));if(c&&q>0)e.setAttribute('d',deform(c,gt,o.amp??.18));});return e;
  }
  const line=(par,x,y,xx,yy,o={})=>p(par,`M${x} ${y} L${xx} ${yy}`,o);
  const ellipse=(par,x,y,rx,ry,o={})=>p(par,`M${x-rx} ${y} C${x-rx} ${y-ry*.5523} ${x-rx*.5523} ${y-ry} ${x} ${y-ry} C${x+rx*.5523} ${y-ry} ${x+rx} ${y-ry*.5523} ${x+rx} ${y} C${x+rx} ${y+ry*.5523} ${x+rx*.5523} ${y+ry} ${x} ${y+ry} C${x-rx*.5523} ${y+ry} ${x-rx} ${y+ry*.5523} ${x-rx} ${y} Z`,o);
  const circle=(par,x,y,r,o={})=>ellipse(par,x,y,r,r,o);
  function rect(par,x,y,w,h,o={}){return p(par,`M${x} ${y} Q${x+w*.5} ${y-.8} ${x+w} ${y} L${x+w+.2} ${y+h} Q${x+w*.4} ${y+h+.5} ${x} ${y+h} Z`,o)}
  function roundrect(par,x,y,w,h,r=12,o={}){return p(par,`M${x+r} ${y} L${x+w-r} ${y} Q${x+w} ${y} ${x+w} ${y+r} L${x+w} ${y+h-r} Q${x+w} ${y+h} ${x+w-r} ${y+h} L${x+r} ${y+h} Q${x} ${y+h} ${x} ${y+h-r} L${x} ${y+r} Q${x} ${y} ${x+r} ${y} Z`,o)}
  function text(par,str,x,y,size=24,o={}){
   const key=id+':t'+(textCounts[id]??0);textCounts[id]=(textCounts[id]??0)+1;
   const g=group(par,str,{'data-text':str,'data-role':o.role??'text','data-text-id':key});
   const e=n('text',{x,y,'font-size':size,'font-family':'KaiTi, STKaiti, serif','text-anchor':o.anchor??'start',fill:o.color??C.ink,'data-content':'1'},g);e.textContent=str;
   const meta={id:key,objectId:g.getAttribute('data-node-id'),text:str,x,y,size,font:'KaiTi, STKaiti, serif',fill:o.color??C.ink,anchor:o.anchor??'start',width:0,start:o.static?0:(o.b??.1),end:1e9};textCatalog.push(meta);
   if(!o.static)track(g,(e,t)=>e.setAttribute('opacity',M.ease(M.p(t,meta.start,o.dur??.3))));
   return{g,width:str.length*size};
  }
  function stamp(par,str,x,y,o={}){let size=o.size??23,w=Math.max(76,str.length*size*.69+20),h=o.h??38;const g=group(par,'红印 '+str,{transform:`translate(${x} ${y}) rotate(-4)`});rect(g,0,0,w,h,{fill:C.red,stroke:C.red,w:1,b:o.b??.4,dur:.25,wiggle:false});text(g,str,w/2,h*.72,size,{anchor:'middle',color:C.white,b:(o.b??.4)+.15,step:.035,bold:12});return g}
  function heading(par,sc){if(sc.id==='opening'||sc.id==='ending')return;const g=group(par,'标题',{'data-layer':'titles'});text(g,sc.title,73,106,sc.title.length>10?41:46,{b:.25,step:.04,bold:12});text(g,sc.topic,75,147,21,{b:.7,step:.023,color:C.soft,bold:7});stamp(g,sc.date,1030,61,{b:.55,size:23});return g}
  function bubble(par,str,x,y,w,tx,ty,b=2,end=1e9,o={}){const h=o.h??49,r=22;const wrap=show(par,'对白 '+str,b,end);wrap.setAttribute('data-role','bubble');const g=group(wrap);const base=M.clamp(tx,x+25,x+w-25);
   p(g,`M${x+r} ${y} Q${x+w/2} ${y-1} ${x+w-r} ${y} Q${x+w} ${y} ${x+w} ${y+h/2} Q${x+w} ${y+h} ${x+w-r} ${y+h} L${base+10} ${y+h} L${tx} ${ty} L${base-10} ${y+h} L${x+r} ${y+h} Q${x} ${y+h} ${x} ${y+h/2} Q${x} ${y} ${x+r} ${y} Z`,{b,dur:.3,fill:C.white,w:2,wiggle:false});text(g,str,x+w/2,y+33,o.size??23,{b:b+.18,step:.02,anchor:'middle',bold:13});return wrap;}
  function arrow(par,d,x,y,a=0,b=1,o={}){p(par,d,{b,dur:.6,stroke:o.color??C.ink,w:o.w??2});const g=group(par,'箭头',{transform:`translate(${x} ${y}) rotate(${a})`});p(g,'M-9 -6 L0 0 L-9 6',{b:b+.45,dur:.18,stroke:o.color??C.ink,w:o.w??2});return g}
  function hatch(par,x,y,w,h,b=.2,gap=9){for(let yy=y;yy<y+h;yy+=gap)line(par,x,yy,Math.min(x+w,x+(yy-y)*.8+15),Math.max(y,yy-w*.35),{b:b+(yy-y)*.002,w:1,stroke:C.light})}
  function book(par,x,y,w=72,h=90,b=.3,rot=0){const g=group(par,'书',{transform:`translate(${x} ${y}) rotate(${rot})`});p(g,`M0 0 Q${w*.45} -3 ${w} 1 L${w} ${h} Q${w*.6} ${h-2} 0 ${h} Z`,{b,fill:C.white,w:2});line(g,9,2,9,h-1,{b:b+.17,w:1.4});line(g,18,14,w-10,14,{b:b+.24,w:1.4,stroke:C.soft});line(g,18,21,w-18,21,{b:b+.26,w:1,stroke:C.soft});return g}
  function cloud(par,x,y,scale=1,b=.5){const base=group(par,'云',{transform:`translate(${x} ${y}) scale(${scale})`});const g=motion(base,'轻云',(e,t,gt)=>e.setAttribute('transform',`translate(${R(3*Math.sin(gt*.35+x))} ${R(Math.sin(gt*.67))})`));p(g,'M-42 13 C-68 12 -68 -6 -50 -9 C-51 -35 -14 -42 -7 -20 C7 -52 45 -35 43 -12 C73 -13 71 15 49 15 Z',{b,fill:C.paper,w:1.2,stroke:C.soft});return base}
  function light(par,x,y,b=1){const g=group(par,'灯泡');p(g,`M${x-11} ${y+19} C${x-12} ${y+8} ${x-28} ${y+5} ${x-26} ${y-12} C${x-22} ${y-43} ${x+27} ${y-42} ${x+28} ${y-12} C${x+29} ${y+4} ${x+11} ${y+7} ${x+11} ${y+19} Z`,{b,fill:C.white,w:2});for(let i=0;i<3;i++)line(g,x-11,y+20+i*5,x+11,y+20+i*5,{b:b+.3+i*.08,w:1.5});const rays=motion(g,'灯光',(e,t,gt)=>e.setAttribute('opacity',.45+.45*Math.abs(Math.sin(gt*1.5))));for(let i=0;i<7;i++){let a=-Math.PI+Math.PI*i/6;line(rays,x+39*Math.cos(a),y-7+39*Math.sin(a),x+49*Math.cos(a),y-7+49*Math.sin(a),{b:b+.8+i*.04,stroke:C.red,w:1.6});}return g}
  function littlePlant(par,x,y,scale=1,b=1){const rootg=group(par,'纸上盆栽',{transform:`translate(${x} ${y}) scale(${scale})`});p(rootg,'M-24 -38 L-16 0 L19 0 L27 -38 Z',{b,fill:C.paper,w:1.7});const g=motion(rootg,'叶片',(e,t,gt)=>e.setAttribute('transform',`rotate(${R(2.4*Math.sin(gt*1.3+x))} 0 -38)`));p(g,'M1 -38 Q-4 -88 2 -119 M0 -81 Q-30 -118 -43 -88 Q-15 -66 0 -81 M1 -102 Q23 -133 39 -108 Q15 -90 1 -102',{b:b+.15,w:1.8,fill:C.paper});return rootg}
  function spark(par,x,y,b=1,color=C.red){const g=motion(par,'闪光',(e,t,gt)=>e.setAttribute('transform',`translate(${x} ${y}) rotate(${R(3*Math.sin(gt*2))}) scale(${R(.95+.08*Math.sin(gt*3))})`));p(g,'M0 -13 Q1 -1 13 0 Q1 1 0 13 Q-1 1 -13 0 Q-1 -1 0 -13 Z',{b,stroke:color,fill:color,w:.8});return g}
  return{C,n,defs,group,track,motion,show,pop,p,line,ellipse,circle,rect,roundrect,text,stamp,heading,bubble,arrow,hatch,book,cloud,light,littlePlant,spark,
   setScene(name){id=name;tracks=buckets[name]??(buckets[name]=[])},render(name,t,gt){for(const q of buckets[name]||[])q.fn(q.e,t,gt)},stats(){return{tracks:Object.values(buckets).reduce((a,x)=>a+x.length,0),scenes:Object.keys(buckets).length}},buckets,textCatalog,objectCatalog};
 }
 root.PaperArt={create,C};
})(globalThis);
