/* Absolute-time animation math. No frame history or random updates. */
(function(root,factory){const m=factory();if(typeof module==='object'&&module.exports)module.exports=m;else root.M=m;})(globalThis,function(){
 const TAU=Math.PI*2;
 const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
 const p=(t,b=0,d=1)=>d<=0?+(t>=b):clamp((t-b)/d);
 const ease=x=>{x=clamp(x);return x*x*(3-2*x)};
 const mix=(a,b,q)=>a+(b-a)*q;
 const keys=(k,t)=>{if(t<=k[0][0])return k[0][1];for(let i=1;i<k.length;i++)if(t<=k[i][0])return mix(k[i-1][1],k[i][1],ease(p(t,k[i-1][0],k[i][0]-k[i-1][0])));return k[k.length-1][1]};
 const hash=n=>{let z=Math.sin(n*127.1+311.7)*43758.5453;return z-Math.floor(z)};
 const ground=(x,t)=>600+.62*Math.sin(x*.014+t*1.53)+.28*Math.sin(x*.051-t*2.2);
 const walk=(t,amount=1)=>{const ph=t*7.5;return {liftL:Math.max(0,Math.sin(ph))*12*amount,liftR:Math.max(0,-Math.sin(ph))*12*amount,xL:Math.cos(ph)*11*amount,xR:-Math.cos(ph)*11*amount,bob:Math.abs(Math.cos(ph))*2.8*amount,arm:Math.cos(ph)*18*amount};};
 const gaze=(tx,ty,x,y,r=4)=>{const dx=tx-x,dy=ty-y,d=Math.hypot(dx,dy)||1,amp=Math.min(r,d/100);return{x:dx/d*amp,y:dy/d*amp}};
 const blink=(t,seed=0)=>{const z=(t+seed*.71)%4.7;if(z<.12)return 1-z/.12;if(z<.24)return(z-.12)/.12;return 1};
 const round=x=>Math.round(x*1000)/1000;
 const breathe=(t,phase=0)=>Math.sin(t*1.9+phase);
 const window=(t,a,b,r=.25)=>ease(p(t,a,r))*(1-ease(p(t,b-r,r)));
 const quad=(a,b,c,t)=>{t=clamp(t);const u=1-t;return[u*u*a[0]+2*u*t*b[0]+t*t*c[0],u*u*a[1]+2*u*t*b[1]+t*t*c[1]]};
 const secretion=t=>{const fusion=ease(p(t,18,2));return{fusion,cargoX:mix(1035,1170,ease(p(t,20,3))),erToGolgi:quad([475,372],[578,263],[660,359],ease(p(t,7,4))),golgiToMembrane:quad([787,401],[958,470],[1035,367],ease(p(t,14,4)))}};
 return {quad,secretion,TAU,clamp,p,ease,mix,keys,hash,ground,walk,gaze,blink,round,breathe,window};
});
