/* live-capture.js — the phone as the instrument, inside an analyzer deck (2026-10-14).

   WHAT IT IS. An add-on to analyzer-engine.js, loaded right after it by a deck that has `live:` steps
   (first: the live-capture copy of Workshop 4, Springs Uneternal). A `live:` step shows a QR code. A
   student scans it with the phone they are measuring with; the phone page
   (danbenquinn.github.io/classes/accel/phone.html) streams Acceleration (without g) back over Supabase
   Realtime, and the step's plot fills as it records. Record / Stop / Try again / Accept live in a card
   beside the step's prose. Accept leaves the run in the slot exactly as a loaded phyphox file would, so
   every later step (Fit Damped, the axis lock, the range checks) is unchanged.

   HOW IT HOOKS IN. It wraps four engine globals and changes nothing inside the engine:
     renderStep     → after the engine draws a step, mount the capture card if the step is `live:`
     stepComplete   → a slot whose run is still recording or awaiting Accept does not pass the data gate
     blockReason    → …and says so
     handleFile     → a phyphox file loaded through "Use phyphox instead" counts as a kept run
   Teacher mode is untouched: `ungated()` still opens every gate, mid-capture included.

   THE DATA. The deck receives a table with phyphox's own headers ("Time (s)", "Linear Acceleration
   z (m/s^2)") and hands it to ingestParsed(), the same entry point a file uses. ONLY the step's
   `requireAxis` is recorded (2026-10-15, Daniel: z for the ruler, x for the arm), a third of the traffic,
   so the Signal dropdown holds one entry and is frozen there. The dropdown stays, for a step that someday
   wants more than one axis.

   RATE. Supabase's free plan allows 100 Realtime messages a second for the whole project, and a batch
   counts twice (sent, then delivered). The phone sends ONE batch a second, so a room of 25 pairs all
   recording at once is ~50/s. The live plot therefore grows in one-second steps; it is a cue that the
   recording is alive, not the measurement. */
(function(){
"use strict";
if(typeof NARR==="undefined" || typeof S==="undefined") return;
if(!NARR.some(st=>st && st.live)) return;

const LCFG = Object.assign({
  phoneUrl: "https://danbenquinn.github.io/classes/accel/phone.html",
  supabaseUrl: "https://rdbacwwbeyeqdkswwvjt.supabase.co",           // the poll project (see slide-suite/poll/POLL-SETUP.md)
  supabaseKey: "sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159",     // publishable: meant to ship in a page
  supabaseJs: "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js",
  batchMs: 1000,
  maxSeconds: 120,
}, (typeof CONFIG!=="undefined" && CONFIG && CONFIG.live) || {});

// ?livetest=1 on the deck URL: talk to phone tabs in the same browser (BroadcastChannel) and simulate the
// sensor there. For testing the flow on one laptop; never what a student opens.
const QS = new URLSearchParams(location.search);
const LOCAL = QS.has("livetest");

/* ------------------------------ the room ------------------------------ */
function newRoom(){ const L="ABCDEFGHJKLMNPQRSTUVWXYZ";
  return Array.from(crypto.getRandomValues(new Uint8Array(4)), b=>L[b%L.length]).join(""); }
let ROOM = null;
try { ROOM = sessionStorage.getItem("lc-room"); } catch(e){}
if(!ROOM){ ROOM = newRoom(); try { sessionStorage.setItem("lc-room", ROOM); } catch(e){} }
const ME = "a-" + Math.random().toString(36).slice(2,10);
const phoneHref = ((LOCAL && QS.get("phone")) || LCFG.phoneUrl) + "?room=" + ROOM + (LOCAL ? "&local=1&sim=1" : "");

const LC = {
  conn:null, status:"idle", error:null,
  phone:null, lostTimer:null,
  stepKey:null, target:null,         // slot key being recorded into
  run:null, recState:"idle",         // idle | rec | finishing
  startedAt:0, seen:null, expected:null, buf:null,
  showFile:false,
  log:[],                            // what happened, for the submission (phase 2)
};
window.__liveCapture = LC;
const logEv = (ev, extra) => { LC.log.push(Object.assign({ t: Date.now(), step: (NARR[S.step]||{}).id, ev }, extra||{})); };

function loadScript(src){ return new Promise((res,rej)=>{ const s=document.createElement("script");
  s.src=src; s.onload=res; s.onerror=()=>rej(new Error("could not load the live-capture library")); document.head.appendChild(s); }); }

async function connect(){
  if(LC.conn || LC.status==="connecting") return;
  LC.status="connecting"; LC.error=null; paint();
  try {
    LC.conn = LOCAL ? openLocal() : await openSupabase();
    LC.status="open";
    LC.conn.send({ type:"whois" });
  } catch(e){ LC.status="error"; LC.error=e.message||String(e); }
  paint();
}
async function openSupabase(){
  if(!window.supabase) await loadScript(LCFG.supabaseJs);
  const client = window.supabase.createClient(LCFG.supabaseUrl, LCFG.supabaseKey,
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
      if(s==="SUBSCRIBED" && !done){ done=true; await ch.track({ role:"analyzer" });
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
  const beat=()=>bc.postMessage({ __hb:1, id:ME, role:"analyzer" });
  beat(); setInterval(()=>{ beat(); emit(); }, 1000);
  addEventListener("pagehide", ()=>bc.postMessage({ __hb:1, id:ME, leave:1 }));
  return { send: m => bc.postMessage(m) };
}

/* ------------------------------ messages ------------------------------ */
function onMsg(m){
  if(!m || !m.type) return;
  if(m.type==="hello"){
    if(!LC.phone){ LC.phone=m.phone; LC.conn.send({ type:"claim", phone:LC.phone }); logEv("phone-connected"); paint(); }
    else if(m.phone===LC.phone) LC.conn.send({ type:"claim", phone:LC.phone });
    else LC.conn.send({ type:"busy", phone:m.phone });
    return;
  }
  if(m.phone!==LC.phone) return;
  if(m.type==="data" && m.run===LC.run && LC.buf){
    if(LC.seen.has(m.seq)) return; LC.seen.add(m.seq);
    const B=LC.buf; for(let i=0;i<m.t.length;i++){ B.t.push(m.t[i]); B.a.push(m.a[i]); }
    drawLive();
    if(LC.recState==="finishing" && LC.expected!=null && LC.seen.size>=LC.expected) finish();
  } else if(m.type==="done" && m.run===LC.run){
    LC.expected=m.batches; if(LC.seen.size>=m.batches) finish();
  } else if(m.type==="error"){
    logEv("phone-error", { msg:m.msg });
    LC.phone=null; LC.error="The phone says: "+m.msg; abortRun(); paint();
  }
}
function onPeers(list){
  if(!LC.phone) return;
  if(list.some(p=>p.id===LC.phone)){ clearTimeout(LC.lostTimer); LC.lostTimer=null; return; }
  if(LC.lostTimer) return;
  LC.lostTimer=setTimeout(()=>{ LC.lostTimer=null; logEv("phone-lost"); LC.phone=null;
    if(LC.recState!=="idle"){ abortRun(); LC.error="The phone dropped out mid-recording. Scan the code again and record that run again."; }
    paint(); }, 4000);
}

/* ------------------------------ recording ------------------------------ */
function liveSlots(st){ return (st && st.live && [].concat(st.live.slots || st.slots || [])) || []; }
function slotState(P){ return P && P._lc; }          // undefined | "rec" | "review" | "kept"
function pending(P){ return P && (P._lc==="rec" || P._lc==="review"); }
function nextTarget(st){ const ks=liveSlots(st); return ks.find(k=>{ const P=panelByKey(k); return !(P && P.ds && !pending(P)); }) || null; }

function begin(){
  const P=panelByKey(LC.target); if(!P || !LC.phone) return;
  LC.run=Math.random().toString(36).slice(2,8);
  LC.axis=(NARR[S.step].requireAxis||"z").replace(/^g/,"");
  LC.buf={ t:[], a:[] }; LC.seen=new Set(); LC.expected=null;
  LC.recState="rec"; LC.startedAt=performance.now();
  P._lc="rec"; P._lcFirst=true; LC.error=null;
  P.ds=null; P.sel=null; P.point=null; P.dfit=null; P.fit=null; P.crop=null; P.fileName=null;
  LC.conn.send({ type:"start", phone:LC.phone, run:LC.run, src:"lin", axis:LC.axis, show:LC.axis, batchMs:LCFG.batchMs });
  logEv("begin", { slot:P.key });
  render(); paint(); tick();
}
function tick(){
  if(LC.recState!=="rec") return;
  const s=(performance.now()-LC.startedAt)/1000;
  const el=document.getElementById("lc-time"); if(el) el.textContent=s.toFixed(1)+" s";
  if(s>LCFG.maxSeconds){ stop(); return; }
  setTimeout(tick, 200);
}
function stop(){
  if(LC.recState!=="rec") return;
  LC.recState="finishing"; LC.conn.send({ type:"stop", phone:LC.phone, run:LC.run });
  logEv("stop", { slot:LC.target, n:LC.buf.t.length });
  paint();
  setTimeout(()=>{ if(LC.recState==="finishing") finish(); }, 3000);   // never wait forever on a dropped batch
}
function toParsed(B){
  const idx=B.t.map((_,i)=>i).sort((i,j)=>B.t[i]-B.t[j]);
  const pick=a=>idx.map(i=>a[i]);
  const H=["Time (s)","Linear Acceleration "+LC.axis+" (m/s^2)"];
  const cols={}; cols[H[0]]=pick(B.t); cols[H[1]]=pick(B.a);
  return { headers:H, cols };
}
function drawLive(){
  const P=panelByKey(LC.target); if(!P || P._lc!=="rec" || LC.buf.t.length<2) { paint(); return; }
  ingestParsed(toParsed(LC.buf), P);              // re-ingest: a second's worth of samples at a time, cheap
  P.fileName="live capture (recording…)";
  paint();
}
function finish(){
  if(LC.recState!=="finishing") return;
  LC.recState="idle";
  const P=panelByKey(LC.target); if(!P) return;
  if(LC.buf.t.length<10){ P.ds=null; P._lc=undefined; LC.error="No data came through from the phone. Is its page still open? Try again."; render(); paint(); return; }
  ingestParsed(toParsed(LC.buf), P);
  const n=LC.buf.t.length, dur=LC.buf.t[n-1]-LC.buf.t[0];
  P.fileName="live capture";
  P._lcMeta={ n, dur, rate: dur>0 ? (n-1)/dur : 0, run:LC.run };
  P._lc="review";
  logEv("review", { slot:P.key, n, dur:+dur.toFixed(2) });
  render(); setReadout(); paint(); refreshNext();
}
function abortRun(){
  LC.recState="idle";
  const P=panelByKey(LC.target);
  if(P && pending(P)){ P.ds=null; P._lc=undefined; P.fileName=null; render(); }
  refreshNext();
}
function tryAgain(){
  const P=panelByKey(LC.target); if(!P) return;
  logEv("try-again", { slot:P.key });
  P.ds=null; P._lc=undefined; P.fileName=null; P.sel=null; P.dfit=null;
  render(); setReadout(); paint(); refreshNext();
}
function accept(){
  const P=panelByKey(LC.target); if(!P) return;
  P._lc="kept";
  logEv("accept", Object.assign({ slot:P.key }, P._lcMeta||{}));
  P.liveRun = { slot:P.key, axisPlotted:P.sigH, meta:P._lcMeta, data:P.ds && P.ds.cols };   // the submission reads this
  const st=NARR[S.step];
  LC.target=nextTarget(st);
  if(!LC.target && LC.phone){                     // the step's last slot: let the phone go
    LC.conn.send({ type:"release", phone:LC.phone }); logEv("released"); LC.phone=null;
  }
  paint(); refreshNext();
}
function redo(k){
  const P=panelByKey(k); if(!P) return;
  P.ds=null; P._lc=undefined; P.fileName=null; P.sel=null; P.dfit=null;
  LC.target=k; logEv("redo", { slot:k });
  if(!LC.phone && LC.conn) LC.conn.send({ type:"whois" });
  render(); setReadout(); paint(); refreshNext();
}

/* ------------------------------ the card ------------------------------ */
let QR_IMG=null;
function qrImg(){
  if(QR_IMG) return QR_IMG;
  try { const q=qrcode(0,"M"); q.addData(phoneHref); q.make(); QR_IMG=q.createDataURL(6,2); } catch(e){ QR_IMG=""; }
  return QR_IMG;
}
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

function paint(){
  const st=NARR[S.step]; const card=document.getElementById("lc-card");
  if(!card || !st || !st.live) return;
  const ks=liveSlots(st), multi=ks.length>1;
  if(LC.target==null || ks.indexOf(LC.target)<0) LC.target=nextTarget(st);
  const T=LC.target ? panelByKey(LC.target) : null;
  let h="";
  // which slot is which (only when the step records into more than one)
  if(multi){
    h+='<div class="lc-slots">'+ks.map(k=>{ const P=panelByKey(k), lab=(P&&P.label)||k;
      const kept=P && P.ds && !pending(P);
      const cls = kept ? "kept" : (k===LC.target ? "on" : "");
      return '<span class="lc-slot '+cls+'">'+(kept?"✓ ":"")+esc(lab.replace(/^.*—\s*/,""))+'</span>'; }).join("")+'</div>';
  }
  if(LC.status==="error"){
    h+='<div class="lc-err">Couldn\'t reach the live-capture server: '+esc(LC.error||"")+'</div>'
     +'<button class="deck-go" data-lc="retry">Try connecting again</button>';
  } else if(!LC.target){
    h+='<div class="lc-big lc-ok">✓ Kept'+(multi?" both":"")+'</div><p class="lc-sub">Press <b>Next ›</b>.</p>'
     +'<div class="lc-links">'+ks.map(k=>{ const P=panelByKey(k); return '<a href="#" data-lc="redo" data-k="'+k+'">Record '+esc(multi?((P&&P.label)||k).replace(/^.*—\s*/,"").toLowerCase():"it")+' again</a>'; }).join(" · ")+'</div>';
  } else if(!LC.phone && LC.recState==="idle" && !(T && T._lc==="review")){
    h+='<div class="lc-qrrow"><img class="lc-qr" alt="QR code for the phone page" src="'+qrImg()+'">'
     +'<div><div class="lc-big">Scan with your phone</div>'
     +'<p class="lc-sub">Open it in Safari or Chrome, then tap <b>Connect</b>.</p>'
     +'<div class="lc-code">'+ROOM+'</div>'
     +(LC.status==="connecting"?'<p class="lc-sub">connecting…</p>':'')
     +(LOCAL?'<p class="lc-sub"><a href="'+phoneHref+'" target="_blank">open a test phone tab</a></p>':'')
     +'</div></div>';
    if(LC.error) h+='<div class="lc-err">'+esc(LC.error)+'</div>';
  } else if(LC.recState==="rec"){
    h+='<div class="lc-big lc-rec">Recording'+(multi?' · '+esc(((T&&T.label)||"").replace(/^.*—\s*/,"").toLowerCase()):'')+'</div>'
     +'<div class="lc-stats"><span id="lc-time">0.0 s</span> · <span>'+LC.buf.t.length+' samples</span></div>'
     +'<button class="deck-go lc-stop" data-lc="stop">Stop</button>';
  } else if(LC.recState==="finishing"){
    h+='<div class="lc-big">Finishing…</div><p class="lc-sub">Collecting the last second from the phone.</p>';
  } else if(T && T._lc==="review"){
    const m=T._lcMeta||{};
    h+='<div class="lc-big">Keep this run?</div>'
     +'<p class="lc-sub">'+(m.n||0)+' samples over '+(m.dur||0).toFixed(1)+' s · '+Math.round(m.rate||0)+' per second</p>'
     +'<div class="lc-btns"><button class="deck-go lc-ghost" data-lc="again">Try again</button>'
     +'<button class="deck-go lc-accept" data-lc="accept">Accept</button></div>';
  } else {
    h+='<div class="lc-big lc-ok">✓ Phone connected</div>'
     +'<p class="lc-sub">'+(multi?'Next: the <b>'+esc(((T&&T.label)||"").replace(/^.*—\s*/,"").toLowerCase())+'</b> run. ':'')
     +'Press <b>Record</b>, then do the experiment.</p>'
     +'<button class="deck-go lc-begin" data-lc="begin"><span class="lc-dot"></span>Record</button>';
    if(LC.error) h+='<div class="lc-err">'+esc(LC.error)+'</div>';
  }
  h+='<div class="lc-foot"><a href="#" data-lc="file">'+(LC.showFile?"Hide the file picker":"Use phyphox instead")+'</a></div>';
  if(LC.showFile) h+='<p class="lc-sub lc-filenote">Record in <b>phyphox → Acceleration (without g)</b>, export the CSV to this laptop, and choose it with the file picker'+(multi?' above each plot':' at the top left')+'.</p>';
  card.innerHTML=h;
  syncFilePickers(st);
  render();
}
function syncFilePickers(st){
  liveSlots(st).forEach(k=>{ const P=panelByKey(k); if(P && P.file && !P.supplied) P.file.style.display = LC.showFile ? "" : "none"; });
}
function onCardClick(e){
  const a=e.target.closest("[data-lc]"); if(!a) return;
  e.preventDefault();
  const act=a.dataset.lc;
  if(act==="begin") begin();
  else if(act==="stop") stop();
  else if(act==="again") tryAgain();
  else if(act==="accept") accept();
  else if(act==="redo") redo(a.dataset.k);
  else if(act==="retry"){ LC.conn=null; LC.status="idle"; connect(); }
  else if(act==="file"){ LC.showFile=!LC.showFile; logEv(LC.showFile?"file-picker-shown":"file-picker-hidden"); paint(); }
}

function mount(st){
  const main=document.querySelector("#stepbody .deck-main"); if(!main) return;
  const card=document.createElement("div"); card.id="lc-card"; card.className="deck-side lc-card";
  card.addEventListener("click", onCardClick);
  main.appendChild(card);
  if(LC.stepKey!==st.id){ LC.stepKey=st.id; LC.target=nextTarget(st); }
  connect();
  paint();
}

/* ------------------------------ the hooks ------------------------------ */
const _renderStep=renderStep;
renderStep=function(){
  _renderStep.apply(this, arguments);
  const st=NARR[S.step];
  // leaving a step mid-recording abandons that run: nothing half-recorded survives into a later step
  if(LC.recState!=="idle" && !(st && st.live && liveSlots(st).indexOf(LC.target)>=0)){ if(LC.conn&&LC.phone) LC.conn.send({type:"stop",phone:LC.phone,run:LC.run}); abortRun(); }
  if(st && st.live){ try { mount(st); } catch(e){ console.error("live-capture:", e); } }
  // Off a capture step the pickers come back, except over a run that was captured live: "Choose File · No
  // file chosen" beside a trace the phone recorded reads as a demand for a file nobody needs.
  else S.panels.forEach(P=>{ if(P.file && !P.supplied) P.file.style.display = P.liveRun ? "none" : ""; });
};
// An empty live slot says how it gets data, not "load the export with the picker above".
const _renderPanel=renderPanel;
renderPanel=function(P){
  const st=NARR[S.step];
  if(st && st.live && !LC.showFile && liveSlots(st).indexOf(P.key)>=0 && !series(P)){
    const c=P.ctx, W=P.cv.clientWidth, H=P.cv.clientHeight; c.clearRect(0,0,W,H);
    c.fillStyle=getCss("--muted"); c.font=font(14); c.textAlign="center"; c.textBaseline="middle";
    const lab=(P.label||"").replace(/^.*—\s*/,"").toLowerCase();
    c.fillText(LC.target!==P.key ? "The "+lab+" run goes here, after the "+((panelByKey(LC.target)||{}).label||"").replace(/^.*—\s*/,"").toLowerCase()+" one."
             : LC.phone ? "Press Record below, then do the experiment. The recording draws here."
             : "Scan the code below with your phone to record into this plot.", W/2, H/2);
    return;
  }
  return _renderPanel.apply(this, arguments);
};
const _stepComplete=stepComplete;
stepComplete=function(i){
  const st=NARR[i];
  if(st && st.live && liveSlots(st).some(k=>pending(panelByKey(k)))) return false;
  return _stepComplete.apply(this, arguments);
};
const _blockReason=blockReason;
blockReason=function(i){
  const st=NARR[i];
  if(st && st.live){
    const P=liveSlots(st).map(panelByKey).find(pending);
    if(P) return fbText(st, "live", P._lc==="rec" ? "Press <b>Stop</b> when the ringing has died away, then <b>Accept</b> the run."
                                                    : "Press <b>Accept</b> to keep this run, or <b>Try again</b>.");
  }
  return _blockReason.apply(this, arguments);
};
const _handleFile=handleFile;
handleFile=async function(file, P){
  P=P||active();
  if(P){ P._lc=undefined; P.liveRun=null; }
  logEv("phyphox-file", { slot:P&&P.key, name:file&&file.name });
  const r=await _handleFile.apply(this, [file, P]);
  const st=NARR[S.step]; if(st && st.live){ if(LC.target===(P&&P.key)) LC.target=nextTarget(st); paint(); }
  return r;
};

/* ------------------------------ styles (house tokens) ------------------------------ */
const css=document.createElement("style");
css.textContent=`
#stepbody .lc-card{flex:0 1 330px;min-width:240px;background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:12px 14px;font-size:var(--fs-ui);line-height:1.4;}
.lc-card .lc-qrrow{display:flex;gap:14px;align-items:flex-start;}
.lc-card .lc-qr{width:132px;height:132px;background:#fff;border-radius:6px;padding:6px;image-rendering:pixelated;flex:0 0 auto;}
.lc-card .lc-big{font-size:var(--fs-lead);font-weight:700;margin:0 0 4px;color:var(--ink);}
.lc-card .lc-sub{color:var(--muted);margin:0 0 8px;}
.lc-card .lc-code{font-family:var(--font-mono);font-size:20px;letter-spacing:.18em;color:var(--ink);margin:4px 0;}
.lc-card .lc-ok{color:var(--ok);}
.lc-card .lc-rec{color:var(--mma-red);display:flex;align-items:center;gap:8px;}
.lc-card .lc-rec::before{content:"";width:10px;height:10px;border-radius:50%;background:var(--mma-red);animation:lcpulse 1s ease-in-out infinite;}
@keyframes lcpulse{50%{opacity:.25;}}
@media (prefers-reduced-motion:reduce){.lc-card .lc-rec::before{animation:none;}}
.lc-card .lc-stats{font-family:var(--font-mono);color:var(--ink);margin:0 0 10px;font-variant-numeric:tabular-nums;}
.lc-card .lc-btns{display:flex;gap:8px;flex-wrap:wrap;}
.lc-card .lc-stop{border-color:var(--mma-red);color:var(--mma-red);}
/* Record (2026-10-16, Daniel): a red, filled record button, not a neutral Begin. */
.lc-card .lc-begin{background:var(--mma-red);border-color:var(--mma-red);color:#fff;font-weight:700;display:inline-flex;align-items:center;gap:8px;}
.lc-card .lc-begin:hover{filter:brightness(1.12);}
.lc-card .lc-begin .lc-dot{width:10px;height:10px;border-radius:50%;background:#fff;}
.lc-card .lc-stop:hover{background:var(--mma-red);color:var(--bg);}
.lc-card .lc-accept{border-color:var(--ok);color:var(--ok);}
.lc-card .lc-accept:hover{background:var(--ok);color:var(--bg);}
.lc-card .lc-ghost{border-color:var(--line);color:var(--ink);}
.lc-card .lc-slots{display:flex;gap:6px;margin:0 0 10px;flex-wrap:wrap;}
.lc-card .lc-slot{border:1px solid var(--line);border-radius:999px;padding:1px 10px;color:var(--muted);font-size:var(--fs-label);}
.lc-card .lc-slot.on{border-color:var(--accent);color:var(--ink);}
.lc-card .lc-slot.kept{border-color:var(--ok);color:var(--ok);}
.lc-card .lc-err{color:var(--mma-red);margin:8px 0;}
.lc-card .lc-foot{margin-top:12px;padding-top:8px;border-top:1px solid var(--line);font-size:var(--fs-label);}
.lc-card a{color:var(--accent);}
.lc-card .lc-links{font-size:var(--fs-label);}
.lc-card .lc-filenote{margin-top:6px;font-size:var(--fs-label);}
`;
document.head.appendChild(css);

// The engine rendered step 0 before this file loaded; a deck reopened on a live step needs the card now.
if(NARR[S.step] && NARR[S.step].live) renderStep();
})();
