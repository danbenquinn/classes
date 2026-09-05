/* lab-suite analyzer — SHARED ENGINE (workshop-agnostic).
   Expects globals from the workshop's config script (loaded first): NARR, CONFIG {title}, INSTRUCTOR, DEMO_CSV.
   Injects the instrument+deck DOM, then runs. Edit behavior here once; every workshop picks it up. */
"use strict";
const $ = id => document.getElementById(id);
// cheap non-crypto hash (cyrb53) — passcodes are stored hashed so view-source shows only a number, not the code.
// A deterrent, NOT real security (a short code is still brute-forceable; real gating would validate server-side).
function cyrb53(str,seed=0){ let h1=0xdeadbeef^seed,h2=0x41c6ce57^seed;
  for(let i=0,ch;i<str.length;i++){ ch=str.charCodeAt(i); h1=Math.imul(h1^ch,2654435761); h2=Math.imul(h2^ch,1597334677); }
  h1=Math.imul(h1^(h1>>>16),2246822507); h1^=Math.imul(h2^(h2>>>13),3266489909);
  h2=Math.imul(h2^(h2>>>16),2246822507); h2^=Math.imul(h1^(h1>>>13),3266489909);
  return 4294967296*(2097151&h2)+(h1>>>0); }
const codeHash = s => cyrb53(String(s||"").trim().toLowerCase());   // normalize before hashing/comparing
// House style: a workshop shows ONLY the tools it declares in CONFIG.tools (in order; first is active).
// tool KEYS → button labels. "dblint" double-integrates a→v→x (position, in meters). "integrate" is the
// SINGLE integral a→v (velocity, m/s): green area under a(t) + one solid green integral curve, no amber
// intermediate. The two share doIntegrate() (it computes both v and x) but render differently and never collide.
// "crop" is a VIEW tool, not a measurement: it dims the data outside two draggable amber bounds and
// rescales the vertical axis to what is left. It changes nothing the other tools compute — a selection
// still reads the real samples — because the first thing it was needed for (Get Air's elevator) is a
// signal 25x smaller than the noise of setting the phone down, and the pedagogy is that the noise is
// STILL THERE, grayed, a screen away from the thing you came to measure.
// CHOICE LABELS ARE ROMAN NUMERALS (2026-09-03). They were `a) b) c)` until Workshop 1's
// jump-sections figure put five labeled stretches **A-E** on screen beside five lettered choices —
// "Section A — what's happening?" sitting an inch above a list that starts "a)", two alphabets doing
// different jobs in the same glance. Relabelling the answers was the cheap half of that fix (the other
// half would have been redrawing the figure). Numerals cost nothing anywhere else and can never collide
// with a letter someone puts on a graphic, so this is house-wide rather than a Workshop 1 switch.
const ROMAN=["i","ii","iii","iv","v","vi","vii","viii","ix","x","xi","xii"];
const choiceLabel = i => ROMAN[i] || String(i+1);
const TOOLDEF={point:"Select Point", avg:"Average Value", integrate:"Integrate", dblint:"Double Integrate", fitsine:"Fit Sine", crop:"Crop"};
const TOOLS=(typeof CONFIG!=='undefined'&&CONFIG&&Array.isArray(CONFIG.tools)&&CONFIG.tools.length)
  ? CONFIG.tools.filter(t=>TOOLDEF[t]) : ["point","avg","dblint","fitsine"];
const _toolsHTML=TOOLS.map((t,i)=>'<button data-tool="'+t+'"'+(i===0?' class="on"':'')+'>'+TOOLDEF[t]+'</button>').join("");
// PANELS (added with Workshop 1's elevator section). A workshop declares named data SLOTS; each is an
// independent plot with its own file, signal column, selection, and crop. `CONFIG.panels` defaults to a
// single unnamed slot, which is exactly the behavior every workshop had before this existed — one plot,
// its controls in the toolbar, no strip. A step then names which slots it wants stacked
// (`slots:["up","down"]`); omit it and the step shows the FIRST slot, as always.
//
// Why named slots rather than "load a second file into the same plot": Get Air's elevator section needs
// the jump data still loaded when a student clicks Back, needs the up and down rides visible at once
// (two of the four answers repeat, and that is the whole lesson), and needs each file addressable by name
// afterwards — from the copy-out summary (`{file_up}`) and from the instructor build's preload.
const PANELDEF=(typeof CONFIG!=='undefined'&&CONFIG&&Array.isArray(CONFIG.panels)&&CONFIG.panels.length)
  ? CONFIG.panels : [{key:"main"}];
document.body.innerHTML = `<div id="topzone">
<div id="analyzer">
  <div id="bar">
    <span class="brand">Data Analyzer</span>
    <div id="barslot"></div>
    <div class="tools" id="tools">${_toolsHTML}</div>
    <div id="ctx"></div>
  </div>
  <div id="panels"></div>
</div>
<div id="topmedia"></div>
</div>

<div id="deck">
  <div id="deckhead"><span class="tag"></span>
    <span class="prog" id="prog"></span></div>
  <div id="stepbody"></div>
  <div id="decknav">
    <button id="prev">‹ Back</button>
    <div class="spacer"></div>
    <button id="next">Next ›</button>
  </div>
</div>`;
{ const _t=document.querySelector('#deckhead .tag'); if(_t) _t.textContent=(typeof CONFIG!=='undefined'&&CONFIG&&CONFIG.title)?CONFIG.title:''; }

/* ---------------------------- math ----------------------------
   Workshop decks render LaTeX the same way lecture decks do: `$…$` in the manifest, MathJax 3 with
   SVG output, the SAME vendored library and the SAME config file (../../slide-suite/). One notation
   standard (slide-suite/style/notation.md) deserves one renderer — a workshop's `\ddot x` has to come
   out identical to the one on the slide that taught it, and two renderers is two ways to be different.

   Why this function exists rather than a single typeset at load: the deck is built step by step at
   RUNTIME (renderStep replaces #stepbody's innerHTML on every Next), so there is no one moment when
   all the math is in the document. Every place that writes markup a manifest supplied — the step body,
   the top region, the feedback box — types it set here.

   `typesetClear` first because the previous step's nodes are already gone from the DOM but not from
   MathJax's internal list; without it that list grows for the whole session and re-typesetting a
   replaced feedback box can find stale entries. MathJax absent (or mid-startup) is a no-op, never a
   crash: a deck opened without the library still reads, it just shows the raw `$…$`. */
function typesetMath(el){
  const MJ = window.MathJax;
  if(!el || !MJ) return;
  const run = () => { try{
      if(MJ.typesetClear) MJ.typesetClear([el]);
      if(MJ.typesetPromise) MJ.typesetPromise([el]).catch(()=>{});
    }catch(e){} };
  if(MJ.startup && MJ.startup.promise) MJ.startup.promise.then(run).catch(()=>{});
  else run();
}


/* ============================ state ============================ */
const S = {
  panels:[],               // the data slots (see PANELDEF) — each one a whole instrument's worth of state
  activeIdx:0,             // which slot the student last touched; the toolbar acts on THIS one
  visible:[],              // indices of the slots the current step shows, top to bottom
  tool:TOOLS[0]||"point",
  fitCtl:{ampFit:true, freqFit:true, ampVal:null, freqVal:null},  // Fit Sine controls: which params are free + their values
  /* ---- zero-offset removal (PROVISIONAL, default OFF — Daniel is evaluating it, 2026-08-21) ----
     phyphox's linear-acceleration stream should read 0 when the phone is still and doesn't: Get Air's demo
     file sits at -0.030 m/s² through the quiet stretch, ~0.3% of g. Integrating twice turns that constant
     into ½·a·τ², so the error grows with the SQUARE of the selection: 1 s of dead air costs 0.7 cm, 3 s
     costs 10 cm, and a 32 cm jump can report 5 cm. When on, doIntegrate() estimates the offset from the
     stillness at the START of the selection and subtracts it from every sample.
     OFF by default on purpose. The next step in Get Air asks students what causes drift, and one of its
     correct answers is that small acceleration errors pile up when you integrate twice — this is that,
     and silently correcting it would answer the question before it is asked. Note it removes the CONSTANT
     term only: not returning to where you started, non-constant bias and noise all survive. */
  debias:false, debiasEst:null,
  fitLock:null,            // {amp, freq} when a step pins the fit (the challenge)
  hs:{best:null},          // R² high score (challenge)
  challenge:false,
  reqAxis:null,            // when set (e.g. "x"), a step requires that signal axis (default-select it; gate scoring on it)
  step:0, answers:{}, lockTimer:null,
  // What the student TYPED, per key, beside the parsed numbers. `0.30` and `0.3` are the same
  // Number, and trailing zeros are precisely what the `dp:` check is about — see decimalsOf().
  raw:{}
};
/* Per-slot fields, PROXIED onto S so that every call site written before slots existed still reads.
   `S.ds`, `S.sel`, `S.integ` … now mean "…of the panel the student is working in", which is what they
   always meant when there was only one. This is the whole reason the refactor is small: series(),
   doIntegrate(), inputIssue(), stepComplete() and the Fit Sine block were not touched. A single-panel
   workshop resolves every one of them to panel 0, forever. */
const PANEL_FIELDS=["ds","sigH","fileName","point","sel","drag","integ","fit","crop"];
function active(){ return S.panels[S.activeIdx] || S.panels[0] || null; }
PANEL_FIELDS.forEach(k=>Object.defineProperty(S,k,{
  get(){ const P=active(); return P?P[k]:null; },
  set(v){ const P=active(); if(P) P[k]=v; },
  configurable:true, enumerable:false }));

/* -------------------------- the panel -------------------------- */
// One slot: a strip (label + file picker + signal select), a canvas, and a readout. For a SINGLE-panel
// workshop the strip's contents are relocated into the toolbar (#barslot) and the strip is hidden, so
// the header reads exactly as it did before slots existed. Nothing about a one-slot deck changed.
function makePanel(def,i){
  const key=def.key||("slot"+i);
  const root=document.createElement("div"); root.className="panel"; root.dataset.key=key;
  root.innerHTML='<div class="pstrip">'
    +(def.label?'<span class="plabel">'+def.label+'</span>':'')
    +'<input type="file" accept=".csv,.zip">'
    +'<label>Signal</label>'
    +'<select title="what to plot (time is always the horizontal axis)"></select>'
    +'</div>'
    +'<div class="plotwrap"><canvas></canvas><div class="plotreadout"></div></div>';
  const P={ key, label:def.label||"", i, root,
    strip:root.querySelector(".pstrip"),
    file:root.querySelector("input[type=file]"),
    sigLabel:root.querySelector(".pstrip>label"),
    selEl:root.querySelector("select"),
    cv:root.querySelector("canvas"),
    readout:root.querySelector(".plotreadout"),
    G:{},
    ds:null, sigH:null, fileName:null, point:null, sel:null, drag:null, integ:null, fit:null, crop:null };
  P.ctx=P.cv.getContext("2d");
  P.file.addEventListener("change",e=>{ S.activeIdx=i; if(e.target.files[0]) handleFile(e.target.files[0],P); });
  P.selEl.addEventListener("change",e=>{ S.activeIdx=i; P.sigH=e.target.value;
    if((S.tool==="dblint"||S.tool==="integrate")&&P.sel) doIntegrate(series(P),P);
    if(S.tool==="fitsine"&&P.sel) doFitSine(series(P),P);
    updateCtx(); resize(); setReadout(); });
  wirePointer(P);
  return P;
}
PANELDEF.forEach((d,i)=>{ const P=makePanel(d,i); S.panels.push(P); $("panels").appendChild(P.root); });
function panelByKey(k){ return S.panels.find(P=>P.key===k)||null; }
function visiblePanels(){ return S.visible.map(i=>S.panels[i]).filter(Boolean); }
// A step names its slots; anything unnamed gets slot 0, which is every step of every earlier workshop.
function setSlots(st){
  const want=(st && Array.isArray(st.slots) && st.slots.length) ? st.slots : [PANELDEF[0].key||"slot0"];
  S.visible=want.map(k=>{ const P=panelByKey(k); return P?P.i:-1; }).filter(i=>i>=0);
  if(!S.visible.length) S.visible=[0];
  S.panels.forEach(P=>{ P.root.style.display = S.visible.indexOf(P.i)>=0 ? "flex" : "none"; });
  if(S.visible.indexOf(S.activeIdx)<0) S.activeIdx=S.visible[0];
  // Single visible slot → its controls live in the toolbar (the pre-slots look). Several → each keeps
  // its own strip, because a file picker with no plot attached to it is a guess about which file it wants.
  // Restore every panel's controls to its own strip FIRST, then lift the solo set into the bar. Order
  // matters: clearing #barslot before reclaiming the borrowed nodes would destroy the live <input> (and
  // its change listener) rather than move it, and the file picker would go dead on the second visit.
  const bar=$("barslot"), solo=S.visible.length===1 ? S.panels[S.visible[0]] : null;
  S.panels.forEach(P=>{
    if(P.file.parentNode!==P.strip){ P.strip.appendChild(P.file); P.strip.appendChild(P.sigLabel); P.strip.appendChild(P.selEl); }
    P.strip.style.display="";
  });
  bar.textContent="";
  if(solo){ solo.strip.style.display="none"; bar.appendChild(solo.file); bar.appendChild(solo.sigLabel); bar.appendChild(solo.selEl); }
  $("panels").classList.toggle("multi", S.visible.length>1);
}
const PI2_2 = Math.PI*Math.PI/2;   // ≈4.93 m/s² — the target acceleration amplitude for a 0.5 m, 0.5 Hz wave
let activePong=null;               // the running Pong game (top:"pong"), stopped when the step changes

/* ====================== phyphox ingest ======================== */
function parseCSV(text){
  text = text.replace(/^﻿/, "");
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.length);
  if(!lines.length) return null;
  const head = lines[0];
  const counts = {",":head.split(",").length, ";":head.split(";").length, "\t":head.split("\t").length};
  let delim=",",best=1; for(const d in counts){ if(counts[d]>best){best=counts[d];delim=d;} }
  const decComma = (delim===";");
  const cut = r => r.split(delim);
  const headers = cut(head).map(h=>h.trim().replace(/^"|"$/g,""));
  const cols={}; headers.forEach(h=>cols[h]=[]);
  for(let i=1;i<lines.length;i++){
    const c=cut(lines[i]);
    for(let j=0;j<headers.length;j++){
      let v=(c[j]||"").trim().replace(/^"|"$/g,"");
      if(decComma) v=v.replace(/\./g,"").replace(",",".");
      const n=parseFloat(v); cols[headers[j]].push(Number.isFinite(n)?n:NaN);
    }
  }
  return {headers, cols};
}
async function inflateRaw(bytes){
  if(typeof DecompressionStream==="undefined") throw new Error("This browser can't unzip in-page — use a recent Chrome/Safari/Firefox, or export a single CSV.");
  const ds=new DecompressionStream("deflate-raw");
  const ab=await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}
async function readZip(buf){
  const dv=new DataView(buf), u8=new Uint8Array(buf);
  let eocd=-1; for(let i=u8.length-22;i>=0;i--){ if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;} }
  if(eocd<0) throw new Error("Not a valid .zip");
  let off=dv.getUint32(eocd+16,true); const n=dv.getUint16(eocd+10,true); const out=[];
  for(let e=0;e<n;e++){
    if(dv.getUint32(off,true)!==0x02014b50) break;
    const method=dv.getUint16(off+10,true), csize=dv.getUint32(off+20,true);
    const nameLen=dv.getUint16(off+28,true), extLen=dv.getUint16(off+30,true), cmtLen=dv.getUint16(off+32,true);
    const lho=dv.getUint32(off+42,true);
    const name=new TextDecoder().decode(u8.subarray(off+46,off+46+nameLen));
    const lNameLen=dv.getUint16(lho+26,true), lExtLen=dv.getUint16(lho+28,true);
    const start=lho+30+lNameLen+lExtLen; const comp=u8.subarray(start,start+csize);
    let bytes; if(method===0) bytes=comp; else if(method===8) bytes=await inflateRaw(comp);
    else { off+=46+nameLen+extLen+cmtLen; continue; }
    out.push({name, text:new TextDecoder().decode(bytes)});
    off+=46+nameLen+extLen+cmtLen;
  }
  return out;
}
function setStatus(html,P){ const r=(P||active()||{}).readout; if(r){ r.style.display="block"; r.innerHTML=html; } }
function ingestParsed(parsed,P){
  P=P||active(); if(!P) return false;
  if(!parsed){ setStatus('<span class="ro-err">No CSV data found.</span>',P); return false; }
  const timeH=parsed.headers.find(h=>/time|\(s\)/i.test(h))||parsed.headers[0];
  P.ds={headers:parsed.headers, cols:parsed.cols, timeH};
  // signal options: numeric, non-time
  const nums=parsed.headers.filter(h=>h!==timeH && parsed.cols[h].some(v=>Number.isFinite(v)));
  const sel=P.selEl; sel.innerHTML="";
  nums.forEach(h=>{ const o=document.createElement("option"); o.value=h; o.textContent=prettySignal(h); sel.appendChild(o); });
  // default signal: the most ACTIVE signed axis (largest variance) — matches the deck's "pick the cleanest
  // wave" instruction and works whether the student waved along x, y, or z (Get Air's jump → y; a side-to-side
  // wave → x). Falls back to absolute acceleration, then the first numeric column.
  const varOf=h=>{ const c=parsed.cols[h].filter(Number.isFinite); if(c.length<2) return -1;
    const m=c.reduce((a,b)=>a+b,0)/c.length; return c.reduce((a,b)=>a+(b-m)*(b-m),0)/c.length; };
  const axes=nums.filter(h=>/acceleration\s*[xyz]\b|\b[xyz]\s*\(/i.test(h));
  let pick = axes.length ? axes.reduce((b,h)=>varOf(h)>varOf(b)?h:b)
                         : (nums.find(h=>/absolute/i.test(h)) || nums[0]);
  if(S.reqAxis){ const want=nums.find(h=>new RegExp("acceleration\\s*"+S.reqAxis+"\\b","i").test(h)); if(want) pick=want; }
  P.sigH = pick; sel.value=P.sigH;
  applyAxisLock();                          // a fresh upload rebuilds the options; re-apply the step's lock
  P.point=null; P.sel=null; P.integ=null; P.crop=null; P._bias=null; P._biasFor=null;
  updateCtx(); resize(); setReadout();
  // A `gate:"data"` step completes the moment a file lands, with no button involved — so this is one
  // of the places Next's look has to be recomputed, or it stays dark over a step that is now passable.
  if(typeof refreshNext==="function") refreshNext();
  return true;
}
async function handleFile(file,P){
  P=P||active();
  setStatus('<span class="ro-hint">reading…</span>',P);
  P.fileName=file.name;
  try{
    let parsed=null;
    if(file.name.toLowerCase().endsWith(".zip")){
      const entries=await readZip(await file.arrayBuffer());
      const data=entries.find(e=>e.name.toLowerCase().endsWith(".csv") && !/(^|\/)meta\//i.test(e.name));
      if(data) parsed=parseCSV(data.text);
    } else parsed=parseCSV(await file.text());
    ingestParsed(parsed,P);
  }catch(err){ setStatus('<span class="ro-err">'+(err.message||err)+'</span>',P); }
}

/* signal label helpers (make it clear these are 2nd derivatives) */
function prettySignal(h){
  if(/absolute/i.test(h)) return "Absolute acceleration |r̈| (m/s²)";
  const m=h.match(/acceleration\s*([xyz])/i);
  if(m){ const dd={x:"ẍ",y:"ÿ",z:"z̈"}[m[1].toLowerCase()]; return "Acceleration "+dd+" (m/s²)"; }
  return h;
}
function axisInfo(h){
  if(/absolute/i.test(h)) return {L:"r", dot:"ṙ", ddot:"|r̈|"};
  const m=h.match(/acceleration\s*([xyz])/i);
  if(m){ const l=m[1].toLowerCase(); return {L:l, dot:{x:"ẋ",y:"ẏ",z:"ż"}[l], ddot:{x:"ẍ",y:"ÿ",z:"z̈"}[l]}; }
  return {L:"x", dot:"ẋ", ddot:"ẍ"};
}

/* ====================== series + math ========================
   Every function here takes an optional panel and falls back to the ACTIVE one, so the call sites that
   predate slots (`series()`, `average(s)`, `doIntegrate(s)`) keep meaning what they meant. */
function series(P){
  P=P||active();
  if(!P||!P.ds||!P.sigH) return null;
  const t=P.ds.cols[P.ds.timeH], a=P.ds.cols[P.sigH], T=[],A=[];
  for(let i=0;i<t.length;i++){ if(Number.isFinite(t[i])&&Number.isFinite(a[i])){T.push(t[i]);A.push(a[i]);} }
  return T.length?{t:T,a:A}:null;
}
function nearest(s,tq){ let lo=0,hi=s.t.length-1; if(tq<=s.t[0])return 0; if(tq>=s.t[hi])return hi;
  while(hi-lo>1){const m=(lo+hi)>>1; if(s.t[m]<tq)lo=m; else hi=m;} return (tq-s.t[lo]<s.t[hi]-tq)?lo:hi; }
function selRange(s,P){ P=P||active(); if(!P||!P.sel) return null;
  return [nearest(s,Math.min(P.sel.a,P.sel.b)), nearest(s,Math.max(P.sel.a,P.sel.b))]; }
function average(s,P){ const r=selRange(s,P); if(!r) return null; let sum=0; for(let i=r[0];i<=r[1];i++) sum+=s.a[i]; return sum/(r[1]-r[0]+1); }
/* ---- crop: a VIEW window, not a filter ----
   `P.crop = {a,b}` in seconds. It changes what the plot SHOWS (dimmed outside, vertical axis rescaled to
   what is inside) and nothing that any tool COMPUTES — an Average dragged across the grayed region still
   averages the real samples. Deliberate: on Get Air's elevator files the phone-placement spike is 15 m/s²
   against a 0.3 m/s² ride, and a student needs to see that it is still there, 25x taller and one screen
   away, rather than have the tool quietly delete it for them. */
function cropRange(s,P){ P=P||active(); if(!P||!P.crop) return [0,s.t.length-1];
  return [nearest(s,Math.min(P.crop.a,P.crop.b)), nearest(s,Math.max(P.crop.a,P.crop.b))]; }
function fullSpan(s){ return s.t[s.t.length-1]-s.t[0]; }
// "has this student actually cropped?" — a crop sitting at the full extent (where it is initialized, so
// there are two bounds to grab) is not a crop yet. Anything that trims a twentieth counts.
function isCropped(P){ const s=series(P); if(!s||!P.crop) return false;
  return Math.abs(P.crop.b-P.crop.a) < 0.95*fullSpan(s); }
function doIntegrate(s,P){
  P=P||active();
  const r=selRange(s,P); if(!r||r[1]<=r[0]) { P.integ=null; return; }
  const [i0,i1]=r;
  // By default the signal is integrated AS-IS: on phyphox's "without g" (linear acceleration) stream a
  // still body reads ≈0, so no baseline subtraction is needed in principle. Residual drift is real — and
  // the point of the step that follows. `S.debias` (off by default) is the opt-in correction: estimate the
  // sensor's constant zero-offset from the stillness the student was told to start in, and subtract it.
  // The offset is estimated from the QUIETEST half-second of the whole recording — see estimateBias().
  const bias = S.debias ? estimateBias(s,P) : 0;
  S.debiasEst = S.debias ? bias : null;
  let v=0, x=0;   // zero initial conditions (the reason students must start from rest)
  const t=[s.t[i0]],V=[v],X=[x]; let peak=x, peakT=s.t[i0], peakK=0, k=0;
  for(let i=i0+1;i<=i1;i++){ const dt=s.t[i]-s.t[i-1]; const am=(s.a[i]+s.a[i-1])/2 - bias;
    const pv=v; v+=am*dt; x+=(pv+v)/2*dt; t.push(s.t[i]);V.push(v);X.push(x); k++; if(x>peak){peak=x;peakT=s.t[i];peakK=k;} }
  P.integ={t,v:V,x:X,peak,peakT,peakK,i0,i1};
}

/* Estimate the sensor's constant zero-offset: the mean of the QUIETEST half-second anywhere in the
   recording, found by sliding a window and taking the one with the least variance.

   The first version of this took the mean of the first half-second of the SELECTION, which was wrong in
   the one case that matters. The whole point of the reworded Method-2 step is to drag a TIGHT window —
   about a quarter-second of stillness before the crouch — and a quarter-second of "stillness" that is
   really the top of the crouch is not a zero reading. On Get Air's demo it estimated -1.79 m/s² and
   reported a 767 cm jump. The two ideas were in direct conflict: the tighter the drag, the less still
   data it contains to calibrate from.

   Looking at the whole recording instead decouples them. The phone was lying still or standing still
   somewhere in every one of these captures — before the jump, between elevator floors — and that stretch
   is the calibration whether or not the student selected it. Cached per panel and per signal, because it
   depends on neither the selection nor the tool. */
function estimateBias(s,P){
  P=P||active();
  if(P && P._biasFor===P.sigH && Number.isFinite(P._bias)) return P._bias;
  const WIN=0.5, MINN=8;
  let j=0, sum=0, sum2=0, best=null;
  for(let i=0;i<s.t.length;i++){
    while(j<s.t.length && s.t[j]-s.t[i]<=WIN){ sum+=s.a[j]; sum2+=s.a[j]*s.a[j]; j++; }
    const n=j-i;
    if(n>=MINN){
      const m=sum/n, varr=sum2/n-m*m;
      if(!best || varr<best.varr) best={varr,m};
    }
    sum-=s.a[i]; sum2-=s.a[i]*s.a[i];
  }
  const b = best ? best.m : 0;
  if(P){ P._bias=b; P._biasFor=P.sigH; }
  return b;
}

/* ====================== Fit Sine ============================== */
/* Fits a(t) = Amp·sin(2π f·t + φ) to the selected window (drag-select, like Integrate).
   Amp is the ACCELERATION amplitude (m/s²). Phase is always fitted. Amp and/or freq may be free
   (the tool finds them) or locked to a typed/pinned value. A step may pin both (the challenge). */
function linSineFit(t,a,f){                 // freq fixed → linear fit a ≈ b1·sin + b2·cos (closed form)
  const w0=2*Math.PI*f; let Suu=0,Sww=0,Suw=0,Sau=0,Saw=0;
  for(let i=0;i<t.length;i++){ const u=Math.sin(w0*t[i]), w=Math.cos(w0*t[i]);
    Suu+=u*u; Sww+=w*w; Suw+=u*w; Sau+=a[i]*u; Saw+=a[i]*w; }
  const det=Suu*Sww-Suw*Suw; let b1,b2;
  if(Math.abs(det)<1e-12){ b1=Sau/(Suu||1); b2=Saw/(Sww||1); }
  else { b1=(Sau*Sww-Saw*Suw)/det; b2=(Saw*Suu-Sau*Suw)/det; }
  return {amp:Math.hypot(b1,b2), phase:Math.atan2(b2,b1)};   // best phase is the same whether or not amp is locked
}
function r2sine(t,a,amp,f,phase){
  const w0=2*Math.PI*f; let mean=0; for(let i=0;i<a.length;i++) mean+=a[i]; mean/=a.length||1;
  let ssRes=0, ssTot=0;
  for(let i=0;i<t.length;i++){ const pred=amp*Math.sin(w0*t[i]+phase); ssRes+=(a[i]-pred)**2; ssTot+=(a[i]-mean)**2; }
  return ssTot>0 ? 1-ssRes/ssTot : 0;
}
function axisOK(){ return !S.reqAxis || new RegExp("acceleration\\s*"+S.reqAxis+"\\b","i").test(S.sigH||""); }
// If a step requires an axis, select it — on EVERY visible slot, not just the active one. The elevator
// section requires z on both rides, and a student who has to hunt the dropdown twice has been given a
// chore, not a measurement.
function preferAxis(){
  if(!S.reqAxis) return;
  (visiblePanels().length?visiblePanels():S.panels).forEach(P=>{
    if(!P.ds) return;
    const want=P.ds.headers.find(h=>h!==P.ds.timeH && new RegExp("acceleration\\s*"+S.reqAxis+"\\b","i").test(h));
    if(want && want!==P.sigH){ P.sigH=want; if(P.selEl) P.selEl.value=want; }
  });
}
// ...and LOCK the dropdown while that step is up. Default-selecting was only half the job: on the
// challenge, scoring is gated on the x-axis, so the only thing an open dropdown can still do is
// silently stop a run from counting — a control whose remaining uses are all mistakes. Locked only
// when the loaded file actually HAS the required column, so a student who exported the wrong
// experiment can still look at what they collected instead of facing a frozen control.
function applyAxisLock(){
  (S.panels||[]).forEach(P=>{
    const sel=P.selEl; if(!sel) return;
    const has = !!(S.reqAxis && P.ds && P.ds.headers.some(h=>h!==P.ds.timeH &&
                   new RegExp("acceleration\\s*"+S.reqAxis+"\\b","i").test(h)));
    sel.disabled = has;
    sel.title = has ? "locked to the "+S.reqAxis+"-axis for this step"
                    : "what to plot (time is always the horizontal axis)";
  });
}
function doFitSine(s,P){
  P=P||active();
  const r=selRange(s,P); if(!r || r[1]-r[0]<3){ P.fit=null; return; }
  const t=[],a=[]; for(let i=r[0];i<=r[1];i++){ t.push(s.t[i]); a.push(s.a[i]); }
  const lock=S.fitLock, c=S.fitCtl;
  const ampFit  = lock ? false : c.ampFit;
  const freqFit = lock ? false : c.freqFit;
  const lockedAmp  = lock ? lock.amp  : c.ampVal;
  const lockedFreq = lock ? lock.freq : c.freqVal;
  let best=null;
  const tryF=f=>{ const lf=linSineFit(t,a,f);
    const amp = ampFit ? lf.amp : (Number.isFinite(lockedAmp)?lockedAmp:lf.amp);
    const r2  = r2sine(t,a,amp,f,lf.phase);
    if(!best || r2>best.r2) best={amp,freq:f,phase:lf.phase,r2}; };
  if(freqFit){                                     // scan frequency, then refine around the winner
    for(let f=0.10; f<=3.0001; f+=0.02) tryF(f);
    const f0=best.freq; for(let f=Math.max(0.05,f0-0.02); f<=f0+0.02001; f+=0.002) tryF(f);
  } else tryF(Number.isFinite(lockedFreq)?lockedFreq:0.5);
  P.fit=best;
  if(!lock){ if(c.ampFit) c.ampVal=best.amp; if(c.freqFit) c.freqVal=best.freq; }   // free params reflect the fit
  if(S.challenge && lock){                         // high-score: a fair ≥4-cycle window, on the required axis, that beats the best
    const span=Math.abs(P.sel.b-P.sel.a);          // 4 cycles at the locked 0.5 Hz ⇒ ≥ ~8 s
    if(axisOK() && span>=7.5 && (S.hs.best==null || best.r2>S.hs.best)){ S.hs.best=best.r2; updateHighscore(); }
  }
}

/* ====================== contextual controls ==================== */
function updateCtx(){
  const box=$("ctx"); box.innerHTML="";
  // Integrate / Double Integrate get one control: the provisional zero-offset removal. Same row as Fit
  // Sine's cells so the bar height never changes (house style).
  if(S.tool==="dblint"||S.tool==="integrate"){
    box.innerHTML='<label class="chk" title="Subtract the sensor\'s constant zero-offset, estimated from the stillness at the start of your selection">'
      +'<input type="checkbox" id="debias"'+(S.debias?" checked":"")+'>remove zero-offset</label>'
      +'<span class="biasnote" id="biasnote"></span>';
    const cb=$("debias");
    cb.addEventListener("change",()=>{ S.debias=cb.checked;
      visiblePanels().forEach(P=>{ const ss=series(P); if(ss&&P.sel) doIntegrate(ss,P); });
      render(); setReadout(); updateBiasNote(); });
    updateBiasNote();
    return;
  }
  if(S.tool!=="fitsine") return;                 // nothing else has controls
  const lock=S.fitLock, c=S.fitCtl;
  const ampFit = lock?false:c.ampFit, freqFit = lock?false:c.freqFit;
  const ampV = lock?lock.amp:c.ampVal, freqV = lock?lock.freq:c.freqVal;
  const cell=(pfx,label,val,fitOn,unit)=>
    '<span class="fitctl"><label>'+label+'</label>'
    +'<input type="number" step="any" id="'+pfx+'val" value="'+(Number.isFinite(val)?(+val).toFixed(2):"")+'"'+(lock?" disabled":"")+'>'
    +'<span class="unit">'+unit+'</span>'
    +'<label class="fitchk"><input type="checkbox" id="'+pfx+'fit"'+(fitOn?" checked":"")+(lock?" disabled":"")+'>fit</label></span>';
  box.innerHTML = cell("amp","Amp",ampV,ampFit,"m/s²") + cell("freq","Freq",freqV,freqFit,"Hz");
  if(lock) return;                               // pinned by the step — controls are read-only
  const wire=(pfx,which)=>{ const inp=$(pfx+"val"), chk=$(pfx+"fit");
    inp.addEventListener("input",()=>{ const v=parseFloat(inp.value);
      if(Number.isFinite(v)){ c[which+"Val"]=v; c[which+"Fit"]=false; chk.checked=false; }   // typing locks the param
      recomputeFit(); });
    chk.addEventListener("change",()=>{ c[which+"Fit"]=chk.checked; recomputeFit(); }); };  // toggling fit frees/locks it
  wire("amp","amp"); wire("freq","freq");
}
// what the offset actually was, in the bar beside the checkbox — the number is the whole argument, and a
// correction the student can't see the size of is indistinguishable from the tool making things up.
function updateBiasNote(){
  const el=$("biasnote"); if(!el) return;
  el.textContent = (S.debias && Number.isFinite(S.debiasEst) && S.debiasEst!==null)
    ? "removed "+S.debiasEst.toFixed(2)+" m/s²" : "";   // an acceleration: 2 dp, like every other one
}
function syncFitControls(){                       // refresh free-param textboxes with the fitted values (no rebuild → keeps focus)
  if(S.fitLock||!S.fit) return;
  const a=$("ampval"), f=$("freqval");
  if(a && S.fitCtl.ampFit && document.activeElement!==a) a.value=S.fit.amp.toFixed(2);
  if(f && S.fitCtl.freqFit && document.activeElement!==f) f.value=S.fit.freq.toFixed(2);
}
function recomputeFit(){ const s=series(); if(s && S.sel) doFitSine(s); render(); syncFitControls(); updatePlotReadout(); }
// HOUSE STYLE: every tool's readout is a green box in the plot's top-left (the Fit Sine formula set the pattern).
// Select Point → t & value · Average → mean & span · Fit Sine → formula + R² (hover for the definition).
// Integrate keeps its on-curve peak/end callouts and shows nothing here.
/* HOW MANY DECIMALS MAY WE PRINT? (added 2026-09-04, and it is a rule we were breaking.)

   The decks are about to gate students on reporting the right number of decimals, so the instrument
   has to obey the same rule first. It was not: Select Point printed a time to the MILLISECOND off a
   capture sampled at 100 Hz, inventing two digits, and a student copying that readout was being taught
   to over-report by the very tool that was going to mark them down for it.

   Derived from the data rather than hardcoded, because the rate is a property of the phone — a device
   sampling at 400 Hz has genuinely earned a third decimal, and Get Air's two captures (jump and
   elevator, both 100 Hz) have earned two. Median interval, so one dropped sample cannot move it, and
   `round` rather than `ceil` because a nominal 100 Hz measures 9.98 ms and must still read as 2. */
function sampleDt(s){
  if(!s || !s.t || s.t.length < 3) return null;
  const d = [];
  for(let i = 1; i < Math.min(s.t.length, 200); i++) d.push(s.t[i] - s.t[i-1]);
  d.sort((a,b) => a-b);
  const m = d[d.length >> 1];
  return (m > 0) ? m : null;
}
function timeDecimals(s){
  const dt = sampleDt(s);
  if(!dt) return 2;
  return Math.max(0, Math.min(4, Math.round(-Math.log10(dt))));
}
function updatePlotReadout(P){
  P=P||active();
  const R=P&&P.readout; if(!R) return;
  const show=h=>{ R.style.display="block"; R.innerHTML=h; };
  const s=series(P);
  if(!s){ R.style.display="none"; R.innerHTML=""; return; }
  const A=axisInfo(P.sigH);
  if(S.tool==="fitsine"){
    if(!P.fit){ show('<span class="ro-hint">drag to select a few cycles</span>'); return; }
    const ph=((P.fit.phase%(2*Math.PI))+2*Math.PI)%(2*Math.PI);
    const axisWarn = (S.challenge && !axisOK())
      ? '<span class="ro-hint"> — switch <b>Signal</b> to the '+S.reqAxis+'-axis to score</span>' : '';
    show('<span class="formula"><i>a</i> = '+P.fit.amp.toFixed(2)+'·sin(2π·'+P.fit.freq.toFixed(2)+'·<i>t</i> + '+ph.toFixed(2)+')</span>'
      +'<span class="r2" tabindex="0"><i>R</i>² = '+P.fit.r2.toFixed(3)
      +'<span class="r2pop">Fraction of the variance in your selection the fit explains — 1 = perfect, 0 = no better than a flat line, &lt;0 = worse than a flat line</span></span>'+axisWarn);
  } else if(S.tool==="point"){
    if(P.point==null){ show('<span class="ro-hint">click or drag along the trace</span>'); return; }
    const i=nearest(s,P.point);
    const td = timeDecimals(s);          // never finer than the sample interval — see timeDecimals()
    show('<span class="ro"><i>t</i> = '+s.t[i].toFixed(td)+' s&nbsp;·&nbsp;<i>'+A.ddot+'</i> = '+s.a[i].toFixed(2)+' m/s²</span>');
  } else if(S.tool==="avg"){
    const av=average(s,P); if(av==null){ show('<span class="ro-hint">drag a region to average</span>'); return; }
    show('<span class="ro">average <i>'+A.ddot+'</i> = '+av.toFixed(2)+' m/s²<span class="ro-ctx"> over '+Math.abs(P.sel.b-P.sel.a).toFixed(timeDecimals(s))+' s</span></span>');
  } else if(S.tool==="crop"){
    // Crop is the one tool that reads out in AMBER, not green, and that is the point of the house rule
    // rather than an exception to it: green means "a number you measured", and a crop measures nothing.
    // It says what you are looking at, in the same amber as the bounds you dragged to say it.
    if(!P.crop){ show('<span class="ro-hint">drag across the trace to crop</span>'); return; }
    // Just the window. It used to add "showing …" and a percent-of-the-recording, which was three facts
    // where one was wanted — the axis underneath already says what fraction of the run this is.
    const lo=Math.min(P.crop.a,P.crop.b), hi=Math.max(P.crop.a,P.crop.b);
    const tdc = timeDecimals(s);
    show('<span class="ro-ctx">'+lo.toFixed(tdc)+'–'+hi.toFixed(tdc)+' s</span>');
  } else { R.style.display="none"; R.innerHTML=""; }   // integrate → on-curve callouts only
}
// Every visible panel repaints its own readout; the legacy no-arg call sites now mean "all of them",
// which is what they have to mean once two plots are on screen at once.
function setReadout(){ visiblePanels().forEach(updatePlotReadout); }
function updateFitLabel(){ visiblePanels().forEach(updatePlotReadout); }
function updateHighscore(){                       // move the high-score arrow on the challenge colorbar
  const ar=$("hsarrow"), v=$("hsval"); if(!ar) return;
  const b=S.hs.best, pct=Math.max(0,Math.min(1,Number.isFinite(b)?b:0));   // gradient has 15px top/bottom insets
  ar.style.bottom="calc(15px + "+pct+" * (100% - 30px) - 7px)";
  if(v) v.textContent=Number.isFinite(b)?b.toFixed(4):"—";   // 4 dp here for tiebreakers (readout stays 3 dp)
}
/* ============================ plot ============================ */
// `cv`/`ctx`/`G` are the CURRENT panel's canvas, context and geometry. They are reassigned at the top of
// renderPanel and never held across an await — which is what lets every drawing helper below (font(),
// polyline(), axisTitleV(), the whole 130-line render body) stay exactly as it was written for one plot.
let cv=null, ctx=null, G={};
function fitCanvas(P){ const r=P.cv.getBoundingClientRect(), d=window.devicePixelRatio||1;
  P.cv.width=Math.max(1,r.width*d); P.cv.height=Math.max(1,r.height*d); P.ctx.setTransform(d,0,0,d,0,0); }
function resize(){ (visiblePanels().length?visiblePanels():S.panels).forEach(fitCanvas); render(); }
function getCss(v){ return v.startsWith("--") ? (getComputedStyle(document.documentElement).getPropertyValue(v).trim()||"#ccc") : v; }
function font(px){ return px+"px "+getCss("--font-sans"); }
function ifont(px){ return "italic "+px+"px "+getCss("--font-sans"); }   // house style: variables are italic
// draw a rotated (vertical) axis title with the VARIABLE part italic and the UNIT part roman, centered on (cx,cy)
function axisTitleV(cx,cy,varTxt,unitTxt,colorVar){
  ctx.save(); ctx.translate(cx,cy); ctx.rotate(-Math.PI/2); ctx.textBaseline="alphabetic"; ctx.textAlign="left";
  ctx.font=ifont(12); const vw=ctx.measureText(varTxt).width;
  ctx.font=font(12);  const uw=unitTxt?ctx.measureText(" "+unitTxt).width:0;
  const x0=-(vw+uw)/2; ctx.fillStyle=getCss(colorVar);
  ctx.font=ifont(12); ctx.fillText(varTxt,x0,0);
  if(unitTxt){ ctx.font=font(12); ctx.fillText(" "+unitTxt,x0+vw,0); }
  ctx.restore();
}
function num(v){ return Number(getCss(v))||0; }

/* house axis rule (lab-suite/style/STYLE.md 'Axes & ticks'): round 1/2/5×10^n step, bounds snapped out
   to round numbers, 0 falling on a labeled tick whenever the data is within one step of it. */
function niceStep(range,target){ const raw=range/Math.max(1,target); const mag=Math.pow(10,Math.floor(Math.log10(raw)));
  const n=raw/mag; return (n<1.5?1:n<3?2:n<7?5:10)*mag; }
function niceTicks(min,max,target){ if(!(max>min)){min-=1;max+=1;} const step=niceStep(max-min,target||5);
  const lo=Math.floor(min/step)*step, hi=Math.ceil(max/step)*step, t=[];
  for(let v=lo; v<=hi+step*1e-6; v+=step) t.push(Math.abs(v)<step*1e-6?0:v);
  return {lo,hi,step,ticks:t}; }
function fmt(v){ const a=Math.abs(v); if(a!==0 && (a<1e-3||a>=1e5)) return v.toExponential(0);
  return (Math.round(v*1000)/1000).toString(); }
function polyline(xs,ys,color,w){ ctx.strokeStyle=getCss(color); ctx.lineWidth=w; ctx.beginPath();
  for(let i=0;i<xs.length;i++){ i?ctx.lineTo(xs[i],ys[i]):ctx.moveTo(xs[i],ys[i]); } ctx.stroke(); ctx.lineWidth=1; }

function render(){ visiblePanels().forEach(renderPanel); }
function renderPanel(P){
  cv=P.cv; ctx=P.ctx;
  const W=cv.clientWidth,H=cv.clientHeight; ctx.clearRect(0,0,W,H);
  const s=series(P);
  if(!s){ ctx.fillStyle=getCss("--muted"); ctx.font=font(14); ctx.textAlign="center"; ctx.textBaseline="middle";
    ctx.fillText(P.label ? ("Load the “"+P.label+"” export with the picker above.")
                         : "Load your phyphox .zip (top-left) to plot acceleration against time.", W/2, H/2); return; }
  const A=axisInfo(P.sigH), showX = S.tool==="dblint" && !!P.integ, showV = S.tool==="integrate" && !!P.integ;
  // Stacked panels share one time axis, so only the BOTTOM one carries the `t (s)` title — the convention
  // for a column of plots, and here also the only way to fit it: a half-height panel has no room to give.
  const vis=visiblePanels(), isLast = !vis.length || vis[vis.length-1]===P;
  // mB was 34, which put the axis title's cap-height straight through the tick labels' descenders. It only
  // showed when a tick happened to land at the horizontal center — Get Air's elevator files put "10" there
  // and printed it through the middle of "t (s)". The title now gets a row of its own rather than sharing.
  const mL=58, mR=(showX||showV)?62:18, mT=16, mB=isLast?42:24, ph=H-mT-mB, px=W-mL-mR;

  // The TIME axis always spans the whole recording, cropped or not — that is the deliberate half of the
  // crop design. Only the VERTICAL axis rescales, so the discarded noise stays on screen, dimmed, at its
  // true width and now visibly off the top of the plot. A student can see what they threw away.
  // The time axis always spans the WHOLE recording, however tight the crop is. Only the vertical axis
  // rescales to what is inside. Tried it the other way on 2026-08-21 — the view following the crop, with
  // a margin of gray kept outside each bound to drag into — and it made the control worse to use, not
  // better (Daniel, same day). Cropping is a drag-a-region gesture on a fixed axis; the moment the axis
  // moves underneath the gesture, the thing you are dragging is measured in a coordinate system your own
  // drag is changing, and no amount of care with the pointer maths makes that feel right.
  const T=niceTicks(s.t[0], s.t[s.t.length-1], 6);
  const cr=cropRange(s,P);
  const inA=s.a.slice(cr[0],cr[1]+1);
  const Ay=niceTicks(Math.min.apply(null,inA), Math.max.apply(null,inA), 5);
  const tx=t=>mL+(t-T.lo)/(T.hi-T.lo)*px;
  const ay=a=>mT+(Ay.hi-a)/(Ay.hi-Ay.lo)*ph;
  P.G=G={mL,mR,tLo:T.lo,tHi:T.hi};

  // horizontal gridlines + left labels
  ctx.textBaseline="middle"; ctx.textAlign="right"; ctx.font=font(11);
  Ay.ticks.forEach(v=>{ const y=ay(v); ctx.strokeStyle=getCss(v===0?"--zero":"--grid"); ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(mL,y); ctx.lineTo(W-mR,y); ctx.stroke();
    ctx.fillStyle=getCss("--muted"); ctx.fillText(fmt(v), mL-8, y); });
  // left axis title (tinted to the trace) — variable italic, unit roman
  axisTitleV(15, mT+ph/2, A.ddot, "(m/s²)", "--trace");
  // frame (left + bottom)
  ctx.strokeStyle=getCss("--line"); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(mL,mT); ctx.lineTo(mL,mT+ph); ctx.lineTo(W-mR,mT+ph); ctx.stroke();
  // time ticks + title
  ctx.textAlign="center"; ctx.textBaseline="top"; ctx.fillStyle=getCss("--muted"); ctx.font=font(11);
  T.ticks.forEach(v=>{ ctx.fillText(fmt(v), tx(v), mT+ph+7); });
  if(isLast){ const yy=mT+ph+31; ctx.textAlign="left"; ctx.textBaseline="alphabetic"; ctx.fillStyle=getCss("--muted");   // x-axis title: t italic, (s) roman
    ctx.font=ifont(12); const vw=ctx.measureText("t").width; ctx.font=font(12); const uw=ctx.measureText(" (s)").width;
    const x0=mL+px/2-(vw+uw)/2; ctx.font=ifont(12); ctx.fillText("t",x0,yy); ctx.font=font(12); ctx.fillText(" (s)",x0+vw,yy); }

  // Double Integrate — show the two steps a→v→x: the SINGLE integral v(t) as a faint amber GUIDE (context,
  // auto-scaled to fit, sharing the y=0 line — no axis), with GREEN shading of the area under it. That green
  // area is the accumulating displacement = the double integral = the position we're actually measuring.
  if(S.tool==="dblint" && P.sel && P.integ){
    const I=P.integ, y0=ay(0);
    let vMax=0; for(const v of I.v) vMax=Math.max(vMax,Math.abs(v));
    const upPx=Math.max(8,y0-mT), downPx=Math.max(8,(mT+ph)-y0);
    const vScale = vMax>0 ? Math.min(upPx,downPx)*0.85/vMax : 1;
    const vy=v=>y0 - v*vScale, xs=I.t.map(tx), ys=I.v.map(vy);
    ctx.fillStyle=getCss("--band"); ctx.beginPath(); ctx.moveTo(xs[0],y0);          // green area under v(t)
    for(let i=0;i<xs.length;i++) ctx.lineTo(xs[i],ys[i]); ctx.lineTo(xs[xs.length-1],y0); ctx.closePath(); ctx.fill();
    ctx.save(); ctx.globalAlpha=.35; polyline(xs,ys,"--edge",num("--stroke-trace")); ctx.restore();   // faint amber v(t)
  }
  // Integrate (single) — shade the GREEN area under a(t) across the selection. That area IS the single
  // integral Δv; no amber intermediate curve (that's Double Integrate's story). The running integral v(t)
  // is drawn as a solid green curve on the right axis (below, in the showV block).
  if(S.tool==="integrate" && P.sel && P.integ){
    const r=selRange(s,P), y0=ay(0);
    ctx.fillStyle=getCss("--band"); ctx.beginPath(); ctx.moveTo(tx(s.t[r[0]]),y0);
    for(let i=r[0];i<=r[1];i++) ctx.lineTo(tx(s.t[i]),ay(s.a[i]));
    ctx.lineTo(tx(s.t[r[1]]),y0); ctx.closePath(); ctx.fill();
  }
  // average: amber band (context) + SOLID green mean line (the measured value)
  if(S.tool==="avg" && P.sel){ const av=average(s,P); if(av!=null){ const r=selRange(s,P);
    ctx.fillStyle=getCss("--band-amber"); ctx.fillRect(tx(s.t[r[0]]),mT,tx(s.t[r[1]])-tx(s.t[r[0]]),ph);
    ctx.strokeStyle=getCss("--avg"); ctx.lineWidth=num("--stroke-result");
    ctx.beginPath(); ctx.moveTo(tx(s.t[r[0]]),ay(av)); ctx.lineTo(tx(s.t[r[1]]),ay(av)); ctx.stroke(); ctx.lineWidth=1; } }

  // The signal trace. Cropped, it is drawn TWICE: the whole recording dimmed, then the kept window in
  // full blue over the top. Both are clipped to the plot rectangle, because the discarded part is
  // routinely twenty times the height of the axis it is now scaled against and would otherwise paint
  // straight over the tick labels, the toolbar, and the panel below it.
  ctx.save(); ctx.beginPath(); ctx.rect(mL,mT,px,ph); ctx.clip();
  if(isCropped(P)){
    polyline(s.t.map(tx), s.a.map(ay), "--trace-dim", num("--stroke-trace"));
    const xs=[],ys=[];
    for(let i=cr[0];i<=cr[1];i++){ xs.push(tx(s.t[i])); ys.push(ay(s.a[i])); }
    polyline(xs,ys,"--trace",num("--stroke-trace"));
  } else {
    polyline(s.t.map(tx), s.a.map(ay), "--trace", num("--stroke-trace"));
  }
  ctx.restore();

  // Fit Sine: the fitted sine drawn over the selected window
  if(S.tool==="fitsine" && P.fit && P.sel){
    const r=selRange(s,P), w0=2*Math.PI*P.fit.freq, xs=[],ys=[];
    for(let i=r[0];i<=r[1];i++){ xs.push(tx(s.t[i])); ys.push(ay(P.fit.amp*Math.sin(w0*s.t[i]+P.fit.phase))); }
    polyline(xs,ys,"--result",num("--stroke-result"));
  }

  // integrate result: right axis + curve
  if(showX){
    // house rule: the result curve SHARES the signal's x-axis (the y=0 line). Its own scale is
    // independent but pinned to that shared zero, so there's a single zero baseline to read.
    const I=P.integ, rx=W-mR, y0=ay(0);
    const dr=niceTicks(Math.min(0,Math.min.apply(null,I.x)), Math.max(0,Math.max.apply(null,I.x)), 4);
    const upPx=Math.max(8,y0-mT), downPx=Math.max(8,(mT+ph)-y0), padF=0.90;
    let scale=Infinity;
    if(dr.hi>0) scale=Math.min(scale, upPx*padF/dr.hi);
    if(dr.lo<0) scale=Math.min(scale, downPx*padF/(-dr.lo));
    if(!isFinite(scale)||scale<=0) scale=1;
    const xy=v=> y0 - v*scale;
    ctx.strokeStyle=getCss("--result"); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(rx,mT); ctx.lineTo(rx,mT+ph); ctx.stroke();
    // ticks across the FULL visible axis (not just the data range)
    const vTop=(y0-mT)/scale, vBot=(y0-(mT+ph))/scale;
    const Ry=niceTicks(Math.min(vTop,vBot), Math.max(vTop,vBot), 5);
    ctx.fillStyle=getCss("--result"); ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.font=font(11);
    Ry.ticks.forEach(v=>{ const y=xy(v); if(y<mT-1||y>mT+ph+1) return; ctx.fillText(fmt(v), rx+8, y); });
    // right-axis title: the double integral of the plotted signal, in meters (operation italic, unit roman)
    axisTitleV(W-15, mT+ph/2, "∫∫ "+A.ddot+" dt dt", "(m)", "--result");
    polyline(I.t.map(tx), I.x.map(xy), "--result", num("--stroke-result"));
    // curve callouts (in the curve's color): "peak" at the max, "end value" at the last point.
    // If the peak IS the end (a monotonic curve — the impulse-lab case), show only end value.
    const lastK=I.x.length-1, endVal=I.x[lastK];
    ctx.fillStyle=getCss("--result"); ctx.textBaseline="alphabetic"; ctx.font=font(12);
    if(I.peakK!==lastK){
      const pkx=Math.max(mL+34,Math.min(rx-34,tx(I.peakT))), pky=xy(I.peak);
      ctx.textAlign="center"; ctx.fillText("peak "+(I.peak*100).toFixed(0)+" cm", pkx, Math.max(mT+12,pky-7));
    }
    const ex=tx(I.t[lastK]), ey=xy(endVal);
    ctx.textAlign="right"; ctx.fillText("end value "+(endVal*100).toFixed(0)+" cm", Math.min(rx-4,ex-4), Math.max(mT+12,ey-7));
  }
  // Integrate (single) result: right axis in m/s + the running integral v(t) as a SOLID green curve, sharing
  // the signal's y=0 line (house axis rule). The end-value callout is the net Δv over the selection.
  if(showV){
    const I=P.integ, rx=W-mR, y0=ay(0);
    const dr=niceTicks(Math.min(0,Math.min.apply(null,I.v)), Math.max(0,Math.max.apply(null,I.v)), 4);
    const upPx=Math.max(8,y0-mT), downPx=Math.max(8,(mT+ph)-y0), padF=0.90;
    let scale=Infinity;
    if(dr.hi>0) scale=Math.min(scale, upPx*padF/dr.hi);
    if(dr.lo<0) scale=Math.min(scale, downPx*padF/(-dr.lo));
    if(!isFinite(scale)||scale<=0) scale=1;
    const xy=v=> y0 - v*scale;
    ctx.strokeStyle=getCss("--result"); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(rx,mT); ctx.lineTo(rx,mT+ph); ctx.stroke();
    const vTop=(y0-mT)/scale, vBot=(y0-(mT+ph))/scale;
    const Ry=niceTicks(Math.min(vTop,vBot), Math.max(vTop,vBot), 5);
    ctx.fillStyle=getCss("--result"); ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.font=font(11);
    Ry.ticks.forEach(v=>{ const y=xy(v); if(y<mT-1||y>mT+ph+1) return; ctx.fillText(fmt(v), rx+8, y); });
    axisTitleV(W-15, mT+ph/2, "∫ "+A.ddot+" dt", "(m/s)", "--result");   // operation italic, unit roman
    polyline(I.t.map(tx), I.v.map(xy), "--result", num("--stroke-result"));
    const lastK=I.v.length-1, endVal=I.v[lastK];
    const ex=tx(I.t[lastK]), ey=xy(endVal);
    ctx.fillStyle=getCss("--result"); ctx.textBaseline="alphabetic"; ctx.font=font(12); ctx.textAlign="right";
    ctx.fillText("end point = "+endVal.toFixed(2)+" m/s", Math.min(rx-4,ex-4), Math.max(mT+12,ey-7));
  }
  // point marker: amber dashed vertical rule (context) + solid GREEN dot (the measured point)
  if(S.tool==="point" && P.point!=null){ const i=nearest(s,P.point), x=tx(s.t[i]), y=ay(s.a[i]);
    ctx.strokeStyle=getCss("--edge"); ctx.lineWidth=num("--stroke-mark"); ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x,mT); ctx.lineTo(x,mT+ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=getCss("--mark"); ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fill(); ctx.lineWidth=1; }
  // selection edges (avg / integrate / fit sine): dashed amber context lines bounding the selection
  if((S.tool==="avg"||S.tool==="dblint"||S.tool==="integrate"||S.tool==="fitsine") && P.sel){ const r=selRange(s,P);
    ctx.strokeStyle=getCss("--edge"); ctx.lineWidth=num("--stroke-mark"); ctx.setLineDash([4,4]);
    [r[0],r[1]].forEach(i=>{ const x=tx(s.t[i]);
      ctx.beginPath(); ctx.moveTo(x,mT); ctx.lineTo(x,mT+ph); ctx.stroke(); }); ctx.setLineDash([]); ctx.lineWidth=1; }
  // crop bounds: dashed amber rules with a grip at the top, drawn whenever a crop EXISTS — not only
  // while the Crop tool is active, because the whole reason to crop is to then go and measure inside it,
  // and a window whose edges vanish the moment you pick up the ruler is not a window.
  if(P.crop){
    const lo=Math.min(P.crop.a,P.crop.b), hi=Math.max(P.crop.a,P.crop.b), live=S.tool==="crop";
    ctx.save(); ctx.globalAlpha = live ? 1 : 0.55;
    [lo,hi].forEach(tv=>{
      const x=Math.max(mL,Math.min(W-mR,tx(tv)));
      // DOTTED, where a selection edge is DASHED. Both are amber context marks and both can be on screen
      // at once — a student averaging inside a crop sees four vertical rules — so the two need to be
      // separable at a glance: the fine dots are the window, the long dashes are the measurement.
      ctx.strokeStyle=getCss("--edge"); ctx.lineWidth=num("--stroke-mark"); ctx.setLineDash([2,4]);
      ctx.beginPath(); ctx.moveTo(x,mT); ctx.lineTo(x,mT+ph); ctx.stroke(); ctx.setLineDash([]);
      // The grip sits at the BOTTOM of the rule, not the top: the readout is pinned top-left by house
      // style, and a bound dragged into the first few seconds put its grip directly behind that text.
      if(live){ ctx.fillStyle=getCss("--edge"); ctx.fillRect(x-3,mT+ph-10,6,10); }
    });
    ctx.restore(); ctx.lineWidth=1;
  }
  updatePlotReadout(P);
}

/* ====================== pointer interaction ==================== */
// Every handler is bound to ONE panel and works on that panel, which is the whole answer to "how does the
// analyzer know which curve I mean": you clicked it. Touching a panel also makes it active, so the shared
// toolbar and the readout follow the plot under the student's hand rather than a mode they have to set.
function pxToTime(P,clientX){ const r=P.cv.getBoundingClientRect(); const {mL,mR,tLo,tHi}=P.G; const W=P.cv.clientWidth;
  if(!(tHi>tLo)) return 0;
  return Math.max(tLo,Math.min(tHi, tLo+((clientX-r.left)-mL)/(W-mL-mR)*(tHi-tLo))); }
function timeToPx(P,t){ const {mL,mR,tLo,tHi}=P.G, W=P.cv.clientWidth;
  return mL+(t-tLo)/((tHi-tLo)||1)*(W-mL-mR); }
const GRAB_PX=9;   // how close to a crop bound counts as grabbing it rather than starting a new one
function wirePointer(P){
  P.cv.addEventListener("pointerdown",e=>{
    S.activeIdx=P.i;
    if(!P.ds) return;
    P.cv.setPointerCapture(e.pointerId);
    const t=pxToTime(P,e.clientX);
    if(S.tool==="crop"){
      // Grab whichever bound is under the cursor; failing that, start a fresh window from here. The
      // bounds are initialized to the full extent when the tool is picked (see the tools handler), so
      // there is always something to take hold of — a student never has to guess that dragging works.
      const px=e.clientX-P.cv.getBoundingClientRect().left;
      let which=null;
      if(P.crop){
        const da=Math.abs(px-timeToPx(P,P.crop.a)), db=Math.abs(px-timeToPx(P,P.crop.b));
        if(Math.min(da,db)<=GRAB_PX) which = da<=db ? "a" : "b";
      }
      // Absolute pointer mapping: the axis is fixed, so the bound simply sits under the cursor.
      if(which) P.drag={crop:which};
      else { P.crop={a:t,b:t}; P.drag={crop:"b"}; }   // drag out a fresh region
      render(); return;
    }
    if(S.tool==="point"){ P.point=t; P.drag={pt:true}; render(); setReadout(); }
    else { P.drag={t0:t}; P.sel={a:t,b:t}; if(S.tool==="dblint"||S.tool==="integrate") P.integ=null; if(S.tool==="fitsine") P.fit=null; render(); setReadout(); }
  });
  P.cv.addEventListener("pointermove",e=>{
    if(!P.drag) return;
    if(P.drag.crop){ P.crop[P.drag.crop]=pxToTime(P,e.clientX); render(); return; }
    if(P.drag.pt){ P.point=pxToTime(P,e.clientX); render(); setReadout(); return; }   // Select Point: live drag
    P.sel={a:P.drag.t0,b:pxToTime(P,e.clientX)};
    const s=series(P); if(S.tool==="dblint"||S.tool==="integrate") doIntegrate(s,P); if(S.tool==="fitsine"){ doFitSine(s,P); syncFitControls(); } render(); setReadout();
  });
  P.cv.addEventListener("pointerup",e=>{
    if(!P.drag) return;
    if(P.drag.crop){
      const s=series(P);
      // a bound dragged onto its twin is a reset, not a zero-width window — the same "never mind"
      // gesture the selection tools already use
      if(s && Math.abs(P.crop.b-P.crop.a) < 0.01*fullSpan(s)) P.crop={a:s.t[0],b:s.t[s.t.length-1]};
      P.drag=null; render(); setReadout(); return;
    }
    if(P.drag.pt){ P.drag=null; return; }
    const t=pxToTime(P,e.clientX);
    if(Math.abs(t-P.drag.t0)<1e-3){ P.sel=null; P.integ=null; P.fit=null; }
    else { P.sel={a:P.drag.t0,b:t}; if(S.tool==="dblint"||S.tool==="integrate") doIntegrate(series(P),P); if(S.tool==="fitsine"){ doFitSine(series(P),P); syncFitControls(); } }
    P.drag=null; render(); setReadout();
  });
}

/* ====================== tool switching ======================== */
document.querySelectorAll("#tools button").forEach(b=>b.addEventListener("click",()=>{
  S.tool=b.dataset.tool; document.querySelectorAll("#tools button").forEach(x=>x.classList.toggle("on",x===b));
  // Switching tools clears the MEASUREMENT state on every visible panel — but never the crop. A crop is
  // a viewing decision that outlives the tool that made it; clearing it here would throw the student
  // back to a flat line the instant they picked up Average Value to measure inside it.
  visiblePanels().forEach(P=>{ P.point=null; P.sel=null; P.integ=null; P.fit=null;
    if(S.tool==="crop" && !P.crop){ const s=series(P); if(s) P.crop={a:s.t[0],b:s.t[s.t.length-1]}; } });
  updateCtx(); resize(); setReadout(); updateFitLabel();
}));

/* ============================================================== */
/*  NARRATIVE DECK — Get Air (first-pass script; content is Daniel's to rewrite)  */
/* ============================================================== */
const LOCK_S = 60;   // seconds a wrong MC answer locks the choices, to force discussion (easy to tune)
// A step may override it with `lockSeconds:` — the pause is there to buy a discussion, so a question
// with nothing to discuss (Workshop 0's octopus, a pure trivia demo of the mechanic) should not cost
// a full minute. Set it per step in the manifest heading; omit it and the house 60 s applies.
// House-standard title-slide teaser: a full-screen reminder. (Workshop 0 overrides it with the download-phyphox
// prompt; only the first workshop tells students to install the app — later ones just remind them to go full-screen.)
const TEASER_FULLSCREEN = "<div style='text-align:left'>For the best experience, go <b>full-screen</b>:<br>press <b>F11</b> (<b>⌃⌘F</b> on a Mac).</div>";

/* A felt g-factor is `1 + a/g`, where `a` is the number the green box is showing RIGHT NOW. It is the
   one arithmetic step in this workshop the instrument can check for itself, and until 2026-09-03
   nothing did: the jump's g-factor box accepted anything from 1 to 8, so a student who typed their raw
   acceleration, dropped the `1 +`, or divided by the wrong thing walked into the punchline the whole
   workshop builds toward with a number that meant nothing. Same box, four more times, in the elevator.

   It reads the LIVE selection rather than a stored value because that is the only place the number
   exists — the average is a property of the drag, not an answer the student typed. If there is no live
   selection (they measured, moved on, and came Back) the check is silent: re-blocking a finished step
   on a drag the student has no reason to still be holding is a gate that punishes reviewing.

   The tolerance scales with the SIZE of the effect — 10% of (expected - 1), floored at 0.02 — because a
   jump reads about 2.0 and an elevator about 1.03, and no single absolute tolerance serves both. */
const G_STD = 9.8;
function gExpect(){
  const P=active(), s=series(P);
  if(!s||!P||!P.sel) return null;
  const av=average(s,P);
  return av==null ? null : {av:av, g:1+av/G_STD};
}
function hangExpect(){ return Number.isFinite(S.answers.tair) ? 9.8*Math.pow(S.answers.tair,2)/8*100 : null; }
function setTop(st){                                    // top region: analyzer tool, video, figure, big equation, title slide, or the pong game
  if(activePong){ activePong.stop(); activePong=null; }   // leaving a pong step tears the game down
  const tm=$("topmedia"), mode=st.top||"analyzer";
  if(mode==="pong"){                                    // the impulse/momentum Pong capstone (see makePong)
    tm.style.display="flex";
    tm.innerHTML='<div class="pong">'
      +'<div class="pong-main">'
      +  '<div class="pong-fieldwrap"><canvas class="pong-field"></canvas></div>'
      +  '<div class="pong-graphs"><canvas class="pong-fx"></canvas><canvas class="pong-mu"></canvas></div>'
      +'</div>'
      +'<div class="pong-side">'
      +  '<div class="pong-help"><b>Controls</b><br>Left paddle: <b>Q</b> / <b>A</b><br>Right paddle: <b>↑</b> / <b>↓</b><br><br>First to <b>5</b> wins.</div>'
      +  '<button class="pong-btn">Start game</button>'
      +'</div></div>';
    activePong = makePong(tm.querySelector(".pong"));
    return;
  }
  if(mode==="video"){
    // keep a looping clip playing UNINTERRUPTED across consecutive steps that show the same video
    // (e.g. the three units questions over the Pong clip) — don't rebuild it, or it restarts each Next.
    const cur=tm.querySelector("video.topvid");
    if(cur && cur.dataset.src===st.media){ tm.style.display="flex"; return; }
    tm.style.display="flex";
    tm.innerHTML='<div class="media-ph">Looping demo video plays here once added:<br>'+st.media+'</div>'
      +'<video class="topvid" data-src="'+st.media+'" src="'+st.media+'" autoplay loop muted playsinline onerror="this.style.display=\'none\'"></video>';
  } else if(mode==="figure"){
    tm.style.display="flex";
    tm.innerHTML='<img src="'+st.media+'" alt="">';
  } else if(mode==="html"){                             // arbitrary large HTML (e.g. an equation) — trusted, from the manifest
    tm.style.display="flex";
    tm.innerHTML='<div class="topcustom">'+(st.html||"")+'</div>';
  } else if(mode==="title"){                            // house-style title slide: teaser/title, optionally over a bg video
    tm.style.display="flex";
    // `fit:"cover"` on the step → full-bleed background (no letterbox, crops to the panel aspect).
    // Default (omit it) keeps the contain + 1.4× framing. See analyzer.css → video.titlebg.
    // `fit:"cover-top"` → the same full-bleed fill, anchored to the TOP of the frame instead of the
    // middle, for a clip whose subject is high up: Get Air's walk-in is a man jumping, so a centered crop
    // spends its whole budget on the gym floor and cuts the person out. See analyzer.css.
    const fitCls = st.fit==="cover" ? " cover" : st.fit==="cover-top" ? " cover covertop" : "";
    const bg = st.media ? '<video class="titlebg'+fitCls+'" src="'+st.media+'" autoplay loop muted playsinline onerror="this.style.display=\'none\'"></video>' : '';
    // House standard: the title teaser is a FULL-SCREEN reminder. A workshop overrides it (e.g. Workshop 0's
    // "download phyphox"), or sets teaser:"" to suppress it entirely.
    const teaser = (st.teaser!==undefined) ? st.teaser : TEASER_FULLSCREEN;
    // `strip:` — the shared MAE 2501 course map across the top of the walk-in slide, today's workshop
    // lit in house green. Same asset and geometry the class decks use (mae-2501-.../course-map/), so a
    // student sees the same object whether they walk into a lecture or a workshop.
    const strip = st.strip ? '<img class="coursestrip" src="'+st.strip+'" alt="Course map">' : '';
    // `caption:` — one small line under the big title, saying what the background clip IS. Deliberately
    // distinct from `attribution:`, which is the lower-left CREDIT (who shot it, plus the source URL a
    // lint gate insists on). A credit answers "whose is this"; a caption answers "what am I looking at".
    const caption = st.caption ? '<div class="wscaption">'+st.caption+'</div>' : '';
    tm.innerHTML = bg + strip + '<div class="titleslide'+(st.media?' overvid':'')+'">'
      +(teaser?'<div class="teaser">'+teaser+'</div>':'')
      +'<div class="wstitle">'+(st.title||"")+'</div>'+caption+'</div>';
  } else {
    tm.style.display="none"; tm.innerHTML=""; resize(); return;
  }
  // lower-left media credit (house style, duped from slide-suite): a small site icon + the handle/name.
  // Every external clip or figure that carries `attribution:` should also carry `source:` (the URL).
  if(st.attribution){
    const site = st.site || (/youtu\.?be/i.test(st.source||"") ? "youtube"
                 : /instagram/i.test(st.source||"") ? "instagram"
                 : /tiktok/i.test(st.source||"") ? "tiktok" : "web");
    const a=document.createElement("div"); a.className="attrib";
    // ICON_BASE, not a hard-coded suite path. The published copy of this deck lives at
    // <site>/workshop-N/ where `../../slide-suite/` is nothing at all, and the badge's `onerror`
    // hides a missing icon silently — so the attribution mark just quietly vanished on the web while
    // looking perfect on Daniel's disk. workshop_build.py sets window.__ICON_BASE; unset, this is
    // exactly the path it always was. (Same lesson deck.js learned: resolve at RUNTIME, never patch
    // one file's string from another file's build step.)
    const iconBase = (typeof window!=="undefined" && window.__ICON_BASE) || "../../slide-suite/engine/icons/";
    a.innerHTML='<img alt="" src="'+iconBase+site+'.svg" onerror="this.style.display=\'none\'"><span>'+st.attribution+'</span>';
    tm.appendChild(a);
  }
  typesetMath(tm);
}
// a step's numeric fields, normalized: supports one `input`/`key` (legacy) or an `inputs:[...]` array.
function fieldsOf(st){ return st.inputs ? st.inputs : (st.input ? [{label:st.input,key:st.key,unit:st.unit,range:st.range,dp:st.dp}] : []); }
// mean / population std helpers + a loose stats-consistency check (3-sample std is noisy → accept sample or
// population, wide tolerance; low-stakes, just catches nonsense like entering 0 or the mean for the spread).
function _mean(a){ return a.reduce((x,y)=>x+y,0)/(a.length||1); }
function _std(a){ const m=_mean(a); return Math.sqrt(a.reduce((x,y)=>x+(y-m)*(y-m),0)/(a.length||1)); }
// `dp` is the precision the QUANTITY is reported to (see WORKSHOP-DESIGN.md -> "Report to the
// precision you measured"). It was a hardcoded 2 everywhere, which quoted g's one digit short of
// what their own boxes now demand and impulses two digits finer than they can be known.
function _statIssue(st, vals, meanAns, stdAns, label, dp){
  if(dp == null) dp = 2;
  if(vals.some(v=>!Number.isFinite(v))) return null;         // an upstream input isn't in yet — don't block here
  const m=_mean(vals), sdP=_std(vals);
  const sdS=vals.length>1?Math.sqrt(vals.reduce((x,y)=>x+(y-m)*(y-m),0)/(vals.length-1)):sdP;   // sample std (accept either)
  if(Number.isFinite(meanAns) && Math.abs(meanAns-m) > Math.max(0.2*Math.abs(m),0.05))
    return fbText(st,"check","Your mean {label} looks off — average your {n} values again.",
              {label:label, n:vals.length, expected:m.toFixed(dp)});
  const near=Math.min(Math.abs(stdAns-sdP),Math.abs(stdAns-sdS));
  if(Number.isFinite(stdAns) && near > Math.max(sdP,sdS,0.1*Math.abs(m),0.1))
    return fbText(st,"check","Your standard deviation of {label} looks off — check the spread of your {n} values.",
              {label:label, n:vals.length, expected:sdP.toFixed(dp)});
  return null;
}
/* ------------------ tool-verified inputs (`verify:` on a step) ------------------
   A number a student types is normally taken on trust, which is right for most of them: the whole
   point of "read the peak off your own trace" is that only they can. But a value the TOOL also
   computed is different — Workshop 0's Fit Sine R² was a box you could put 0.999 in without ever
   dragging a selection, and it seeded the challenge high score, so the one competitive thing in the
   workshop was the one thing nobody had to earn.

   No workshop declares `verify:` as of 2026-08-27 — Workshop 0's fit-two-ways step dropped the gate
   (it was misfiring) and the two R² boxes are back on trust. The mechanism below stays for the next
   workshop that wants it.

   `verify: r2` on a step says: every number entered here must match what the tool is showing, to the
   three decimals the readout displays, AT THE MOMENT IT IS TYPED. That last part is what makes it work
   across the two-fit step — the free fit and the locked fit cannot both be on screen at once, so
   checking on Next could only ever validate whichever was last. Instead each entry is witnessed as it
   lands, and the witness sticks: do the free fit, type its R²; lock the target, type that one; both
   are true, both are recorded. Type either without a live fit and neither is.

   Not a cheating countermeasure so much as a wiring check — the honest failure it catches most often
   is a student typing the number from the wrong fit, or from their neighbor's screen. */
const VERIFY_SOURCES = {
  r2: function(){ const P=active(); return (P && P.fit && Number.isFinite(P.fit.r2)) ? P.fit.r2 : null; }
};
function verifyLive(st){
  const src = st && st.verify ? VERIFY_SOURCES[st.verify] : null;
  return src ? src() : null;
}
// Called on every keystroke in a verified input. Records whether the typed value was true when typed.
function witness(st, key, v){
  if(!st.verify) return;
  const live = verifyLive(st);
  const ok = live!=null && Number.isFinite(v) &&
             (Math.abs(v-live) <= 0.0006 || v.toFixed(3) === live.toFixed(3));
  if(ok) S.answers["seen_"+key] = live; else delete S.answers["seen_"+key];
}
/* `dp:` ON AN INPUT — exactly this many decimal places, no more and no fewer (2026-09-04).

   Students report far too many digits, and the fix is not a lecture on error propagation: it is a
   number per box, chosen from what the instrument actually gives, with a one-line reason in the prose
   beside it ("the capture is 100 Hz, so give the time to 2 decimal places").

   WHY DECIMALS RATHER THAN SIGNIFICANT FIGURES. The uncertainty on these quantities is absolute, not
   relative. phyphox's acceleration is good to about ±0.005 m/s², so 1 + a/g is good to ±0.0005 — which
   makes 1.032 (4 s.f.) and 0.971 (3 s.f.) equally right and equally precise. A significant-figure rule
   would accept one and reject the other for no physical reason. Decimal places is the rule that matches
   the physics here, and it is also the rule a first-year can apply without being taught propagation.

   IT COUNTS THE TYPED STRING, NOT THE NUMBER, and that is the whole mechanism: `0.30` and `0.3` parse
   to the same Number, and trailing zeros are exactly what is being asked for. `S.raw[key]` holds what
   is in the box; everything else still runs off the parsed value. */
function decimalsOf(raw){
  const m = String(raw == null ? "" : raw).trim().match(/^[+-]?\d*\.(\d*)$/);
  if(m) return m[1].length;
  return /^[+-]?\d+\.?$/.test(String(raw).trim()) ? 0 : null;   // an integer (or "5.") is 0 dp
}

// one place for all input validation; returns a gentle message if something's off, else null.
// Assumes good faith — a bad value usually means a misread question, not gaming.
function inputIssue(st){
  const fields=fieldsOf(st);
  for(const f of fields){
    const v=S.answers[f.key];
    // `hint.input` replaces THIS message only — the nothing-entered-yet one. The range and checkKind
    // messages below are computed from what the student actually typed, so they are always more useful
    // than any fixed string a manifest could carry and are never overridden.
    if(!Number.isFinite(v)) return fbText(st,"empty",
      fields.length>1 ? "Enter every value before moving on." : "Enter your value before moving on.");
    if(st.verify && S.answers["seen_"+f.key]==null){
      const live = verifyLive(st);
      // `{live}` has to read as a sentence in BOTH cases, because an authored override replaces the
      // whole string and will not have two branches. "nothing yet" is what the plot is honestly
      // showing when no selection has been dragged; an empty token there rendered as a bare "()".
      return fbText(st,"verify",
        "That doesn't match what the tool is showing ({live}). Read the value off the plot and enter that.",
        {source:st.verify, live: live==null ? "nothing yet" : live.toFixed(3), label:f.label});
    }
    if(f.range){
      const V={label:f.label, unit:f.unit||"", low:f.range[0], high:f.range[1]};
      // A NEGATIVE answer to a question that cannot have one is a different mistake from a small one,
      // and `low` was answering both with "that looks too small to be right" — which is true and
      // useless. Almost always it is a subtraction run backwards (Get Air: t_land − t_takeoff typed the
      // other way round), and naming that is the whole of the help. Only fires where the declared range
      // is non-negative, so a step that legitimately expects a negative number is untouched.
      if(v<0 && f.range[0]>=0) return fbText(st,"negative",
        "That came out negative, and this quantity cannot be. Check the order you subtracted in.",V);
      if(v<f.range[0]) return fbText(st,"low","That value looks too small to be right — re-read the question, check your units, and try again.",V);
      if(v>f.range[1]) return fbText(st,"high","That value looks too large to be right — re-read the question, check your units, and try again.",V);
    }
    // Precision LAST among the per-field checks: a number that is out of range is wrong in a way that
    // matters more than how it is written, and hearing about the decimals first would be noise.
    if(f.dp != null){
      const got = decimalsOf(S.raw ? S.raw[f.key] : null);
      if(got != null && got !== f.dp){
        const V2 = {label:f.label, unit:f.unit||"", dp:f.dp, got:got,
                    rounded: Number.isFinite(v) ? v.toFixed(f.dp) : ""};
        return fbText(st, "dp", got > f.dp
          ? "That is more precision than the measurement supports — give it to exactly {dp} decimal place(s), so {rounded}."
          : "Give this one to exactly {dp} decimal place(s) — you measured that digit, so don't drop it.", V2);
      }
    }
  }
  if(st.checkKind==="hang"){
    const exp=hangExpect(), v=S.answers[st.key];
    if(exp!=null && Math.abs(v-exp)/Math.max(exp,1)>=0.2){
      const dir = v<exp ? "higher" : "lower";
      return fbText(st,"check","Hmm — with a time aloft of {tair} s, you should be calculating a {dir} peak height. Re-check your formula and arithmetic.",
                {expected:exp.toFixed(0), tair:S.answers.tair, dir:dir});
    }
  }
  if(st.checkKind==="gfactor"){
    const E=gExpect(), v=S.answers[st.key];
    if(E && Number.isFinite(v)){
      const tol=Math.max(0.02, 0.10*Math.abs(E.g-1));
      if(Math.abs(v-E.g)>tol)
        return fbText(st,"check","That doesn't match the plot — the green box reads {avg} m/s2, so 1 + a/g is about {expected}.",
                  {expected:E.g.toFixed(3), avg:E.av.toFixed(2)});
    }
  }
  if(st.checkKind==="peaks"){                          // three peaks in a row → times must increase
    const {t1,t2,t3}=S.answers;
    if(!(t1<t2 && t2<t3)) return fbText(st,"check","Your three peak times should increase left to right — pick three peaks in a row and read them in order.");
  }
  if(st.checkKind==="period"){                         // τ should match the mean peak-to-peak gap
    const {t1,t3,tau}=S.answers;
    if(Number.isFinite(t1)&&Number.isFinite(t3)&&t3>t1){
      const exp=(t3-t1)/2;                             // two gaps between three peaks, averaged
      if(Math.abs(tau-exp)/Math.max(exp,0.1)>=0.25)
        return fbText(st,"check","Check your arithmetic — average the two peak-to-peak gaps. With your peak times that's about {expected} s.",
                  {expected:exp.toFixed(2)});
    }
  }
  if(st.checkKind==="posfromacc"){                     // ẍ = (π²/2)sin(πt) → position: 1 m peak-to-peak, τ = 2 s
    const pp=S.answers.pp, tau=S.answers.tau_pos;
    if(Math.abs(pp-1)>0.12 || Math.abs(tau-2)>0.25)
      return fbText(st,"check","Not quite. Integrate the acceleration twice to get position — and don't forget the chain rule when you integrate sin(πt). The amplitude and period of x(t) are what we're after.");
  }
  if(st.checkKind==="gstats"){                         // felt g's: |peak|/g, mean & std for the two kinds of push
    const A=S.answers;                                 // G_STD, not a second local copy of g
    const P=[A.ap1,A.ap2,A.ap3].map(v=>Math.abs(v)/G_STD), W=[A.aw1,A.aw2,A.aw3].map(v=>Math.abs(v)/G_STD);
    return _statIssue(st, P, A.gp_mean, A.gp_std, "g's (human)", 3) || _statIssue(st, W, A.gw_mean, A.gw_std, "g's (wall)", 3);
  }
  if(st.checkKind==="impulse"){                        // impulse must be m·Δv, not the bare integral — the mass must appear
    const A=S.answers, m=A.m_sys;
    if(Number.isFinite(m)&&m>0){
      for(const k of ["Jp1","Jp2","Jp3","Jw1","Jw2","Jw3"]){
        const J=A[k]; if(!Number.isFinite(J)) continue; const dv=J/m;
        if(dv<0.1) return fbText(st,"check","Impulse is m·Δv — it looks like you entered just the integrated Δv. Multiply each by the mass you recorded ({mass} kg).",{mass:m});
        if(dv>6) return fbText(st,"check","That impulse implies an unrealistic speed change (>6 m/s) for one push — re-check the integrate window and the mass.");
      }
    }
  }
  if(st.checkKind==="impstats"){                       // impulses: mean & std for partner and wall pushes
    const A=S.answers;
    return _statIssue(st, [A.Jp1,A.Jp2,A.Jp3], A.Jp_mean, A.Jp_std, "impulse (human)", 0)
        || _statIssue(st, [A.Jw1,A.Jw2,A.Jw3], A.Jw_mean, A.Jw_std, "impulse (wall)", 0);
  }
  return null;
}
// A step may combine gates (e.g. the load step gates on BOTH a data file and a mass input), so every
// applicable condition must pass — no early-return-true on the first satisfied one.
// Both data gates are ALL-of, over the slots the step shows: a two-plot load step where one picker is
// still empty is not a loaded step, and a crop step where only the top ride has been trimmed leaves the
// bottom one a flat line the student is about to try to measure.
function allVisible(fn){ const v=visiblePanels(); return v.length ? v.every(fn) : false; }
function stepComplete(i){
  const st=NARR[i];
  if(st.code && S.answers["code"+i]!==true) return false;                 // passcode / access code
  if(st.gate==="data" && !allVisible(P=>!!P.ds)) return false;            // must have loaded a phyphox file
  if(st.gate==="crop" && !allVisible(isCropped)) return false;            // must have trimmed the view
  if((st.check||st.checkFn) && S.answers["q"+i]==null) return false;     // set only on a correct pick
  // Typed answers. The VALUES always have to be sane (`inputIssue`, the length floor). The extra
  // requirement — that the student pressed Enter and read what came back — applies only on a step that
  // has something to tell them, which is what `wantsSubmit` decides. `ok<step>` is set by that button
  // and cleared the moment any value changes, the same shape as `code<step>` and `q<step>`.
  const needsOk = wantsSubmit(st);
  if((st.input||st.inputs) && (inputIssue(st)!==null || (needsOk && S.answers["ok"+i]!==true))) return false;
  if(st.text && ((S.answers[st.text.key]||"").trim().length < (st.text.minLen||1)
                 || (needsOk && S.answers["ok"+i]!==true))) return false;    // freeform text
  return true;
}
// Next is never DISABLED, only dimmed. Clicking a dimmed Next puts blockReason() in the feedback box,
// which is the one moment a student is definitely reading — disabling the button would throw that away
// and leave them clicking a dead control with no idea why. The dim is so they can see it is not their
// aim that is off. Ungated sessions (an INSTRUCTOR build, or TEACHER MODE) never dim it.
function refreshNext(){
  const b=$("next");
  if(!b) return;
  b.classList.toggle("locked", !(ungated() || stepComplete(S.step)));
}

/* ------------------------- TEACHER MODE (the clerk override) -------------------------
   The self-checkout clerk key. **Type the password** anywhere in a deck — no modifiers, no dialog —
   and every gate opens with a TEACHER MODE badge in the corner. Type it again to leave.

   Why a typed word and not a chord. ⌃⌥⇧T was the first version and it was the wrong shape for a room
   full of borrowed laptops: modifier chords differ across Mac and PC, some keyboards and remappers eat
   them, and a few OSes claim them before the page ever sees the event. A plain sequence of letters
   behaves identically on every keyboard ever made. It also collapses two secrets into one — there is no
   dialog to open, so the password IS the gesture, and there is only one thing to remember.

   Accidental discovery is not a real risk: it has to be typed while no text box has focus, and the only
   typing a student does in a deck happens inside one. Home-row chords like d+f+g+h were considered and
   rejected for exactly the opposite reason — that is where hands REST.

   It is hashed the same way as the step passcodes, so the word is not sitting in view-source. Be clear
   about what that does and does not buy: it hides the WORD, not the gate. The check runs on the
   student's own machine, cyrb53 is a fast non-cryptographic hash a browser could brute-force through a
   dictionary in well under a second, and anyone who opens devtools can call setTeacher(true) — or just
   set S.step — without a password at all. The point is a curious student reading the file does not find
   "clerk" written in it. Real gating would need a server, and the thing being protected is the right to
   skip ahead in a participation-graded workshop.

   CHANGE THE PASSWORD by replacing the number below — regenerate with
   `node -e '<the cyrb53 body from this file>; console.log(codeHash("yourword"))'`. */
const TEACHER_HASH = 8234105873185065;   // type this word, unmodified, anywhere in the deck. See above to change it.
const TEACHER_MAXLEN = 24;     // longest password we will look for in the rolling buffer
let TEACHER = false;
function ungated(){ return INSTRUCTOR || TEACHER; }
function setTeacher(on){
  TEACHER = !!on;
  let badge=$("teacherbadge");
  if(TEACHER && !badge){
    badge=document.createElement("div"); badge.id="teacherbadge";
    badge.textContent="TEACHER MODE";
    badge.title="All gates open. Type the password again to leave.";
    document.body.appendChild(badge);
  } else if(!TEACHER && badge){ badge.remove(); }
  renderStep();          // the sample-data button appears/disappears with the mode
  refreshNext();
}
let teacherBuf="";
document.addEventListener("keydown",e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;              // a shortcut is not someone typing a word
  const tag=(document.activeElement||{}).tagName||"";
  if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA") return;   // they are answering, not unlocking
  if(e.key.length!==1) return;                            // arrows, Enter, Escape and friends
  teacherBuf=(teacherBuf+e.key).slice(-TEACHER_MAXLEN);
  // Test every trailing slice, because the password's LENGTH is secret too — storing it beside the hash
  // would tell a reader how long a word to guess. Two dozen cheap hashes per keystroke costs nothing.
  for(let n=2;n<=teacherBuf.length;n++){
    if(codeHash(teacherBuf.slice(-n))===TEACHER_HASH){
      teacherBuf=""; setTeacher(!TEACHER); return;
    }
  }
},true);
// What the feedback box says while a step is still gated. Every line here is a HOUSE DEFAULT, and every one
// of them is replaceable per step from the manifest with `feedback.<situation>: …` — see fbText() below.
// A generic "Enter your value before moving on." is a wasted chance to say the ONE thing the student is
// actually missing.
function hintFor(st, situation){
  // `feedbackWhen:` is the field; `hint:` is what it was called before the vocabulary was unified and
  // is still read, as an object or as the bare string it used to be allowed to be.
  const h = st.feedbackWhen || st.hint;
  if(h == null) return null;
  if(typeof h === "string") return h;                       // legacy: a bare `hint:` string
  if(h[situation] != null) return h[situation];
  if(situation === "empty" && h.input != null) return h.input;   // `hint.input:` is `feedback.empty:`
  if(h.any != null) return h.any;                           // the catch-all, `feedback.any:`
  return null;
}
/* EVERY line a student reads when something is wrong comes through here, and every one of them can be
   replaced from the manifest with `feedback.<situation>: …`. Before this, `feedback:` (the correct
   answer's line) was the only feedback text an author could write; the rest — out of range, the
   `checkKind` validators, a wrong multiple-choice pick — were strings buried in this file, which meant
   the interesting half of the teaching was the half you could not edit where the workshop lives.

   The house default stays the default. An override only wins where one is written, so a step says
   nothing until it has something better to say than the generic line.

   `{expected}` is why this takes a `vars` argument. Several defaults compute a number from what the
   student actually typed — "that's about 2.03 s" — and a fixed manifest string would have thrown that
   away. The token carries it into the override instead, so an author can be both specific AND
   arithmetic. Interpolation runs on the DEFAULT too, so the two are written the same way. */
function fbText(st, situation, fallback, vars){
  let text = hintFor(st, situation);
  if(text == null) text = fallback;
  if(text == null) return null;
  if(vars) Object.keys(vars).forEach(k=>{
    text = text.split("{"+k+"}").join(vars[k]);
  });
  return text;
}
// DOES THIS STEP HAVE AN ENTER BUTTON? The rule is: a button exists to deliver feedback, so a step
// gets one exactly when it has feedback to deliver — i.e. when it carries its own `> …` line that no
// multiple-choice question has already claimed.
//
// The distinction is real and it is the author's to make, not a tool's. Some steps have a right
// answer worth explaining (solve the ODE; compute the period from your peaks) — press Enter, find out,
// read why. Others just ask you to go do something and write down what you got: reading three peaks
// off your own trace, or a reflection paragraph. There is no correct answer there, so the only
// feedback a button could give is "good job, you used the boxes", which is noise. Those gate on the
// boxes being filled and unlock the moment they are.
//
// Range and `checkKind` checks still apply to BOTH kinds — they are sanity checks, not scoring. A
// student who reads their three peaks out of order still finds Next dark, and clicking it still says
// why. What changes is only whether there is a button in the way first.
function submitFb(st){ return (!(st.check||st.checkFn) && st.feedback) || null; }
function wantsSubmit(st){ return !!(submitFb(st) && (st.input||st.inputs||st.text)); }
// What the feedback box says when a step's Enter is pressed and everything checks out. A step whose
// ONLY interaction is typing gets its `> …` line here — the same field the multiple-choice steps use
// for "you got it, and here's WHY", and a field that was simply dead on an inputs step until now. A
// step that ALSO asks a multiple-choice question keeps `> …` for that question and takes the house
// default here, so the explanation stays attached to the answer it was written about.
function passFb(st){
  return "✓ " + (submitFb(st) || "That works — click <b>Next ›</b>.");
}
function blockReason(i){
  const st=NARR[i];
  if(st.code && S.answers["code"+i]!==true) return fbText(st,"code",st.code.wrong || "Enter the code to continue.");
  if(st.gate==="data" && !allVisible(P=>!!P.ds)) return fbText(st,"data",
    visiblePanels().length>1 ? "Both plots need a file — use the picker above each one."
                             : "Load your phyphox export (top-left) before moving on.");
  if(st.gate==="crop" && !allVisible(isCropped)) return fbText(st,"crop",
    "Click <b>Crop</b> and drag the amber bounds inward"+(visiblePanels().length>1?" on both plots":"")+" before moving on.");
  if((st.input||st.inputs) && inputIssue(st)!==null) return inputIssue(st);   // already honours hint.input
  if(wantsSubmit(st) && S.answers["ok"+i]!==true){
    if(st.input||st.inputs) return "Press <b>Enter</b> to check your answer.";
    if((S.answers[st.text.key]||"").trim().length >= (st.text.minLen||1))
      return "Press <b>Enter</b> to submit what you wrote.";
  }
  if((st.check||st.checkFn) && S.answers["q"+i]==null) return fbText(st,"wrong","Pick the correct answer before moving on — talk it through.");
  if(st.text && (S.answers[st.text.key]||"").trim().length < (st.text.minLen||1)) return fbText(st,"text","Write a couple of sentences before moving on.");
  return "";
}
/* ---- the R² high-score colorbar (rendered into the deck feedback box on the challenge step) ---- */
function renderHighscore(fb){
  fb.classList.add("hswrap");
  fb.innerHTML='<div class="hs">'
    +'<div class="scorecol"></div>'
    +'<div class="barcol"><span style="color:#eb6235">1</span>'
    +  '<div class="hscol"></div>'
    +  '<span style="color:#5e81b5">&lt;0</span>'
    +  '<div class="hsarrow" id="hsarrow"><span class="hslab">High&nbsp;Score<br>R²&nbsp;=&nbsp;<b id="hsval">—</b></span></div>'
    +'</div>'
    +'<div class="labcol">'
    +  '<span style="color:#eb6235">let&rsquo;s&nbsp;go!</span>'
    +  '<span style="color:#c86a55">nice</span>'
    +  '<span style="color:#a57275">meh</span>'
    +  '<span style="color:#817995">womp&nbsp;womp</span>'
    +  '<span style="color:#5e81b5">yikes</span>'
    +'</div>'
    +'</div>';
  updateHighscore();
}

// answer:"any" — a reflection MC with no wrong answer (every choice is accepted); otherwise a single index
// or a list of acceptable indices.
function isCorrect(st,i){ return st.answer==="any" ? true : (Array.isArray(st.answer) ? st.answer.indexOf(i)>=0 : i===st.answer); }
// build the copy-out summary text from a step's `summary.lines` (tokens {file} and {answerKey} substituted).
// Tokens: `{file}` is the first slot's filename (the only one a single-panel workshop has), `{file_<slot>}`
// names any other slot — Get Air's summary lists the jump plus both elevator rides — and anything else is
// looked up in the student's answers.
function buildSummary(cfg){
  const sub = s => String(s).replace(/\{(\w+)\}/g, (m,k)=>{
    if(k==="file"){ const P=S.panels[0]; return (P&&P.fileName)||"(no file loaded)"; }
    if(k.indexOf("file_")===0){ const P=panelByKey(k.slice(5)); return (P&&P.fileName)||"(no file loaded)"; }
    return (S.answers[k]!=null && S.answers[k]!=="") ? S.answers[k] : "—";
  });
  return (cfg.lines||[]).map(sub).join("\n");
}
function renderStep(){
  if(S.lockTimer){ clearInterval(S.lockTimer); S.lockTimer=null; }
  const st=NARR[S.step], body=$("stepbody"); body.innerHTML="";
  setSlots(st);                                     // which data slots this step shows (default: the first)
  setTop(st);
  S.reqAxis = st.requireAxis || null;               // a step may require a signal axis (default-select, lock, gate scoring)
  if(S.reqAxis) preferAxis();
  applyAxisLock();
  // Fit Sine step config: pin the tool, and optionally lock amp/freq to a target (the challenge)
  if(st.tool==="fitsine"){
    S.tool="fitsine";
    document.querySelectorAll("#tools button").forEach(x=>x.classList.toggle("on",x.dataset.tool==="fitsine"));
    const wasLocked=!!S.fitLock;
    S.fitLock = st.lock ? {amp:st.lock.amp, freq:st.lock.freq} : null;
    if(st.lock && !wasLocked){ S.sel=null; S.fit=null; }   // enter the challenge fresh
    updateCtx(); resize(); setReadout(); updateFitLabel();
  } else if(S.fitLock){ S.fitLock=null; updateCtx(); }
  S.challenge = !!st.challenge;
  // Seed the challenge's best from the target fit — but ONLY the witnessed value, never the typed one.
  // Seeding from `S.answers.r2target` was the actual leak: the arrow started wherever the student said
  // it did. `seen_r2target` is what the tool computed when they typed, so the bar starts at a real fit.
  // 2026-08-27: Workshop 0 dropped `verify: r2`, so nothing witnesses r2target any more and the bar
  // simply starts at "—" until the student's first challenge fit. Left in place: it costs nothing and
  // is right again the moment a workshop verifies that step.
  if(S.challenge && S.hs.best==null){ const v=S.answers.seen_r2target; if(Number.isFinite(v)) S.hs.best=v; }
  const main=document.createElement("div"); main.className="deck-main";
  // lead may be static (`lead`) or computed from prior answers at render time (`leadFn(answers)`),
  // e.g. the gut-check reminding students of the g-factor difference they just measured.
  const prose=document.createElement("div"); prose.className="deck-prose";
  prose.innerHTML = (typeof st.leadFn==="function") ? st.leadFn(S.answers) : (st.lead||"");
  // TEACHER MODE's sample-data lever, on any step that gates on a file. Deliberately not permanent
  // furniture: a student who can see it will use it, and the workshop is about measuring your OWN wave.
  // It rides at the top of the prose, like the disclaimer banner, because it overrides the whole step.
  if(st.gate==="data" && ungated() && (typeof DEMO_CSV!=="undefined" && DEMO_CSV)){
    const row=document.createElement("div"); row.className="samplerow";
    const btn=document.createElement("button"); btn.className="deck-go"; btn.textContent="Load sample data";
    btn.addEventListener("click",()=>{ if(loadDemoData()){ btn.disabled=true; btn.textContent="Sample data loaded ✓"; } });
    row.appendChild(btn); prose.insertBefore(row, prose.firstChild);
  }
  // data-collection discomfort disclaimer (house component): true → default text, or a custom string.
  if(st.disclaimer){
    const d=document.createElement("div"); d.className="disclaimer";
    d.innerHTML = (typeof st.disclaimer==="string") ? st.disclaimer
      : "If you'd rather not run this with your own phone or body, tell a TA and we'll give you demo data to use for the whole lab — no penalty.";
    prose.insertBefore(d, prose.firstChild);
  }
  main.appendChild(prose);
  const fb=document.createElement("div"); fb.className="deck-fb"; fb.id="deckfb";   // always visible, empty until filled
  const setFb=h=>{ fb.innerHTML=h; typesetMath(fb); };
  const clearFb=()=>{ fb.innerHTML=""; };
  clearFb();

  // THE ENTER RITUAL. Typing a valid number used to unlock Next silently, which meant the feedback —
  // the part that teaches — was skippable by anyone who just clicked onward. Every step that asks a
  // student to type something now ends in one deliberate act: press Enter, read what comes back,
  // right or wrong. Multiple-choice steps already worked this way (click a choice, get the `>` line)
  // and passcode steps already had an Enter button; this brings the third kind of input into the
  // same ritual rather than inventing a fourth.
  const submit=()=>{
    const issue=(st.input||st.inputs) ? inputIssue(st) : null;
    if(issue){ S.answers["ok"+S.step]=false; setFb(issue); refreshNext(); return; }
    if(st.text && (S.answers[st.text.key]||"").trim().length < (st.text.minLen||1)){
      S.answers["ok"+S.step]=false;
      setFb(fbText(st,"text","Write a couple of sentences before moving on."));
      refreshNext(); return;
    }
    S.answers["ok"+S.step]=true;
    // A step can gate on more than one thing — the load step wants a file AND a mass. "✓ that works"
    // over a Next that is still dark would be the most confusing possible moment, so when something
    // else is outstanding, say what it is instead of congratulating them.
    setFb(stepComplete(S.step) ? passFb(st) : blockReason(S.step));
    refreshNext();
  };

  const checkQ = (typeof st.checkFn==="function") ? st.checkFn(S.answers) : st.check;
  let qEl=null;
  if(checkQ){
    const q=document.createElement("p"); q.innerHTML="<b>"+checkQ+"</b>"; prose.appendChild(q); qEl=q;
    const grid=document.createElement("div"); grid.className="deck-choices";
    const choiceEls=[];
    st.choices.forEach((c,i)=>{
      const d=document.createElement("div"); d.className="choice"; d.innerHTML='<span class="ci">'+choiceLabel(i)+')</span> '+c; choiceEls.push(d);
      d.addEventListener("click",()=>{
        if(d.dataset.locked==="1") return;
        if(isCorrect(st,i)){
          if(S.lockTimer){ clearInterval(S.lockTimer); S.lockTimer=null; }
          choiceEls.forEach((x,idx)=>{ x.classList.remove("wrong","locked"); x.dataset.locked="1";
            x.classList.add(isCorrect(st,idx)?"correct":"locked"); });   // light up EVERY correct choice
          S.answers["q"+S.step]=i; setFb("✓ "+st.feedback); refreshNext();   // the description appears only on a correct pick
        } else {
          d.classList.add("wrong");
          choiceEls.forEach(x=>{ x.dataset.locked="1"; x.classList.add("locked"); });
          d.classList.remove("locked");                              // keep the wrong pick readable in red
          let rem=Number.isFinite(st.lockSeconds)?st.lockSeconds:LOCK_S;
          const wrongMsg=fbText(st,"wrong","<b>Discuss for a minute</b>, then try again.");
          const paint=()=>setFb(wrongMsg+"<br><span style='color:var(--muted)'>"+rem+"s</span>");
          paint();
          if(S.lockTimer) clearInterval(S.lockTimer);
          S.lockTimer=setInterval(()=>{ rem--;
            if(rem<=0){ clearInterval(S.lockTimer); S.lockTimer=null;
              choiceEls.forEach(x=>{ x.dataset.locked=""; x.classList.remove("locked","wrong"); }); clearFb(); }
            else paint();
          },1000);
        }
      });
      grid.appendChild(d);
    });
    main.appendChild(grid);
    if(S.answers["q"+S.step]!=null){                                 // restore: light up every correct choice
      choiceEls.forEach((x,idx)=>{ x.dataset.locked="1"; x.classList.add(isCorrect(st,idx)?"correct":"locked"); });
      setFb("✓ "+st.feedback);
    }
  }

  const fields=fieldsOf(st);
  if(fields.length){
    const wrap=document.createElement("div"); wrap.className=fields.length>1?"inputs multi":"inputs";
    // FILL ORDER, and it is not cosmetic — it decides which two boxes a student reads as belonging
    // together. A full-width multi-input step is two GROUPS (Human Pong: partner down the left, wall
    // down the right), so it fills column-first. Inputs beside a FIGURE are PAIRS read against the
    // picture — (t₁, ẍ₁) is one gold dot on the diagram — so they fill row-first, one peak per row.
    // Column-first there put t₂ under ẍ₁ and started the second column on ẍ₂, splitting every pair.
    if(fields.length>1 && !st.figure) wrap.style.gridTemplateRows="repeat("+Math.ceil(fields.length/2)+",auto)";
    if(fields.length>1 && st.figure) wrap.classList.add("byrow");
    fields.forEach(f=>{
      const row=document.createElement("div"); row.className="inrow";
      row.innerHTML='<label>'+f.label+':</label><input type="number" step="any" style="width:88px"> <span class="unit">'+(f.unit||"")+'</span>';
      const inp=row.querySelector("input");
      if(S.answers[f.key]!=null) inp.value=S.answers[f.key];
      // `input`, not `change`: `change` only fires on blur, so a student who retyped a number and
      // reached straight for Enter was being judged on the previous one. Editing any value RETRACTS
      // the submission — what they had checked is not what is in the boxes any more.
      if(S.raw && S.raw[f.key] != null) inp.value = S.raw[f.key];   // restore what they TYPED, zeros and all
      inp.addEventListener("input",()=>{
        S.answers[f.key]=parseFloat(inp.value);
        S.raw[f.key]=inp.value;                     // the string, for the `dp:` check — see decimalsOf()
        witness(st, f.key, S.answers[f.key]);       // was it true when they typed it?
        S.answers["ok"+S.step]=false; clearFb(); refreshNext(); });
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); submit(); } });
      wrap.appendChild(row);
    });
    // The Enter row is a SIBLING of the input grid, never a child of it. Inside, it inherits the grid's
    // placement: `.inputs.multi` flows column-first with an explicit row count, so a `grid-column:1/-1`
    // row landed in the first cell and shoved every labeled field one column right — the button came
    // out to the LEFT of the first label. Outside, it sits under whichever of the three input layouts
    // the step happens to use, and none of them has to know about it.
    let goRow=null;
    if(wantsSubmit(st)){
      goRow=document.createElement("div"); goRow.className="submitrow";
      const goBtn=document.createElement("button"); goBtn.className="deck-go"; goBtn.textContent="Enter";
      goBtn.addEventListener("click",submit);
      goRow.appendChild(goBtn);
    }
    // WHERE the inputs go is a layout decision, and it turns on whether the step has a figure.
    // Without one, they belong under the prose that asks for them (every step before this behaved
    // that way and still does). WITH one, prose + figure + a 2-column input grid stacked in a single
    // full-width column is the arrangement that made Workshop 0's three-peaks step unreadable — the
    // diagram ended up the width of the deck and below the boxes it was meant to explain. So the
    // inputs become their own column, which is exactly the shape a figure + multiple-choice step
    // already takes (`.deck-choices`, appended to `main` a few lines up). Same rule, second consumer.
    if(st.figure){ wrap.classList.add("inputs"); const side=document.createElement("div");
                   side.className="deck-side"; side.appendChild(wrap);
                   if(goRow) side.appendChild(goRow); main.appendChild(side); }
    // A step that MEASURES and then ASKS puts the boxes above the question, not below it. Get Air's four
    // elevator steps each read a number off the trace and then ask which way the g's pushed, and appending
    // the inputs last put the question between the instruction and the box it was asking about — you read
    // "which way are the g's pushing?", then hit a field labeled "average z̈", and have to scroll back up
    // to work out which one you were meant to do first. Do the measurement, then answer about it.
    else if(qEl){ prose.insertBefore(wrap,qEl); if(goRow) prose.insertBefore(goRow,qEl); }
    else { prose.appendChild(wrap); if(goRow) prose.appendChild(goRow); }
    if(goRow && S.answers["ok"+S.step]===true) setFb(passFb(st));   // a step you already cleared
  }

  if(st.text){                                        // freeform text step (gated only on min length — not content)
    const wrap=document.createElement("div"); wrap.className="textarea-wrap";
    if(st.text.label){ const l=document.createElement("label"); l.textContent=st.text.label; wrap.appendChild(l); }
    const ta=document.createElement("textarea"); ta.rows=st.text.rows||4;
    ta.placeholder=st.text.placeholder||"Type a couple of sentences…";
    if(S.answers[st.text.key]) ta.value=S.answers[st.text.key];
    ta.addEventListener("input",()=>{ S.answers[st.text.key]=ta.value;
      S.answers["ok"+S.step]=false; clearFb(); refreshNext(); });
    wrap.appendChild(ta);
    if(wantsSubmit(st)){
      const tRow=document.createElement("div"); tRow.className="submitrow";
      const tBtn=document.createElement("button"); tBtn.className="deck-go"; tBtn.textContent="Enter";
      tBtn.addEventListener("click",submit);
      tRow.appendChild(tBtn); wrap.appendChild(tRow);
      if(S.answers["ok"+S.step]===true) setFb(passFb(st));
    }
    prose.appendChild(wrap);
  }

  if(st.summary){                                     // copy-out summary: a read-only block + Copy button (the deliverable)
    const wrap=document.createElement("div"); wrap.className="summary-wrap";
    const ta=document.createElement("textarea"); ta.readOnly=true; ta.rows=st.summary.rows||9;
    ta.value=buildSummary(st.summary); wrap.appendChild(ta);
    const row=document.createElement("div"); row.className="summary-actions";
    const btn=document.createElement("button"); btn.textContent="Copy";
    const msg=document.createElement("span"); msg.className="copymsg";
    btn.addEventListener("click",()=>{ ta.select(); ta.setSelectionRange(0,ta.value.length);
      const done=()=>{ msg.textContent="Copied ✓"; };
      if(navigator.clipboard&&navigator.clipboard.writeText){ navigator.clipboard.writeText(ta.value).then(done,()=>{ try{document.execCommand("copy");done();}catch(e){} }); }
      else { try{document.execCommand("copy");done();}catch(e){} } });
    row.appendChild(btn); row.appendChild(msg); wrap.appendChild(row); prose.appendChild(wrap);
  }

  if(st.code){                                        // passcode / access-code gate (hashed; unlocks Next)
    const wrap=document.createElement("div"); wrap.className="coderow";
    wrap.innerHTML='<label>'+(st.code.label||"Access code")+'</label>'
      +'<input type="text" id="codein" autocomplete="off" spellcheck="false" placeholder="type it in">'
      +'<button id="codego">Enter</button>';
    prose.appendChild(wrap);
    const inp=wrap.querySelector("#codein"), btn=wrap.querySelector("#codego");
    const unlock=()=>{ inp.disabled=true; btn.disabled=true;
      setFb("✓ Unlocked — click <b>Next ›</b>."); refreshNext(); };
    if(S.answers["code"+S.step]===true){ inp.value="••••••••"; unlock(); }
    // `hash` may be ONE number or a LIST of them (2026-09-03). Workshop 1's elevator passcode is a
    // number the student works out — 18 — and "eighteen" is the same answer typed by someone who read
    // the question as a sentence rather than a form field. Accepting both costs one array and removes
    // the only failure mode of that gate that teaches nothing.
    const codeHashes = Array.isArray(st.code.hash) ? st.code.hash : [st.code.hash];
    const tryCode=()=>{ if(codeHashes.indexOf(codeHash(inp.value))>=0){ S.answers["code"+S.step]=true; unlock(); }
      else setFb(st.code.wrong||"That code isn't right — try again."); };
    btn.addEventListener("click",tryCode);
    inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); tryCode(); } });
  }
  if(st.figure){ const im=document.createElement("img"); im.className="deck-fig"; im.src=st.figure; im.alt=""; prose.appendChild(im); }
  body.appendChild(main);
  body.appendChild(fb);
  if(st.challenge) renderHighscore(fb);              // the R² colorbar lives in the feedback box on the challenge step
  $("prog").textContent="Step "+(S.step+1)+" / "+NARR.length;
  $("prev").disabled=S.step===0;
  $("next").style.display = (S.step===NARR.length-1) ? "none" : "";   // hide Next on the last step, don't just gray it
  refreshNext();
  typesetMath(body);
}
$("prev").addEventListener("click",()=>{ if(S.step>0){ S.step--; renderStep(); } });
$("next").addEventListener("click",()=>{
  if(S.step>=NARR.length-1) return;
  if(!ungated() && !stepComplete(S.step)){ if(!S.lockTimer){ const p=$("deckfb"); if(p) p.innerHTML=blockReason(S.step); } return; }
  S.step++; renderStep();
});
document.addEventListener("keydown",e=>{                 // ← / → drive Back / Next
  const tag=(document.activeElement||{}).tagName||"";
  if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA") return;
  if(e.key==="ArrowRight") $("next").click();
  else if(e.key==="ArrowLeft") $("prev").click();
});

/* ============================================================== */
/*  PONG — the impulse/momentum capstone (top:"pong")                                             */
/*  Two-player Atari-style Pong with a house pearl-disc ball. Paddle/wall contact is a BRIEF BUT   */
/*  FINITE impulse: the velocity along the contact axis ramps (smoothstep) over ~0.1 s, so the    */
/*  force F = m·dv/dt is a bell that grows then shrinks to nothing (the slide-suite `shrink` arrow */
/*  idiom). A green horizontal arrow shows paddle impulses; a green vertical arrow shows wall      */
/*  bounces. Two scrolling graphs below track ONLY the horizontal component: F_x(t) spikes at      */
/*  paddle hits, and m·v_x(t) is constant between hits and flips at each hit. Speed ramps every    */
/*  paddle hit (rising impulses/momentum swings). First to 5 wins. m=1 (qualitative units).        */
/* ============================================================== */
function makePong(root){
  const field=root.querySelector(".pong-field"), fxc=root.querySelector(".pong-fx"), muc=root.querySelector(".pong-mu");
  const btn=root.querySelector(".pong-btn");
  const fctx=field.getContext("2d"), xctx=fxc.getContext("2d"), mctx=muc.getContext("2d");
  const CSS=v=>{ const s=getComputedStyle(document.documentElement).getPropertyValue(v).trim(); return s||"#ccc"; };
  const PEARL="#f0f0f5";
  let W=0,H=0, R,PW,PH,PSPEED,SPEED0,SPEEDCAP,RAMP,kArr;
  const g={ ballX:0,ballY:0, vx:0,vy:0, lY:0,rY:0, sL:0,sR:0, state:"idle",
            cx:null, cy:null, Fx:0, Fy:0, mux:0, winner:null };
  const keys=new Set(); const bufFx=[], bufMu=[]; const WIN_S=6;
  let raf=null, last=null, running=true;

  function configure(){
    R=Math.max(5,0.018*H); PW=Math.max(3,0.01*W); PH=Math.max(1,0.18*H);   // paddles half-width
    SPEED0=0.45*H; SPEEDCAP=2.2*H; PSPEED=0.55*SPEED0; RAMP=1.5;            // +50%/hit → rallies escalate fast
    // arrow scale: at the first serve's speed a paddle-hit peak force ≈ 2·SPEED0·1.5/dur maps to ~0.22·H
    kArr = H>1 ? (0.22*H)/((2*SPEED0*1.5)/0.09 || 1) : 0;
    if(g.lY===0) g.lY=H/2; if(g.rY===0) g.rY=H/2;
    if(g.state==="idle"){ g.ballX=W/2; g.ballY=H/2; }
  }
  function setSize(w,h){ W=w; H=h; configure(); }               // (test hook — bypasses layout)
  function fit(cv){ const r=cv.getBoundingClientRect(), d=window.devicePixelRatio||1;
    cv.width=Math.max(1,r.width*d); cv.height=Math.max(1,r.height*d);
    cv.getContext("2d").setTransform(d,0,0,d,0,0); return [r.width||0, r.height||0]; }
  function resize(){ [W,H]=fit(field); fit(fxc); fit(muc); configure(); }

  function serve(){
    g.ballX=W*(1/3+Math.random()/3); g.ballY=H*(0.35+Math.random()*0.3);
    const dir=Math.random()<0.5?-1:1, up=Math.random()<0.5?-1:1;
    const th=(35+Math.random()*20)*Math.PI/180;                 // 35–55° from horizontal (never near flat/vertical)
    g.vx=dir*SPEED0*Math.cos(th); g.vy=up*SPEED0*Math.sin(th);
    g.cx=g.cy=null; g.Fx=g.Fy=0;
  }
  function startMatch(){ g.sL=0; g.sR=0; g.winner=null; g.state="playing"; bufFx.length=0; bufMu.length=0; serve(); updateBtn(); }
  function score(side){ if(side==="L")g.sL++; else g.sR++;
    if(g.sL>=5||g.sR>=5){ g.state="over"; g.winner=g.sL>=5?"L":"R"; updateBtn(); } else serve(); }
  function beginContact(axis,vTo,now){ const vFrom=axis==="x"?g.vx:g.vy;
    const c={vFrom,vTo,t0:now,dur:0.09}; if(axis==="x")g.cx=c; else g.cy=c; }
  function stepContact(c,now,setV){                             // smoothstep velocity ramp → bell-shaped force (m=1)
    const u=(now-c.t0)/c.dur;
    if(u>=1){ setV(c.vTo); return {F:0,done:true}; }
    const S=3*u*u-2*u*u*u, Sp=6*u-6*u*u;
    setV(c.vFrom+(c.vTo-c.vFrom)*S);
    return {F:(c.vTo-c.vFrom)*Sp/c.dur, done:false};
  }
  function update(dt,now){
    if(g.state!=="playing" || W<4 || H<4){ g.Fx=0; g.Fy=0; return; }
    if(keys.has("q")) g.lY-=PSPEED*dt; if(keys.has("a")) g.lY+=PSPEED*dt;
    if(keys.has("arrowup")) g.rY-=PSPEED*dt; if(keys.has("arrowdown")) g.rY+=PSPEED*dt;
    g.lY=Math.max(PH/2,Math.min(H-PH/2,g.lY)); g.rY=Math.max(PH/2,Math.min(H-PH/2,g.rY));
    g.Fx=0; g.Fy=0;
    if(g.cx){ const r=stepContact(g.cx,now,v=>g.vx=v); g.Fx=r.F; if(r.done)g.cx=null; }
    if(g.cy){ const r=stepContact(g.cy,now,v=>g.vy=v); g.Fy=r.F; if(r.done)g.cy=null; }
    g.ballX+=g.vx*dt; g.ballY+=g.vy*dt;
    // walls (top/bottom): vertical finite impulse, reverse vy
    if(!g.cy){
      if(g.ballY<R && g.vy<0){ g.ballY=R; beginContact("y",-g.vy,now); }
      else if(g.ballY>H-R && g.vy>0){ g.ballY=H-R; beginContact("y",-g.vy,now); }
    }
    // paddles (left/right): horizontal finite impulse, reverse vx + ramp overall speed
    const pxL=PW, pxR=W-PW;
    if(!g.cx && g.vx<0 && g.ballX-R<=pxL && Math.abs(g.ballY-g.lY)<=PH/2){
      g.ballX=pxL+R; const sp=Math.hypot(g.vx,g.vy), scale=Math.min(SPEEDCAP,sp*RAMP)/(sp||1);
      g.vy*=scale; beginContact("x", -g.vx*scale, now);
    } else if(!g.cx && g.vx>0 && g.ballX+R>=pxR && Math.abs(g.ballY-g.rY)<=PH/2){
      g.ballX=pxR-R; const sp=Math.hypot(g.vx,g.vy), scale=Math.min(SPEEDCAP,sp*RAMP)/(sp||1);
      g.vy*=scale; beginContact("x", -g.vx*scale, now);
    }
    if(g.ballX<-2*R) score("R"); else if(g.ballX>W+2*R) score("L");   // missed → point to the far side
    g.mux=g.vx;                                                        // m=1 ⇒ horizontal momentum ∝ vx
    bufFx.push({t:now,v:g.Fx}); bufMu.push({t:now,v:g.mux});
    while(bufFx.length&&now-bufFx[0].t>WIN_S) bufFx.shift();
    while(bufMu.length&&now-bufMu[0].t>WIN_S) bufMu.shift();
  }
  function arrow(x,y,dx,dy,F){
    const L=Math.min(0.32*H, kArr*F); if(L<1.5) return;
    const col=CSS("--mma-green"), ex=x+dx*L, ey=y+dy*L, hl=Math.min(0.4*L,0.05*H), hw=hl*0.55;
    fctx.strokeStyle=col; fctx.fillStyle=col; fctx.lineWidth=Math.max(2,0.006*H); fctx.lineCap="round";
    fctx.beginPath(); fctx.arc(x,y,Math.max(2,0.008*H),0,7); fctx.fill();
    const sx=x+dx*(L-hl), sy=y+dy*(L-hl);
    fctx.beginPath(); fctx.moveTo(x,y); fctx.lineTo(sx,sy); fctx.stroke();
    const px=-dy,py=dx;
    fctx.beginPath(); fctx.moveTo(ex,ey); fctx.lineTo(sx+px*hw,sy+py*hw); fctx.lineTo(sx-px*hw,sy-py*hw); fctx.closePath(); fctx.fill();
  }
  function drawScore(cx,val,win){ fctx.textAlign="center"; fctx.textBaseline="top";
    fctx.fillStyle=win?CSS("--mma-green"):PEARL; fctx.font="bold "+(0.16*H)+"px "+CSS("--font-mono");
    fctx.fillText(String(val),cx,0.05*H);
    if(win){ fctx.font="bold "+(0.05*H)+"px "+CSS("--font-sans"); fctx.fillText("Winner!",cx,0.05*H+0.18*H); } }
  function drawField(){
    if(W<2||H<2) return;
    fctx.clearRect(0,0,W,H); fctx.fillStyle="#0b0b0f"; fctx.fillRect(0,0,W,H);
    fctx.strokeStyle="#4a4a55"; fctx.lineWidth=2; fctx.setLineDash([H*0.03,H*0.022]);
    fctx.beginPath(); fctx.moveTo(W/2,0); fctx.lineTo(W/2,H); fctx.stroke(); fctx.setLineDash([]);
    drawScore(W*0.30,g.sL,g.winner==="L"); drawScore(W*0.70,g.sR,g.winner==="R");
    fctx.fillStyle=PEARL; fctx.fillRect(0,g.lY-PH/2,PW,PH); fctx.fillRect(W-PW,g.rY-PH/2,PW,PH);
    fctx.beginPath(); fctx.arc(g.ballX,g.ballY,R,0,7); fctx.fillStyle=PEARL; fctx.fill();
    if(Math.abs(g.Fx)>1e-6) arrow(g.ballX,g.ballY,Math.sign(g.Fx),0,Math.abs(g.Fx));
    if(Math.abs(g.Fy)>1e-6) arrow(g.ballX,g.ballY,0,Math.sign(g.Fy),Math.abs(g.Fy));
  }
  function drawGraph(ctx,cv,buf,color,label,now){
    const cw=cv.clientWidth||0, ch=cv.clientHeight||0; if(cw<2||ch<2) return;
    ctx.clearRect(0,0,cw,ch); const y0=ch/2;
    ctx.strokeStyle=CSS("--zero"); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(0,y0); ctx.lineTo(cw,y0); ctx.stroke();
    let ymax=1e-6; for(const p of buf) ymax=Math.max(ymax,Math.abs(p.v)); ymax*=1.15;
    const tx=t=>cw-((now-t)/WIN_S)*cw, vy=v=>y0-(v/ymax)*(ch*0.42);
    ctx.strokeStyle=CSS(color); ctx.lineWidth=1.75; ctx.beginPath();
    buf.forEach((p,i)=>{ const X=tx(p.t),Y=vy(p.v); i?ctx.lineTo(X,Y):ctx.moveTo(X,Y); }); ctx.stroke();
    ctx.fillStyle=CSS("--muted"); ctx.textAlign="left"; ctx.textBaseline="top";   // variable italic, descriptor roman
    const dash=label.indexOf(" — "), vpart=dash<0?label:label.slice(0,dash), rest=dash<0?"":label.slice(dash);
    ctx.font="italic 12px "+CSS("--font-sans"); ctx.fillText(vpart,7,5); const vw=ctx.measureText(vpart).width;
    ctx.font="12px "+CSS("--font-sans"); ctx.fillText(rest,7+vw,5);
  }
  function frame(ts){
    if(!running) return;
    const now=ts/1000; if(last==null)last=now; let dt=now-last; last=now; if(dt>0.033)dt=0.033;
    update(dt,now); drawField();
    drawGraph(xctx,fxc,bufFx,"--mma-green","Fₓ(t) — horizontal force on the ball",now);
    drawGraph(mctx,muc,bufMu,"--trace","m·vₓ(t) — horizontal momentum",now);
    raf=requestAnimationFrame(frame);
  }
  function updateBtn(){ btn.textContent = g.state==="playing"?"Reset game":(g.state==="over"?"Play again":"Start game"); }
  const onKD=e=>{ const k=e.key.length===1?e.key.toLowerCase():e.key.toLowerCase();
    if(k==="q"||k==="a"||k==="arrowup"||k==="arrowdown"){ keys.add(k); e.preventDefault(); } };
  const onKU=e=>{ const k=e.key.length===1?e.key.toLowerCase():e.key.toLowerCase(); keys.delete(k); };
  window.addEventListener("keydown",onKD); window.addEventListener("keyup",onKU);
  window.addEventListener("resize",resize);
  btn.addEventListener("click",startMatch);
  resize(); updateBtn();
  if(typeof requestAnimationFrame!=="undefined") raf=requestAnimationFrame(frame);
  return { stop(){ running=false; if(raf)cancelAnimationFrame(raf);
      window.removeEventListener("keydown",onKD); window.removeEventListener("keyup",onKU); window.removeEventListener("resize",resize); },
    // test hooks:
    g, setSize, serve, startMatch, update, bufFx, bufMu, keys, geom:()=>({R,PW,PH,PSPEED,SPEED0,SPEEDCAP,RAMP}) };
}

/* ============================ boot ============================ */
window.addEventListener("resize",resize);
updateCtx(); renderStep(); resize();
// Debug build: preload demo data. `DEMO_CSV` fills the FIRST slot (every workshop before slots existed had
// exactly one, and build_instructor.py still writes that global unchanged); `DEMO_CSVS` is an optional
// {slotKey: csv} map for the rest, so an instructor can jump straight to the elevator steps with both
// rides already on screen instead of hunting two files off disk every time the deck is rebuilt.
/* --------------------- the baked sample dataset ---------------------
   Every student deck carries a decimated copy of the workshop's demo run (`bake_demo.py` writes it;
   ~25 Hz, 3 decimals, a few KB gzipped instead of the 130 KB original). It is inert until something
   asks for it: an INSTRUCTOR build loads it on boot, and in TEACHER MODE a "Sample data" button
   appears on every step that gates on a file.

   That second use is the reason it lives in the STUDENT deck rather than a separate build. A pair who
   cannot collect their own data — a phone that will not export, a body they would rather not jump
   with, ten minutes left — gets the sample loaded on their own laptop and does the whole analysis for
   real. Before this the only copy of the data was in a file Daniel had on his machine. */
function loadDemoData(){
  let any=false;
  // fileName is set here too, not just in handleFile — the copy-out summary prints it, and anyone
  // checking that step wants to see something other than "(no file loaded)" under every heading.
  try{ if(typeof DEMO_CSV!=="undefined" && DEMO_CSV){
    S.panels[0].fileName="(sample data)"; ingestParsed(parseCSV(DEMO_CSV), S.panels[0]); any=true; } }catch(e){}
  try{ if(typeof DEMO_CSVS!=="undefined" && DEMO_CSVS) Object.keys(DEMO_CSVS).forEach(k=>{
    const P=panelByKey(k); if(P && DEMO_CSVS[k]){
      P.fileName="(sample data — "+(P.label||k)+")"; ingestParsed(parseCSV(DEMO_CSVS[k]),P); any=true; } }); }catch(e){}
  if(any){ render(); setReadout(); refreshNext(); }
  return any;
}
if(INSTRUCTOR) loadDemoData();

