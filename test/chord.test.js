// Extract the melodic chord codec from the shipped page and test it.
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
function grab(sig){
  const i=html.indexOf(sig); if(i<0) throw new Error('missing: '+sig);
  let s=html.indexOf('{',i),d=0,j=s;
  for(;j<html.length;j++){if(html[j]==='{')d++;else if(html[j]==='}'){d--;if(!d){j++;break;}}}
  return html.slice(i,j);
}
const num=re=>{const m=html.match(re);if(!m)throw new Error('no '+re);return Number(m[1]);};
const SLOTS=num(/const SLOTS = (\d+)/), PER=num(/const PER = (\d+)/), CWIN=num(/const CWIN = (\d+)/);
const SYMBOLS=html.match(/const SYMBOLS = "([^"]*)"/)[1];
const CHARS="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"+SYMBOLS;
const midiHz=m=>440*Math.pow(2,(m-69)/12);
const SCALE_DEG=JSON.parse(html.match(/const SCALE_DEG = (\[[^\]]+\])/)[1]);
const SCALE_ROOT=num(/const SCALE_ROOT = (\d+)/);
const SCALE_NOTES=[];
for(let m=48;m<=110&&SCALE_NOTES.length<SLOTS*PER;m++){
  if(!SCALE_DEG.includes((((m-SCALE_ROOT)%12)+12)%12))continue;
  const f=midiHz(m); if(f>=240&&f<=4200) SCALE_NOTES.push(m);
}
const BANKS=[...Array(SLOTS)].map((_,s)=>SCALE_NOTES.slice(s*PER,(s+1)*PER).map(midiHz));
const PAIRS=[];for(let i=0;i<PER;i++)for(let j=i+1;j<PER;j++)PAIRS.push([i,j]);
const CHORD_F=[];BANKS.forEach(b=>CHORD_F.push(...b));
const EXPAND=eval('('+html.match(/const EXPAND = (\{[^}]*\});/)[1]+')');
const ACC_LEVEL=Number(html.match(/const ACC_LEVEL = ([\d.]+)/)[1]);
const ACC_MIN=ACC_LEVEL*ACC_LEVEL/4;
const ACC_SEP=Number(html.match(/const ACC_SEP = (\d+)/)[1]);
const CONTRAST_MIN=Number(html.match(/const CONTRAST_MIN = (\d+)/)[1]);
const MARKS=eval(html.match(/const MARKS = (\[[\s\S]*?\]);/)[1].replace(/\/\/[^\n]*/g,''));
{ // accent helpers, rewritten so eval's consts survive
  const lines=html.split('\n');
  const a=lines.findIndex(l=>l.includes('const freeNotes ='));
  const b=lines.findIndex((l,i)=>i>a&&l.includes('const accentIndex ='));
  eval(lines.slice(a,b+1).join('\n').replace(/\bconst /g,'globalThis.'));
}
const SR=48000, ac={sampleRate:SR};
const CHANN=new Float32Array(CWIN);
for(let i=0;i<CWIN;i++)CHANN[i]=0.5-0.5*Math.cos(2*Math.PI*i/(CWIN-1));
eval(grab('function goertzel(buf, sampleRate, freq)'));
eval(grab('function decodeChordAt(buf, sr)'));
eval(grab('function decompose(ch)'));
eval(grab('function chordsOf(msg)'));

const NAME=["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
const nm=f=>{const m=Math.round(69+12*Math.log2(f/440));return NAME[((m%12)+12)%12]+(Math.floor(m/12)-1);};
console.log(`scale: ${SCALE_NOTES.length} notes, ${CHORD_F[0].toFixed(0)}-${CHORD_F[CHORD_F.length-1].toFixed(0)}Hz`);
BANKS.forEach((b,s)=>console.log(`  slot${s}: ${b.map(nm).join(" ")}`));
let mg=1e9;const S=[...CHORD_F].sort((a,b)=>a-b);
for(let i=1;i<S.length;i++)mg=Math.min(mg,S[i]-S[i-1]);
console.log(`min gap ${mg.toFixed(1)}Hz = ${(mg/(SR/CWIN)).toFixed(1)} bins`);
// every tone must be a real scale note
const offs=new Set(CHORD_F.map(f=>{const m=Math.round(69+12*Math.log2(f/440));return (((m-SCALE_ROOT)%12)+12)%12;}));
console.log(`scale degrees used: [${[...offs].sort((a,b)=>a-b)}] all in [${SCALE_DEG}] -> ${[...offs].every(o=>SCALE_DEG.includes(o))?"ALL MUSICAL":"OFF-SCALE"}`);

// triangle wave, matching the page
function synth(txt,durMs,noise){
  const n=Math.round(SR*durMs/1000),out=new Float32Array(n),ramp=Math.round(SR*0.025);
  const sc=1/Math.sqrt(Math.max(1,txt.length));
  [...txt].forEach((ch,i)=>{
    const k=CHARS.indexOf(ch); if(k<0||i>=SLOTS)return;
    const [lo,hi]=PAIRS[k];
    for(const f of [BANKS[i][lo],BANKS[i][hi]]){
      for(let j=0;j<n;j++){
        let e=1;if(j<ramp)e=j/ramp;else if(j>n-ramp)e=(n-j)/ramp;
        // triangle via odd harmonics 1/n^2
        let v=0;for(let h=1;h<=9;h+=2) v+=(h%4===1?1:-1)*Math.sin(2*Math.PI*h*f*j/SR)/(h*h);
        out[j]+=e*0.30*sc*v*(8/(Math.PI*Math.PI));
      }
    }
  });
  if(noise)for(let j=0;j<n;j++)out[j]+=noise*(Math.random()*2-1);
  return out;
}
const words=["CAT","ACT","THE","AB","A","ZZZ","ABC","CBA","42","OK","B","MM","XY9","QRS","DOG","SUN"];
console.log("\n=== melodic decode (from public/index.html) ===");
let allok=true;
for(const nz of [0,0.02,0.05,0.10,0.20,0.30]){
  let ok=0,bad=[];
  for(const w of words){
    const sig=synth(w,450,nz);
    const mid=Math.max(0,Math.floor(sig.length/2-CWIN/2));
    const g=decodeChordAt(sig.subarray(mid,mid+CWIN));
    if(g===w)ok++;else bad.push(`${w}->${g}`);
  }
  if(ok!==words.length)allok=false;
  console.log(`noise=${String(nz).padEnd(5)} ${ok}/${words.length}${bad.length?"  "+bad.slice(0,3).join(" "):""}`);
}
console.log("\nanagrams:");
for(const [a,b] of [["CAT","ACT"],["ABC","CBA"],["AB","BA"]]){
  const f=w=>{const s=synth(w,450,0.02);return decodeChordAt(s.subarray(Math.floor(s.length/2-CWIN/2),Math.floor(s.length/2-CWIN/2)+CWIN));};
  const ga=f(a),gb=f(b),ok=ga===a&&gb===b&&ga!==gb;
  if(!ok)allok=false;
  console.log(`  ${a}->${ga}  ${b}->${gb}  ${ok?"OK":"FAIL"}`);
}
const sil=new Float32Array(CWIN);
const nzb=new Float32Array(CWIN);for(let i=0;i<CWIN;i++)nzb[i]=0.3*(Math.random()*2-1);
console.log(`\nsilence -> "${decodeChordAt(sil)}"   noise -> "${decodeChordAt(nzb)}"`);
console.log("chunking:", JSON.stringify(chordsOf("HELLO WORLD ab")));
process.exit(allok?0:1);
