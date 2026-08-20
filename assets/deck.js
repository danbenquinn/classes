/* MAE 2501 — shared deck engine (media layer · polls · quizzes · exit quiz · wheel · presenter remote ·
   playlist · data-then · quad grid · live camera · synced video stack). Extracted 2026-07 from the four
   per-deck inline <script> blocks (superset of B/C/D/E). Every feature is data-attribute- or class-gated,
   so a deck only "has" the features its slides use.
   Per-deck usage (before this script):  <script>window.DECK_CONFIG = { classId:"classX", deckSecret:"…" };</script>
   deckSecret stays in the DECK (never here): published/perusal copies must ship without it, and the poll
   backend goes demo automatically when it's absent. After editing this file: node --check deck.js. */
(function(){
  'use strict';
  const CFG = Object.assign({
    classId: 'classX',
    deckSecret: '',                                  // instructor secret — per-deck config only; '' = demo polls
    pollOverride: 'auto',
    supabaseUrl: "https://rdbacwwbeyeqdkswwvjt.supabase.co",
    supabaseAnonKey: "sb_publishable_IQNxMMynit0aWtOS3tjiRQ_h5sNo159",
    remoteBase: "https://danbenquinn.github.io/poll/remote.html?class=",
    remoteVersion: 4,                                // bump when remote.html changes — busts phone caches via the QR URL
    preferredCam: /document|doc.?cam|ipevo|elmo|aver|hue|usb/i
  }, window.DECK_CONFIG || {});
  const CLASS_ID = CFG.classId;
  const DECK_SECRET = CFG.deckSecret;
  // PUBLISHED — a student-facing copy (lecture slides, homework, homework solutions). Set by
  // publish_deck/homework_deck via inline_suite_assets(); never set in the deck Daniel presents from.
  // It turns off the two affordances that only make sense on the presenting machine:
  //   · the speaker-notes window (S) — the published copies have every notes aside stripped, so S
  //     opened a second window that was reliably empty. Awkward, not dangerous. (Written without the
  //     literal tag on purpose: this comment is inlined into every student copy, and a privacy grep
  //     for leaked notes should not find its only hit in the comment explaining that there are none.)
  //   · E, skip-to-end-of-clip — a rehearsal aid. On a student's copy it silently truncates the clip
  //     they are trying to watch.
  // ESC/overview stays: navigating a long deck by thumbnail is useful to everyone.
  const PUBLISHED = !!CFG.published;
  const ICON_BASE = (CFG.iconBase !== undefined) ? CFG.iconBase : '../../slide-suite/engine/icons/';   // publish inlines icons as data URIs

  // ---- Infrastructure DOM: injected here so deck HTML carries only an empty #media-layer ----
  document.getElementById('media-layer').innerHTML = `
    <div id="starfield"></div>
    <video id="player" playsinline preload="auto"></video>
    <video id="playerB" playsinline preload="auto"></video>
    <img id="stillimg" alt="">
    <video id="camera" playsinline muted ${PUBLISHED ? '' : 'autoplay'}></video>
    <div id="quadgrid">
      <video playsinline muted loop preload="auto"></video>
      <video playsinline muted loop preload="auto"></video>
      <video playsinline muted loop preload="auto"></video>
      <video playsinline muted loop preload="auto"></video>
    </div>
    <div id="cammsg"></div>
    <div id="camctrls"><select id="camselect"></select><button id="camenable" class="simbtn">Enable camera</button></div>
    <div id="stackwrap"></div>
    <div id="attrib"><img alt=""><span class="u"></span></div>
    <div id="slidecap"><span></span></div>
    <div id="yeartag"></div>`;
  if(!document.getElementById('exitquiz')){
    const eq = document.createElement('div'); eq.id = 'exitquiz';
    eq.innerHTML = '<div class="eq-title"></div><div class="eq-pw"></div>';
    document.querySelector('.reveal').appendChild(eq);
  }
  Reveal.initialize({
    hash:true, transition:'fade', backgroundTransition:'fade',
    controls:true, progress:true, center:true,
    width:1280, height:720, margin:0.06,
    pdfSeparateFragments:false,   // ?print-pdf: one page per SLIDE, not one per fragment step

    // 83 = S. Belt and braces: the binding comes FROM the notes plugin, so not registering the plugin
    // already disables it — but publish also drops the plugin's <script> tag, and a null binding is a
    // clearer statement of intent than an absence.
    keyboard: PUBLISHED ? { 83: null } : {},
    // Referenced only when it is loaded: publish strips the notes plugin's script tag, so naming
    // RevealNotes unconditionally here would be a ReferenceError on every student copy.
    plugins: PUBLISHED ? [] : [ RevealNotes ]
  });
  // Typeset all math (slides + speaker notes) once MathJax is ready. Notes are display:none on the
  // deck but still get typeset, so the SVG is present when reveal copies them to the speaker window.
  Reveal.on('ready', () => {
    // Snapshot the RAW notes ($…$ LaTeX intact) BEFORE MathJax rewrites them to SVG, so the phone remote can
    // broadcast tiny text payloads (a few hundred bytes) and render the math itself — big SVG blobs were laggy.
    document.querySelectorAll('.reveal .slides > section').forEach(sec => {
      const n = sec.querySelector(':scope > aside.notes'); if(n) sec._rawNotes = n.innerHTML;
    });
    if(window.MathJax && MathJax.startup)
      MathJax.startup.promise
        .then(() => MathJax.typesetPromise([document.querySelector('.reveal .slides')]))
        .then(() => document.querySelectorAll('mjx-assistive-mml').forEach(el => el.remove())) // no dup in speaker view
        .catch(e => console.warn('MathJax typeset failed', e));
  });

  // ---------- Baked-clip media engine (plays whole files; stills for freezes) ----------
  const layer  = document.getElementById('media-layer');
  let   player = document.getElementById('player');       // active display video (swaps with playerB for playlists)
  let   playerB= document.getElementById('playerB');      // hidden buffer: the next playlist cut is decoded here
  const still  = document.getElementById('stillimg');
  const attrib = document.getElementById('attrib');

  // #attrib is built inside #media-layer above (it belongs to the media, and its position is computed
  // from the media rectangle) but it has to LIVE one level up, as a sibling of .slides.
  //
  // WHY: `.reveal .slides` is z-index 6 and `#media-layer` is z-index 5, and the media layer is a
  // stacking context — so nothing inside it can be clicked, because .slides covers the whole frame.
  // That is fine for a badge that only ever said "@DaksDominoes", and it is why this went unnoticed;
  // it stopped being fine when the badge became the link to the full video (data-fullvideo). Clicking
  // it hit the slide surface instead, which bubbles to .reveal's click handler, which toggles
  // play/pause — so the reported symptom was "the link just pauses the video".
  //
  // Moving it is the same fix #exitquiz already uses for the same reason (see deck.css, "supplemental").
  // Geometry is unaffected: #media-layer is `position:absolute; inset:0` inside .reveal, so .reveal was
  // already the offsetParent and every px offset layoutAttrib() computes still means what it meant.
  document.querySelector('.reveal').appendChild(attrib);

  // …which costs one thing, and it is worth being explicit about: the badge used to be hidden for free
  // on every non-media slide, because its parent was display:none. Out here nothing hides it, so every
  // path that leaves the media layer has to say so. hideAttrib() is that statement; the early returns
  // in configure() (overview, no slide, non-video) previously said nothing at all.
  function hideAttrib(){ attrib.style.display = 'none'; attrib.classList.remove('hasfull'); }
  const slidecap = document.getElementById('slidecap');
  const yeartag  = document.getElementById('yeartag');
  const camera   = document.getElementById('camera');
  const quadgrid = document.getElementById('quadgrid');
  const quadVideos = [...quadgrid.querySelectorAll('video')];
  const cammsg   = document.getElementById('cammsg');
  const camctrls = document.getElementById('camctrls');
  let camStream  = null;
  const inTopWindow = (window.self === window.top);   // false inside the speaker-view iframe
  let activeVideo = false, nativeMedia = false;

  const resolveSrc = s => new URL(s, location.href).href;

  // Is this media a STILL (mounts on #stillimg) or a clip (mounts on #player)? Asked in four places,
  // and it used to be four copies of the same extension test — which stopped being a complete answer
  // when publish_deck gained --freeze-video and began handing the media layer an INLINE data: URI with
  // no extension on it at all. A `data:image/png;base64,…` does not end in ".png", so all four copies
  // read a freeze frame as a video, mounted it on <video>, and every frozen slide came up black.
  const isStill = m => /\.(png|jpe?g|webp|gif|svg)$/i.test(m || '') || /^data:image\//i.test(m || '');

  let mrect = {x:0,y:0,w:0,h:0};
  function contain(el, w, h){
    if(!w || !h) return;
    const LW = layer.clientWidth, LH = layer.clientHeight;
    const s = Math.min(LW/w, LH/h), dw = w*s, dh = h*s;
    const left = (LW-dw)/2, top = (LH-dh)/2;
    el.style.width = dw+'px'; el.style.height = dh+'px';
    el.style.left = left+'px'; el.style.top = top+'px';
    mrect = {x:left, y:top, w:dw, h:dh};
  }
  function placeNative(el, w, h){          // original pixel size, centered (no upscaling); for data-native media
    if(!w || !h) return;
    const LW = layer.clientWidth, LH = layer.clientHeight;
    const left = Math.round((LW-w)/2), top = Math.round((LH-h)/2);
    el.style.width = w+'px'; el.style.height = h+'px';
    el.style.left = left+'px'; el.style.top = top+'px';
    mrect = {x:left, y:top, w:w, h:h};
  }
  function placeCover(el, w, h){           // fill the whole frame, cropping (data-fullscreen on a media slide)
    if(!w || !h) return;
    const LW = layer.clientWidth, LH = layer.clientHeight;
    const s = Math.max(LW/w, LH/h), dw = w*s, dh = h*s;
    el.style.width = dw+'px'; el.style.height = dh+'px';
    el.style.left = ((LW-dw)/2)+'px'; el.style.top = ((LH-dh)/2)+'px';
    mrect = {x:0, y:0, w:LW, h:LH};                // overlays pin to the screen — the media IS the screen
  }
  function placeAttrib(){                 // lower-left corner of the video itself, not the frame
    if(attrib.style.display === 'none') return;
    const cur = Reveal.getCurrentSlide();
    if(cur && (cur.dataset.creditScreen !== undefined || cur.dataset.fullscreen !== undefined)){   // pin to the screen corner (full-bleed media)
      attrib.style.left = '3%'; attrib.style.bottom = '4%'; return;
    }
    const LH = layer.clientHeight, pad = Math.max(8, Math.round(mrect.w*0.025));
    const vpad = Math.round(pad*0.5);   // bottom gap ~half the left gap (the text box sits high in its line-box)
    attrib.style.left   = (mrect.x + pad) + 'px';
    attrib.style.bottom = (LH - (mrect.y + mrect.h) + vpad) + 'px';
  }
  function placeCap(){                    // plain caption, lower-left of the media itself (like placeAttrib)
    if(slidecap.style.display === 'none') return;
    const cur = Reveal.getCurrentSlide();
    if(cur && (cur.dataset.creditScreen !== undefined || cur.dataset.fullscreen !== undefined)){
      slidecap.style.left = '3%'; slidecap.style.bottom = '4%';
      slidecap.style.maxWidth = '94%'; return;                     // full-bleed: wrap within the screen
    }
    const LH = layer.clientHeight, pad = Math.max(8, Math.round(mrect.w*0.025));
    slidecap.style.left   = (mrect.x + pad) + 'px';
    slidecap.style.bottom = (LH - (mrect.y + mrect.h) + Math.round(pad*0.5)) + 'px';
    slidecap.style.maxWidth = Math.max(0, mrect.w - 2*pad) + 'px'; // wrap on the media, never spill past it
  }
  function placeYear(){                    // lower-right corner of the media rectangle (data-year)
    if(yeartag.style.display === 'none') return;
    const LW = layer.clientWidth, LH = layer.clientHeight;
    const pad = Math.max(8, Math.round(mrect.w*0.025)), vpad = Math.round(pad*0.5);
    yeartag.style.right  = (LW - (mrect.x + mrect.w) + pad) + 'px';
    yeartag.style.bottom = (LH - (mrect.y + mrect.h) + vpad) + 'px';
  }
  // ---- media diagnostics ------------------------------------------------------------------------
  // A ring buffer of what the media layer actually did, readable from the console as `__deckLog`.
  // Exists because "the clip came up on the wrong frame" is unreproducible on demand: it depends on
  // decode timing, so the only way to catch it is to have the evidence already recorded when it
  // happens. Type `__deckLog` in the console right after you see it and the last few mounts are there.
  const __deckLog = window.__deckLog = [];
  function logMedia(tag, v){
    const cur = (window.Reveal && Reveal.getCurrentSlide) ? Reveal.getCurrentSlide() : null;
    __deckLog.push({ t: +(performance.now()/1000).toFixed(2), tag,
                     slide: cur && cur.id, el: v && v.id,
                     src: ((v && v.src) || '').split('/').pop(),
                     at: v ? +v.currentTime.toFixed(3) : null,
                     paused: v ? v.paused : null, readyState: v ? v.readyState : null });
    if(__deckLog.length > 60) __deckLog.shift();
  }

  function layoutActive(){
    const _cs = Reveal.getCurrentSlide();
    const coverMode = _cs && _cs.dataset.fullscreen !== undefined;   // data-fullscreen: fill-and-crop ('cover' stays the stack tile-framing attr)
    if(activeVideo){ (coverMode ? placeCover : contain)(player, player.videoWidth, player.videoHeight); player.style.visibility='visible'; }
    else if(nativeMedia){ placeNative(still, still.naturalWidth, still.naturalHeight); still.style.visibility='visible'; }
    else           { (coverMode ? placeCover : contain)(still,  still.naturalWidth, still.naturalHeight); still.style.visibility='visible'; }
    // Publish the media rectangle twice, in the two coordinate spaces a deck actually has:
    //
    //   --mrect-l   VIEWPORT px. For elements that are siblings of the media layer (#exitquiz), which
    //               live in the same full-window space the layer does.
    //   --media-x/y/w/h   SLIDE px. For anything INSIDE a <section>. A reveal section is laid out in
    //               the scaled 1280x720 slide box, and that box is inset by reveal's `margin` config —
    //               so a full-bleed clip is BIGGER than the slide area and a percentage inside a
    //               section lands nowhere near the same spot on the video. Converting through
    //               Reveal.getScale() and the .slides rect is the only way to make the two agree.
    //               Size an overlay to all four and its own coordinates become video coordinates.
    const padPx = Math.max(8, Math.round(mrect.w*0.025));
    const root = document.documentElement;
    layer.style.setProperty('--mrect-l', (mrect.x + padPx) + 'px');
    root.style.setProperty('--mrect-l', (mrect.x + padPx) + 'px');
    root.style.setProperty('--mrect-t', mrect.y + 'px');
    try{
      const sc = (Reveal.getScale && Reveal.getScale()) || 1;
      const sr = document.querySelector('.reveal .slides').getBoundingClientRect();
      root.style.setProperty('--media-x', ((mrect.x - sr.left) / sc) + 'px');
      root.style.setProperty('--media-y', ((mrect.y - sr.top)  / sc) + 'px');
      root.style.setProperty('--media-w', (mrect.w / sc) + 'px');
      root.style.setProperty('--media-h', (mrect.h / sc) + 'px');
    }catch(e){}
    placeAttrib(); placeYear(); placeCap();
    const cs = Reveal.getCurrentSlide(); if(cs && cs._stack) layoutStack(cs);   // keep a stack's rows sized on resize
  }
  function configure(){
    const cur = Reveal.getCurrentSlide();
    clearStack();                                   // tear down any stack from the slide we just left
    resetSpecials();                                // and any quad grid / camera / year tag / data-then swap state
    if(Reveal.isOverview() || !cur){ layer.style.display='none'; player.pause(); activeVideo = false; hideAttrib(); return; }
    if(cur.classList.contains('cam')){              // live document-camera slide (fully local getUserMedia)
      layer.style.display = 'block';
      document.getElementById('starfield').style.display = 'none';
      still.style.display = 'none'; player.style.display = 'none'; player.pause(); activeVideo = false;
      hideAttrib(); slidecap.style.display = 'none';
      startCamera();
      return;
    }
    if(!cur.classList.contains('vid')){ layer.style.display='none'; player.pause(); activeVideo = false; hideAttrib(); return; }
    layer.style.display = 'block';
    const d = cur.dataset;
    if(d.stack){ configureStack(cur); return; }     // synced/tiled video stack — its own path
    let media = d.media;
    if(d.playlist){                        // multi-clip slide: → plays clip 0, then each → jumps to the next cut
      cur._pl = { list: d.playlist.split(',').map(s => s.trim()).filter(Boolean), idx:0, started:false };
      media = cur._pl.list[0];
    }
    nativeMedia = d.native !== undefined;               // show at original pixel size, centered on black
    document.getElementById('starfield').style.display = (d.stars !== undefined) ? 'block' : 'none';
    still.classList.toggle('floating', d.float !== undefined);   // slow drift+spin (auto-starts on this slide)
    player.loop = d.loop !== undefined;
    // Per-clip volume: data-volume="0..1" (default 1). 0 (or data-mute) is a hard mute — which also lets
    // a warm-up autoplay, since browsers only autoplay muted media. Volume persists across a playlist's cuts.
    const vraw = parseFloat(d.volume);
    const vol = isNaN(vraw) ? 1 : Math.max(0, Math.min(1, vraw));
    player.volume = vol; player.muted = (d.mute !== undefined) || vol === 0;
    player._swapped = false;                        // re-arm the data-then auto-playlist swap

    if(d.user){
      setAttrib(d);
    } else { hideAttrib(); }

    if(d.year){ yeartag.style.display = 'block'; yeartag.textContent = d.year; } else { yeartag.style.display = 'none'; }
    if(d.caption){ slidecap.style.display = 'block'; slidecap.querySelector('span').textContent = d.caption; }
    else { slidecap.style.display = 'none'; }

    // data-framematch: arrive at this clip AT THE OUTGOING CLIP'S CURRENT TIME and cross-fade into it.
    // For a run of clips that are the same scene with one more element drawn each time, this reads as the
    // new element fading in over continuous motion rather than the whole shot restarting. `player` still
    // holds the previous clip here (the src swap happens below), so its currentTime is the match point.
    const frameMatch = d.framematch !== undefined && activeVideo && !player.paused;
    const matchAt = frameMatch ? player.currentTime : 0;

    // Takes the element EXPLICITLY. It is called from an onloadeddata handler, and between load() and
    // loadeddata the module-level `player` can be reassigned by a cross-fade or a playlist swap — in
    // which case seeking "player" to 0 seeks the wrong element and leaves the clip that just loaded
    // sitting whereever its decoder landed. Same family as the stale-handler bug noted below.
    const startPlayback = (v) => {
      v = v || player;
      try{ v.currentTime = 0; }catch(e){}
      if(d.autoplay !== undefined){ v.play().catch(()=>{}); return; }   // warm-up autoplays; others wait for →
      v.pause();
      // Re-assert frame 0 once the seek actually lands. A currentTime set at `loadeddata` is issued
      // while the element may still be resolving its own initial seek, and the browser is free to
      // settle on a nearby decodable frame instead — which is how a paused clip ends up holding a
      // frame some seconds in. Cheap, idempotent, and only for clips that are meant to sit still.
      const settle = () => {
        v.removeEventListener('seeked', settle); v.removeEventListener('canplay', settle);
        if(v.paused && v.currentTime > 0.02){ try{ v.currentTime = 0; }catch(e){} }
        logMedia('settle', v);
      };
      v.addEventListener('seeked', settle); v.addEventListener('canplay', settle);
      logMedia('mount', v);
    };
    if(isStill(media)){                                     // still image, animated GIF, or an inlined freeze frame (shown via <img>)
      activeVideo = false; player.pause(); player.style.display = 'none';
      still.style.display = 'block';
      if(resolveSrc(media) !== still.src){ still.style.visibility='hidden'; still.onload = layoutActive; still.src = media; } else { layoutActive(); }
    } else if(frameMatch && crossFadeTo(media, d, matchAt, cur)){  // handled by the cross-fade path
      return;                                         // crossFadeTo owns the swap AND re-stages the buffer
    } else {                                          // video clip
      activeVideo = true; still.style.display = 'none'; player.style.display = 'block';
      // Hard-reset the buffer. A cross-fade leaves its outgoing element visible (display:block,
      // z-index 1, opacity animating) and only hides it on a FADE_MS+60 timeout. Advance off the last
      // frame-matched slide faster than that and the timeout is still pending when the next clip
      // mounts — so the old element is still stacked over the new one, showing a frozen frame from the
      // previous animation. Only reached when we are NOT cross-fading, so the buffer is free.
      playerB.pause(); playerB.style.display = 'none';
      playerB.style.opacity = 1; playerB.style.zIndex = ''; playerB.style.transition = '';
      if(resolveSrc(media) !== player.src){
        player.style.visibility = 'hidden';           // hide until contain() places it — kills the first-load phantom flash
        player.src = media; player.load();
        // SELF-CLEARING on purpose. A handler left attached here is a live grenade: this element can
        // later become the hidden buffer, and preloadInto()'s load() would fire this stale closure,
        // which calls startPlayback() -> currentTime = 0 on whatever is playing NOW. That is what made
        // a frame-matched clip restart abruptly a beat after its cross-fade finished.
        player.onloadeddata = function(){ this.onloadeddata = null; layoutActive(); startPlayback(this); };
      } else { startPlayback(player); layoutActive(); }
    }
    if(d.playlist && cur._pl && cur._pl.list.length > 1) preloadInto(playerB, cur._pl.list[1], d);   // stage the 2nd cut for a flash-free advance
    stageFrameMatch(cur);                            // decode the NEXT clip now if it wants a frame-matched fade
  }

  // ---- Frame-matched cross-fade (data-framematch) ------------------------------------------------
  // The buffer element playerB is decoded ahead of time by stageFrameMatch(), seeked to the outgoing
  // clip's timestamp, started, and faded up while the outgoing clip fades down. Returns false if the
  // buffer isn't ready, in which case the caller falls back to the ordinary load (which still lands on
  // the matched frame — a hard cut rather than a fade, which is a survivable degradation).
  const FADE_MS = 420;
  function stageFrameMatch(cur){
    const all = Array.from(document.querySelectorAll('.reveal .slides > section'));
    const nxt = all[all.indexOf(cur) + 1];
    if(!nxt || nxt.dataset.framematch === undefined || !nxt.dataset.media) return;
    if(isStill(nxt.dataset.media)) return;
    preloadInto(playerB, nxt.dataset.media, nxt.dataset);
  }
  function crossFadeTo(media, d, atTime, cur){
    if(resolveSrc(playerB.src) !== resolveSrc(media) || playerB.readyState < 2) return false;
    const outgoing = player, incoming = playerB;
    const dur = incoming.duration || 0;
    try{ incoming.currentTime = dur ? Math.min(atTime, Math.max(0, dur - 0.05)) : atTime; }catch(e){}
    incoming.loop = d.loop !== undefined;
    const vr = parseFloat(d.volume), vv = isNaN(vr) ? 1 : Math.max(0, Math.min(1, vr));
    incoming.volume = vv; incoming.muted = (d.mute !== undefined) || vv === 0;

    activeVideo = true; still.style.display = 'none';
    incoming.onloadeddata = null; outgoing.onloadeddata = null;   // see preloadInto — no stale restarts
    // Swap the module refs BY HAND rather than via swapPlayers(): that helper pauses and hides the old
    // element immediately, and a frozen outgoing frame ghosts against the still-moving incoming one.
    // Here the outgoing clip keeps playing underneath for the whole fade, so the motion never stops.
    player = incoming; playerB = outgoing;
    incoming.style.display = 'block'; incoming.style.zIndex = 2;
    incoming.style.opacity = 0; incoming.style.visibility = 'visible';
    outgoing.style.display = 'block'; outgoing.style.zIndex = 1;
    layoutActive();                                  // sizes `player`, i.e. the incoming clip
    incoming.play().catch(()=>{});
    requestAnimationFrame(() => {
      incoming.style.transition = 'opacity ' + FADE_MS + 'ms linear';
      outgoing.style.transition = 'opacity ' + FADE_MS + 'ms linear';
      incoming.style.opacity = 1; outgoing.style.opacity = 0;
    });
    setTimeout(() => {
      outgoing.pause(); outgoing.style.display = 'none';
      outgoing.style.transition = ''; outgoing.style.opacity = 1; outgoing.style.zIndex = '';
      incoming.style.transition = ''; incoming.style.zIndex = '';
      stageFrameMatch(cur);        // only now is the buffer free to decode the next clip
    }, FADE_MS + 60);
    return true;
  }

  // ---- Playlist double-buffer: decode the NEXT cut in the hidden playerB so advancing swaps to a ready
  // first frame with no black flash. Falls back to a plain (visible) load if the buffer isn't ready. ----
  function applyMedia(v, d){                         // volume / mute / loop for a playlist clip
    v.loop = false;
    const vr = parseFloat(d.volume), vv = isNaN(vr) ? 1 : Math.max(0, Math.min(1, vr));
    v.volume = vv; v.muted = (d.mute !== undefined) || vv === 0;
  }
  function preloadInto(v, src, d){                   // decode a clip in a hidden buffer element
    v.onloadeddata = null;                           // never let a handler from this element's turn as
                                                     // the visible player fire off a buffer load
    if(resolveSrc(v.src) !== resolveSrc(src)){ v.src = src; v.load(); }
    applyMedia(v, d); v.pause();
  }
  function swapPlayers(){                            // make the ready buffer the visible player
    const old = player; player = playerB; playerB = old;
    playerB.pause(); playerB.style.display = 'none';
    player.style.display = 'block';
  }
  // Show pl.idx: swap in the pre-decoded buffer if it holds this cut (no flash), else load it into view.
  // Always stages the FOLLOWING cut into the buffer for the next advance.
  function showPlaylistClip(pl, d){
    const src = pl.list[pl.idx];
    // Play must be requested SYNCHRONOUSLY inside the → keypress gesture; a play() deferred to onloadeddata is
    // outside the gesture, so the browser blocks autoplay of a clip WITH AUDIO and it sits frozen.
    const startIt = () => { try{ player.currentTime = 0; }catch(e){} layoutActive(); player.play().catch(()=>{}); };
    if(resolveSrc(playerB.src) === resolveSrc(src) && playerB.readyState >= 2){
      swapPlayers(); activeVideo = true; startIt();
    } else {
      activeVideo = true; still.style.display = 'none'; player.style.display = 'block';
      player.style.visibility = 'hidden'; player.src = src; player.load(); applyMedia(player, d);
      player.onloadeddata = () => { layoutActive(); };
      startIt();                                    // request play now (in the gesture); it starts once data buffers
    }
    if(pl.idx + 1 < pl.list.length) preloadInto(playerB, pl.list[pl.idx + 1], d);
  }
  function playPlaylistClip(pl){ showPlaylistClip(pl, Reveal.getCurrentSlide().dataset); }

  // ---------- Synced / tiled video STACK (Class E) ----------
  // A stack slide (class "vid syncstack" — NEVER "stack", which reveal.js reserves for vertical
  // slide containers; see DESIGN.md — with data-stack="anim.mp4, graph-x.mp4[, graph-y.mp4]"):
  //  • data-sync  → the ANIMATION fills the frame and its impulse-graph strip(s) overlay the bottom, all held
  //    in lockstep by a master clock (clip 0). data-loop loops it on entry, and the first → freezes every clip
  //    on its last frame (so the finished graph can be studied); the next → advances. Without data-loop the
  //    first → plays it once, the next → advances.
  //  • data-cover → the walk-in warm-up: two full-width, half-height tiles that just loop.
  //  • data-axes="mv,mu" labels each strip's momentum axis (mv vertical / mu horizontal); t is time.
  const stackwrap = document.getElementById('stackwrap');
  let stackRaf = null;
  function pauseStack(){ stackwrap.querySelectorAll('video').forEach(v => v.pause()); if(stackRaf){ cancelAnimationFrame(stackRaf); stackRaf = null; } }
  function clearStack(){ pauseStack(); stackwrap.style.display = 'none'; stackwrap.innerHTML = ''; }
  function axisSVG(ylabel){                                    // coordinate glyph: y-axis (ylabel) up + time axis (t) right; corner at bottom-left (8%,92%)
    let ytxt;
    if(ylabel.indexOf('_') >= 0){ const p = ylabel.split('_');
      ytxt = '<text x="17" y="31" fill="#cfd3da" font-size="38" font-style="italic" font-family="ui-monospace,monospace">' + p[0] + '<tspan font-size="64%" dy="8">' + p[1] + '</tspan></text>';
    } else { ytxt = '<text x="17" y="31" fill="#cfd3da" font-size="38" font-style="italic" font-family="ui-monospace,monospace">' + ylabel + '</text>'; }
    return '<svg viewBox="0 0 100 100" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">'
      + '<g stroke="#cfd3da" stroke-width="4" fill="#cfd3da" stroke-linecap="round">'
      + '<line x1="8" y1="92" x2="8" y2="15"/><polygon points="8,3 2,18 14,18" stroke="none"/>'
      + '<line x1="8" y1="92" x2="90" y2="92"/><polygon points="99,92 84,86 84,98" stroke="none"/></g>'
      + ytxt
      + '<text x="78" y="83" fill="#cfd3da" font-size="38" font-style="italic" font-family="ui-monospace,monospace">t</text></svg>';
  }
  function layoutStack(cur){
    const st = cur && cur._stack; if(!st || stackwrap.style.display === 'none' || cur.dataset.cover !== undefined) return;
    const strips = st.stripEls, N = strips.length; if(!N) return;
    const VW = stackwrap.clientWidth, VH = stackwrap.clientHeight;
    const asp = strips.map(v => (v.videoWidth && v.videoHeight) ? v.videoWidth / v.videoHeight : 1200 / 360);
    // House layout for a data-animfit stack comes from tokens.css (graph.stack_* → --stack-*), so a new
    // energy-graph slide needs only `data-animfit` and inherits it; data-graphh/graphbottom/animgap are
    // per-slide OVERRIDES. Legacy stacks without animfit (Class E's impulse graphs) keep the older
    // 0.30 / 0.44 fallbacks, so tuning the house layout can't disturb decks that predate it.
    const fitted = cur.dataset.animfit !== undefined;
    const gf = parseFloat(cur.dataset.graphh);                // optional per-slide override of the band height
    const bandH = VH * (!isNaN(gf) ? gf : (fitted ? STACK.graphH : (N >= 2 ? 0.30 : 0.44))), gap = VW * 0.015;
    let sw = (VW * 0.96 - gap * (N - 1)) / N, sh = sw / asp[0];
    if(sh > bandH){ sh = bandH; sw = sh * asp[0]; }
    strips.forEach(v => { v.style.width = sw + 'px'; v.style.height = sh + 'px'; });
    // data-animfit: shrink the ANIMATION's box so it ends above the graph strips instead of running the
    // full height behind them. Without it the animation is inset:0 and object-fit:contain, so a tall
    // scene (a ball falling back down, a coaster's lower arm) draws straight through the graph. The
    // video still letterboxes inside the smaller box — nothing is cropped, it just gets smaller.
    // OPT-IN so the already-tuned Class E stacks (which use data-animshift) are untouched.
    if(st.animEl && cur.dataset.animfit !== undefined){
      const bpct = parseFloat(cur.dataset.graphbottom);
      const bottomPx = VH * ((isNaN(bpct) ? STACK.bottomPct : bpct) / 100);
      const gpct = parseFloat(cur.dataset.animgap);             // data-animgap: % of frame height
      const gapPx = VH * ((isNaN(gpct) ? STACK.gapPct : gpct) / 100);   // animation↔graph breathing room
      // Override the HEIGHT, pinned at top:0 — do NOT do this by setting `bottom` and unsetting
      // height:100%. #stackwrap video carries max-height:none, so a video with no explicit height falls
      // back to its intrinsic 1920×1080 and blows out of the frame.
      st.animEl.style.height = Math.max(40, VH - (sh + bottomPx + gapPx)) + 'px';
    }
    requestAnimationFrame(() => {                              // pin each glyph's corner to the left end of its zero-line
      const lr = stackwrap.getBoundingClientRect(), g = Math.max(50, sh * 0.26);   // glyph size (floor keeps it legible on the shorter 2-strip layouts)
      st.axisEls.forEach(a => { const v = st.stripEls[a.strip]; if(!v) return;
        const r = v.getBoundingClientRect();
        const px = r.left - lr.left, py = r.top - lr.top + a.yfrac * r.height;
        a.el.style.width = g + 'px'; a.el.style.height = g + 'px';
        a.el.style.left = (px - g * 0.08) + 'px';
        a.el.style.top  = (py - g * 0.92) + 'px';
      });
    });
  }
  function configureStack(cur){
    const d = cur.dataset;
    activeVideo = false; player.pause(); player.style.display = 'none'; playerB.style.display = 'none'; still.style.display = 'none';
    layer.style.display = 'block';
    if(d.user){ attrib.style.left = '3%'; attrib.style.bottom = '4%'; setAttrib(d);
    } else { hideAttrib(); }
    slidecap.style.display = 'none';
    const list = d.stack.split(',').map(s => s.trim()).filter(Boolean);
    const cover = d.cover !== undefined, sync = d.sync !== undefined, loop = d.loop !== undefined, autoplay = d.autoplay !== undefined;
    const vraw = parseFloat(d.volume), vol = isNaN(vraw) ? 1 : Math.max(0, Math.min(1, vraw));
    const axes = (d.axes || '').split(',').map(s => s.trim());
    const mk = src => { const v = document.createElement('video'); v.playsInline = true; v.preload = 'auto';
      v.muted = (d.mute !== undefined) || vol === 0; v.volume = vol; v.loop = loop; v.src = src; return v; };
    stackwrap.innerHTML = ''; stackwrap.classList.toggle('cover', cover); stackwrap.style.display = cover ? 'flex' : 'block';
    let els, stripEls = [], axisEls = [], animEl = null;
    if(cover){
      els = list.map(src => { const v = mk(src); stackwrap.appendChild(v); return v; });
    } else {
      const anim = mk(list[0]); anim.className = 'stack-anim';
      if(d.animshift) anim.style.transform = 'translateY(-' + d.animshift + '%)';   // nudge the animation up (% of frame height)
      stackwrap.appendChild(anim);
      const sw = document.createElement('div'); sw.className = 'stack-strips';
      const _bp = d.graphbottom !== undefined ? d.graphbottom
                : (d.animfit !== undefined ? STACK.bottomPct : null);
      if(_bp !== null) sw.style.bottom = _bp + '%';                                  // raise the graph strip(s) off the bottom
      stackwrap.appendChild(sw);
      const ZERO = { mom: 0.25, force: 0.75 };                 // zero-line heights in an impulse strip: momentum (blue) @25%, force F=0 (purple) @75%; gravity −mg sits lower ~78%
      stripEls = list.slice(1).map((src, i) => { const v = mk(src);
        v.addEventListener('loadedmetadata', () => layoutStack(cur), { once: true }); sw.appendChild(v);
        const comp = axes[i];                                  // "x" or "y" → two glyphs (momentum + force); absent → none
        if(comp === 'x' || comp === 'y'){
          const momEl = document.createElement('div'); momEl.className = 'stack-axis'; momEl.innerHTML = axisSVG('m' + (comp === 'x' ? 'u' : 'v')); stackwrap.appendChild(momEl);
          const fEl = document.createElement('div'); fEl.className = 'stack-axis'; fEl.innerHTML = axisSVG('F_' + comp); stackwrap.appendChild(fEl);
          axisEls.push({ strip: i, yfrac: ZERO.mom, el: momEl }, { strip: i, yfrac: ZERO.force, el: fEl });
        }
        return v;
      });
      els = [anim, ...stripEls];
      animEl = anim;
    }
    cur._stack = { els, stripEls, axisEls, animEl, sync, loop, started: false, frozen: false };
    if(autoplay || loop){ els.forEach(v => v.play().catch(() => {})); cur._stack.started = true; if(sync) startStackSync(cur._stack); }
    layoutStack(cur);
  }
  function playStack(cur){
    const st = cur._stack; if(!st) return; st.started = true; st.frozen = false;
    st.els.forEach(v => { try{ v.currentTime = 0; }catch(e){} v.play().catch(() => {}); });
    if(st.sync) startStackSync(st);
  }
  function freezeStack(cur){                                   // loop mode: jump every clip to its last frame and hold
    const st = cur._stack; if(!st) return;
    if(stackRaf){ cancelAnimationFrame(stackRaf); stackRaf = null; }
    st.frozen = true;
    st.els.forEach(v => { v.pause(); const dur = v.duration || st.els[0].duration || 0; try{ v.currentTime = Math.max(0, dur - 0.05); }catch(e){} });
  }
  function resetStack(cur){
    const st = cur._stack; if(!st) return;
    if(stackRaf){ cancelAnimationFrame(stackRaf); stackRaf = null; }
    st.started = false; st.frozen = false; st.els.forEach(v => { v.pause(); try{ v.currentTime = 0; }catch(e){} });
  }
  function startStackSync(st){                                 // master = clip 0; nudge any strip that drifts > ~60 ms
    if(stackRaf) cancelAnimationFrame(stackRaf);
    const master = st.els[0];
    const tick = () => {
      for(let i = 1; i < st.els.length; i++){ const v = st.els[i];
        if(!v.seeking && Math.abs(v.currentTime - master.currentTime) > 0.06){ try{ v.currentTime = master.currentTime; }catch(e){} } }
      stackRaf = requestAnimationFrame(tick);
    };
    stackRaf = requestAnimationFrame(tick);
  }

  document.querySelector('.reveal').addEventListener('click', (e) => {
    if(e.target.closest('.controls')) return;
    // A link is a link. Belt and braces alongside the z-index fix: even with the badge hit-testable,
    // this handler would still fire on the way up and pause the clip the moment the student clicked
    // through to the full video — leaving them a paused deck behind the new tab.
    if(e.target.closest('a[href]')) return;
    const curS = Reveal.getCurrentSlide();
    if(curS && curS._stack){                                   // stack slide: click toggles all tiles together
      const st = curS._stack;
      if(st.els.some(v => !v.paused)) pauseStack(); else playStack(curS);
      return;
    }
    const cur = Reveal.getCurrentSlide();
    if(!activeVideo || !cur || !cur.classList.contains('vid')) return;
    if(player.paused){ if(player.ended) player.currentTime = 0; player.play().catch(()=>{}); }
    else { player.pause(); }
  });

  // R resets to the frozen first frame (paused); press → to play again.
  Reveal.addKeyBinding({keyCode:82, key:'R', description:'Reset clip to first frame'}, () => {
    const cur = Reveal.getCurrentSlide();
    if(cur && cur._stack){ if(cur.dataset.loop !== undefined) playStack(cur); else resetStack(cur); return; }   // loop: restart; play-once: back to frame 0
    if(!activeVideo) return; player.pause(); player.currentTime = 0;
  });


  // ---------- data-fullvideo: "this clip was trimmed for posting, here's the whole thing" ----------
  // Set by publish_deck/homework_deck on slides whose clip was CUT to fit inside Canvas's ~100 MB per
  // class (canvas_clips.py). It is never set on a merely re-encoded clip — same clip, nothing to go
  // and see — and never in the deck Daniel presents from, which plays the full file off his laptop.
  // The link rides the attribution badge that is already there rather than adding a caption line: the
  // badge is under the media, it already names the source, and "whose video is this" and "where is the
  // rest of it" are one question. target=_blank + noopener so a click does not lose the deck.
  function setAttrib(d){
    if(!d.user){ hideAttrib(); return; }
    attrib.style.display = 'flex';
    const icon = ICON_BASE ? (ICON_BASE + (d.site || 'web') + '.svg')
                           : ((window.__SUITE_ICONS || {})[d.site || 'web'] || '');
    if(d.fullvideo){
      attrib.classList.add('hasfull');
      attrib.innerHTML = '<a target="_blank" rel="noopener noreferrer"><img alt=""><span class="u"></span>'
                       + '<span class="full">\u00b7 full video \u2197</span></a>';
      attrib.querySelector('a').href = d.fullvideo;
    } else {
      attrib.classList.remove('hasfull');
      attrib.innerHTML = '<img alt=""><span class="u"></span>';
    }
    attrib.querySelector('.u').textContent = d.user;
    attrib.querySelector('img').src = icon;
  }

  // ---------- data-then auto-playlist (e.g. the Class D DOS warm-up): clip ends -> load data-then, loop it ----------
  player.addEventListener('ended', () => {
    const cur = Reveal.getCurrentSlide();
    if(cur && cur.dataset.then && !player._swapped){
      player._swapped = true; player.loop = true;
      player.src = resolveSrc(cur.dataset.then); player.load();
      player.onloadeddata = () => { layoutActive(); player.play().catch(()=>{}); };
    }
  });

  // ---------- data-loopseq: play several cuts back-to-back, then loop the WHOLE sequence ----------
  // The generalisation of data-then to N clips with a wrap-around. Use when one continuous shot had to be
  // exported in parts (Class I's three-part Savosin finale) and you want it to behave like a single
  // seamless loop — nothing to advance, no per-cut keypress. `data-media` is the first cut (also the
  // overview thumbnail); `data-loopseq` is the full comma list. Contrast data-playlist, where the
  // presenter steps between cuts by hand. Per-clip `loop` must stay OFF or the first cut never ends.
  player.addEventListener('ended', () => {
    const cur = Reveal.getCurrentSlide();
    if(!cur || !cur.dataset.loopseq) return;
    const list = cur.dataset.loopseq.split(',').map(s => s.trim()).filter(Boolean);
    if(list.length < 2) return;
    cur._seqIdx = ((cur._seqIdx || 0) + 1) % list.length;
    player.loop = false;
    player.src = resolveSrc(list[cur._seqIdx]); player.load();
    player.onloadeddata = () => { layoutActive(); player.play().catch(()=>{}); };
  });

  // ---------- Live document camera (Class D; fully local — skipped in the speaker-view iframe) ----------
  function stopCamera(){
    if(camStream){ camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    camera.srcObject = null; camera.style.display = 'none';
    camctrls.style.display = 'none'; cammsg.style.display = 'none';
  }
  async function populateCamDevices(){
    try{
      const devs = await navigator.mediaDevices.enumerateDevices();
      const cams = devs.filter(d => d.kind === 'videoinput');
      const sel = document.getElementById('camselect'); if(!sel) return;
      const cur = sel.value; sel.innerHTML = '';
      cams.forEach((c,i) => { const o = document.createElement('option');
        o.value = c.deviceId; o.textContent = c.label || ('Camera ' + (i+1)); sel.appendChild(o); });
      if(cur) sel.value = cur;
    }catch(e){}
  }
  async function startCamera(){
    // NEVER on a student copy. publish_deck and homework_deck both drop `.cam` slides, so nothing
    // should reach here — but "nothing reaches this getUserMedia call" is a claim about two other
    // files, and the cost of being wrong is a browser asking a student for their webcam. The
    // `autoplay` attribute comes off the element for the same reason: an autoplaying <video> with no
    // src is the only thing in a published deck that asks the page for a permission it never uses.
    if(PUBLISHED) return;
    if(!inTopWindow || !navigator.mediaDevices){ return; }
    camera.style.display = 'block'; camctrls.style.display = 'flex';
    if(camStream) return;
    try{
      const sel = document.getElementById('camselect');
      const vc = { width:{ideal:1920}, height:{ideal:1080} };
      if(sel && sel.value) vc.deviceId = { exact: sel.value };
      const stream = await navigator.mediaDevices.getUserMedia({ video: vc, audio:false });
      camStream = stream; camera.srcObject = stream; await camera.play().catch(()=>{});
      cammsg.style.display = 'none';
      await populateCamDevices();
      // Auto-pick the USB document camera the first time (unless you chose one in the dropdown),
      // so you don't have to touch it live. Falls back to the default camera if none is found.
      if(sel && !sel.dataset.userPicked){
        const pref = [...sel.options].find(o => CFG.preferredCam.test(o.textContent));
        if(pref && sel.value !== pref.value){
          sel.value = pref.value;
          camStream.getTracks().forEach(t => t.stop()); camStream = null;
          startCamera(); return;
        }
      }
    }catch(e){
      cammsg.textContent = 'Camera off — click “Enable camera” (top-right) to allow access.';
      cammsg.style.display = 'block';
    }
  }
  document.getElementById('camenable').addEventListener('click', () => { populateCamDevices(); startCamera(); });
  document.getElementById('camselect').addEventListener('change', () => {
    document.getElementById('camselect').dataset.userPicked = '1';   // a manual pick wins over auto-select
    if(camStream){ camStream.getTracks().forEach(t => t.stop()); camStream = null; }
    startCamera();
  });
  // A camera may appear only once it is plugged in / "wakes" — re-list cameras when devices change.
  if(navigator.mediaDevices && navigator.mediaDevices.addEventListener)
    navigator.mediaDevices.addEventListener('devicechange', () => { if(camStream) populateCamDevices(); });

  // ---------- Four-up grid (data-quad, e.g. Class D's Scorched Earth): opener full-screen, then 4 looping tiles ----------
  function showQuad(sec){
    const list = (sec.dataset.quad || '').split(',').map(s => s.trim()).filter(Boolean);
    player.pause(); player.style.display = 'none'; still.style.display = 'none';
    activeVideo = false; hideAttrib(); yeartag.style.display = 'none';
    quadVideos.forEach((v,i) => {
      const src = list[i];
      if(!src){ v.style.visibility = 'hidden'; return; }
      v.style.visibility = 'visible';
      if(resolveSrc(src) !== v.src){ v.src = src; v.load(); }
      try{ v.currentTime = 0; }catch(e){}
      v.play().catch(()=>{});
    });
    quadgrid.style.display = 'grid';
  }
  function resetSpecials(){
    quadgrid.style.display = 'none';
    quadVideos.forEach(v => { try{ v.pause(); }catch(e){} });
    document.querySelectorAll('[data-quad]').forEach(s => { s._quadShown = false; });
    stopCamera();
    yeartag.style.display = 'none';
    player._swapped = false;
    document.querySelectorAll('[data-loopseq]').forEach(s => { s._seqIdx = 0; });   // re-arm the sequence at cut 0
  }

  // ---------- Comprehension-check poll ----------
  // Live votes come from Supabase when configured; otherwise the deck falls back to SIMULATED
  // votes so it still demos. Paste the SAME values you put in poll/vote.html:
  const SUPABASE_URL = CFG.supabaseUrl;
  const SUPABASE_ANON_KEY = CFG.supabaseAnonKey;
  // Poll mode. "auto" = LIVE when you run the deck as a local file (file://, your in-class copy),
  // DEMO when it's served from the web (a student-perusal upload — never touches logged votes).
  // Force it with "live" or "demo" in DECK_CONFIG if you ever need to.
  const POLL_OVERRIDE = CFG.pollOverride;             // "auto" | "live" | "demo"
  const HOSTED = location.protocol !== "file:";
  const POLL_LIVE = !!window.supabase && POLL_OVERRIDE !== "demo" && !!DECK_SECRET &&
                    (POLL_OVERRIDE === "live" || (!HOSTED && !SUPABASE_URL.includes("YOUR-PROJECT")));
  const supaClient = POLL_LIVE ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;
  const REMOTE_URL = CFG.remoteBase + CLASS_ID + "&v=" + CFG.remoteVersion;   // phone presenter remote (versioned → cache-busts)
  // poll-option colors = the MMA palette, read LIVE from tokens.css (single source; no duplicated hexes to drift).
  // House stack layout, from tokens.css (graph.stack_* in tokens.json). Fallbacks mirror the tokens for
  // a deck that somehow loads without tokens.css — keep them in sync, same rule as interactive.js.
  const STACK = (() => {
    const r = getComputedStyle(document.documentElement);
    const num = (n, d) => { const v = parseFloat(r.getPropertyValue(n)); return isNaN(v) ? d : v; };
    return { graphH: num('--stack-graph-h', 0.26), bottomPct: num('--stack-bottom-pct', 6),
             gapPct: num('--stack-gap-pct', 1.4) };
  })();

  const MMA = (() => { const r = getComputedStyle(document.documentElement);
    return ["--mma-blue","--mma-amber","--mma-green","--mma-red","--mma-purple",
            "--mma-brown","--mma-ltblue","--mma-gold","--mma-mauve","--mma-olive"]
      .map(n => r.getPropertyValue(n).trim() || "#888"); })();

  function demoCounts(nChoices, correct){
    const n = 26 + Math.floor(Math.random()*22), counts = Array(nChoices).fill(0);
    for(let k=0;k<n;k++){ counts[ Math.random()<0.55 ? correct : Math.floor(Math.random()*nChoices) ]++; }
    return counts;
  }
  function renderBars(sec, choices, counts, correct){
    const total = counts.reduce((a,b)=>a+b,0), max = Math.max(...counts, 1);
    choices.forEach((c,i)=>{
      c.querySelector('.bar').style.height = (100*counts[i]/max) + '%';
      c.querySelector('.pct').textContent  = total ? Math.round(100*counts[i]/total) + '%' : '0%';
      if(i===correct) c.classList.add('correct');
    });
    const scan = sec.querySelector('.scan');
    if(scan) scan.textContent = 'Voting closed · ' + total + ' response' + (total===1?'':'s');
  }
  async function sealPoll(sec){
    if(sec.classList.contains('sealing') || sec.classList.contains('sealed')) return;
    sec.classList.add('sealing');
    const choices = [...sec.querySelectorAll('.choice')];
    const correct = parseInt(sec.dataset.answer || '0', 10);
    let counts = Array(choices.length).fill(0);
    if(POLL_LIVE){
      try{
        const { data, error } = await supaClient.rpc('get_tally', { p_poll: sec.dataset.poll });
        if(error) throw error;
        (data||[]).forEach(r => { if(r.choice >= 0 && r.choice < counts.length) counts[r.choice] = Number(r.votes); });
      }catch(e){ console.warn('tally failed; showing demo data', e); counts = demoCounts(choices.length, correct); }
    } else {
      counts = demoCounts(choices.length, correct);   // no backend configured yet → simulated
    }
    renderBars(sec, choices, counts, correct);
    sec.classList.remove('sealing'); sec.classList.add('sealed');
    if(POLL_LIVE) supaClient.rpc('set_state', { p_class:CLASS_ID, p_poll:sec.dataset.poll, p_open:false, p_secret:DECK_SECRET }).catch(()=>{});
  }
  Reveal.on('ready', () => {
    try { if(window.QRCode) document.querySelectorAll('.poll').forEach(p =>
      new QRCode(p.querySelector('.qrimg'), { text:p.dataset.url, width:300, height:300, correctLevel:QRCode.CorrectLevel.M })); }
    catch(e){ console.warn('QR render failed', e); }
    try { const el = document.querySelector('#remote-qr .rq-code');   // presenter-remote QR
      if(window.QRCode && el && !el.childElementCount) new QRCode(el, { text:REMOTE_URL, width:300, height:300, correctLevel:QRCode.CorrectLevel.M }); }
    catch(e){ console.warn('remote QR render failed', e); }
    checkBackend();
  });

  // ---------- Backend health, reported ON THE QR SLIDE ----------
  // The failure this exists for: Supabase pauses a free project after about a week idle, and the only
  // symptom is the phone sitting forever on "waiting for the laptop deck…". That is a terrible place to
  // discover it — you are in front of a room, holding a phone, two minutes from starting. The check runs
  // when the deck opens and its result sits under the QR, which is the slide you pass on the way in, so
  // a paused project is something you find while reviewing rather than while presenting. Fixing it takes
  // about two minutes, and this buys you those two minutes.
  const PROJECT_REF = (SUPABASE_URL.match(/https:\/\/([a-z0-9]+)\.supabase/) || [])[1] || '';
  const DASHBOARD = PROJECT_REF ? 'https://supabase.com/dashboard/project/' + PROJECT_REF : 'https://supabase.com/dashboard';

  function rqStatus(){
    const host = document.querySelector('#remote-qr .remoteqr');
    if(!host) return null;
    let el = host.querySelector('.rq-status');
    if(!el){ el = document.createElement('div'); el.className = 'rq-status'; host.appendChild(el); }
    return el;
  }
  function checkBackend(){
    const el = rqStatus();
    if(!el) return;
    if(!POLL_LIVE){
      // Demo mode is legitimate (a published copy, or a deck served over http) — say which, and move on.
      const why = !window.supabase ? 'the Supabase library did not load (offline, or the CDN is blocked)'
                : !DECK_SECRET     ? 'this copy has no deckSecret — it is a published build, not the in-class deck'
                : HOSTED           ? 'the deck is being served over ' + location.protocol + ' — live polls need file://'
                                   : 'poll override is set to demo';
      el.className = 'rq-status checking';
      el.innerHTML = 'Polls and remote are in <b>demo</b> mode: ' + why + '.';
      return;
    }
    el.className = 'rq-status checking';
    el.textContent = 'Checking the poll backend…';
    // Steps are per-cause. Telling you to restore a paused project when the real problem is a rotated
    // key sends you to the dashboard to look at something that is already fine — the diagnosis is only
    // worth making if the instructions follow it.
    const DASH = '<a href="' + DASHBOARD + '" target="_blank" rel="noopener">Supabase dashboard</a>';
    const RELOAD = '<li>Reload this deck — the check runs again on open.</li>';
    const DIAG = '<li>Still failing? Run <b>slide-suite/poll/diagnose.html</b>, which separates a paused' +
                 ' project from blocked websockets from a rotated key.</li>';
    const STEPS = {
      paused: '<li>Open the ' + DASH + ' and press <b>Restore project</b> — a free project auto-pauses' +
              ' after about a week idle. Takes ~2 minutes.</li>' + RELOAD + DIAG,
      key:    '<li>Open the ' + DASH + ' → <b>Settings → API</b> and copy the publishable key.</li>' +
              '<li>Paste it into all three: <b>engine/deck.js</b> (the CFG block), <b>poll/vote.html</b>' +
              ' and <b>poll/diagnose.html</b>. They must match.</li>' + RELOAD,
      sql:    '<li>Open the ' + DASH + ' → <b>SQL Editor</b> and re-run <b>poll/supabase-setup.sql</b>' +
              ' in full.</li>' + RELOAD,
      other:  '<li>Open the ' + DASH + ' and check the project is healthy.</li>' + RELOAD + DIAG
    };
    const fail = (kind, headline, extra) => {
      el.className = 'rq-status fail';
      el.innerHTML = '<b>' + headline + '</b> The phone remote and live polls will not work.' +
        '<ol>' + (STEPS[kind] || STEPS.other) + '</ol>' +
        (extra ? '<div style="opacity:.65;margin-top:.35em">' + extra + '</div>' : '');
      console.warn('poll backend check FAILED —', headline, extra || '');
    };
    // Probe with the REAL client and a REAL function the deck depends on — `get_state`, which is
    // granted to anon and needs no secret. The earlier version did a raw fetch of /rest/v1/ carrying
    // only the apikey header; PostgREST also wants the Authorization bearer (supabase-js adds it), so a
    // perfectly healthy project answered 401 and this reported a rotated key. Probe the way the deck
    // actually talks, or the probe tests something the deck never does.
    let settled = false;
    const t = setTimeout(() => { if(!settled){ settled = true;
      fail('paused', 'The poll backend did not answer.', 'No response within 8 s.'); } }, 8000);
    supaClient.rpc('get_state', { p_class: CLASS_ID })
      .then(({ error }) => {
        if(settled) return; settled = true; clearTimeout(t);
        if(!error){
          el.className = 'rq-status ok';
          el.innerHTML = 'Poll backend reachable · live polls and phone remote should work.';
          return;
        }
        const code = (error.code || '').toString(), msg = (error.message || String(error));
        if(/apikey|JWT|invalid|401|403/i.test(msg) || code === 'PGRST301')
          fail('key', 'The poll backend rejected the key.',
               msg + ' — the publishable key may have been rotated. It has to match in ' +
               'engine/deck.js, poll/vote.html and poll/diagnose.html.');
        else if(code === 'PGRST202')
          fail('sql', 'The database functions are missing.',
               'get_state not found — re-run poll/supabase-setup.sql in the SQL editor.');
        else if(/fetch|network|Failed to fetch|ERR_/i.test(msg))
          fail('paused', 'The poll backend is unreachable.', 'Most likely the project has auto-paused. (' + msg + ')');
        else fail('other', 'The poll backend returned an error.', (code ? code + ' — ' : '') + msg);
      })
      .catch(e => { if(settled) return; settled = true; clearTimeout(t);
        fail('paused', 'The poll backend is unreachable.',
             'Most likely the project has auto-paused. (' + (e.message || e.name) + ')'); });
  }
  // ONE Live/demo badge, MOVED into whichever poll/wheel slide is current. A DOM node can only be in
  // one place, so there's never a duplicate; living in the slide content, it migrates as you resize.
  const modeBadge = document.createElement('div');
  modeBadge.className = 'pollmode ' + (POLL_LIVE ? 'live' : 'demo');
  modeBadge.innerHTML = '<span class="lamp"></span>' + (POLL_LIVE ? 'Live' : 'Demo · sample data');
  function placeBadge(){
    const cur = Reveal.getCurrentSlide();
    if(cur && (cur.classList.contains('poll') || cur.classList.contains('wheel'))) cur.appendChild(modeBadge);
    else if(modeBadge.parentNode) modeBadge.parentNode.removeChild(modeBadge);
  }
  Reveal.on('ready', placeBadge);
  Reveal.on('slidechanged', placeBadge);

  // Per-question "Reset votes" (live decks only): wipes THIS question's votes, re-opens it, leaves others.
  async function resetQuestion(sec){
    const pid = sec.dataset.poll;
    if(POLL_LIVE){
      const { error } = await supaClient.rpc('reset_question', { p_class:CLASS_ID, p_poll:pid, p_secret:DECK_SECRET });
      if(error){ console.warn('reset_question failed →', error.message || error, '(re-run supabase-setup.sql?)'); return; }
      console.log('POLL reset + re-opened', pid);
    }
    sec.classList.remove('sealed','sealing');
    sec.querySelectorAll('.choice').forEach(c => { c.classList.remove('correct');
      c.querySelector('.bar').style.height = '0'; c.querySelector('.pct').textContent = ''; });
    const scan = sec.querySelector('.scan'); if(scan) scan.textContent = 'Scan to vote';
  }
  // ONE Reset-votes button (live only), MOVED into the current poll slide — same single-node trick as the
  // badge. One-per-section leaked the adjacent poll's button onto the current slide; a single node can't.
  let resetBtn = null, resetArmed = false, resetTimer = null;
  if(POLL_LIVE){
    resetBtn = document.createElement('button'); resetBtn.className = 'poll-reset'; resetBtn.textContent = '↻ Reset votes';
    resetBtn.addEventListener('click', async () => {
      const sec = Reveal.getCurrentSlide();
      if(!sec || !sec.classList.contains('poll')) return;
      if(!resetArmed){ resetArmed = true; resetBtn.classList.add('armed'); resetBtn.textContent = 'Wipes votes — click again';
        resetTimer = setTimeout(() => { resetArmed = false; resetBtn.classList.remove('armed'); resetBtn.textContent = '↻ Reset votes'; }, 3000); return; }
      clearTimeout(resetTimer); resetArmed = false; resetBtn.classList.remove('armed'); resetBtn.textContent = 'Resetting…';
      await resetQuestion(sec); resetBtn.textContent = '↻ Reset votes';
    });
  }
  function placeReset(){
    if(!resetBtn) return;
    clearTimeout(resetTimer); resetArmed = false; resetBtn.classList.remove('armed'); resetBtn.textContent = '↻ Reset votes';
    const cur = Reveal.getCurrentSlide();
    if(cur && cur.classList.contains('poll')) cur.appendChild(resetBtn);
    else if(resetBtn.parentNode) resetBtn.parentNode.removeChild(resetBtn);
  }
  Reveal.on('ready', placeReset);
  Reveal.on('slidechanged', placeReset);

  // Right-arrow / PageDown: on a poll, first press seals + reveals results; on a fresh video clip,
  // first press plays it; otherwise advance (which also steps reveal fragments, e.g. practice solutions).
  // Speaker-view iframe → MAIN deck bridge. Reading a function off another window is blocked cross-origin
  // (file:// treats each window as its own origin), but postMessage is allowed cross-window — same channel
  // reveal's own speaker sync uses. So we message the opener (the main deck) and it runs smartNext there.
  function forwardSmartNext(){
    const nonce = Date.now() + '.' + Math.random().toString(36).slice(2);
    let ok = false;
    try{ localStorage.setItem('__deckNav', nonce); ok = true; }catch(e){}    // fires a 'storage' event in the MAIN window — no window handle needed
    try{ const main = (window.top && window.top.opener) || (window.parent && window.parent.opener) || window.opener;
         if(main){ main.postMessage({ __deck:'smartNext', nonce }, '*'); ok = true; } }catch(e){}   // backup channel
    return ok;
  }
  let _lastNav = null;
  function handleRemoteNav(nonce){ if(nonce && nonce === _lastNav) return; _lastNav = nonce; smartNext(); }  // dedup across the two channels
  window.addEventListener('storage', ev => { if(window.self === window.top && ev.key === '__deckNav' && ev.newValue) handleRemoteNav(ev.newValue); });
  window.addEventListener('message', ev => { if(window.self === window.top && ev.data && ev.data.__deck === 'smartNext') handleRemoteNav(ev.data.nonce); });

  function smartNext(){
    // In the speaker-view iframe (a read-only mirror), NEVER act locally — forward the advance to the MAIN deck
    // window, so the sim/clip/poll/exit-quiz fires on the projector, not in the little speaker preview.
    if(window.self !== window.top){   // speaker-view iframe → signal the MAIN window; do NOT navigate locally (that advanced past the sim)
      forwardSmartNext();
      return;
    }
    const cur = Reveal.getCurrentSlide();
    // Sim slide: the first → plays the animation; once it's been played (→ or a Play click), → advances.
    if(cur && cur.classList.contains('sim') && cur._sim && !cur._sim.everPlayed){ cur._sim.play(); return; }
    // Quad slide (data-quad): first → plays the full-screen opener, second → tiles the four-up grid, next → advances.
    if(cur && cur.dataset.quad !== undefined && !cur._quadShown){
      if(activeVideo && cur.dataset.autoplay === undefined && player.paused && player.currentTime < 0.05 && !player.ended){ player.play().catch(()=>{}); return; }
      showQuad(cur); cur._quadShown = true; return;
    }
    if(cur && cur.classList.contains('poll') && !cur.classList.contains('sealed')){ sealPoll(cur); return; }
    // Synced video stack. Loop mode (data-loop): it's already looping; first → freezes on the last frame, next → advances.
    // Play-once mode: first → plays it together, next → advances.
    if(cur && cur.dataset.stack && cur.dataset.sync !== undefined){
      const st = cur._stack;
      if(cur.dataset.loop !== undefined){ if(st && !st.frozen){ freezeStack(cur); return; } }
      else { if(!st || !st.started){ playStack(cur); return; } }
    }
    // Multi-clip playlist slide (e.g. the Lewin cuts): first → plays clip 0; each later → jumps to the next
    // clip and plays it; after the last clip, fall through and advance the slide normally.
    if(cur && cur.classList.contains('vid') && cur.dataset.playlist && cur._pl){
      const pl = cur._pl;
      if(!pl.started){ pl.started = true; if(player.ended) player.currentTime = 0; player.play().catch(()=>{}); return; }
      if(pl.idx < pl.list.length - 1){ pl.idx++; playPlaylistClip(pl); return; }
      // last clip reached → fall through to Reveal.next()
    }
    if(activeVideo && cur && cur.classList.contains('vid') && cur.dataset.autoplay === undefined && player.paused && player.currentTime < 0.05 && !player.ended){
      player.play().catch(()=>{}); return;   // "first → plays a fresh clip" — but NOT warm-up/autoplay slides, which → should just skip past
    }
    // Static quiz (concept / homework MC): first → reveals the correct answer green; next → advances.
    if(cur && cur.classList.contains('quiz') && !cur.classList.contains('revealed')){ cur.classList.add('revealed'); return; }
    if(cur && cur.dataset.exitClass !== undefined && exitQuiz.style.display === 'none'){ exitQuiz.style.display = 'block'; return; }   // final slide: reveal the exit-quiz notice (+password in class)
    Reveal.next();
  }
  Reveal.addKeyBinding({keyCode:39, key:'→',    description:'Play clip, then advance'}, smartNext);
  Reveal.addKeyBinding({keyCode:34, key:'PgDn', description:'Play clip, then advance'}, smartNext);

  // Back: on a playlist slide, ← / PgUp steps to the PREVIOUS cut (like separate slides) before leaving the slide.
  function smartPrev(){
    const cur = Reveal.getCurrentSlide();
    if(cur && cur.classList.contains('vid') && cur.dataset.playlist && cur._pl && cur._pl.idx > 0){
      cur._pl.idx--; cur._pl.started = true; showPlaylistClip(cur._pl, cur.dataset); return;
    }
    Reveal.prev();
  }
  Reveal.addKeyBinding({keyCode:37, key:'←',    description:'Back a clip, then previous slide'}, smartPrev);
  Reveal.addKeyBinding({keyCode:33, key:'PgUp', description:'Back a clip, then previous slide'}, smartPrev);

  // E — REHEARSAL AID: skip to the last ~3 s of the current clip. Checking how a slide ends should not
  // cost you the whole runtime; Class A's finale is 3.5 minutes and its end card only exists once the
  // clip finishes. Also useful for the `ended` behaviors generally (data-endcard, data-then, loopseq).
  // Not a presenting key — it just seeks the video that is already on screen.
  // Not registered on a published copy: a student pressing E would skip the clip they are watching.
  if(!PUBLISHED) Reveal.addKeyBinding({keyCode:69, key:'E', description:'Skip to the end of the current clip (rehearsal)'}, () => {
    if(!activeVideo || !player.duration || !isFinite(player.duration)) return;
    try{ player.currentTime = Math.max(0, player.duration - 3); }catch(e){}
    player.play().catch(()=>{});
  });

  Reveal.on('ready', configure);
  Reveal.on('slidechanged', configure);
  // Re-arm quiz slides when you leave them, so returning shows the un-revealed question.
  Reveal.on('slidechanged', () => { document.querySelectorAll('section.quiz.revealed').forEach(q => { if(q !== Reveal.getCurrentSlide()) q.classList.remove('revealed'); }); });
  Reveal.on('resize', layoutActive);
  window.addEventListener('resize', layoutActive);
  // In the Esc/overview grid any full-viewport media surface would cover the thumbnails (and eat their
  // clicks) — hide them all there. stackwrap is `position:absolute; inset:0`, so pausing it isn't enough:
  // if you Esc while on a synced/tiled stack slide it stays on top and its thumbnail (and its neighbors)
  // can't be selected. overviewhidden → configure() rebuilds the stack for the slide you land on.
  Reveal.on('overviewshown', () => { layer.style.display = 'none'; player.pause(); pauseStack(); stackwrap.style.display = 'none'; stopCamera(); quadgrid.style.display = 'none'; });
  Reveal.on('overviewhidden', configure);

  // Starfield for data-stars slides (e.g. the asteroid): scatter tiny white dots with a gentle twinkle.
  (function makeStars(){
    const sf = document.getElementById('starfield'); if(!sf || sf.childElementCount) return;
    const N = 150, frag = document.createDocumentFragment();
    for(let i=0;i<N;i++){
      const s = document.createElement('span');
      const size = Math.random()<0.15 ? 2 : 1;                 // a few brighter/bigger stars
      s.style.width = s.style.height = size + 'px';
      s.style.left = (Math.random()*100).toFixed(2) + '%';
      s.style.top  = (Math.random()*100).toFixed(2) + '%';
      s.style.opacity = (0.3 + Math.random()*0.7).toFixed(2);
      if(Math.random()<0.4) s.style.animation = `twinkle ${(2.5+Math.random()*4).toFixed(1)}s ease-in-out ${(Math.random()*4).toFixed(1)}s infinite`;
      frag.appendChild(s);
    }
    sf.appendChild(frag);
  })();

  // ---------- data-endcard: reveal an on-slide overlay when the clip finishes ----------
  // For a finale that should NOT loop: the clip plays once, holds on its last frame (default <video>
  // behavior), and the engine tags the section `.ended` so per-deck CSS can bring up a label or an
  // arrow pointing into that frozen frame. Class A uses it to credit the engineers in the OK Go shot.
  // Purely a class hook — the engine draws nothing itself.
  function clearEndcard(){ document.querySelectorAll('section.ended').forEach(s => s.classList.remove('ended')); }
  Reveal.on('slidechanged', clearEndcard);
  // The card comes up a LEAD before the clip finishes, not on `ended` — landing it while the picture is
  // still moving reads as part of the shot rather than as something bolted onto a freeze. Default 1 s;
  // `data-endcard="2"` overrides. `timeupdate` fires ~4x/second, so a one-second lead is comfortable,
  // and `ended` stays wired as a backstop in case a seek skips past the window.
  function armEndcard(v){
    const hit = () => {
      if(v !== player) return;                 // ignore the hidden buffer; `player` swaps on a cross-fade
      const cur = Reveal.getCurrentSlide();
      if(!cur || cur.dataset.endcard === undefined) return;
      const lead = parseFloat(cur.dataset.endcard) || 1;
      if(!v.duration || !isFinite(v.duration)) return;
      if(v.duration - v.currentTime <= lead) cur.classList.add('ended');
    };
    v.addEventListener('timeupdate', hit);
    v.addEventListener('ended', hit);
  }
  armEndcard(player);
  armEndcard(playerB);        // the buffer can be the visible one after a frame-matched swap

  // `.playing` — set on the section the moment its clip actually starts, cleared on slide change.
  // A slide that holds on its first frame needs to know the difference between "on screen" and
  // "running": an overlay timed off `.present` starts counting while the picture is still frozen and
  // has already gone by the time you press play. Class A's finale hangs its opening credit off this.
  function clearPlaying(){ document.querySelectorAll('section.playing').forEach(s => s.classList.remove('playing')); }
  Reveal.on('slidechanged', clearPlaying);
  function armPlaying(v){
    v.addEventListener('play', () => {
      if(v !== player) return;
      const cur = Reveal.getCurrentSlide();
      if(cur) cur.classList.add('playing');
    });
  }
  armPlaying(player);
  armPlaying(playerB);

  // Exit-quiz overlay: any slide with data-exit-pw shows "Class X Exit Quiz / Password: Y" bottom-left on advance.
  const exitQuiz = document.getElementById('exitquiz');
  function placeExitQuiz(){
    const cur = Reveal.getCurrentSlide();
    if(cur && cur.dataset.exitClass !== undefined){
      exitQuiz.querySelector('.eq-title').textContent = 'Class ' + (cur.dataset.exitClass || '') + ' Exit Quiz';
      // published copies strip data-exit-pw: the notice shows, the password stays in-class-only
      exitQuiz.querySelector('.eq-pw').textContent = cur.dataset.exitPw ? ('Password: ' + cur.dataset.exitPw) : '(password given in class)';
    }
    exitQuiz.style.display = 'none';           // always start hidden; the advance key reveals it
  }
  Reveal.on('ready', placeExitQuiz);
  Reveal.on('slidechanged', placeExitQuiz);
  Reveal.on('overviewshown', () => { exitQuiz.style.display = 'none'; });

  // Tag every slide with its id (shown only in Esc overview) so the mostly-black video/sim/blank slides are identifiable.
  Reveal.on('ready', () => {
    document.querySelectorAll('.reveal .slides > section').forEach(sec => {
      if(sec.querySelector(':scope > .slabel')) return;
      const el = document.createElement('div'); el.className = 'slabel'; el.textContent = sec.dataset.title || sec.id || '';
      sec.appendChild(el);
    });
  });

  // ---------- Interactive sim slides: mount once, run the loop only while the slide is active ----------
  let currentSim = null;
  function handleSim(){
    const cur = Reveal.getCurrentSlide();
    const nextSim = (cur && cur.classList.contains('sim')) ? cur._sim : null;
    if(currentSim && currentSim !== nextSim){                 // left the sim (or moved to a different one): auto-reset
      currentSim.stop(); currentSim.reset(); currentSim.everPlayed = false;
      if(currentSim.refreshPlayBtn) currentSim.refreshPlayBtn();
      currentSim = null;
    }
    if(cur && cur.classList.contains('sim') && window.Interactive){
      if(!cur._sim) cur._sim = Interactive.mount(cur);
      cur._sim.resize(); cur._sim.render(); cur._sim.start();
      currentSim = cur._sim;
    }
  }
  Reveal.on('ready', handleSim);
  Reveal.on('slidechanged', handleSim);

  // ---------- Single-QR follow-along: tell the student pages which question is live ----------
  // Fresh-start check: wipes this class's votes only if it's been idle a while (a new session),
  // so reopening the deck mid-class keeps votes. Runs once, before the first set_state.
  let sessionStarted = false;
  async function initSession(){
    if(sessionStarted) return; sessionStarted = true;
    // try/catch, not just the error field: when the project is unreachable the RPC *rejects* rather
    // than resolving with an error, and an unhandled rejection here buries the QR slide's diagnosis
    // under a stack trace — right when that diagnosis is the thing you need to read.
    try{
      const { data, error } = await supaClient.rpc('start_session', { p_class:CLASS_ID, p_secret:DECK_SECRET });
      if(error) console.warn('POLL start_session failed →', error.message || error, '(re-run supabase-setup.sql?)');
      else if(data) console.log('POLL new session — votes reset for', CLASS_ID);
    }catch(e){ console.warn('POLL start_session unreachable →', e.message || e); }
  }
  async function announcePoll(){
    if(!POLL_LIVE) return;
    await initSession();
    const cur = Reveal.getCurrentSlide();
    const onPoll = cur && cur.classList.contains('poll');
    try{
      const { error } = await supaClient.rpc('set_state', {
        p_class: CLASS_ID,
        p_poll:  onPoll ? cur.dataset.poll : null,
        p_open:  onPoll ? !cur.classList.contains('sealed') : false,
        p_secret: DECK_SECRET
      });
      if(error) console.warn('POLL set_state failed →', error.message || error, '(re-run supabase-setup.sql?)');
      else if(onPoll) console.log('POLL announced', cur.dataset.poll, 'open=' + !cur.classList.contains('sealed'));
    }catch(e){ console.warn('POLL set_state unreachable →', e.message || e); }
  }
  Reveal.on('ready', announcePoll);
  Reveal.on('slidechanged', announcePoll);

  // ---------- Prize wheel (perfect scorers) ----------
  async function loadWinners(){
    const polls = [...document.querySelectorAll('.poll:not([data-survey])')];   // survey polls have no right answer
    const ids = polls.map(p => p.dataset.poll), correct = polls.map(p => +p.dataset.answer);
    if(POLL_LIVE){
      try{
        const { data, error } = await supaClient.rpc('get_winners',
          { p_class:CLASS_ID, p_polls:ids, p_correct:correct, p_secret:DECK_SECRET });
        if(error) throw error;
        return (data || []).map(r => r.computing_id);
      }catch(e){ console.warn('get_winners failed', e); return []; }
    }
    return ["abc1de","kml7py","qrs9tt","zub4xq","dhw2ne","tpv6la","enq8rk"];  // demo pool
  }

  // TWO reels, one Spin. Left = who won (perfect scorers); right = what they win. The prize reel is
  // geared to stop at 6 s while the name reel runs 8 s, so the room learns the stakes and then the name.
  // The prize reel is a literal 100-slot cycle: 99 "select a prize" slots + one $20 — a true 1/100.
  // Every slot is labelled: an unlabelled band was cleaner but unreadable, and the point of the slide
  // is that the room understands the odds it is looking at.
  //
  // LANDING SLOT vs TRAVEL — the two are deliberately separate. Which slot wins is the random draw;
  // how far the reel travels to reach it is a *second* independent random choice of which repetition
  // of that slot to stop on. Without the second one every spin covers nearly the same distance and
  // the whole thing reads as canned, however random the outcome actually is.
  // ODDS: 1/26, chosen to match the 26 class meetings (Class A–Z) — one spin per class gives an
  // expected payout of exactly 1.00 over the semester. Memoryless, so no class is ever "due".
  // The flip side, worth remembering before betting the bit on it: a 36% chance it never fires all
  // semester, and a 26% chance it fires twice. If the wheel ends up on fewer than 26 decks, the
  // denominator should come down to match the number of spins or the payout stops being credible.
  const PRIZE_CYCLE  = 26,    // slots per cycle → the odds ARE this denominator
        JACKPOT_AT   = 13,    // which slot in the cycle is the $20 (mid-cycle)
        PRIZE_CYCLES = 7,     // cycles built into the DOM (runway past the furthest landing)
        // Which cycle the prize reel may stop in, and so how far it travels. This is the knob that
        // sets how often the $20 flies past mid-spin — one sighting per cycle travelled — and it has
        // to move whenever PRIZE_CYCLE does: a shorter cycle packs the green slots closer, so the
        // same distance in pixels shows it far more often. Cycle 3–4 gives 3–5 sightings at 1/26.
        PRIZE_LAND   = [3,4],
        PRIZE_REST   = 11,    // parked slot: puts the $20 visible below the pointer at rest
        NAME_MIN_SEGS= 160,   // name reel is padded to at least this many slots so it has runway
        PRIZE_SPIN_S = 6, NAME_SPIN_S = 8;
  const PRIZE_TEXT = 'Select a prize', JACKPOT_TEXT = '$20';
  const rnd = n => Math.floor(Math.random() * n);

  function mountWheel(section){
    // Both reels use 40 px slots so the two amber pointer bands come out the same thickness — that
    // match is load-bearing visually. Must equal .wheel-seg's height in the CSS. (Text size still
    // differs per reel; only the geometry is shared.)
    const SEGH = 40, PSEGH = 40, WINH = 320;
    // Resting slot for the winner reel. It must be far enough down the strip that the slots ABOVE it
    // fill the window — park too high and you see the end of the strip as blank space above slot 0,
    // which instantly gives away that this is a sliding ribbon rather than a wheel. Derived rather
    // than hard-coded so it stays correct if the slot or window height changes.
    const NAME_REST = Math.ceil((WINH/2 - SEGH/2) / SEGH);
    const strip   = section.querySelector('.wheel-strip');
    const winnerEl= section.querySelector('.wheel-winner');
    const countEl = section.querySelector('.wheel-count');
    const spinBtn = section.querySelector('.wheel-spin');
    const loadBtn = section.querySelector('.wheel-load');
    let ids = [], seq = [], spinning = false;

    // The decks ship one window; build the prize reel and the two-column stage here so no deck
    // HTML has to change (and a re-published deck can't lose it).
    const nameWin = section.querySelector('.wheel-window');
    const prizeWin = document.createElement('div'); prizeWin.className = 'wheel-window prize';
    const prizeStrip = document.createElement('div'); prizeStrip.className = 'wheel-strip';
    const prizePtr = document.createElement('div'); prizePtr.className = 'wheel-pointer';
    prizeWin.append(prizeStrip, prizePtr);
    const col = (text, win) => {
      const c = document.createElement('div'); c.className = 'wheel-col';
      const l = document.createElement('div'); l.className = 'wheel-label'; l.textContent = text;
      c.append(l, win); return c;
    };
    const stage = document.createElement('div'); stage.className = 'wheel-stage';
    nameWin.parentNode.insertBefore(stage, nameWin);
    stage.append(col('Winner', nameWin), col('Prize', prizeWin));   // append moves nameWin into the column

    // The geometry helpers take the slot height as an argument rather than closing over one
    // constant, from when the two reels were different sizes. Index increasing = strip moves up.
    const yFor  = (i, h) => i * h - (WINH/2 - h/2);
    const park  = (el, i, h) => { el.style.transition = 'none'; el.style.transform = `translateY(${-yFor(i,h)}px)`;
                                  void el.offsetHeight; };          // reflow so the reset applies before the spin
    const glide = (el, i, h, secs) => { el.style.transition = `transform ${secs}s cubic-bezier(.17,.66,.24,1)`;
                                        requestAnimationFrame(() => { el.style.transform = `translateY(${-yFor(i,h)}px)`; }); };
    let nameRep = 0;                                    // repetitions of the id list built into the name reel

    function buildPrizeStrip(){
      prizeStrip.innerHTML = '';
      for(let i=0; i<PRIZE_CYCLE*PRIZE_CYCLES; i++){
        const k = i % PRIZE_CYCLE, d = document.createElement('div');
        if(k === JACKPOT_AT){ d.className = 'wheel-seg jackpot'; d.textContent = JACKPOT_TEXT; }
        else { d.className = 'wheel-seg prize'; d.textContent = PRIZE_TEXT; }
        prizeStrip.appendChild(d);
      }
      park(prizeStrip, PRIZE_REST, PSEGH);
    }

    async function load(){
      winnerEl.innerHTML = '&nbsp;'; countEl.textContent = 'loading…'; spinBtn.disabled = true;
      buildPrizeStrip();
      ids = await loadWinners();
      strip.innerHTML = '';
      if(!ids.length){ countEl.textContent = 'no perfect scores yet'; return; }
      // Deliberately silent on a normal load — the pool size is instructor bookkeeping, not something
      // the room needs on the projector. The slot is kept for the two states that DO need explaining:
      // "loading…", and "no perfect scores yet" (which is why Spin is greyed out).
      countEl.textContent = '';
      spinBtn.disabled = false;
      // Pad to NAME_MIN_SEGS (min 6 reps) so there is room to stop on a randomly chosen repetition.
      nameRep = Math.max(6, Math.ceil(NAME_MIN_SEGS / ids.length));
      seq = [];
      for(let r=0;r<nameRep;r++) for(const id of ids) seq.push(id);
      seq.forEach(id => {
        const d = document.createElement('div'); d.className = 'wheel-seg name';
        d.textContent = id; strip.appendChild(d);
      });
      park(strip, NAME_REST, SEGH);
    }
    function spin(){
      if(spinning || !ids.length) return;
      spinning = true; winnerEl.innerHTML = '&nbsp;';
      [...strip.children].forEach(c => c.classList.remove('hit'));
      [...prizeStrip.children].forEach(c => c.classList.remove('hit'));

      // WHO wins — a flat draw over the pool.
      const winner = ids[rnd(ids.length)];
      // HOW FAR to get there — an independent draw over which repetition of that name to stop on,
      // somewhere in the back half of the reel. This is what makes two spins look different.
      // The top of the range is capped so the window can never run off the END of the strip: TAIL is
      // how many slots sit below the pointer inside the window, and showing past them would put blank
      // space under the winning name. With a big pool the cap never binds, but a pool of one or two
      // (a hard quiz, or early in the semester) lands deep in the strip and would otherwise expose it.
      const TAIL   = Math.floor((WINH/2 + SEGH/2 - 1) / SEGH);
      const maxLap = Math.max(0, Math.floor((seq.length - 1 - TAIL - (ids.length - 1)) / ids.length));
      const minLap = Math.min(Math.floor(nameRep/2), maxLap);
      const lap    = minLap + rnd(maxLap - minLap + 1);
      const target = lap * ids.length + ids.indexOf(winner);

      // WHAT they win — a flat 1/PRIZE_CYCLE, then the same independent draw over travel distance.
      const jackpot = Math.random() < 1/PRIZE_CYCLE;
      const slot = jackpot ? JACKPOT_AT : (() => { let k; do { k = rnd(PRIZE_CYCLE); } while(k === JACKPOT_AT); return k; })();
      // Both reels run the SAME way (upward): start low, climb to the landing. A counter-rotating
      // version was tried and reverted — two reels moving opposite ways at once is unpleasant to
      // watch for the several seconds this takes.
      const prizeTarget = PRIZE_LAND[rnd(PRIZE_LAND.length)] * PRIZE_CYCLE + slot;

      park(strip, NAME_REST, SEGH); park(prizeStrip, PRIZE_REST, PSEGH);
      glide(strip, target, SEGH, NAME_SPIN_S); glide(prizeStrip, prizeTarget, PSEGH, PRIZE_SPIN_S);

      // The prize reel lands 2 s early, but says nothing — the reel itself under the pointer IS the
      // announcement, and a running commentary under the reels just added noise. One line, once,
      // at the end: who won and what they won.
      setTimeout(() => {
        const seg = prizeStrip.children[prizeTarget]; if(seg) seg.classList.add('hit');
      }, PRIZE_SPIN_S*1000 + 200);
      setTimeout(() => {
        spinning = false;
        const seg = strip.children[target]; if(seg) seg.classList.add('hit');
        winnerEl.innerHTML = '<b>' + winner + '</b> — ' +
          (jackpot ? '<b class="jack">$20</b>' : '<span class="dim">select a prize</span>');
      }, NAME_SPIN_S*1000 + 200);
    }
    loadBtn.addEventListener('click', load);
    spinBtn.addEventListener('click', spin);
    load();
  }
  // 'ready' as well as 'slidechanged': hash:true means a reload can land straight ON the wheel slide,
  // which fires no slidechanged — without this the reels never mount and the slide sits empty.
  Reveal.on('ready', mountWheelIfCurrent);
  Reveal.on('slidechanged', mountWheelIfCurrent);
  function mountWheelIfCurrent(){
    const cur = Reveal.getCurrentSlide();
    if(cur && cur.classList.contains('wheel') && !cur._wheel){ cur._wheel = true; mountWheel(cur); }
  }

  // ---------- Esc-overview thumbnails (local, no hosting) ----------
  // The single shared #media-layer can't fill the overview grid, so give each MEDIA slide its own hidden
  // <video>/<img> of its clip, shown only in overview. Pre-warmed (staggered) a moment after load so the
  // first Esc has no lag; a page refresh re-warms. Non-media slides just keep their title label.
  Reveal.on('ready', () => {
    // Descendant selector, not `.slides > section`: reveal's print mode reparents slides into
    // `div.pdf-page` wrappers, and a direct-child selector silently stops matching there.
    document.querySelectorAll('.reveal .slides section.vid').forEach(sec => {
      if(sec.querySelector(':scope > .ovthumb') || !sec.dataset.media) return;
      const media = sec.dataset.media;
      let el;
      if(isStill(media)){ el = document.createElement('img'); el.alt = ''; }
      else { el = document.createElement('video'); el.muted = true; el.playsInline = true; el.preload = 'auto'; }
      el.className = 'ovthumb'; el.dataset.src = media;
      sec.appendChild(el);
    });
    const warm = () => {
      const thumbs = [...document.querySelectorAll('.ovthumb')]; let i = 0;
      (function next(){
        if(i >= thumbs.length) return;
        const el = thumbs[i++];
        if(el.dataset.src && !el.getAttribute('src')){
          if(el.tagName === 'VIDEO') el.addEventListener('loadeddata', () => { try{ el.currentTime = 0.3; }catch(e){} }, { once:true });
          el.setAttribute('src', el.dataset.src);   // triggers the buffer + first-frame decode while still hidden
        }
        setTimeout(next, 120);   // stagger so we don't decode ~15 clips all at once
      })();
    };

    if('requestIdleCallback' in window) requestIdleCallback(warm, { timeout:2500 }); else setTimeout(warm, 1500);
  });

  // Trackpad scroll to move through the Esc overview (two-finger, horizontal or vertical) instead of click-by-click.
  (function overviewScroll(){
    let acc = 0, last = 0;
    window.addEventListener('wheel', (e) => {
      if(!Reveal.isOverview()) return;            // only hijack scroll while the overview is open
      e.preventDefault();                          // and stop the browser's own back/forward swipe
      const delta = Math.abs(e.deltaX) >= Math.abs(e.deltaY) ? e.deltaX : e.deltaY;   // dominant axis
      acc += delta;
      const now = Date.now(), STEP = 50, GAP = 90;
      if(now - last < GAP) return;                 // throttle trackpad momentum to a steady pace
      if(acc >= STEP){ Reveal.next(); acc = 0; last = now; }
      else if(acc <= -STEP){ Reveal.prev(); acc = 0; last = now; }
    }, { passive:false });
  })();

  // ---------- Presenter remote (phone): broadcast slide state, receive Prev/Next — SAME Supabase project ----------
  // Additive + fail-safe: runs only when the poll backend is live (local file://). If wifi/Supabase is down it
  // silently no-ops and the laptop deck — including the built-in S speaker view + a clicker — is unaffected.
  // One presenter phone = one realtime socket (well under the free cap; the "no realtime" rule was about 400 students).
  (function presenterRemote(){
    // MAIN window only. The speaker-view "current" and "upcoming" iframes also load this deck; if they broadcast
    // too, the upcoming iframe reports the NEXT slide as current and the phone oscillates between N and N+1.
    if(!supaClient || window.self !== window.top) return;
    // Prefer the RAW ($…$) snapshot captured at ready; fall back to live innerHTML. Raw text keeps the payload tiny.
    const notesOf = sec => { if(!sec) return ''; if(sec._rawNotes != null) return sec._rawNotes;
                             const n = sec.querySelector(':scope > aside.notes'); return n ? n.innerHTML : ''; };
    function typeOf(sec){
      if(!sec) return '';
      if(sec.dataset.type) return sec.dataset.type;    // manifest override: type: → data-type
      const c = sec.classList, id = sec.id || '';
      if(c.contains('sim')) return 'sim';
      if(c.contains('poll')) return 'poll';
      if(c.contains('wheel')) return 'wheel';
      if(c.contains('cam')) return 'camera';
      if(c.contains('board')) return 'board';
      if(c.contains('intro')) return 'intro';
      if(c.contains('divider')) return 'title';
      if(c.contains('practice')) return 'practice';                              // in-class + post-quiz practice
      if(c.contains('quiz')) return id.indexOf('hw-') === 0 ? 'homework' : 'quiz';   // hw questions vs exit quiz
      if(c.contains('doc'))  return id.indexOf('hw-') === 0 ? 'homework' : 'slide';  // hw solutions/intros ride along
      if(c.contains('vid')){ const m = sec.dataset.media || ''; return isStill(m) ? 'image' : 'video'; }
      if(id === 'title' || id === 'remote-qr') return 'title';
      return 'slide';
    }
    let chan = null;
    function publish(){
      if(!chan) return;
      try{
        const slides = Reveal.getSlides(), cur = Reveal.getCurrentSlide(), i = slides.indexOf(cur), next = slides[i + 1] || null;
        chan.send({ type:'broadcast', event:'state', payload:{
          index: i + 1, total: slides.length,
          id: cur ? cur.id : '', notes: notesOf(cur), type: typeOf(cur),
          nextId: next ? next.id : '', nextType: typeOf(next), nextTitle: next ? (next.dataset.title || next.id) : ''
        }});
      }catch(e){}
    }
    try{
      chan = supaClient.channel('deck-' + CLASS_ID, { config:{ broadcast:{ self:false } } });
      chan.on('broadcast', { event:'nav' }, ({ payload }) => {
        if(!payload) return;
        if(payload.action === 'next') smartNext();
        else if(payload.action === 'prev') Reveal.prev();
      });
      chan.on('broadcast', { event:'request' }, publish);   // phone (re)connected → send it the current state
      // Report the subscribe status. Silence is right for class — a dead remote must never interrupt a
      // lecture — but it left "waiting for the laptop deck…" with no way to tell a paused Supabase
      // project from a blocked websocket from a deck that never went live. The console line and the
      // __deckLog entry cost nothing and turn that into a one-look answer. poll/diagnose.html is the
      // fuller version when this is not enough.
      chan.subscribe(status => {
        logMedia('remote:' + status, null);
        if(status === 'SUBSCRIBED'){ console.info('presenter remote: connected on deck-' + CLASS_ID); publish(); }
        else console.warn('presenter remote: channel', status, '— phone will sit at "waiting for the laptop deck". ' +
                          'Run slide-suite/poll/diagnose.html to find out why.');
      });
      Reveal.on('slidechanged', publish);
      Reveal.on('fragmentshown', publish);
      Reveal.on('fragmenthidden', publish);
    }catch(e){ console.warn('presenter remote unavailable', e); }
  })();

})();
