/* class-run.js — a step whose data is the CLASS's run, recorded once on the instructor's phone (2026-10-15).

   An add-on to analyzer-engine.js, like live-capture.js and group-submit.js (it wraps renderStep only).

   `classrun:{ slot:"car" }` on a step: the first time any such step renders, the deck asks Supabase for
   the newest run of this workshop (`get_class_run`, see lab-suite/accel-prototype/class-runs-setup.sql)
   and loads it into the slot like a supplied dataset: no file picker, no capture card. Daniel records
   that run on accel/instructor.html during the lab, so a group reaching the class section an hour later
   finds it waiting.

   THE FAILSAFE. If the run can't be fetched (no network, server down) or none was recorded in the last
   four hours, the slot gets the deck's baked sample (`DEMO_CSVS[slot]`, Daniel's own run from
   2026-10-15) and the step says so. Students never get stuck on an empty plot. A note under the lead
   shows which one is loaded and offers "check for a newer class run"; in teacher mode it also offers
   "use the baked sample", for projecting a known-good trace. */
(function(){
"use strict";
if(typeof NARR==="undefined" || typeof S==="undefined") return;
if(!NARR.some(st=>st && st.classrun)) return;
const C=Object.assign({
  url:"https://rdbacwwbeyeqdkswwvjt.supabase.co",
  key:"sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159",
  workshop:(CONFIG.submit && CONFIG.submit.workshop) || CONFIG.title,
  maxAgeMin:240,
}, (typeof CONFIG!=="undefined" && CONFIG && CONFIG.classrun) || {});
const R={ state:"idle", source:null, at:null, n:0, err:null, slot:null };
window.__classRun=R;
const fmtTime=d=>d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });

function toParsed(run){
  const H=run.headers || ["Time (s)","Linear Acceleration x (m/s^2)","Linear Acceleration y (m/s^2)","Linear Acceleration z (m/s^2)"];
  const cols={}; cols[H[0]]=run.t; cols[H[1]]=run.x; cols[H[2]]=run.y; cols[H[3]]=run.z;
  return { headers:H, cols };
}
function put(P, parsed, name){
  P.supplied=true; if(P.file) P.file.style.display="none";
  P.sel=null; P.dfit=null; P.point=null;
  ingestParsed(parsed, P); P.fileName=name;
  render(); setReadout(); refreshNext();
}
function useSample(P, why){
  const csv=(typeof DEMO_CSVS!=="undefined" && DEMO_CSVS && DEMO_CSVS[P.key]) || null;
  if(!csv){ R.state="failed"; R.err=why; paint(); return; }
  put(P, parseCSV(csv), "class sample (Daniel's test run)");
  R.state="sample"; R.source="sample"; R.err=why; paint();
}
async function load(P, force){
  if(!force && (R.state==="live" || R.state==="sample" || R.state==="loading")) return;
  R.state="loading"; R.slot=P.key; paint();
  try{
    const ctl=new AbortController(); const to=setTimeout(()=>ctl.abort(), 8000);
    const r=await fetch(C.url.replace(/\/$/,"")+"/rest/v1/rpc/get_class_run", { method:"POST", signal:ctl.signal,
      headers:{ "Content-Type":"application/json", apikey:C.key }, body:JSON.stringify({ p_workshop:C.workshop, p_max_age_min:C.maxAgeMin }) });
    clearTimeout(to);
    if(!r.ok) throw new Error("HTTP "+r.status);
    const j=await r.json();
    if(!j || !j.run || !Array.isArray(j.run.t) || j.run.t.length<20){ useSample(P, "none recorded yet"); return; }
    R.at=new Date(j.created_at); R.n=j.run.t.length;
    put(P, toParsed(j.run), "class run · recorded "+fmtTime(R.at));
    R.state="live"; R.source="live"; R.err=null; R.id=j.id; paint();
  }catch(e){ useSample(P, "couldn't reach the class data"); }
}

function paint(){
  const el=document.getElementById("cr-note"); if(!el) return;
  let h="";
  if(R.state==="loading") h="Loading the class run…";
  else if(R.state==="live") h="<b>Class run</b>, recorded at "+fmtTime(R.at)+".";
  else if(R.state==="sample") h="<b>Sample run</b> ("+R.err+"). It's real data from the same experiment, recorded earlier.";
  else if(R.state==="failed") h="The class run didn't load ("+R.err+"). Tell a TA.";
  if(R.state!=="loading") h+=' <a href="#" data-cr="reload">Check for a newer class run</a>';
  if(typeof ungated==="function" && ungated()) h+=' · <a href="#" data-cr="sample">use the baked sample</a>';
  el.innerHTML=h;
}
function onClick(e){
  const a=e.target.closest("[data-cr]"); if(!a) return; e.preventDefault();
  const P=panelByKey(R.slot || NARR[S.step].classrun.slot); if(!P) return;
  if(a.dataset.cr==="reload") load(P, true);
  else if(a.dataset.cr==="sample") useSample(P, "teacher's choice");
}

const _renderStep=renderStep;
renderStep=function(){
  _renderStep.apply(this, arguments);
  const st=NARR[S.step]; if(!st || !st.classrun) return;
  const P=panelByKey(st.classrun.slot); if(!P) return;
  P.supplied=true; if(P.file) P.file.style.display="none";
  const prose=document.querySelector("#stepbody .deck-prose");
  if(prose){ const n=document.createElement("p"); n.id="cr-note"; n.className="aside cr-note"; n.addEventListener("click", onClick); prose.appendChild(n); }
  if(!P.ds) load(P, false); else paint();
};

const css=document.createElement("style");
css.textContent=".cr-note{font-size:var(--fs-label);margin-top:6px;} .cr-note a{color:var(--accent);}";
document.head.appendChild(css);
if(NARR[S.step] && NARR[S.step].classrun) renderStep();
})();
