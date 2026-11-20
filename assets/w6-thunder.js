/* w6-thunder.js — Workshop 6 · Thunder and Lightning's built plots and the hallway table (2026-11-20).

   An add-on to analyzer-engine.js, like class-run.js: it wraps renderStep and refreshNext and changes nothing inside
   the engine. Settings come from CONFIG.w6.

   THREE PLOTS BUILT FROM NUMBERS, not files. Whenever a step shows one of these slots, it is (re)built from what
   the group has typed, and only when those numbers changed, so a Slope window survives moving between steps:
     stair  pressure against height, from the four landings (p_B, p_1, p_2, p_3) at CONFIG.w6.floor metres apart
     wplot  measured length X against the period (10-cycle time / 10), one point per whistle row; a row ticked
            "no clear peaks" (S.answers.w_tN_skip) is left out
     hall   distance against travel time, from the hallway run (below)
   In teacher mode a plot with nothing typed uses CONFIG.w6's sample numbers instead (Daniel's own).

   THE HALLWAY RUN. Five phones on pop/hallway.html each save one row through save_class_run, named
   "W6-hallway-<d>m" (d = 0, 8, 16, 24, 32), each holding three trials of { t1, t2 } on that phone's own clock.
   The first `hall:` step fetches all five (get_class_run, newest within CONFIG.w6.maxAgeMin). Nothing there yet:
   the step says so and offers "Check again". "Use the sample data" loads CONFIG.w6.sample (simulated; see the
   manifest) and says so; teacher mode does that by itself.

   THE TABLE, in three stages, on `hall:` steps (top: html, <div id="w6-hall">):
     stage 0  t1 and t2 as recorded                                 (h-table, until its question is answered)
     stage 1  t1 − t1 (all zero) and t2 − t1                        (h-table answered; h-delay until answered)
     stage 2  one column, (t2 − t1) − (t2 − t1) of the 0 m phone, ms (h-delay answered; h-howc)
   Each change flashes the cells that changed; the t1 column fades out on the way to stage 2. */
(function(){
"use strict";
if(typeof NARR==="undefined" || typeof S==="undefined") return;
const C=Object.assign({ floor:4.46, dists:[0,8,16,24,32], maxAgeMin:720,
  url:"https://rdbacwwbeyeqdkswwvjt.supabase.co", key:"sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159" },
  (typeof CONFIG!=="undefined" && CONFIG && CONFIG.w6) || {});
const ok=Number.isFinite, A=()=>S.answers;
const teacher=()=>typeof ungated==="function" && ungated();

/* ------------------------------ building a slot ------------------------------ */
function put(key, headers, cols, name){
  const P=panelByKey(key); if(!P) return;
  const sig=JSON.stringify(cols);
  if(P._w6sig===sig && P.ds) return;
  P._w6sig=sig; P.supplied=true; if(P.file) P.file.style.display="none";
  const cur=S.activeIdx; ingestParsed({ headers, cols }, P); S.activeIdx=cur; P.fileName=name;
}
function buildStair(){
  const keys=["p_B","p_1","p_2","p_3"]; let v=keys.map(k=>A()[k]), name="your four landings";
  if(!v.every(ok)){ if(!teacher() || !C.demoStair) return; v=C.demoStair; name="sample landings (Quinn, 2026-11-20)"; }
  put("stair", ["Height h (m)","Pressure p (hPa)"], { "Height h (m)":[0,1,2,3].map(i=>+(i*C.floor).toFixed(2)), "Pressure p (hPa)":v }, name);
}
function buildWhistle(){
  let rows=[];
  for(let i=1;i<=5;i++){ const X=A()["w_X"+i], t=A()["w_t"+i];
    if(A()["w_t"+i+"_skip"]) continue; if(ok(X) && ok(t) && t>0) rows.push([t/10, X]); }
  let name="your notes";
  if(rows.length<2){ if(!teacher() || !C.demoW) return; rows=C.demoW.X.map((X,i)=>[C.demoW.t[i]/10, X]); name="sample notes (Quinn's whistle)"; }
  rows.sort((a,b)=>a[0]-b[0]);
  put("wplot", ["Period T (ms)","Length X (cm)"], { "Period T (ms)":rows.map(r=>+r[0].toFixed(4)), "Length X (cm)":rows.map(r=>r[1]) }, name);
}

/* ------------------------------ the hallway run ------------------------------ */
const H={ state:"idle", rows:null, src:null, at:null, missing:[] };
window.__w6Hall=H;
async function fetchOne(d){
  const r=await fetch(C.url.replace(/\/$/,"")+"/rest/v1/rpc/get_class_run", { method:"POST",
    headers:{ "Content-Type":"application/json", apikey:C.key }, body:JSON.stringify({ p_workshop:"W6-hallway-"+d+"m", p_max_age_min:C.maxAgeMin }) });
  if(!r.ok) throw new Error("HTTP "+r.status);
  return r.json();
}
async function loadHall(force){
  if(!force && (H.state==="loading" || H.state==="live" || H.state==="sample")) return;
  H.state="loading"; paintAll();
  try{
    const got=await Promise.all(C.dists.map(d=>fetchOne(d).catch(()=>null)));
    const rows=[]; H.missing=[]; let at=null;
    got.forEach((j,i)=>{ const d=C.dists[i];
      if(!j || !j.run || !Array.isArray(j.run.trials)){ H.missing.push(d); return; }
      j.run.trials.forEach(t=>{ if(ok(t.t1) && ok(t.t2)) rows.push({ distance:d, trial:t.trial, t1:t.t1, t2:t.t2 }); });
      const ti=new Date(j.created_at); if(!at || ti>at) at=ti; });
    if(H.missing.indexOf(0)>=0 || !rows.length){ H.rows=null; H.state="none"; if(teacher()) useSample("teacher mode"); else paintAll(); return; }
    H.rows=rows; H.src="live"; H.at=at; H.state="live"; afterLoad();
  }catch(e){ H.state="none"; H.err=String(e.message||e); if(teacher()) useSample("teacher mode"); else paintAll(); }
}
function useSample(why){ H.rows=(C.sample||[]).slice(); H.src="sample"; H.why=why; H.missing=[]; H.state="sample"; afterLoad(); }
function afterLoad(){ buildHall(); paintAll(); if(typeof render==="function") render(); if(typeof refreshNext==="function") refreshNext(); }
function trials(){ return [...new Set((H.rows||[]).map(r=>r.trial))].sort((a,b)=>a-b); }
function row(d,k){ return (H.rows||[]).find(r=>r.distance===d && r.trial===k) || null; }
function delayMs(d,k){ const r=row(d,k), z=row(0,k); return (r && z) ? ((r.t2-r.t1)-(z.t2-z.t1))*1000 : null; }
function buildHall(){
  if(!H.rows) return;
  const pts=[]; C.dists.forEach(d=>trials().forEach(k=>{ const v=delayMs(d,k); if(v!=null) pts.push([v,d]); }));
  pts.sort((a,b)=>a[0]-b[0]);
  put("hall", ["Travel time t (ms)","Distance d (m)"], { "Travel time t (ms)":pts.map(p=>+p[0].toFixed(3)), "Distance d (m)":pts.map(p=>p[1]) },
      H.src==="live" ? "the class's hallway run" : "sample hallway run (simulated)");
}

/* ------------------------------ the table ------------------------------ */
const fmtAt=d=>d ? d.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" }) : "";
let lastStage=null;
function stageFor(st, i){
  const done=typeof stepComplete==="function" && stepComplete(i);
  if(st.hall==="table") return done ? 1 : 0;
  if(st.hall==="gap") return done ? 2 : 1;
  return 2;
}
function paintAll(){ const st=NARR[S.step]; if(st && st.hall) paint(st); }
function paint(st){
  const el=document.getElementById("w6-hall"); if(!el) return;
  const stage=stageFor(st, S.step), flash = lastStage!=null && lastStage!==stage; lastStage=stage;
  let h="";
  if(!H.rows){
    h='<div class="w6-wait"><div class="w6-big">'+(H.state==="loading" ? "Loading the hallway run…" : "No hallway data yet")+'</div>'
     +(H.state==="loading" ? "" : '<p>Wait for the class run in the hallway, then check again.</p>'
       +'<p><a href="#" data-w6="reload">Check again</a> · <a href="#" data-w6="sample">use the sample data</a> <span class="w6-mut">(only if your instructor says so)</span></p>')+'</div>';
    el.innerHTML=h; return;
  }
  const T=trials(), fx=v=>v.toFixed(4), cls=flash?" w6-flash":"";
  const head = stage===0 ? ['$t_1$ (s)','$t_2$ (s)'] : stage===1 ? ['$t_1-t_1$','$t_2-t_1$ (s)'] : ['$(t_2-t_1)-(t_2-t_1)_{0\\,\\text{m}}$ (ms)'];
  h+='<div class="w6-grid w6-s'+stage+'">';
  C.dists.forEach(d=>{
    h+='<div class="w6-card"><div class="w6-d">'+d+' m'+(H.missing.indexOf(d)>=0?' <span class="w6-mut">(no data)</span>':'')+'</div><table><tr><th>trial</th>'
      +head.map(x=>'<th>'+x+'</th>').join("")+'</tr>';
    T.forEach(k=>{ const r=row(d,k);
      if(!r){ h+='<tr><td>'+k+'</td>'+head.map(()=>'<td>—</td>').join("")+'</tr>'; return; }
      const cells = stage===0 ? [fx(r.t1), fx(r.t2)] : stage===1 ? [fx(0), fx(r.t2-r.t1)] : [(delayMs(d,k)??NaN).toFixed(2)];
      h+='<tr><td>'+k+'</td>'+cells.map(c=>'<td class="'+cls.trim()+'">'+c+'</td>').join("")+'</tr>'; });
    h+='</table></div>'; });
  h+='</div><p class="w6-src">'+(H.src==="live" ? '<b>Class run</b>, submitted by '+fmtAt(H.at)+(H.missing.length?' · missing: '+H.missing.map(d=>d+' m').join(", "):'')
       : '<b>Sample run</b> (simulated: '+(H.why||"")+'). Phones at 0–32 m, about 0.15 m and 0.15 ms of noise.')
    +' · <a href="#" data-w6="reload">check for a newer run</a>'+(H.src==="live"?' · <a href="#" data-w6="sample">use the sample data</a>':'')+'</p>';
  el.innerHTML=h;
  if(typeof typesetMath==="function") typesetMath(el);
}
document.addEventListener("click", e=>{ const a=e.target.closest("[data-w6]"); if(!a) return; e.preventDefault();
  if(a.dataset.w6==="reload") loadHall(true); else useSample("chosen on the deck"); });

/* ------------------------------ the hooks ------------------------------ */
function onStep(){
  const st=NARR[S.step]; if(!st) return;
  const ks=st.slots||[];
  if(ks.indexOf("stair")>=0) buildStair();
  if(ks.indexOf("wplot")>=0) buildWhistle();
  if(st.hall || ks.indexOf("hall")>=0){ if(H.rows) buildHall(); loadHall(false); }
  if(st.hall){ lastStage=null; paint(st); }
}
// Five stacked whistle plots (w-rec, w-blur, w-period) need more of the page than the engine's 3:2 split gives them:
// the bottom one, which also carries the axis title, was left with no plot at all. Those steps get 62:38 and slim strips.
function layout(){ const st=NARR[S.step]; const five=!!(st && (st.slots||[]).length>=5);
  if(document.body.classList.contains("w6-five")!==five){ document.body.classList.toggle("w6-five", five); return true; } return false; }
const _renderStep=renderStep;
renderStep=function(){ const changed=layout(); _renderStep.apply(this, arguments); if(changed && typeof resize==="function") setTimeout(resize, 0); try{ onStep(); if(typeof render==="function") render(); }catch(e){ console.error("w6-thunder:", e); } };
const _refreshNext=refreshNext;
refreshNext=function(){ const r=_refreshNext.apply(this, arguments);
  const st=NARR[S.step]; if(st && st.hall && H.rows && stageFor(st,S.step)!==lastStage) paint(st); return r; };

const css=document.createElement("style");
css.textContent=`
.w6-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:10px;padding:14px;box-sizing:border-box;width:100%;}
.w6-card{background:var(--raised);border:1px solid var(--line);border-radius:8px;padding:8px 10px;}
.w6-d{font:700 18px var(--font-mono);color:var(--ink);margin-bottom:4px;}
.w6-card table{border-collapse:collapse;width:100%;font:14px var(--font-mono);font-variant-numeric:tabular-nums;color:var(--ink);}
.w6-card th{font:600 12px var(--font-sans);color:var(--muted);text-align:right;padding:2px 4px;}
.w6-card th:first-child,.w6-card td:first-child{text-align:left;color:var(--muted);}
.w6-card td{text-align:right;padding:3px 4px;border-top:1px solid var(--line);}
.w6-s2 .w6-card table{width:auto;margin:0 auto;}
.w6-flash{animation:w6flash 1.2s ease-out;}
@keyframes w6flash{from{background:var(--band-amber);}}
.w6-src{font-size:var(--fs-label);color:var(--muted);margin:0 14px 10px;}
.w6-src a,.w6-wait a{color:var(--accent);}
.w6-wait{padding:30px;text-align:center;color:var(--muted);}
.w6-big{font-size:22px;font-weight:700;color:var(--ink);margin-bottom:8px;}
.w6-mut{color:var(--muted);font-size:var(--fs-label);}
body.w6-five{grid-template-rows:58fr 42fr;}
body.w6-five .pstrip{padding-top:1px;padding-bottom:1px;min-height:0;}
body.w6-five .pstrip input[type=file]{display:none;}
#stepbody .skipchk{margin-left:12px;font-size:var(--fs-label);color:var(--muted);white-space:nowrap;}
@media (max-width:900px){.w6-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
`;
document.head.appendChild(css);
if(NARR[S.step]) renderStep();
})();
