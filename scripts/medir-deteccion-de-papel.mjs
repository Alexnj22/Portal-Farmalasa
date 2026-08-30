/**
 * Cuánto le erra el detector de papel, contra fotos cuya verdad se conoce.
 *
 *     npm run medir:papel
 *
 * ── Por qué existe como script y no como prueba de unidad ──────────────────
 *
 * Porque `detectarPapel` trabaja sobre píxeles y necesita un canvas de verdad:
 * en jsdom no hay `getImageData`, así que una prueba de unidad no puede correrlo
 * — mediría el mock y daría verde sobre nada. Es exactamente el error que costó
 * la matriz afín invertida de `perspectiva.js`, cuyo encabezado decía «el dibujo
 * por malla se mide aparte, en el navegador» y esa medición nunca se hizo.
 *
 * ── Por qué las fotos son sintéticas ───────────────────────────────────────
 *
 * Porque así se conoce la RESPUESTA. Las cuatro esquinas del papel no se estiman
 * mirando la imagen: son los números con los que se dibujó, y el error se mide
 * en vez de opinarse. Con una foto real sólo se podría decir «se ve bien».
 *
 * Cada caso declara su tope de desvío, en % de la diagonal de la foto. Los que
 * esperan `null` son igual de importantes: un detector que nunca dice «no sé»
 * recorta fotos donde no hay ningún documento.
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
const codigo = fs.readFileSync('src/utils/detectarPapel.js','utf8').replace(/^export /gm,'');
const CASOS = [
  { n:'papel claro sobre mesa oscura',  q:[[.155,.130],[.865,.235],[.800,.880],[.115,.735]], mesa:'#6b4a2f', papel:'#fdfdfa', espera:'papel', tope:3 },
  { n:'blanco sobre escritorio claro',  q:[[.180,.140],[.840,.190],[.820,.860],[.160,.800]], mesa:'#c9c6bf', papel:'#ffffff', espera:'papel', tope:5 },
  { n:'blanco sobre gris medio',        q:[[.180,.140],[.840,.190],[.820,.860],[.160,.800]], mesa:'#9a9a98', papel:'#fdfdfa', espera:'papel', tope:3 },
  { n:'de costado, trapecio fuerte',    q:[[.300,.120],[.760,.240],[.900,.860],[.130,.700]], mesa:'#3a3a3a', papel:'#ffffff', espera:'papel', tope:3 },
  { n:'cortado por el borde',           q:[[-.05,.100],[.900,.180],[.860,.900],[-.02,.800]], mesa:'#5a4030', papel:'#fbfbf7', espera:'papel', tope:3 },
  { n:'girado 90°, alto y angosto',     q:[[.330,.060],[.700,.100],[.660,.940],[.290,.900]], mesa:'#704a28', papel:'#fefef9', espera:'papel', tope:3 },
  { n:'brillo de la mesa compitiendo',  q:[[.200,.150],[.780,.200],[.760,.820],[.180,.770]], mesa:'#4a3020', papel:'#fdfdfa', espera:'papel', tope:3, brillo:true },
  { n:'casi toda la foto',              q:[[.010,.010],[.990,.015],[.985,.990],[.015,.985]], mesa:'#222222', papel:'#ffffff', espera:'null' },
  { n:'poco contraste (gris/gris)',     q:[[.180,.140],[.840,.190],[.820,.860],[.160,.800]], mesa:'#d8d8d6', papel:'#f2f2f0', espera:'null' },
  { n:'SIN papel (mesa oscura)',        q:null, mesa:'#6b4a2f', papel:null, espera:'null' },
  { n:'SIN papel (mesa clara)',         q:null, mesa:'#d8d8d6', papel:null, espera:'null' },
];
const b=await chromium.launch(); const pg=await b.newPage({viewport:{width:1200,height:900}});
let malos=0;
for (const c of CASOS) {
  const r = await pg.evaluate(async ({c,codigo})=>{
    eval(codigo);
    const W=1200,H=900,cv=document.createElement('canvas');cv.width=W;cv.height=H;
    const g=cv.getContext('2d');g.fillStyle=c.mesa;g.fillRect(0,0,W,H);
    for(let i=0;i<140;i++){g.strokeStyle=`rgba(0,0,0,${0.03+Math.random()*0.05})`;g.lineWidth=1+Math.random()*3;
      g.beginPath();g.moveTo(0,Math.random()*H);g.bezierCurveTo(W/3,Math.random()*H,2*W/3,Math.random()*H,W,Math.random()*H);g.stroke();}
    if(c.brillo){const gr=g.createRadialGradient(1080,140,10,1080,140,190);
      gr.addColorStop(0,'rgba(255,255,255,.85)');gr.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle=gr;g.beginPath();g.arc(1080,140,190,0,7);g.fill();}
    if(c.q){const pw=850,ph=1100,p=document.createElement('canvas');p.width=pw;p.height=ph;
      const q2=p.getContext('2d');q2.fillStyle=c.papel;q2.fillRect(0,0,pw,ph);
      q2.fillStyle='#111';q2.font='bold 54px sans-serif';q2.fillText('FACTURA',60,110);
      q2.font='27px sans-serif';for(let i=0;i<20;i++)q2.fillText('Producto de ejemplo '+(i+1),60,200+i*45);
      q2.strokeStyle='#444';q2.lineWidth=2;q2.strokeRect(40,40,pw-80,ph-80);
      const px=c.q.map(v=>({x:v[0]*W,y:v[1]*H})),N=40;
      const en=(u,v)=>{const t=(a,b_)=>({x:a.x+(b_.x-a.x)*v,y:a.y+(b_.y-a.y)*v});
        const A=t(px[0],px[3]),B=t(px[1],px[2]);return{x:A.x+(B.x-A.x)*u,y:A.y+(B.y-A.y)*u};};
      for(let i=0;i<N;i++)for(let j=0;j<N;j++){const u0=i/N,u1=(i+1)/N,v0=j/N,v1=(j+1)/N;
        const tri=(o,d)=>{const[o0,o1,o2]=o,[d0,d1,d2]=d;
          const den=(o1.x-o0.x)*(o2.y-o0.y)-(o2.x-o0.x)*(o1.y-o0.y);if(!den)return;
          const a=((d1.x-d0.x)*(o2.y-o0.y)-(d2.x-d0.x)*(o1.y-o0.y))/den;
          const bb=((d2.x-d0.x)*(o1.x-o0.x)-(d1.x-d0.x)*(o2.x-o0.x))/den;
          const cc=((d1.y-d0.y)*(o2.y-o0.y)-(d2.y-d0.y)*(o1.y-o0.y))/den;
          const e=((d2.y-d0.y)*(o1.x-o0.x)-(d1.y-d0.y)*(o2.x-o0.x))/den;
          g.save();g.beginPath();g.moveTo(d0.x,d0.y);g.lineTo(d1.x,d1.y);g.lineTo(d2.x,d2.y);
          g.closePath();g.clip();g.transform(a,cc,bb,e,d0.x-(a*o0.x+bb*o0.y),d0.y-(cc*o0.x+e*o0.y));
          g.drawImage(p,0,0);g.restore();};
        const O=[{x:u0*pw,y:v0*ph},{x:u1*pw,y:v0*ph},{x:u1*pw,y:v1*ph},{x:u0*pw,y:v1*ph}];
        const D=[en(u0,v0),en(u1,v0),en(u1,v1),en(u0,v1)];
        tri([O[0],O[1],O[2]],[D[0],D[1],D[2]]);tri([O[0],O[2],O[3]],[D[0],D[2],D[3]]);} }
    const im=new Image();await new Promise(r2=>{im.onload=r2;im.src=cv.toDataURL('image/jpeg',.85);});
    const t0=performance.now();const q=detectarPapel(im);return{q,ms:Math.round(performance.now()-t0)};
  },{c,codigo});
  if(c.espera==='null'){const ok=!r.q;if(!ok)malos++;
    console.log(`${ok?'✓':'✗'}  ${c.n.padEnd(32)} → ${r.q?'DEVOLVIÓ ALGO (mal)':'null · pasa al modelo'}`);continue;}
  if(!r.q){malos++;console.log(`✗  ${c.n.padEnd(32)} → null (no lo encontró)`);continue;}
  const orden=pts=>{const cy=pts.reduce((s,p)=>s+p.y,0)/4;
    const ar=pts.filter(p=>p.y<cy).sort((a,b)=>a.x-b.x),ab=pts.filter(p=>p.y>=cy).sort((a,b)=>a.x-b.x);
    return (ar.length===2&&ab.length===2)?[ar[0],ar[1],ab[1],ab[0]]:null;};
  const o=orden(r.q);if(!o){malos++;console.log(`✗  ${c.n.padEnd(32)} → no se pudieron ordenar`);continue;}
  const V=c.q.map(v=>({x:Math.min(1,Math.max(0,v[0])),y:Math.min(1,Math.max(0,v[1]))}));
  const peor=Math.max(...o.map((p,i)=>Math.hypot(p.x-V[i].x,p.y-V[i].y)*100));
  const ok=peor<=c.tope;if(!ok)malos++;
  console.log(`${ok?'✓':'✗'}  ${c.n.padEnd(32)} → peor desvío ${peor.toFixed(1)}%  (tope ${c.tope}%, ${r.ms} ms)`);
}
await b.close();
console.log(malos?`\n${malos} de ${CASOS.length} mal.`:`\nlos ${CASOS.length} bien.`);
process.exit(malos?1:0);
