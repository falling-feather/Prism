/* Eighteen original biology stages: actual cell geometry, not slide screenshots.
 * Moving cargo uses explicit curves; the secretory route has a causal one-shot sequence.
 */
(function(root){'use strict';
function build(A,sc,par,story){
 const B=BioArt.create(A),C=A.C,R=M.round;
 const stage=A.group(par,sc.title,{'data-scene':sc.id});
 const props=A.group(stage,'生物结构与动作',{'data-layer':'illustration'}),labels=A.group(stage,'结构标注',{'data-layer':'labels'}),dialogue=A.group(stage,'幽默气泡',{'data-layer':'dialogue'});
 function txt(s,x,y,size=23,o={}){return A.text(labels,s,x,y,size,{b:1.2,bold:7,...o});}
 function leader(s,x,y,xx,yy,b=2,o={}){txt(s,x,y,22,{b,color:o.color||C.soft,anchor:o.anchor||'start'});A.p(labels,`M${x+(o.anchor==='end'?-12:12)} ${y+8} Q${xx} ${y+18} ${xx} ${yy}`,{b:b+.3,dur:.55,w:1.2,stroke:o.color||C.soft,wiggle:false});A.circle(labels,xx,yy,2.5,{b:b+.7,w:.5,fill:o.color||C.soft,stroke:o.color||C.soft});}
 function packet(g,label,a,c,z,b=2,period=4,scale=.6,phase=0,fn=null){let wrap=A.show(g,label,b);let move=A.motion(wrap,label+'沿路径',(e,t,gt)=>{let q=((t-b)/period+phase)%1;q=(q+1)%1;let [x,y]=M.quad(a,c,z,q);e.setAttribute('transform',`translate(${R(x)} ${R(y)})`);e.setAttribute('opacity',Math.min(1,q*8,(1-q)*8));});if(fn)fn(move);else B.vesicle(move,0,0,scale,b);return wrap;}
 const guide=(o={})=>B.lens(props,o.x??151,600,o.scale??1.03,.65,{seed:sc.index*.31,point:true,...o});
 function gag(x=54,y=339,w=350,tx=161,ty=446,o={}){if(sc.gag)A.bubble(dialogue,sc.gag,x,y,w,tx,ty,sc.gagStart,sc.duration-.25,{size:22,...o});}
 function badge(text,x,y,w=134,b=1.8,color=C.red){const g=A.group(labels,'功能标记');A.roundrect(g,x,y,w,37,13,{b,w:1.4,stroke:color,fill:C.paper,wiggle:false});A.text(g,text,x+w/2,y+26,22,{b:b+.18,anchor:'middle',color,bold:8});return g;}
 function pulse(par,x,y,r=16,b=1,color=C.red,phase=0){const g=A.show(par,'反应波纹',b);let e=A.ellipse(g,x,y,r,r,{b,w:1.0,stroke:color,wiggle:false});A.track(g,(g,t,gt)=>{const q=((gt*.7+phase)%1);g.setAttribute('opacity',(1-q)*.55*M.p(t,b,.3));g.setAttribute('transform',`translate(${x} ${y}) scale(${R(1+q*.5)}) translate(${-x} ${-y})`)});return g;}
 function sun(x,y,scale=1,b=1){const g=B.set(props,'阳光',x,y,scale);A.circle(g,0,0,27,{b,w:1.6,stroke:C.red});for(let i=0;i<12;i++){let a=i*M.TAU/12;const ray=A.line(g,37*Math.cos(a),37*Math.sin(a),48*Math.cos(a),48*Math.sin(a),{b:b+.3+i*.03,w:1.5,stroke:C.red});A.track(ray,(e,t,gt)=>e.setAttribute('opacity',M.p(t,b+.3,.5)*(.6+.4*Math.sin(gt*1.5+i*.2)**2)));}}
 if(!['opening','ending'].includes(sc.id)){
  A.text(labels,sc.title,64,87,sc.title.length>17?37:43,{b:.25,step:.035,bold:12});
  A.text(labels,sc.topic,68,130,20,{b:.7,color:C.soft,step:.025,bold:4});
  A.p(labels,`M66 150 Q182 155 ${Math.min(320,70+sc.title.length*9)} 150`,{b:1.1,dur:.65,w:1.2,stroke:C.red,wiggle:false});
 }
 if(sc.id==='opening'){
  A.text(labels,'细胞里面，',80,274,91,{b:.5,step:.14,bold:12});A.text(labels,'谁在忙？',83,383,108,{b:1.4,step:.13,bold:11});
  A.text(labels,'一场细胞器的协作探访',91,442,28,{b:2.5,step:.07,color:C.soft});A.stamp(labels,'高一生物',94,476,{b:3.2,size:22,h:35});
  B.cell(props,985,380,.67,1.8);const lens=guide({x:785,scale:1.65,look:(t,gt)=>t<5?[1000,370]:[640,300],wave:true,point:false});
  B.ribosome(props,1130,547,.58,3);B.mitochondrion(props,638,526,.58,2.3,{rot:-12});B.chloroplast(props,1090,186,.38,2.7,{rot:8});
  A.p(props,'M599 374 C655 388 611 252 677 246 C724 239 741 285 715 307',{b:2.2,dur:2,w:1.25,stroke:C.red});A.spark(props,647,277,4.2);gag(675,180,449,834,319,{size:24});
  A.text(labels,'结构与功能示意 · 非真实比例与颜色',989,582,15,{b:4.2,anchor:'middle',color:C.soft,bold:3});
 }
 if(sc.id==='overview'){
  B.cell(props,799,364,1.05,.8);
  guide({look:(t,gt)=>t<6?[542,397]:t<10?[724,355]:[928,437]});
  leader('细胞膜',466,218,556,327,2);leader('细胞核',436,414,654,375,3);leader('细胞器',1079,404,946,433,4,{anchor:'end'});
  const marker=A.show(labels,'胞质基质定位',7.7);A.circle(marker,986,345,20,{b:7.7,w:1.1,stroke:C.red,wiggle:false});A.text(marker,'细胞质基质',1008,306,23,{b:8,color:C.red,anchor:'middle'});A.line(marker,1008,313,991,326,{b:8.3,w:1.0,stroke:C.red,wiggle:false});
  gag(42,318,361,147,439);txt('膜以内、核以外的区域：细胞质',799,569,22,{anchor:'middle',b:6.6,color:C.soft});
 }
 if(sc.id==='membrane'){
  // Each leaflet has outward heads and inward tails. Proteins span the bilayer.
  const membrane=A.group(props,'磷脂双分子层',{'data-component':'phospholipid-bilayer'});
  for(let i=0;i<26;i++){const xx=368+i*28;if((xx>650&&xx<735)||(xx>1001&&xx<1080))continue;
   const lipid=A.motion(membrane,'磷脂摆动',(e,t,gt)=>e.setAttribute('transform',`translate(${xx} ${R(1.2*Math.sin(gt*1.4+i*.45))})`));
   A.circle(lipid,0,325,7,{b:1.0+i*.027,w:1.15,fill:C.white});A.p(lipid,'M-3 331 Q-8 345 -4 359 M3 331 Q-1 345 5 359',{b:1.2+i*.027,w:1.0});
   A.circle(lipid,0,388,7,{b:1.1+i*.027,w:1.15,fill:C.white});A.p(lipid,'M-3 382 Q-8 369 -4 356 M3 382 Q-1 369 5 356',{b:1.3+i*.027,w:1.0});
  }
  const channel=A.group(props,'运输蛋白');A.p(channel,'M665 314 Q680 301 684 325 L686 388 Q681 410 664 400 Q649 391 654 371 Q643 344 665 314 Z M715 313 Q699 304 698 327 L696 388 Q703 410 719 398 Q729 385 723 369 Q736 341 715 313 Z',{b:1.6,w:2,fill:C.rose,stroke:C.red});
  leader('运输蛋白',554,488,672,395,3,{color:C.red});
  A.p(props,'M1015 402 L1017 328 Q996 311 1013 291 L1037 312 L1063 290 Q1080 313 1058 328 L1060 402 Z',{b:2.0,w:2.0,fill:C.white});
  txt('细胞外',1140,282,22,{b:2,anchor:'end'});txt('细胞内',1140,449,22,{b:2.3,anchor:'end'});
  leader('受体蛋白',1054,494,1041,405,8.6,{anchor:'middle'});
  for(let j=0;j<3;j++){const go=A.show(props,'通过运输蛋白',3);const ion=A.motion(go,'粒子运输',(e,t,gt)=>{const q=((t-3)/4+j/3)%1;const yy=230+q*267;e.setAttribute('transform',`translate(691 ${R(yy)})`);e.setAttribute('opacity',Math.min(1,q*7,(1-q)*7));});A.circle(ion,0,0,5.5,{b:2.5,w:1,fill:C.red,stroke:C.red});}
  const signal=A.show(props,'信号分子停在受体外',8.2);const sig=A.motion(signal,'受体结合',(e,t,gt)=>{const yy=M.keys([[0,205],[8.2,205],[10.2,277],[18,277]],t);e.setAttribute('transform',`translate(1038 ${yy}) rotate(${R(2*Math.sin(gt))})`)});A.p(sig,'M-16 -11 L15 -11 L0 7 Z',{b:8.2,w:1.4,fill:C.red,stroke:C.red});pulse(props,1038,424,10,10.3,C.red);pulse(props,1038,448,8,10.8,C.red,.4);
  guide({look:(t)=>t<8?[691,355]:[1038,285]});gag(35,230,364,148,448);
 }
 if(sc.id==='nucleus'){
  B.nucleus(props,761,377,2.02,.7);
  leader('双层核膜',435,242,603,355,2);leader('染色质（DNA和蛋白质）',632,185,698,327,3,{color:C.soft});leader('核仁',1093,469,826,410,7.5,{anchor:'end'});leader('核孔',1102,312,929,377,7.2,{anchor:'end'});
  const msg=A.show(props,'遗传信息副本出核',14.3);const moving=A.motion(msg,'RNA通过核孔',(e,t,gt)=>{const q=((t-14.3)/5)%1;const [x,y]=M.quad([852,377],[980,377],[1107,389],q);e.setAttribute('transform',`translate(${R(x)} ${R(y)})`);e.setAttribute('opacity',Math.min(1,q*10,(1-q)*10));});A.p(moving,'M-24 0 Q-18 -9 -10 0 T5 0 T20 0',{b:14.3,w:2,stroke:C.red});txt('RNA',1080,418,21,{b:15.3,color:C.red});
  guide({look:(t)=>t<7?[751,359]:t<14?[824,410]:[1035,377]});gag(33,309,435,146,451,{size:21});
 }
 if(sc.id==='ribosome'){
  const rib=B.ribosome(props,749,356,3.35,1,{active:true});
  A.p(props,'M400 394 Q471 385 561 394 T729 393 Q860 381 1015 394',{b:2.0,dur:1.5,w:2.1,stroke:C.soft});txt('信息模板：mRNA',454,433,21,{b:3.5,color:C.soft});
  // New chain leaves the large subunit; tiny incoming beads are amino acids.
  for(let j=0;j<11;j++){const bead=A.motion(props,'新生多肽的氨基酸',(e,t,gt)=>{const appear=M.p(t,3+j*.25,.45);const y=301-j*6.2+2*Math.sin(gt*1.6-j*.5);const x=809+j*15; e.setAttribute('transform',`translate(${R(x)} ${R(y)})`);e.setAttribute('opacity',appear)});if(j)A.line(bead,-15,6,0,0,{b:3+j*.25,w:1.5,stroke:C.red});A.circle(bead,0,0,5.8,{b:3+j*.25,w:1,fill:j%2?C.rose:C.red,stroke:C.red});}
  txt('多肽链',974,215,24,{b:6,color:C.red,anchor:'middle'});A.arrow(labels,'M973 225 Q986 241 959 247',959,247,140,6.3,{color:C.red,w:1.2});
  packet(props,'氨基酸到达',[452,292],[627,275],[702,298],3.2,4,.5,0,e=>A.circle(e,0,0,6,{b:3.2,w:1,fill:C.red,stroke:C.red}));
  const shared=A.show(props,'两种分布位置',8.4);B.ribosome(shared,526,530,.36,8.4);txt('游离',523,578,22,{b:8.8,anchor:'middle'});B.er(shared,916,539,.40,8.4);txt('附着在粗面内质网上',935,585,20,{b:9.1,anchor:'middle'});
  guide({look:(t)=>t<8?[909,258]:[892,513]});gag(40,303,350,152,446);
 }
 if(sc.id==='er'){
  B.er(props,564,356,1.58,1.0);B.er(props,986,353,1.45,1.7,{smooth:true});
  txt('粗面内质网',563,233,29,{b:1.8,anchor:'middle'});txt('光面内质网',987,233,29,{b:2.2,anchor:'middle'});
  badge('蛋白质加工',500,497,146,3);badge('脂质合成',923,497,131,8.5,C.green);
  for(let k=0;k<3;k++)packet(props,'加工中的蛋白质',[432,363],[556,409],[690,369],3.0,5,.25,k/3,e=>B.protein(e,0,0,.27,3));
  for(let k=0;k<3;k++)packet(props,'脂质产生',[913,349],[973,415],[1091,365],8.4,5.5,.4,k/3,e=>{A.circle(e,0,0,5,{b:8.4,w:1,stroke:C.green,fill:C.mint});A.p(e,'M-2 5 L-5 14 M2 5 L6 14',{b:8.6,w:1,stroke:C.green});});
  leader('这些小颗粒是核糖体',599,570,500,292,15.2,{anchor:'middle',color:C.red});
  guide({look:(t)=>t<8.4?[569,347]:t<15?[979,350]:[471,285]});gag(28,203,393,145,449,{size:21});
 }
 if(sc.id==='golgi'){
  B.golgi(props,778,361,2.3,.8,{vesicles:true});
  leader('一叠扁平囊',748,209,762,281,2.2,{anchor:'middle'});leader('囊泡',1122,460,1020,416,3,{anchor:'end'});
  A.arrow(labels,'M475 348 Q527 309 582 318',582,318,15,3,{color:C.red,w:1.5});A.arrow(labels,'M964 399 Q1031 454 1106 421',1106,421,-20,3.6,{color:C.red,w:1.5});
  packet(props,'送入高尔基体',[437,359],[536,331],[582,332],2.9,4,.62);packet(props,'离开高尔基体',[973,412],[1026,479],[1142,450],4,4.9,.63);
  txt('接收',452,322,21,{b:3,anchor:'middle',color:C.red});txt('送达',1142,410,21,{b:4.2,anchor:'middle',color:C.red});
  guide({look:(t,gt)=>[690+270*((gt*.18)%1),365]});gag(48,327,354,147,447);
 }
 if(sc.id==='mitochondrion'){
  B.mitochondrion(props,756,370,2.08,.8);
  leader('外膜',497,219,584,314,2.2);leader('嵴：内膜向内折叠',881,530,754,374,8.8,{anchor:'middle'});
  A.arrow(labels,'M997 359 Q1050 316 1111 362',1111,362,30,3.2,{color:C.red});
  for(let k=0;k<3;k++)packet(props,'ATP被利用',[940,379],[1056,287],[1144,368],3.6,5.1,.5,k/3,e=>{A.circle(e,0,0,22,{b:3.6,fill:C.white,stroke:C.red,w:1.3});A.text(e,'ATP',0,7,17,{b:3.7,anchor:'middle',color:C.red,bold:6});});
  A.text(labels,'能量转换，不是“发电插座”',766,579,22,{b:8.8,anchor:'middle',color:C.soft});
  guide({look:(t,gt)=>t<8?[756,361]:[1060,355]});gag(36,289,500,147,446,{size:22});
 }
 if(sc.id==='chloroplast'){
  B.chloroplast(props,768,377,2.13,.8);
  sun(768,219,.72,1.5);for(let k=0;k<3;k++)A.arrow(labels,`M${732+k*35} 257 L${737+k*35} 299`,737+k*35,299,90,2+k*.18,{color:C.red,w:1.3});
  leader('基粒：类囊体堆叠',736,551,768,380,8.8,{anchor:'middle',color:C.green});
  txt('CO₂ + 水',460,341,22,{b:3.1,anchor:'middle'});A.arrow(labels,'M439 354 Q473 383 531 377',531,377,0,3.4,{color:C.green,w:1.2});
  txt('有机物',1118,335,23,{b:3.3,anchor:'middle',color:C.green});txt('氧气',1121,451,22,{b:3.6,anchor:'middle'});
  for(let k=0;k<3;k++)packet(props,'有机物示意',[985,365],[1060,335],[1132,366],4.1,5.7,.3,k/3,e=>{A.p(e,'M-11 -7 L0 -13 L12 -7 L12 7 L0 13 L-11 7 Z',{b:4.1,w:1.5,stroke:C.green,fill:C.mint});});
  guide({look:(t)=>t<8?[766,226]:[767,368],surprise:(t)=>t>14});gag(29,302,480,147,445,{size:21});
 }
 if(sc.id==='vacuole'){
  const plant=B.set(props,'成熟植物细胞截面',786,369,1.13);A.roundrect(plant,-235,-155,470,307,32,{b:.9,w:5.5,stroke:C.green,fill:C.white});A.roundrect(plant,-223,-143,446,283,27,{b:1.05,w:1.5,fill:C.paper});
  const swell=t=>M.keys([[0,.92],[5,.94],[9,1.02],[18,1.02]],t)+.009*Math.sin(t*.85);
  B.vacuole(plant,18,5,1.39,1.3,{swelling:swell});B.nucleus(plant,-169,63,.46,1.7);B.chloroplast(plant,-154,-101,.35,2.0);B.chloroplast(plant,163,-106,.34,2.1);B.mitochondrion(plant,176,89,.31,2.2,{rot:35});
  leader('液泡膜',1096,501,1000,393,3,{anchor:'end',color:C.blue});
  txt('细胞液',805,374,33,{b:3.7,anchor:'middle',color:C.blue});
  for(let k=0;k<3;k++)packet(props,'水进入细胞',[449,360],[504,311],[638,359],4.7,5.8,.4,k/3,e=>A.p(e,'M0 -12 C-8 -1 -12 5 -5 10 C9 18 16 2 0 -12 Z',{b:4.7,w:1.3,stroke:C.blue,fill:C.water}));
  txt('成熟植物细胞示意',786,579,21,{b:3,anchor:'middle',color:C.soft});
  guide({look:(t,gt)=>[746,369]});gag(45,314,360,149,448);
 }
 if(sc.id==='lysosome'){
  B.lysosome(props,802,366,2.27,.8);
  const worn=A.show(props,'衰老的细胞器',1.8,12.5);const moving=A.motion(worn,'待分解成分进入融合囊腔',(e,t,gt)=>{let q=M.ease(M.p(t,3,5));e.setAttribute('transform',`translate(${R(M.mix(528,763,q))} ${R(M.mix(363,367,q))}) scale(${R(.70*(1-M.p(t,9,3)))})`)});const enclosure=A.group(moving,'包裹待分解细胞器的膜泡',{'data-component':'autophagic-envelope'});
  A.ellipse(enclosure,0,0,84,56,{b:2.0,w:1.4,stroke:C.soft,wiggle:false});
  A.ellipse(enclosure,0,0,79,51,{b:2.1,w:1.1,stroke:C.soft,wiggle:false});
  A.track(enclosure,(e,t)=>e.setAttribute('opacity',1-M.ease(M.p(t,6.6,1.4))));
  B.mitochondrion(moving,0,0,.67,1.8,{still:true});A.p(moving,'M-24 -20 L-8 -5 L-25 8 L-9 23',{b:2.3,w:1.3,stroke:C.red});
  const fusionCaption=A.show(labels,'膜泡融合提示',5.1,9.2);A.text(fusionCaption,'膜泡包裹 → 融合后分解',721,211,21,{b:5.1,color:C.red,anchor:'middle'});
  leader('水解酶',1099,252,853,339,2.5,{anchor:'end',color:C.red});txt('衰老、损伤的细胞器',519,465,22,{b:2.9,anchor:'middle'});
  for(let k=0;k<6;k++)packet(props,'可再利用的小分子',[831,369],[1008,282+k*12],[1145,399+k*11],9.1,5,.5,k/6,e=>A.circle(e,0,0,4+k%2,{b:9.1,w:1,fill:C.rose,stroke:C.red}));
  txt('回收利用',1098,499,26,{b:10.2,anchor:'middle',color:C.red});
  guide({look:(t)=>t<9?[550,351]:[1020,397]});gag(41,307,357,148,447);
 }
 if(sc.id==='skeleton'){
  const left=A.show(props,'中心体局部',1);B.centrosome(left,561,353,2.55,1.1);txt('中心体',560,229,28,{b:1.7,anchor:'middle'});
  txt('动物和某些低等植物细胞中常见',561,532,20,{b:4.2,anchor:'middle',color:C.soft});
  const cell=A.group(props,'细胞骨架纤维');A.ellipse(cell,992,350,173,133,{b:1.4,w:1.2,stroke:C.soft});
  for(let k=0;k<7;k++){const yy=257+k*31;A.p(cell,`M844 347 Q918 ${yy} 1119 ${yy+5}`,{b:2+k*.09,w:1.1,stroke:C.light,amp:.12});}
  const rail=A.show(props,'微管轨道',9.5);A.p(rail,'M830 412 Q967 306 1145 376',{b:9.5,w:2.1,stroke:C.red});A.p(rail,'M830 421 Q967 315 1145 385',{b:9.5,w:1.3,stroke:C.red});
  const motor=A.show(props,'马达蛋白沿骨架运输',10.2);const transport=A.motion(motor,'小囊泡运输',(e,t,gt)=>{const q=((t-10.2)/7)%1;const[x,y]=M.quad([841,405],[982,307],[1137,376],q);e.setAttribute('transform',`translate(${R(x)} ${R(y)})`)});
  const L=A.p(transport,'M0 -21 Q-5 -6 -13 4',{b:10.2,w:1.8,stroke:C.ink,wiggle:false});const Rleg=A.p(transport,'M0 -21 Q9 -4 14 4',{b:10.2,w:1.8,stroke:C.ink,wiggle:false});B.vesicle(transport,0,-48,.67,10.2);A.line(transport,0,-22,0,-34,{b:10.3,w:1.6});
  A.track(L,(e,t)=>{let z=Math.sin(t*7);e.setAttribute('d',`M0 -21 Q-5 -6 ${R(-9-7*z)} ${R(z>0?-4:4)}`)});A.track(Rleg,(e,t)=>{let z=Math.sin(t*7);e.setAttribute('d',`M0 -21 Q9 -4 ${R(9+7*z)} ${R(z<0?-4:4)}`)});
  txt('细胞骨架',994,526,26,{b:9.8,anchor:'middle'});txt('蛋白质纤维的网络',997,559,20,{b:10.4,anchor:'middle',color:C.soft});
  guide({look:(t)=>t<9.5?[555,346]:[995,356]});gag(29,285,421,147,447,{size:21});
 }
 if(sc.id==='journey'){
  // This is a one-shot causal sequence, not a perpetual conveyor. Only secretory proteins.
  B.er(props,461,379,1.07,1.1);B.golgi(props,727,383,1.04,1.4,{vesicles:false});
  txt('核糖体',359,252,23,{b:1.8,anchor:'middle'});B.ribosome(props,395,290,.65,1.7);A.line(labels,396,269,394,272,{b:2.3,w:1.1});
  txt('内质网',456,505,25,{b:2,anchor:'middle'});txt('高尔基体',727,505,25,{b:2.3,anchor:'middle'});
  txt('细胞内',1010,271,21,{b:2.3,anchor:'middle',color:C.soft});txt('细胞外',1150,271,21,{b:2.3,anchor:'middle',color:C.soft});
  const memb=A.p(props,'M1070 290 L1070 492',{b:1.6,w:3.5,wiggle:false,role:'fusion-membrane'});txt('细胞膜',1070,526,24,{b:2.6,anchor:'middle'});
  const nascent=A.show(props,'核糖体合成并进入内质网',2.5,7.1);A.p(nascent,'M404 295 Q398 314 419 329 Q445 322 442 347 Q431 368 461 372',{b:2.5,dur:3.9,w:3,stroke:C.red});
  const inside=A.show(props,'内质网内加工',5.2,7.3);B.protein(inside,460,372,.45,5.2);
  const toG=A.show(props,'内质网至高尔基体囊泡',7.0,11.7);const vg=A.motion(toG,'按真实曲线到达高尔基体',(e,t)=>{const[x,y]=M.secretion(t).erToGolgi;e.setAttribute('transform',`translate(${R(x)} ${R(y)})`)});B.vesicle(vg,0,0,.75,7.0);
  const processing=A.show(props,'高尔基体加工后的蛋白',11.4,14.3);B.protein(processing,738,381,.52,11.4);A.spark(processing,758,363,12.1,C.red);
  const toM=A.show(props,'高尔基体至细胞膜囊泡',14,20.2);const vm=A.motion(toM,'囊泡送往细胞膜',(e,t)=>{const[x,y]=M.secretion(t).golgiToMembrane;const q=M.secretion(t).fusion;e.setAttribute('transform',`translate(${R(x)} ${R(y)})`);e.setAttribute('opacity',1-q);});B.vesicle(vm,0,0,.96,14);
  const cargo=A.show(props,'胞吐释放蛋白质',18.05);const cp=A.motion(cargo,'只有内容物释放到细胞外',(e,t)=>e.setAttribute('transform',`translate(${R(M.secretion(t).cargoX)} 367)`));B.protein(cp,0,0,.46,18.05);
  A.track(memb,(e,t)=>{const q=M.window(t,18,22,.9),dx=48*q;const d=`M1070 290 L1070 342 C${R(1070-dx)} 342 ${R(1070-dx)} 347 ${R(1070-dx)} 367 C${R(1070-dx)} 388 ${R(1070-dx)} 392 1070 392 L1070 492`;e.setAttribute('d',d);});
  const labelsSteps=[['合成',367,222,2.5],['加工',462,450,5.2],['囊泡',568,293,7.2],['分类包装',730,268,11.4],['融合与释放',1072,239,18.3]];labelsSteps.forEach(([s,x,y,b])=>txt(s,x,y,20,{b,anchor:'middle',color:C.red}));
  const energy=A.show(props,'线粒体提供能量而不是货物中转站',21.2);B.mitochondrion(energy,774,564,.45,21.2);A.text(energy,'ATP供能支持',932,571,21,{b:21.7,color:C.red,anchor:'middle'});A.arrow(energy,'M824 565 L852 565',852,565,0,21.7,{color:C.red,w:1.2});
  guide({scale:.96,x:145,look:(t)=>t<7?[445,356]:t<14?[701,370]:[M.secretion(t).cargoX,367]});gag(33,306,362,145,448,{size:20});
 }
 if(sc.id==='compare'){
  B.cell(props,578,372,.68,1);B.cell(props,999,372,.72,1.25,{plant:true});
  txt('典型动物细胞',577,232,27,{b:1.6,anchor:'middle'});txt('成熟叶肉细胞',995,231,27,{b:1.9,anchor:'middle',color:C.green});
  const plants=A.show(labels,'植物区别标注',8.6);A.text(plants,'细胞壁',1137,535,23,{b:8.6,color:C.green,anchor:'middle'});A.p(plants,'M1137 517 Q1178 490 1164 452',{b:8.9,w:1.2,stroke:C.green,wiggle:false});
  A.text(plants,'大液泡',1005,553,23,{b:9.2,color:C.blue,anchor:'middle'});A.line(plants,1007,536,1015,410,{b:9.5,w:1.1,stroke:C.blue,wiggle:false});A.text(plants,'叶绿体',872,522,23,{b:9.2,color:C.green,anchor:'middle'});A.line(plants,875,503,907,299,{b:9.5,w:1.1,stroke:C.green,wiggle:false});
  guide({look:(t)=>t<8?[578,366]:[995,365]});gag(33,312,387,145,447,{size:22});
 }
 if(sc.id==='membranes'){
  const xs=[494,779,1071];['双层膜','单层膜','无膜'].forEach((s,i)=>{A.text(labels,s,xs[i],234,32,{b:1+i*.15,anchor:'middle',color:i===2?C.ink:C.red});A.p(labels,`M${xs[i]-90} 247 Q${xs[i]} 253 ${xs[i]+90} 247`,{b:1.5+i*.15,w:1.0,stroke:C.soft});});
  B.mitochondrion(props,441,319,.46,1.9);B.chloroplast(props,559,319,.41,2.1);txt('线粒体 · 叶绿体',501,375,23,{b:2.7,anchor:'middle'});B.nucleus(props,495,452,.52,3);txt('细胞核：双层核膜',499,542,22,{b:3.5,anchor:'middle',color:C.soft});
  B.er(props,729,313,.36,8.5);B.golgi(props,833,312,.39,8.7);B.vacuole(props,733,438,.27,8.9);B.lysosome(props,837,437,.53,9.1);txt('内质网 · 高尔基体',781,373,21,{b:9.3,anchor:'middle'});txt('液泡 · 溶酶体',782,520,22,{b:9.4,anchor:'middle'});
  B.ribosome(props,1070,323,1.07,2.2);txt('核糖体',1073,394,24,{b:3,anchor:'middle'});B.centrosome(props,1071,472,.91,2.4);txt('中心体',1075,549,24,{b:3.2,anchor:'middle'});
  guide({look:(t)=>t<8?[499,326]:[781,331]});
 }
 if(sc.id==='prokaryote'){
  const bac=B.set(props,'原核细胞示意',803,374,1.6);
  A.roundrect(bac,-166,-81,330,162,76,{b:.8,w:2.2,fill:C.white});A.roundrect(bac,-158,-73,314,146,68,{b:1.0,w:1.2,fill:C.paper});B.chromatin(bac,-5,-2,1.6,1.4);
  for(let i=0;i<18;i++){let xx=(M.hash(i+63)-.5)*243,yy=(M.hash(i+84)-.5)*109;let go=A.motion(bac,'核糖体微动',(e,t,gt)=>e.setAttribute('transform',`translate(${R(xx+1.2*Math.sin(gt+i))} ${R(yy+1.1*Math.cos(gt+i))})`));B.ribosome(go,0,0,.15,1.7+i*.03);}
  const flag=A.p(bac,'M163 9 C193 25 188 -15 219 -4 C247 4 239 34 265 26',{b:1.8,w:1.5,amp:.6});
  leader('拟核：没有核膜包被',810,216,801,346,7.5,{anchor:'middle'});leader('核糖体',1027,546,988,401,2.5,{anchor:'middle',color:C.red});
  guide({look:(t)=>t<7?[1034,395]:[802,364]});gag(27,307,468,146,447,{size:21});
 }
 if(sc.id==='quiz'){
  const qdata=[['合成蛋白质，找谁？','核糖体',1,4.0,6],['普通根细胞有叶绿体吗？','一般没有',6.1,9.1,12],['分泌蛋白先去哪加工？','内质网 → 高尔基体',12.1,15.1,18]];
  qdata.forEach(([q,answer,b,ans,end],i)=>{let row=A.show(props,'回忆题 '+(i+1),b,end);A.text(row,q,817,269,i===1?35:38,{b,anchor:'middle',bold:10});if(i===0)B.ribosome(row,828,388,2.14,b+.4);if(i===1){const root=B.set(row,'根部示意',825,413,1.3);A.p(root,'M-8 -57 L-8 29 Q-14 45 -5 72 L3 70 Q11 39 8 -57 Z M-7 -20 Q-34 1 -52 2 M7 -3 Q38 8 50 35 M-7 28 Q-34 25 -47 58 M7 31 Q26 44 35 70',{b:b+.4,w:2.0,fill:C.white});A.line(root,-73,-49,73,-49,{b:b+.6,w:1.2,stroke:C.soft});}if(i===2){B.er(row,691,391,.89,b+.4);B.golgi(row,962,391,.92,b+.6);A.arrow(row,'M794 397 L854 397',854,397,0,ans,{color:C.red,w:1.8});}
   let reveal=A.show(row,'答案',ans,end);A.text(reveal,answer,820,549,31,{b:ans,anchor:'middle',color:C.red,bold:9});A.p(reveal,'M543 531 L554 544 L578 513',{b:ans,w:3,stroke:C.green});});
  guide({look:(t)=>[815,t%6<3?278:504],surprise:t=>t%6<3});
 }
 if(sc.id==='ending'){
  A.text(labels,'不是各自干活，',76,284,70,{b:.6,step:.1,bold:11});A.text(labels,'而是分工协作。',75,382,70,{b:1.3,step:.1,bold:11});A.text(labels,'结构适应功能，细胞是一个有机整体',86,453,25,{b:2.7,color:C.soft,step:.06});
  B.cell(props,983,329,.62,1.8,{plant:true});guide({x:824,scale:1.57,wave:true,point:false,look:t=>t<6?[989,348]:[710,301]});
  A.p(props,'M640 495 Q614 438 646 413 C681 400 716 454 668 475 Q645 484 671 519',{b:3.1,dur:1.4,w:1.2,stroke:C.red});A.spark(props,694,425,4.4);gag(776,168,428,823,334,{size:23});
  A.text(labels,'示意动画 · 背景音乐版',1083,581,17,{b:5,anchor:'middle',color:C.soft,bold:3});
 }
 return stage;
}
root.CellScenes={build};
})(globalThis);
