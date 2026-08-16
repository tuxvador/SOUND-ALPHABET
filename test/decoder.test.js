// Pull the real receiver source out of the shipped HTML and exercise it.
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');

function grab(name, sig){
  const i=html.indexOf(sig);
  if(i<0) throw new Error('missing '+name);
  // brace-match from the first { after the signature
  let s=html.indexOf('{', i), d=0, j=s;
  for(;j<html.length;j++){ if(html[j]==='{')d++; else if(html[j]==='}'){d--; if(!d){j++;break;}} }
  return html.slice(i,j);
}
const src=[
  grab('goertzel','function goertzel(buf, sampleRate, freq)'),
  grab('endSilence','function endSilence()'),
  grab('analyse','function analyse(buf, sr)'),
].join('\n');

const ROWS=[697,770,852,941,1041,1141],COLS=[1209,1336,1477,1633,1789,1945];
const CHARS="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",ALL=ROWS.concat(COLS);
const THRESH=6,FLOOR=1e-4,CONFIRM=3,WIN=1024,HOP=512,SR=48000;
const toPair=new Map(),fromPair=new Map();
CHARS.split("").forEach((ch,i)=>{const r=Math.floor(i/6),c=i%6;toPair.set(ch,[r,c]);fromPair.set(r+","+c,ch);});

let out,lastChar,runLen,emittedThis,sil,blip,toneRun,gaps,syms;
const median=a=>{const s=[...a].sort((x,y)=>x-y);return s[Math.floor(s.length/2)];};
const render=()=>{}, flash=()=>{};
function resetRx(){lastChar=null;runLen=0;emittedThis=false;sil=0;blip=0;toneRun=0;gaps=[];syms=[];}

eval(src);   // defines goertzel, endSilence, analyse against the vars above

function transmit(text,symbolMs,gapFrac,noise){
  const sym=Math.round(SR*symbolMs/1000),gap=Math.round(sym*gapFrac),chunks=[];
  for(const ch of text.toUpperCase()){
    if(!toPair.has(ch)){chunks.push(new Float32Array(sym+gap));continue;}
    const [r,c]=toPair.get(ch),rf=ROWS[r],cf=COLS[c],seg=new Float32Array(sym+gap),ramp=Math.round(SR*0.008);
    for(let i=0;i<sym;i++){let env=1;if(i<ramp)env=i/ramp;else if(i>sym-ramp)env=(sym-i)/ramp;
      seg[i]=env*0.5*(Math.sin(2*Math.PI*rf*i/SR)+Math.sin(2*Math.PI*cf*i/SR))/2;}
    chunks.push(seg);
  }
  const total=chunks.reduce((a,b)=>a+b.length,0),all=new Float32Array(total);
  let o=0;for(const c of chunks){all.set(c,o);o+=c.length;}
  if(noise) for(let i=0;i<all.length;i++) all[i]+=noise*(Math.random()*2-1);
  return all;
}
function run(text,ms,nz){
  out=""; resetRx();
  const s=transmit(text,ms,0.4,nz);
  const win=new Float32Array(WIN);
  for(let o=0;o+HOP<=s.length;o+=HOP){
    win.copyWithin(0,HOP);
    win.set(s.subarray(o,o+HOP),WIN-HOP);
    analyse(win,SR);
  }
  endSilence();
  return out.trim().replace(/\s+/g," ");
}
const cases=[
  ["HELLO WORLD",170,0],["HELLO WORLD",170,0.05],["HELLO WORLD",120,0],
  ["HELLO WORLD",250,0],["HELLO WORLD",400,0],["SOUND ALPHABET 2026",170,0],
  ["AAA BBB",170,0],["ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",170,0],
  ["HELLO WORLD",60,0],["A B C",200,0],["THE QUICK BROWN FOX 42",150,0.03],
  ["TONESCRIPT",100,0.08],["W",170,0],["OK GO",300,0.02],["SOS",80,0],
  ["MEET ME AT NOON",170,0.04],["ZZZ TOP 9",220,0.02],
];
let pass=0;
for(const [t,ms,nz] of cases){
  const got=run(t,ms,nz),want=t.toUpperCase(),ok=got===want;
  if(ok)pass++;
  console.log(`${ok?"PASS":"FAIL"}  ${String(ms).padStart(3)}ms n=${nz}  "${want}"`);
  if(!ok) console.log(`      got "${got}"`);
}
// Silence and noise must decode to nothing — a receiver that invents letters
// from room noise is worse than one that misses them.
out="";resetRx();
const quiet=new Float32Array(WIN);
for(let i=0;i<200;i++) analyse(quiet,SR);
const silenceClean = out==="";
console.log(`\nsilence -> "${out}"  ${silenceClean?"PASS":"FAIL"}`);

out="";resetRx();
for(let i=0;i<200;i++){const n=new Float32Array(WIN);for(let j=0;j<WIN;j++)n[j]=0.3*(Math.random()*2-1);analyse(n,SR);}
const noiseClean = out==="";
console.log(`white noise -> "${out}"  ${noiseClean?"PASS":"FAIL"}`);
console.log(`\n${pass}/${cases.length} end-to-end (code extracted from public/index.html)`);

// Exit non-zero on any failure so this is usable in CI.
if (pass !== cases.length || !silenceClean || !noiseClean) process.exit(1);
