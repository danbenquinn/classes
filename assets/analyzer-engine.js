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
const TOOLDEF={point:"Select Point", avg:"Average Value", integrate:"Integrate", dblint:"Double Integrate", fitsine:"Fit Sine", crop:"Crop", slope:"Slope"};
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
      // MathJax's accessibility menu makes every equation a tab stop (tabindex="0"), so Tab from one input
      // landed on the next input's LABEL (τ₂) instead of its box. Equations stay readable and clickable;
      // they just drop out of the tab order (Daniel, 2026-10-11).
      if(MJ.typesetPromise) MJ.typesetPromise([el]).then(()=>{
        el.querySelectorAll("mjx-container[tabindex]").forEach(m=>m.setAttribute("tabindex","-1")); }).catch(()=>{});
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
    updateCtx(); resize(); setReadout();
    if(typeof refreshNext==="function") refreshNext(); });   // a `gate:"abs"` step passes on this choice
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
let activeBallFit=null;            // re-sizes a top:"ball" card's ball to scale when the window changes

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
  if(S.reqAxis){ const want=nums.find(h=>axisRe(S.reqAxis).test(h)); if(want) pick=want; }
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
/* `sym` is what the plot's vertical axis IS, `unit` its unit, `rate` the unit of its slope, `dp` the
   decimals a reading of it may print. Every workshop before Sportsball plotted an acceleration, so the
   readouts said "m/s²" in five hardcoded places; Sportsball's radiosonde altitude is a POSITION (2026-10-08). A
   non-acceleration column is read from its own header, phyphox-style — "Height y (m)" gives y, m — so
   the instrument says what it is plotting rather than assuming. Acceleration columns are unchanged. */
function axisInfo(h){
  const DOT={x:"ẋ",y:"ẏ",z:"ż"}, DDOT={x:"ẍ",y:"ÿ",z:"z̈"};
  if(/absolute/i.test(h||"")) return {L:"r", dot:"ṙ", ddot:"|r̈|", sym:"|r̈|", unit:"m/s²", rate:"m/s³", dp:2};
  const m=(h||"").match(/acceleration\s*([xyz])/i);
  if(m){ const l=m[1].toLowerCase(); return {L:l, dot:DOT[l], ddot:DDOT[l], sym:DDOT[l], unit:"m/s²", rate:"m/s³", dp:2}; }
  const g=(h||"").match(/\b([A-Za-z])\s*\(([^)]+)\)\s*$/);
  if(g && !/acceleration/i.test(h)){ const l=g[1], u=g[2].trim();
    return {L:l, dot:DOT[l.toLowerCase()]||l, ddot:DDOT[l.toLowerCase()]||l, sym:l, unit:u, rate:u+"/s", dp:1}; }
  return {L:"x", dot:"ẋ", ddot:"ẍ", sym:"ẍ", unit:"m/s²", rate:"m/s³", dp:2};
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
// A named column out of a named slot, as {t,a} — for validators that check against SUPPLIED data.
function slotCol(key, re){
  const P=panelByKey(key); if(!P||!P.ds) return null;
  const h=P.ds.headers.find(x=>x!==P.ds.timeH && re.test(x)); if(!h) return null;
  const t=P.ds.cols[P.ds.timeH], a=P.ds.cols[h], T=[],A=[];
  for(let i=0;i<t.length;i++){ if(Number.isFinite(t[i])&&Number.isFinite(a[i])){T.push(t[i]);A.push(a[i]);} }
  return T.length?{t:T,a:A}:null;
}
function meanBetween(s,t0,t1){ const i0=nearest(s,Math.min(t0,t1)), i1=nearest(s,Math.max(t0,t1)); let sum=0; for(let i=i0;i<=i1;i++) sum+=s.a[i]; return sum/(i1-i0+1); }
function integrateBetween(s,t0,t1){ const i0=nearest(s,Math.min(t0,t1)), i1=nearest(s,Math.max(t0,t1)); let v=0; for(let i=i0+1;i<=i1;i++) v+=(s.a[i]+s.a[i-1])/2*(s.t[i]-s.t[i-1]); return v; }
function nearest(s,tq){ let lo=0,hi=s.t.length-1; if(tq<=s.t[0])return 0; if(tq>=s.t[hi])return hi;
  while(hi-lo>1){const m=(lo+hi)>>1; if(s.t[m]<tq)lo=m; else hi=m;} return (tq-s.t[lo]<s.t[hi]-tq)?lo:hi; }
function selRange(s,P){ P=P||active(); if(!P||!P.sel) return null;
  return [nearest(s,Math.min(P.sel.a,P.sel.b)), nearest(s,Math.max(P.sel.a,P.sel.b))]; }
function average(s,P){ const r=selRange(s,P); if(!r) return null; let sum=0; for(let i=r[0];i<=r[1];i++) sum+=s.a[i]; return sum/(r[1]-r[0]+1); }
// least-squares line through the selected window -> {m (slope), b (intercept), t0, t1}, or null (<3 samples)
function slopeFit(s,P){ const r=selRange(s,P); if(!r||r[1]-r[0]<2) return null;
  let n=0,st=0,sy=0,stt=0,sty=0; const t0=s.t[r[0]];
  for(let i=r[0];i<=r[1];i++){ const t=s.t[i]-t0, y=s.a[i]; n++; st+=t; sy+=y; stt+=t*t; sty+=t*y; }
  const den=n*stt-st*st; if(!(Math.abs(den)>0)) return null;
  const m=(n*sty-st*sy)/den, b0=(sy-m*st)/n;
  return {m:m, b:b0-m*t0, t0:t0, t1:s.t[r[1]]}; }
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
  // `CONFIG.integrate:"end-rest"` (Impulsive Behavior, 2026-09-11): the integration constant is chosen so the
  // velocity is ZERO AT THE END of the window instead of the start. A chair that has hit a wall, a car that
  // has crashed — what is known is that they finished at rest, so the green curve reads directly as the
  // object's velocity through the collision: it starts at the pre-impact speed and ends at zero. The
  // manifest has to say so (a student who dragged Get Air's tool expects the other convention). Only the
  // single integral is shifted; `dblint` is not meaningful under this convention and is not offered.
  if(zeroAtEnd(P)){ const vEnd=V[V.length-1]; for(let i=0;i<V.length;i++) V[i]-=vEnd; }
  P.integ={t,v:V,x:X,peak,peakT,peakK,i0,i1};
}
// `CONFIG.integrate:"from-click"` (settled 2026-09-11, replacing a fixed "end-rest"): the velocity is zero
// WHERE THE STUDENT CLICKED FIRST. Drag right and it is Get Air's tool; click after the chair has stopped
// and drag LEFT, and the curve ends at zero and starts at the pre-impact speed. One rule, said in one
// sentence, and a student who overshoots leftward sees the whole velocity history — which is the point.
function fromClick(){ return typeof CONFIG!=="undefined" && CONFIG.integrate==="from-click"; }
function zeroAtEnd(P){ P=P||active(); return fromClick() && !!(P&&P.sel) && P.sel.a > P.sel.b; }
function endRest(P){ return zeroAtEnd(P); }

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
// `requireAxis:` names a signed axis (`x`/`y`/`z`) or, since 2026-09-10, `abs` — phyphox's "Absolute
// acceleration" column. Impulsive Behavior's crash-dummy section switches the head slot to the magnitude
// mid-deck, because a head-fixed x axis that has flexed 90° is not a direction any more (see the manifest).
function axisRe(ax){ return ax==="abs" ? /absolute/i : new RegExp("acceleration\\s*"+ax+"\\b","i"); }
function axisName(ax){ return ax==="abs" ? "absolute acceleration" : "the "+ax+"-axis"; }
function axisOK(){ return !S.reqAxis || axisRe(S.reqAxis).test(S.sigH||""); }
// `gate:"abs"` (2026-09-13): the step passes only when every visible plot's Signal is on phyphox's
// "Absolute acceleration". Unlike `requireAxis:"abs"` it neither pre-selects nor locks — the switch IS
// the step. Impulsive Behavior's head-intro: the deck has read ẍ for twenty steps, the head is the one
// place that axis stops meaning anything, and the student should be the one to change it.
function onAbs(P){ return !!(P.ds && /absolute/i.test(P.sigH||"")); }
// If a step requires an axis, select it — on EVERY visible slot, not just the active one. The elevator
// section requires z on both rides, and a student who has to hunt the dropdown twice has been given a
// chore, not a measurement.
function preferAxis(){
  if(!S.reqAxis) return;
  (visiblePanels().length?visiblePanels():S.panels).forEach(P=>{
    if(!P.ds) return;
    const want=P.ds.headers.find(h=>h!==P.ds.timeH && axisRe(S.reqAxis).test(h));
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
                   axisRe(S.reqAxis).test(h)));
    sel.disabled = has;
    sel.title = has ? "locked to "+axisName(S.reqAxis)+" for this step"
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
      ? '<span class="ro-hint"> — switch <b>Signal</b> to '+axisName(S.reqAxis)+' to score</span>' : '';
    show('<span class="formula"><i>a</i> = '+P.fit.amp.toFixed(2)+'·sin(2π·'+P.fit.freq.toFixed(2)+'·<i>t</i> + '+ph.toFixed(2)+')</span>'
      +'<span class="r2" tabindex="0"><i>R</i>² = '+P.fit.r2.toFixed(3)
      +'<span class="r2pop">Fraction of the variance in your selection the fit explains — 1 = perfect, 0 = no better than a flat line, &lt;0 = worse than a flat line</span></span>'+axisWarn);
  } else if(S.tool==="point"){
    if(P.point==null){ show('<span class="ro-hint">click or drag along the trace</span>'); return; }
    const i=nearest(s,P.point);
    const td = timeDecimals(s);          // never finer than the sample interval — see timeDecimals()
    show('<span class="ro"><i>t</i> = '+s.t[i].toFixed(td)+' s&nbsp;·&nbsp;<i>'+A.sym+'</i> = '+s.a[i].toFixed(A.dp)+' '+A.unit+'</span>');
  } else if(S.tool==="avg"){
    const av=average(s,P); if(av==null){ show('<span class="ro-hint">drag a region to average</span>'); return; }
    show('<span class="ro">average <i>'+A.sym+'</i> = '+av.toFixed(A.dp)+' '+A.unit+'<span class="ro-ctx"> over '+Math.abs(P.sel.b-P.sel.a).toFixed(timeDecimals(s))+' s</span></span>');
  } else if(S.tool==="slope"){
    // Slope (Sportsball, 2026-10-08): a least-squares line through every sample in the window, not a
    // secant between two clicks — on GPS-grade data the two endpoints carry the noise and the middle
    // carries the answer. One decimal: a 10-second window of altitude good to a meter or two is good
    // to about a tenth of a m/s, and no better.
    const L=slopeFit(s,P); if(!L){ show('<span class="ro-hint">drag across a stretch to fit a line to it</span>'); return; }
    show('<span class="ro">slope of <i>'+A.sym+'</i> = '+L.m.toFixed(1)+' '+A.rate+'<span class="ro-ctx"> over '+(L.t1-L.t0).toFixed(timeDecimals(s))+' s</span></span>');
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
  } else if(S.tool==="integrate" && areaMode()){
    // `CONFIG.integrate:"area"` — the integral reads as AREA UNDER THE CURVE (Impulsive Behavior, 2026-09-10).
    // Get Air integrates acceleration to get somewhere (a velocity curve, then a position); an impulse
    // workshop integrates to get a NUMBER, and the number is the shaded area. So: a solid green fill, the
    // value in the green readout like every other tool, and no running-integral curve to distract.
    if(!P.integ){ show('<span class="ro-hint">drag across the trace to measure the area under it</span>'); return; }
    const v=P.integ.v[P.integ.v.length-1];
    show('<span class="ro">area under <i>'+A.ddot+'</i> = '+v.toFixed(2)+' m/s<span class="ro-ctx"> over '+Math.abs(P.sel.b-P.sel.a).toFixed(timeDecimals(s))+' s</span></span>');
  } else { R.style.display="none"; R.innerHTML=""; }   // integrate → on-curve callouts only
}
function areaMode(){ return typeof CONFIG!=="undefined" && CONFIG.integrate==="area"; }
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
  const A=axisInfo(P.sigH), showX = S.tool==="dblint" && !!P.integ, showV = S.tool==="integrate" && !!P.integ && !areaMode();
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
  let aLo=Math.min.apply(null,inA), aHi=Math.max.apply(null,inA);
  // `matchY:` step wiring (2026-09-12): every visible panel shares one vertical range — the union of what
  // each would have drawn alone — so two stacked traces can be compared by eye. Built for the crash section's
  // A-vs-B pairs, where the 9 g and 12 g sleds (and the 15 g and 42 g heads) each auto-scaled to fill their
  // own plot and looked the same height. The time axis is already shared; this is its vertical twin.
  if(NARR[S.step] && NARR[S.step].matchY){
    visiblePanels().forEach(Q=>{ if(Q===P) return; const qs=series(Q); if(!qs) return;
      const qc=cropRange(qs,Q); const qa=qs.a.slice(qc[0],qc[1]+1);
      aLo=Math.min(aLo,Math.min.apply(null,qa)); aHi=Math.max(aHi,Math.max.apply(null,qa)); });
  }
  const Ay=niceTicks(aLo, aHi, 5);
  const tx=t=>mL+(t-T.lo)/(T.hi-T.lo)*px;
  const ay=a=>mT+(Ay.hi-a)/(Ay.hi-Ay.lo)*ph;
  P.G=G={mL,mR,tLo:T.lo,tHi:T.hi};

  // soft minor gridlines first, under everything: `yMinor` on the slot's CONFIG.panels entry (Sportsball's
  // radiosonde: every 1000 m, so a student can find "25 km" without a ruler).
  const pdef=PANELDEF.find(d=>(d.key||"")===P.key)||{};
  if(pdef.yMinor>0){ const st0=Math.ceil(Ay.lo/pdef.yMinor)*pdef.yMinor;
    ctx.save(); ctx.strokeStyle=getCss("--grid"); ctx.globalAlpha=0.55; ctx.lineWidth=1;
    for(let v=st0; v<=Ay.hi+1e-9; v+=pdef.yMinor){ const y=ay(v); ctx.beginPath(); ctx.moveTo(mL,y); ctx.lineTo(W-mR,y); ctx.stroke(); }
    ctx.restore(); }
  // horizontal gridlines + left labels
  ctx.textBaseline="middle"; ctx.textAlign="right"; ctx.font=font(11);
  Ay.ticks.forEach(v=>{ const y=ay(v); ctx.strokeStyle=getCss(v===0?"--zero":"--grid"); ctx.lineWidth=1;
    ctx.beginPath(); ctx.moveTo(mL,y); ctx.lineTo(W-mR,y); ctx.stroke();
    ctx.fillStyle=getCss("--muted"); ctx.fillText(fmt(v), mL-8, y); });
  // left axis title (tinted to the trace) — variable italic, unit roman
  axisTitleV(15, mT+ph/2, A.sym, "("+A.unit+")", "--trace");
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
    ctx.fillStyle=getCss(areaMode()?"--band-area":"--band"); ctx.beginPath(); ctx.moveTo(tx(s.t[r[0]]),y0);
    for(let i=r[0];i<=r[1];i++) ctx.lineTo(tx(s.t[i]),ay(s.a[i]));
    ctx.lineTo(tx(s.t[r[1]]),y0); ctx.closePath(); ctx.fill();
  }
  // average: amber band (context) + SOLID green mean line (the measured value)
  if(S.tool==="avg" && P.sel){ const av=average(s,P); if(av!=null){ const r=selRange(s,P);
    ctx.fillStyle=getCss("--band-amber"); ctx.fillRect(tx(s.t[r[0]]),mT,tx(s.t[r[1]])-tx(s.t[r[0]]),ph);
    ctx.strokeStyle=getCss("--avg"); ctx.lineWidth=num("--stroke-result");
    ctx.beginPath(); ctx.moveTo(tx(s.t[r[0]]),ay(av)); ctx.lineTo(tx(s.t[r[1]]),ay(av)); ctx.stroke(); ctx.lineWidth=1; } }
  // slope: the same amber band, and the fitted line in solid green across the window (the measured value)
  if(S.tool==="slope" && P.sel){ const L=slopeFit(s,P); if(L){
    ctx.fillStyle=getCss("--band-amber"); ctx.fillRect(tx(L.t0),mT,tx(L.t1)-tx(L.t0),ph);
    ctx.save(); ctx.beginPath(); ctx.rect(mL,mT,px,ph); ctx.clip();
    ctx.strokeStyle=getCss("--result"); ctx.lineWidth=num("--stroke-result")+0.75;
    ctx.beginPath(); ctx.moveTo(tx(L.t0),ay(L.m*L.t0+L.b)); ctx.lineTo(tx(L.t1),ay(L.m*L.t1+L.b)); ctx.stroke();
    ctx.restore(); ctx.lineWidth=1; } }

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
    // House rule: the result curve shares the signal's y=0 line. In END-AT-REST mode that rule can squash
    // the curve into a sliver — a crash pulse is all negative, so its zero line sits near the top, while
    // the velocity it integrates to is all POSITIVE (the sled's 8.5 m/s → 0 had a tenth of the plot). When
    // sharing would leave the curve under a quarter of the height, give it its own zero, low in the plot,
    // and let the green right-axis ticks say where that zero is. (2026-09-11)
    let vy0=y0;
    if(endRest(P)){
      const span=(dr.hi-dr.lo)*scale;
      if(span < 0.25*ph){
        const own=(ph*padF)/Math.max(dr.hi-dr.lo,1e-9);
        scale=own; vy0 = (mT+ph) - (0-dr.lo)*own - (ph*(1-padF))/2;
      }
    }
    const xy=v=> vy0 - v*scale;
    ctx.strokeStyle=getCss("--result"); ctx.lineWidth=1; ctx.beginPath(); ctx.moveTo(rx,mT); ctx.lineTo(rx,mT+ph); ctx.stroke();
    const vTop=(vy0-mT)/scale, vBot=(vy0-(mT+ph))/scale;
    const Ry=niceTicks(Math.min(vTop,vBot), Math.max(vTop,vBot), 5);
    ctx.fillStyle=getCss("--result"); ctx.textAlign="left"; ctx.textBaseline="middle"; ctx.font=font(11);
    Ry.ticks.forEach(v=>{ const y=xy(v); if(y<mT-1||y>mT+ph+1) return; ctx.fillText(fmt(v), rx+8, y); });
    axisTitleV(W-15, mT+ph/2, endRest(P) ? A.dot : "∫ "+A.ddot+" dt", "(m/s)", "--result");   // operation italic, unit roman
    polyline(I.t.map(tx), I.v.map(xy), "--result", num("--stroke-result"));
    ctx.fillStyle=getCss("--result"); ctx.textBaseline="alphabetic"; ctx.font=font(12);
    if(endRest(P)){
      // ends at rest by construction, so the number worth reading is where the curve STARTS
      const sv=I.v[0], sx=tx(I.t[0]), sy=xy(sv);
      ctx.textAlign="left"; ctx.fillText("start point = "+sv.toFixed(2)+" m/s", Math.max(mL+4,sx+6), Math.max(mT+12,sy-7));
    } else {
      const lastK=I.v.length-1, endVal=I.v[lastK];
      const ex=tx(I.t[lastK]), ey=xy(endVal);
      ctx.textAlign="right"; ctx.fillText("end point = "+endVal.toFixed(2)+" m/s", Math.min(rx-4,ex-4), Math.max(mT+12,ey-7));
    }
  }
  // point marker: amber dashed vertical rule (context) + solid GREEN dot (the measured point)
  if(S.tool==="point" && P.point!=null){ const i=nearest(s,P.point), x=tx(s.t[i]), y=ay(s.a[i]);
    ctx.strokeStyle=getCss("--edge"); ctx.lineWidth=num("--stroke-mark"); ctx.setLineDash([4,4]);
    ctx.beginPath(); ctx.moveTo(x,mT); ctx.lineTo(x,mT+ph); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle=getCss("--mark"); ctx.beginPath(); ctx.arc(x,y,4,0,7); ctx.fill(); ctx.lineWidth=1; }
  // selection edges (avg / integrate / fit sine): dashed amber context lines bounding the selection
  if((S.tool==="avg"||S.tool==="slope"||S.tool==="dblint"||S.tool==="integrate"||S.tool==="fitsine") && P.sel){ const r=selRange(s,P);
    ctx.strokeStyle=getCss("--edge"); ctx.lineWidth=num("--stroke-mark"); ctx.setLineDash([4,4]);
    [r[0],r[1]].forEach(i=>{ const x=tx(s.t[i]);
      ctx.beginPath(); ctx.moveTo(x,mT); ctx.lineTo(x,mT+ph); ctx.stroke(); }); ctx.setLineDash([]); ctx.lineWidth=1;
    // The bounds' TIMES, in the same amber, at the foot of each rule (2026-09-11) — so a window dragged for
    // Integrate or Average Value can be read off without switching to Select Point and re-finding it.
    if(S.tool==="integrate"||S.tool==="avg"||S.tool==="slope"){
      const td=timeDecimals(s); ctx.fillStyle=getCss("--edge"); ctx.font=font(11); ctx.textBaseline="bottom";
      ctx.textAlign="right"; ctx.fillText(s.t[r[0]].toFixed(td)+" s", tx(s.t[r[0]])-3, mT+ph-3);
      ctx.textAlign="left";  ctx.fillText(s.t[r[1]].toFixed(td)+" s", tx(s.t[r[1]])+3, mT+ph-3);
    } }
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
  if(activeSim){ activeSim.stop(); activeSim=null; }       // …and a sim step its simulation
  activeBallFit=null;
  const tm=$("topmedia"), mode=st.top||"analyzer";
  if(mode==="ball"){                                    // a title card: each ball's name beside the ball drawn TO SCALE
    // Sportsball, 2026-10-09 (Daniel). One px-per-cm for every card in the deck — set so the LARGEST object in
    // CONFIG.balls fills ~70% of the panel height — so a ping-pong ball really does look tiny after the
    // basketball. One ball: big name on the left, the ball on the right. Several (`balls: squash,pingpong`):
    // side by side, each named underneath, all at the same scale, so the comparison is the picture.
    const ks=(st.balls||[]).filter(k=>ballCfg()[k]);
    tm.style.display="flex";
    tm.innerHTML=ballCardHTML(ks, st.kicker||"", null, st.vs);   // no default kicker: a step that wants one says `kicker:` (Daniel, 2026-10-11)
    activeBallFit=()=>fitBallCard(tm, ks, parseFloat(st.ballScale)||1);
    activeBallFit();
    return;
  }
  if(mode==="rank"){                                    // drag the balls into order (makeRank)
    tm.style.display="flex";
    tm.innerHTML='<div class="rank"></div>';
    activeBallFit = makeRank(tm.querySelector(".rank"), st);
    return;
  }
  if(mode==="sim"){                                     // a simulated y(t) driven by the step's inputs (see makeSim)
    tm.style.display="flex";
    tm.innerHTML='<div class="sim">'
      +'<div class="sim-plot"><canvas></canvas><div class="plotreadout"></div></div>'
      +((st.simfit==="fixed"||st.simfit==="stack"||st.simSlider==="no") ? '' : '<div class="sim-ctl"><label>'+simSliderLabel(st)+' =</label><span class="simval"></span><input type="range">'
      +'<span class="simhint">drag to fit</span></div>')+'</div>';
    activeSim = makeSim(tm.querySelector(".sim"), st);
    return;
  }
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
    // `fit:"cover"` / `fit:"cover-top"` work here as they do on a title step (2026-09-13): fill the panel's
    // width and crop the overflow, anchored to the top for cover-top. Impulsive Behavior's two-test sled
    // clip is 2.5:1 in a ~2.7:1 panel, so contain left side bars; cover-top fills the width and spends the
    // loss on the floor and the lab's white credit block, never on THOR's head.
    const fitCls = st.fit==="cover" ? " cover" : st.fit==="cover-top" ? " cover covertop" : st.fit==="fill" ? " fill" : "";
    const cur=tm.querySelector("video.topvid");
    if(cur && cur.dataset.src===st.media){ cur.className="topvid"+fitCls; tm.style.display="flex"; return; }
    tm.style.display="flex";
    tm.innerHTML='<div class="media-ph">Looping demo video plays here once added:<br>'+st.media+'</div>'
      +'<video class="topvid'+fitCls+'" data-src="'+st.media+'" src="'+st.media+'" autoplay loop muted playsinline onerror="this.style.display=\'none\'"></video>';
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
    // An image works too (Sportsball's poster, 2026-10-08): `fit:"backdrop"` fills the panel, zooms in past
    // the edges and dims it, so the graphic reads as a backdrop behind the title rather than as a figure.
    const isImg = /\.(png|jpe?g|webp|gif|svg)$/i.test(st.media||"");
    const imgCls = st.fit==="backdrop" ? " backdrop" : fitCls;
    const bg = !st.media ? '' : isImg ? '<img class="titlebg'+imgCls+'" src="'+st.media+'" alt="" onerror="this.style.display=\'none\'">'
      : '<video class="titlebg'+fitCls+'" src="'+st.media+'" autoplay loop muted playsinline onerror="this.style.display=\'none\'"></video>';
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
// a manifest writes "—" in the unit column of a dimensionless input (e, C_d) because the column can't be
// empty; on screen and in messages that means NO unit, not a dash (Daniel, 2026-10-11)
function unitText(u){ return (u==null || u==="—" || u==="-" || u==="–") ? "" : u; }
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
      const V={label:f.label, unit:unitText(f.unit), low:f.range[0], high:f.range[1]};
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
        const V2 = {label:f.label, unit:unitText(f.unit), dp:f.dp, got:got,
                    rounded: Number.isFinite(v) ? v.toFixed(f.dp) : ""};
        return fbText(st, "dp", got > f.dp
          ? "That is more precision than the measurement supports — give it to exactly {dp} decimal place(s), so {rounded}."
          : "Give this one to exactly {dp} decimal place(s) — you measured that digit, so don't drop it.", V2);
      }
    }
  }
  /* `simfit` (Sportsball, 2026-10-08): the fit box against the value that best explains the student's OWN
     measurement — see simBest(). An e is graded on itself; a C_d on what it predicts, because the slope of
     gap-vs-C_d changes a lot between pairs and "within 0.05" means nothing for one of them. */
  if(st.checkKind==="simfit"){
    if(st.sim==="bounce"){ const tau=simTimes(st);
      for(let k=1;k<tau.length;k++) if(tau[k]>=tau[k-1])
        return fbText(st,"order","Each hop should be shorter than the one before it. Check that you typed them in order — and if one is suspiciously short, it is probably an echo: raise the threshold and drop again.");
    }
    const B=simBest(st), fk=simFields(st).fit, v=fk?S.answers[fk]:NaN;
    if(B && B.reach) return fbText(st,"reach","No setting of the model can produce what you measured. Re-check the number you typed, and if it is right, measure again.");
    if(B && B.value!=null && Number.isFinite(v)){
      if(B.kind==="e" && Math.abs(v-B.value)>B.tol)
        return fbText(st,"check","Not quite — with your times, the model lines up best near {expected}. Drag the slider until the green hops sit on your blue ones.",{expected:B.value.toFixed(2)});
      if(B.kind==="cd"){ const pred=simDropPred(st,v);
        if(Math.abs(pred-B.meas)>B.tolT)
          return fbText(st,"check","Not quite — at that value the model predicts {pred} s against your {meas} s. Drag the slider until the two agree (the best match is near {expected}).",
                        {expected:B.value.toFixed(2), pred:pred.toFixed(3), meas:B.meas.toFixed(3)}); }
    }
  }
  // `termmass`: m = beta v_t^2 / g, with beta given by the deck (CONFIG.termmass.beta) and v_t the speed the student
  // measured in an earlier step (CONFIG.termmass.vKey). Soft, 10%: it checks the arithmetic, not the guess behind beta.
  // `gapgate`: a blind drop's gap must be within a generous factor of the model's — wide enough for
  // real hands and real stairwells, narrow enough to catch a typo or a stopwatch that stopped on an echo
  if(st.checkKind==="gapgate" && st.sim==="drop"){ const v=S.answers[(fieldsOf(st)[0]||{}).key], g=simDropPred(st,null);
    if(Number.isFinite(v) && Number.isFinite(g) && g>0 && (v<g/(CONFIG.sim&&CONFIG.sim.gapFactor||5) || v>g*(CONFIG.sim&&CONFIG.sim.gapFactor||5)))
      return fbText(st,"check","That's a long way from anything two balls like these can do from this height. Check that <b>Minimum delay</b> is 0.005 s, open both hands at once, and drop again."); }
  if(st.checkKind==="termmass"){ const c=CONFIG.termmass||{}, b=c.beta, g=c.g||9.8, vt=S.answers[c.vKey], v=S.answers[st.key||(fieldsOf(st)[0]||{}).key];
    if(Number.isFinite(b) && Number.isFinite(vt) && vt!==0 && Number.isFinite(v)){ const exp=b*vt*vt/g;
      if(Math.abs(v-exp)>0.10*exp) return fbText(st,"check","Not quite — with beta = {beta} kg/m and your speed of {v} m/s, beta v²/g comes to about {expected} kg.",{expected:exp.toFixed(2), beta:b, v:Math.abs(vt)}); } }
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
  if(st.checkKind==="dblintft"){
    /* The elevator's height by double integration, reported in FEET. Two jobs, both soft on purpose
       (Daniel, 2026-09-07: "I just want them to think, that's all"):

         · the FIRST input must match the end value the Double Integrate tool is showing, to 10% —
           enough to prove they dragged the window and did the meters→feet conversion, and nothing more.
           The callout prints CENTIMETERS, so a student who types the tool's number unconverted lands
           3.3x off and hears about it; one who types meters lands 3.3x the other way.
         · the SECOND input (the cinder-block count) is checked only by its declared range, because
           there is no right answer here that we know better than the person standing in the stairwell.

       Silent with no live integration, like `gfactor` — a student who measured, moved on and came Back
       should not be re-blocked on a drag they have no reason to still be holding. */
    const P=active(), I=P&&P.integ, f=fieldsOf(st)[0];
    const v=f ? S.answers[f.key] : NaN;
    if(I && I.x && I.x.length && Number.isFinite(v)){
      const endM = I.x[I.x.length-1], endFt = endM*3.28084;
      const tol = Math.max(0.5, 0.10*Math.abs(endFt));    // the floor keeps a near-zero end value passable
      if(Math.abs(v-endFt)>tol)
        return fbText(st,"check",
          "That doesn't match the curve — the tool's end value reads {cm} cm, which is {expected} ft.",
          {expected:endFt.toFixed(1), cm:(endM*100).toFixed(0), label:f.label});
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
  /* Impulsive Behavior (Workshop 2, rebuilt 2026-09-09): one collision, one chain of numbers. Each validator
     checks the step's answer against the numbers the student typed EARLIER in the chain — never against the
     live plot, so Back never re-blocks a finished step — and quotes the expected value back as {expected}.
     Tolerances are loose on purpose (10% with an absolute floor): these are arithmetic checks, not scoring. */
  /* Impulsive Behavior (Workshop 2, rebuilt 2026-09-09, reordered 2026-09-11): one collision, one chain of
     numbers — speed before impact (read off the end-at-rest integral), then the momentum change with a mass
     the student has to go and weigh, then force two ways and the g's. Each validator checks a step against
     numbers typed EARLIER in the chain (never the live plot, so Back never re-blocks a finished step) and
     quotes the expected value as {expected}. The chair's mass is never given: `chairMass()` is whatever the
     student's own momentum/speed pair implies, so the later checks follow THEIR chair. */
  const chairMass = ()=>{ const A=S.answers; const m=Number.isFinite(A.imp_x)&&A.v_before>0 ? Math.abs(A.imp_x)/A.v_before : NaN; return Number.isFinite(m)&&m>0 ? m : 9.07; };
  if(st.checkKind==="wallspeed"){                      // the start point of the end-at-rest integral, if a drag is live
    const A=S.answers, P=active(), I=P&&P.integ;
    if(I && I.v && I.v.length && Number.isFinite(A.v_before)){
      // The pre-impact speed is the velocity curve's value where the spike BEGINS — not the window's start
      // point, because the instruction is to drag left and a student who overshoots into the shove sees the
      // whole speed history (deliberately). Find the biggest negative spike in the window and walk back to
      // where the trace was still quiet relative to it.
      let exp;
      if(endRest(P)){
        const sr=series(P); let k=I.i0; for(let i=I.i0;i<=I.i1;i++) if(sr.a[i]<sr.a[k]) k=i;
        let j=k; while(j>I.i0 && sr.a[j] < 0.25*sr.a[k]) j--;
        exp = I.v[j-I.i0];
      } else exp = -I.v[I.v.length-1];
      // SOFT on purpose (2026-09-16, Daniel: "as long as they get a reasonable value, let them move on").
      // Where the integral starts is the student's click, and a click a few samples off, or a re-drag after
      // typing, moves the curve by a tenth of a m/s or more. So: accept anything within 35% / 0.15 m/s of
      // the walk-back value, OR of the curve's own extreme in the window — the two readings a student
      // plausibly takes — and only send back a number that is nowhere near their plot.
      let vmax=0; for(const v of I.v) if(Math.abs(v)>Math.abs(vmax)) vmax=v; vmax=Math.abs(vmax);
      const near=(ref)=>Number.isFinite(ref) && Math.abs(A.v_before-ref)<=Math.max(0.15,0.35*Math.abs(ref));
      if(!near(exp) && !near(vmax))
        return fbText(st,"check","That doesn't match your own plot — the green curve starts at about {expected} m/s.",{expected:exp.toFixed(2)});
    }
  }
  if(st.checkKind==="wallmomentum"){                   // m·(0 − v_before), with a mass that has to be a chair's
    const A=S.answers;
    if(Number.isFinite(A.imp_x)&&Number.isFinite(A.v_before)&&A.v_before>0){
      const m=-A.imp_x/A.v_before;
      if(m<4||m>20) return fbText(st,"check","Not quite — Δ(m·ẋ) = m·(0 − ẋ_before). Your number implies a chair of about {mass} kg. Weigh it.",{mass:m.toFixed(1),expected:"—"});
    }
  }
  if(st.checkKind==="wallforce"){                      // F_avg = impulse / (t_end − t_start)
    const A=S.answers;
    if(Number.isFinite(A.t_hit0)&&Number.isFinite(A.t_hit1)&&A.t_hit1<=A.t_hit0)
      return fbText(st,"check","The collision has to END after it STARTS — read the two times again.",{expected:"—"});
    const tau=A.t_hit1-A.t_hit0, exp=A.imp_x/tau;
    if(Number.isFinite(exp) && Number.isFinite(A.F_avg) && Math.abs(A.F_avg-exp)>Math.max(2,0.10*Math.abs(exp)))
      return fbText(st,"check","Not quite — impulse divided by duration. With your times that is about {expected} N.",{expected:exp.toFixed(0)});
  }
  if(st.checkKind==="wallg"){                          // g's = |F_avg| / (m g), on the impulse-over-duration force
    const A=S.answers, exp=Math.abs(A.F_avg)/(chairMass()*G_STD);
    if(Number.isFinite(exp) && Number.isFinite(A.g_wall) && Math.abs(A.g_wall-exp)>Math.max(0.02,0.10*exp))
      return fbText(st,"check","Not quite — the force divided by the weight, m·g, is about {expected} g's.",{expected:exp.toFixed(2)});
  }

  if(st.checkKind==="wallgpeak"){                      // the deepest point of the collision spike, from the chair's own data
    const A=S.answers, sr=slotCol("main",/acceleration\s*x/i)||series(active());
    if(sr && Number.isFinite(A.g_peak)){ let pk=0; for(const v of sr.a) if(Math.abs(v)>Math.abs(pk)) pk=v;
      const exp=Math.abs(pk)/G_STD;
      if(Math.abs(A.g_peak-exp)>Math.max(0.2,0.10*exp))
        return fbText(st,"check","Not quite — the tallest spike reads about {peak} m/s², which is {expected} g's in size. Click right on its tip.",{expected:exp.toFixed(1),peak:pk.toFixed(2)}); }
  }
  /* The crash-test section (rebuilt 2026-09-11 around TWO sled tests, A = S0992 and B = S0944). Every
     expected value is a fact about the SUPPLIED data, computed here from the slot's own column, so a student
     on the wrong plot, the wrong signal or the wrong window hears which. `pulseOf()` finds the sled pulse
     (the contiguous stretch below −0.5 g around the deepest point); `plateauOf()` its flat top (samples
     within 75% of the deepest); `worstWindow()` the largest average over a fixed-width window — HIC's own
     definition. */
  const pulseOf=(sr)=>{ let k=0; for(let i=1;i<sr.a.length;i++) if(sr.a[i]<sr.a[k]) k=i;
    let i0=k, i1=k; while(i0>0 && sr.a[i0-1] < -0.5*G_STD) i0--; while(i1<sr.a.length-1 && sr.a[i1+1] < -0.5*G_STD) i1++; return [i0,i1,k]; };
  const plateauOf=(sr)=>{ const [i0,i1,k]=pulseOf(sr); let sum=0,n=0; for(let i=i0;i<=i1;i++) if(sr.a[i] <= 0.75*sr.a[k]){ sum+=sr.a[i]; n++; } return n? sum/n : sr.a[k]; };
  const worstWindow=(sr,width)=>{ let best=-Infinity; for(let i=0;i<sr.a.length;i++){ const j=nearest(sr,sr.t[i]+width); if(sr.t[j]-sr.t[i] < 0.8*width) break; let sum=0; for(let q=i;q<=j;q++) sum+=sr.a[q]; best=Math.max(best,sum/(j-i+1)); } return best; };
  const perTest=(st, key, fn)=>{ for(const [tag,slot] of [["a","sledA"],["b","sledB"]]) { const r=fn(tag,slot); if(r) return r; } return null; };

  if(st.checkKind==="sledv2"){                         // km/h straight from the end point of the integral over the pulse
    const A=S.answers;
    for(const [tag,slot] of [["a","sledA"],["b","sledB"]]){ const sr=slotCol(slot,/acceleration\s*x/i), k=A["kph_"+tag];
      if(sr && Number.isFinite(k)){ const [i0,i1]=pulseOf(sr); let dv=0; for(let i=i0+1;i<=i1;i++) dv+=(sr.a[i]+sr.a[i-1])/2*(sr.t[i]-sr.t[i-1]); const exp=-dv*3.6;
        if(Math.abs(k-exp)>Math.max(1.5,0.10*exp)) return fbText(st,"check","Not quite — {label}: the green curve's end point over the whole pulse is about {mps} m/s, which is {expected} kph. Make sure the drag covers the pulse from before it starts to after it ends.",{expected:exp.toFixed(1),mps:(-dv).toFixed(2),label:"test "+tag.toUpperCase()}); } }
  }
  if(st.checkKind==="sledmom2"){                       // Δ(m·ẋ) = m × (0 − speed), m = 76.6 kg, speed from their km/h
    const A=S.answers;
    for(const tag of ["a","b"]){ const k=A["kph_"+tag], J=A["mom_"+tag];
      if(Number.isFinite(k)&&Number.isFinite(J)){ const exp=-76.6*k/3.6;
        if(Math.abs(J-exp)>Math.max(15,0.10*Math.abs(exp))) return fbText(st,"check","Not quite — {label}: 76.6 kg times (0 − {v} m/s) is about {expected} kg·m/s. Convert kph to m/s first.",{expected:exp.toFixed(0),v:(k/3.6).toFixed(2),label:"test "+tag.toUpperCase()}); } }
  }
  if(st.checkKind==="sledforce2"){                     // F_avg = Δ(m·ẋ) / τ, τ typed from the amber bound labels
    const A=S.answers;
    for(const tag of ["a","b"]){ const J=A["mom_"+tag], tau=A["tau_"+tag], F=A["F_"+tag];
      if(Number.isFinite(tau)&&(tau<0.06||tau>0.2)) return fbText(st,"check","Not quite — {label}: {detail}",{expected:"—",label:"test "+tag.toUpperCase(),detail:"a "+(tau*1000).toFixed(0)+" ms pulse? These pulses last roughly a tenth of a second. Read the two amber times at the foot of your Integrate window and subtract."});
      if(Number.isFinite(J)&&Number.isFinite(tau)&&Number.isFinite(F)&&tau>0){ const exp=J/tau;
        if(Math.abs(F-exp)>Math.max(150,0.10*Math.abs(exp))) return fbText(st,"check","Not quite — {label}: {detail}",{expected:exp.toFixed(0),label:"test "+tag.toUpperCase(),detail:"your momentum change divided by your "+tau+" s is about "+exp.toFixed(0)+" N."}); } }
  }
  if(st.checkKind==="sledgf2"){                        // average g's = |F_avg| / (m g)
    const A=S.answers;
    for(const tag of ["a","b"]){ const F=A["F_"+tag], gg=A["g_"+tag];
      if(Number.isFinite(F)&&Number.isFinite(gg)){ const exp=Math.abs(F)/(76.6*G_STD);
        if(Math.abs(gg-exp)>Math.max(0.5,0.10*exp)) return fbText(st,"check","Not quite — {label}: the force divided by THOR's weight, 76.6 kg × g, is about {expected} g.",{expected:exp.toFixed(1),label:"test "+tag.toUpperCase()}); } }
  }
  if(st.checkKind==="headpk2"){                        // the top of each head |r̈| trace, in g
    const A=S.answers;
    for(const [tag,slot] of [["a","headA"],["b","headB"]]){ const sr=slotCol(slot,/absolute/i), v=A["gpk_"+tag];
      if(sr && Number.isFinite(v)){ let pk=0; for(const x of sr.a) pk=Math.max(pk,x); const exp=pk/G_STD;
        if(Math.abs(v-exp)>Math.max(0.5,0.06*exp)) return fbText(st,"check","Not quite — {label}: the top of the absolute-acceleration trace reads about {peak} m/s², which is {expected} g's. Is that plot's Signal set to Absolute acceleration?",{expected:exp.toFixed(1),peak:pk.toFixed(2),label:"test "+tag.toUpperCase()}); } }
  }
  if(st.checkKind==="hic2"){                           // HIC15 = (worst 15 ms average of |r̈| in g)^2.5 × 0.015, checked
    const A=S.answers;                                   // straight against the data (the average box was dropped 2026-09-13
    for(const [tag,slot] of [["a","headA"],["b","headB"]]){ const sr=slotCol(slot,/absolute/i), h=A["hic_"+tag];
      if(sr && Number.isFinite(h)){ const av=worstWindow(sr,0.015)/G_STD, exp=Math.pow(av,2.5)*0.015;
        // 10% slack on the average is ~25% on HIC after the 2.5 power; a window centered on the peak
        // rather than slid to the worst spot, or read to the nearest tenth of a g, lands well inside that.
        if(Math.abs(h-exp)>Math.max(3,0.25*exp)) return fbText(st,"check","Not quite — {label}: {detail}",{label:"test "+tag.toUpperCase(),expected:exp.toFixed(0),detail:"the largest 15 ms average on that trace is about "+av.toFixed(1)+" g, and "+av.toFixed(1)+"^2.5 × 0.015 ≈ "+exp.toFixed(0)+". Keep the window about 0.015 s wide on the peak, and convert the average to g's before the 2.5 power."}); } }
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
  if(st.gate==="abs"  && !allVisible(onAbs))      return false;            // must have switched Signal to absolute
  if((st.check||st.checkFn) && S.answers["q"+i]==null) return false;     // set only on a correct pick
  if(st.top==="rank" && S.answers["rankok"+i]!==true) return false;      // the drag-into-order sorter
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
  if(st.gate==="abs" && !allVisible(onAbs)) return fbText(st,"abs",
    "Switch <b>Signal</b> to <b>Absolute acceleration</b>"+(visiblePanels().length>1?" on both plots":"")+" before moving on.");
  if(st.top==="rank" && S.answers["rankok"+i]!==true) return fbText(st,"any",
    (S.answers["rankwait_"+st.id] && Date.now()<S.answers["rankwait_"+st.id]) ? "Check your work — the gate rechecks your order when the countdown ends."
    : (S.answers["rank_"+st.id]||{right:[null]}).right.every(Boolean) ? "Not quite yet — some balls are out of order." : "Drag every ball into a slot on the right first.");
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
    // what was TYPED (or set by a sim slider) when there is one — "0.80", not the Number 0.8: the `dp:`
    // rule asked for that trailing zero, so the deliverable should not strip it back off (2026-10-08)
    if(S.raw && S.raw[k]!=null && String(S.raw[k]).trim()!=="" && Number.isFinite(S.answers[k])) return String(S.raw[k]).trim();
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
  // `preload:` — a step that hands the class a dataset instead of asking for one (2026-09-10). Names the
  // slots to fill from the baked `DEMO_CSVS` map, for EVERY student, the first time the step renders. Built
  // for the crash-dummy section of Impulsive Behavior: nobody records a sled test, so the file picker is the
  // wrong gesture — the data is part of the deck the way a figure is. Teacher mode's "Load sample data"
  // button is the same mechanism behind a gate; this is it with the gate removed, per slot, on purpose.
  if(st.preload && typeof DEMO_CSVS!=="undefined" && DEMO_CSVS){
    let any=false;
    [].concat(st.preload).forEach(k=>{ const P=panelByKey(k);
      if(P && !P.ds && DEMO_CSVS[k]){ P.fileName="("+(P.label||k)+" — supplied)"; try{ ingestParsed(parseCSV(DEMO_CSVS[k]),P); any=true; }catch(e){}
        // A supplied slot has no file picker: the data is part of the deck the way a figure is, and a
        // "Choose File · No file chosen" beside it reads as an instruction to upload something (Daniel, 2026-09-12).
        P.supplied=true; if(P.file){ P.file.style.display="none"; } } });
    if(any){ render(); setReadout(); }
  }
  if(S.reqAxis) preferAxis();
  // An abs-gated step opens on ẍ — the axis the rest of the deck reads — the first time each plot meets
  // it, so the student sees the same-looking trace and then makes the change. Re-visits keep their choice.
  if(st.gate==="abs") visiblePanels().forEach(P=>{ if(!P.ds || P._absSeeded) return; P._absSeeded=true;
    const x=P.ds.headers.find(h=>h!==P.ds.timeH && axisRe("x").test(h));
    if(x && x!==P.sigH){ P.sigH=x; if(P.selEl) P.selEl.value=x; P.point=null; P.sel=null; P.integ=null; } });
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
  // …and the same lever for a step whose measurement is TYPED, not loaded (Sportsball's stairwell gaps,
  // 2026-10-11): CONFIG.samples maps an input key to a sample value; in TEACHER MODE a step with any such
  // input gets the button, which fills those boxes exactly as typing would. Still teacher-only, same reason.
  { const SMP=(typeof CONFIG!=="undefined" && CONFIG && CONFIG.samples) || {};
    const sk=fieldsOf(st).map(f=>f.key).filter(k=>SMP[k]!=null);
    if(sk.length && ungated() && st.gate!=="data"){
      const row=document.createElement("div"); row.className="samplerow";
      // CONFIG.sampleGroups: [{label, keys}] — a step holding any key of a group loads the WHOLE group, so one
      // click fills every page of a run (Sportsball: all five bounce pages from the basketball page). Keys on
      // other steps go straight into the answers, exactly as if typed there.
      const grps=((typeof CONFIG!=="undefined" && CONFIG && CONFIG.sampleGroups) || []).filter(g=>g.keys.some(k=>sk.includes(k)));
      const all=[...new Set(sk.concat(...grps.map(g=>g.keys)))].filter(k=>SMP[k]!=null);
      const btn=document.createElement("button"); btn.className="deck-go";
      btn.textContent="Load sample data"+(grps.length ? " ("+grps.map(g=>g.label).join(", ")+")" : "");
      btn.addEventListener("click",()=>{ let n=0;
        all.forEach(k=>{ const inp=document.querySelector('#stepbody input[data-key="'+k+'"]');
          if(inp){ if(!inp.disabled){ inp.value=String(SMP[k]); inp.dispatchEvent(new Event("input")); n++; } }
          else { S.answers[k]=parseFloat(SMP[k]); S.raw[k]=String(SMP[k]); n++; } });
        if(n){ btn.disabled=true; btn.textContent="Sample data loaded ✓"; } });
      row.appendChild(btn); prose.insertBefore(row, prose.firstChild); } }
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
    if(simBlind(st)){ lockBlind(); if(activeSim) activeSim.redraw(); }
    // A step can gate on more than one thing — the load step wants a file AND a mass. "✓ that works"
    // over a Next that is still dark would be the most confusing possible moment, so when something
    // else is outstanding, say what it is instead of congratulating them.
    setFb(stepComplete(S.step) ? passFb(st) : blockReason(S.step));
    refreshNext();
  };

  // a blind test's measurement is final once the model has been shown (Daniel, 2026-10-09)
  function lockBlind(){ body.querySelectorAll('#stepbody input[type=number]').forEach(x=>{ x.disabled=true; x.title="Locked in: the model has been shown."; });
    body.querySelectorAll('#stepbody .submitrow .deck-go').forEach(x=>{ x.disabled=true; }); }

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
          // Typeset the message ONCE and tick only the seconds. Re-setting the whole box every second
          // re-ran MathJax every second, so on a real laptop the raw `$e\equiv…$` source flashed (or stuck)
          // between typesets (Daniel, 2026-10-09).
          setFb(wrongMsg+"<br><span class='lockcount' style='color:var(--muted)'>"+rem+"s</span>");
          if(S.lockTimer) clearInterval(S.lockTimer);
          S.lockTimer=setInterval(()=>{ rem--;
            if(rem<=0){ clearInterval(S.lockTimer); S.lockTimer=null;
              choiceEls.forEach(x=>{ x.dataset.locked=""; x.classList.remove("locked","wrong"); }); clearFb(); }
            else { const c=fb.querySelector(".lockcount"); if(c) c.textContent=rem+"s"; }
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
    // EXACTLY TWO boxes are a PAIR, wherever they are (2026-09-07). Column-first over two columns puts
    // one at each end of a 1500px deck, and Get Air's elevator-height step is a comparison — the
    // accelerometer's estimate against a count of cinder blocks — so the two numbers being read
    // together IS the step. Same for Workshop 0's amplitude/frequency and its two R² values. Above two
    // fields the group logic below still rules.
    const pair = fields.length===2;
    // A sim step's inputs are two different things — times read off the phone, and the one number the
    // slider sets — so they are laid out as two groups: the times two to a row, the fit on a line of its
    // own underneath (Daniel, 2026-10-08: "it's not clear what best-fit e they're supposed to put in").
    const simSplit = st.top==="sim" && fields.some(f=>f.unit==="s") && fields.some(f=>f.unit!=="s");
    let timesGrid=null, fitLine=null;
    if(simSplit){ wrap.className="inputs simfields";
      timesGrid=document.createElement("div"); timesGrid.className="inputs multi byrow";
      fitLine=document.createElement("div"); fitLine.className="inputs fitline";
      wrap.appendChild(timesGrid); wrap.appendChild(fitLine); }
    else {
      if(fields.length>1 && !st.figure && !pair) wrap.style.gridTemplateRows="repeat("+Math.ceil(fields.length/2)+",auto)";
      if(fields.length>1 && (st.figure || pair)) wrap.classList.add("byrow"); }
    fields.forEach(f=>{
      const row=document.createElement("div"); row.className="inrow";
      row.innerHTML='<label>'+f.label+':</label><input type="number" step="any" style="width:88px"> <span class="unit">'+unitText(f.unit)+'</span>';
      const inp=row.querySelector("input");
      inp.dataset.key=f.key;                        // lets a top-region sim write the box it drives (makeSim)
      if(S.answers[f.key]!=null) inp.value=S.answers[f.key];
      // `input`, not `change`: `change` only fires on blur, so a student who retyped a number and
      // reached straight for Enter was being judged on the previous one. Editing any value RETRACTS
      // the submission — what they had checked is not what is in the boxes any more.
      if(S.raw && S.raw[f.key] != null) inp.value = S.raw[f.key];   // restore what they TYPED, zeros and all
      inp.addEventListener("input",()=>{
        S.answers[f.key]=parseFloat(inp.value);
        S.raw[f.key]=inp.value;                     // the string, for the `dp:` check — see decimalsOf()
        witness(st, f.key, S.answers[f.key]);       // was it true when they typed it?
        if(activeSim) activeSim.onInput(f.key);     // a sim step redraws from what was just typed
        S.answers["ok"+S.step]=false; clearFb(); refreshNext(); });
      inp.addEventListener("keydown",e=>{ if(e.key==="Enter"){ e.preventDefault(); submit(); } });
      (simSplit ? (f.unit==="s" ? timesGrid : fitLine) : wrap).appendChild(row);
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
    else if(qEl){ prose.insertBefore(wrap,qEl); if(goRow) prose.insertBefore(goRow,qEl);
                  main.classList.add("measure-ask"); }   // prose column carries boxes too → give it more width (analyzer.css)
    else { prose.appendChild(wrap); if(goRow) prose.appendChild(goRow); }
    if(goRow && S.answers["ok"+S.step]===true){ setFb(passFb(st)); if(simBlind(st)) lockBlind(); }   // a step you already cleared
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
  // THE DETOUR — "work ahead" around a gate the whole class passes together (Sportsball's stairwell field
  // trip, Daniel 2026-10-12). A step with `aheadTo:` offers a button that jumps there; from then until the
  // `aheadUntil:` step is complete, every step from `aheadTo` on carries a banner back to the gate, and Back is
  // locked on the `aheadTo` step itself, so the pages between the gate and the detour can't be reached around
  // the passwords. Once the class has done it, the steps between `aheadUntil` and `aheadTo` offer the way back to
  // wherever the student had got to. Answers live in S.answers, so nothing is lost on the round trip.
  { const at=id=>NARR.findIndex(s=>s.id===id), D=S.answers.detour;
    const mkRow=(label,cls,go)=>{ const row=document.createElement("div"); row.className="detourrow "+cls;
      const b=document.createElement("button"); b.className="deck-go"; b.textContent=label;
      b.addEventListener("click",go); row.appendChild(b); return row; };
    if(st.aheadTo && at(st.aheadTo)>S.step){
      const to=at(st.aheadTo), until=at(st.aheadUntil||"");
      const done = until>=0 && stepComplete(until);
      if(!done) prose.appendChild(mkRow((st.aheadLabel||"Work ahead")+" \u2192","ahead",()=>{
        const d=S.answers.detour && S.answers.detour.home===S.step ? S.answers.detour
              : (S.answers.detour={home:S.step, to:to, until:until, far:to, back:st.aheadBack||"Back to the class step"});
        S.step=Math.max(d.far,d.to); renderStep(); }));
    }
    if(D){ const done = D.until>=0 && stepComplete(D.until);
      if(!done && S.step>=D.to){ D.far=Math.max(D.far,S.step);
        prose.insertBefore(mkRow(D.back,"back",()=>{ S.step=D.home; renderStep(); }), prose.firstChild); }
      // …offered once every step since the class one is done (so the "why" box after the drops isn't skipped)
      let caught=true; for(let i=D.until+1;i<=S.step;i++) if(!stepComplete(i)) caught=false;
      if(done && D.far>D.to && S.step>D.until && S.step<D.to && caught)
        prose.insertBefore(mkRow("Pick up where you left off (step "+(D.far+1)+") \u2192","resume",()=>{
          S.step=D.far; delete S.answers.detour; renderStep(); }), prose.firstChild);
    }
  }
  if(st.figure){ const im=document.createElement("img"); im.className="deck-fig"; im.src=st.figure; im.alt=""; prose.appendChild(im); }
  body.appendChild(main);
  body.appendChild(fb);
  if(st.challenge) renderHighscore(fb);              // the R² colorbar lives in the feedback box on the challenge step
  $("prog").textContent="Step "+(S.step+1)+" / "+NARR.length;
  $("prev").disabled = S.step===0 || backLocked();
  $("next").style.display = (S.step===NARR.length-1) ? "none" : "";   // hide Next on the last step, don't just gray it
  refreshNext();
  typesetMath(body);
}
// Back is locked on the detour's landing step while the detour is open (see THE DETOUR in renderStep).
function backLocked(){ const D=S.answers.detour; return !!(D && !ungated() && S.step===D.to && !(D.until>=0 && stepComplete(D.until))); }
$("prev").addEventListener("click",()=>{ if(S.step>0 && !backLocked()){ S.step--; renderStep(); } });
$("next").addEventListener("click",()=>{
  if(S.step>=NARR.length-1) return;
  if(!ungated() && !stepComplete(S.step)){ if(!S.lockTimer){ const p=$("deckfb"); if(p) p.innerHTML=blockReason(S.step); } return; }
  S.step++; renderStep();
});
// TAB moves between the step's ENTRY BOXES only — numbers, text, passcodes, freeform answers — and wraps;
// Shift-Tab goes back. Suite-wide, because a step's tab order otherwise wanders through labels, equations,
// buttons and the nav bar before it reaches the next box (Daniel, 2026-10-11). Enter still submits.
function entryBoxes(){ return [...document.querySelectorAll('#stepbody input[type=number], #stepbody input[type=text], #stepbody textarea:not([readonly])')]
  .filter(x=>!x.disabled && x.offsetParent!==null); }
document.addEventListener("keydown",e=>{
  if(e.key!=="Tab" || e.altKey || e.ctrlKey || e.metaKey) return;
  const boxes=entryBoxes(); if(!boxes.length) return;
  const i=boxes.indexOf(document.activeElement);
  e.preventDefault();
  const next = i<0 ? (e.shiftKey ? boxes.length-1 : 0) : (i + (e.shiftKey ? -1 : 1) + boxes.length) % boxes.length;
  boxes[next].focus(); if(boxes[next].select) boxes[next].select();
});
document.addEventListener("keydown",e=>{                 // ← / → drive Back / Next
  const tag=(document.activeElement||{}).tagName||"";
  if(tag==="INPUT"||tag==="SELECT"||tag==="TEXTAREA") return;
  if(e.key==="ArrowRight") $("next").click();
  else if(e.key==="ArrowLeft") $("prev").click();
});

/* ============================================================== */
/*  BALLS — the to-scale ball art shared by top:"ball" cards and the top:"rank" sorter      */
/* ============================================================== */
/* Every ball is drawn from its CONFIG.balls entry: `img` (a keyed square PNG) if there is one, otherwise a
   shaded disc in `color`, with `seams` ("basketball" | "tennis") drawn over it; `shape:"filter"` draws a fluted
   paper cup instead of a sphere. Sizes are always D × one px-per-cm, so every picture in the deck agrees. */
function ballCfg(){ return (typeof CONFIG!=="undefined" && CONFIG.balls) || {}; }
function ballName(b){ return b.title || (b.name||"").replace(/^./,c=>c.toUpperCase()); }
function ballSpec(b){ const g=b.m*1000; return (b.m?(g>=100?Math.round(g):g.toFixed(1).replace(/\.0$/,""))+" g · ":"")+(b.D*100).toFixed(1)+" cm across"; }
function ballMaxD(B){ return Math.max.apply(null,Object.keys(B).map(x=>B[x].D||0))*100; }
function ballAspect(b){ return b.shape==="filter" ? 0.42 : b.steam ? 1.52 : 1; }   // a steaming ball is taller by its steam
function ballMaxSlot(ks,B){ return Math.max.apply(null,ks.map(k=>(B[k].D||0)*100*ballAspect(B[k]))); }
function sizeBall(el,pxcm){ const D=parseFloat(el.dataset.d)||5, a=parseFloat(el.dataset.a)||1, w=Math.max(4,D*pxcm);
  el.style.width=w+"px"; el.style.height=(w*a)+"px"; }
const BALL_SEAMS={ basketball:{c:"#111", w:2.2, d:["M50 0 Q46 50 50 100","M0 50 Q50 55 100 50","M17 8 Q44 50 17 92","M83 8 Q56 50 83 92"]},
                   tennis:    {c:"#fbfbf4", w:3.2, d:["M13 17 C42 37 42 63 13 83","M87 17 C58 37 58 63 87 83"]} };
let _ballClip=0;
function ballArt(b){
  const D=(b.D||0.05)*100, a=ballAspect(b), data=' data-d="'+D+'" data-a="'+a+'"';
  if(b.img) return '<div class="bc-ball"'+data+'><img src="'+b.img+'" alt=""></div>';
  if(b.shape==="filter"){                               // a basket coffee filter, side-on: a fluted paper cup
    const n=14, pleats=[]; for(let i=1;i<n;i++){ const t=i/n; pleats.push('<path d="M'+(t*100).toFixed(1)+' 6 L'+(18+t*64).toFixed(1)+' 41"/>'); }
    let rim="M0 5"; for(let i=0;i<n;i++){ const x0=i*100/n, x1=(i+1)*100/n; rim+=" Q"+((x0+x1)/2).toFixed(1)+" "+(i%2?1.5:8)+" "+x1.toFixed(1)+" 5"; }
    const id="bcf"+(++_ballClip);
    // a nested stack (`stack: 5`) shows its extra rims just under the top one
    const extra=[]; for(let j=1;j<(b.stack||1);j++) extra.push('<path d="'+rim+'" transform="translate(0 '+(j*1.6)+')" fill="none" stroke="#d8d4cb" stroke-width=".9"/>');
    return '<div class="bc-ball bc-shape"'+data+'><svg viewBox="0 0 100 42" preserveAspectRatio="none">'
      +'<defs><linearGradient id="'+id+'" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbfaf6"/><stop offset="1" stop-color="#cfcbc2"/></linearGradient></defs>'
      +'<path d="'+rim+' L82 41 Q50 43 18 41 Z" fill="url(#'+id+')"/>'
      +'<g stroke="#b9b4aa" stroke-width=".7" fill="none" opacity=".9">'+pleats.join("")+'</g>'
      +extra.join("")+'<path d="'+rim+'" fill="none" stroke="#e9e6df" stroke-width=".8"/></svg></div>';
  }
  // `steam: true` — the hot squash ball: three wavy lines rising off the top, the same mark as the kettle
  // station's printed sheet (Daniel, 2026-10-11). The ball stays to scale; the steam sits above it.
  if(b.steam){ const plain=Object.assign({},b,{steam:false});
    return '<div class="bc-ball bc-steamy"'+data+'><svg class="bc-steam" viewBox="0 0 100 52" aria-hidden="true">'
      +'<g fill="none" stroke="#e0483e" stroke-width="3.3" stroke-linecap="round">'
      +'<path d="M30.95 43.4 C21.4 33 40.5 24.4 30.95 10.1"/><path d="M50 40.6 C40.5 29.2 59.5 20.6 50 4.4"/>'
      +'<path d="M69 43.4 C59.5 33 78.6 24.4 69 10.1"/></g></svg>'
      +ballArt(plain).replace(/ data-d="[^"]*" data-a="[^"]*"/,"").replace('class="bc-ball ','class="')+'</div>'; }
  const sm=BALL_SEAMS[b.seams], id="bcc"+(++_ballClip);
  const seams = sm ? '<svg viewBox="0 0 100 100" preserveAspectRatio="none"><defs><clipPath id="'+id+'"><circle cx="50" cy="50" r="50"/></clipPath></defs>'
      +'<g clip-path="url(#'+id+')" fill="none" stroke="'+sm.c+'" stroke-width="'+sm.w+'" stroke-linecap="round" opacity=".9">'
      +sm.d.map(d=>'<path d="'+d+'"/>').join("")+'</g></svg>' : '';
  return '<div class="bc-ball bc-disc'+(b.dark?' dark':'')+'"'+data+' style="--ball:'+(b.color||"#c8c8c8")+'">'+seams+'</div>';
}

// The title card itself, shared by top:"ball" steps and a sim step's empty state (makeSim): one ball → big name
// on the left, ball on the right; several → side by side, each named underneath. `hint` is a muted line under
// the names — on a sim step, what to type below to make the plot appear.
// `vs` (a top:"ball" step's `vs: caption | caption`): the balls are PAIRS, in order — a "vs." between the two of
// each pair, its caption under it (Sportsball's pre-stairwell slide: the gap the model predicts), and a wider
// space between pairs (Daniel, 2026-10-11).
function ballCardHTML(ks, kicker, hint, vs){
  const B=ballCfg(), many=ks.length>1, scaleBar='<div class="bc-scale"><span></span><em>10 cm</em></div>';
  const hintHTML = hint ? '<div class="bc-hint">'+hint+'</div>' : '';
  if(!many){ const b=B[ks[0]]||{name:"ball",D:0.05};
    return '<div class="ballcard"><div class="bc-text"><div class="bc-kicker">'+(kicker||"")+'</div>'
      +'<div class="bc-name">'+ballName(b)+'</div><div class="bc-spec">'+ballSpec(b)+'</div>'+hintHTML+'</div>'
      +'<div class="bc-art">'+ballArt(b)+scaleBar+'</div></div>'; }
  return '<div class="ballcard multi">'+(kicker?'<div class="bc-kicker bc-top">'+kicker+'</div>':'')
    +'<div class="bc-row'+(vs!=null?' vs':'')+'">'+ks.map((k,i)=>{
        const col='<div class="bc-col"><div class="bc-slot">'+ballArt(B[k])+'</div>'
          +'<div class="bc-name sm">'+ballName(B[k])+'</div><div class="bc-spec">'+ballSpec(B[k])+'</div></div>';
        if(vs==null || i===0) return col;
        if(i%2===1){ const cap=String(vs).split("|").map(x=>x.trim())[(i-1)/2]||"";
          return '<div class="bc-vs"><b>vs.</b>'+(cap?'<span>'+cap+'</span>':'')+'</div>'+col; }
        return '<div class="bc-pairgap"></div>'+col; }).join("")+'</div>'
    +'<div class="bc-foot">'+scaleBar+hintHTML+'</div></div>';
}
// One px-per-cm for every single-ball card in the deck — set so the LARGEST object in CONFIG.balls fills ~70% of
// the height — so a ping-pong ball really does look tiny after the basketball. A comparison card scales to ITS
// largest object instead (the 10 cm bar keeps it honest), limited by width as well.
// `scale` (a step's `ballScale:`): shrink a comparison card below its fit-to-panel size, so two small balls shown
// alone still LOOK small next to the cards that come after (Sportsball s2-mass, Daniel 2026-10-11).
function fitBallCard(el, ks, scale){
  const B=ballCfg(), h=el.clientHeight||420, w=el.clientWidth||1200, many=ks.length>1,
        sumW=ks.reduce((a,k)=>a+(B[k].D||0)*100,0),
        wfrac = el.querySelector(".bc-row.vs") ? 0.40 : 0.62,     // a vs. card spends width on the "vs." and the pair gap
        pxcm = (scale||1) * (many ? Math.min(0.42*h/ballMaxSlot(ks,B), wfrac*w/sumW) : 0.70*h/ballMaxD(B));
  el.querySelectorAll(".bc-ball").forEach(x=>sizeBall(x,pxcm));
  el.querySelectorAll(".bc-slot").forEach(x=>{ x.style.height=(ballMaxSlot(ks,B)*pxcm)+"px"; });
  el.querySelectorAll(".bc-scale span").forEach(x=>{ x.style.width=(10*pxcm)+"px"; });
}

/* ---- top:"rank" — drag every ball into order of terminal speed (Sportsball, 2026-10-09) ----
   Left: the balls in a random order. Right: numbered slots, fastest at the top. Drag (or click) a ball across;
   drag within the right column to swap; drag (or click) it back to return it. With every slot full, the
   feedback box says how many are out of place — or, all right, names the winner and the loser. The order is
   by m/D² (the step's text tells students to assume one C_d for all), and the step is gated on getting it. */
function rankTruth(ks,B){ return ks.slice().sort((x,y)=>B[y].m/(B[y].D*B[y].D)-B[x].m/(B[x].D*B[x].D)); }
function rankVt(b){ return Math.sqrt(b.m*9.81/(0.5*1.2*0.47*Math.PI*b.D*b.D/4)); }
function makeRank(root,st){
  const B=ballCfg(), ks=(st.balls||[]).filter(k=>B[k]), key="rank_"+st.id, truth=rankTruth(ks,B);
  let R=S.answers[key];
  if(!R || !Array.isArray(R.left) || !Array.isArray(R.right) || R.right.length!==ks.length){
    const sh=ks.slice(); for(let i=sh.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [sh[i],sh[j]]=[sh[j],sh[i]]; }
    if(sh.join()===truth.join()) sh.reverse();
    R={left:sh, right:ks.map(()=>null)}; S.answers[key]=R; }
  const item=k=>'<div class="rk-item" data-k="'+k+'"><div class="rk-art">'+ballArt(B[k])+'</div>'
    +'<div class="rk-txt"><b>'+ballName(B[k])+'</b><span>'+ballSpec(B[k])+'</span></div></div>';
  let pxcm=2;
  function draw(){
    root.innerHTML='<div class="rk-col rk-left" data-col="left"><div class="rk-head">Balls</div>'
      +R.left.map(item).join("")+'</div>'
      +'<div class="rk-col rk-right" data-col="right"><div class="rk-head">Fastest terminal speed ↓ slowest</div>'
      +R.right.map((k,i)=>'<div class="rk-slot" data-i="'+i+'"><span class="rk-n">'+(i+1)+'</span>'+(k?item(k):'')+'</div>').join("")+'</div>';
    fit(); verdict(); }
  function fit(){ const h=root.clientHeight||440, rowH=Math.max(30,(h-34)/ks.length - 4);
    pxcm=Math.min(3.2,(rowH-6)/ballMaxD(B));
    root.querySelectorAll(".rk-item,.rk-slot").forEach(el=>{ el.style.height=rowH+"px"; });
    root.querySelectorAll(".rk-art").forEach(el=>{ el.style.width=(ballMaxD(B)*pxcm)+"px"; });
    root.querySelectorAll(".bc-ball").forEach(el=>sizeBall(el,pxcm)); }
  // One check per cooldown (Daniel, 2026-10-09: "I just guessed my way there based on the feedback in under a
  // minute"). A full, wrong list is checked once, says how many are out of place, and then the gate goes quiet
  // for `lockSeconds` (default LOCK_S): rearranging is allowed, but nothing is re-graded until the countdown
  // ends, and then whatever is in the slots is checked again. The deadline lives in S.answers, so leaving the
  // step and coming back doesn't reset it.
  const waitKey="rankwait_"+st.id, lastKey="ranklast_"+st.id, coolS=Number.isFinite(st.lockSeconds)?st.lockSeconds:LOCK_S;
  function waitMsg(){ const left=Math.max(0,Math.ceil((S.answers[waitKey]-Date.now())/1000));
    return "Check your work: "+S.answers[lastKey]+" of "+ks.length+" are in the wrong spot. The gate will recheck your answers in <b>"+left+"</b> second"+(left===1?"":"s")+"."; }
  function tick(){ if(S.lockTimer){ clearInterval(S.lockTimer); S.lockTimer=null; }
    S.lockTimer=setInterval(()=>{ if(!root.isConnected){ clearInterval(S.lockTimer); S.lockTimer=null; return; }
      if(Date.now()>=S.answers[waitKey]){ clearInterval(S.lockTimer); S.lockTimer=null; verdict(); }
      else { const fb=$("deckfb"); if(fb){ fb.dataset.rank="1"; fb.innerHTML=waitMsg(); } } },500); }
  function verdict(){
    const fb=$("deckfb"); const full=R.right.every(Boolean);
    S.answers["rank_list"]=R.right.filter(Boolean).map(k=>B[k].name).join(" > ");
    const waiting = S.answers[waitKey] && Date.now()<S.answers[waitKey];
    if(waiting){ S.answers["rankok"+S.step]=false; if(fb){ fb.dataset.rank="1"; fb.innerHTML=waitMsg(); } if(!S.lockTimer) tick(); refreshNext(); return; }
    if(!full){ S.answers["rankok"+S.step]=false; if(fb && fb.dataset.rank) { fb.innerHTML=""; delete fb.dataset.rank; } refreshNext(); return; }
    const wrong=R.right.filter((k,i)=>k!==truth[i]).length;
    S.answers["rankok"+S.step] = wrong===0;
    if(wrong){ S.answers[lastKey]=wrong; S.answers[waitKey]=Date.now()+coolS*1000;
      if(fb){ fb.dataset.rank="1"; fb.innerHTML=waitMsg(); } tick(); refreshNext(); return; }
    if(fb){ fb.dataset.rank="1";
      const w=B[truth[0]], l=B[truth[truth.length-1]];
      fb.innerHTML = "✓ Yes! The winner is the <b>"+w.name+"</b>, at about "+Math.round(rankVt(w))+" m/s, and the slowest is the <b>"+l.name+"</b>, at about "+Math.round(rankVt(l))+" m/s."; }
    refreshNext(); }
  function place(k,to,i){                                // move ball k to the left column, or to slot i (swapping)
    const fromL=R.left.indexOf(k), fromR=R.right.indexOf(k);
    if(to==="left"){ if(fromR>=0){ R.right[fromR]=null; R.left.push(k); } }
    else { const occ=R.right[i];
      if(fromR>=0){ R.right[fromR]=occ||null; R.right[i]=k; }
      else { R.left.splice(fromL,1); if(occ) R.left.push(occ); R.right[i]=k; } }
    S.answers[key]=R; draw(); }
  let drag=null;
  root.addEventListener("pointerdown",e=>{ const el=e.target.closest(".rk-item"); if(!el) return; e.preventDefault();
    const r=el.getBoundingClientRect(), g=el.cloneNode(true); g.classList.add("rk-ghost");
    g.style.width=r.width+"px"; g.style.height=r.height+"px"; g.style.left=r.left+"px"; g.style.top=r.top+"px"; document.body.appendChild(g);
    el.classList.add("rk-src"); drag={k:el.dataset.k, el, g, dx:e.clientX-r.left, dy:e.clientY-r.top, x0:e.clientX, y0:e.clientY, moved:false};
    root.setPointerCapture && root.setPointerCapture(e.pointerId); });
  root.addEventListener("pointermove",e=>{ if(!drag) return;
    if(Math.abs(e.clientX-drag.x0)+Math.abs(e.clientY-drag.y0)>4) drag.moved=true;
    drag.g.style.left=(e.clientX-drag.dx)+"px"; drag.g.style.top=(e.clientY-drag.dy)+"px";
    root.querySelectorAll(".rk-over").forEach(x=>x.classList.remove("rk-over"));
    drag.g.style.display="none"; const t=document.elementFromPoint(e.clientX,e.clientY); drag.g.style.display="";
    const tgt=t && (t.closest(".rk-slot")||t.closest(".rk-left")); if(tgt) tgt.classList.add("rk-over"); });
  const end=e=>{ if(!drag) return; const d=drag; drag=null; d.g.remove(); d.el.classList.remove("rk-src");
    root.querySelectorAll(".rk-over").forEach(x=>x.classList.remove("rk-over"));
    if(!d.moved){                                        // a click: across to the first empty slot, or back
      if(R.left.indexOf(d.k)>=0){ const i=R.right.indexOf(null); if(i>=0) place(d.k,"right",i); }
      else place(d.k,"left"); return; }
    const t=document.elementFromPoint(e.clientX,e.clientY), slot=t&&t.closest(".rk-slot"), left=t&&t.closest(".rk-left");
    if(slot) place(d.k,"right",+slot.dataset.i); else if(left) place(d.k,"left"); };
  root.addEventListener("pointerup",end); root.addEventListener("pointercancel",end);
  draw(); setTimeout(verdict,0);
  return fit;
}

/* ============================================================== */
/*  SIM — a simulated y(t) in the top region (top:"sim")              */
/* ============================================================== */
/* Built for Sportsball (2026-10-08). Sections 1 and 2 of that workshop measure TIMES by ear — the gaps
   between bounces, the gap between two landings — and a time is a point, not a picture. So the top
   region draws the motion those times imply, beside a model the student tunes with ONE slider until the
   two agree. The slider IS the step's fit input: moving it writes the box, typing in the box moves it —
   one number with two handles — and the box is what `checkKind:"simfit"` grades.

   Wiring (NARR):  top:"sim" · sim:"bounce"|"superball"|"drop" · balls:[…] · simfit:<what the slider sets>
     bounce     "e" (one restitution, no air) or "e-drag" (one restitution, quadratic drag on every hop)
     superball  "e" — released from CONFIG.sim.superballBlocks, timed to the CONFIG.sim.superballBounces-th bounce
     drop       "cd-shared" (one C_d for both balls) · "cd-second" (the first ball keeps its CONFIG C_d,
                the slider sets the second's) · "cd" (one object, its whole fall time)
   Which input is which is read from the step's own fields BY UNIT, so a manifest needs no new syntax:
   unit "s" fields are measured times, in order; the first field with any other unit is the fit. A step
   that re-reads times typed earlier names them with `simKeys:`. Every number that belongs to the
   workshop rather than the physics — masses, diameters, C_d, the size of a cinder block, which input
   holds the drop height — lives in the deck's CONFIG.balls / CONFIG.sim, never here.

   Colors follow the house rule: BLUE is only what you measured — a vertical line at each instant your
   stopwatch heard (2026-10-08 revision, Daniel: "the blue should represent what we know for sure
   happened", so no drawn-in hop shapes) — GREEN is the model, AMBER is context (the deviation readout),
   and the dashed gray curve is "no drag". A drop step with `simfit:"fixed"` has no slider at all: its
   model is a smooth sphere at each ball's CONFIG C_d, and the student compares rather than fits. */
let activeSim=null;
const SIM_G=9.81, SIM_RHO=1.2;
function simCfg(){ return (typeof CONFIG!=="undefined" && CONFIG && CONFIG.sim) || {}; }
// A fixed-model drop that asks for a measurement is a BLIND test: the top shows only its title until the
// student's number has passed Enter, so the model can't be read off and typed back (Daniel, 2026-10-09).
function simBlind(st){ return st && st.top==="sim" && st.sim==="drop" && (st.simfit==="fixed"||st.simfit==="stack") && fieldsOf(st).length>0; }
function simBall(k){ const B=(typeof CONFIG!=="undefined" && CONFIG && CONFIG.balls) || {};
  return B[k] || {name:String(k||"ball"), m:0.05, D:0.05, cd:0.47}; }
function simBeta(b,cd){ return 0.5*SIM_RHO*cd*Math.PI*(b.D/2)*(b.D/2); }
function simVt(b,cd){ return Math.sqrt(b.m*SIM_G/simBeta(b,cd)); }
function lncosh(x){ x=Math.abs(x); return x>20 ? x-Math.LN2 : Math.log(Math.cosh(x)); }
// Dropped from rest through h with quadratic drag: Class K's closed form, y = h - (v_t²/g) ln cosh(g t/v_t),
// solved for the time to reach y = 0. Past x ≈ 30 the cosh overflows long before the answer does.
function simFallTime(b,cd,h){ const vt=simVt(b,cd), x=SIM_G*h/(vt*vt);
  return x>30 ? h/vt+vt/SIM_G*Math.LN2 : vt/SIM_G*Math.acosh(Math.exp(x)); }
function simFallY(b,cd,h,t){ const vt=simVt(b,cd); return h - vt*vt/SIM_G*lncosh(SIM_G*t/vt); }

function simFields(st){
  const F=fieldsOf(st);
  const times=(Array.isArray(st.simKeys)&&st.simKeys.length) ? st.simKeys.slice() : F.filter(f=>f.unit==="s").map(f=>f.key);
  const fitF=F.find(f=>f.unit!=="s") || null;
  return {times:times, fit:fitF?fitF.key:null, fitField:fitF};
}
// the measured times, in order, stopping at the first box not yet filled
function simTimes(st){ const out=[]; for(const k of simFields(st).times){ const v=S.answers[k];
  if(!Number.isFinite(v)||v<=0) break; out.push(v); } return out; }
// The unit a key was asked in, looked up across the whole deck (a height is typed on one step, used on others).
function simKeyUnit(k){ for(const s2 of NARR){ const f=fieldsOf(s2).find(x=>x.key===k); if(f) return f.unit||""; } return ""; }
// Drop height in meters. A step names the input that holds it with `simHeight:`; otherwise CONFIG.sim.heightKey.
// An input asked in "m" is meters; anything else is counted in cinder blocks (CONFIG.sim.blockM each).
function simHeight(st){ const c=simCfg(), bm=c.blockM||0.2032;
  if(st.sim==="superball") return (c.superballBlocks||9)*bm;
  const key=st.simHeight||c.heightKey;
  if(key && c.fixedHeights && Number.isFinite(c.fixedHeights[key])) return c.fixedHeights[key];   // a posted height, in meters, nobody types
  const v=key ? S.answers[key] : NaN, inM=key && simKeyUnit(key)==="m";
  if(Number.isFinite(v)&&v>0) return inM ? v : v*bm;
  return inM ? (c.defaultMeters||10) : (c.defaultBlocks||13)*bm; }

// ---- bounce: one hop with drag, integrated (no closed form once the ball goes UP and comes back down)
function simHop(b,cd,v,dt,keep){
  const k=simBeta(b,cd)/b.m; let y=0, vy=v, t=0; const pts=keep?[[0,0]]:null;
  for(;;){ const a=-SIM_G-k*Math.abs(vy)*vy, vn=vy+a*dt, yn=y+vn*dt;
    if(yn<0 && vn<0){ const f=y/(y-yn); t+=f*dt; if(keep) pts.push([t,0]); return {T:t, u:Math.abs(vy+(vn-vy)*f), pts:pts}; }
    vy=vn; y=yn; t+=dt;
    if(keep && t-pts[pts.length-1][0]>=0.004) pts.push([t,y]);
    if(t>20) return {T:t, u:Math.abs(vy), pts:pts}; } }
const _launchCache={};
// the launch speed whose hop (with drag) lasts exactly tau — the model starts from the student's FIRST hop
function simLaunchFor(b,cd,tau,dt){ const key=[b.m,b.D,cd,tau,dt].join(",");
  if(_launchCache[key]!=null) return _launchCache[key];
  let lo=0.01, hi=60; for(let i=0;i<50;i++){ const m=(lo+hi)/2; if(simHop(b,cd,m,dt,false).T<tau) lo=m; else hi=m; }
  return (_launchCache[key]=(lo+hi)/2); }
function simParab(T,h0){ const pts=[]; const n=60; for(let i=0;i<=n;i++){ const s=T*i/n; pts.push([s,(h0||0)+0.5*SIM_G*s*(T-s)]); } return pts; }
// the model's hops for restitution e: n hop durations (and their shapes, when `keep`)
function simBounceModel(st,e,n,keep){
  const tau=simTimes(st); if(!tau.length) return null;
  const hops=[];
  if(st.simfit!=="e-drag"){ for(let k=0;k<n;k++){ const T=tau[0]*Math.pow(e,k); hops.push({T:T, pts:keep?simParab(T):null}); } return hops; }
  const b=simBall((st.balls||[])[0]), cd=b.cd, dt=keep?1e-4:2.5e-4;
  let v=simLaunchFor(b,cd,tau[0],dt);
  for(let k=0;k<n;k++){ const H=simHop(b,cd,v,dt,keep); hops.push(H); v=e*H.u; }
  return hops;
}
// The number the student minimizes: the AVERAGE distance in time between the model's bounces and theirs.
// Bounce 1 is t = 0 for both, and the model's first hop is pinned to theirs, so bounce 2 always agrees;
// the comparison is bounces 3 onward. Timestamps, not hop durations, because a timestamp is what the
// stopwatch heard and what the blue lines show.
function simMisfit(st,e){ const tau=simTimes(st); if(tau.length<2) return null;
  const M=simBounceModel(st,e,tau.length,false); let tm=0, tmod=0, sum=0;
  for(let k=0;k<tau.length;k++){ tm+=tau[k]; tmod+=M[k].T; if(k>=1) sum+=Math.abs(tm-tmod); }
  return sum/(tau.length-1); }
// ---- superball: release from h, then hops of 2·t₁·eᵏ (no air — at 1.8 m a superball barely notices it)
function simSuperT(e,h,N){ const t1=Math.sqrt(2*h/SIM_G); return t1*(1+2*e*(1-Math.pow(e,N-1))/(1-e)); }
// ---- drop: the objects in the step, each at its C_d for slider value cd
function simDropSet(st,cd){ const bs=(st.balls||[]).map(simBall);
  if(st.simfit==="fixed") return bs.map(b=>({b:b,cd:b.cd}));
  // `stack`: same object, more of it (nested coffee filters) — every curve at ONE C_d, the student's own fit
  // from the step named by `simCdKey` when there is one, else CONFIG's
  if(st.simfit==="stack"){ const c=st.simCdKey ? S.answers[st.simCdKey] : NaN; return bs.map(b=>({b:b, cd:Number.isFinite(c)&&c>0 ? c : b.cd})); }
  if(st.simfit==="cd-shared") return bs.map(b=>({b:b,cd:cd}));
  if(st.simfit==="cd-second") return [{b:bs[0],cd:bs[0].cd},{b:bs[1],cd:cd}];
  return [{b:bs[0],cd:cd}]; }
function simDropPred(st,cd){ const h=simHeight(st), P=simDropSet(st,cd);
  if(P.length===1) return simFallTime(P[0].b,P[0].cd,h);
  return simFallTime(P[1].b,P[1].cd,h)-simFallTime(P[0].b,P[0].cd,h); }
function simBisect(f,target,lo,hi){ const flo=f(lo)-target, fhi=f(hi)-target;
  if(!(flo<=0 && fhi>=0)) return null;
  for(let i=0;i<60;i++){ const m=(lo+hi)/2; if(f(m)<target) lo=m; else hi=m; } return (lo+hi)/2; }
function simGolden(f,lo,hi){ for(let i=0;i<60;i++){ const a=lo+(hi-lo)*0.382, b=lo+(hi-lo)*0.618; if(f(a)<f(b)) hi=b; else lo=a; } return (lo+hi)/2; }

/* The value the slider SHOULD sit at, given what the student measured — what `simfit` grades against.
   Pure (reads S.answers, never the DOM) and cached on its inputs, because stepComplete runs it on every
   keystroke and the drag-bounce fit integrates a few hundred thousand steps. */
const _bestCache={};
function simBest(st){
  const sig=JSON.stringify([st.id, st.sim, st.simfit, simTimes(st), simHeight(st)]);
  if(sig in _bestCache) return _bestCache[sig];
  let out=null;
  if(st.sim==="bounce"){ const tau=simTimes(st);
    if(tau.length>=2) out={kind:"e", value:simGolden(e=>simMisfit(st,e), 0.2, 0.995), tol:0.02}; }
  else if(st.sim==="superball"){ const T=simTimes(st)[0], c=simCfg(), N=c.superballBounces||10, h=simHeight(st);
    if(Number.isFinite(T)){ const e=simBisect(x=>simSuperT(x,h,N), T, 0.05, 0.995);
      out = e==null ? {kind:"e", value:null, reach:true} : {kind:"e", value:e, tol:0.015}; } }
  else if(st.sim==="drop" && st.simfit!=="cd-second" && st.simfit!=="fixed" && st.simfit!=="stack"){ const meas=simTimes(st)[0];
    if(Number.isFinite(meas)){ const cd=simBisect(c=>simDropPred(st,c), meas, 0.05, 3);
      out={kind:"cd", value:cd, reach:cd==null, meas:meas,
           tolT: st.simfit==="cd" ? Math.max(0.1,0.05*meas) : Math.max(0.003,0.15*meas)}; } }
  return (_bestCache[sig]=out);
}

function makeSim(root,st){
  const cv=root.querySelector("canvas"), ro=root.querySelector(".plotreadout"),
        sl=root.querySelector("input[type=range]"), val=root.querySelector(".simval");
  const ctx2=cv.getContext("2d"), F=simFields(st);
  const isE = st.sim!=="drop";
  const lo = st.sim==="superball" ? 0.50 : isE ? 0.30 : st.simfit==="cd-second" ? 0.20 : 0.10;
  const hi = st.sim==="superball" ? 0.98 : isE ? 0.99 : st.simfit==="cd-second" ? 1.20 : 2.50;
  if(sl){ sl.min=lo; sl.max=hi; sl.step=0.01; }
  const stateKey = F.fit || ("sim_"+st.id);          // a step with no fit box still remembers its slider
  const dpFit = F.fitField && Number.isFinite(F.fitField.dp) ? F.fitField.dp : 2;
  const start = Number.isFinite(S.answers[stateKey]) ? S.answers[stateKey]
              : (isE ? (st.sim==="superball" ? 0.55 : 0.40) : 2.20);   // far from any real ball or filter, so the fit is a find
  // A follow-up step with no fit box of its own (a concept question asked over the same data) opens the
  // slider where the student left it on the step it follows, not at the default.
  let start0=start, priorFit=false;
  if(!F.fit && !Number.isFinite(S.answers[stateKey])){
    for(let i=S.step-1;i>=0;i--){ const p=NARR[i];
      if(p.top==="sim" && p.sim===st.sim && String(p.balls)===String(st.balls)){ const f=simFields(p).fit;
        if(f && Number.isFinite(S.answers[f])){ start0=S.answers[f]; priorFit=true; break; } } } }
  if(sl) sl.value=Math.min(hi,Math.max(lo,start0));
  let raf=null, alive=true;
  // `simSlider: no` (Sportsball's ping-pong finale, Daniel 2026-10-11): no slider; the model sits at the e the
  // student fit on the earlier step, or — if they never did (teacher mode, sample data) — at the best fit.
  const noSlider = st.simSlider==="no";   // bounce/superball: e; a drop (the coffee filter's concept questions): C_d
  const cur=()=>sl ? parseFloat(sl.value) : noSlider ? (priorFit ? start0 : ((simBest(st)||{}).value ?? start0)) : NaN;
  const showVal=()=>{ if(val) val.textContent=cur().toFixed(2); };
  if(sl) sl.addEventListener("input",()=>{
    const v=cur(); S.answers[stateKey]=v;
    if(F.fit){ S.raw[F.fit]=v.toFixed(dpFit); S.answers[F.fit]=parseFloat(v.toFixed(dpFit));
      const box=document.querySelector('#stepbody input[data-key="'+F.fit+'"]'); if(box) box.value=S.raw[F.fit];
      S.answers["ok"+S.step]=false; const fb=$("deckfb"); if(fb) fb.innerHTML=""; if(typeof refreshNext==="function") refreshNext(); }
    showVal(); schedule(); });
  function schedule(){ if(raf) return; raf=requestAnimationFrame(()=>{ raf=null; if(alive) draw(); }); }

  // ---------- drawing helpers (canvas-local; the same house axis rule as the analyzer) ----------
  let W=0,H=0;
  function fit(){ const r=cv.getBoundingClientRect(), d=window.devicePixelRatio||1;
    cv.width=Math.max(1,r.width*d); cv.height=Math.max(1,r.height*d); ctx2.setTransform(d,0,0,d,0,0); W=r.width; H=r.height; }
  const C=v=>getCss(v);
  function frame(x0,x1,y0,y1,yVar,yUnit,box){
    const mL=box.l, mT=box.t, pw=box.w, ph=box.h;
    let Tx=niceTicks(x0,x1,box.xt||7); const Ty=niceTicks(y0,y1,box.yt||5);
    // `exactX`: use the asked-for time range rather than snapping it out to round ticks — the bounce plot
    // starts a hair before t = 0, and snapping that to −0.5 s would waste a seventh of the panel
    if(box.exactX) Tx={lo:x0, hi:x1, step:Tx.step, ticks:Tx.ticks.filter(v=>v>=x0-1e-9 && v<=x1+1e-9)};
    const X=t=>mL+(t-Tx.lo)/(Tx.hi-Tx.lo)*pw, Y=y=>mT+(Ty.hi-y)/(Ty.hi-Ty.lo)*ph;
    ctx2.font=font(11); ctx2.textAlign="right"; ctx2.textBaseline="middle";
    Ty.ticks.forEach(v=>{ const y=Y(v); ctx2.strokeStyle=C(v===0?"--zero":"--grid"); ctx2.lineWidth=1;
      ctx2.beginPath(); ctx2.moveTo(mL,y); ctx2.lineTo(mL+pw,y); ctx2.stroke();
      if(!box.noLabels){ ctx2.fillStyle=C("--muted"); ctx2.fillText(fmt(v), mL-7, y); } });
    ctx2.strokeStyle=C("--line"); ctx2.beginPath(); ctx2.moveTo(mL,mT); ctx2.lineTo(mL,mT+ph); ctx2.lineTo(mL+pw,mT+ph); ctx2.stroke();
    if(!box.noLabels){
      ctx2.textAlign="center"; ctx2.textBaseline="top"; ctx2.fillStyle=C("--muted");
      Tx.ticks.forEach(v=>ctx2.fillText(fmt(v), X(v), mT+ph+6));
      // axis titles: variable italic, unit roman (house style)
      ctx2.save(); ctx2.translate(mL-44,mT+ph/2); ctx2.rotate(-Math.PI/2); ctx2.textBaseline="alphabetic"; ctx2.textAlign="left";
      ctx2.font=ifont(12); const vw=ctx2.measureText(yVar).width; ctx2.font=font(12); const uw=ctx2.measureText(" ("+yUnit+")").width;
      ctx2.fillStyle=C("--muted"); ctx2.font=ifont(12); ctx2.fillText(yVar,-(vw+uw)/2,0); ctx2.font=font(12); ctx2.fillText(" ("+yUnit+")",-(vw+uw)/2+vw,0);
      ctx2.restore();
      ctx2.textAlign="left"; ctx2.textBaseline="alphabetic"; ctx2.font=ifont(12); const tw=ctx2.measureText("t").width; ctx2.font=font(12);
      const tw2=ctx2.measureText(" (s)").width, xx=mL+pw/2-(tw+tw2)/2; ctx2.fillStyle=C("--muted");
      ctx2.font=ifont(12); ctx2.fillText("t",xx,mT+ph+32); ctx2.font=font(12); ctx2.fillText(" (s)",xx+tw,mT+ph+32); }
    return {X,Y,Tx,Ty,box};
  }
  function curve(F2,pts,dx,color,w,dash){ ctx2.save(); ctx2.beginPath(); ctx2.rect(F2.box.l,F2.box.t,F2.box.w,F2.box.h); ctx2.clip();
    ctx2.strokeStyle=C(color); ctx2.lineWidth=w; if(dash) ctx2.setLineDash(dash); ctx2.beginPath();
    pts.forEach((p,i)=>{ const x=F2.X(p[0]+dx), y=F2.Y(p[1]); i?ctx2.lineTo(x,y):ctx2.moveTo(x,y); }); ctx2.stroke(); ctx2.restore(); }
  function vline(F2,t,color,dash,w){ const x=F2.X(t); ctx2.save(); ctx2.strokeStyle=C(color); ctx2.lineWidth=w||1.5; if(dash) ctx2.setLineDash(dash);
    ctx2.beginPath(); ctx2.moveTo(x,F2.box.t); ctx2.lineTo(x,F2.box.t+F2.box.h); ctx2.stroke(); ctx2.restore(); }
  // AMBER dimension arrows for the difference between where the model lands and where the student's blue
  // line is: two short arrows OUTSIDE the gap pointing in, the way a drawing dimensions a gap too narrow to
  // hold its own arrows — the same amber as the deviation text in the readout (Daniel, 2026-10-11).
  const ARROW_FRAC=0.4;
  // Drawn only once the fit is CLOSE (the caller passes `tol`, s): far off, the model's k-th bounce sits nearer
  // the student's (k±1)-th, and arrows pairing the wrong lines read as nonsense. A zero gap still draws — the
  // two arrowheads meet tip to tip, which is the picture of "on it" (Daniel, 2026-10-11).
  function gapArrows(F2,ta,tb,tol){
    if(tol!=null && !(Math.abs(ta-tb)<=tol)) return;
    let x1=F2.X(Math.min(ta,tb)), x2=F2.X(Math.max(ta,tb));
    const y=F2.box.t+F2.box.h-8, L=16, hd=6, col=C("--edge");
    ctx2.save(); ctx2.beginPath(); ctx2.rect(F2.box.l-L-2,F2.box.t,F2.box.w+2*L+4,F2.box.h); ctx2.clip();
    ctx2.strokeStyle=col; ctx2.fillStyle=col; ctx2.lineWidth=1.6;
    const arrow=(xTip,dir)=>{ ctx2.beginPath(); ctx2.moveTo(xTip-dir*L,y); ctx2.lineTo(xTip-dir*1.5,y); ctx2.stroke();
      ctx2.beginPath(); ctx2.moveTo(xTip,y); ctx2.lineTo(xTip-dir*hd,y-hd*0.6); ctx2.lineTo(xTip-dir*hd,y+hd*0.6); ctx2.closePath(); ctx2.fill(); };
    arrow(x1,+1); arrow(x2,-1);
    ctx2.restore();
  }
  function tick(F2,t,color,up){ const x=F2.X(t), y=F2.box.t+F2.box.h; ctx2.strokeStyle=C(color); ctx2.lineWidth=2;
    ctx2.beginPath(); ctx2.moveTo(x,y); ctx2.lineTo(x,y-(up||8)); ctx2.stroke(); }
  function legend(items,xRight,y0){ ctx2.font=font(12); ctx2.textBaseline="middle"; ctx2.textAlign="left";
    let y=y0||16; const xR=xRight||W-14; const wmax=Math.max.apply(null,items.map(it=>ctx2.measureText(it[1]).width));
    items.forEach(it=>{ const x=xR-wmax-26; ctx2.strokeStyle=C(it[0]); ctx2.lineWidth=2.5; if(it[2]) ctx2.setLineDash(it[2]);
      ctx2.beginPath(); ctx2.moveTo(x,y); ctx2.lineTo(x+18,y); ctx2.stroke(); ctx2.setLineDash([]);
      ctx2.fillStyle=C("--ink"); ctx2.fillText(it[1],x+24,y); y+=18; }); }
  function message(txt){ ctx2.fillStyle=C("--muted"); ctx2.font=font(15); ctx2.textAlign="center"; ctx2.textBaseline="middle"; ctx2.fillText(txt,W/2,H/2); ro.style.display="none"; }
  function readout(html){ ro.style.display="block"; ro.innerHTML=html; }
  const ms=x=>Math.abs(x)<0.0095 ? (x*1000).toFixed(1) : (x*1000).toFixed(0);

  // EMPTY STATE: until the step has the student's number, the plot area shows the object's title card — name,
  // mass, size, drawn to scale — with one line saying what to type (Daniel, 2026-10-11). A blind drop keeps its
  // card until the number has passed Enter.
  const plotEl=root.querySelector(".sim-plot"), ctlEl=root.querySelector(".sim-ctl");
  const cardEl=document.createElement("div"); cardEl.className="sim-card"; (plotEl.parentElement||plotEl).appendChild(cardEl);   // over the whole top panel, so it sits where a plain ball card does
  // `cardBalls:` — the card and the corner avatar show only these (the five-filter test: just the stack).
  const cardKs=(st.cardBalls ? String(st.cardBalls).split(",").map(x=>x.trim()) : (st.balls||[])).filter(k=>ballCfg()[k]);
  // The stairwell comparisons (`simfit:"fixed"`) color each ball's model curve with CONFIG.sim.pairColors and name
  // the colors by the avatar labels instead of a legend (Daniel, 2026-10-11).
  const pairCol = (st.sim==="drop" && st.simfit==="fixed" && Array.isArray(simCfg().pairColors)) ? simCfg().pairColors : null;
  // Every drop step names its curves by the avatar labels in the corner, colored to match, and the legend keeps
  // only "no drag" (Daniel, 2026-10-11): stairwell purple/red, coffee filters green/purple. The avatars there are
  // ALL the step's balls (the five-filter test's card shows just the stack, but its plot draws both models).
  const dropCol = st.sim==="drop" ? (pairCol || ["--result","--mma-purple"]) : null;
  const badgeKs = st.sim==="drop" ? (st.balls||[]).filter(k=>ballCfg()[k]) : cardKs;
  let cardOn=null;
  // …and once the data is in and the card gives way to the plot, the ball stays on as a small avatar + name in
  // the plot's top-right corner, so the graph still says WHAT fell or bounced (Daniel, 2026-10-11). To scale
  // among themselves when there are two; the larger is ~22 px tall.
  const badgeEl = badgeKs.length ? (()=>{ const B=ballCfg(), el=document.createElement("div"); el.className="sim-badge";
    el.innerHTML=badgeKs.map((k,j)=>'<span class="sb-item"><span class="sb-art">'+ballArt(B[k])+'</span><span class="sb-name"'
      +(dropCol&&dropCol[j]?' style="color:'+getCss(dropCol[j])+'"':'')+'>'+ballName(B[k])+'</span></span>').join("");
    const maxH=Math.max.apply(null,badgeKs.map(k=>(B[k].D||0.05)*100*ballAspect(B[k]))), maxD=Math.max.apply(null,badgeKs.map(k=>(B[k].D||0.05)*100));
    const pxcm=Math.min(22/maxH, 34/maxD); el.querySelectorAll(".bc-ball").forEach(x=>sizeBall(x,pxcm));
    plotEl.appendChild(el); return el; })() : null;
  function cardHint(){
    if(simBlind(st)) return st.simfit==="stack" ? ""      // the five-filter card speaks for itself (Daniel, 2026-10-11)
                                                : "Type your gap below. The model appears here once it&rsquo;s in.";
    return "";   // a plain data step: the card itself is the cue, and the instructions are in the prose below (Daniel, 2026-10-11)
  }
  function needsCard(){
    if(!cardKs.length) return false;
    if(simBlind(st)) return S.answers["ok"+S.step]!==true;
    const t=simTimes(st);
    return st.sim==="bounce" ? !t.length : !Number.isFinite(t[0]);
  }
  function showCard(on){
    if(on===cardOn){ if(on) fitBallCard(cardEl,cardKs,parseFloat(st.ballScale)||1); return; }
    cardOn=on; cardEl.classList.toggle("on",on); cv.style.visibility=on?"hidden":""; if(ctlEl) ctlEl.style.visibility=on?"hidden":"";
    if(badgeEl) badgeEl.classList.toggle("on",!on);
    if(on){ ro.style.display="none"; cardEl.innerHTML=ballCardHTML(cardKs, st.simTitle||"", cardHint()); fitBallCard(cardEl,cardKs,parseFloat(st.ballScale)||1); }
  }
  function draw(){
    fit(); ctx2.clearRect(0,0,W,H);
    if(needsCard()){ showCard(true); return; }
    showCard(false);
    const box={l:62, t:30, w:Math.max(50,W-62-20), h:Math.max(40,H-30-44)};   // t:30 — the readout line sits above the plot, not on it
    const v=cur();
    if(st.sim==="bounce") return drawBounce(box,v);
    if(st.sim==="superball") return drawSuper(box,v);
    return drawDrop(box,v);
  }
  // the readout line: GREEN says what the model is, AMBER says how far it sits from what you measured
  // GREEN (or white, when two model curves share the plot) says what the model is; AMBER is the difference
  const roLine=(model,ctx,ink)=>readout('<span class="ro"'+(ink?' style="color:var(--ink)"':'')+'>'+model+(ctx?'<span class="ro-ctx"> · '+ctx+'</span>':'')+'</span>');
  function drawBounce(box,e){
    const tau=simTimes(st), n=Math.max(F.times.length,tau.length);
    if(!tau.length) return message("Type your hop times below — each bounce appears here as a blue line.");
    const M=simBounceModel(st,e,n,true);
    const stamps=[0]; tau.forEach(T=>stamps.push(stamps[stamps.length-1]+T));      // what the stopwatch heard
    // The model's way IN to bounce 1: the last 15 cm of the fall, at the arrival speed its first hop implies
    // (leaving at g·τ₁/2, arriving at that over e), fading in over the top 5 cm. It shows that t = 0 is the
    // first bounce, not the release (Daniel, 2026-10-08).
    const APPROACH=0.15, FADE=0.05, vin = st.simfit==="e-drag" ? null : SIM_G*M[0].T/2/Math.max(e,0.05);
    let sIn=0; if(vin){ const d=vin*vin-2*SIM_G*APPROACH; sIn = d>=0 ? (vin-Math.sqrt(d))/SIM_G : vin/SIM_G; }
    let tmod=0, peak=APPROACH; M.forEach(H2=>{ tmod+=H2.T; H2.pts.forEach(p=>peak=Math.max(peak,p[1])); });
    const tEnd=Math.max(stamps[stamps.length-1],tmod)*1.03;
    const F2=frame(-Math.max(sIn*1.6, tEnd*0.03), tEnd, 0, peak*100*1.12, "y","cm",Object.assign({exactX:true},box));
    stamps.forEach(t=>vline(F2,t,"--trace",null,2));
    if(vin){ const yAt=t=>-vin*t-0.5*SIM_G*t*t, N=48;
      ctx2.save(); ctx2.beginPath(); ctx2.rect(box.l,box.t,box.w,box.h); ctx2.clip();
      ctx2.strokeStyle=C("--result"); ctx2.lineWidth=1.75;
      for(let i=0;i<N;i++){ const ta=-sIn+sIn*i/N, tb=-sIn+sIn*(i+1)/N, ym=yAt((ta+tb)/2);
        ctx2.globalAlpha=Math.max(0,Math.min(1,(APPROACH-ym)/FADE));
        ctx2.beginPath(); ctx2.moveTo(F2.X(ta),F2.Y(yAt(ta)*100)); ctx2.lineTo(F2.X(tb),F2.Y(yAt(tb)*100)); ctx2.stroke(); }
      ctx2.restore(); }
    const toCm=pts=>pts.map(p=>[p[0],p[1]*100]);
    let t1=0; const gaps=[]; M.forEach((H2,k)=>{ curve(F2,toCm(H2.pts),t1,"--result",1.75); t1+=H2.T;
      if(k+1<stamps.length) gaps.push([t1,stamps[k+1],stamps[k+1]-stamps[k]]); });
    // all or none: every model bounce within 40% of that hop of the student's line, or no arrows at all
    if(gaps.length && gaps.every(g=>Math.abs(g[0]-g[1])<=ARROW_FRAC*g[2])) gaps.forEach(g=>gapArrows(F2,g[0],g[1]));
    // `simRatios: yes` — over each hop after the first, the student's own τ(k+1)/τ(k), in their blue, so the creep
    // in the ratios (ping-pong: air drag) is read straight off the plot (Daniel, 2026-10-11).
    if(st.simRatios && tau.length>1){
      ctx2.save(); ctx2.fillStyle=C("--trace"); ctx2.textAlign="center"; ctx2.textBaseline="top";
      const sub=n=>String(n).split("").map(d=>"₀₁₂₃₄₅₆₇₈₉"[+d]).join("");
      for(let k=1;k<tau.length;k++){ const xm=F2.X((stamps[k]+stamps[k+1])/2), r=tau[k]/tau[k-1];
        ctx2.font=font(12); ctx2.fillText("τ"+sub(k+1)+" / τ"+sub(k), xm, box.t+8);
        ctx2.font="600 18px "+getCss("--font-sans"); ctx2.fillText(r.toFixed(3), xm, box.t+26); }
      ctx2.restore(); }
    const mf=simMisfit(st,e);
    roLine('model: constant <i>e</i>, '+(st.simfit==="e-drag"?'with':'no')+' drag in air',
           mf!=null ? 'average deviation from your bounces: '+ms(mf)+' ms' : 'type another hop time to compare');
  }
  function drawSuper(box,e){
    const c=simCfg(), N=c.superballBounces||10, h=simHeight(st), t1=Math.sqrt(2*h/SIM_G);
    const Tm=simTimes(st)[0], Tmod=simSuperT(e,h,N);
    const F2=frame(0,Math.max(Tmod,Number.isFinite(Tm)?Tm:0)*1.04,0,h*1.08,"y","m",box);
    if(Number.isFinite(Tm)){ vline(F2,Tm,"--trace",null,2);
      ctx2.fillStyle=C("--trace"); ctx2.font=font(12); ctx2.textAlign="right"; ctx2.textBaseline="bottom";
      ctx2.fillText("your "+N+"th bounce", F2.X(Tm)-6, box.t+box.h-20); }
    const fall=[]; for(let i=0;i<=40;i++){ const s=t1*i/40; fall.push([s,h-0.5*SIM_G*s*s]); }
    curve(F2,fall,0,"--result",1.75);
    let t=t1;
    for(let k=1;k<N;k++){ const T=2*t1*Math.pow(e,k); curve(F2,simParab(T),t,"--result",1.75); t+=T; }
    if(Number.isFinite(Tm)) gapArrows(F2,t,Tm,2*t1*Math.pow(e,N-1));   // within one (last) hop: a 0.01 step in e moves the 10th bounce ~0.25 s
    const d=Number.isFinite(Tm) ? Tmod-Tm : null;
    roLine('model: constant <i>e</i>, no drag in air',
      d==null ? 'type your time below' : Math.abs(d)<0.005 ? 'its '+N+'th bounce lands on yours'
              : 'its '+N+'th bounce is '+Math.abs(d).toFixed(2)+' s '+(d>=0?'after':'before')+' yours');
  }
  function drawDrop(box,cd){
    if(simBlind(st) && S.answers["ok"+S.step]!==true){
      ctx2.textAlign="center"; ctx2.textBaseline="middle"; ctx2.fillStyle=C("--ink"); ctx2.font="600 44px "+getCss("--font-sans");
      ctx2.fillText(st.simTitle||"Your measurement first", W/2, H/2-14);
      ctx2.fillStyle=C("--muted"); ctx2.font=font(15);
      ctx2.fillText("The model appears here once your gap is in.", W/2, H/2+30);
      ro.style.display="none"; return; }
    const h=simHeight(st), P=simDropSet(st,cd), meas=simTimes(st)[0];
    const lands=P.map(p=>simFallTime(p.b,p.cd,h)), t0=Math.sqrt(2*h/SIM_G);
    const stack=st.simfit==="stack", two=P.length===2 && !stack, fixed=st.simfit==="fixed";
    const xMax=Math.max.apply(null,lands.concat([t0, (!two&&Number.isFinite(meas))?meas:0]))*1.05;
    // the two-ball steps keep the right third of the panel for the zoom on the landing
    const mainBox = two ? {l:box.l,t:box.t,w:box.w*0.56,h:box.h} : box;
    const F2=frame(0,xMax,0,h*1.08,"y","m",mainBox);
    const nofall=[]; for(let i=0;i<=40;i++){ const s=t0*i/40; nofall.push([s,h-0.5*SIM_G*s*s]); }
    // The stairwell comparisons (`simfit:"fixed"`) leave the no-drag curve out: the question there is the GAP
    // between two drag curves, and a third line only crowds it (Daniel, 2026-10-11). The filter steps keep it.
    if(!fixed) curve(F2,nofall,0,"--muted",1.25,[5,4]);
    const COL=dropCol;
    P.forEach((p,j)=>{ const pts=[]; const T=lands[j]; for(let i=0;i<=80;i++){ const s=T*i/80; pts.push([s,Math.max(0,simFallY(p.b,p.cd,h,s))]); }
      curve(F2,pts,0,COL[j],2); });
    if(!two && Number.isFinite(meas)){ vline(F2,meas,"--trace",null,2);
      ctx2.fillStyle=C("--trace"); ctx2.font=font(12); ctx2.textAlign="right"; ctx2.textBaseline="bottom"; ctx2.fillText("you timed "+meas.toFixed(2)+" s", F2.X(meas)-6, box.t+box.h-20); }
    // the balls are named by the colored avatar labels; the legend is just the dashed no-drag curve
    const items = fixed ? [] : [["--muted","no drag",[5,4]]];
    if(items.length) legend(items, two ? mainBox.l+mainBox.w-6 : null, two || !badgeEl ? null : 46);   // stairwell: the colored avatar labels are the key   // one-ball legend sits under the avatar
    const gap = two ? lands[1]-lands[0] : null;
    if(two){
      // ZOOM on the landings: the whole fall is about a second and the gap is tens of ms, a few pixels on the
      // main plot. A thin gray box marks the patch of the main plot that is magnified, another frames the
      // magnified view, and a line joins them (Daniel, 2026-10-08).
      const zb={l:mainBox.l+mainBox.w+100, t:box.t+24, w:box.w-mainBox.w-108, h:box.h-44, xt:4, yt:4};
      const a=Math.min(lands[0],lands[1]), b=Math.max(lands[0],lands[1], lands[0]+(Number.isFinite(meas)?meas:0));
      const pad=Math.max(0.012,(b-a)*0.5); const za=a-pad, zbb=b+pad;
      let yTop=0; P.forEach(p=>{ yTop=Math.max(yTop, simFallY(p.b,p.cd,h,Math.max(0,za))); });
      yTop=Math.max(0.02,yTop);
      const Z=frame(za,zbb,0,yTop,"y","m",zb);
      const zTop=Z.Ty.hi, zLo=Z.Tx.lo, zHi=Z.Tx.hi;
      if(Number.isFinite(meas)){ vline(Z,lands[0],"--trace",null,2); vline(Z,lands[0]+meas,"--trace",null,2); }
      P.forEach((p,j)=>{ const pts=[]; for(let i=0;i<=60;i++){ const s=zLo+(Math.min(zHi,lands[j])-zLo)*i/60; pts.push([s,Math.max(0,simFallY(p.b,p.cd,h,s))]); } curve(Z,pts,0,COL[j],2); });
      // the two boxes and the line that says they are the same place
      const g=C("--muted"); ctx2.save(); ctx2.strokeStyle=g; ctx2.lineWidth=1; ctx2.globalAlpha=0.7;
      let sx0=F2.X(zLo), sx1=F2.X(zHi); if(sx1-sx0<8){ const m=(sx0+sx1)/2; sx0=m-4; sx1=m+4; }
      let sy0=F2.Y(zTop), sy1=F2.Y(0); if(sy1-sy0<8) sy0=sy1-8;
      ctx2.strokeRect(sx0,sy0,sx1-sx0,sy1-sy0);
      const ob={x:zb.l-60, y:zb.t-24, w:zb.w+68, h:zb.h+64};
      ctx2.strokeRect(ob.x,ob.y,ob.w,ob.h);
      ctx2.beginPath(); ctx2.moveTo(sx1,(sy0+sy1)/2); ctx2.lineTo(ob.x,ob.y+ob.h/2); ctx2.stroke();
      ctx2.restore();
      ctx2.fillStyle=C("--muted"); ctx2.font=font(11); ctx2.textAlign="left"; ctx2.textBaseline="top"; ctx2.fillText("zoom: the last moments", ob.x+6, ob.y+5);
      const yb=Z.box.t+Z.box.h;
      const bracket=(x1,x2,y,color,label)=>{ ctx2.strokeStyle=C(color); ctx2.fillStyle=C(color); ctx2.lineWidth=2;
        ctx2.beginPath(); ctx2.moveTo(x1,y-5); ctx2.lineTo(x1,y); ctx2.lineTo(x2,y); ctx2.lineTo(x2,y-5); ctx2.stroke();
        ctx2.font=font(12); ctx2.textAlign="left"; ctx2.textBaseline="bottom"; ctx2.fillText(label, Math.min(x1,x2)+3, y-7); };
      bracket(Z.X(lands[0]),Z.X(lands[1]),yb-46,"--result","model gap "+ms(gap)+" ms");
      if(Number.isFinite(meas)) bracket(Z.X(lands[0]),Z.X(lands[0]+meas),yb-14,"--trace","you measured "+ms(meas)+" ms");
    }
    if(!two && Number.isFinite(meas)) gapArrows(F2,lands[lands.length-1],meas,0.15*meas);   // within 15% of their time
    if(fixed){                     // the zoom's brackets already carry both gaps; the label just names the model
      const cds=[...new Set(P.map(p=>p.cd.toFixed(2)))];
      roLine('model: smooth spheres, <i>C</i><sub>d</sub> = '+cds.join(" and "), null, true);
    } else if(two){
      roLine('model: quadratic drag', 'model gap '+ms(gap)+' ms'+(Number.isFinite(meas)?' · you measured '+ms(meas)+' ms':''), true);
    } else {
      const L=lands[lands.length-1], d=Number.isFinite(meas) ? L-meas : null, who=stack ? (P[P.length-1].b.name||"the model")+": " : "";
      roLine(stack ? 'model: quadratic drag, <i>C</i><sub>d</sub> = '+P[0].cd.toFixed(2)+(st.simCdKey&&Number.isFinite(S.answers[st.simCdKey])?' (your fit)':'') : 'model: quadratic drag',
        d==null ? 'type your time below' : who+(Math.abs(d)<0.005 ? 'lands on yours'
        : 'lands '+Math.abs(d).toFixed(2)+' s '+(d>=0?'after':'before')+' yours'), stack);
    }
  }

  showVal(); schedule();
  return {
    stop(){ alive=false; if(raf) cancelAnimationFrame(raf); },
    redraw(){ schedule(); },
    onInput(key){ if(sl && F.fit && key===F.fit && Number.isFinite(S.answers[key])){ sl.value=Math.min(hi,Math.max(lo,S.answers[key])); showVal(); } schedule(); },
    // test hooks
    _draw: draw, _slider: sl
  };
}
function simSliderLabel(st){
  if(st.sim!=="drop") return "<i>e</i>";
  if(st.simfit==="cd-second") return (simBall((st.balls||[])[1]).name||"second ball")+" <i>C</i><sub>d</sub>";
  return st.simfit==="cd-shared" ? "<i>C</i><sub>d</sub> (both balls)" : "<i>C</i><sub>d</sub>";
}

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
window.addEventListener("resize",()=>{ if(activeSim) activeSim.redraw(); if(activeBallFit) activeBallFit(); });
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

