/* spoon-capture.js — the phone's camera as the instrument, inside an analyzer deck (2026-11-12).

   WHAT IT IS. An add-on to analyzer-engine.js, loaded after it by a deck that has `cam:` steps (first:
   Workshop 5, Lukewarm). live-capture.js is its model and its sibling: that one streams an accelerometer,
   this one streams pictures. A phone on a stand looks at a color-changing spoon lying on the printed
   template (Workshop5-Lukewarm/spoon-template.pdf). The phone page
   (danbenquinn.github.io/classes/spoon/cam.html) sends one JPEG a second over Supabase Realtime; this file
   finds the template's four black squares in each picture, reads the spoon's color at two points, and
   turns it into "color change": 0 = the cold color, 1 = the warm color. That series lands in the step's
   slot exactly as a loaded file would, so Fit Exponential, the Signal lock and the checks are unchanged.

   It replaces the standalone bench viewer (lab-suite/spoon-prototype/viewer.html), which stays as the
   diagnostic tool it was built to be. The analysis is the same code: spoon-lib.js + spoon-geom.js, loaded
   by the deck before this file.

   THREE KINDS OF STEP.
     cam:{ warm:true }                 the setup step. A QR code; once the phone is streaming, the live picture
                                       with the template's outline drawn over it; then "Save warm color" with
                                       the WARM, DRY spoon on the outline. The step is done when a warm color
                                       is saved. Every later run measures its color change against it.
     cam:{ slots:["ctl"], seconds:300 } a run. Record, and the deck takes exactly `seconds` of pictures and
                                       stops by itself (Daniel, 2026-11-12: students do not decide when a run
                                       ends). Then Try again / Accept, as in live-capture.js. The only button
                                       while recording is "Start over", for a hand left in the picture.

     cam:{ slots:["ctl"], seconds:150, go:true }
                                       a run whose wait is filled with questions. Next unlocks as soon as the
                                       recording is under way, and the run keeps recording across the steps
                                       that follow it, which are
     cam:{ slots:["ctl"], seconds:150, watch:true }           a question to answer while it records, and
     cam:{ slots:["ctl"], seconds:150, watch:true, hold:true } the last of them, which also waits for the run
                                       to finish and be Accepted. Every one of these carries the same card, so a
                                       run can be accepted, or thrown away and recorded again, from any of them.
                                       Walking off these steps mid-run (Back past the first, or teacher mode
                                       past the last) abandons the run.

   THE NUMBERS. Cold = the mean of the first three pictures after Record (the student lays the cold spoon
   down, gets their hand out, then presses Record). Warm = the saved warm color, the mean of three pictures.
   Color change is measured point by point along the straight line from cold to warm in paper-normalized
   RGB (spoon-lib.js `progress`), so it works for any spoon color and cancels the spoon's own shading.
   Three columns are kept: "Bowl" (the bowl's lowest point, where a water drop settles), "Handle" (halfway up
   the handle, below where fingers hold it) and "Tip". The deck's slots are `overlay:true`, so all three draw
   at once while the run records.

   HOW IT HOOKS IN. As live-capture.js does: it wraps renderStep, renderPanel, stepComplete and blockReason
   and changes nothing inside the engine. Teacher mode is untouched (`ungated()` opens every gate, and the
   engine's "Load sample data" fills the slots from the deck's baked bench runs).

   RATE. One picture a second at 640 px is about 50 KB a second per group, and the stream is paused
   (fps 0) whenever the step on screen is not a `cam:` step. See spoon-prototype/README.md. */
(function(){
"use strict";
if(typeof NARR==="undefined" || typeof S==="undefined") return;
if(!NARR.some(st=>st && st.cam)) return;
if(typeof SpoonLib==="undefined"){ console.error("spoon-capture.js: load spoon-geom.js and spoon-lib.js first"); return; }
const L=SpoonLib, G=L.G;

const CCFG = Object.assign({
  camUrl: "https://danbenquinn.github.io/classes/spoon/cam.html",
  supabaseUrl: "https://rdbacwwbeyeqdkswwvjt.supabase.co",           // the poll project, as live-capture.js
  supabaseKey: "sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159",     // publishable: meant to ship in a page
  supabaseJs: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
  fps: 1, size: 640, q: 0.8,
  seconds: 300,
  points: { Bowl:"bowl C", Handle:"handle", Tip:"tip" },   // column name -> spoon-geom point name
  unitLabel: "color (0 cold to 1 warm)",   // no comma: parseCSV splits a header on every comma
}, (typeof CONFIG!=="undefined" && CONFIG && CONFIG.cam) || {});
const PT = Object.keys(CCFG.points).map(col=>({ col, i: G.points.findIndex(p=>p.name===CCFG.points[col]) })).filter(p=>p.i>=0);
const HEAD = ["Time (s)"].concat(PT.map(p=>p.col+" "+CCFG.unitLabel));

// ?livetest=1 on the deck URL: talk to a camera tab in the same browser (BroadcastChannel). For testing the
// flow on one laptop; never what a student opens.
const QS = new URLSearchParams(location.search);
const LOCAL = QS.has("livetest");

/* ------------------------------ the room ------------------------------ */
function newRoom(){ const A="ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), b=>A[b%A.length]).join(""); }
let ROOM = null;
try { ROOM = sessionStorage.getItem("sc-room"); } catch(e){}
if(!ROOM){ ROOM = newRoom(); try { sessionStorage.setItem("sc-room", ROOM); } catch(e){} }
const ME = "v-" + Math.random().toString(36).slice(2,10);
const camHref = ((LOCAL && QS.get("cam")) || CCFG.camUrl) + "?room=" + ROOM + (LOCAL ? "&local=1" : "");

const SC = {
  conn:null, status:"idle", error:null,
  cam:null, lostTimer:null, streaming:false,
  frame:null,            // the newest analyzed picture: {im, sq, H, pts, t}
  lastH:null, recent:[], // the last good fix; the last three pictures' point colors
  warm:null,             // {pts, at, jpg}: the saved warm color
  stepKey:null, target:null,
  recState:"idle",       // idle | rec
  run:null,              // {frames:[{t,pts}], t0, seconds, wall0}
  log:[],
};
window.__spoonCapture = SC;
if(!window.__liveCapture) window.__liveCapture = SC;     // group-submit.js sends `.log` with the submission
const logEv = (ev, extra) => { SC.log.push(Object.assign({ t: Date.now(), step: (NARR[S.step]||{}).id, ev }, extra||{})); };

function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement("script");
  s.src=src; s.onload=res; s.onerror=()=>rej(new Error("could not load the live-capture library")); document.head.appendChild(s); }); }

async function connect(){
  if(SC.conn || SC.status==="connecting") return;
  SC.status="connecting"; SC.error=null; paint();
  try {
    SC.conn = LOCAL ? openLocal() : await openSupabase();
    SC.status="open";
    SC.conn.send({ type:"whois" });
  } catch(e){ SC.status="error"; SC.error=e.message||String(e); }
  paint();
}
async function openSupabase(){
  if(!window.supabase) await loadScript(CCFG.supabaseJs);
  const client = window.supabase.createClient(CCFG.supabaseUrl, CCFG.supabaseKey,
    { realtime:{ params:{ eventsPerSecond: 20 } } });
  const ch = client.channel("accel-"+ROOM, { config:{ broadcast:{ self:false }, presence:{ key: ME } } });
  ch.on("broadcast", { event:"msg" }, ({payload}) => onMsg(payload));
  ch.on("presence", { event:"sync" }, () => {
    const st=ch.presenceState(), list=[];
    for(const k in st){ const m=st[k][0]; if(k!==ME && m) list.push({ id:k, role:m.role }); }
    onPeers(list);
  });
  return new Promise((res,rej)=>{
    let done=false;
    setTimeout(()=>{ if(!done){ done=true; rej(new Error("no answer from the live-capture server")); } }, 12000);
    ch.subscribe(async s=>{
      if(s==="SUBSCRIBED" && !done){ done=true; await ch.track({ role:"viewer" });
        res({ send: m => ch.send({ type:"broadcast", event:"msg", payload:m }) }); }
      else if((s==="CHANNEL_ERROR"||s==="TIMED_OUT") && !done){ done=true; rej(new Error("live-capture connection failed ("+s+")")); }
    });
  });
}
function openLocal(){
  const bc=new BroadcastChannel("accel-"+ROOM), peers=new Map(); let sig="";
  const emit=()=>{ const now=Date.now(); for(const [k,p] of peers) if(now-p.seen>4000) peers.delete(k);
    const list=[...peers].map(([id,p])=>({id,role:p.role})), s=JSON.stringify(list); if(s!==sig){ sig=s; onPeers(list); } };
  bc.onmessage=e=>{ const m=e.data; if(m.__hb){ if(m.leave) peers.delete(m.id); else peers.set(m.id,{role:m.role,seen:Date.now()}); emit(); } else onMsg(m); };
  const beat=()=>bc.postMessage({ __hb:1, id:ME, role:"viewer" });
  beat(); setInterval(()=>{ beat(); emit(); }, 1000);
  addEventListener("pagehide", ()=>bc.postMessage({ __hb:1, id:ME, leave:1 }));
  return { send: m => bc.postMessage(m) };
}

/* ------------------------------ messages ------------------------------ */
function onMsg(m){
  if(!m || !m.type) return;
  if(m.type==="hello" && m.kind==="camera"){
    if(SC.cam && SC.cam!==m.phone){ SC.conn.send({ type:"release", phone:m.phone }); return; }
    if(!SC.cam){ SC.cam=m.phone; logEv("camera-connected"); }
    SC.conn.send({ type:"claim", phone:SC.cam });
    stream(onCamStep());
    paint();
    return;
  }
  if(m.phone!==SC.cam) return;
  if(m.type==="frame") ingest(m.jpg, m.t);
}
function onPeers(list){
  if(!SC.cam) return;
  if(list.some(p=>p.id===SC.cam)){ clearTimeout(SC.lostTimer); SC.lostTimer=null; return; }
  if(SC.lostTimer) return;
  SC.lostTimer=setTimeout(()=>{ SC.lostTimer=null; logEv("camera-lost"); SC.cam=null; SC.frame=null; SC.streaming=false;
    if(SC.recState==="rec"){ abortRun(); SC.error="The phone dropped out mid-run. Scan the code again, cool the spoon again, and record that run again."; }
    paint(); }, 4000);
}
// The stream is on only while a `cam:` step is on screen: a room of 25 groups reading questions sends nothing.
function stream(on){
  if(!SC.conn || !SC.cam) return;
  SC.streaming=!!on;
  SC.conn.send({ type:"config", phone:SC.cam, cfg:{ fps: on ? CCFG.fps : 0, size:CCFG.size, q:CCFG.q } });
}
function onCamStep(){ const st=NARR[S.step]; return !!(st && st.cam); }

/* ------------------------------ pictures ------------------------------ */
const work=document.createElement("canvas"), wctx=work.getContext("2d", { willReadFrequently:true });
let busy=false, waiting=null;
function ingest(jpg, t){                      // drop any picture that arrives while one is being read
  if(busy){ waiting=[jpg,t]; return; }
  busy=true;
  (async()=>{ try { await process(jpg,t); } catch(e){ console.error("spoon-capture:", e); }
    finally { busy=false; if(waiting){ const w=waiting; waiting=null; ingest(w[0],w[1]); } } })();
}
async function process(jpg, t){
  const im=new Image(); im.src=jpg; await im.decode();
  work.width=im.naturalWidth; work.height=im.naturalHeight; wctx.drawImage(im,0,0);
  const data=wctx.getImageData(0,0,work.width,work.height);
  const sq=L.findSquares(data), H = sq ? sq.H : SC.lastH;
  const pts = H ? L.readPoints(data,H) : null;
  if(sq) SC.lastH=sq.H;
  SC.frame={ im, sq:!!sq, H, pts, t, jpg };
  if(pts){ SC.recent.push(pts); if(SC.recent.length>3) SC.recent.shift(); }
  if(SC.recState==="rec" && pts) addFrame(t, pts);
  drawLive();
  paintStatus();
}
const meanPts = list => G.points.map((_,i)=>[0,1,2].map(k=>list.reduce((a,p)=>a+p[i][k],0)/list.length));

function drawLive(){
  const c=document.getElementById("sc-live"), a=SC.frame; if(!c || !a) return;
  const g=c.getContext("2d"), dpr=window.devicePixelRatio||1;
  const box=c.parentElement, boxW=(box&&box.clientWidth)||120, boxH=(box&&box.clientHeight)||150;
  const k=Math.min(boxW/a.im.naturalWidth, boxH/a.im.naturalHeight);
  const w=Math.round(a.im.naturalWidth*k), h=Math.round(a.im.naturalHeight*k);
  if(c.width!==Math.round(w*dpr) || c.height!==Math.round(h*dpr)){ c.width=Math.round(w*dpr); c.height=Math.round(h*dpr); c.style.width=w+"px"; c.style.height=h+"px"; }
  g.setTransform(dpr,0,0,dpr,0,0);
  g.drawImage(a.im,0,0,w,h);
  if(!a.H) return;
  const Pt=(X,Y)=>L.apply(a.H,X,Y).map(v=>v*k);
  // the template's outline where the deck believes it is: if it sits on the printed one, the fix is good
  g.strokeStyle=getCss("--accent")||"#4c8dff"; g.lineWidth=1.5; g.beginPath();
  G.outline.forEach((p,i)=>{ const q=Pt(p[0],p[1]); i ? g.lineTo(q[0],q[1]) : g.moveTo(q[0],q[1]); });
  g.closePath(); g.stroke();
  g.lineWidth=2; g.strokeStyle = a.sq ? (getCss("--ok")||"#3fb950") : (getCss("--edge")||"#d29922");
  G.squares.forEach(p=>{ const q=Pt(p[0],p[1]); g.beginPath(); g.arc(q[0],q[1],6,0,7); g.stroke(); });
  PT.forEach(p=>{ const q=Pt.apply(null,G.points[p.i].xy); g.fillStyle=getCss("--result")||"#3fb950"; g.strokeStyle="#fff"; g.lineWidth=1.5;
    g.beginPath(); g.arc(q[0],q[1],3.5,0,7); g.fill(); g.stroke(); });
}

/* ------------------------------ the warm color ------------------------------ */
function saveWarm(){
  if(!SC.frame || !SC.frame.sq || !SC.recent.length) return;
  SC.warm={ pts:meanPts(SC.recent), at:Date.now(), jpg:SC.frame.jpg };
  logEv("warm-saved");
  paint(); refreshNext();
}

/* ------------------------------ a run ------------------------------ */
function camSlots(st){ return (st && st.cam && [].concat(st.cam.slots || [])) || []; }
function pending(P){ return P && (P._lc==="rec" || P._lc==="review"); }
function nextTarget(st){ const ks=camSlots(st); return ks.find(k=>{ const P=panelByKey(k); return !(P && P.ds && !pending(P)); }) || null; }
function runSeconds(st){ return (st && st.cam && +st.cam.seconds) || CCFG.seconds; }

function begin(){
  const st=NARR[S.step], P=panelByKey(SC.target); if(!P || !SC.cam || !SC.warm || !SC.lastH) return;
  SC.run={ frames:[], t0:null, seconds:runSeconds(st), wall0:performance.now(),
           until: st.cam.until!=null ? +st.cam.until : null, untilCols: [].concat(st.cam.untilCols || [PT[0].col]) };
  SC.recState="rec"; SC.error=null;
  P._lc="rec";
  P.ds=null; P.sel=null; P.point=null; P.efit=null; P.dfit=null; P.fit=null; P.crop=null; P.fileName=null; P.liveRun=null;
  logEv("begin", { slot:P.key, seconds:SC.run.seconds });
  render(); paint(); tick();
}
function tick(){
  if(SC.recState!=="rec") return;
  const R=SC.run, s=(performance.now()-R.wall0)/1000, el=document.getElementById("sc-time");
  if(el){ const left=Math.max(0, Math.ceil(R.seconds-s)); el.textContent=Math.floor(left/60)+":"+String(left%60).padStart(2,"0")+" left"; }
  const bar=document.getElementById("sc-bar"); if(bar) bar.style.width=Math.min(100, 100*s/R.seconds).toFixed(1)+"%";
  if(s>R.seconds+4){ finish(); return; }           // never wait forever on a dropped last picture
  setTimeout(tick, 250);
}
function series2(R){                              // {t:[], cols:{name:[]}} from the run's frames
  const fr=R.frames, cold=meanPts(fr.slice(0,3).map(f=>f.pts)), warm=SC.warm.pts, t0=fr[0].t;
  const out={}; out[HEAD[0]]=fr.map(f=>+((f.t-t0)/1000).toFixed(2));
  PT.forEach((p,j)=>{ out[HEAD[j+1]]=fr.map(f=>{ const v=L.progress(f.pts[p.i], cold[p.i], warm[p.i]); return Number.isFinite(v) ? +v.toFixed(4) : NaN; }); });
  return { headers:HEAD.slice(), cols:out };
}
function addFrame(t, pts){
  const R=SC.run, P=panelByKey(SC.target); if(!P) return;
  R.frames.push({ t, pts });
  let S2=null;
  if(R.frames.length>=4){ S2=series2(R); ingestParsed(S2, P); P.fileName="camera run (recording…)"; }
  const el=(t-R.frames[0].t)/1000;
  if(el >= R.seconds){ finish(); return; }
  // `until:` (2026-11-12): the run also ends early once every column named in `untilCols` (default: the first,
  // the bowl) has stayed at or above that color for five pictures. The slope the step wants is below it, so
  // there is nothing more to wait for. Never before 20 s.
  if(S2 && R.until!=null && el>=20){
    const hs=HEAD.slice(1).filter(h=>R.untilCols.some(c=>h.toLowerCase().indexOf(c.toLowerCase())===0));
    if(hs.length && hs.every(h=>{ const a=S2.cols[h]; return a.length>=8 && a.slice(-5).every(v=>v>=R.until); })) finish();
  }
}
function finish(){
  if(SC.recState!=="rec") return;
  SC.recState="idle";
  const R=SC.run, P=panelByKey(SC.target); if(!P) return;
  if(R.frames.length<10){ P.ds=null; P._lc=undefined; SC.error="Too few pictures came through from the phone. Is its page still open? Cool the spoon again and try again."; render(); paint(); refreshNext(); return; }
  ingestParsed(series2(R), P);
  const n=R.frames.length, dur=(R.frames[n-1].t-R.frames[0].t)/1000;
  P.fileName="camera run";
  P._lcMeta={ n, dur:+dur.toFixed(1), rate: dur>0 ? +((n-1)/dur).toFixed(2) : 0, seconds:R.seconds, warmAt:SC.warm.at };
  P._lc="review";
  logEv("review", { slot:P.key, n, dur:P._lcMeta.dur });
  render(); setReadout(); paint(); refreshNext();
}
function abortRun(){
  SC.recState="idle";
  const P=panelByKey(SC.target);
  if(P && pending(P)){ P.ds=null; P._lc=undefined; P.fileName=null; render(); }
  refreshNext();
}
function tryAgain(){
  const P=panelByKey(SC.target); if(!P) return;
  logEv("try-again", { slot:P.key });
  SC.recState="idle";
  P.ds=null; P._lc=undefined; P.fileName=null; P.sel=null; P.efit=null;
  render(); setReadout(); paint(); refreshNext();
}
function accept(){
  const P=panelByKey(SC.target); if(!P) return;
  P._lc="kept";
  logEv("accept", Object.assign({ slot:P.key }, P._lcMeta||{}));
  P.liveRun={ slot:P.key, axisPlotted:P.sigH, meta:P._lcMeta, data:P.ds && P.ds.cols };   // group-submit.js reads this
  SC.target=nextTarget(NARR[S.step]);
  paint(); refreshNext();
}
function redo(k){
  const P=panelByKey(k); if(!P) return;
  P.ds=null; P._lc=undefined; P.fileName=null; P.sel=null; P.efit=null; P.liveRun=null;
  SC.target=k; logEv("redo", { slot:k });
  if(!SC.cam && SC.conn) SC.conn.send({ type:"whois" });
  render(); setReadout(); paint(); refreshNext();
}

/* ------------------------------ the card ------------------------------ */
let QR_IMG=null;
function qrImg(){
  if(QR_IMG) return QR_IMG;
  try { const q=qrcode(0,"M"); q.addData(camHref); q.make(); QR_IMG=q.createDataURL(6,2); } catch(e){ QR_IMG=""; }
  return QR_IMG;
}
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const mmss = s => Math.floor(s/60)+":"+String(Math.round(s)%60).padStart(2,"0");
const slotName = P => ((P&&P.label)||"").replace(/^.*—\s*/,"");

// The card is rebuilt only when its STATE changes; the live picture and the status line under it repaint in
// place on every picture, so a button is never replaced under a finger.
let lastKey="";
function stateKey(){
  const st=NARR[S.step]; if(!st || !st.cam) return "";
  const T=SC.target ? panelByKey(SC.target) : null;
  return [st.id, SC.status, SC.error||"", SC.cam?1:0, SC.frame?1:0, SC.warm?SC.warm.at:0, SC.recState, SC.target||"", T?T._lc:"", camSlots(st).map(k=>{ const P=panelByKey(k); return P&&P.ds&&!pending(P)?1:0; }).join("")].join("|");
}
// The live picture. On the setup step it is BIG, in the top region (the step is `top: html` and its `html:` holds
// <div class='sc-stage'><canvas id='sc-live'></canvas></div>), because lining the sheet up is the whole step. On
// a run step the plot has the top region, and the picture is a thumbnail in the card: enough to see a hand.
const staged = () => !!document.querySelector("#topmedia #sc-live");
function withLive(inner, noThumb){
  const status='<div class="sc-status" id="sc-status"></div>';
  return (staged() || noThumb) ? inner+status : '<div class="sc-row"><div class="sc-livewrap"><canvas id="sc-live"></canvas></div><div class="sc-col">'+inner+status+'</div></div>';
}
function paintStatus(){
  const el=document.getElementById("sc-status"), a=SC.frame; if(!el) return;
  el.className="sc-status "+(a && a.sq ? "ok" : "warn");
  el.textContent = !a ? "Waiting for the first picture…" : a.sq ? "All four squares found" : (a.H ? "Squares lost: using the last good view" : "Can't find the four black squares yet");
  const b=document.querySelector('#sc-card [data-sc="warm"], #sc-card [data-sc="begin"]');
  if(b) b.disabled = !(a && a.sq) && !(b.dataset.sc==="begin" && SC.lastH);
}
function paint(force){
  const st=NARR[S.step]; const card=document.getElementById("sc-card");
  if(!card || !st || !st.cam) return;
  const key=stateKey(); if(!force && key===lastKey && card.childElementCount){ paintStatus(); return; }
  lastKey=key;
  card.classList.toggle("sc-slim", !!st.cam.watch);
  const ks=camSlots(st);
  if(ks.length && (SC.target==null || ks.indexOf(SC.target)<0)) SC.target=nextTarget(st);
  const T=SC.target ? panelByKey(SC.target) : null;
  let h="";
  if(SC.status==="error"){
    h+='<div class="sc-err">Couldn\'t reach the live-capture server: '+esc(SC.error||"")+'</div>'
     +'<button class="deck-go" data-sc="retry">Try connecting again</button>';
  } else if(!SC.cam && !(T && T._lc==="review") && !(ks.length && !SC.target)){
    h+='<div class="sc-qrrow"><img class="sc-qr" alt="QR code for the phone\'s camera page" src="'+qrImg()+'">'
     +'<div><div class="sc-big">Scan with your phone</div>'
     +'<p class="sc-sub">Open it in Safari or Chrome, tap <b>Start camera</b>, and allow the camera.</p>'
     +'<div class="sc-code">'+ROOM+'</div>'
     +(SC.status==="connecting"?'<p class="sc-sub">connecting…</p>':'')
     +(LOCAL?'<p class="sc-sub"><a href="'+camHref+'" target="_blank">open a test camera tab</a></p>':'')
     +'</div></div>';
    if(SC.error) h+='<div class="sc-err">'+esc(SC.error)+'</div>';
  } else if(!SC.warm && !(ks.length && !SC.target)){
    // no warm color yet: the setup step, or a run step reached without one
    h+=withLive('<div class="sc-big">'+(st.cam.warm ? "Line it up" : "First, the warm color")+'</div>'
     +'<p class="sc-sub">Lay the <b>warm, dry</b> spoon on the outline. When the blue outline sits on the printed one, save its color.</p>'
     +'<button class="deck-go sc-accept" data-sc="warm">Save warm color</button>');
  } else if(st.cam.warm){
    h+=withLive('<div class="sc-big sc-ok">✓ Warm color saved</div>'
     +'<p class="sc-sub">Every run is measured against this. If the phone or the sheet moves, come back and save it again.</p>'
     +'<div class="sc-links"><a href="#" data-sc="rewarm">Save it again</a></div>');
  } else if(!SC.target){
    h+='<div class="sc-big sc-ok">✓ Kept</div><p class="sc-sub">'+(st.cam.watch ? 'The run is in.' : 'Press <b>Next ›</b>.')+'</p>'
     +'<div class="sc-links">'+ks.map(k=>'<a href="#" data-sc="redo" data-k="'+k+'">Record '+esc(ks.length>1?slotName(panelByKey(k)).toLowerCase():"it")+' again</a>').join(" · ")+'</div>';
  } else if(SC.recState==="rec"){
    h+=withLive('<div class="sc-big sc-rec">Recording</div>'
     +'<div class="sc-track"><div id="sc-bar"></div></div>'
     +'<div class="sc-stats"><span id="sc-time">'+mmss(runSeconds(st))+' left</span>'+(st.cam.until!=null?' <span class="sc-atmost">at most</span>':'')+'</div>'
     +'<p class="sc-sub">'+(st.cam.go ? 'It stops by itself. Press <b>Next ›</b>: there are questions to answer while it records.'
                          : st.cam.watch ? 'It stops by itself. Keep hands and shadows off the sheet.'
                          : 'It stops by itself. Keep hands and shadows off the sheet.')+'</p>'
     +'<div class="sc-links"><a href="#" data-sc="again">Start over</a></div>', !!st.cam.watch);
  } else if(T && T._lc==="review"){
    const m=T._lcMeta||{};
    h+='<div class="sc-big">Keep this run?</div>'
     +'<p class="sc-sub">'+(m.n||0)+' pictures over '+mmss(m.dur||0)+'. A smooth rise from near 0? Keep it.</p>'
     +'<div class="sc-btns"><button class="deck-go sc-ghost" data-sc="again">Try again</button>'
     +'<button class="deck-go sc-accept" data-sc="accept">Accept</button></div>';
  } else {
    h+=withLive('<div class="sc-big sc-ok">✓ Camera ready</div>'
     +'<p class="sc-sub">Cold spoon on the outline, hand out, then <b>Record</b>. '+(st.cam.until!=null ? 'It stops by itself once the color has climbed far enough: <b>'+mmss(runSeconds(st))+'</b> at most.' : 'It runs for <b>'+mmss(runSeconds(st))+'</b> and stops by itself.')+'</p>'
     +'<button class="deck-go sc-begin" data-sc="begin"><span class="sc-dot"></span>Record</button>'
     +(SC.error ? '<div class="sc-err">'+esc(SC.error)+'</div>' : ''));
  }
  card.innerHTML=h;
  camSlots(st).forEach(k=>{ const P=panelByKey(k); if(P && P.file && !P.supplied) P.file.style.display="none"; });
  drawLive(); paintStatus();
  if(SC.recState==="rec") tick();
}
function onCardClick(e){
  const a=e.target.closest("[data-sc]"); if(!a) return;
  e.preventDefault();
  const act=a.dataset.sc;
  if(act==="warm") saveWarm();
  else if(act==="rewarm"){ SC.warm=null; logEv("warm-cleared"); paint(); refreshNext(); }
  else if(act==="begin") begin();
  else if(act==="again") tryAgain();
  else if(act==="accept") accept();
  else if(act==="redo") redo(a.dataset.k);
  else if(act==="retry"){ SC.conn=null; SC.status="idle"; connect(); }
}
function mount(st){
  const main=document.querySelector("#stepbody .deck-main"); if(!main) return;
  const card=document.createElement("div"); card.id="sc-card"; card.className="deck-side sc-card";
  card.addEventListener("click", onCardClick);
  main.appendChild(card);
  if(SC.stepKey!==st.id){ SC.stepKey=st.id; SC.target=nextTarget(st); }
  lastKey="";
  connect();
  if(SC.cam && !SC.streaming) stream(true);
  paint(true);
}

/* ------------------------------ the hooks ------------------------------ */
const CAM_SLOTS=[...new Set(NARR.flatMap(st=>camSlots(st)))];
const _renderStep=renderStep;
renderStep=function(){
  _renderStep.apply(this, arguments);
  const st=NARR[S.step];
  // leaving a step mid-run abandons that run: nothing half-recorded survives into a later step
  if(SC.recState!=="idle" && !(st && st.cam && camSlots(st).indexOf(SC.target)>=0)) abortRun();
  if(st && st.cam){ try { mount(st); } catch(e){ console.error("spoon-capture:", e); } }
  else if(SC.cam && SC.streaming) stream(false);
  // A camera slot never wants a file: its data comes from the phone (or, in teacher mode, the baked sample).
  CAM_SLOTS.forEach(k=>{ const P=panelByKey(k); if(P && P.file) P.file.style.display="none"; });
};
// An empty camera slot says how it gets data, not "load the export with the picker above".
const _renderPanel=renderPanel;
renderPanel=function(P){
  const st=NARR[S.step];
  if(st && st.cam && camSlots(st).indexOf(P.key)>=0 && !series(P)){
    const c=P.ctx, W=P.cv.clientWidth, H=P.cv.clientHeight; c.clearRect(0,0,W,H);
    c.fillStyle=getCss("--muted"); c.font=font(14); c.textAlign="center"; c.textBaseline="middle";
    c.fillText(SC.recState==="rec" && SC.target===P.key ? "Recording. The color change draws here in a few seconds."
             : SC.cam ? "Press Record below. The spoon's color change draws here."
             : "Scan the code below with your phone to record into this plot.", W/2, H/2);
    return;
  }
  return _renderPanel.apply(this, arguments);
};
const _stepComplete=stepComplete;
stepComplete=function(i){
  const st=NARR[i];
  if(st && st.cam){
    if(st.cam.warm && !SC.warm) return false;
    const Ps=camSlots(st).map(panelByKey), pend=Ps.some(pending);
    // `go` and a plain `watch` step let the group move on while the run records; the `hold` step, and a run
    // step with neither flag, wait for it to be finished and Accepted.
    if(pend && !(st.cam.go || (st.cam.watch && !st.cam.hold))) return false;
    if(st.cam.hold && !Ps.every(P=>P && P.ds && !pending(P))) return false;
  }
  return _stepComplete.apply(this, arguments);
};
const _blockReason=blockReason;
blockReason=function(i){
  const st=NARR[i];
  if(st && st.cam){
    if(st.cam.warm && !SC.warm) return fbText(st, "data", "Scan the code, line up the sheet, and press <b>Save warm color</b> with the warm, dry spoon on the outline.");
    const Ps=camSlots(st).map(panelByKey), P=Ps.find(pending), free=st.cam.go || (st.cam.watch && !st.cam.hold);
    if(P && !free) return fbText(st, "live", P._lc==="rec" ? "Still recording. It stops by itself, then press <b>Accept</b>."
                                                    : "Press <b>Accept</b> to keep this run, or <b>Try again</b>.");
    if(st.cam.hold && !Ps.every(Q=>Q && Q.ds) && _stepComplete.apply(this, arguments))
      return fbText(st, "data", "There is no run to keep yet. Cool the spoon again and press <b>Record</b>.");
  }
  return _blockReason.apply(this, arguments);
};

/* ------------------------------ styles (house tokens, as live-capture.js) ------------------------------ */
const css=document.createElement("style");
css.textContent=`
#stepbody .sc-card.sc-slim{flex:0 1 250px;min-width:200px;}
#stepbody .sc-card{flex:0 1 380px;min-width:280px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font-size:var(--fs-ui);line-height:1.4;}
.sc-card .sc-qrrow{display:flex;gap:14px;align-items:flex-start;}
.sc-card .sc-qr{width:132px;height:132px;background:#fff;border-radius:6px;padding:6px;image-rendering:pixelated;flex:0 0 auto;}
.sc-card .sc-big{font-size:var(--fs-lead);font-weight:700;margin:0 0 6px;color:var(--ink);}
.sc-card .sc-sub{color:var(--muted);margin:4px 0 8px;}
.sc-card .sc-code{font-family:var(--font-mono);font-size:20px;letter-spacing:.18em;color:var(--ink);margin:4px 0;}
.sc-card .sc-ok{color:var(--ok);}
.sc-card .sc-rec{color:var(--mma-red);display:flex;align-items:center;gap:8px;}
.sc-card .sc-rec::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--mma-red);animation:scpulse 1s ease-in-out infinite;}
@keyframes scpulse{50%{opacity:.25;}}
@media (prefers-reduced-motion:reduce){.sc-card .sc-rec::before{animation:none;}}
.sc-card .sc-row{display:flex;gap:12px;align-items:flex-start;}
.sc-card .sc-col{flex:1 1 auto;min-width:0;}
.sc-card .sc-livewrap{flex:0 0 120px;width:120px;height:160px;background:#000;border-radius:6px;overflow:hidden;display:flex;justify-content:center;align-items:center;}
#sc-live{display:block;}
#topmedia .topcustom:has(.sc-stage){width:100%;height:100%;max-width:none;}
#topmedia .sc-stage{width:100%;height:100%;display:flex;justify-content:center;align-items:center;background:#000;}
.sc-card .sc-status{font-size:var(--fs-label);margin:5px 0 0;color:var(--muted);}
.sc-card .sc-status::before{content:"";display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--edge);}
.sc-card .sc-status.ok::before{background:var(--ok);}
.sc-card .sc-track{height:6px;border-radius:3px;background:var(--line);margin:10px 0 4px;overflow:hidden;}
.sc-card #sc-bar{height:100%;width:0;background:var(--mma-red);}
.sc-card .sc-stats{font-family:var(--font-mono);color:var(--ink);font-variant-numeric:tabular-nums;}
.sc-card .sc-atmost{font-family:var(--font-sans);color:var(--muted);font-size:var(--fs-label);}
.sc-card .sc-btns{display:flex;gap:8px;flex-wrap:wrap;}
.sc-card .sc-begin{background:var(--mma-red);border-color:var(--mma-red);color:#fff;font-weight:700;display:inline-flex;align-items:center;gap:8px;}
.sc-card .sc-begin:hover{filter:brightness(1.12);}
.sc-card .sc-begin:disabled,.sc-card .sc-accept:disabled{opacity:.45;cursor:not-allowed;filter:none;}
.sc-card .sc-begin .sc-dot{width:10px;height:10px;border-radius:50%;background:#fff;}
.sc-card .sc-accept{border-color:var(--ok);color:var(--ok);}
.sc-card .sc-accept:hover:not(:disabled){background:var(--ok);color:var(--bg);}
.sc-card .sc-ghost{border-color:var(--line);color:var(--ink);}
.sc-card .sc-err{color:var(--mma-red);margin:8px 0;}
.sc-card a{color:var(--accent);}
.sc-card .sc-links{font-size:var(--fs-label);margin-top:8px;}
`;
document.head.appendChild(css);

// The engine rendered step 0 before this file loaded; a deck reopened on a camera step needs the card now.
if(NARR[S.step] && NARR[S.step].cam) renderStep();
})();
