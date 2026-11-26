/* w6-thunder.js — Workshop 6 · Thunder and Lightning's built plots and the hallway table (2026-11-20).

   An add-on to analyzer-engine.js, like class-run.js: it wraps renderStep and refreshNext and changes nothing inside
   the engine. Settings come from CONFIG.w6.

   THREE PLOTS BUILT FROM NUMBERS, not files. Whenever a step shows one of these slots, it is (re)built from what
   the group has typed, and only when those numbers changed, so a Slope window survives moving between steps:
     stair  pressure against height, from the four landings (p_B, p_1, p_2, p_3) at CONFIG.w6.floor metres apart
     wplot  measured length X against the period (10-cycle time / 10), one point per whistle row; a row ticked
            "no clear peaks" (S.answers.w_fN_skip) is left out
     hall   distance against travel time, from the hallway run (below)
   In teacher mode a plot with nothing typed uses CONFIG.w6's sample numbers instead (Daniel's own).

   THE HALLWAY RUN. Five phones on pop/hallway.html each save one row through save_class_run, named
   "W6-hallway-<d>m" (d = 0, 8, 16, 24, 32), each holding three trials of { t1, t2 } on that phone's own clock.
   The first `hall:` step fetches all five (get_class_run, newest within CONFIG.w6.maxAgeMin). Nothing there yet:
   the step says so and offers "Check again". "Use the sample data" loads CONFIG.w6.sample (simulated; see the
   manifest) and says so; teacher mode does that by itself.

   THE TABLE, on `hall:` steps (top: html, <div id="w6-hall">). Since 2026-11-23 each phone syncs itself (its sync ping
   is 0, so t1 = 0 and t2 = its stopwatch t), which leaves two stages:
     stage 1  each phone's t, seconds                               (h-table, until its question is answered)
     stage 2  t − t of the 0 m phone in the same trial, ms           (h-table answered; h-howc)
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
  put("stair", ["Height h (m)","Pressure p (Pa)"], { "Height h (m)":[0,1,2,3].map(i=>+(i*C.floor).toFixed(2)), "Pressure p (Pa)":v }, name);
}
// 2026-11-25 (Daniel): X is PRESCRIBED (C.X, inches), and the plot is resonant frequency against X: f = 10 cycles / the 10-cycle time.
function whistleRows(a){
  a=a||A(); let rows=[], name="your notes";
  for(let i=1;i<=5;i++){ const X=(C.X||[2,4,6,8,10])[i-1], f=a["w_f"+i];        // f_res typed on w-period (Daniel, 2026-11-25)
    if(a["w_f"+i+"_skip"]) continue; if(ok(X) && ok(f) && f>0) rows.push([X, f]); }
  if(rows.length<2 && teacher() && C.demoW){ rows=C.demoW.X.map((X,i)=>[X, 10000/C.demoW.t[i]]); name="sample notes (Quinn's whistle, 2.5 to 15.2 cm)"; }
  rows.sort((p,q)=>p[0]-q[0]); return { rows, name };
}
function buildWhistle(){
  const { rows, name }=whistleRows(); if(rows.length<2) return;
  put("wplot", ["Length X (cm)","Frequency f (Hz)"], { "Length X (cm)":rows.map(r=>r[0]), "Frequency f (Hz)":rows.map(r=>+r[1].toFixed(1)) }, name);
}
// the hidden length from the first and last notes on the plot: f1(X1+h) = f5(X5+h)  ->  h = (f5 X5 - f1 X1)/(f1 - f5)
function w6Hidden(a){
  const { rows }=whistleRows(a); if(rows.length<2) return { h:NaN };
  const [X1,f1]=rows[0], [X5,f5]=rows[rows.length-1];
  return { h:(f5*X5-f1*X1)/(f1-f5), X1, X5, f1, f5 };
}
window.w6Hidden=w6Hidden;          // (the two-note version; kept for reference, no longer checked)
// The 1/X fit (Daniel, 2026-11-25): f = A/(X + h). Fitted as the straight line 1/f = X/A + h/A (least squares on the
// period), which is closed-form and stable; h = intercept/slope. The curve's vertical asymptote is at X = -h.
function w6Fit(a){
  const { rows }=whistleRows(a); if(rows.length<2) return { h:NaN };
  const n=rows.length, xs=rows.map(r=>r[0]), ys=rows.map(r=>1/r[1]);
  const mx=xs.reduce((p,q)=>p+q,0)/n, my=ys.reduce((p,q)=>p+q,0)/n;
  let sxx=0, sxy=0; for(let i=0;i<n;i++){ sxx+=(xs[i]-mx)**2; sxy+=(xs[i]-mx)*(ys[i]-my); }
  const m=sxy/sxx, b=my-m*mx; if(!(m>0)) return { h:NaN };
  return { h:b/m, A:1/m };
}
window.w6Fit=w6Fit;
window.w6FitShown=a=>(a||A()).w_fitAll ? w6Fit(a).h : NaN;   // CONFIG.calc.w_Xh: counts once the fit takes in every note

/* ------------------------------ resonant frequency against X (`fplot:true`, w-plot and w-hidden) ------------------------------
   Drawn here as SVG, like the stairwell. Each note is a dot labeled with its frequency; X starts at 0 (the end of the plastic).
   `fitbtn:true` adds a **Fit 1/X** tool (Daniel, 2026-11-25): with it on, drag across the notes and f = A/(X + X_hidden) is fitted
   to the ones inside. Once the drag takes in EVERY note, the X axis slides left to reveal the curve's vertical asymptote at
   X = -X_hidden, dashed and labeled: the hidden length appears. S.answers.w_fitAll records that, and only then does the check count. */
const FP={ tool:false, a:null, b:null, drag:false, x0:0, anim:null, map:null };
function fpSel(rows){ if(FP.a==null || FP.b==null) return []; const lo=Math.min(FP.a,FP.b), hi=Math.max(FP.a,FP.b); return rows.filter(r=>r[0]>=lo && r[0]<=hi); }
function fitRows(rows){
  const n=rows.length; if(n<2) return null; const xs=rows.map(r=>r[0]), ys=rows.map(r=>1/r[1]);
  const mx=xs.reduce((p,q)=>p+q,0)/n, my=ys.reduce((p,q)=>p+q,0)/n; let sxx=0, sxy=0;
  for(let i=0;i<n;i++){ sxx+=(xs[i]-mx)**2; sxy+=(xs[i]-mx)*(ys[i]-my); }
  const m=sxy/sxx, b=my-m*mx; return m>0 ? { h:b/m, A:1/m } : null;
}
function fPlot(st){
  const el=document.getElementById("w6-fplot"); if(!el) return;
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||getComputedStyle(document.body).getPropertyValue(n).trim()||"#888";
  const W=el.clientWidth||900, Hh=el.clientHeight||400, mL=80, mR=30, mT=24, mB=56, pw=W-mL-mR, ph=Hh-mT-mB;
  const { rows, name }=whistleRows();
  const all=!!(st.fitbtn && A().w_fitAll), sel=st.fitbtn ? (all ? rows : fpSel(rows)) : [], fit=fitRows(sel);
  // the X axis: 0 to past the last note; once every note is fitted, it slides left to show the asymptote (tweened, 1.2 s)
  const target = all && fit && ok(fit.h) ? Math.min(-1, -fit.h-1) : 0;
  if(FP.x0!==target && !FP.anim){ const from=FP.x0, t0=performance.now();
    const tick=now=>{ const u=Math.min(1,(now-t0)/1200), e=u<.5?2*u*u:1-Math.pow(-2*u+2,2)/2; FP.x0=from+(target-from)*e;
      if(u<1){ FP.anim=requestAnimationFrame(tick); } else { FP.anim=null; FP.x0=target; } const s2=NARR[S.step]; if(s2 && s2.fplot) fPlot(s2); };
    FP.anim=requestAnimationFrame(tick); }
  const fmax=rows.length ? Math.max(...rows.map(r=>r[1])) : 1200, ys=niceStep(fmax*1.3);
  const x0=FP.x0, x1=Math.max(6.5, ...rows.map(r=>r[0]+0.5)), y0=0, y1=ys*Math.ceil(fmax*1.3/ys);
  const X=x=>mL+(x-x0)/(x1-x0)*pw, Y=f=>mT+(y1-f)/(y1-y0)*ph; FP.map={ mL, pw, x0, x1 };
  let g="";
  const sy=niceStep(y1-y0); for(let v=0; v<=y1+1e-9; v+=sy){ const y=Y(v);
    g+=`<line x1="${mL}" x2="${mL+pw}" y1="${y}" y2="${y}" stroke="${css("--line")}" stroke-width="1"/><text x="${mL-8}" y="${y+4}" text-anchor="end" font-size="13" fill="${css("--muted")}">${v}</text>`; }
  for(let v=Math.ceil(x0); v<=x1+1e-9; v++){ const x=X(v);
    g+=`<line x1="${x}" x2="${x}" y1="${mT}" y2="${mT+ph}" stroke="${css("--line")}" stroke-width="1" stroke-opacity="0.5"/><text x="${x}" y="${mT+ph+18}" text-anchor="middle" font-size="13" fill="${css("--muted")}">${v}</text>`; }
  if(x0<0) g+=`<line x1="${X(0)}" x2="${X(0)}" y1="${mT}" y2="${mT+ph}" stroke="${css("--muted")}" stroke-width="1.5"/>`;
  g+=`<text x="${mL+pw/2}" y="${Hh-10}" text-anchor="middle" font-size="13" fill="${css("--muted")}">handle position <tspan font-style="italic">X</tspan> (in)</text>`
    +`<text transform="translate(18,${mT+ph/2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${css("--muted")}">resonant frequency <tspan font-style="italic">f</tspan><tspan font-size="10" dy="3">res</tspan><tspan dy="-3"> (Hz)</tspan></text>`;
  g+=`<clipPath id="w6fc"><rect x="${mL}" y="${mT}" width="${pw}" height="${ph}"/></clipPath>`;
  if(st.fitbtn && FP.a!=null && FP.b!=null && !all){ const xa=X(Math.min(FP.a,FP.b)), xb=X(Math.max(FP.a,FP.b));
    g+=`<rect clip-path="url(#w6fc)" x="${xa}" y="${mT}" width="${Math.max(1,xb-xa)}" height="${ph}" fill="${css("--result")}" fill-opacity="0.10" stroke="${css("--result")}" stroke-opacity="0.5"/>`; }
  if(fit && ok(fit.h)){
    const xa=-fit.h, xs0=Math.max(x0, xa+1e-3), pts=[];
    for(let k=0;k<=400;k++){ const x=xs0+(x1-xs0)*Math.pow(k/400,1.6), f=fit.A/(x+fit.h); pts.push(X(x).toFixed(1)+","+Y(Math.min(f,y1*1.2)).toFixed(1)); }
    g+=`<polyline clip-path="url(#w6fc)" points="${pts.join(" ")}" fill="none" stroke="${css("--result")}" stroke-width="2.5"/>`;
    if(all && xa>=x0-1e-6 && !FP.anim) g+=`<line x1="${X(xa)}" x2="${X(xa)}" y1="${mT}" y2="${mT+ph}" stroke="${css("--result")}" stroke-width="2" stroke-dasharray="6 5"/>`
      +`<text x="${X(xa)+8}" y="${mT+16}" font-size="14" fill="${css("--result")}">asymptote: <tspan font-style="italic">X</tspan> = ${xa.toFixed(1)} in</text>`;
  }
  rows.forEach(([x,f])=>{ const inSel=st.fitbtn && sel.some(r=>r[0]===x);
    g+=`<circle cx="${X(x)}" cy="${Y(f)}" r="7" fill="${css("--trace")}" ${inSel?`stroke="${css("--result")}" stroke-width="2.5"`:""}/><text x="${X(x)+11}" y="${Y(f)-9}" font-size="13" font-family="var(--font-mono)" fill="${css("--ink")}">${Math.round(f)} Hz</text>`; });
  if(!rows.length) g+=`<text x="${mL+pw/2}" y="${mT+ph/2}" text-anchor="middle" font-size="15" fill="${css("--muted")}">Your notes appear here once you've timed them.</text>`;
  else g+=`<text x="${mL+pw-4}" y="${mT+ph-8}" text-anchor="end" font-size="12" fill="${css("--muted")}">${name}</text>`;
  let hint="";
  if(st.fitbtn && FP.tool && !all) hint = sel.length>=2 ? `fitting ${sel.length} of ${rows.length} notes: drag across all of them` : "drag across the notes to fit f = A/(X + X<tspan font-size='10' dy='3'>hidden</tspan><tspan dy='-3'>)</tspan>";
  if(hint) g+=`<text x="${mL+12}" y="${mT+18}" font-size="13" fill="${css("--muted")}">${hint}</text>`;
  el.innerHTML=`<svg class="w6-fsvg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" style="display:block;${st.fitbtn&&FP.tool?"cursor:crosshair;touch-action:none":""}">${g}</svg>`
    +(st.fitbtn ? `<button class="w6-fitbtn${FP.tool?" on":""}" data-w6fit="1">Fit 1/<i>X</i></button>` : "");
}
function fpX(e){ const svg=document.querySelector("#w6-fplot svg"); if(!svg || !FP.map) return null; const r=svg.getBoundingClientRect(), M=FP.map;
  return M.x0+((e.clientX-r.left)-M.mL)/M.pw*(M.x1-M.x0); }
function fpRedraw(){ const st=NARR[S.step]; if(st && st.fplot) fPlot(st); }
document.addEventListener("click", e=>{ const b=e.target.closest("[data-w6fit]"); if(!b) return; e.preventDefault();
  FP.tool=!FP.tool; fpRedraw(); });
document.addEventListener("pointerdown", e=>{ const st=NARR[S.step]; if(!(st && st.fitbtn && FP.tool) || A().w_fitAll || !e.target.closest("#w6-fplot svg")) return;
  const x=fpX(e); if(x==null) return; e.preventDefault(); FP.drag=true; FP.a=FP.b=x; fpRedraw(); });
document.addEventListener("pointermove", e=>{ if(!FP.drag) return; const x=fpX(e); if(x==null) return; FP.b=x; fpRedraw(); });
document.addEventListener("pointerup", ()=>{ if(!FP.drag) return; FP.drag=false;
  const { rows }=whistleRows(); if(rows.length>=2 && fpSel(rows).length===rows.length){ S.answers.w_fitAll=true; S.answers["ok"+S.step]=false; }
  fpRedraw(); });
addEventListener("resize", fpRedraw);

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
  // 2026-11-23: the phones sync themselves (sync ping = 0), so the table opens on each phone's stopwatch t and has two stages
  if(st.hall==="table") return done ? 2 : 1;
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
  const head = stage===1 ? ['$\\Delta t$ (s)'] : ['$\\Delta t-\\Delta t_{0\\,\\text{m}}$ (ms)'];   // Δt, the stopwatch reading (Daniel, 2026-11-25)
  h+='<div class="w6-grid w6-s'+stage+'">';
  C.dists.forEach(d=>{
    h+='<div class="w6-card"><div class="w6-d">'+d+' m'+(H.missing.indexOf(d)>=0?' <span class="w6-mut">(no data)</span>':'')+'</div><table><tr><th>trial</th>'
      +head.map(x=>'<th>'+x+'</th>').join("")+'</tr>';
    T.forEach(k=>{ const r=row(d,k);
      if(!r){ h+='<tr><td>'+k+'</td>'+head.map(()=>'<td>—</td>').join("")+'</tr>'; return; }
      const cells = stage===1 ? [fx(r.t2-r.t1)] : [(delayMs(d,k)??NaN).toFixed(2)];
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
  if(st.vidclock) clock(st);
  if(st.stairlive) stairLive();
  document.body.classList.toggle("w6-stair4", !!st.stairlive);
  document.body.classList.toggle("w6-black", !!st.blackbg);       // a clip drawn on pure black (the gravity gas): no gray around it   // the four landings on one line
  if(st.soundbtn) soundBtn();
  whistleFig(st);
  playOnce(st);
  document.body.classList.toggle("w6-stack", !!st.stack);        // `stack:true`: one input per line (long, question-like labels)
  if(st.whistlepair) whistlePair(st);
  if(st.whistlebody) whistleBody(st);
  if(st.fplot) fPlot(st);
  if(st.stormmap) stormMap(); else cancelAnimationFrame(MAP.raf);
  if(st.pistonsim) pistonSim(st); else cancelAnimationFrame(PIS.raf);
  document.body.classList.toggle("w6-voice", (st.slots||[]).indexOf("v1")>=0);   // the voices come from the phone: no file pickers
}

/* ------------------------------ the stairwell, live (`stairlive:true`, p-stair-go) ------------------------------
   Daniel, 2026-11-23: the plot is on screen from the start, and each landing appears as it's typed. Height is FROZEN
   (Landing B at 0 to Landing 3 at 3 floors up); pressure starts on a guess from Quinn's sample (1007.5–1009.6 hPa),
   follows a lone point that falls outside it, and fits the points once there are two. Drawn here as SVG, in the
   engine's colors; the next step (p-stair-plot) is the engine's own plot of the same four numbers, with Slope. */
const LAND=[["p_B","B"],["p_1","1"],["p_2","2"],["p_3","3"]];
function niceStep(span){ const r=span/5, p=Math.pow(10,Math.floor(Math.log10(r))), m=r/p; return (m<1.5?1:m<3.5?2:m<7.5?5:10)*p; }
function stairLive(){
  const el=document.getElementById("w6-stairlive"); if(!el) return;
  const css=n=>getComputedStyle(document.body).getPropertyValue(n).trim()||"#888";
  const W=el.clientWidth||900, Hh=el.clientHeight||400, mL=86, mR=30, mT=26, mB=58, pw=W-mL-mR, ph=Hh-mT-mB;
  const pts=LAND.map(([k,lab],i)=>({ h:i*C.floor, p:A()[k], lab })).filter(q=>ok(q.p) && q.p>80000 && q.p<120000);
  let lo=100750, hi=100960;   // Pa (Daniel, 2026-11-25: the stairwell is entered and shown in Pa)
  if(pts.length===1 && (pts[0].p<lo || pts[0].p>hi)){ const c=pts[0].p, half=(hi-lo)/2; lo=c-half; hi=c+half; }
  if(pts.length>=2){ const ps=pts.map(q=>q.p); let a=Math.min(...ps), b=Math.max(...ps); const sp=Math.max(b-a,20); lo=a-0.15*sp; hi=b+0.15*sp; }
  const x0=-0.6, x1=3*C.floor+0.6, X=h=>mL+(h-x0)/(x1-x0)*pw, Y=p=>mT+(hi-p)/(hi-lo)*ph;
  const st=niceStep(hi-lo), dp=st<0.01?3:st<0.1?2:st<1?1:0;
  let g="";
  for(let v=Math.ceil(lo/st)*st; v<=hi+1e-9; v+=st){ const y=Y(v);
    g+=`<line x1="${mL}" x2="${mL+pw}" y1="${y}" y2="${y}" stroke="${css("--line")}" stroke-width="1"/>`
      +`<text x="${mL-8}" y="${y+4}" text-anchor="end" font-size="13" fill="${css("--muted")}">${v.toFixed(dp)}</text>`; }
  LAND.forEach(([k,lab],i)=>{ const x=X(i*C.floor);
    g+=`<line x1="${x}" x2="${x}" y1="${mT}" y2="${mT+ph}" stroke="${css("--line")}" stroke-width="1" stroke-dasharray="3 4"/>`
      +`<text x="${x}" y="${mT+ph+20}" text-anchor="middle" font-size="13" fill="${css("--muted")}">Landing ${lab} · ${(i*C.floor).toFixed(2)} m</text>`; });
  g+=`<text x="${mL+pw/2}" y="${Hh-10}" text-anchor="middle" font-size="13" fill="${css("--muted")}">height <tspan font-style="italic">h</tspan> (m)</text>`
    +`<text transform="translate(18,${mT+ph/2}) rotate(-90)" text-anchor="middle" font-size="13" fill="${css("--muted")}">pressure <tspan font-style="italic">p</tspan> (Pa)</text>`;
  pts.forEach(q=>{ g+=`<circle cx="${X(q.h)}" cy="${Y(q.p)}" r="7" fill="${css("--trace")}"/>`
    +`<text x="${X(q.h)+12}" y="${Y(q.p)-10}" font-size="14" font-family="var(--font-mono)" fill="${css("--ink")}">${q.p.toFixed(0)}</text>`; });
  if(!pts.length && !CONFIG.blankEmpty) g+=`<text x="${mL+pw/2}" y="${mT+ph/2}" text-anchor="middle" font-size="15" fill="${css("--muted")}">Each landing appears here as you type it in below.</text>`;
  el.innerHTML=`<svg width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}" style="display:block">${g}</svg>`;
}
document.addEventListener("input", e=>{ const st=NARR[S.step]; if(st && st.stairlive && e.target.closest && e.target.closest("#stepbody")) setTimeout(stairLive,0); });
addEventListener("resize", ()=>{ const st=NARR[S.step]; if(st && st.stairlive) stairLive(); });

/* ------------------------------ a sound switch on a looping top video (`soundbtn:true`) ------------------------------
   The engine's top videos play muted and loop (right for a room of forty laptops). Free Bird (w-intro, w-predict) gets
   a small button to hear it; the engine keeps the same <video> across consecutive steps, so the choice carries over. */
function soundBtn(){
  const tm=document.getElementById("topmedia"); const v=tm && tm.querySelector("video.topvid"); if(!v || tm.querySelector(".w6-snd")) return;
  const b=document.createElement("button"); b.className="w6-snd";
  const sync=()=>{ b.textContent=v.muted?"🔇 Sound off":"🔊 Sound on"; };
  b.onclick=()=>{ v.muted=!v.muted; if(!v.muted){ v.currentTime=0; v.play().catch(()=>{}); } sync(); };
  sync(); v.addEventListener("volumechange", sync); tm.appendChild(b);
}

/* ------------------------------ play once, then a Replay button (Daniel, 2026-11-26) ------------------------------
   The particle clips (every `blackbg` step) play through ONCE and freeze on their last frame; a small Replay button then
   appears in the corner. Looping restarted them before students had taken them in. */
function playOnce(st){
  const tm=document.getElementById("topmedia"); if(!tm) return;
  const old=tm.querySelector(".w6-replay"); if(old) old.remove();
  const v=tm.querySelector("video.topvid"); if(!v || !st.blackbg) return;
  v.loop=false; v.removeAttribute("loop");
  const b=document.createElement("button"); b.className="w6-replay"; b.textContent="⟲ Replay"; b.hidden=!v.ended; tm.appendChild(b);
  b.onclick=()=>{ b.hidden=true; v.currentTime=0; v.play().catch(()=>{}); };
  v.onended=()=>{ b.hidden=false; };
  if(v.ended) b.hidden=false;
}

/* ------------------------------ the slide-whistle diagrams (Daniel, 2026-11-25; drawn by gen/whistle_svg.py) ------------------------------
   `whistlefig:true` on a top:"video" step: the whistle with X dimensioned, to the right of the clip (the clip moves left to make room).
   `whistlepair:true`: the see-through whistle twice, small, just under the step's question: closed with X_hidden (the air column)
   on the left, pulled out with X on the right. */
function whistleFig(st){
  const tm=document.getElementById("topmedia"); if(!tm) return;
  let f=tm.querySelector(".w6-wfig");
  if(st.whistlefig && !f){ f=document.createElement("img"); f.className="w6-wfig"; f.src=typeof st.whistlefig==="string" ? st.whistlefig : "media/whistle-ell.svg"; f.alt="slide whistle: X runs from the end of the plastic to the end of the handle"; tm.appendChild(f); }
  if(!st.whistlefig && f) f.remove();
  document.body.classList.toggle("w6-wfig-on", !!st.whistlefig);
}
// `whistlebody:"<svg>"`: the opaque whistle with X, small, in the step's own text (w-rec), after its numbered list
function whistleBody(st){
  const body=document.getElementById("stepbody"); if(!body || body.querySelector(".w6-wbody")) return;
  const img=document.createElement("img"); img.className="w6-wbody"; img.src=st.whistlebody; img.alt="X runs from the end of the plastic to the end of the handle";
  const ol=body.querySelector("ol"); if(ol) ol.insertAdjacentElement("afterend", img); else body.appendChild(img);
}
function whistlePair(st){
  const P=Array.isArray(st.whistlepair) ? st.whistlepair : ["media/whistle-closed.svg","media/whistle-open.svg"];
  const ps=[...document.querySelectorAll("#stepbody p")].filter(p=>p.children.length===1 && p.firstElementChild.tagName==="B" && p.textContent.trim()===p.firstElementChild.textContent.trim());
  const q=ps[ps.length-1]; if(!q || (q.nextElementSibling && q.nextElementSibling.classList.contains("w6-wpair"))) return;
  const d=document.createElement("div"); d.className="w6-wpair";
  // flex-grow in viewBox widths (668, 858): the two drawings stay at one scale
  d.innerHTML='<img style="flex:668 1 0" src="'+P[0]+'" alt="handle closed: the air column is X hidden"><img style="flex:858 1 0" src="'+P[1]+'" alt="handle pulled out: X">';
  q.insertAdjacentElement("afterend", d);
}

/* ------------------------------ two pistons and something to put on one (`pistonsim:"bottle"|"air"`; Daniel, 2026-11-26) ------------------------------
   Live, in the browser. Two identical containers of air, each closed by a piston of face 1 m²; a few dozen particles bounce
   inside each, and each piston jiggles a little about its resting height. A green probe in each container's lower left feeds
   a needle gauge just outside it. Off to the right sits the load: a 1.2 kg water bottle ("bottle"), or a massless box holding
   1.2 kg of air ("air"). Drag it onto the RIGHT piston and let go anywhere near: it snaps to the piston's center, the piston
   settles lower, the gas there is denser at the same temperature (speeds are never changed), and that gauge reads higher.
   Drag it off again and everything comes back, smoothly. S.answers["<step>_placed"] records that it has been placed at least
   once (the step's check asks for it).
   HONEST SCALE: 1.2 kg on 1 m² is 11.8 Pa on 101,000; the real piston would drop by about 0.01%. Here it drops ~17% and the
   gauge is a sensitive one with no numbers on it; the step says so. */
const PIS={ raf:0 };
function pistonSim(st){
  const el=document.getElementById("w6-piston"); if(!el) return;
  cancelAnimationFrame(PIS.raf);
  const kind=st.pistonsim==="air"?"air":"bottle", key=st.id+"_placed";
  const W=el.clientWidth||1200, H=el.clientHeight||500, dpr=window.devicePixelRatio||1;
  el.innerHTML=`<canvas width="${Math.round(W*dpr)}" height="${Math.round(H*dpr)}" style="width:${W}px;height:${H}px;display:block;touch-action:none"></canvas>`;
  const cv=el.querySelector("canvas"), g=cv.getContext("2d"); g.scale(dpr,dpr);
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const INK=css("--ink")||"#f2f2ef", MUT=css("--muted")||"#9a9a9a", GREEN="#8fb032", PEARL="#e9e7df", WALL="#8d939b";
  // geometry: two containers, centered left of middle; the load's shelf on the right
  const ch=Math.min(0.66*H, 330), cw=Math.min(0.15*W, 190), floorY=H*0.5+ch*0.5+10, topY=floorY-ch;
  const C=[{x:W*0.36-cw/2},{x:W*0.56-cw/2}]; const h0=ch*0.72, h1=h0*0.83, PT=14;   // gas height at rest, loaded; piston thickness
  C.forEach((c,ci)=>{ c.h=h0; c.target=h0; c.p=[]; c.sig=1;
    for(let k=0;k<36;k++){ const a=Math.random()*2*Math.PI, v=95+30*Math.random();
      c.p.push({x:c.x+8+Math.random()*(cw-16), y:floorY-8-Math.random()*(h0-16), vx:v*Math.cos(a), vy:v*Math.sin(a)}); } });
  const shelf={x:W*0.78, y:floorY};
  const load={ w:kind==="air"?56:40, h:kind==="air"?56:80, x:0, y:0, on:false, drag:null, back:null };
  const restPos=()=>({x:shelf.x-load.w/2, y:shelf.y-load.h});
  Object.assign(load, restPos());
  if(A()[key+"_on"]){ load.on=true; C[1].h=C[1].target=h1; }
  const pistonY=(c,t)=>floorY-c.h+0.9*Math.sin(11*t+(c===C[0]?0:2))+0.6*Math.sin(19*t+1);
  const drawLoad=(x,y)=>{ g.save();
    if(kind==="bottle"){ const w=load.w, h=load.h, r=8;
      g.fillStyle="rgba(120,180,235,.35)"; g.strokeStyle="#9fd0ff"; g.lineWidth=2;
      g.beginPath(); g.moveTo(x+w*0.32,y+10); g.lineTo(x+w*0.32,y+18); g.quadraticCurveTo(x,y+22,x,y+32); g.lineTo(x,y+h-r);
      g.quadraticCurveTo(x,y+h,x+r,y+h); g.lineTo(x+w-r,y+h); g.quadraticCurveTo(x+w,y+h,x+w,y+h-r); g.lineTo(x+w,y+32);
      g.quadraticCurveTo(x+w,y+22,x+w*0.68,y+18); g.lineTo(x+w*0.68,y+10); g.closePath(); g.fill(); g.stroke();
      g.fillStyle="rgba(90,160,230,.55)"; g.fillRect(x+2,y+38,w-4,h-40);                                   // the water
      g.fillStyle="#5e81b5"; g.fillRect(x+w*0.28,y+2,w*0.44,9);                                            // the cap
      g.fillStyle=INK; g.font='700 11px Inter, sans-serif'; g.textAlign="center"; g.textBaseline="middle"; g.fillText("1.2 kg", x+w/2, y+h*0.64);
    } else { const w=load.w, h=load.h;
      g.fillStyle="rgba(160,205,240,.42)"; g.fillRect(x,y,w,h); g.setLineDash([5,4]); g.strokeStyle="#cfe3f2"; g.lineWidth=1.6; g.strokeRect(x,y,w,h); g.setLineDash([]);
      g.fillStyle=INK; g.font='700 14px Inter, sans-serif'; g.textAlign="center"; g.textBaseline="middle"; g.fillText("AIR", x+w/2, y+h/2-7);
      g.font='600 11px Inter, sans-serif'; g.fillText("1.2 kg", x+w/2, y+h/2+10); }
    g.restore(); };
  const gauge=(cx,cy,r,rel)=>{ g.save(); g.fillStyle="#16171a"; g.strokeStyle=INK; g.lineWidth=1.8; g.beginPath(); g.arc(cx,cy,r,0,7); g.fill(); g.stroke();
    for(let k=-5;k<=5;k++){ const th=(90-23*k)*Math.PI/180, r0=r*(k===0?0.70:0.80); g.strokeStyle=k===0?INK:MUT; g.lineWidth=k===0?1.6:1;
      g.beginPath(); g.moveTo(cx+r0*Math.cos(th),cy-r0*Math.sin(th)); g.lineTo(cx+0.93*r*Math.cos(th),cy-0.93*r*Math.sin(th)); g.stroke(); }
    const ang=Math.max(-115,Math.min(115,230*(rel-1))), th=(90-ang)*Math.PI/180;
    g.strokeStyle=INK; g.lineWidth=2.6; g.lineCap="round"; g.beginPath(); g.moveTo(cx,cy); g.lineTo(cx+0.8*r*Math.cos(th),cy-0.8*r*Math.sin(th)); g.stroke();
    g.fillStyle=INK; g.beginPath(); g.arc(cx,cy,0.09*r,0,7); g.fill(); g.restore(); };
  // pointer: pick up the load, drop it near the right piston to snap, anywhere else to send it home
  const pt=e=>{ const r=cv.getBoundingClientRect(); return {x:e.clientX-r.left, y:e.clientY-r.top}; };
  const hit=q=>q.x>=load.x-6 && q.x<=load.x+load.w+6 && q.y>=load.y-6 && q.y<=load.y+load.h+6;
  cv.addEventListener("pointerdown",e=>{ const q=pt(e); if(!hit(q)) return; e.preventDefault(); cv.setPointerCapture(e.pointerId);
    load.drag={dx:q.x-load.x, dy:q.y-load.y}; if(load.on){ load.on=false; C[1].target=h0; S.answers[key+"_on"]=false; } load.back=null; });
  cv.addEventListener("pointermove",e=>{ const q=pt(e); cv.style.cursor = load.drag||hit(q) ? (load.drag?"grabbing":"grab") : "default";
    if(!load.drag) return; load.x=q.x-load.drag.dx; load.y=q.y-load.drag.dy; });
  const drop=()=>{ if(!load.drag) return; load.drag=null; const c=C[1], cx=c.x+cw/2, py=floorY-c.target-PT;
    if(Math.hypot(load.x+load.w/2-cx, load.y+load.h-py) < 130){ load.on=true; c.target=h1; S.answers[key+"_on"]=true;
      if(!S.answers[key]){ S.answers[key]=true; S.answers["ok"+S.step]=false; if(typeof refreshNext==="function") refreshNext(); } }
    else load.back={x0:load.x, y0:load.y, t0:performance.now()}; };
  cv.addEventListener("pointerup",drop); cv.addEventListener("pointercancel",drop);
  let last=performance.now(); const t0=last;
  const frame=now=>{ if(!cv.isConnected) return; const dt=Math.min(0.05,(now-last)/1000), t=(now-t0)/1000; last=now;
    g.clearRect(0,0,W,H);
    C.forEach((c,ci)=>{ c.h+=(c.target-c.h)*Math.min(1,dt/0.45);
      const py=pistonY(c,t), xl=c.x, xr=c.x+cw;
      for(const q of c.p){ q.x+=q.vx*dt; q.y+=q.vy*dt; const R=4;
        if(q.x<xl+R){ q.x=2*(xl+R)-q.x; q.vx=Math.abs(q.vx); } if(q.x>xr-R){ q.x=2*(xr-R)-q.x; q.vx=-Math.abs(q.vx); }
        if(q.y>floorY-R){ q.y=2*(floorY-R)-q.y; q.vy=-Math.abs(q.vy); } if(q.y<py+R){ q.y=Math.min(floorY-R, 2*(py+R)-q.y); q.vy=Math.abs(q.vy); } }
      // the gauge: the piston's load sets the gas's pressure; a little noise so it reads like an instrument
      const rel=1+(h0/c.h-1)*1.1+0.012*Math.sin(7*t+ci*3)+0.008*Math.sin(17*t+ci); c.sig+=(rel-c.sig)*Math.min(1,dt/0.25);
      // container walls (open top), piston, particles, probe, lead, gauge
      g.strokeStyle=WALL; g.lineWidth=3; g.beginPath(); g.moveTo(xl-2,topY); g.lineTo(xl-2,floorY+2); g.lineTo(xr+2,floorY+2); g.lineTo(xr+2,topY); g.stroke();
      g.fillStyle=PEARL; for(const q of c.p){ g.beginPath(); g.arc(q.x,q.y,4,0,7); g.fill(); }
      g.fillStyle="#6b7079"; g.fillRect(xl+1,py-PT,cw-2,PT); g.fillStyle="#9aa0a8"; g.fillRect(xl+1,py-PT,cw-2,3);
      g.fillStyle="#4d5158"; g.fillRect(xl+cw/2-3,py-PT-22,6,22); g.fillRect(xl+cw/2-14,py-PT-26,28,5);   // rod and knob, so it reads as a piston
      const prx=xl+14, pry=floorY-16, gx=xl-52, gy=pry-6, gr=26;
      g.strokeStyle=GREEN; g.globalAlpha=.85; g.lineWidth=1.4; g.beginPath(); g.moveTo(prx,pry); g.bezierCurveTo(prx-30,pry+18,gx+gr+20,gy-14,gx+gr,gy); g.stroke(); g.globalAlpha=1;
      g.fillStyle=GREEN; g.fillRect(prx-6,pry-6,12,12);
      gauge(gx,gy,gr,c.sig);
      if(ci===1 && load.on && !load.drag) drawLoad(xl+cw/2-load.w/2, py-PT-26-load.h);
    });
    g.fillStyle=MUT; g.font='13px Inter, sans-serif'; g.textAlign="center"; g.fillText("each piston: 1 m² face", (C[0].x+C[1].x+cw)/2, floorY+24);
    // the shelf and the load when it isn't riding the piston
    g.strokeStyle=WALL; g.lineWidth=2; g.beginPath(); g.moveTo(shelf.x-50,shelf.y+2); g.lineTo(shelf.x+50,shelf.y+2); g.stroke();
    if(load.back){ const u=Math.min(1,(now-load.back.t0)/350), R=restPos(); load.x=load.back.x0+(R.x-load.back.x0)*u; load.y=load.back.y0+(R.y-load.back.y0)*u; if(u>=1) load.back=null; }
    if(!load.on || load.drag) drawLoad(load.x, load.y);
    if(!load.on && !load.drag && !S.answers[key]){ g.fillStyle=MUT; g.font='13px Inter, sans-serif'; g.textAlign="center"; g.fillText("drag me", shelf.x, shelf.y+22); }
    if(load.on && !load.drag){ const c=C[1]; load.x=c.x+cw/2-load.w/2; load.y=pistonY(c,t)-PT-26-load.h; }
    PIS.raf=requestAnimationFrame(frame); };
  PIS.raf=requestAnimationFrame(frame);
}
addEventListener("resize", ()=>{ const st=NARR[S.step]; if(st && st.pistonsim) pistonSim(st); });

/* ------------------------------ the storm over Charlottesville (`stormmap:true`, h-rule; Daniel, 2026-11-25) ------------------------------
   A real map, centered on Grounds and 2 miles tall (CONFIG.w6.map: center, heightM, places), drawn from CARTO's dark basemap tiles
   (OpenStreetMap data), which the student's browser loads at run time. 2026-11-25: CARTO now wants an API key, so the tiles are
   OpenStreetMap's own standard ones, turned dark with a CSS filter (invert + hue-rotate keeps water blue and parks green). Over it, on a canvas: the landmarks, labeled, and a
   "You Are Here" arrow at the Mechanical Engineering Building. A bolt flashes at the center; a yellow circle, the LIGHT, sweeps
   out in a few frames (really microseconds); a white one, the THUNDER, follows at 343 m/s in real time, each with its name
   riding just above its top. When the thunder has left the map, a two-second pause, and it all repeats. */
const MAP={ raf:0 };
function stormMap(){
  const el=document.getElementById("w6-map"); const M=C.map; if(!el || !M) return;
  cancelAnimationFrame(MAP.raf);
  const W=el.clientWidth||1200, H=el.clientHeight||500, dpr=window.devicePixelRatio||1;
  const lat0=M.center[0], lon0=M.center[1], mpp=M.heightM/H, RE=6378137, cosl=Math.cos(lat0*Math.PI/180);
  const zf=Math.log2(2*Math.PI*RE*cosl/(256*mpp)), z=Math.min(19,Math.round(zf)), sc=Math.pow(2,zf-z), N=256*Math.pow(2,z), tpx=256*sc;
  const merc=(lat,lon)=>{ const s=Math.sin(lat*Math.PI/180); return [(lon+180)/360, 0.5-Math.log((1+s)/(1-s))/(4*Math.PI)]; };
  const [cx,cy]=merc(lat0,lon0), P=(lat,lon)=>{ const [x,y]=merc(lat,lon); return [W/2+(x-cx)*N*sc, H/2+(y-cy)*N*sc]; };
  const txc=cx*N/256, tyc=cy*N/256; let tiles="";
  for(let tx=Math.floor(txc-W/2/tpx); tx<=Math.floor(txc+W/2/tpx); tx++) for(let ty=Math.floor(tyc-H/2/tpx); ty<=Math.floor(tyc+H/2/tpx); ty++)
    tiles+=`<img src="https://tile.openstreetmap.org/${z}/${tx}/${ty}.png" alt="" onerror="this.remove()" style="left:${(W/2+(tx-txc)*tpx).toFixed(1)}px;top:${(H/2+(ty-tyc)*tpx).toFixed(1)}px;width:${(tpx+0.6).toFixed(1)}px;height:${(tpx+0.6).toFixed(1)}px">`;
  el.innerHTML=`<div class="w6-tiles">${tiles}</div><canvas class="w6-mapcv" width="${Math.round(W*dpr)}" height="${Math.round(H*dpr)}" style="width:${W}px;height:${H}px"></canvas>`
    +`<div class="w6-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors</div>`;
  const cv=el.querySelector("canvas"), g=cv.getContext("2d"); g.scale(dpr,dpr);
  const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim()||"#ccc";
  const INK=css("--ink")||"#f2f2ef", BLUE=css("--accent")||"#4c8dff", YEL="#ffd23f", FONT='600 15px Inter, -apple-system, "Segoe UI", sans-serif';
  const label=(txt,x,y,col,align)=>{ g.font=FONT; g.textAlign=align||"center"; g.textBaseline="middle"; g.lineJoin="round";
    g.lineWidth=4; g.strokeStyle="rgba(0,0,0,.85)"; g.strokeText(txt,x,y); g.fillStyle=col; g.fillText(txt,x,y); };
  const places=(M.places||[]).map(q=>Object.assign({},q,{xy:P(q.lat,q.lon)}));
  const Rmax=Math.hypot(W/2,H/2)+30, tThunder=Rmax*mpp/343, tLight=0.12, period=tThunder;   // the next strike as soon as the thunder has left the map (Daniel, 2026-11-25)
  const bolt=(x,y,s,a)=>{ g.save(); g.globalAlpha=a; g.translate(x,y); g.scale(s,s); g.beginPath();
    g.moveTo(4,-26); g.lineTo(-10,2); g.lineTo(-1,2); g.lineTo(-6,26); g.lineTo(10,-4); g.lineTo(1,-4); g.closePath();
    g.fillStyle=YEL; g.shadowColor=YEL; g.shadowBlur=18; g.fill(); g.restore(); };
  const t0=performance.now();
  const frame=now=>{ if(!cv.isConnected) return; const t=(Math.max(0,now-t0)/1000)%period;   // rAF's stamp can precede t0
    g.clearRect(0,0,W,H);
    if(t<0.08){ g.fillStyle="rgba(255,240,180,"+(0.18*(1-t/0.08))+")"; g.fillRect(0,0,W,H); }      // the flash lights everything
    places.forEach(q=>{ const [x,y]=q.xy;
      if(q.you){ const ax=x+(q.dx||-70), ay=y+(q.dy||-56), L=Math.hypot(x-ax,y-ay), ux=(x-ax)/L, uy=(y-ay)/L, ex=x-ux*7, ey=y-uy*7;
        g.strokeStyle=BLUE; g.fillStyle=BLUE; g.lineWidth=3; g.lineCap="round"; g.beginPath(); g.moveTo(ax,ay); g.lineTo(ex-ux*9,ey-uy*9); g.stroke();
        g.beginPath(); g.moveTo(ex,ey); g.lineTo(ex-ux*13-uy*7,ey-uy*13+ux*7); g.lineTo(ex-ux*13+uy*7,ey-uy*13-ux*7); g.closePath(); g.fill();
        label(q.name, ax-ux*4, ay-uy*4-12, BLUE); return; }
      g.fillStyle=INK; g.beginPath(); g.arc(x,y,4,0,7); g.fill();
      const [ox,oy,al]= {n:[0,-14,"center"], s:[0,15,"center"], e:[10,0,"left"], w:[-10,0,"right"], ne:[8,-11,"left"], nw:[-8,-11,"right"], se:[8,11,"left"], sw:[-8,11,"right"]}[q.at||"n"];
      label(q.name, x+ox, y+oy, INK, al); });
    const c=[W/2,H/2];
    if(t<0.45) bolt(c[0],c[1],1.3, (Math.floor(t*30)%3===1) ? 0.35 : 1);                 // a flickering bolt
    if(t<tLight){ const r=Rmax*t/tLight; g.strokeStyle=YEL; g.lineWidth=4; g.beginPath(); g.arc(c[0],c[1],r,0,7); g.stroke(); label("lightning", c[0], c[1]-r-14, YEL); }
    if(t<tThunder){ const r=343*t/mpp; g.strokeStyle="#ffffff"; g.lineWidth=3; g.beginPath(); g.arc(c[0],c[1],r,0,7); g.stroke(); if(r>6) label("thunder", c[0], c[1]-r-14, "#ffffff"); }
    // a 1-mile scale bar, bottom center (Daniel, 2026-11-25)
    { const L=1609.34/mpp, x0=W/2-L/2, x1=W/2+L/2, yb=H-22; g.lineCap="butt";
      [["rgba(0,0,0,.85)",7],[INK,3]].forEach(([col,lw])=>{ g.strokeStyle=col; g.lineWidth=lw; g.beginPath();
        g.moveTo(x0,yb-8); g.lineTo(x0,yb); g.lineTo(x1,yb); g.lineTo(x1,yb-8); g.stroke(); });
      label("1 mile", W/2, yb-14, INK); }
    MAP.raf=requestAnimationFrame(frame); };
  MAP.raf=requestAnimationFrame(frame);
}
addEventListener("resize", ()=>{ const st=NARR[S.step]; if(st && st.stormmap) stormMap(); });

/* ------------------------------ a clip with a stopwatch (`vidclock:true` on a top:"video" step) ------------------------------
   Daniel, 2026-11-23: the Poltergeist storm. The engine plays a top video autoplaying, looped and muted; this one is taken over:
   paused at 0, sound ON, no loop, a millisecond timer over the picture, ▶/⏸ (one button), ⟲ (from the start), and a scrub bar,
   so students can stop on the flash and on the thunder and read both times. `credit:` on the step prints over the corner. */
const fmtClock=s=>{ const m=Math.floor(s/60), r=s-60*m; return (m?m+":"+(r<10?"0":""):"")+r.toFixed(3)+" s"; };
function clock(st){
  const tm=document.getElementById("topmedia"); const v=tm && tm.querySelector("video.topvid"); if(!v) return;
  if(v._w6clock && tm.querySelector(".w6-vc")) return;
  v._w6clock=true; v.loop=false; v.removeAttribute("loop"); v.autoplay=false; v.muted=false; v.removeAttribute("muted");
  try{ v.pause(); v.currentTime=0; }catch(e){}
  const box=document.createElement("div"); box.className="w6-vc";
  box.innerHTML='<div class="w6-vc-time">0.000 s</div>'
    +(st.credit?'<div class="w6-vc-credit">'+st.credit+'</div>':'')
    +'<div class="w6-vc-bar"><button class="w6-vc-btn w6-vc-snd" data-vc="snd"></button><button class="w6-vc-btn" data-vc="play" aria-label="Play">▶</button>'
    +'<button class="w6-vc-btn" data-vc="replay" aria-label="Replay from the start">⟲</button>'
    +'<input class="w6-vc-scrub" type="range" min="0" max="1000" step="1" value="0" aria-label="Position in the clip"></div>';
  tm.appendChild(box);
  const T=box.querySelector(".w6-vc-time"), P=box.querySelector('[data-vc="play"]'), R=box.querySelector(".w6-vc-scrub");
  // sound on/off in the bar's lower-left (Daniel, 2026-11-25), its label read from the video itself so it can't disagree
  const SB=box.querySelector('[data-vc="snd"]'), ssync=()=>{ SB.textContent=v.muted?"🔇 Sound off":"🔊 Sound on"; };
  SB.onclick=()=>{ v.muted=!v.muted; if(!v.muted) v.volume=1; ssync(); }; v.addEventListener("volumechange", ssync); ssync();
  const sync=()=>{ P.textContent=v.paused?"▶":"⏸"; P.setAttribute("aria-label", v.paused?"Play":"Pause"); };
  P.onclick=()=>{ if(v.paused){ if(v.ended) v.currentTime=0; v.play().catch(()=>{}); } else v.pause(); ssync(); };
  box.querySelector('[data-vc="replay"]').onclick=()=>{ v.currentTime=0; v.play().catch(()=>{}); };
  const dur=()=> Number.isFinite(v.duration) && v.duration>0 ? v.duration : (v.seekable && v.seekable.length ? v.seekable.end(v.seekable.length-1) : 0);
  R.oninput=()=>{ v.pause(); const d=dur(); if(d) v.currentTime=R.value/1000*d; };
  v.addEventListener("play", sync); v.addEventListener("pause", sync); v.addEventListener("ended", sync);
  (function tick(){ if(!box.isConnected) return; T.textContent=fmtClock(v.currentTime||0);
    { const d=dur(); if(d && document.activeElement!==R) R.value=Math.round(v.currentTime/d*1000); } requestAnimationFrame(tick); })();
  sync();
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
/* one fixed geometry for both stages, so nothing resizes between h-table and h-howc (Daniel, 2026-11-25) */
.w6-s1 .w6-card table,.w6-s2 .w6-card table{width:100%;table-layout:fixed;margin:0;}
.w6-card th,.w6-card td{white-space:nowrap;overflow:hidden;}
.w6-card th{height:30px;vertical-align:bottom;}
.w6-card th:first-child{width:34%;}
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
body.w6-five .pstrip .plabel{text-transform:none;letter-spacing:0;}   /* "X = 2 cm", not "X = 2 CM" */
#stepbody .skipchk{margin-left:12px;font-size:var(--fs-label);color:var(--muted);white-space:nowrap;}
@media (max-width:900px){.w6-grid{grid-template-columns:repeat(2,minmax(0,1fr));}}
.w6-vc{position:absolute;inset:0;z-index:5;pointer-events:none;}
#w6-stairlive{position:absolute;inset:0;}
#w6-fplot{position:absolute;inset:0;}
#w6-map{position:absolute;inset:0;overflow:hidden;background:#0e0f11;}
#w6-piston{position:absolute;inset:0;}
.w6-replay{position:absolute;right:16px;bottom:16px;z-index:6;font:600 14px var(--font-sans);padding:8px 14px;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.55);color:#fff;cursor:pointer;}
.w6-replay[hidden]{display:none;}
body.w6-voice .pstrip input[type=file]{display:none;}
#w6-map .w6-tiles{position:absolute;inset:0;filter:invert(1) hue-rotate(180deg) brightness(.85) contrast(.9) saturate(.6);}   /* OSM's light map, turned dark */
#w6-map .w6-tiles img{position:absolute;max-width:none;user-select:none;pointer-events:none;}
#w6-map .w6-mapcv{position:absolute;left:0;top:0;}
#w6-map .w6-attr{position:absolute;right:6px;bottom:4px;font:11px var(--font-sans);color:#aaa;background:rgba(0,0,0,.5);padding:1px 6px;border-radius:4px;}
#w6-map .w6-attr a{color:#ccc;}
.w6-fitbtn{position:absolute;top:14px;right:24px;font:600 14px var(--font-sans);padding:8px 14px;border-radius:8px;border:1px solid var(--line);background:var(--raised);color:var(--ink);cursor:pointer;}
.w6-fitbtn:hover{border-color:var(--muted);}
.w6-fitbtn.on{background:var(--result);border-color:var(--result);color:#111;}
body.w6-wfig-on #topmedia{justify-content:center;align-items:center;gap:4%;}
body.w6-wfig-on #topmedia video.topvid{flex:0 0 auto;width:auto;max-width:40%;}
.w6-wfig{flex:0 1 auto;width:min(50%,760px);min-width:0;pointer-events:none;}
.w6-wpair{display:flex;gap:5%;margin:8px 0 4px;align-items:flex-end;width:100%;contain:inline-size;}
body.w6-wfig-on #topmedia .media-ph{display:none;}
.w6-wpair img{min-width:0;height:auto;display:block;}
.w6-wbody{display:block;width:min(100%,380px);height:auto;margin:6px 0 2px;}
body.w6-stack #stepbody .inputs{display:grid !important;grid-template-columns:max-content !important;grid-template-rows:none !important;grid-auto-flow:row !important;row-gap:10px;}
body.w6-black #topmedia, body.w6-black #topmedia video{background:#000 !important;}
body.w6-stair4 #stepbody .inputs{grid-template-columns:repeat(4,max-content)!important;grid-template-rows:none!important;grid-auto-flow:row!important;column-gap:26px;}
.w6-snd{position:absolute;left:16px;bottom:16px;z-index:6;font:600 14px var(--font-sans);padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.35);background:rgba(0,0,0,.55);color:#fff;cursor:pointer;}
.w6-vc-time{position:absolute;top:14px;left:16px;font:700 34px var(--font-mono);font-variant-numeric:tabular-nums;color:#fff;
  background:rgba(0,0,0,.55);padding:4px 12px;border-radius:8px;}
.w6-vc-credit{position:absolute;top:18px;right:16px;font:italic 13px var(--font-sans);color:#ddd;background:rgba(0,0,0,.45);padding:3px 9px;border-radius:6px;}
.w6-vc-bar{position:absolute;left:16px;right:16px;bottom:46px;display:flex;align-items:center;gap:10px;pointer-events:auto;
  background:rgba(0,0,0,.55);padding:8px 12px;border-radius:10px;}
.w6-vc-btn{font-size:20px;line-height:1;width:44px;height:38px;border-radius:8px;border:1px solid rgba(255,255,255,.4);background:rgba(255,255,255,.08);color:#fff;cursor:pointer;}
.w6-vc-btn:hover{background:rgba(255,255,255,.2);}
.w6-vc-snd{width:auto;font:600 14px var(--font-sans);padding:0 12px;white-space:nowrap;}
.w6-vc-scrub{flex:1;accent-color:var(--accent);}
`;
document.head.appendChild(css);
if(NARR[S.step]) renderStep();
})();
