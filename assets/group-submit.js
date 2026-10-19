/* group-submit.js — sign the group in at the start, submit the run at the end (2026-10-14).

   An add-on to analyzer-engine.js, like live-capture.js: it wraps engine globals and changes nothing
   inside the engine. First used by the live-capture copy of Workshop 4.

   THE GROUP BOXES (`group:{max:N}` on a step; Workshop 4 puts them on the title step, above the access
   code, so students fill them in while they wait for the code). One box per person, up to N. Each computing ID is checked AS IT IS TYPED
   against CONFIG.group.roster: a green ✓ when it is on the class list, "not on the class list" when it is
   not. Next unlocks once every filled box is green, at least one is filled, and no ID appears twice.

   WHY HASHES, NOT A LIST. The deck is a public page. A dropdown would have to carry every computing ID in
   plain text, one View Source away. The roster here is PBKDF2-SHA256 fingerprints (salted, 20 000
   rounds), made by lab-suite/accel-prototype/roster_hashes.py from the Exam 1 roster. Checking one typed
   ID costs the browser a few milliseconds; guessing the whole ID space would cost months, so the list
   cannot be recovered from the page. Teacher mode lets an ID that is not on the list through (a late
   add), and the submission records that it was unverified.

   THE SUBMIT (`submit:true` on the summary step). One POST to the Supabase RPC `submit_workshop`
   (lab-suite/accel-prototype/submissions-setup.sql): the group, the summary text, every answer as typed,
   each slot's data with its fit window, and a log of every step entered and every capture action. The
   table is insert-only for the page's key; reading it needs Daniel's secret key. A group may submit more
   than once; the report keeps the latest per group.
*/
(function(){
"use strict";
if(typeof NARR==="undefined" || typeof S==="undefined") return;
const GCFG=(typeof CONFIG!=="undefined" && CONFIG && CONFIG.group) || null;
const SUBCFG=Object.assign({
  url:"https://rdbacwwbeyeqdkswwvjt.supabase.co",
  key:"sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159",
  workshop:(typeof CONFIG!=="undefined" && CONFIG && CONFIG.title) || document.title,
  maxRows:4000,
}, (typeof CONFIG!=="undefined" && CONFIG && CONFIG.submit) || {});

const G={ boxes:[], status:[], hashes:new Set((GCFG&&GCFG.roster)||[]), log:[], submitted:null, sending:false };
window.__groupSubmit=G;
const ROSTER_READY = G.hashes.size>0;
const norm = s => String(s||"").trim().toLowerCase();
const looksLikeId = s => /^[a-z]{2,3}[0-9][a-z0-9]{0,3}$/.test(s);
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));

async function fingerprint(id){
  const enc=new TextEncoder();
  const key=await crypto.subtle.importKey("raw", enc.encode(id), "PBKDF2", false, ["deriveBits"]);
  const bits=await crypto.subtle.deriveBits({ name:"PBKDF2", hash:"SHA-256", salt:enc.encode(GCFG.salt), iterations:GCFG.iter }, key, 64);
  return [...new Uint8Array(bits)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

/* ------------------------------ step log ------------------------------ */
let lastStep=null;
function logStep(){
  const st=NARR[S.step]; if(!st || st.id===lastStep) return;
  lastStep=st.id; G.log.push({ t:Date.now(), step:st.id, ev:"enter", teacher: typeof ungated==="function" ? !!ungated() : false });
}

/* ------------------------------ the group step ------------------------------ */
function groupIds(){ return G.boxes.map(norm).filter(Boolean); }
function groupOk(){
  const ids=groupIds(); if(!ids.length) return false;
  if(new Set(ids).size!==ids.length) return false;
  return G.boxes.every((v,i)=>!norm(v) || G.status[i]==="ok" || (G.status[i]==="unknown" && ungated()));
}
function syncAnswers(){
  const ids=groupIds();
  S.answers.group = ids.length ? ids.join(", ") : "";
  S.answers.group_ids = ids;
}
async function check(i){
  const v=norm(G.boxes[i]);
  if(!v){ G.status[i]=""; return; }
  const dup = groupIds().filter(x=>x===v).length>1;
  if(dup){ G.status[i]="dup"; return; }
  if(!looksLikeId(v)){ G.status[i]= v.length>=6 ? "unknown" : "typing"; return; }
  if(!ROSTER_READY){ G.status[i]="ok"; return; }
  const want=v;
  const h=await fingerprint(v);
  if(norm(G.boxes[i])!==want) return;                       // they kept typing; a newer check will land
  G.status[i]= G.hashes.has(h) ? "ok" : "unknown";
}
function mark(row,i){
  const s=G.status[i], el=row.querySelector(".gs-mark");
  el.className="gs-mark "+(s||"");
  el.textContent = s==="ok" ? "✓" : s==="dup" ? "already entered" : s==="unknown" ? (ungated() ? "not on the list (teacher mode lets it through)" : "not on the class list") : "";
}
function mountGroup(st, prose){
  const max=(st.group && st.group.max) || (GCFG && GCFG.max) || 4;
  if(!G.boxes.length) G.boxes=["",""].slice(0, Math.min(2,max));
  const wrap=document.createElement("div"); wrap.className="gs-wrap";
  const draw=()=>{
    wrap.innerHTML="";
    G.boxes.forEach((v,i)=>{
      const row=document.createElement("div"); row.className="inrow gs-row";
      row.innerHTML='<label for="gs'+i+'">Person '+(i+1)+'</label>'
        +'<input type="text" id="gs'+i+'" class="gs-in" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="computing ID">'
        +'<span class="gs-mark"></span>';
      const inp=row.querySelector("input"); inp.value=v;
      inp.addEventListener("input", async ()=>{
        G.boxes[i]=inp.value; G.status[i]="typing"; mark(row,i);
        await check(i);
        // a duplicate elsewhere may have just resolved; recheck the rest cheaply
        G.boxes.forEach((_,j)=>{ if(j!==i && G.status[j]==="dup") check(j).then(()=>mark(wrap.children[j],j)); });
        mark(row,i); syncAnswers(); refreshNext();
      });
      wrap.appendChild(row); mark(row,i);
    });
    if(G.boxes.length<max){
      const add=document.createElement("a"); add.href="#"; add.className="gs-add";
      add.textContent="+ add person "+(G.boxes.length+1)+" (up to "+max+")";
      add.addEventListener("click", e=>{ e.preventDefault(); G.boxes.push(""); draw(); const n=wrap.querySelectorAll(".gs-in"); n[n.length-1].focus(); });
      wrap.appendChild(add);
    }
  };
  draw();
  // On the title step the group goes ABOVE the access code (Daniel, 2026-10-15): sign in while you wait, then
  // the code once it's announced.
  const code=prose.querySelector(".coderow");
  if(code) prose.insertBefore(wrap, code); else prose.appendChild(wrap);
}

/* ------------------------------ the payload ------------------------------ */
function slotData(P){
  if(!P || !P.ds) return null;
  const cols=P.ds.cols, H=P.ds.headers, n=(cols[H[0]]||[]).length;
  const stride=Math.max(1, Math.ceil(n/SUBCFG.maxRows));
  const out={};
  H.forEach(h=>{ const c=cols[h]||[]; const a=[]; for(let i=0;i<c.length;i+=stride) a.push(Number.isFinite(c[i]) ? +(+c[i]).toFixed(4) : null); out[h]=a; });
  return {
    file:P.fileName||null, supplied:!!P.supplied, source: P.liveRun ? "live" : (P.supplied ? "supplied" : (P.fileName && /sample/i.test(P.fileName) ? "sample" : "file")),
    signal:P.sigH||null, rows:n, stride, live:(P.liveRun && P.liveRun.meta) || null,
    fit:P.dfit ? { w:P.dfit.w, z:P.dfit.z, r2:P.dfit.r2, t0:P.dfit.t0 } : null,
    sel:P.sel ? { a:P.sel.a, b:P.sel.b } : null,
    data: P.supplied ? null : out,
  };
}
function payload(st){
  const runs={};
  S.panels.forEach(P=>{ const d=slotData(P); if(d) runs[P.key]=d; });
  const answers={}, raw={};
  Object.keys(S.answers).forEach(k=>{ const v=S.answers[k]; if(v==null || typeof v==="object" && !Array.isArray(v)) return; answers[k]=v; });
  Object.keys(S.raw||{}).forEach(k=>{ raw[k]=S.raw[k]; });
  const lc=window.__liveCapture;
  return {
    workshop:SUBCFG.workshop,
    group:S.answers.group_ids||[],
    group_verified:G.boxes.map((v,i)=>({ id:norm(v), ok:G.status[i]==="ok" })).filter(x=>x.id),
    summary:(document.querySelector("#stepbody .summary-wrap textarea")||{}).value||"",
    answers:{ values:answers, typed:raw },
    runs,
    log:{ steps:G.log, capture: lc ? lc.log : [] },
    client:{ ua:navigator.userAgent, w:screen.width, h:screen.height, tz:Intl.DateTimeFormat().resolvedOptions().timeZone,
             teacher: typeof ungated==="function" ? !!ungated() : false, at:new Date().toISOString(), url:location.pathname },
  };
}
async function send(st, btn, msg){
  if(G.sending) return;
  const ids=S.answers.group_ids||[];
  if(!ids.length && !ungated()){ msg.className="gs-msg err"; msg.textContent="Your group isn't signed in. Go back to the first step and enter your computing IDs."; return; }
  G.sending=true; btn.disabled=true; msg.className="gs-msg"; msg.textContent="Submitting…";
  const body=JSON.stringify({ p: payload(st) });
  try{
    const r=await fetch(SUBCFG.url.replace(/\/$/,"")+"/rest/v1/rpc/submit_workshop", {
      method:"POST", headers:{ "Content-Type":"application/json", "apikey":SUBCFG.key }, body });
    const txt=await r.text();
    if(!r.ok) throw new Error((txt||("HTTP "+r.status)).slice(0,160));
    G.submitted={ at:new Date(), id:txt.trim(), ids:ids.slice() };
    G.log.push({ t:Date.now(), step:st.id, ev:"submitted", id:txt.trim(), bytes:body.length });
    paintSubmit(st);
  }catch(e){
    G.log.push({ t:Date.now(), step:st.id, ev:"submit-failed", err:String(e.message||e).slice(0,120) });
    msg.className="gs-msg err";
    msg.innerHTML="That didn't go through ("+esc(e.message||e)+"). Check the wifi and press Submit again. If it keeps failing, copy the summary above and show a TA.";
    btn.disabled=false;
  }
  G.sending=false;
}
function paintSubmit(st){
  const box=document.getElementById("gs-submit"); if(!box) return;
  const ids=S.answers.group_ids||[];
  if(G.submitted){
    const t=G.submitted.at.toLocaleTimeString([], { hour:"numeric", minute:"2-digit" });
    box.innerHTML='<div class="gs-done">✓ Submitted at '+esc(t)+' for '+esc(G.submitted.ids.join(", ")||"(no group)")+'.</div>'
      +'<p class="gs-msg">That\'s the whole deliverable: nothing to upload on Canvas. Changed something? <a href="#" id="gs-again">Submit again</a> (the latest one counts).</p>';
    box.querySelector("#gs-again").addEventListener("click", e=>{ e.preventDefault(); G.submitted=null; paintSubmit(st); });
    return;
  }
  box.innerHTML='<button class="deck-go gs-btn">Submit for '+(ids.length===1?"1 person":ids.length+" people")+'</button><span class="gs-msg"></span>';
  const btn=box.querySelector("button"), msg=box.querySelector(".gs-msg");
  btn.addEventListener("click", ()=>send(st, btn, msg));
}
function mountSubmit(st, prose){
  const box=document.createElement("div"); box.id="gs-submit"; box.className="gs-submit";
  // ABOVE the summary block, not below it: the block is tall, and a Submit under it falls below the fold
  const sum=prose.querySelector(".summary-wrap");
  if(sum) prose.insertBefore(box, sum); else prose.appendChild(box);
  paintSubmit(st);
}

/* ------------------------------ the wrap-up row (2026-10-16, Daniel) ------------------------------
   `wrapup` on the summary step: two cards side by side under the top region's "Nice work." — a comments box
   ("what would have made this go more smoothly?") and consent to use the group's data as a future sample,
   anonymous or credited to a team name. Both are optional and never gate Submit. They are stored in
   S.answers (wrap_comments, wrap_share, wrap_credit, wrap_team, so the payload carries them) AND written
   into the summary text, which is the receipt the group sees and the record that is kept. */
function wrapupText(){
  const a=S.answers, c=String(a.wrap_comments||"").trim(), team=String(a.wrap_team||"").trim();
  const share = a.wrap_share==="yes" ? "yes, " + (a.wrap_credit==="team" ? "credited to " + (team||"(no team name given)") : "anonymous")
              : a.wrap_share==="no" ? "no" : "(not answered)";
  return "\n\nComments for future years: " + (c ? c.replace(/\s*\n\s*/g," / ") : "(none)")
       + "\nOK to use our raw acceleration data as a sample in future years: " + share;
}
function refreshWrapSummary(st){
  const ta=document.querySelector("#stepbody .summary-wrap textarea"); if(!ta) return;
  ta.value = buildSummary(st.summary) + wrapupText();
  ta.rows = (st.summary.rows||9) + 3;
}
function mountWrapup(st){
  const host=document.querySelector("#topmedia .topcustom"); if(!host) return;
  const a=S.answers, box=document.createElement("div"); box.className="wrapup";
  box.innerHTML =
     '<div class="wu-card"><label class="wu-q" for="wu-comments">Is there anything that would have made this workshop go more smoothly? We read every comment when we plan next year.</label>'
    +'<textarea id="wu-comments" rows="4" placeholder="Optional"></textarea></div>'
    +'<div class="wu-card"><div class="wu-q">Is it OK if we use your raw acceleration data as a sample in future years?</div>'
    +'<div class="wu-opts"><label><input type="radio" name="wu-share" value="yes"> Yes</label><label><input type="radio" name="wu-share" value="no"> No</label></div>'
    +'<div class="wu-credit"><div class="wu-q2">I want the data to be</div>'
    +'<div class="wu-opts"><label><input type="radio" name="wu-credit" value="anon"> anonymous</label>'
    +'<label><input type="radio" name="wu-credit" value="team"> credited to</label>'
    +'<input type="text" id="wu-team" maxlength="60" placeholder="Team Awesome" autocomplete="off"></div></div></div>';
  host.appendChild(box);
  const com=box.querySelector("#wu-comments"), team=box.querySelector("#wu-team"), cred=box.querySelector(".wu-credit");
  const radios=n=>[...box.querySelectorAll('input[name="'+n+'"]')];
  const paint=()=>{ cred.style.display = a.wrap_share==="yes" ? "" : "none";
    radios("wu-share").forEach(r=>r.checked = r.value===a.wrap_share);
    radios("wu-credit").forEach(r=>r.checked = r.value===a.wrap_credit);
    refreshWrapSummary(st); };
  com.value=a.wrap_comments||""; team.value=a.wrap_team||"";
  com.addEventListener("input",()=>{ a.wrap_comments=com.value; refreshWrapSummary(st); });
  radios("wu-share").forEach(r=>r.addEventListener("change",()=>{ a.wrap_share=r.value;
    if(r.value==="yes" && !a.wrap_credit) a.wrap_credit="anon"; paint(); }));
  radios("wu-credit").forEach(r=>r.addEventListener("change",()=>{ a.wrap_credit=r.value; paint();
    if(r.value==="team") team.focus(); }));
  // the gray example name goes the moment the box is clicked, not when typing starts (Daniel)
  team.addEventListener("focus",()=>{ team.placeholder=""; });
  team.addEventListener("blur",()=>{ if(!team.value) team.placeholder="Team Awesome"; });
  team.addEventListener("input",()=>{ a.wrap_team=team.value; if(team.value.trim()) a.wrap_credit="team"; paint(); });
  paint();
}

/* ------------------------------ the hooks ------------------------------ */
const _renderStep=renderStep;
renderStep=function(){
  _renderStep.apply(this, arguments);
  logStep();
  const st=NARR[S.step], prose=document.querySelector("#stepbody .deck-prose");
  if(!st || !prose) return;
  try{
    if(st.group) mountGroup(st, prose);
    if(st.submit) mountSubmit(st, prose);
    if(st.wrapup && st.summary) mountWrapup(st);
  }catch(e){ console.error("group-submit:", e); }
};
const _stepComplete=stepComplete;
stepComplete=function(i){
  const st=NARR[i];
  if(st && st.group && !groupOk()) return false;
  return _stepComplete.apply(this, arguments);
};
const _blockReason=blockReason;
blockReason=function(i){
  const st=NARR[i];
  if(st && st.group && !groupOk()){
    const ids=groupIds();
    if(!ids.length) return fbText(st,"group","Type your computing ID in the first box. Your partners go in the boxes below.");
    if(new Set(ids).size!==ids.length) return fbText(st,"dup","The same computing ID is in two boxes.");
    return fbText(st,"unknown","Every filled box needs a green ✓. Check the spelling of the ones without one. If yours really isn't on the list, tell a TA.");
  }
  return _blockReason.apply(this, arguments);
};

const css=document.createElement("style");
css.textContent=`
.gs-wrap{margin-top:6px;}
.gs-row label{flex:0 0 72px;}
.gs-in{font:inherit;font-family:var(--font-mono);font-size:var(--fs-ui);width:130px;padding:4px 8px;border:1px solid var(--line);border-radius:6px;background:var(--raised);color:var(--ink);text-transform:lowercase;}
.gs-in:focus{outline:none;border-color:var(--accent);}
.gs-mark{font-size:var(--fs-ui);color:var(--muted);}
.gs-mark.ok{color:var(--ok);font-weight:700;font-size:16px;}
.gs-mark.unknown,.gs-mark.dup{color:var(--mma-red);}
.gs-add{display:inline-block;margin-top:10px;font-size:var(--fs-label);color:var(--accent);}
.gs-submit{margin-top:12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start;}
.gs-btn{border-color:var(--ok);color:var(--ok);padding:7px 22px;}
.gs-btn:hover{background:var(--ok);color:var(--bg);}
.gs-btn:disabled{opacity:.55;cursor:default;background:none;color:var(--ok);}
.gs-msg{font-size:var(--fs-ui);color:var(--muted);margin:0;}
.gs-msg.err{color:var(--mma-red);}
.gs-done{color:var(--ok);font-weight:700;font-size:var(--fs-lead);}
.gs-submit a{color:var(--accent);}
.gs-submit{margin-bottom:6px;}
`;
document.head.appendChild(css);

if(NARR[S.step] && (NARR[S.step].group || NARR[S.step].submit)) renderStep();
else logStep();
})();
