const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
function grab(sig){
  const i=html.indexOf(sig); if(i<0) throw new Error('missing: '+sig);
  let s=html.indexOf('{',i),d=0,j=s;
  for(;j<html.length;j++){if(html[j]==='{')d++;else if(html[j]==='}'){d--;if(!d){j++;break;}}}
  return html.slice(i,j);
}
const num=re=>{const m=html.match(re);if(!m)throw new Error('no '+re);return Number(m[1]);};
const SLOTS=num(/const SLOTS = (\d+)/),PER=num(/const PER = (\d+)/),CWIN=num(/const CWIN = (\d+)/);
const ACC_LEVEL=Number(html.match(/const ACC_LEVEL = ([\d.]+)/)[1]);
const ACC_MIN=ACC_LEVEL*ACC_LEVEL/4;
const ACC_SEP=Number(html.match(/const ACC_SEP = (\d+)/)[1]);
const CONTRAST_MIN=Number(html.match(/const CONTRAST_MIN = (\d+)/)[1]);
const CHARS="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const midiHz=m=>440*Math.pow(2,(m-69)/12);
const SCALE_DEG=JSON.parse(html.match(/const SCALE_DEG = (\[[^\]]+\])/)[1]);
const SCALE_ROOT=num(/const SCALE_ROOT = (\d+)/);
const SCALE_NOTES=[];
for(let m=48;m<=105&&SCALE_NOTES.length<SLOTS*PER;m++){
  if(!SCALE_DEG.includes((((m-SCALE_ROOT)%12)+12)%12))continue;
  const f=midiHz(m);if(f>=260&&f<=3600)SCALE_NOTES.push(m);}
const BANKS=[...Array(SLOTS)].map((_,s)=>SCALE_NOTES.slice(s*PER,(s+1)*PER).map(midiHz));
const PAIRS=[];for(let i=0;i<PER;i++)for(let j=i+1;j<PER;j++)PAIRS.push([i,j]);
const CHORD_F=[];BANKS.forEach(b=>CHORD_F.push(...b));
// MARKS array from the page
const MARKS=eval(html.match(/const MARKS = (\[[\s\S]*?\]);/)[1].replace(/\/\/[^\n]*/g,''));
const EXPAND=eval('('+html.match(/const EXPAND = (\{[^}]*\});/)[1]+')');
const SR=48000,ac={sampleRate:SR};
const CHANN=new Float32Array(CWIN);
for(let i=0;i<CWIN;i++)CHANN[i]=0.5-0.5*Math.cos(2*Math.PI*i/(CWIN-1));
eval(grab('function goertzel(buf, sampleRate, freq)'));
eval(grab('function decompose(ch)'));
// pull the three accent helpers, rewriting `const` to global assignment so
// they survive eval's scope
{
  const lines=html.split('\n');
  const a=lines.findIndex(l=>l.includes('const freeNotes ='));
  const b=lines.findIndex((l,i)=>i>a&&l.includes('const accentIndex ='));
  const src=lines.slice(a,b+1).join('\n').replace(/\bconst /g,'globalThis.');
  eval(src);
}
eval(grab('function decodeChordAt(buf, sr)'));
eval(grab('function chordsOf(msg)'));
console.log(`marks: ${MARKS.length} states, ACC_LEVEL=${ACC_LEVEL}`);

function synth(txt,durMs,noise){
  const n=Math.round(SR*durMs/1000),out=new Float32Array(n),ramp=Math.round(SR*0.025);
  const chars=[...txt];
  const sc=1/Math.sqrt(Math.max(1,chars.length));
  chars.forEach((ch,i)=>{
    if(i>=SLOTS)return;
    const dec=decompose(ch);if(!dec)return;
    const [base,mi]=dec,k=CHARS.indexOf(base);if(k<0)return;
    const [lo,hi]=PAIRS[k];
    const voices=[[BANKS[i][lo],1],[BANKS[i][hi],1]];
    if(mi>0)voices.push([BANKS[i][accentNote(lo,hi,mi)],ACC_LEVEL]);
    for(const [f,amp] of voices){
      for(let j=0;j<n;j++){
        let e=1;if(j<ramp)e=j/ramp;else if(j>n-ramp)e=(n-j)/ramp;
        let v=0;for(let h=1;h<=9;h+=2)v+=(h%4===1?1:-1)*Math.sin(2*Math.PI*h*f*j/SR)/(h*h);
        out[j]+=e*0.30*sc*amp*v*(8/(Math.PI*Math.PI));
      }
    }
  });
  if(noise)for(let j=0;j<n;j++)out[j]+=noise*(Math.random()*2-1);
  return out;
}
const dec1=s=>{const g=synth(s,450,0);const m=Math.floor(g.length/2-CWIN/2);return decodeChordAt(g.subarray(m,m+CWIN));};
const decN=(s,nz)=>{const g=synth(s,450,nz);const m=Math.floor(g.length/2-CWIN/2);return decodeChordAt(g.subarray(m,m+CWIN));};

// every accented char of the target languages, in groups of 3
const FR="ÀÂÇÉÈÊËÎÏÔÙÛÜŸ", ES="ÁÉÍÑÓÚÜ", PT="ÃÕÂÊÔ", DE="ÄÖÜ", SV="ÅÄÖ", IT="ÀÈÉÌÒÙ";
const pool=[...new Set([...FR+ES+PT+DE+SV+IT])];
console.log(`\ntesting ${pool.length} distinct accented letters`);
let ok=0,bad=[];
for(let i=0;i<pool.length;i+=3){
  const w=pool.slice(i,i+3).join("");
  const g=dec1(w);
  if(g===w)ok++;else bad.push(`${w}->${g}`);
}
const groups=Math.ceil(pool.length/3);
console.log(`clean: ${ok}/${groups} ${bad.length?bad.join(" "):""}`);

const words=["CAF","ÉTÉ","AÑO","ÇAV","NIÑ","OUÙ","ABC","ÀÉÎ","SÃO","MÜN","ÅNG","ÜBE"];
console.log("\n=== accented words ===");
let allok=(ok===groups);
for(const nz of [0,0.02,0.05,0.10,0.20]){
  let o=0,b=[];
  for(const t of words){const g=decN(t,nz);if(g===t)o++;else b.push(`${t}->${g}`);}
  if(o!==words.length)allok=false;
  console.log(`noise=${String(nz).padEnd(5)} ${o}/${words.length}${b.length?"  "+b.slice(0,3).join(" "):""}`);
}
// unaccented must still work exactly as before
console.log("\n=== plain ASCII unchanged ===");
const plain=["CAT","ACT","THE","ABC","CBA","42","OK","XY9","SUN","DOG"];
for(const nz of [0,0.05,0.20]){
  let o=0,b=[];
  for(const t of plain){const g=decN(t,nz);if(g===t)o++;else b.push(`${t}->${g}`);}
  if(o!==plain.length)allok=false;
  console.log(`noise=${String(nz).padEnd(5)} ${o}/${plain.length}${b.length?"  "+b.join(" "):""}`);
}
console.log("\nchunking:");
for(const s of ["CAFÉ NOËL","EL NIÑO AÑO","ŒUVRE Æ ß","Straße"]) console.log(`  ${s.padEnd(12)} -> ${JSON.stringify(chordsOf(s))}`);
// Regression: pure noise must never decode as text. A contrast gate that is
// too low lets random noise clear it a few percent of the time, which showed
// up as phantom accented characters (1 in 8 runs before CONTRAST_MIN rose).
{
  let fp=0;
  for(let t=0;t<600;t++){
    const b=new Float32Array(CWIN);
    for(let i=0;i<CWIN;i++) b[i]=0.3*(Math.random()*2-1);
    if(decodeChordAt(b)!=="") fp++;
  }
  console.log(`\nwhite noise false positives: ${fp}/600 ${fp===0?"PASS":"FAIL"}`);
  if(fp>0) allok=false;
}
const sil=new Float32Array(CWIN);
console.log(`\nsilence -> "${decodeChordAt(sil)}"`);
process.exit(allok?0:1);
