/* One absolute timeline drives camera, performance, captions and audio.
 * HTML has no visible controls; click/space toggles playback, R restarts.
 */
(function(){'use strict';
 const svg=document.getElementById('stage'),story=window.CellStory;
 const A=PaperArt.create(svg,window.Glyphs);A.n('rect',{width:1280,height:720,fill:A.C.paper},svg);
 const stages=A.group(svg,'动画舞台');const sceneNodes=[];
 for(const s of story.scenes){A.setScene(s.id);sceneNodes.push(CellScenes.build(A,s,stages,story));}
 A.setScene('global');
 const ground=A.p(svg,'M0 600 L1280 600',{static:true,w:1.9,wiggle:false});ground.setAttribute('data-role','ground');
 const subtitleLayer=A.group(svg,'学习字幕',{'data-layer':'captions'});
 const subtitles=[];
 function wrap(str){if(str.length<=39)return[str];let mid=str.length/2,possible=[];for(let i=13;i<str.length-10;i++)if('，；：。'.includes(str[i]))possible.push(i+1);let cut=possible.length?possible.sort((a,b)=>Math.abs(a-mid)-Math.abs(b-mid))[0]:Math.floor(mid);return[str.slice(0,cut),str.slice(cut)];}
 for(const sc of story.scenes)for(const line of sc.lines){let g=A.group(subtitleLayer,line.text);let w=line.rows??wrap(line.text);w.forEach((s,i)=>A.text(g,s,640,w.length===1?661:646+i*34,25.5,{static:true,anchor:'middle',bold:13,color:A.C.ink}));subtitles.push({g,start:sc.start+line.start,end:sc.start+line.end});}
 let time=0,playing=false,last=0,frameId=0,hiddenCaption=false;
 const audio=document.getElementById('soundtrack');
 let poster=!!audio;
 function render(t){time=M.clamp(Number(t)||0,0,story.duration-1e-5);let idx=0;while(idx+1<story.scenes.length&&story.scenes[idx+1].start<=time)idx++;const sc=story.scenes[idx],u=time-sc.start;
  sceneNodes.forEach((g,i)=>g.setAttribute('display',i===idx||(idx>0&&u<.75&&i===idx-1)?'inline':'none'));
  let q=idx>0?M.ease(M.p(u,0,.75)):1;
  sceneNodes[idx].setAttribute('transform',`translate(${M.round(1280*(1-q))} 0)`);A.render(sc.id,u,time);
  if(idx>0&&u<.75){const prev=story.scenes[idx-1];A.render(prev.id,prev.duration-.2+u,time);sceneNodes[idx-1].setAttribute('transform',`translate(${M.round(-1280*q)} 0)`)}
  let d='M0 '+M.round(M.ground(0,time));for(let x=32;x<=1280;x+=32)d+=' L'+x+' '+M.round(M.ground(x,time));ground.setAttribute('d',d);
  for(const s of subtitles)s.g.setAttribute('display',!hiddenCaption&&time>=s.start&&time<s.end?'inline':'none');
  svg.setAttribute('data-time',time.toFixed(4));svg.setAttribute('data-scene',sc.id);return{time,scene:sc.id,index:idx,local:u};
 }
 function tick(now){if(!playing)return;let dt=Math.min(.1,(now-last)/1000);last=now;let t=audio&&audio.readyState>=2&&!audio.paused?audio.currentTime:time+dt;render(t);if(t>=story.duration-.02){pause();render(story.duration-.001);return}frameId=requestAnimationFrame(tick);}
 async function play(){if(poster){poster=false;render(0)}if(time>=story.duration-.1)render(0);if(playing)return;playing=true;last=performance.now();if(audio){audio.currentTime=time;try{await audio.play()}catch{}}frameId=requestAnimationFrame(tick)}
 function pause(){playing=false;cancelAnimationFrame(frameId);if(audio)audio.pause()}
 function seek(t){poster=false;pause();render(t);if(audio&&audio.readyState>=1)audio.currentTime=time;return time;}
 window.film={render,seek,play,pause,get duration(){return story.duration},get time(){return time},get playing(){return playing},story,svg,A,
  captions(v){hiddenCaption=!v;render(time)},serialize(){return new XMLSerializer().serializeToString(svg)},
  audit(){return{paths:svg.querySelectorAll('path').length,groups:svg.querySelectorAll('g').length,raster:svg.querySelectorAll('image,video,canvas,foreignObject').length,actors:svg.querySelectorAll('[data-component="lens-guide"]').length,scenes:sceneNodes.length,tracks:A.stats().tracks}}};
 document.addEventListener('keydown',e=>{if(e.code==='Space'){e.preventDefault();playing?pause():play()}else if(e.key.toLowerCase()==='r'){seek(0);play()}else if(e.code==='ArrowRight'){e.preventDefault();seek(time+5)}else if(e.code==='ArrowLeft'){e.preventDefault();seek(time-5)}});
 svg.addEventListener('click',()=>playing?pause():play());
 render(poster?5.2:0);
})();
