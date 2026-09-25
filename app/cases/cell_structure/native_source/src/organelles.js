/* Hand-authored biological symbols. All scales and colours are schematic.
 * Return groups, not baked frames, so the same structures are independently editable.
 */
(function(root){'use strict';
function create(A){
 const C=A.C,R=M.round;
 const set=(g,label,x,y,s=1,rot=0)=>A.group(g,label,{transform:`translate(${x} ${y}) rotate(${rot}) scale(${s})`,'data-component':label});
 const drift=(p,label,seed=0,amp=1.5)=>A.motion(p,label,(e,t,gt)=>e.setAttribute('transform',`translate(${R(amp*.6*Math.sin(gt*.74+seed))} ${R(amp*Math.sin(gt*.91+seed))}) rotate(${R(.5*Math.sin(gt*.57+seed))})`));
 function chromatin(g,x,y,s=1,b=.4){let k=set(g,'染色质',x,y,s);A.p(k,'M-32 -8 C-48 -36 -4 -47 9 -24 C22 -2 -11 2 -22 -13 C-35 -31 28 -41 36 -12 C46 11 15 31 -2 19 C-17 9 5 -17 18 0 C35 24 -3 43 -23 26 C-48 3 1 -2 6 16',{b,w:2.0,stroke:C.soft,fill:'none',amp:.27});return k;}
 function nucleus(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,'细胞核',x,y,s),g=drift(rootg,'核的微动',x,.65);
  A.ellipse(g,0,0,84,75,{b,w:2.2,fill:C.white});A.ellipse(g,0,0,77,68,{b:b+.18,w:1.5});
  chromatin(g,-13,-8,.97,b+.45);chromatin(g,-14,24,.58,b+.55);
  A.circle(g,31,16,18,{b:b+.6,fill:C.rose,w:1.9});A.p(g,'M18 15 Q31 4 42 18 M20 23 Q33 13 44 22',{b:b+.8,w:.9,stroke:C.soft});
  for(const a of [0,105,227,310]){const h=set(g,'核孔',80*Math.cos(a*Math.PI/180),71*Math.sin(a*Math.PI/180),1,a);A.rect(h,-8,-5,16,10,{b:b+.9,w:0,stroke:C.white,fill:C.white,wiggle:false});A.line(h,-8,-6,8,-6,{b:b+.95,w:1.6,wiggle:false});A.line(h,-8,6,8,6,{b:b+1,w:1.6,wiggle:false});}
  return rootg;
 }
 function ribosome(p,x,y,s=1,b=.5,o={}){
  const g=set(p,'核糖体',x,y,s);const main=drift(g,'核糖体工作微动',x,o.active?.75:.25);
  A.p(main,'M-30 3 C-41 -14 -21 -33 -6 -25 C5 -39 33 -28 35 -9 Q38 7 21 8 L8 5 Q-4 13 -15 6 Z',{b,fill:C.rose,w:1.8});
  A.p(main,'M-24 14 Q-8 9 5 13 Q19 8 28 17 C24 35 -23 37 -29 20 Z',{b:b+.16,fill:C.white,w:1.8});return g;
 }
 function mitochondrion(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,'线粒体',x,y,s,o.rot??0),g=drift(rootg,'线粒体微动',x,o.still?0:1.0);
  A.p(g,'M-91 -12 C-92 -46 -50 -58 -6 -45 C34 -37 42 -55 77 -32 C112 -6 100 41 60 49 C22 59 -5 32 -42 38 C-74 43 -96 15 -91 -12 Z',{b,w:2,fill:C.white});
  A.p(g,'M-80 -12 C-82 -34 -62 -42 -48 -39 L-44 -7 Q-39 17 -34 -7 L-35 -37 Q-22 -35 -10 -32 L-6 -1 Q-1 19 4 -3 L4 -31 Q20 -26 32 -31 L33 -6 Q35 17 43 -3 L43 -33 Q71 -34 80 -12 C96 19 67 40 46 37 L44 13 Q41 -5 35 15 L34 34 Q18 25 4 25 L0 11 Q-6 -4 -11 13 L-10 25 Q-22 23 -35 27 L-37 11 Q-42 -6 -47 14 L-47 28 C-71 33 -85 9 -80 -12 Z',{b:b+.2,w:1.5,fill:'none',amp:.15});
  for(let i=0;i<4;i++)A.circle(g,-21+i*21,3+7*Math.sin(i*2),1.5,{b:b+.65+i*.07,w:.6,fill:C.soft,stroke:C.soft});return rootg;
 }
 function chloroplast(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,'叶绿体',x,y,s,o.rot??0),g=drift(rootg,'叶绿体微动',x,.8);
  A.ellipse(g,0,0,105,57,{b,w:2,fill:C.mint,stroke:C.green});A.ellipse(g,0,0,97,49,{b:b+.2,w:1.2,stroke:C.green});
  [-58,0,58].forEach((xx,i)=>{let h=A.motion(g,'基粒',(e,t,gt)=>e.setAttribute('opacity',.87+.13*Math.sin(gt*1.6+i)**2));for(let k=0;k<5;k++){let yy=-19+k*8;A.ellipse(h,xx,yy,20,4.5,{b:b+.5+i*.22+k*.035,fill:k%2?C.mint:C.white,stroke:C.green,w:1.2});} });
  A.p(g,'M-38 1 L-20 1 M20 9 L38 9',{b:b+1.1,w:1.3,stroke:C.green});return rootg;
 }
 function er(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,o.smooth?'光面内质网':'粗面内质网',x,y,s),g=drift(rootg,'内质网微动',x,.65);
  if(o.smooth){const ds=['M-78 36 C-35 17 -47 -25 -9 -33 C36 -37 19 8 63 9','M-75 -44 C-44 -44 -53 -1 -17 1 C14 -2 27 -7 64 -38','M-38 12 C-6 21 -22 48 17 42 C43 39 50 28 82 42','M17 -27 C-7 -66 26 -69 58 -57'];ds.forEach((d,i)=>{A.p(g,d,{b:b+i*.15,w:14,stroke:C.ink,dur:.8,amp:.09});A.p(g,d,{b:b+i*.15+.02,w:10,stroke:C.white,dur:.8,amp:.09});});}
  else{
   A.p(g,'M-78 -51 C-109 -48 -104 -13 -80 -14 C-100 7 -109 28 -79 42',{b,w:8,stroke:C.ink,amp:.08});A.p(g,'M-78 -51 C-109 -48 -104 -13 -80 -14 C-100 7 -109 28 -79 42',{b:b+.05,w:4,stroke:C.white,amp:.08});
   [-45,-12,22].forEach((yy,i)=>{A.p(g,`M-82 ${yy-5} Q-45 ${yy-17} -7 ${yy-4} Q35 ${yy+8} 79 ${yy-9} Q95 ${yy-8} 83 ${yy+4} Q40 ${yy+21} -6 ${yy+8} Q-45 ${yy-4} -82 ${yy+8} Z`,{b:b+i*.12,w:1.6,fill:C.white});
    for(let k=0;k<7;k++){let xx=-70+k*22;ribosome(g,xx,yy-14+6*Math.sin((xx+20)/45),.13,b+.5+i*.17+k*.035,{active:true});}
   });
  }return rootg;
 }
 function golgi(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,'高尔基体',x,y,s),g=drift(rootg,'高尔基体微动',x,1.05);
  [-47,-23,1,25].forEach((yy,i)=>{const ww=82-i*4;A.p(g,`M${-ww} ${yy} Q-46 ${yy+14} 0 ${yy+13} Q53 ${yy+14} ${ww} ${yy-3} Q${ww+7} ${yy+3} ${ww-1} ${yy+7} Q44 ${yy+27} 0 ${yy+24} Q-49 ${yy+24} ${-ww-2} ${yy+8} Z`,{b:b+i*.17,w:1.7,fill:i%2?C.white:C.rose});});
  if(o.vesicles!==false){[-1,1].forEach((side,i)=>{for(let k=0;k<3;k++){const g2=A.motion(g,'周边囊泡',(e,t,gt)=>{const q=(gt*.22+k/3+i*.15)%1;e.setAttribute('transform',`translate(${R(side*(91+28*q))} ${R(-34+83*q)})`);e.setAttribute('opacity',M.p(t,b+1,.4)*Math.sin(Math.PI*q));});A.circle(g2,0,0,7+k%2*2,{b:b+.8,fill:C.white,w:1.3});A.circle(g2,0,0,2.2,{b:b+.9,fill:C.red,stroke:C.red,w:.5});}});}
  return rootg;
 }
 function vacuole(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,'液泡',x,y,s),g=A.motion(rootg,'液泡缓慢容积变化',(e,t,gt)=>{const q=o.swelling?o.swelling(t):.98+.02*Math.sin(gt*.6);e.setAttribute('transform',`scale(${R(q)} ${R(q)})`)});
  A.p(g,'M-104 -65 C-72 -100 48 -84 103 -59 C137 -31 134 50 94 72 C38 99 -68 87 -107 58 C-135 31 -141 -36 -104 -65 Z',{b,fill:C.water,stroke:C.blue,w:1.9});
  for(let i=0;i<15;i++){let xx=(M.hash(i+33)-.5)*172,yy=(M.hash(i+122)-.5)*107;const d=A.motion(g,'细胞液溶质',(e,t,gt)=>e.setAttribute('transform',`translate(${R(xx+2*Math.sin(gt+i))} ${R(yy+2*Math.cos(gt*.7+i))})`));A.circle(d,0,0,i%3?1.8:3.2,{b:b+.6+i*.027,w:.8,fill:i%3?C.blue:C.paper,stroke:C.blue});}return rootg;
 }
 function lysosome(p,x,y,s=1,b=.5,o={}){
  const rootg=set(p,'溶酶体',x,y,s),g=drift(rootg,'溶酶体微动',x,1.0);A.ellipse(g,0,0,51,46,{b,w:1.9,fill:C.rose});
  for(let i=0;i<9;i++){const xx=(M.hash(i+60)-.5)*64,yy=(M.hash(i+188)-.5)*60;const enz=A.motion(g,'水解酶',(e,t,gt)=>e.setAttribute('transform',`translate(${R(xx+3*Math.sin(gt*.6+i))} ${R(yy+3*Math.cos(gt*.8+i))}) rotate(${R(12*Math.sin(gt+i))})`));A.p(enz,'M-4 2 L0 -4 L5 2 L1 6 Z',{b:b+.4+i*.04,w:1.1,stroke:C.red,fill:C.paper});}return rootg;
 }
 function centrosome(p,x,y,s=1,b=.5,o={}){
  const g=set(p,'中心体',x,y,s);
  [[-20,-7,-24],[17,15,66]].forEach(([xx,yy,rot],k)=>{const h=set(g,'中心粒',xx,yy,1,rot);A.p(h,'M-13 -28 L-13 22 C-13 34 13 34 13 22 L13 -28 Z',{b:b+k*.3,w:1.6,fill:C.white});for(let j=-7;j<=7;j+=7)A.line(h,j,-22,j,25,{b:b+.3+k*.2,w:1,stroke:C.soft});A.ellipse(h,0,-28,13,7,{b:b+.35+k*.3,w:1.5,fill:C.white});for(let j=0;j<9;j++){let a=j*M.TAU/9;A.ellipse(h,8.3*Math.cos(a),-28+4.2*Math.sin(a),1.45,1.0,{b:b+.5+j*.035+k*.3,w:.55,fill:C.soft});}});return g;
 }
 function cell(p,x,y,s=1,b=.4,o={}){
  const rootg=set(p,o.plant?'植物细胞':'动物细胞',x,y,s),g=drift(rootg,'细胞整体缓动',x,.4);
  if(o.plant){A.p(g,'M-223 -135 Q-235 -83 -229 0 L-230 134 Q-215 151 -177 145 L215 143 Q235 131 231 91 L227 -129 Q197 -146 148 -144 L-179 -145 Z',{b,w:5.5,fill:C.white,stroke:C.green});A.p(g,'M-214 -128 Q-223 -59 -220 9 L-219 132 L216 130 L215 -129 Z',{b:b+.2,w:1.5,fill:C.paper});}
  else A.p(g,'M-235 -4 C-249 -102 -160 -160 -60 -143 C20 -164 170 -141 219 -62 C277 31 201 150 101 145 C14 168 -15 136 -97 145 C-179 150 -243 93 -235 -4 Z',{b,w:2.6,fill:C.white});
  const particles=A.group(g,'细胞质基质的物质');for(let i=0;i<24;i++){let xx=(M.hash(i+37)-.5)*381,yy=(M.hash(i+164)-.5)*214;const part=A.motion(particles,'物质微动',(e,t,gt)=>e.setAttribute('transform',`translate(${R(xx+1.9*Math.sin(gt*.6+i))} ${R(yy+1.6*Math.cos(gt*.8+i))})`));A.circle(part,0,0,1.6+i%3*.3,{b:b+.5+i*.01,w:.6,fill:C.light,stroke:C.light});}
  if(o.plant){vacuole(g,24,10,1.18,b+.4);nucleus(g,-160,42,.45,b+.7);chloroplast(g,-127,-104,.32,b+.7,{rot:10});chloroplast(g,139,-93,.31,b+.85,{rot:-15});chloroplast(g,156,101,.32,b+.9,{rot:13});mitochondrion(g,-48,118,.30,b+.9);mitochondrion(g,179,23,.32,b+1.1,{rot:82});er(g,-158,-42,.38,b+.95);golgi(g,21,-103,.35,b+1.1);}
  else{nucleus(g,-71,-9,.86,b+.4);er(g,63,-21,.70,b+.65);golgi(g,127,82,.49,b+.85);mitochondrion(g,-67,-105,.46,b+.6,{rot:-8});mitochondrion(g,-122,100,.48,b+.8,{rot:10});lysosome(g,158,-80,.4,b+.95);centrosome(g,-182,-58,.40,b+.8);for(let i=0;i<6;i++)ribosome(g,-22+i*22,111-14*Math.sin(i),.11,b+1+i*.04);}
  return rootg;
 }
 function lens(p,x=163,y=600,s=1,b=.5,o={}){
  const g=A.group(p,'小镜：拟人放大镜',{'data-component':'lens-guide'}),feet=A.group(g,'交替踏地');const legs=[];
  [-1,1].forEach((side,i)=>legs.push(A.p(feet,`M${side*18} -58 Q${side*23} -22 ${side*24} -3 L${side*36} 0 L${side*15} 0`,{b:b+.3+i*.08,w:2.7,wiggle:false,role:i?'right-foot':'left-foot'})));
  const body=A.group(g,'镜身呼吸'),arms=[];
  [-1,1].forEach((side,i)=>{let arm=A.group(body,i?'右手指向':'左手摆动');A.p(arm,`M${side*39} -96 Q${side*65} -92 ${side*65} -57`,{b:b+.45,w:2.5,wiggle:false});A.circle(arm,side*65,-54,4.6,{b:b+.75,w:1.6,fill:C.white,wiggle:false});arms.push(arm);});
  A.p(body,'M23 -77 L41 -88 L67 -47 Q64 -39 52 -38 Z',{b:b+.2,fill:C.red,stroke:C.red,w:2});A.line(body,46,-72,58,-49,{b:b+.8,stroke:C.pink,w:1.2});
  A.circle(body,-4,-106,46,{b,w:3.0,fill:C.white,amp:.15});A.circle(body,-4,-106,39,{b:b+.15,w:1.1,stroke:C.soft,amp:.12});A.p(body,'M-30 -124 Q-21 -139 -5 -138',{b:b+.5,w:2.0,stroke:C.light});
  const eyes=[],pupils=[];
  [-17,9].forEach((xx,i)=>{const eye=A.group(body,'眼睑');A.ellipse(eye,xx,-106,8,10,{b:b+.5+i*.07,w:1.1,fill:C.white,wiggle:false});const pu=A.n('circle',{cx:xx,cy:-106,r:3.9,fill:C.ink,'data-role':'pupil'},eye);eyes.push(eye);pupils.push(pu);});
  const mouth=A.p(body,'M-15 -87 Q-4 -78 7 -87',{b:b+.8,w:1.6,wiggle:false,role:'mouth'});
  A.track(g,(e,t,gt)=>{const enter=M.ease(M.p(t,b,1.15)),travel=65*enter,dx=o.dx?o.dx(t,gt):0,xx=x-65+travel+dx,yy=y+M.ground(xx,gt)-600;
   e.setAttribute('transform',`translate(${R(xx)} ${R(yy)}) scale(${s})`);e.setAttribute('opacity',M.p(t,b,.3));
   const walking=M.window(t,b,b+1.4,.15);[-1,1].forEach((sign,i)=>{let ph=travel/32+(i?.5:0),c=Math.floor(ph),r=ph-c;let fx=(c-(i?.5:0))*32+14-travel,fy=0;if(r>.59){let u=(r-.59)/.41;fx+=32*M.ease(u);fy=-13*Math.sin(Math.PI*u);}fx*=walking;fy*=walking;const hx=sign*18;legs[i].setAttribute('d',`M${hx} -59 Q${R(hx+fx*.45)} ${R(-27+fy*.4)} ${R(hx+fx)} ${R(-3+fy)} Q${R(hx+fx+sign*8)} ${R(fy-1)} ${R(hx+fx+sign*12)} ${R(fy)} L${R(hx+fx-sign*7)} ${R(fy)}`);});
   const bre=Math.sin(gt*1.66+(o.seed||0)),bob=-walking*Math.abs(Math.cos(travel/32*Math.PI*2))*2;
   body.setAttribute('transform',`translate(0 ${R(bob)}) rotate(${R(.65*bre+(o.lean?o.lean(t):0))} -4 -60) scale(1 ${R(1+.004*bre)})`);
   let target=o.look?o.look(t,gt):[790,330];if(o.audience&&t>o.audience)target=[xx,yy-106*s];let gaz=M.gaze(target[0],target[1],xx-4*s,yy-106*s,3.5);
   eyes.forEach((eye,i)=>{const b=M.blink(gt,(o.seed||0)+.82);eye.setAttribute('transform',`translate(0 ${R(-106*(1-Math.max(.08,b)))}) scale(1 ${R(Math.max(.08,b))})`);pupils[i].setAttribute('cx',R((i?9:-17)+gaz.x));pupils[i].setAttribute('cy',R(-106+gaz.y));pupils[i].setAttribute('visibility',t>.95?'visible':'hidden');});
   arms.forEach((arm,i)=>{let a=(i?1:-1)*(walking*18*Math.cos(travel/32*Math.PI*2)+2*Math.sin(gt*2));if(i&&o.point)a+=-30*M.window(t,3,500,.5);if(o.wave&&i)a+=-100*M.window(t,6,500,.5)+18*Math.sin(gt*6)*M.window(t,6,500,.5);arm.setAttribute('transform',`rotate(${R(a)} ${i?39:-39} -96)`);});
   const surprise=o.surprise&&o.surprise(t);mouth.setAttribute('d',surprise?'M-8 -87 C-8 -95 1 -95 1 -87 C1 -78 -8 -78 -8 -87 Z':'M-15 -87 Q-4 -78 7 -87');
  });return{g,body,legs,pupils,mouth};
 }
 function protein(p,x,y,s=1,b=.5,o={}){const g=set(p,'蛋白质示意',x,y,s);A.p(g,'M-16 0 C-31 -25 4 -24 9 -10 C26 -20 34 5 11 13 C15 33 -20 29 -17 10 C-36 11 -36 -5 -16 0 Z',{b,w:2.0,stroke:o.color||C.red,fill:C.rose,amp:.25});return g;}
 function vesicle(p,x,y,s=1,b=.5){const g=set(p,'运输囊泡',x,y,s);A.circle(g,0,0,25,{b,fill:C.white,w:1.8});protein(g,0,0,.43,b+.2);return g;}
 return{set,drift,chromatin,nucleus,ribosome,mitochondrion,chloroplast,er,golgi,vacuole,lysosome,centrosome,cell,lens,protein,vesicle};
}
root.BioArt={create};
})(globalThis);
