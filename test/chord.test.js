// Extract the chord decoder from the shipped page and test it.
const fs=require('fs'),path=require('path');
const html=fs.readFileSync(path.join(__dirname,'..','public','index.html'),'utf8');
function grab(sig){
  const i=html.indexOf(sig); if(i<0) throw new Error('missing: '+sig);
  let s=html.indexOf('{',i),d=0,j=s;
  for(;j<html.length;j++){if(html[j]==='{')d++;else if(html[j]==='}'){d--;if(!d){j++;break;}}}
  return html.slice(i,j);
}
// constants straight from the page
function num(re){const m=html.match(re); if(!m) throw new Error('no '+re); return Number(m[1]);}
const SLOTS=num(/const SLOTS = (\d+)/), F_LO=num(/F_LO = (\d+)/), F_HI=num(/F_HI = (\d+)/);
const CHARS="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const NF=SLOTS*12;
const GRID=[...Array(NF)].map((_,i)=>Math.round(F_LO*Math.pow(F_HI/F_LO,i/(NF-1))));
const BANKS=[...Array(SLOTS)].map((_,s)=>({
  rows:[...Array(6)].map((_,i)=>GRID[(i*2)*SLOTS+s]),
  cols:[...Array(6)].map((_,i)=>GRID[(i*2+1)*SLOTS+s]),
}));
const CHORD_F=[];BANKS.forEach(b=>CHORD_F.push(...b.rows,...b.cols));
const CHORD_IDX=new Map(CHORD_F.map((f,i)=>[f,i]));
const CWIN=num(/const CWIN = (\d+)/);
const CHANN=new Float32Array(CWIN);
for(let i=0;i<CWIN;i++)CHANN[i]=0.5-0.5*Math.cos(2*Math.PI*i/(CWIN-1));
const SR=48000; const ac={sampleRate:SR};
eval(grab('function goertzel(buf, sampleRate, freq)'));
eval(grab('function decodeChordAt(buf)'));
eval(grab('function chordsOf(msg)'));

// sanity on the frequency plan
const uniq=[...new Set(CHORD_F)].sort((a,b)=>a-b);
let minGap=1e9;for(let i=1;i<uniq.length;i++)minGap=Math.min(minGap,uniq[i]-uniq[i-1]);
console.log(`banks: ${uniq.length}/${NF} distinct, ${F_LO}-${F_HI}Hz, min gap ${minGap}Hz = ${(minGap/(SR/CWIN)).toFixed(1)} bins`);

function synth(txt,durMs,noise){
  const n=Math.round(SR*durMs/1000),out=new Float32Array(n),ramp=Math.round(SR*0.02);
  const scale=1/Math.sqrt(Math.max(1,txt.length));
  [...txt].forEach((ch,i)=>{
    const k=CHARS.indexOf(ch); if(k<0||i>=SLOTS)return;
    const rf=BANKS[i].rows[Math.floor(k/6)],cf=BANKS[i].cols[k%6];
    for(let j=0;j<n;j++){
      let e=1;if(j<ramp)e=j/ramp;else if(j>n-ramp)e=(n-j)/ramp;
      out[j]+=e*0.32*scale*(Math.sin(2*Math.PI*rf*j/SR)+Math.sin(2*Math.PI*cf*j/SR));
    }
  });
  if(noise)for(let j=0;j<n;j++)out[j]+=noise*(Math.random()*2-1);
  return out;
}
const words=["HELLO","WORLD","SOUND","CAT","LISTE","AB","TONE","A","ZZZZZ","ABCDE","QUART","42","OK","XY9","B","MM","WORDS"];
console.log("\n=== chord decode (from public/index.html) ===");
let allok=true;
for(const nz of [0,0.02,0.05,0.10,0.20,0.35]){
  let ok=0,bad=[];
  for(const w of words){
    const sig=synth(w,420,nz);
    const mid=Math.max(0,Math.floor(sig.length/2-CWIN/2));
    const g=decodeChordAt(sig.subarray(mid,mid+CWIN));
    if(g===w)ok++;else bad.push(`${w}->${g}`);
  }
  if(ok!==words.length)allok=false;
  console.log(`noise=${String(nz).padEnd(5)} ${ok}/${words.length}${bad.length?"  "+bad.slice(0,3).join(" "):""}`);
}
console.log("\nanagrams must differ:");
for(const [a,b] of [["LISTE","SILEN"],["CAT","ACT"],["AB","BA"],["ON","NO"],["ABC","CBA"]]){
  const ga=decodeChordAt(synth(a,420,0.02).subarray(0,CWIN));
  const gb=decodeChordAt(synth(b,420,0.02).subarray(0,CWIN));
  const ok=ga===a&&gb===b&&ga!==gb;
  if(!ok)allok=false;
  console.log(`  ${a}->${ga}  ${b}->${gb}  ${ok?"OK":"FAIL"}`);
}
const sil=new Float32Array(CWIN);
const nz=new Float32Array(CWIN);for(let i=0;i<CWIN;i++)nz[i]=0.3*(Math.random()*2-1);
console.log(`\nsilence -> "${decodeChordAt(sil)}"   noise -> "${decodeChordAt(nz)}"`);
console.log("\nchunking:", JSON.stringify(chordsOf("HELLO WORLD TONESCRIPT a-b!")));
process.exit(allok?0:1);
