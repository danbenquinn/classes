/* MAE 2501 — interactive animation engine (canvas), styled to match the rendered manim clips.
 *
 * HOUSE STYLE — this engine is a CONSUMER of the house style, a SIBLING to physanim; the two never reach
 * into each other. Everything visual comes from the house style's two surfaces: (a) `style/tokens.css`
 * (generated from `tokens.json`) read via getComputedStyle → `HOUSE.*` — colors, roles, scenery grays, the
 * mass/arrow geometry, motion/blur, and the initial-velocity cue (`--vel-scale` / `--cue-dash`); and (b)
 * `style/OBJECTS.md`, the object catalog (exact anatomy/color/geometry per drawable object). Match those —
 * do NOT open physanim to reproduce a look. If a value you need isn't a token / `HOUSE.*` getter yet, ADD it
 * (token in tokens.json → build_css.py → tokens.css → a `cvar`/`cnum` getter here) rather than hardcoding;
 * that missing wiring is exactly what made the first Class F spring coil green.
 *
 * DRAWING A NEW SIM OBJECT (spring, floor, wall, ramp, block, coil…): READ `style/OBJECTS.md` FIRST. Two
 * rules that are easy to get wrong (and were, once): (1) structural grays are `scenery`, exposed as
 * HOUSE.surface/support/boundary/guide/ground — walls, floors, ramps AND the drawn spring COIL are
 * `HOUSE.boundary` gray, the earth fill is `HOUSE.ground`; NEVER use a role color (spring-green is the
 * restoring-FORCE arrow, not the coil). (2) every arrow goes through the shared renderers — a force through
 * `SimBase._arrow`, the draggable initial-velocity cue through `SimBase._velCueArrow` (token head + soft
 * outline + the `--cue-dash` dashed shaft) — never hand-size an arrowhead or hand-roll a dash. Also: every
 * preset ships a 🐢 slow-mo toggle by default (Daniel's standing request); omit it only on explicit request.
 *
 * A sim slide is just `<section class="stage sim" data-sim="projectile" [data-v0 data-mass data-g
 * data-y0 data-slomo data-focus]>` — mount() builds the canvas + controls and reads those presets.
 * The house `-|>` arrow (origin dot, thin round shaft, soft head) matches OBJECTS.md's Force/Velocity arrow.
 */
(function () {
  // Colors come from the deck's linked house-style/tokens.css (getComputedStyle → var(--x)), so the canvas
  // sims read the SAME source as the deck CSS and the rendered clips. Fallbacks mirror the tokens for a deck
  // that hasn't linked tokens.css yet — but tokens.json is the source of truth, not these strings.
  const _cvar = {};
  const cvar = (name, fallback) => {
    if (_cvar[name]) return _cvar[name];
    let v = "";
    try { v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } catch (e) {}
    if (v) return (_cvar[name] = v);     // cache once we have a real value
    return fallback;                     // not cached — retry (in case tokens.css loads later)
  };
  // numeric tokens (geometry/motion) — same source, parsed to Number
  const cnum = (name, fallback) => { const n = parseFloat(cvar(name, "")); return isNaN(n) ? fallback : n; };
  // a token color ("#rrggbb") at a given alpha → "rgba(...)", so translucent fills still derive from tokens
  const withAlpha = (hex, a) => {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec((hex || "").trim());
    if (!m) return hex;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  };

  const HOUSE = {
    get bg()       { return cvar("--bg",       "#000000"); },
    // D3: one universal label font (Inter) — read from the type tokens; fallbacks mirror tokens.json.
    get fontSans() { return cvar("--font-sans", "Inter, sans-serif"); },
    get fontMono() { return cvar("--font-mono", "ui-monospace, monospace"); },
    get ink()      { return cvar("--ink",   "#f2f2ef"); },   // primary UI / HUD text (token)
    get muted()    { return cvar("--muted", "#9aa0a6"); },   // secondary UI / HUD text (token)
    get mass()     { return cvar("--mass",     "#f0f0f5"); },
    get velocity() { return cvar("--velocity", "#5e81b5"); },
    // Gravity defaults to the token red (--gravity). D4: #da6e4c is a desaturated canvas opt-in — if the
    // crisp fill ever reads too red next to antialiased video, override the fallback/var to "#da6e4c".
    get gravity()  { return cvar("--gravity",  "#eb6235"); },
    get normal()   { return cvar("--normal",   "#8778b3"); },   // purple (was brown #c56e1a); D1
    get spring()   { return cvar("--spring",   "#8fb032"); },   // spring / restoring (also the "on-target" green)
    get applied()  { return cvar("--applied",  "#5d9ec7"); },   // applied push/pull — light-blue; D1
    get friction() { return cvar("--friction", "#e19c24"); },   // friction / drag — amber
    get mmaRed()   { return cvar("--mma-red",  "#eb6235"); },   // palette red — incidental game accent (e.g. game obstacles); NOT the gravity role
    // Structural grays (scenery, keyed by FUNCTION — tokens.json 'scenery'). Walls, floors, ramps AND the
    // drawn spring coil are all `boundary`; `ground` is the solid earth fill below a surface line. A sim that
    // draws any structural object MUST use these (see style/OBJECTS.md) — never a role color like spring green.
    get surface()  { return cvar("--surface",  "#c8c8d0"); },   // rail/track/wire the mass moves along
    get support()  { return cvar("--support",  "#4a4a52"); },   // posts, frames
    get boundary() { return cvar("--boundary", "#9090a0"); },   // walls / floors / ramps (hatched) + drawn spring coil
    get guide()    { return cvar("--guide",    "#5a5a68"); },
    get ground()   { return cvar("--ground",   "#3a3a40"); },   // solid earth fill below a surface line
    get trail()    { return cvar("--trail",    "#e8e8f0"); },   // white fading trajectory (curved paths)
    // ---- shared geometry / motion (from tokens.css, so a sim is sized & paced like the baked clip) ----
    get frameW()      { return cnum("--frame-w",      14.222); },
    get frameH()      { return cnum("--frame-h",      8.0);    },
    // Style sizes are FRACTIONS OF FRAME HEIGHT (house style). × frame_h recovers the world-unit sizes the
    // sims' `× scale` drawing math expects (fraction × frame_h × scale = fraction × canvas-height px).
    get baseRadius()  { return cnum("--mass-radius",    0.0225)  * cnum("--frame-h", 8); },
    get originDot()   { return cnum("--origin-dot",     0.004375)* cnum("--frame-h", 8); },
    get arrowStroke() { return cnum("--arrow-stroke",   0.0065)  * cnum("--frame-h", 8); },
    get arrowHeadLen(){ return cnum("--arrow-head-len", 0.017)   * cnum("--frame-h", 8); },
    get arrowHeadHW() { return cnum("--arrow-head-hw",  0.0085)  * cnum("--frame-h", 8); },
    get arrowMinStemK(){ return cnum("--arrow-min-stem-k", 0.0); },   // intended min stem beyond the head, in stroke-widths (0 = base tangent to center; unitless, NOT × frame_h)
    get crosshairHalf(){ return cnum("--crosshair-half", 0.02)   * cnum("--frame-h", 8); },   // world half-length of the + marker (OBJECTS Crosshair)
    // drawn spring coil (OBJECTS 'Spring') — coils is a decorative count (may nudge with k, clamped); width/lead → world
    get springCoils()   { return cnum("--spring-coils",     14); },
    get springCoilsMin(){ return cnum("--spring-coils-min", 10); },
    get springCoilsMax(){ return cnum("--spring-coils-max", 20); },
    get springWidth()   { return cnum("--spring-width", 0.0425) * cnum("--frame-h", 8); },   // world zigzag half-amplitude
    get springLead()    { return cnum("--spring-lead",  0.035)  * cnum("--frame-h", 8); },   // world straight end-lead
    get blurFrames()  { return cnum("--blur-frames",  10);     },
    get blurDt()      { return cnum("--blur-dt-s",    1 / 30); },
    get blurAlpha0()  { return cnum("--blur-alpha0",  0.42);   },
    get blurFalloff() { return cnum("--blur-falloff", 0.80);   },
    get trailFadeS()  { return cnum("--trail-fade-s", 1.2);    },   // white curved-path trail fade (screen-seconds)
    get trailStroke() { return cnum("--trail-stroke",  0.00278) * cnum("--frame-h", 8); },  // world units; × scale → px
    get trailCap()    { return cvar("--trail-cap",    "butt");  },
    // Stacked animation+graph layout (graph.stack_* tokens). The launcher game splits its own canvas
    // the same way a baked energy-graph slide splits the frame, so live and baked read as one object.
    get stackGraphH()   { return cnum("--stack-graph-h",   0.26); },
    get stackBottomPct(){ return cnum("--stack-bottom-pct", 6);   },
    get stackGapPct()   { return cnum("--stack-gap-pct",    1.4); },   // house-fixed; "round" beads the tail (tokens.json)
    get trailAlpha0() { return cnum("--trail-alpha0",  1.0);    },   // opacity at the mass, fading to 0 at the tail
    // font sizes as a fraction of frame height — canvas text px = size × canvasHeight (viewplane-relative)
    get sizeTitle()    { return cnum("--size-title",    0.09);  },
    get sizeSubtitle() { return cnum("--size-subtitle", 0.055); },
    get sizeBody()     { return cnum("--size-body",     0.04);  },
    get sizeCaption()  { return cnum("--size-caption",  0.03);  },
    // initial-velocity CUE (the draggable idle-sim velocity handle) — house tokens (tokens.json 'interaction')
    get velWorldPerMS() { return cnum("--vel-scale", 0.2);   },   // arrow length: world units per (m/s) of v0 (a wide-frame sim may override per its own framing)
    get velCueDash()    { return cnum("--cue-dash",  0.011); },   // dashed-shaft on-length, fraction of frame height (px = frac × canvas-height)
    // ---- this engine's own constants (NOT house tokens) ----
    focusY: 2,                 // world y (m) placed at the vertical Center of the screen
    slomoFactor: 0.3,          // per-clip pacing — deliberately not a token
    fadeMs: 420, goneWaitMs: 1000
  };

  const TAU = 6.2832;   // 2π for full-circle arcs (kept as the literal these sims have always used)

  // ---- SimBase: shared canvas scaffolding + the ONE disc / arrow / tick implementations -------------
  // Every sim delegates its disc + arrow drawing here, so there is a single source for the pearl-mass
  // disc and the physanim-style '-|>' arrow. Coordinate systems differ (centered viewplane, ground-
  // anchored, screen-space), so sx()/sy() are overridable; the drawing cores work in whatever screen
  // coords sx/sy produce. Defaults below are the Centered viewplane (Projectile + HandLift); the other
  // sims override sx/sy/resize. discMinPx is each sim's minimum on-screen disc radius.
  class SimBase {
    constructor(canvas) {
      this.c = canvas; this.ctx = canvas.getContext("2d");
      this.discMinPx = 1.2;
    }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.scale = Math.min(w / HOUSE.frameW, h / HOUSE.frameH);
      this.ox = (w - HOUSE.frameW * this.scale) / 2;
    }
    sx(x) { return this.ox + x * this.scale; }
    sy(y) { return this.H / 2 - (y - this.focusY) * this.scale; }   // focusY at screen center
    pause()  { this.paused = true; }
    resume() { if (this.running) { this.paused = false; this.last = performance.now(); } }

    // One pearl/mass disc. Screen center via sx/sy; on-screen radius floored at discMinPx.
    _disc(x, y, r, color, alpha) {
      const ctx = this.ctx, cx = this.sx(x), cy = this.sy(y), sr = Math.max(r * this.scale, this.discMinPx);
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(cx, cy, sr, 0, TAU); ctx.fill(); ctx.restore();
    }
    // The ONE arrow renderer, in SCREEN coords: round shaft → soft filled '-|>' head → origin dot.
    // opts: { shaftW, headLen, headHW, dotR, headStroke, dash }. headStroke>0 outlines the head (the house
    // world-arrow does; the ad-hoc ones don't). dash=[on,off] dashes the SHAFT only (the initial-velocity
    // cue) — the head stays solid + soft. Mirrors physanim's ForceArrow.
    _arrowPx(oX, oY, tX, tY, color, alpha, o) {
      const ctx = this.ctx, ang = Math.atan2(tY - oY, tX - oX);
      const bx = tX - Math.cos(ang) * o.headLen, by = tY - Math.sin(ang) * o.headLen;
      const px = -Math.sin(ang), py = Math.cos(ang);
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.strokeStyle = color;
      ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.lineWidth = o.shaftW;
      if (o.dash) ctx.setLineDash(o.dash);
      ctx.beginPath(); ctx.moveTo(oX, oY); ctx.lineTo(bx, by); ctx.stroke();
      if (o.dash) ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(tX, tY); ctx.lineTo(bx + px * o.headHW, by + py * o.headHW); ctx.lineTo(bx - px * o.headHW, by - py * o.headHW);
      ctx.closePath(); ctx.fill();
      if (o.headStroke) { ctx.lineWidth = o.headStroke; ctx.stroke(); }
      ctx.beginPath(); ctx.arc(oX, oY, o.dotR, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // House world arrow: (x,y) origin + (vx,vy) world offset, sized from the geometry tokens. Default
    // for the centered sims; Projectile2D + Circular override _arrow with their own sizing.
    _arrow(x, y, vx, vy, color, alpha) {
      if (vx === 0 && vy === 0) return;
      const s = this.scale;
      const headLen = HOUSE.arrowHeadLen * s, strokeW = HOUSE.arrowStroke * s;
      const oX = this.sx(x), oY = this.sy(y);
      let tX = this.sx(x + vx), tY = this.sy(y + vy);
      // Drawn-length FLOOR — physanim's MIN_ARROW_DRAW, which never made it into this engine. The '-|>' head
      // is drawn a fixed headLen back from the tip, so when the tail→tip length is shorter than the head, the
      // head inverts and points at the origin. Clamp the length to headLen + arrowMinStemK·stroke so at tiny
      // magnitudes the head's flat BASE sits tangent to the tail (mass center), tip pointing OUTWARD — a
      // "zero-stem arrow". arrowMinStemK defaults to 0 (base exactly tangent, NO stem); the canvas head geometry
      // is exact (base = tip − headLen), so unlike physanim it needs no matplotlib head-cap compensation.
      const minLen = headLen + HOUSE.arrowMinStemK * strokeW;
      let dX = tX - oX, dY = tY - oY, L = Math.hypot(dX, dY);
      if (L < 1e-6) return;
      if (L < minLen) { const f = minLen / L; tX = oX + dX * f; tY = oY + dY * f; }
      this._arrowPx(oX, oY, tX, tY, color, alpha,
        { shaftW: strokeW, headLen: headLen, headHW: HOUSE.arrowHeadHW * s,
          dotR: HOUSE.originDot * s, headStroke: HOUSE.arrowHeadHW * s * 0.5 });
    }
    // Force arrow whose TIP is pinned to a fixed SCREEN point (equilibrium / attractor center): tail at the mass,
    // head exactly on the point, length = the distance to it. So the arrow literally shows a linear restoring force
    // F = -k·(displacement): it grows with distance from equilibrium and vanishes there. Deliberately NO min-length
    // floor (unlike _arrow — this one SHOULD shrink to nothing at equilibrium); the head shrinks to fit a short arrow
    // so it never overshoots past the tail.
    _forceToPointPx(oX, oY, tX, tY, color, alpha) {
      const s = this.scale, L = Math.hypot(tX - oX, tY - oY);
      if (L < 0.6) return;                                   // essentially at equilibrium → no force to draw
      const headLen = Math.min(HOUSE.arrowHeadLen * s, L);   // shrink the head to fit a short arrow
      const headHW  = headLen * (HOUSE.arrowHeadHW / HOUSE.arrowHeadLen);   // hold the house head aspect
      this._arrowPx(oX, oY, tX, tY, color, alpha,
        { shaftW: HOUSE.arrowStroke * s, headLen, headHW, dotR: HOUSE.originDot * s, headStroke: headHW * 0.5 });
    }
    // House INITIAL-VELOCITY CUE (idle sims): the same '-|>' arrow as a force (token head + soft outline),
    // drawn with a DASHED shaft (the `--cue-dash` token). SCREEN endpoints; role color (velocity blue).
    // `headLen` optional — pass the sim's own floored head length on a wide frame where arrow_head_len×scale
    // would collapse (e.g. Projectile2D). This is the ONE velocity-cue renderer; sims must not hand-roll it.
    _velCueArrow(oX, oY, tX, tY, color, headLen) {
      if (Math.hypot(tX - oX, tY - oY) < 2) return;
      const s = this.scale, hl = headLen || (HOUSE.arrowHeadLen * s);
      const hw = hl * (HOUSE.arrowHeadHW / HOUSE.arrowHeadLen);       // hold the house head aspect
      const shaftW = hl * (HOUSE.arrowStroke / HOUSE.arrowHeadLen);   // hold the house shaft:head ratio → a floored head (wide frame) gets a matching floored shaft, so the cue never goes sub-pixel-thin
      const dash = HOUSE.velCueDash * this.H;
      this._arrowPx(oX, oY, tX, tY, color, 1,
        { shaftW, headLen: hl, headHW: hw, dotR: Math.max(HOUSE.originDot * s, shaftW * 0.7),
          headStroke: hw * 0.5, dash: [dash, dash * 1.25] });
    }
    // House Crosshair (OBJECTS.md): a small pearl `+` at a fixed point (circle center, attractor, pivot).
    // Token half-length, pearl, 2 px. SCREEN center (cx, cy). The ONE crosshair — sims must not hand-roll it.
    _crosshairAt(cx, cy) {
      const ctx = this.ctx, ch = HOUSE.crosshairHalf * this.scale;
      ctx.save(); ctx.strokeStyle = HOUSE.mass; ctx.globalAlpha = 0.9; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(cx - ch, cy); ctx.lineTo(cx + ch, cy); ctx.moveTo(cx, cy - ch); ctx.lineTo(cx, cy + ch); ctx.stroke(); ctx.restore();
    }
    // Centered-viewplane meter ticks up the left edge (Projectile + HandLift).
    _ticks() {
      const ctx = this.ctx; ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.09)"; ctx.fillStyle = "rgba(255,255,255,0.30)";
      ctx.lineWidth = 1; ctx.font = (HOUSE.sizeCaption * this.H) + "px " + HOUSE.fontSans; ctx.textBaseline = "middle";
      for (let m = 0; m <= HOUSE.frameH; m += 2) {
        const y = this.sy(m); if (y < 6 || y > this.H - 2) continue;
        const x = this.sx(0);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + this.scale * 0.25, y); ctx.stroke();
        ctx.fillText(m + " m", x + this.scale * 0.34, y);
      }
      ctx.restore();
    }
    // Inverse of the centered sx/sy — screen event → world (x,y). Shared by Projectile + HandLift drag.
    _toWorldCentered(ev) {
      const r = this.c.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width * this.W, py = (ev.clientY - r.top) / r.height * this.H;
      return { x: (px - this.ox) / this.scale, y: this.focusY + (this.H / 2 - py) / this.scale };
    }

    // ---- ONE motion-blur + ONE white-trail, shared by every sim (matches the baked physanim model) ----
    // Velocity-blue after-images: `blurFrames` of them, alpha0·falloff^(k-1), newest (k=1) brightest.
    // `sampleBack(k)` returns the body position `k·blurDt` seconds in the past, in the coords this sim's
    // _disc expects (world for the centered/ground sims, screen for the identity ones), or null if unavailable.
    _motionBlur(radius, sampleBack) {
      for (let k = HOUSE.blurFrames; k >= 1; k--) {
        const p = sampleBack(k);
        if (p) this._disc(p.x, p.y, radius, HOUSE.velocity, HOUSE.blurAlpha0 * Math.pow(HOUSE.blurFalloff, k - 1));
      }
    }
    // Timestamped position history (for blur / white-trail on non-analytic paths). Trimmed to keepMs.
    _recordPos(x, y, nowMs, keepMs) {
      const h = (this.posHist || (this.posHist = []));
      h.push({ t: nowMs, x, y });
      const cap = keepMs != null ? keepMs : HOUSE.trailFadeS * 1000;
      while (h.length > 1 && nowMs - h[0].t > cap) h.shift();
    }
    // Body position `dtBackMs` ago, interpolated from posHist (same coords as recorded). null if empty.
    _posAtBack(dtBackMs) {
      const h = this.posHist; if (!h || !h.length) return null;
      const tk = this.now - dtBackMs;
      if (tk <= h[0].t) return { x: h[0].x, y: h[0].y };
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].t <= tk) { const a = h[i], b = h[i + 1] || a, f = (b.t === a.t) ? 0 : (tk - a.t) / (b.t - a.t);
          return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }; }
      }
      return { x: h[0].x, y: h[0].y };
    }
    // White fading trajectory (curved paths only). `pts` = [{x,y,t}] in SCREEN coords; `nowT`/`fadeS` share
    // pts' time unit. Older → fainter; one alpha profile everywhere. Draw under the blur + body.
    _whiteTrail(pts, nowT, fadeS) {
      if (!pts || pts.length < 2) return;
      const ctx = this.ctx; ctx.save();
      // Width, cap and peak opacity are house tokens (geometry.trail_stroke, motion.trail_cap,
      // motion.trail_alpha0) — the same values physanim bakes with, so a live sim and a baked
      // clip draw the same tail. Never hardcode them here again.
      const px = HOUSE.trailStroke * (this.scale || (this.canvas.height / HOUSE.frameH));
      // lineCap "butt", NOT "round". Each segment is its own path at its own alpha, so
      // round caps spill lineWidth/2 past each end and overlap the neighboring segment:
      // at alpha<1 every join double-blends into a bright bead, and wherever the mass is
      // slower than ~one stroke-width per frame the segment is shorter than its own caps
      // and renders as a full circle — beading the tail into a string of dots. Butt caps
      // abut exactly, giving the continuous line the baked renderer draws (physanim.py's
      // FadingTrail uses capstyle="butt" for exactly this reason). lineJoin is moot here:
      // one segment per path means joins never occur.
      ctx.strokeStyle = HOUSE.trail; ctx.lineCap = HOUSE.trailCap; ctx.lineWidth = px;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1], b = pts[i];
        // age off the segment MIDPOINT — smoother alpha ramp, and matches physanim
        ctx.globalAlpha = Math.max(0, 1 - (nowT - 0.5 * (a.t + b.t)) / fadeS) * HOUSE.trailAlpha0;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.restore();
    }
  }

  class Projectile extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.focusY = opts.focusY ?? HOUSE.focusY;
      this.v0 = opts.v0 ?? 0; this.g = opts.g ?? 9.8; this.mass = opts.mass ?? 1;
      this.slomo = !!opts.slomo; this.slomoFactor = opts.slomoFactor ?? HOUSE.slomoFactor;   // per-sim rate, like the others
      this.showReadout = false;
      this.running = false; this.paused = false; this.gone = false; this.goneAt = null; this.fadeStart = null;
      this.t = 0; this.last = 0; this.L = null;
      this.vMin = -8; this.vMax = 12; this.vStep = 0.5; this.onV0Change = null;  // for the velocity-arrow drag
      this.everPlayed = false;   // has this sim been Played yet? (advance-key: first → plays, later → advances)
      this.resize();
      this.x0 = opts.x0 ?? HOUSE.frameW / 2;
      this.y0 = opts.y0 ?? this.focusY;          // start centered on focusY (default 2 m) unless told otherwise
      this._bindDrag();
    }

    get radius() { return HOUSE.baseRadius * Math.cbrt(this.mass); }
    _forceLen(g) { return 1.3 * this.mass * (g / 9.8); }
    // resize / sx / sy inherited from SimBase (centered viewplane, focusY at screen center)

    pos(t) { const L = this.L; return { x: L.x0, y: L.y0 + L.v0 * t - 0.5 * L.g * t * t }; }
    vel(t) { return this.L.v0 - this.L.g * t; }

    play()   { this.L = { x0: this.x0, y0: this.y0, v0: this.v0, g: this.g };
               this.t = 0; this.gone = false; this.goneAt = null; this.fadeStart = null;
               this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }
    reset()  { this.running = false; this.paused = false; this.gone = false; this.goneAt = null; this.t = 0;
               this.fadeStart = performance.now(); this.render(); }
    // pause / resume inherited from SimBase

    _ballAlpha() {
      if (this.running || this.fadeStart == null) return 1;
      return Math.min(1, (performance.now() - this.fadeStart) / HOUSE.fadeMs);
    }

    _velTip() { return { x: this.x0, y: this.y0 + this.v0 * HOUSE.velWorldPerMS }; }
    _velShown() { return !this.running && !this.gone && Math.abs(this.v0) > 0.01; }

    _bindDrag() {
      let mode = null;
      const toWorld = (ev) => this._toWorldCentered(ev);
      const nearBall = (w) => Math.hypot(w.x - this.x0, w.y - this.y0) < Math.max(this.radius * 2, 0.6);
      const nearTip  = (w) => { const t = this._velTip(); return Math.hypot(w.x - t.x, w.y - t.y) < Math.max(this.radius * 1.6, 0.5); };
      this.c.addEventListener("pointerdown", (ev) => {
        if (this.running || this.gone) return;
        const w = toWorld(ev);
        mode = (this._velShown() && nearTip(w)) ? "vel" : (nearBall(w) ? "ball" : null);   // arrowhead wins
        if (mode) this.c.setPointerCapture?.(ev.pointerId);
      });
      this.c.addEventListener("pointermove", (ev) => {
        if (!mode) return;
        const w = toWorld(ev);
        if (mode === "vel") {                                    // vertical-only for now (2D-ready: also read w.x)
          let nv = (w.y - this.y0) / HOUSE.velWorldPerMS;
          nv = Math.max(this.vMin, Math.min(this.vMax, Math.round(nv / this.vStep) * this.vStep));
          this.v0 = nv; if (this.onV0Change) this.onV0Change(nv);
        } else {
          this.x0 = Math.max(0, Math.min(HOUSE.frameW, w.x));
          this.y0 = Math.max(-2, Math.min(HOUSE.frameH, w.y));
        }
        this.render();
      });
      window.addEventListener("pointerup", () => { mode = null; });
    }

    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1);
        this.last = now; this.t += dt;
        const p = this.pos(this.t), vy = this.vel(this.t), sy = this.sy(p.y);
        const belowBottom = sy > this.H + 60, aboveTop = sy < -60;
        if ((belowBottom && vy < 0) || (this.L.g <= 0 && aboveTop && vy > 0) || this.t > 120) {
          this.running = false; this.gone = true; this.goneAt = now;
        }
      } else if (this.gone && this.goneAt != null && now - this.goneAt > HOUSE.goneWaitMs) {
        this.gone = false; this.goneAt = null; this.t = 0; this.fadeStart = now;
      }
      this.render();
    }

    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      this._ticks();
      if (this.gone) return;
      const g = this.running ? this.L.g : this.g;
      const p = this.running ? this.pos(this.t) : { x: this.x0, y: this.y0 };
      const a = this._ballAlpha();
      if (this.running) {
        this._motionBlur(this.radius, k => { const tk = this.t - k * HOUSE.blurDt; return tk < 0 ? null : this.pos(tk); });
      }
      if (this._velShown()) this._velArrow(this.x0, this.y0, this.v0);   // draggable initial-velocity cue (idle only)
      this._disc(p.x, p.y, this.radius, HOUSE.mass, a);
      if (g > 0) this._arrow(p.x, p.y, 0, -this._forceLen(g), HOUSE.gravity, a);
      if (this.showReadout) this._readout(p, g);
    }

    // _disc / _arrow inherited from SimBase (discMinPx default 1.2; house world arrow)

    // Draggable initial-velocity arrow: dotted blue, from the ball; drag its head to set v0 (vertical for now).
    _velArrow(x, y, v0) {   // house initial-velocity cue (shared dashed-shaft + soft token head)
      this._velCueArrow(this.sx(x), this.sy(y), this.sx(x), this.sy(y + v0 * HOUSE.velWorldPerMS), HOUSE.velocity);
    }
    // _ticks inherited from SimBase

    _readout(p, g) {
      const ctx = this.ctx, v = this.running ? this.vel(this.t) : this.v0;
      const lines = [`t = ${this.t.toFixed(2)} s`, `x = ${p.x.toFixed(2)} m`, `y = ${p.y.toFixed(2)} m`, `v = ${v.toFixed(2)} m/s`];
      ctx.save(); ctx.font = (HOUSE.sizeBody * this.H) + "px " + HOUSE.fontMono; ctx.textBaseline = "top";   // readout = body tier
      const pad = this.scale * 0.22; let w = 0;
      lines.forEach(l => w = Math.max(w, ctx.measureText(l).width));
      const lh = this.scale * 0.4, bx = this.W - w - pad * 2 - this.scale * 1.6, by = this.scale * 0.35;
      ctx.fillStyle = "rgba(0,0,0,0.38)"; ctx.fillRect(bx, by, w + pad * 2, lines.length * lh + pad);
      ctx.fillStyle = "#cfe6ff";
      lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.7 + i * lh));
      ctx.restore();
    }
  }

  // ---- HandLift: a hand holds a ball; one signed a_max slider drives a rest->rest "elevator" push ----
  // Smootherstep acceleration (gradual, like the C1-* clips); a_max is the PEAK acceleration. Normal force
  // F_N = m(g+a): heavier speeding up, lighter slowing down. If the palm would ever have to PULL (a < -g,
  // i.e. F_N<0) the ball RELEASES and goes ballistic. For a throw the hand follows through then returns to
  // the launch height so the ball sails well above it; for a drop (a_max < -g) the hand sweeps down and the
  // ball free-falls until the hand catches it. Play starts from wherever the hand currently rests (it "walks").
  class HandLift extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.focusY = opts.focusY ?? HOUSE.focusY;
      this.g = opts.g ?? 9.81;            // so a_max = ±9.81 gives F_N/mg = 2.00 / 0.00 exactly
      this.mass = opts.mass ?? 1;
      this.aMax = opts.aMax ?? 0;         // signed peak acceleration — the single slider
      this.tMove = opts.tMove ?? 1.1;     // duration of the push (rest -> rest), seconds
      this.tFollow = 0.28;                // throw follow-through: hand eases back to the launch height
      this.slomoFactor = 0.16;            // slo-mo rate for this sim — slower than HOUSE default (0.3)
      this.slomo = !!opts.slomo;
      this.showReadout = false;
      this.running = false; this.paused = false; this.everPlayed = false;
      this.t = 0; this.last = 0; this.now = 0; this.posHist = [];
      // Hand bitmap staging — matches physanim's Hand in the C1-* clips (HAND_WIDTH / HAND_Y_OFFSET),
      // which centers the image at (ball_x, ball_y - gap) so the ball rests in the palm.
      this.handW = 0.85;                  // hand image width in world meters
      this.handGap = 0.17;                // ball-center to hand-image-center gap (meters)
      this.resize();
      this.x0 = opts.x0 ?? HOUSE.frameW / 2;
      this.y0 = opts.y0 ?? this.focusY;   // current ball rest height (draggable; "walks" as you Play)
      this.y0init = this.y0;              // initial rest — reset() (slide-leave) returns here
      this._resetState();
      this._bindDrag();
      this.hand = HandLift._img();
      if (this.hand && !this.hand.complete) this.hand.addEventListener?.("load", () => this.render());
    }
    static _img() {
      if (!HandLift._image) { const im = new Image(); im.src = (window.DECK_CONFIG && window.DECK_CONFIG.handImage) || "../../slide-suite/engine/images/righthand_white.png"; HandLift._image = im; }
      return HandLift._image;
    }

    get radius() { return HOUSE.baseRadius * Math.cbrt(this.mass); }
    _flen(F) { return 0.65 * F / 9.8; }   // arrow length in world meters (halved for headroom); gravity -> 0.65
    // resize / sx / sy inherited from SimBase (centered viewplane)

    // Rest->rest trajectory of the ball's carried ("rest") line, following the same SMOOTHERSTEP
    // displacement S(s)=6s^5-15s^4+10s^3 as the C1-* elevator clips: zero velocity AND zero acceleration
    // at both ends, so the acceleration eases up to its peak and back rather than jumping. aMax is the
    // PEAK acceleration; rise is set so peak |accel| = |aMax| (max|S''| = 10/sqrt(3) at s≈0.211).
    _hand(t) {
      const T = this.tMove, K = 5.7735026919;      // = 10/sqrt(3) = max|S''(s)|
      const rise = this.aMax * T * T / K;          // displacement; peak accel = aMax
      if (t <= 0) return { y: this.y0, vy: 0, a: 0 };
      if (t >= T) return { y: this.y0 + rise, vy: 0, a: 0 };   // settled at y0 + rise, at rest
      const s = t / T;
      const S  = 6 * s ** 5 - 15 * s ** 4 + 10 * s ** 3;
      const S1 = 30 * s ** 4 - 60 * s ** 3 + 30 * s ** 2;
      const S2 = 120 * s ** 3 - 180 * s ** 2 + 60 * s;
      return { y: this.y0 + rise * S, vy: rise * S1 / T, a: rise * S2 / (T * T) };
    }

    // Hand position over time. Until release the hand is on its planned smootherstep. After a THROW release
    // it follows through a touch and returns to the launch height (so the ball outflies it); after a DROP it
    // stays on its planned downward sweep. This is the line the ball is caught on.
    _handTraj(t) {
      if (!this.detached) return this._hand(t);
      if (this.detachV > 0) {                                   // throw
        const tau = (t - this.detachT) / this.tFollow;
        if (tau < 1) return { y: this.detachY + this.detachV * this.tFollow * (tau - tau * tau), vy: 0, a: 0 };
        return { y: this.detachY, vy: 0, a: 0 };                // hold at launch height, waiting for the catch
      }
      return this._hand(t);                                     // drop: keep sweeping down, then hold
    }

    _resetState() {
      this.t = 0; this.now = 0; this.posHist = [];
      this.ballY = this.y0; this.ballVy = 0;
      this.attached = true; this.caught = false; this.detached = false; this.cleared = false; this.noRelease = false;
    }
    play()   { this._resetState(); this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }  // starts from the current y0
    reset()  { this.running = false; this.paused = false; this.y0 = this.y0init; this._resetState(); this.render(); }                  // back to initial rest (slide-leave)
    // pause / resume inherited from SimBase

    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1);
        this.last = now; this.t += dt; this.now = this.t * 1000;   // blur/history keyed to SIM-time (baked-consistent)
        if (this.attached && !this.caught) {                    // riding the hand's planned push
          const p = this._hand(this.t);
          this.ballY = p.y; this.ballVy = p.vy;
          if (!this.noRelease && p.a < -this.g) {               // palm would have to pull -> release
            this.attached = false; this.detached = true; this.cleared = false;
            this.detachT = this.t; this.detachY = p.y; this.detachV = p.vy;
          }
        } else if (this.attached && this.caught) {              // resting in the hand again after a catch
          this.ballY = this._handTraj(this.t).y; this.ballVy = 0;
        } else {                                                // free flight
          this.ballVy -= this.g * dt; this.ballY += this.ballVy * dt;
          const line = this._handTraj(this.t).y;
          if (this.ballY > line + 0.05) this.cleared = true;    // ball got clearly above the hand
          // Re-contact the hand only when it can actually support the ball again (its accel is no longer
          // steeper than g) OR the ball flew up and is falling back. Otherwise a genuine drop keeps
          // free-falling — the hand is still accelerating away below it, so it must not re-seat.
          const handCanHold = this._hand(this.t).a >= -this.g;
          if (this.ballY <= line && (this.cleared || handCanHold)) {
            this.ballY = line; this.ballVy = 0;
            if (this.cleared) { this.attached = true; this.caught = true; }                 // flew and came back -> caught
            else { this.attached = true; this.detached = false; this.noRelease = true; }    // brief false release -> re-seat
          }
        }
        this._recordPos(this.x0, this.ballY, this.now);         // record EVERY frame → blur shows during the push + flight
        if (this.t >= this.tMove && this.attached && Math.abs(this.ballVy) < 1e-3) { this.running = false; this.y0 = this.ballY; }  // settle + "walk"
        if (this.ballY < this.focusY - HOUSE.frameH - 1) { this.running = false; }   // safety: fell far off-screen
      }
      this.render();
    }

    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      this._ticks();
      // Running: the hand follows its trajectory (the ball may separate). Idle: the hand simply cups the
      // ball wherever it rests, so nudging the a_max slider (or a finished run) never repositions the scene.
      const handY = this.running ? this._handTraj(this.t).y : this.ballY;
      this._drawHand(this.x0, handY - this.handGap);
      this._motionBlur(this.radius, k => this._posAtBack(k * HOUSE.blurDt * 1000));   // shared house blur model
      this._disc(this.x0, this.ballY, this.radius, HOUSE.mass, 1);
      this._arrow(this.x0, this.ballY, 0, -this._flen(this.mass * this.g), HOUSE.gravity, 1);   // weight, down
      let acc, N;
      if (this.attached) { acc = (this.running && !this.caught) ? this._hand(this.t).a : 0; N = this.mass * (this.g + acc); }
      else { acc = -this.g; N = 0; }                                                            // free fall: no normal force
      if (N > 1e-4) this._arrow(this.x0, this.ballY, 0, this._flen(N), HOUSE.normal, 1);         // normal, up
      if (this.showReadout) this._readout(acc, N);
    }

    _drawHand(x, y) {
      const img = this.hand;
      if (!img || !img.complete || !img.naturalWidth) return;
      const w = this.handW * this.scale, hh = w * (img.naturalHeight / img.naturalWidth);
      this.ctx.drawImage(img, this.sx(x) - w / 2, this.sy(y) - hh / 2, w, hh);
    }

    // _disc / _arrow / _ticks inherited from SimBase
    // Numbers panel, top-right. Layout is FROZEN: each value is padded to a fixed width and the labels /
    // tails are drawn at fixed x, so variables never jump as digits or signs change. "F_N" is drawn with a
    // real subscript capital N.
    _readout(acc, N) {
      const ctx = this.ctx, s = this.scale, fs = HOUSE.sizeBody * this.H, subfs = fs * 0.72;   // readout = body tier
      const fmt = (v, dec) => ((v < 0 ? "-" : "+") + Math.abs(v).toFixed(dec)).padStart(6, " ");
      const tails = [" =" + fmt(acc, 1) + " m/s²", " =" + fmt(N, 1) + " N", "/mg =" + fmt(N / (this.mass * this.g), 2)];
      const lh = s * 0.44, boxPad = s * 0.18;
      ctx.save(); ctx.textBaseline = "top";
      ctx.font = "italic " + fs + "px " + HOUSE.fontMono; const mF = ctx.measureText("F").width;
      ctx.font = subfs + "px " + HOUSE.fontMono; const mN = ctx.measureText("N").width;   // subscript N upright (matches F_\text{N})
      const labelW = mF + mN;
      ctx.font = "italic " + fs + "px " + HOUSE.fontMono;
      let maxTail = 0; tails.forEach(t => maxTail = Math.max(maxTail, ctx.measureText(t).width));
      const boxW = labelW + maxTail + boxPad * 2, bx = this.W - boxW - s * 1.8, by = s * 0.35;   // s*1.8: sit left of the 123 button
      const lx = bx + boxPad, tx = lx + labelW, ty = by + boxPad;
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillRect(bx, by, boxW, 3 * lh + boxPad * 2);
      ctx.fillStyle = "#cfe6ff";
      ctx.font = "italic " + fs + "px " + HOUSE.fontMono;
      ctx.fillText("\u00ff", lx, ty); ctx.fillText(tails[0], tx, ty);       // ÿ = ...
      for (let i = 1; i <= 2; i++) {                                        // F_N = ... and F_N/mg = ...
        const yy = ty + i * lh;
        ctx.font = "italic " + fs + "px " + HOUSE.fontMono; ctx.fillText("F", lx, yy);
        ctx.font = subfs + "px " + HOUSE.fontMono; ctx.fillText("N", lx + mF, yy + fs * 0.34);   // upright subscript N
        ctx.font = "italic " + fs + "px " + HOUSE.fontMono; ctx.fillText(tails[i], tx, yy);
      }
      ctx.restore();
    }

    _bindDrag() {
      if (!this.c.addEventListener) return;
      let mode = null;
      const toWorld = (ev) => this._toWorldCentered(ev);
      const nearBall = (w) => Math.hypot(w.x - this.x0, w.y - this.ballY) < Math.max(this.radius * 2.4, 0.8);
      this.c.addEventListener("pointerdown", (ev) => {
        if (this.running) return; const w = toWorld(ev);
        mode = nearBall(w) ? "ball" : null; if (mode) this.c.setPointerCapture?.(ev.pointerId);
      });
      this.c.addEventListener("pointermove", (ev) => {
        if (!mode) return; const w = toWorld(ev);
        this.x0 = Math.max(0.6, Math.min(HOUSE.frameW - 0.6, w.x));
        this.y0 = Math.max(this.focusY - 3, Math.min(this.focusY + 3, w.y));
        this._resetState(); this.render();
      });
      window.addEventListener("pointerup", () => { mode = null; });
    }
  }

  const CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>ẏ</i>₀:</span> <input type="range" class="s-v0" min="-8" max="12" step="0.5"><input type="number" class="n-v0" step="0.5"><span class="u">m/s</span></label>
        <label><span class="var"><i>m</i>:</span> <input type="range" class="s-mass" min="0.5" max="5" step="0.5"><input type="number" class="n-mass" step="0.5"><span class="u">kg</span></label>
        <label><span class="var"><i>g</i>:</span> <input type="range" class="s-g" min="0" max="12" step="0.2"><input type="number" class="n-g" step="0.2"><span class="u">m/s²</span></label>
      </div>`;

  const HAND_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>ÿ</i>:</span> <input type="range" class="s-amax" min="-25" max="25" step="0.01"><input type="number" class="n-amax" step="any"><span class="u">m/s²</span></label>
      </div>`;

  // HandLift preset: one signed a_max slider, Play, Reset, slo-mo, readout. Drag the ball to reposition.
  function mountHandLift(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", HAND_CONTROLS_HTML);
    const d = section.dataset;
    const opts = {
      aMax:  d.amax  !== undefined ? +d.amax  : 0,
      g:     d.g     !== undefined ? +d.g     : 9.8,
      tMove: d.tmove !== undefined ? +d.tmove : 0.6,
      y0:    d.y0    !== undefined ? +d.y0    : undefined,
      focusY:d.focus !== undefined ? +d.focus : undefined,
      slomo: d.slomo !== "false"   // default ON; a slide opts out with data-slomo="false"
    };
    const canvas = section.querySelector(".simcanvas");
    const sim = new HandLift(canvas, opts);
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = q(".s-amax"), num = q(".n-amax");
    const clamp = v => Math.max(+rng.min, Math.min(+rng.max, v));
    rng.value = sim.aMax; num.value = sim.aMax;
    // Only commit the slider between runs — changing a_max mid-flight would warp the trajectory and can
    // make the ball miss the catch. While running, the control moves but the sim keeps its launch value.
    const apply = () => { if (!sim.running) { sim.aMax = +rng.value; sim.render(); } };
    rng.addEventListener("input", () => { num.value = rng.value; apply(); });
    num.addEventListener("input", () => { const v = parseFloat(num.value); if (isNaN(v)) return; rng.value = clamp(v); apply(); });
    num.addEventListener("change", () => { const v = parseFloat(num.value); num.value = isNaN(v) ? rng.value : clamp(v); rng.value = num.value; apply(); });
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause"); };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => {
      if (!sim.running) { sim.aMax = +rng.value; sim.play(); }
      else if (sim.paused) sim.resume(); else sim.pause();
      refreshPlay();
    });
    const slo = q(".slomo"); slo.classList.toggle("on", sim.slomo);
    slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); });
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); if (!sim.running) sim.render(); });
    if (readonly) {
      canvas.style.pointerEvents = "none";
      [playBtn, slo, rt, rng, num].forEach(el => { if (el) el.disabled = true; });
      const ctrls = q(".simctrls"); if (ctrls) ctrls.style.opacity = ".4";
    }
    let raf = null, prevRunning = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => {
      sim.step(now);
      if (sim.running !== prevRunning) { prevRunning = sim.running; refreshPlay(); }
      raf = requestAnimationFrame(loop);
    }; raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // DeflectGame (data-sim="deflect") — Class E's impulse target game.
  // A mass drifts in top-left at constant speed (no gravity). Two horizontal "infinite-mass bat"
  // paddles slide vertically; dragging one INTO the ball reflects its vertical velocity off a MOVING
  // wall (v_y → 2u − v_y) over a short but finite contact τ, so the force graph shows a real pulse
  // (area = Δp), not a delta spike. A wall in the middle blocks the straight shot: you must knock the
  // ball DOWN under the wall with paddle 1, then UP onto the target with paddle 2. A live impulse/
  // momentum graph (impulsegraph.py style — blue momentum line over a purple force trace with the
  // impulse area shaded) draws underneath.
  // ============================================================================================
  class DeflectGame extends SimBase {
    constructor(canvas) {
      super(canvas);
      this.discMinPx = 1.5;                           // this sim's minimum on-screen disc radius
      this.mass = 1; this.tau = 0.05;                 // finite contact time (s)
      this.vx = 3.0;                                  // ball's horizontal drift speed — the "u" slider (difficulty)
      this.bx0 = 0.8;                                 // ball's start x (world) — the graph's t=0 origin
      this.paddleGain = 0.55;                         // <1 softens the imparted momentum (gentle hits easy) but firm enough to avoid tunneling; pedagogy needs only "impulse changes p"
      this.everPlayed = false; this.running = false; this.paused = false; this.last = 0;
      this.paddles = null;
      this.resize();
      this.reset();
      this._bindDrag();
    }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.gy = h * 0.66; this.gh = h * 0.26; this.gx = w * 0.03; this.gw = w * 0.94;   // wide graph panel along the bottom
      this.playH = this.gy;                           // play area fills the space above the graph, content centered in it
      this.worldW = HOUSE.frameW; this.scale = w / this.worldW; this.worldH = this.playH / this.scale;
      this._geometry();
    }
    _geometry() {
      const wW = this.worldW, wH = this.worldH, cy = wH / 2;
      this.ballR = HOUSE.baseRadius; this.entryY = cy;                 // vx set once in the constructor (survives resize)
      this.obst = { x0: wW * 0.40, x1: wW * 0.60, yc: cy, h: 0.35 };   // red bar, dead center
      this.target = { x: wW * 0.90, y: cy, r: 0.26 };                  // green target, right-center (smaller = harder)
      const pw = 1.9;
      if (!this.paddles) this.paddles = [ { x: 0, w: pw, y: cy, ly: cy, pY: cy, u: 0, hist: [] }, { x: 0, w: pw, y: cy, ly: cy, pY: cy, u: 0, hist: [] } ];
      this.paddles[0].x = wW * 0.26; this.paddles[1].x = wW * 0.72;
    }
    sx(x) { return x * this.scale; }
    sy(y) { return this.playH - y * this.scale; }     // world-y up; play-area floor at y=0

    reset() {
      this.running = false; this.paused = false; this.t = 0; this.phase = "idle";
      this.bx = this.bx0; this.by = this.entryY; this.vy = 0;
      this.contact = null; this.hist = []; this.posHist = []; this.now = 0; this.maxF = 1; this.maxP = 1; this.result = "";
      if (this.paddles) this.paddles.forEach(p => { p.y = this.worldH * 0.5; p.ly = p.y; p.pY = p.y; p.u = 0; p.hist = []; });
      this.render();
    }
    play() { this.reset(); this.running = true; this.paused = false; this.everPlayed = true; this.phase = "ready"; this.t = 0; this.last = performance.now(); }
    // pause / resume inherited from SimBase

    _bindDrag() {
      if (!this.c.addEventListener) return;
      let grab = null;
      const toWorld = (ev) => { const r = this.c.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width * this.W, py = (ev.clientY - r.top) / r.height * this.H;
        return { x: px / this.scale, y: (this.playH - py) / this.scale }; };
      this.c.addEventListener("pointerdown", (ev) => {
        const w = toWorld(ev); grab = null;
        this.paddles.forEach((p, i) => { if (Math.abs(w.x - p.x) < p.w / 2 + 0.5 && Math.abs(w.y - p.y) < 0.9) grab = i; });
        if (grab != null) this.c.setPointerCapture?.(ev.pointerId);
      });
      this.c.addEventListener("pointermove", (ev) => {
        if (grab == null) return; const w = toWorld(ev);
        this.paddles[grab].y = Math.max(0.5, Math.min(this.worldH - 0.3, w.y)); this.render();
      });
      window.addEventListener("pointerup", () => { grab = null; });
    }

    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.05)); this.last = now; this.t += dt;
        this.paddles.forEach(p => {                                   // paddle speed = drag displacement over a ~50 ms window → smooth continuum, decays to 0 when you stop
          p.hist.push({ t: now, y: p.y });
          while (p.hist.length > 2 && now - p.hist[0].t > 50) p.hist.shift();
          const o = p.hist[0], dtw = (now - o.t) / 1000;
          p.u = dtw > 0.008 ? (p.y - o.y) / dtw : 0; p.ly = p.y;
        });
        if (this.phase === "ready" && this.t > 0.6) this.phase = "set";
        if (this.phase === "set" && this.t > 1.2) this.phase = "go";
        if (this.phase === "go" && this.t > 1.6) { this.phase = "run"; this.t = 0; }
        if (this.phase === "run") this._advance(dt);
        this.paddles.forEach(p => { p.pY = p.y; });                   // remember this frame's bar y for next-frame sweep test
      }
      this.render();
    }
    _advance(dt) {
      if (this.contact) {                              // ride the finite-τ contact: ramp v_y, constant force
        const c = this.contact; c.el += dt;
        const frac = Math.min(1, c.el / this.tau);
        this.vy = c.v0 + (c.v1 - c.v0) * frac; c.F = (c.v1 - c.v0) * this.mass / this.tau;
        if (c.el >= this.tau) { this.vy = c.v1; this.contact = null; }
      }
      const prevBy = this.by;
      this.bx += this.vx * dt; this.by += this.vy * dt;
      if (!this.contact) {                             // paddle collision → start a contact event
        for (const p of this.paddles) {
          if (Math.abs(this.bx - p.x) >= p.w / 2) continue;                         // not over the bar
          const near = Math.abs(this.by - p.y) < this.ballR + 0.05;                 // ball overlapping the bar now
          const ballCrossed = (prevBy - p.y) * (this.by - p.y) < 0;                 // ball moved across the bar this frame
          const paddleSwept = (this.by - p.pY) * (this.by - p.y) < 0;               // bar swept across the ball this frame (fast drag) → no tunneling
          if (near || ballCrossed || paddleSwept) {
            const u = p.u, vin = this.vy, vout = 2 * this.paddleGain * u - vin;
            if (Math.abs(vout - vin) > 0.05) {
              this.contact = { v0: vin, v1: vout, el: 0, F: 0 };
              this.by = p.y + Math.sign(vout || 1) * (this.ballR + 0.12);
            }
          }
        }
      }
      this.now = this.t * 1000;                                                // sim-time ms → blur/trail history
      this._recordPos(this.bx, this.by, this.now);                             // one history for both blur + white trail
      const p_y = this.mass * this.vy, F = this.contact ? this.contact.F : 0;
      this.hist.push({ x: this.bx, F, p: p_y });
      this.maxP = Math.max(this.maxP, Math.abs(p_y)); this.maxF = Math.max(this.maxF, Math.abs(F));
      if (this.hist.length > 6000) this.hist.shift();
      if (this.bx > this.obst.x0 - this.ballR && this.bx < this.obst.x1 + this.ballR && Math.abs(this.by - this.obst.yc) < this.obst.h + this.ballR) return this._end(false);
      if (Math.abs(this.bx - this.target.x) < this.target.r + this.ballR && Math.abs(this.by - this.target.y) < this.target.r + this.ballR) return this._end(true);
      if (this.bx <= 0.06 || this.bx >= this.worldW - 0.06 || this.by <= 0.06 || this.by >= this.worldH - 0.06) return this._end(false);   // touched the red border
    }
    _end(win) { this.running = false; this.phase = win ? "won" : "lost"; this.result = win ? "Nice one!" : "Try again?"; }
    // _disc inherited from SimBase (discMinPx 1.5); resize / sx / sy overridden below (floor-anchored)
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      // red play-area border (touch it and you lose)
      ctx.save(); ctx.strokeStyle = HOUSE.gravity; ctx.lineWidth = Math.max(4, this.scale * 0.11);
      const bw = ctx.lineWidth / 2; ctx.strokeRect(bw, bw, this.W - ctx.lineWidth, this.playH - ctx.lineWidth); ctx.restore();
      // obstacle — red bar, dead center
      ctx.save(); ctx.fillStyle = HOUSE.gravity;
      ctx.fillRect(this.sx(this.obst.x0), this.sy(this.obst.yc + this.obst.h), (this.obst.x1 - this.obst.x0) * this.scale, this.obst.h * 2 * this.scale);
      ctx.restore();
      // target — green square, right-center
      const ts = this.target.r * 2 * this.scale;
      ctx.save(); ctx.fillStyle = HOUSE.spring; ctx.strokeStyle = "#c3dd7a"; ctx.lineWidth = 2;
      ctx.fillRect(this.sx(this.target.x) - ts / 2, this.sy(this.target.y) - ts / 2, ts, ts);
      ctx.strokeRect(this.sx(this.target.x) - ts / 2, this.sy(this.target.y) - ts / 2, ts, ts); ctx.restore();
      // paddles
      ctx.save(); ctx.fillStyle = "#cbd0d8";
      this.paddles.forEach(p => { const pw = p.w * this.scale, ph = Math.max(this.scale * 0.14, 5);
        ctx.fillRect(this.sx(p.x) - pw / 2, this.sy(p.y) - ph / 2, pw, ph); }); ctx.restore();
      // white fading trajectory (curved path, under the blur + ball) — posHist is world coords → map to screen
      if (this.posHist) {
        this._whiteTrail(this.posHist.map(p => ({ x: this.sx(p.x), y: this.sy(p.y), t: p.t })),
                         this.now, HOUSE.trailFadeS * 1000);
      }
      // ball + motion-blur (shared house model, sampled from the same history)
      this._motionBlur(this.ballR, k => this._posAtBack(k * HOUSE.blurDt * 1000));
      this._disc(this.bx, this.by, this.ballR, HOUSE.mass, 1);
      // all game text at one spot — top center
      const ty = this.playH * 0.13;
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      if (this.phase === "ready" || this.phase === "set" || this.phase === "go") {
        ctx.fillStyle = "#eef"; ctx.font = "700 " + (HOUSE.sizeSubtitle * this.H) + "px " + HOUSE.fontSans;
        ctx.fillText(this.phase === "ready" ? "Ready" : this.phase === "set" ? "Set" : "Go!", this.W / 2, ty);
      } else if (this.phase === "won" || this.phase === "lost") {
        ctx.fillStyle = this.phase === "won" ? HOUSE.spring : "#e6b0a0"; ctx.font = "700 " + (HOUSE.sizeSubtitle * this.H) + "px " + HOUSE.fontSans;
        ctx.fillText(this.result, this.W / 2, ty);
      }
      ctx.restore();
      this._drawGraph();
    }
    _drawGraph() {
      const ctx = this.ctx, gy = this.gy, gh = this.gh;
      // Graph x maps to the ball's x: origin at the ball's start, right end at the target — so the curve fills
      // left→right directly beneath the ball at its own horizontal speed and never rescales / maxes out.
      const xStart = this.sx(this.bx0), xEnd = this.sx(this.target.x);
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.025)"; ctx.fillRect(xStart, gy, xEnd - xStart, gh);
      const pC = gy + gh * 0.32, fC = gy + gh * 0.80, amp = gh * 0.20, L = this.scale * 0.66;
      const X = wx => Math.max(xStart, Math.min(xEnd, this.sx(wx)));
      const pS = amp / (this.maxP * 1.15), fS = amp / (this.maxF * 1.15);
      ctx.strokeStyle = "#3A3A44"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(xStart, pC); ctx.lineTo(xEnd, pC); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(xStart, fC); ctx.lineTo(xEnd, fC); ctx.stroke();
      this._graphAxis(xStart, pC, L, "mv");    // momentum glyph — corner at the ball's start x, on p=0
      this._graphAxis(xStart, fC, L, "F_y");   // force glyph — corner at the ball's start x, on F=0
      if (this.hist.length > 1) {
        ctx.fillStyle = withAlpha(HOUSE.normal, 0.32); ctx.beginPath(); ctx.moveTo(X(this.hist[0].x), fC);
        for (const h of this.hist) ctx.lineTo(X(h.x), fC - h.F * fS);
        ctx.lineTo(X(this.hist[this.hist.length - 1].x), fC); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = HOUSE.normal; ctx.lineWidth = 2; ctx.beginPath();
        this.hist.forEach((h, i) => { const x = X(h.x), y = fC - h.F * fS; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
        ctx.strokeStyle = HOUSE.velocity; ctx.lineWidth = 2.4; ctx.lineJoin = "round"; ctx.beginPath();
        this.hist.forEach((h, i) => { const x = X(h.x), y = pC - h.p * pS; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
      }
      ctx.restore();
    }
    _graphAxis(ox, oy, L, vlabel) {                     // small coordinate glyph: momentum axis up, time axis right
      const ctx = this.ctx; ctx.save();
      ctx.strokeStyle = "#cfd3da"; ctx.fillStyle = "#cfd3da"; ctx.lineWidth = 2; ctx.lineCap = "round";
      const oy2 = oy;                                   // corner sits ON the zero line (no offset)
      ctx.beginPath(); ctx.moveTo(ox, oy2); ctx.lineTo(ox, oy2 - L); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox, oy2 - L); ctx.lineTo(ox - L * 0.11, oy2 - L + L * 0.16); ctx.lineTo(ox + L * 0.11, oy2 - L + L * 0.16); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(ox, oy2); ctx.lineTo(ox + L, oy2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox + L, oy2); ctx.lineTo(ox + L - L * 0.16, oy2 - L * 0.11); ctx.lineTo(ox + L - L * 0.16, oy2 + L * 0.11); ctx.closePath(); ctx.fill();
      const fs = L * 0.46; ctx.font = "italic " + fs + "px " + HOUSE.fontMono; ctx.textAlign = "left"; ctx.textBaseline = "alphabetic";
      const lx = ox + L * 0.20, ly = oy2 - L * 0.56;   // sit the label mid-arrow, clear of the play-area border above
      if (vlabel.indexOf("_") >= 0) { const p = vlabel.split("_");   // e.g. F_y → base + subscript
        ctx.fillText(p[0], lx, ly); const bw = ctx.measureText(p[0]).width;
        ctx.font = "italic " + (fs * 0.66) + "px " + HOUSE.fontMono; ctx.fillText(p[1], lx + bw, ly + fs * 0.22);
        ctx.font = "italic " + fs + "px " + HOUSE.fontMono;
      } else ctx.fillText(vlabel, lx, ly);
      ctx.fillText("t", ox + L * 0.86, oy2 + L * 0.44);
      ctx.restore();
    }
  }

  const DEFLECT_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <label><span class="var">|<i>ṙ</i>|:</span> <input type="range" class="s-u" min="2" max="5" step="0.5"><input type="number" class="n-u" step="0.5"><span class="u">m/s</span></label>
      </div>`;
  function mountDeflect(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", DEFLECT_CONTROLS_HTML);
    const canvas = section.querySelector(".simcanvas");
    const sim = new DeflectGame(canvas);
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const playBtn = q(".play");
    // u slider: the ball's horizontal drift speed — slower is easier, faster is harder (3 = middle).
    const su = q(".s-u"), nu = q(".n-u"), clampU = v => Math.max(+su.min, Math.min(+su.max, v));
    su.value = sim.vx; nu.value = sim.vx;
    const applyU = () => { sim.vx = +su.value; };
    su.addEventListener("input", () => { nu.value = su.value; applyU(); });
    nu.addEventListener("input", () => { const v = parseFloat(nu.value); if (isNaN(v)) return; su.value = clampU(v); applyU(); });
    nu.addEventListener("change", () => { const v = parseFloat(nu.value); nu.value = isNaN(v) ? su.value : clampU(v); su.value = nu.value; applyU(); });
    // Play only. It disables while the round is live; when the round ends it re-enables as "Play again".
    const refreshPlay = () => {
      if (sim.running) { playBtn.disabled = true; playBtn.textContent = "Playing…"; }
      else { playBtn.disabled = readonly; playBtn.textContent = sim.everPlayed ? "↻ Play again" : "▶ Play"; }
    };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { if (!sim.running) { sim.play(); refreshPlay(); } });
    if (readonly) { canvas.style.pointerEvents = "none"; playBtn.disabled = true; [su, nu].forEach(e => { if (e) e.disabled = true; }); const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
    let raf = null, prev = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => { sim.step(now); if (sim.running !== prev) { prev = sim.running; refreshPlay(); } raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // Circular (data-sim="circle") — constant-speed circular motion, centripetal force, and a rotating
  // momentum inset. Speed (hence |p|) is constant, but v's DIRECTION turns, so p changes → there must
  // be a force. The inset's momentum vector holds its length and sweeps a full circle once per orbit
  // (T = 2πr/v); the swept circumference 2π|p| over T gives |F| = pv/r = mv²/r. Sliders: v and r; the
  // readout shows the centripetal force only.
  // ============================================================================================
  class Circular extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.discMinPx = 1.5;                                        // this sim draws in screen coords (identity sx/sy)
      this.mass = 1; this.v = opts.v ?? 4; this.a = opts.a ?? 3;   // a = radius (constant); r stays the position vector
      this.theta = 0; this.everPlayed = false; this.running = false; this.paused = false;
      this.released = false; this.frozenTheta = 0; this.freeX = 0; this.freeY = 0; this.freeVX = 0; this.freeVY = 0;
      this.posHist = []; this.now = 0;                // true recent positions → motion-blur reflects the real path
      this.showReadout = true; this.last = 0;
      this.resize();
    }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.scale = Math.min(w / HOUSE.frameW, h / HOUSE.frameH);
      this.orbScale = (h * 0.32) / 3;                  // px/meter for the orbit (max a = 3)
      this.ccx = w * 0.31; this.ccy = h * 0.47;         // circle on the LEFT
      this.insX = w * 0.80; this.insY = h * 0.47;       // momentum inset on the RIGHT (padding between the two)
      this.render();
    }
    sx(x) { return x; }  sy(y) { return y; }   // this sim computes screen coords directly → identity for the shared _disc
    get Fc() { return this.mass * this.v * this.v / this.a; }   // centripetal force, m=1
    _ballScreen() { return { x: this.ccx + this.a * this.orbScale * Math.cos(this.theta), y: this.ccy - this.a * this.orbScale * Math.sin(this.theta) }; }
    play() { this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }
    reset() { this.running = false; this.paused = false; this.released = false; this.theta = 0; this.posHist = []; this.render(); }
    // pause / resume inherited from SimBase
    // "Zero Force": the centripetal force vanishes → the ball leaves the circle on a straight tangent at
    // constant velocity (Newton's 1st law), momentum frozen, F = 0, flying off-screen until Reset.
    zeroForce() {
      if (this.released) return;
      const b = this._ballScreen(), spd = this.v * this.orbScale;
      this.freeX = b.x; this.freeY = b.y;
      this.freeVX = -Math.sin(this.theta) * spd; this.freeVY = -Math.cos(this.theta) * spd;   // screen tangent
      this.frozenTheta = this.theta; this.released = true;
      this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now();
    }
    step(now) {
      this.now = now;
      if (this.running && !this.paused) {
        const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.05)); this.last = now;
        if (this.released) {
          this.freeX += this.freeVX * dt; this.freeY += this.freeVY * dt;
          if (this.freeX < -300 || this.freeX > this.W + 300 || this.freeY < -300 || this.freeY > this.H + 300) this.running = false;  // gone; stays off until Reset
        } else {
          this.theta += (this.v / this.a) * dt;        // ω = v/a, CCW
        }
        const bp = this.released ? { x: this.freeX, y: this.freeY } : this._ballScreen();
        this._recordPos(bp.x, bp.y, now);        // record the true path (circle, then straight after release)
      }
      this.render();
    }
    // _posAtBack / _recordPos inherited from SimBase.
    // _disc inherited from SimBase (screen coords via identity sx/sy, discMinPx 1.5).
    // _arrow takes SCREEN endpoints (+ wScale) and its head is 1.4× the token size — thin wrapper on _arrowPx.
    _arrow(oX, oY, tX, tY, color, wScale) {
      const s = this.scale * (wScale || 1);
      this._arrowPx(oX, oY, tX, tY, color, 1,
        { shaftW: HOUSE.arrowStroke * s, headLen: HOUSE.arrowHeadLen * s * 1.4, headHW: HOUSE.arrowHeadHW * s * 1.4,
          dotR: HOUSE.originDot * s, headStroke: 0 });
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      const R = this.a * this.orbScale;
      // orbit path — dashed velocity-blue (house style: an optional predicted/reference trajectory)
      ctx.save(); ctx.strokeStyle = HOUSE.velocity; ctx.globalAlpha = 0.32; ctx.lineWidth = 1.5; ctx.setLineDash([9, 8]);
      ctx.beginPath(); ctx.arc(this.ccx, this.ccy, R, 0, TAU); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      ctx.restore();
      this._crosshairAt(this.ccx, this.ccy);   // house Crosshair (token half-length, pearl) — shared with Attractor2D
      const b = this.released ? { x: this.freeX, y: this.freeY } : this._ballScreen();
      // white fading trajectory (curved path), under the blur + ball — posHist is already screen coords
      this._whiteTrail(this.posHist, this.now, HOUSE.trailFadeS * 1000);
      // motion-blur from the TRUE recorded path (circular, then straight after release — no phantom shift)
      this._motionBlur(HOUSE.baseRadius, k => this._posAtBack(k * HOUSE.blurDt * 1000));
      this._disc(b.x, b.y, HOUSE.baseRadius, HOUSE.mass, 1);
      // centripetal force arrow — only while the force is on (hidden after Zero Force)
      if (!this.released) {
        const lenM = Math.max(0.3, Math.min(4.0, 0.16 * this.Fc));
        const inx = (this.ccx - b.x), iny = (this.ccy - b.y), inL = Math.hypot(inx, iny) || 1;
        this._arrow(b.x, b.y, b.x + inx / inL * lenM * this.orbScale, b.y + iny / inL * lenM * this.orbScale, HOUSE.spring, 1);
      }
      this._momentumInset();
      if (this.showReadout) this._readout();
    }
    _mrdotLabel(x, y, size) {                          // draws "m ṙ": scalar m, then r with an overdot, r underlined (a vector)
      const ctx = this.ctx; ctx.save();
      ctx.fillStyle = HOUSE.velocity; ctx.font = "italic " + size + "px " + HOUSE.fontMono; ctx.textBaseline = "alphabetic"; ctx.textAlign = "left";   // blue, to match the momentum arrow
      const mW = ctx.measureText("m").width, gap = size * 0.12;
      ctx.fillText("m", x, y);
      const rx = x + mW + gap; ctx.fillText("r", rx, y);
      const rW = ctx.measureText("r").width;
      ctx.beginPath(); ctx.arc(rx + rW * 0.5, y - size * 0.82, size * 0.06, 0, TAU); ctx.fill();   // overdot
      ctx.fillRect(rx, y + size * 0.10, rW, Math.max(1, size * 0.05));                                 // underline (vector)
      ctx.restore();
    }
    _momentumInset() {
      const ctx = this.ctx, s = this.scale, ox = this.insX, oy = this.insY;
      const pScale = (s * 1.5) / 6, pLen = this.v * pScale;     // |m ṙ| = v (m=1); v ≤ 6 → arrow ≤ 1.5 frame-units
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.28)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(ox - s * 1.7, oy); ctx.lineTo(ox + s * 1.7, oy);
      ctx.moveTo(ox, oy + s * 1.7); ctx.lineTo(ox, oy - s * 1.7); ctx.stroke();
      ctx.strokeStyle = withAlpha(HOUSE.velocity, 0.35); ctx.setLineDash([s * 0.08, s * 0.1]);
      ctx.beginPath(); ctx.arc(ox, oy, pLen, 0, TAU); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      this._mrdotLabel(ox + s * 0.35, oy - s * 1.35, HOUSE.sizeBody * this.H);   // label the inset (body tier)
      // momentum vector: velocity direction (tangent) = (−sinθ, −cosθ); frozen at release when force is zeroed
      const th = this.released ? this.frozenTheta : this.theta;
      this._arrow(ox, oy, ox - Math.sin(th) * pLen, oy - Math.cos(th) * pLen, HOUSE.velocity, 1);
    }
    _readout() {
      const ctx = this.ctx, s = this.scale, fs = HOUSE.sizeBody * this.H;   // readout = body tier
      const txt = "F = " + (this.released ? "0.0" : this.Fc.toFixed(1)) + " N";
      ctx.save(); ctx.font = fs + "px " + HOUSE.fontMono; ctx.textBaseline = "top"; ctx.textAlign = "left";
      const pad = s * 0.22, wt = ctx.measureText(txt).width, boxW = wt + pad * 2;
      const bx = this.ccx - boxW / 2, by = this.H * 0.05;      // centered just above the circle (clears its top even at a = max)
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillRect(bx, by, boxW, fs + pad * 1.4);
      ctx.fillStyle = HOUSE.spring; ctx.fillText(txt, bx + pad, by + pad * 0.6); ctx.restore();   // green, to match the force arrow
    }
  }

  const CIRCLE_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn zerof">Zero Force</button>
        <button class="simbtn reset">↺ Reset</button>
        <label><span class="var">|<i>ṙ</i>|:</span> <input type="range" class="s-v" min="1" max="6" step="0.5"><input type="number" class="n-v" step="0.5"><span class="u">m/s</span></label>
        <label><span class="var"><i>ℓ</i>:</span> <input type="range" class="s-a" min="1.5" max="3" step="0.1"><input type="number" class="n-a" step="0.1"><span class="u">m</span></label>
      </div>`;
  function mountCircle(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", CIRCLE_CONTROLS_HTML);
    const d = section.dataset;
    const canvas = section.querySelector(".simcanvas");
    const sim = new Circular(canvas, { v: d.v !== undefined ? +d.v : 4, a: d.a !== undefined ? +d.a : 3 });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = { v: q(".s-v"), a: q(".s-a") }, num = { v: q(".n-v"), a: q(".n-a") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    const apply = () => { sim.v = +rng.v.value; sim.a = +rng.a.value; sim.render(); };
    rng.v.value = sim.v; rng.a.value = sim.a;
    Object.keys(rng).forEach(k => { const s = rng[k], n = num[k]; n.value = s.value;
      s.addEventListener("input", () => { n.value = s.value; apply(); });
      n.addEventListener("input", () => { const v = parseFloat(n.value); if (isNaN(v)) return; s.value = clamp(s, v); apply(); });
      n.addEventListener("change", () => { const v = parseFloat(n.value); n.value = isNaN(v) ? s.value : clamp(s, v); s.value = n.value; apply(); });
    });
    const playBtn = q(".play"), zf = q(".zerof");
    const refreshPlay = () => {
      playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause");
      playBtn.disabled = readonly || sim.released;               // after Zero Force, only Reset works
      if (zf) zf.disabled = readonly || sim.released || !sim.running;   // only active once you've pressed Play (while spinning)
    };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { if (!sim.running) sim.play(); else if (sim.paused) sim.resume(); else sim.pause(); refreshPlay(); });
    if (zf) zf.addEventListener("click", () => { sim.zeroForce(); refreshPlay(); });
    q(".reset").addEventListener("click", () => { sim.reset(); refreshPlay(); });
    sim.showReadout = true;                                    // readout is permanent on this sim (no 123 toggle)
    apply();
    if (readonly) { canvas.style.pointerEvents = "none"; [playBtn, zf, q(".reset"), rng.v, rng.a, num.v, num.a].forEach(el => { if (el) el.disabled = true; }); const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
    refreshPlay();                                             // set initial button states (Zero Force starts disabled)
    let raf = null, prev = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => { sim.step(now); if (sim.running !== prev) { prev = sim.running; refreshPlay(); } raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // Projectile2D (data-sim="projectile2d") — full 2-D projectile on a wide world frame. Ball pinned at
  // <0,0>; sliders are |ṙ₀| (launch speed, capped at 40 m/s) and θ, plus g. Draggable velocity arrow sets
  // speed+angle at once; dashed-blue predicted parabola + white fading trail + blue motion-blur; runs real-time (slo-mo = 0.5). (Class D.)
  // ============================================================================================
  class Projectile2D extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.discMinPx = 2;                                       // this sim's minimum on-screen disc radius
      this.frameW = opts.frameW ?? 165; this.frameH = opts.frameH ?? this.frameW * 9 / 16;   // 40 m/s @45° range ≈163 m ≈ full width
      this.u0 = opts.u0 ?? 28.284; this.v0 = opts.v0 ?? 28.284; this.g = opts.g ?? 9.8;       // default = 40 m/s @ 45° (the baseball record)
      this.x0 = 0; this.y0 = 0;                                  // ALWAYS launch from the origin <0,0> (drag-to-position disabled)
      this.maxSpeed = opts.maxSpeed ?? 40;                       // speed cap → the max range just fills the screen, never overshoots
      this.slomo = !!opts.slomo; this.slomoFactor = opts.slomoFactor ?? 0.5;   // 0.5 = half real-time (2× slower)
      this.showReadout = false;
      this.running = false; this.paused = false; this.landed = false;
      this.t = 0; this.tLand = 0; this.last = 0; this.L = null;
      this.everPlayed = false;
      this.uMin = 0; this.uMax = 50; this.uStep = 0.5;
      this.vMin = -10; this.vMax = 50; this.vStep = 0.5;
      this.onVecChange = null;
      this.velWorldPerMS = opts.velWorldPerMS ?? 0.85;   // world-meters of the drag arrow per (m/s)
      this.resize(); this._bindDrag();
    }
    // House mass size on this sim's WIDE frame: the mass-radius token is a fraction of frame HEIGHT
    // (baseRadius = fraction × 8), so rescale it by this world's own frame height. (Was frameW*0.011,
    // ~13% under house size.)
    get radius() { return HOUSE.baseRadius * this.frameH / cnum("--frame-h", 8); }
    _forceLen(g) { return this.frameH * 0.11 * (g / 9.8); }
    _landTime(y0, v0, g) { return g > 0 ? (v0 + Math.sqrt(Math.max(0, v0 * v0 + 2 * g * y0))) / g : 999; }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth, h = this.c.clientHeight;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.padB = 140;                                       // reserve bottom space so the ground line/x-axis + the downward g-arrow clear the control bar
      const availH = Math.max(h - this.padB, 40);
      this.scale = Math.min(w / this.frameW, availH / this.frameH);
      this.ox = (w - this.frameW * this.scale) / 2;
    }
    sx(x) { return this.ox + x * this.scale; }
    sy(y) { return (this.H - this.padB) - y * this.scale; }   // world y = 0 = ground line, anchored just above the controls
    pos(t) { const L = this.L; return { x: L.x0 + L.u0 * t, y: L.y0 + L.v0 * t - 0.5 * L.g * t * t }; }
    velY(t) { return this.L.v0 - this.L.g * t; }
    play() {
      this.L = { x0: this.x0, y0: this.y0, u0: this.u0, v0: this.v0, g: this.g };
      this.tLand = this._landTime(this.y0, this.v0, this.g);
      this.t = 0; this.running = true; this.paused = false; this.landed = false;
      this.everPlayed = true; this.last = performance.now();
    }
    reset() { this.running = false; this.paused = false; this.landed = false; this.t = 0; this.render(); }
    // pause / resume inherited from SimBase
    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1);  // real-time by default; slomoFactor=0.5 when slo-mo is on
        this.last = now; this.t += dt;
        if (this.t >= this.tLand) { this.t = this.tLand; this.running = false; this.landed = true; }
      }
      this.render();
    }
    _velTip() { return { x: this.x0 + this.u0 * this.velWorldPerMS, y: this.y0 + this.v0 * this.velWorldPerMS }; }
    _velShown() { return !this.running && !this.landed && (Math.abs(this.u0) > 0.01 || Math.abs(this.v0) > 0.01); }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H); this._axes();
      const active = this.running || this.landed;
      const src = active ? this.L : { x0: this.x0, y0: this.y0, u0: this.u0, v0: this.v0, g: this.g };
      const tEnd = active ? this.tLand : this._landTime(src.y0, src.v0, src.g);
      ctx.save(); ctx.globalAlpha = 0.32; this._path(src, 0, tEnd, HOUSE.velocity, 2, [9, 8]); ctx.restore();   // dashed velocity-blue predicted parabola (house style: optional prediction)
      const tNow = active ? Math.min(this.t, this.tLand) : 0;
      if (active) this._trail(src, tNow);                                      // white fading trajectory (house style)
      if (active) this._motionBlur(this.radius, k => { const tk = tNow - k * HOUSE.blurDt; return tk < 0 ? null : this.pos(tk); });
      const p = active ? this.pos(tNow) : { x: this.x0, y: this.y0 };
      if (this._velShown()) this._velArrow(this.x0, this.y0, this.u0, this.v0);
      this._disc(p.x, p.y, this.radius, HOUSE.mass, 1);
      if (src.g > 0) this._arrow(p.x, p.y, 0, -this._forceLen(src.g), HOUSE.gravity, 1);
      if (this.showReadout) this._readout(p);
    }
    _trail(src, tNow) {                              // white fading trajectory: last trailFadeS s of the analytic path
      const fade = HOUSE.trailFadeS, t0 = Math.max(0, tNow - fade);
      if (tNow - t0 < 1e-3) return;
      const N = 40, pts = [];
      for (let i = 0; i <= N; i++) {
        const t = t0 + (tNow - t0) * i / N;
        const x = src.x0 + src.u0 * t, y = src.y0 + src.v0 * t - 0.5 * src.g * t * t;
        pts.push({ x: this.sx(x), y: this.sy(y), t });
      }
      this._whiteTrail(pts, tNow, fade);             // one shared drawer; width/cap/alpha are house tokens
    }
    _path(src, t0, t1, color, width, dash) {
      const ctx = this.ctx; if (t1 <= t0) return;
      ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
      if (dash) ctx.setLineDash(dash);
      ctx.beginPath();
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const t = t0 + (t1 - t0) * i / N;
        const x = src.x0 + src.u0 * t, y = src.y0 + src.v0 * t - 0.5 * src.g * t * t;
        const X = this.sx(x), Y = this.sy(y);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y);
      }
      ctx.stroke(); ctx.restore();
    }
    // _disc inherited from SimBase (discMinPx 2). Wide frame: the head is sized to the FRAME (world-unit
    // arrow_head_len would be ~1 px here), but the shaft:head ASPECT + soft outline come from the house
    // tokens, so this arrow matches the house `-|>` everywhere else. Head length = scale·2.2 (floored 11 px).
    _headLen2D() { return Math.max(this.scale * 2.2, 11); }
    _arrow(x, y, dx, dy, color, alpha) {          // dx,dy are world-meter offsets
      const hl = this._headLen2D();
      const hw = hl * (HOUSE.arrowHeadHW / HOUSE.arrowHeadLen), shaftW = hl * (HOUSE.arrowStroke / HOUSE.arrowHeadLen);
      this._arrowPx(this.sx(x), this.sy(y), this.sx(x + dx), this.sy(y + dy), color, alpha,
        { shaftW, headLen: hl, headHW: hw, dotR: Math.max(HOUSE.originDot * this.scale, shaftW * 0.7), headStroke: hw * 0.5 });
    }
    _velArrow(x, y, u0, v0) {   // house initial-velocity cue; wide frame → same floored head as the force arrow
      this._velCueArrow(this.sx(x), this.sy(y), this.sx(x + u0 * this.velWorldPerMS), this.sy(y + v0 * this.velWorldPerMS),
        HOUSE.velocity, this._headLen2D());
    }
    _axes() {
      const ctx = this.ctx; ctx.save();
      const fs = Math.max(HOUSE.sizeCaption * this.H, 10);   // axis labels = caption tier (matches SimBase _ticks)
      ctx.font = fs + "px " + HOUSE.fontSans; ctx.textBaseline = "bottom";
      const gy = this.sy(0);
      ctx.strokeStyle = "rgba(255,255,255,0.20)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(this.sx(0), gy); ctx.lineTo(this.sx(this.frameW), gy); ctx.stroke();
      ctx.strokeStyle = "rgba(255,255,255,0.09)"; ctx.fillStyle = "rgba(255,255,255,0.32)";
      for (let x = 20; x <= this.frameW; x += 20) {
        const X = this.sx(x);
        ctx.beginPath(); ctx.moveTo(X, gy); ctx.lineTo(X, gy - this.scale * 1.4); ctx.stroke();
        ctx.fillText(x + " m", X + 3, gy - 3);
      }
      for (let yv = 20; yv <= this.frameH; yv += 20) {
        const Y = this.sy(yv);
        ctx.beginPath(); ctx.moveTo(this.sx(0), Y); ctx.lineTo(this.sx(0) + this.scale * 1.4, Y); ctx.stroke();
        ctx.fillText(yv + " m", this.sx(0) + 4, Y - 3);
      }
      ctx.restore();
    }
    _readout(p) {
      const ctx = this.ctx, active = this.running || this.landed;
      const vy = (active && this.L) ? this.velY(Math.min(this.t, this.tLand)) : this.v0;
      const ux = (active && this.L) ? this.L.u0 : this.u0;
      const lines = [`t = ${(active ? Math.min(this.t, this.tLand) : 0).toFixed(2)} s`,
                     `x = ${p.x.toFixed(1)} m`, `y = ${p.y.toFixed(1)} m`,
                     `u = ${ux.toFixed(1)} m/s`, `v = ${vy.toFixed(1)} m/s`];
      ctx.save(); ctx.font = Math.max(HOUSE.sizeBody * this.H, 12) + "px " + HOUSE.fontMono; ctx.textBaseline = "top";
      const pad = 10; let w = 0; lines.forEach(l => w = Math.max(w, ctx.measureText(l).width));
      // shift the box left enough to clear the top-right 123 button (see DESIGN.md → readout clearance)
      const lh = Math.max(this.scale * 3.4, 17), bx = this.W - w - pad * 2 - Math.max(this.scale * 1.6, 84), by = 14;
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillRect(bx, by, w + pad * 2, lines.length * lh + pad);
      ctx.fillStyle = "#cfe6ff"; lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.6 + i * lh));
      ctx.restore();
    }
    _bindDrag() {
      let mode = null;
      const toWorld = (ev) => {
        const r = this.c.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width * this.W, py = (ev.clientY - r.top) / r.height * this.H;
        return { x: (px - this.ox) / this.scale, y: ((this.H - this.padB) - py) / this.scale };
      };
      const nearTip  = (w) => { const t = this._velTip(); return Math.hypot(w.x - t.x, w.y - t.y) < Math.max(this.frameW * 0.03, this.radius * 2); };
      this.c.addEventListener("pointerdown", (ev) => {                // only the velocity arrowhead is draggable; the ball stays pinned at <0,0>
        if (this.running) return; const w = toWorld(ev);
        mode = (this._velShown() && nearTip(w)) ? "vel" : null;
        if (mode) this.c.setPointerCapture?.(ev.pointerId);
      });
      this.c.addEventListener("pointermove", (ev) => {
        if (!mode) return; const w = toWorld(ev);
        let nu = (w.x - this.x0) / this.velWorldPerMS, nv = (w.y - this.y0) / this.velWorldPerMS;
        nu = Math.max(0, nu); nv = Math.max(0, nv);                   // first quadrant only → θ in [0°, 90°]
        const sp = Math.hypot(nu, nv);
        if (sp > this.maxSpeed && sp > 0) { nu *= this.maxSpeed / sp; nv *= this.maxSpeed / sp; }   // cap |ṙ₀| at maxSpeed
        this.u0 = nu; this.v0 = nv; this.landed = false;
        if (this.onVecChange) this.onVecChange(Math.hypot(nu, nv), Math.atan2(nv, nu) * 180 / Math.PI);
        this.render();
      });
      window.addEventListener("pointerup", () => { mode = null; });
    }
  }

  const CONTROLS_2D_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var">|<i>ṙ</i>₀|:</span> <input type="range" class="s-speed" min="0" max="40" step="1"><input type="number" class="n-speed" step="1"><span class="u">m/s</span></label>
        <label><span class="var"><i>θ</i>:</span> <input type="range" class="s-theta" min="0" max="90" step="1"><input type="number" class="n-theta" step="1"><span class="u">°</span></label>
        <label><span class="var"><i>g</i>:</span> <input type="range" class="s-g" min="0" max="12" step="0.2"><input type="number" class="n-g" step="0.2"><span class="u">m/s²</span></label>
      </div>`;

  // Projectile2D preset: sliders |ṙ₀| (speed, capped at 40) and θ, plus g; draggable velocity arrow; ball pinned at <0,0>.
  function mountProjectile2D(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", CONTROLS_2D_HTML);
    const d = section.dataset;
    const opts = {
      g:  d.g  !== undefined ? +d.g  : 9.8,
      frameW: d.framew !== undefined ? +d.framew : undefined,
      slomo: d.slomo !== "false"   // default ON; a slide opts out with data-slomo="false"
    };
    const canvas = section.querySelector(".simcanvas");
    const sim = new Projectile2D(canvas, opts);
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = { speed: q(".s-speed"), theta: q(".s-theta"), g: q(".s-g") };
    const num = { speed: q(".n-speed"), theta: q(".n-theta"), g: q(".n-g") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    const setUV = () => { const s = +rng.speed.value, th = +rng.theta.value * Math.PI / 180;
                          sim.u0 = s * Math.cos(th); sim.v0 = s * Math.sin(th); };
    const apply = () => { setUV(); sim.g = +rng.g.value; if (!sim.running) { sim.landed = false; sim.render(); } };
    rng.speed.value = Math.round(Math.hypot(sim.u0, sim.v0));
    rng.theta.value = Math.round(Math.atan2(sim.v0, sim.u0) * 180 / Math.PI);
    rng.g.value = sim.g;
    sim.maxSpeed = +rng.speed.max;
    sim.onVecChange = (sp, th) => { const sr = Math.round(sp), tr = Math.round(th);   // arrow drag → speed/θ sliders
      rng.speed.value = sr; num.speed.value = sr; rng.theta.value = tr; num.theta.value = tr; };
    Object.keys(rng).forEach(k => {
      const s = rng[k], n = num[k]; n.value = s.value;
      s.addEventListener("input", () => { n.value = s.value; apply(); });
      n.addEventListener("input", () => { const v = parseFloat(n.value); if (isNaN(v)) return; s.value = clamp(s, v); apply(); });
      n.addEventListener("change", () => { const v = parseFloat(n.value); n.value = isNaN(v) ? s.value : clamp(s, v); s.value = n.value; apply(); });
    });
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause"); };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => {
      if (!sim.running) { apply(); sim.play(); } else if (sim.paused) sim.resume(); else sim.pause();
      refreshPlay();
    });
    q(".reset").addEventListener("click", () => { sim.reset(); refreshPlay(); });
    const slo = q(".slomo"); slo.classList.toggle("on", sim.slomo);
    slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); });
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); if (!sim.running) sim.render(); });
    apply();
    if (readonly) {
      canvas.style.pointerEvents = "none";
      [playBtn, q(".reset"), slo, rt, rng.speed, rng.theta, rng.g, num.speed, num.theta, num.g].forEach(el => { if (el) el.disabled = true; });
      const ctrls = q(".simctrls"); if (ctrls) ctrls.style.opacity = ".4";
    }
    let raf = null, prevRunning = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => {
      sim.step(now);
      if (sim.running !== prevRunning) { prevRunning = sim.running; refreshPlay(); }
      raf = requestAnimationFrame(loop);
    }; raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // Oscillator (data-sim="oscillator") — Class F. A mass on a vertical floor-spring with a scrolling
  // x(t) history trace to the RIGHT of the mass (the spray-paint-on-moving-paper picture). Drag the mass
  // up/down and release → free SHM at ω=√(k/m). Sliders: k and m (gravity variant: only g; k & m fixed).
  //
  // HOUSE STYLE — read style/OBJECTS.md BEFORE touching the drawing (that catalog is the contract):
  //   • the coil is the drawn Spring object → structural-gray HOUSE.boundary, NOT the green spring FORCE;
  //   • the floor is a Floor object → boundary-gray line + 45° hatch ticks on the solid (under) side + a
  //     HOUSE.ground earth fill below;
  //   • the gravity arrow is the shared house `-|>` arrow via SimBase._arrow (token head geometry + soft
  //     outline) — never hand-size arrowheads.
  // Phase is integrated (this.phase += ω·dt), so changing k or m live re-tunes ω smoothly, no position jump.
  // ============================================================================================
  class Oscillator extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.discMinPx = 2;
      this.k = opts.k ?? 20; this.mass = opts.mass ?? 1;   // free-variant defaults are deliberately NOT the spray-can values (students dial those in to discover 1.4 Hz)
      this.hasGravity = !!opts.gravity; this.g = this.hasGravity ? (opts.g ?? 0) : 0;
      this.d = 0;                       // displacement about the (gravity-shifted) equilibrium, meters
      this.amp = 0; this.phase = 0; this.oscillating = false; this.dragging = false;
      this.simT = 0; this.last = 0;
      this.slomo = false; this.slomoFactor = 0.3;
      this.trace = [];                  // {t, d} samples for the scrolling strip
      this.running = true; this.paused = false; this.everPlayed = true;   // auto-scrolls; → always advances
      this.showReadout = true; this.showNet = true;   // showNet: the white net-force arrow (gravity variant) — toggled by its tick box
      this.dMin = -0.6; this.dMax = 0.6;
      this.resize(); this._bindDrag();
    }
    get omega() { return Math.sqrt(Math.max(1e-6, this.k / this.mass)); }
    get freq()  { return this.omega / TAU; }
    get xeq()   { return this.hasGravity ? -this.mass * this.g / this.k : 0; }
    get radius(){ return HOUSE.baseRadius * Math.cbrt(this.mass / 0.4); }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.scale = Math.min(w / HOUSE.frameW, h / HOUSE.frameH);
      this.massX = w * 0.74;                    // mass on the RIGHT; the x(t) history trails off to the LEFT (matches the spray-paint video)
      this.floorY = h * 0.86;
      this.eqY0 = h * 0.44;
      this.pxPerM = h * 0.20;
      this.paperSpeed = this.massX / 4.0;       // ~4 s of history across the space to the left of the mass
      this.render();
    }
    sx(x) { return x; }  sy(y) { return y; }        // identity → the shared _disc / _arrow get screen px directly
    _massScreenY(d) { return this.eqY0 - (this.xeq + d) * this.pxPerM; }
    play() {}                                       // auto-running; the Play button toggles pause
    reset() { this.d = 0; this.amp = 0; this.phase = 0; this.oscillating = false; this.dragging = false;
              this.trace = []; this.simT = 0; this.running = true; this.paused = false; this.render(); }
    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1); this.last = now;
        this.simT += dt;
        if (this.oscillating && !this.dragging) { this.phase += this.omega * dt; this.d = this.amp * Math.cos(this.phase); }
        this.trace.push({ t: this.simT, d: this.d });
        while (this.trace.length > 1 && this.massX - (this.simT - this.trace[0].t) * this.paperSpeed < -4) this.trace.shift();
      } else { this.last = now; }
      this.render();
    }
    _release() { this.amp = this.d; this.phase = 0; this.oscillating = true; this.dragging = false; }   // released from rest at d → cos phase starts at 0
    _bindDrag() {
      const toPx = (ev) => { const r = this.c.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * this.W, y: (ev.clientY - r.top) / r.height * this.H }; };
      const nearMass = (p) => Math.hypot(p.x - this.massX, p.y - this._massScreenY(this.d)) < Math.max(this.radius * this.scale * 1.8, 28);
      this.c.addEventListener("pointerdown", (ev) => { const p = toPx(ev);
        if (nearMass(p)) { this.dragging = true; this.oscillating = false; this.c.setPointerCapture?.(ev.pointerId); } });
      this.c.addEventListener("pointermove", (ev) => { if (!this.dragging) return; const p = toPx(ev);
        const d = (this.eqY0 - p.y) / this.pxPerM - this.xeq;
        this.d = Math.max(this.dMin, Math.min(this.dMax, d)); this.render(); });
      window.addEventListener("pointerup", () => { if (this.dragging) this._release(); });
    }
    // Drawn Spring (OBJECTS.md): boundary-gray coil, token geometry. The coil COUNT is a graphical cue — it
    // nudges up with stiffness (more coils as k rises) but is clamped to the token band; it is NOT physical.
    _spring(topY) {
      const ctx = this.ctx, x = this.massX, y0 = this.floorY, y1 = topY;
      const K_REF = 20;   // reference stiffness for the default coil count (engine tuning, like slomoFactor — a cue, not physics)
      const coils = Math.max(HOUSE.springCoilsMin, Math.min(HOUSE.springCoilsMax, Math.round(HOUSE.springCoils * Math.sqrt(this.k / K_REF))));
      const width = HOUSE.springWidth * this.scale, leadM = HOUSE.springLead * this.scale;
      const ya = y0 - leadM * 0.5, yb = y1 + leadM, span = ya - yb;      // floor-end lead half, mass-end lead full
      ctx.save(); ctx.strokeStyle = HOUSE.boundary; ctx.lineWidth = Math.max(this.scale * 0.045, 3); ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, ya);
      if (span > 0) for (let i = 1; i < 2 * coils; i++) { const yy = ya - span * i / (2 * coils), xx = x + ((i % 2 === 1) ? width / 2 : -width / 2); ctx.lineTo(xx, yy); }
      ctx.lineTo(x, yb); ctx.lineTo(x, y1); ctx.stroke(); ctx.restore();
    }
    // Drawn Floor (OBJECTS.md): boundary-gray line + 45° hatch ticks below, on the black stage. NO ground fill
    // — that's a separate object (scenery.ground), used only to hide buried teeth under a friction block.
    _floor() {
      const ctx = this.ctx, y = this.floorY, halfW = this.scale * 2.6, x0 = this.massX - halfW, x1 = this.massX + halfW;
      const hatch = 0.28 * this.scale, gap = Math.max(this.scale * 0.34, 13);
      ctx.save();
      ctx.strokeStyle = HOUSE.boundary; ctx.lineCap = "butt"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(this.scale * 0.06, 4);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.lineWidth = Math.max(this.scale * 0.032, 2.5);
      for (let hx = x0 + gap; hx <= x1 + 0.01; hx += gap) { ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx - hatch, y + hatch); ctx.stroke(); }
      ctx.restore();
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      const my = this._massScreenY(this.d), r = this.radius, eqScreen = this._massScreenY(0);
      // equilibrium baseline across the strip — bright dashed gray
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.5)"; ctx.setLineDash([6, 7]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, eqScreen); ctx.lineTo(this.massX, eqScreen); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      this._floor();
      this._spring(my + r * this.scale);                 // coil behind the mass (z: spring < body)
      // scrolling history trace to the LEFT (velocity-blue) — the spray-paint-on-moving-paper x(t)
      if (this.trace.length > 1) {
        ctx.save(); ctx.strokeStyle = HOUSE.velocity; ctx.lineWidth = Math.max(this.scale * 0.05, 2); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        let started = false;
        for (let i = this.trace.length - 1; i >= 0; i--) { const s = this.trace[i], X = this.massX - (this.simT - s.t) * this.paperSpeed, Y = this._massScreenY(s.d);
          if (X < -4) break; if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y); }
        ctx.stroke(); ctx.restore();
      }
      this._disc(this.massX, my, r, HOUSE.mass, 1);
      // gravity: house arrow pointing DOWN, on the SAME force-scale as the green spring arrow below
      // (length = |mg/k|·pxPerM = the equilibrium shift), so weight and spring force draw the same length
      // when they balance — at the resting point the two arrows are exactly equal-and-opposite (net zero).
      if (this.hasGravity && this.g > 0) {
        const lenPx = Math.max(HOUSE.arrowHeadLen * this.scale * 1.15, (this.mass * this.g / this.k) * this.pxPerM);
        this._arrow(this.massX, my, 0, lenPx, HOUSE.gravity, 1);   // identity coords → +vy is down-screen
      }
      this._springForceArrow(my);   // green restoring force — ALWAYS shown (all spring sims)
      // NET force (spring + gravity) — WHITE, drawn just LEFT of the mass, ending exactly on the gravity-shifted
      // equilibrium (where the net force is zero). Gravity variant only. On the same force-scale as the green +
      // gravity arrows, so green(up) + gravity(down) = this white net vector — and it keeps the teaching beat of
      // a force arrow that points right at the equilibrium (which the green spring arrow, now referenced to the
      // spring's natural length, no longer does).
      if (this.hasGravity && this.showNet) {
        const nx = this.massX - Math.max(this.radius * this.scale * 2.4, 42);
        this._forceToPointPx(nx, my, nx, this._massScreenY(0), HOUSE.ink, 1);
      }
      if (this.showReadout) this._readout();
    }
    // Green spring force on the mass, drawn to END on the spring's NATURAL-LENGTH position — the gravity-FREE
    // equilibrium (eqY0), NOT the gravity-shifted rest point. Its length is the stretch from natural length, so
    // with gravity on it is NONZERO at the shifted rest point, where it points up and exactly balances the weight
    // arrow (mass sits still ⇒ no net force shown). With no gravity, eqY0 IS the equilibrium, so it vanishes there.
    _springForceArrow(my) {
      this._forceToPointPx(this.massX, my, this.massX, this.eqY0, HOUSE.spring, 1);
    }
    _readout() {
      const ctx = this.ctx, fs = HOUSE.sizeBody * this.H;
      const lines = [`f = ${this.freq.toFixed(2)} Hz`, `ω = ${this.omega.toFixed(2)} rad/s`];
      if (this.hasGravity) lines.push(`x_eq = ${this.xeq.toFixed(2)} m`);
      ctx.save(); ctx.font = fs + "px " + HOUSE.fontMono; ctx.textBaseline = "top";
      const pad = this.scale * 0.22; let w = 0; lines.forEach(l => w = Math.max(w, ctx.measureText(l).width));
      const lh = this.scale * 0.4, bx = this.W - w - pad * 2 - Math.max(this.scale * 1.6, 84), by = this.scale * 0.35;
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillRect(bx, by, w + pad * 2, lines.length * lh + pad);
      ctx.fillStyle = "#cfe6ff"; lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.7 + i * lh)); ctx.restore();
    }
  }

  const OSC_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout on" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">⏸ Pause</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>k</i>:</span> <input type="range" class="s-k" min="5" max="80" step="1"><input type="number" class="n-k" step="1"><span class="u">N/m</span></label>
        <label><span class="var"><i>m</i>:</span> <input type="range" class="s-mass" min="0.1" max="1.2" step="0.05"><input type="number" class="n-mass" step="0.05"><span class="u">kg</span></label>
      </div>`;
  const OSC_G_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout on" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">⏸ Pause</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>g</i>:</span> <input type="range" class="s-g" min="0" max="20" step="0.5"><input type="number" class="n-g" step="0.5"><span class="u">m/s²</span></label>
        <label class="netchk"><input type="checkbox" class="s-net" checked> net force</label>
      </div>`;
  function mountOscillator(section) {
    const grav = section.dataset.gravity !== undefined;   // gravity variant: only a g slider (k & m fixed)
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", grav ? OSC_G_CONTROLS_HTML : OSC_CONTROLS_HTML);
    const d = section.dataset;
    const canvas = section.querySelector(".simcanvas");
    const sim = new Oscillator(canvas, { k: d.k !== undefined ? +d.k : (grav ? 11 : 20), mass: d.mass !== undefined ? +d.mass : (grav ? 0.4 : 1), gravity: grav, g: 0 });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = {}, num = {};
    rng.k = q(".s-k"); num.k = q(".n-k");                 // present only in the free variant
    if (grav) { rng.g = q(".s-g"); num.g = q(".n-g"); } else { rng.mass = q(".s-mass"); num.mass = q(".n-mass"); }
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    const apply = () => { if (rng.k) sim.k = +rng.k.value; if (grav) sim.g = +rng.g.value; else sim.mass = +rng.mass.value; sim.render(); };
    if (rng.k) rng.k.value = sim.k; if (grav) rng.g.value = sim.g; else rng.mass.value = sim.mass;
    Object.keys(rng).forEach(key => { const s = rng[key], n = num[key]; if (!s) return; n.value = s.value;
      s.addEventListener("input", () => { n.value = s.value; apply(); });
      n.addEventListener("input", () => { const v = parseFloat(n.value); if (isNaN(v)) return; s.value = clamp(s, v); apply(); });
      n.addEventListener("change", () => { const v = parseFloat(n.value); n.value = isNaN(v) ? s.value : clamp(s, v); s.value = n.value; apply(); });
    });
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = sim.paused ? "▶ Play" : "⏸ Pause"; };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { sim.paused = !sim.paused; if (!sim.paused) sim.last = performance.now(); refreshPlay(); });
    q(".reset").addEventListener("click", () => { sim.reset(); refreshPlay(); });
    const slo = q(".slomo"); if (slo) { slo.classList.toggle("on", sim.slomo); slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); }); }
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); sim.render(); });
    const netchk = q(".s-net");   // gravity variant only: toggle the white net-force arrow
    if (netchk) { netchk.checked = sim.showNet; netchk.addEventListener("change", () => { sim.showNet = netchk.checked; sim.render(); }); }
    apply();
    if (readonly) { canvas.style.pointerEvents = "none"; [playBtn, q(".reset"), slo, rt, netchk, rng.k, num.k, rng.mass, num.mass, rng.g, num.g].forEach(el => { if (el) el.disabled = true; }); const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
    let raf = null;
    sim.start = () => { sim.everPlayed = true; if (raf) return; const loop = (now) => { sim.step(now); raf = requestAnimationFrame(loop); }; sim.last = performance.now(); raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // SpringGame (data-sim="oscillator-game") — Class F, the gamified spring (plays right after sim-spring).
  // A DISTANCE game, not a win/lose puzzle. The mass sits on the LEFT (max time to read the field and time a
  // release); its x(t) history trails off the left edge. Small red squares drift in from the right — a SCARCE,
  // fully RANDOM field (no carved safe sine, so there is no path that runs forever): you're hunting the amplitude
  // + release phase that carries you as FAR as possible. Drag the mass up/down to pick an amplitude and let go to
  // launch (immediate, from a peak); if you keep holding, it auto-launches at the last allowed moment (when the
  // field reaches you), so you can't hand-steer. A distance counter "x = …" (top-right, house style) starts at 0
  // and begins counting the instant the field reaches the mass; hitting a square freezes it. "High Score: x = …"
  // appears under it once your first run ends. New game = a fresh random field (auto-starts).
  // ============================================================================================
  class SpringGame extends Oscillator {
    constructor(canvas, opts = {}) {
      super(canvas, { k: opts.k ?? 20, mass: opts.mass ?? 1, gravity: false });
      this.showReadout = false;
      this.gameRate = 0.55;              // global pace (<1) — calm enough to read the field and time a release
      this.sqHalf = 0.0375;              // square half-size (world m) — obstacles ~50% smaller (was 0.075)
      this.yMax = 0.62;                  // collidable squares scatter within ±yMax (world m)
      this.gapMin = 0.7; this.gapMax = 1.7;   // sim-s between consecutive RANDOM squares — denser than before (a little harder)
      this.decorGapK = 1.4;              // decorative-stream gap = collidable gap × this (a touch sparser)
      this.dMin = -0.75; this.dMax = 0.75;   // how high/low you can pull the mass (was ±0.62 — a bit more headroom)
      this.released = false; this.gphase = "idle";
      this.dist = 0; this.best = null;   // current distance; high score (null until the first run ends)
      this.squares = []; this.decor = [];
      this.paused = true; this.everPlayed = false;   // the GAME waits for Play (the plain spring sim auto-runs)
      this._gameReady = true; this._seedField(); this.render();
    }
    get period() { return TAU / this.omega; }
    get radius() { return HOUSE.baseRadius * Math.cbrt(this.mass); }   // standard house mass size
    play()  { this.paused = false; this.everPlayed = true; this.last = performance.now(); if (this.refreshPlayBtn) this.refreshPlayBtn(); }
    // Lay out a fresh RANDOM field. fieldT0 = when the first square reaches the mass column — the last moment you
    // may release, and when the distance counter starts. It's set so the whole field sits off the right edge at
    // simT=0 and streams in on Play; with the mass on the LEFT, that lead is long → lots of time to plan.
    _seedField() {
      const massRpx = this.radius * this.scale;
      this.reachT = (this.sqHalf * this.pxPerM + massRpx) / this.paperSpeed;   // time for a square's leading edge to cross into the mass's circle
      this.fieldT0 = (this.W - this.massX) / this.paperSpeed + 0.3;            // when the FIRST obstacle reaches the mass's plane (x = massX); off the right edge at simT=0
      this.startT = this.fieldT0 - this.reachT;                               // last moment you may release, AND when the counter starts (the field's edge meets the mass)
      // Seed the first obstacle EXACTLY at the mass plane AND at the equilibrium level (y=0): the auto-launch/counter
      // fire as it arrives, and a mass left at amplitude 0 (sitting at equilibrium) is hit immediately — so you can't
      // win by doing nothing; you must pick a real swing that's away from center when this first block passes.
      this.squares = [{ tA: this.fieldT0, y: 0 }];
      this.decor = [];
      this._genT = this.fieldT0; this._genTd = this.fieldT0;
      this._extendField(this.fieldT0 + 60);   // pre-generate well ahead; step() extends further as the run goes
    }
    _extendField(untilT) {
      const gap = () => this.gapMin + Math.random() * (this.gapMax - this.gapMin);
      while (this._genT < untilT) { this._genT += gap();
        this.squares.push({ tA: this._genT, y: (Math.random() * 2 - 1) * this.yMax }); }
      const dLo = this.dMax + 0.14, dHi = dLo + 0.6;                           // decorative band, safely OUTSIDE the mass's reach
      while (this._genTd < untilT) { this._genTd += gap() * this.decorGapK;
        this.decor.push({ tA: this._genTd, y: (dLo + Math.random() * (dHi - dLo)) * (Math.random() < 0.5 ? 1 : -1) }); }
    }
    resize() {
      super.resize();
      this.massX = this.W * 0.2; this.eqY0 = this.H * 0.5; this.pxPerM = this.H * 0.32;   // mass on the LEFT (max preview to the right)
      this.paperSpeed = this.W * 0.20;                                    // field/trace scroll speed
      if (this._gameReady) { this._seedField(); this.render(); }          // re-seed for the new geometry
    }
    reset() {   // "New game" — a fresh RANDOM field, re-armed to wait for Play (the New-game BUTTON then auto-plays)
      this.d = 0; this.amp = 0; this.phase = 0; this.oscillating = false; this.dragging = false;
      this.released = false; this.gphase = "idle"; this.dist = 0;         // NOTE: this.best (high score) is deliberately NOT reset
      this.trace = []; this.simT = 0; this.running = true; this.paused = true; this.everPlayed = false;
      if (this._gameReady) this._seedField();
      this.render();
    }
    _obstX(tA) { return this.massX + (tA - this.simT) * this.paperSpeed; }      // screen x now of a square arriving at simT = tA
    _release() {   // launch immediately from the held displacement (a peak, from rest); no re-grab
      if (this.released) return;
      this.amp = this.d; this.relT = this.simT; this.phase = 0;
      this.oscillating = true; this.dragging = false; this.released = true;
    }
    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * this.gameRate; this.last = now;
        this.simT += dt;
        if (this._genT < this.simT + 30) this._extendField(this.simT + 60);   // keep the random field generated ahead of the mass
        // the field reaching the mass PLANE forces a launch — you can't keep holding and hand-steer the mass around obstacles
        if (!this.released && this.simT >= this.startT) this._release();
        if (this.oscillating && !this.dragging && this.gphase !== "lost") { this.phase += this.omega * dt; this.d = this.amp * Math.cos(this.phase); }
        this.trace.push({ t: this.simT, d: this.d });
        while (this.trace.length > 1 && this.massX - (this.simT - this.trace[0].t) * this.paperSpeed < -4) this.trace.shift();
        this._prune();
        if (this.gphase !== "lost" && this.simT > this.startT) this.dist = (this.simT - this.startT) * this.paperSpeed / this.pxPerM;   // how far you've traveled since the field reached you
        if (this.released && this.gphase === "idle") this._score();
      } else { this.last = now; }
      this.render();
    }
    _prune() {   // drop squares that have scrolled off the left edge (lists are time-sorted → trim the front)
      const cut = this.simT - (this.massX + this.sqHalf * this.pxPerM * 2) / this.paperSpeed;
      while (this.squares.length && this.squares[0].tA < cut) this.squares.shift();
      while (this.decor.length && this.decor[0].tA < cut) this.decor.shift();
    }
    // Accurate CIRCLE (mass) vs axis-aligned SQUARE (obstacle) test in screen px — closest-point distance, so a
    // near-corner miss is NOT a hit. Squares are x-sorted, so scan only the few straddling the mass column, then stop.
    _score() {
      const massR = this.radius * this.scale, hPx = this.sqHalf * this.pxPerM;
      const cx = this.massX, cy = this._massScreenY(this.d);
      for (const q of this.squares) {
        const sx = this._obstX(q.tA);
        if (sx + hPx < cx - massR) continue;   // already passed the mass
        if (sx - hPx > cx + massR) break;       // not yet at the mass (nor is anything after it)
        const sy = this._massScreenY(q.y);
        const nx = Math.max(sx - hPx, Math.min(cx, sx + hPx));   // closest point on the square to the mass center
        const ny = Math.max(sy - hPx, Math.min(cy, sy + hPx));
        const ddx = cx - nx, ddy = cy - ny;
        if (ddx * ddx + ddy * ddy < massR * massR) {
          this.gphase = "lost"; this.running = false;
          this.best = Math.max(this.best ?? 0, this.dist);   // record the high score at the end of the run
          return;
        }
      }
    }
    _bindDrag() {
      const toPx = (ev) => { const r = this.c.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * this.W, y: (ev.clientY - r.top) / r.height * this.H }; };
      const nearMass = (p) => Math.hypot(p.x - this.massX, p.y - this._massScreenY(this.d)) < Math.max(this.radius * this.scale * 1.8, 30);
      this.c.addEventListener("pointerdown", (ev) => { if (this.released || this.paused) return; const p = toPx(ev);   // grab only after Play, before launch
        if (nearMass(p)) { this.dragging = true; this.c.setPointerCapture?.(ev.pointerId); } });
      this.c.addEventListener("pointermove", (ev) => { if (!this.dragging) return; const p = toPx(ev);
        const d = (this.eqY0 - p.y) / this.pxPerM; this.d = Math.max(this.dMin, Math.min(this.dMax, d)); this.render(); });
      window.addEventListener("pointerup", () => { if (this.dragging) this._release(); });   // let go = launch immediately
    }
    _drawSquares(ctx) {
      const szPx = this.sqHalf * this.pxPerM * 2, hPx = szPx / 2;
      ctx.save(); ctx.fillStyle = HOUSE.mmaRed;
      const drawSet = (arr) => { for (const q of arr) {
        const x = this._obstX(q.tA); if (x < -hPx || x > this.W + hPx) continue;
        ctx.fillRect(x - hPx, this._massScreenY(q.y) - hPx, szPx, szPx);
      }};
      drawSet(this.squares); drawSet(this.decor);
      ctx.restore();
    }
    _scoreReadout(ctx) {   // "x = …" (+ "High Score: x = …" once a run has ended), top-right, house mono
      const pad = this.scale * 0.32, fs = HOUSE.sizeBody * this.H;
      ctx.save(); ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.font = "700 " + fs + "px " + HOUSE.fontMono; ctx.fillStyle = HOUSE.ink;    // house tokens: body size, mono, ink
      ctx.fillText("x = " + this.dist.toFixed(1), this.W - pad, pad);
      if (this.best !== null) {
        ctx.font = (HOUSE.sizeCaption * this.H) + "px " + HOUSE.fontMono; ctx.fillStyle = HOUSE.muted;   // caption size, muted
        ctx.fillText("High Score:  x = " + this.best.toFixed(1), this.W - pad, pad + fs * 1.25);
      }
      ctx.restore();
    }
    render() {
      if (!this._gameReady) { super.render(); return; }
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      const my = this._massScreenY(this.d), r = this.radius, eqScreen = this._massScreenY(0);
      ctx.save(); ctx.strokeStyle = "rgba(255,255,255,0.22)"; ctx.setLineDash([6, 7]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(0, eqScreen); ctx.lineTo(this.W, eqScreen); ctx.stroke(); ctx.setLineDash([]); ctx.restore();
      this._floor();                                     // spring + horizontal floor drawn in the BACKGROUND, behind obstacles
      this._spring(my + r * this.scale);
      this._drawSquares(ctx);
      if (this.trace.length > 1) {
        ctx.save(); ctx.strokeStyle = HOUSE.velocity; ctx.lineWidth = Math.max(this.scale * 0.05, 2); ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
        let started = false;
        for (let i = this.trace.length - 1; i >= 0; i--) { const s = this.trace[i], X = this.massX - (this.simT - s.t) * this.paperSpeed, Y = this._massScreenY(s.d);
          if (X < -4) break; if (!started) { ctx.moveTo(X, Y); started = true; } else ctx.lineTo(X, Y); }
        ctx.stroke(); ctx.restore();
      }
      this._disc(this.massX, my, r, HOUSE.mass, 1);
      this._springForceArrow(my);                        // green spring force — always shown
      this._scoreReadout(ctx);
    }
  }

  const SPRINGGAME_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <div class="simctrls">
        <button class="simbtn play">⏸ Pause</button>
        <button class="simbtn reset">↺ New game</button>
      </div>`;
  function mountSpringGame(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", SPRINGGAME_CONTROLS_HTML);
    const d = section.dataset, canvas = section.querySelector(".simcanvas");
    const sim = new SpringGame(canvas, { k: d.k !== undefined ? +d.k : 20, mass: d.mass !== undefined ? +d.mass : 1 });
    const q = s => section.querySelector(s), readonly = window.self !== window.top;
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = sim.paused ? "▶ Play" : "⏸ Pause"; };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { if (sim.paused) { sim.paused = false; sim.everPlayed = true; sim.last = performance.now(); } else { sim.paused = true; } refreshPlay(); });
    q(".reset").addEventListener("click", () => { sim.reset(); sim.play(); refreshPlay(); });   // New game → fresh field, auto-starts (no second Play press)
    refreshPlay();   // first load: GAME starts paused → button reads ▶ Play
    if (readonly) { canvas.style.pointerEvents = "none"; [playBtn, q(".reset")].forEach(el => { if (el) el.disabled = true; }); const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
    let raf = null;
    // NOTE: unlike the other sims, start() must NOT mark the game as played — the game stays paused on slide entry
    // so the first → (or the Play button) is what actually starts it (see deck.js advance handler).
    sim.start = () => { if (raf) return; const loop = (now) => { sim.step(now); raf = requestAnimationFrame(loop); }; sim.last = performance.now(); raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // Attractor2D (data-sim="attractor2d") — Class F. A 2-D central spring F=-k r about a crosshair center.
  // Before Play, drag the mass to set the initial position r0 and drag the (dashed) velocity arrow to set
  // (u0,v0); Play LOCKS them in until Reset. Motion is exact SHM per component
  // (x=x0 cosωt+(u0/ω) sinωt, y=y0 cosωt+(v0/ω) sinωt), ω=√(k/m) — every launch is a closed ellipse, a
  // circle when the amplitudes match. k is fixed. Readout (123-toggle) shows k, x0, y0, u0, v0.
  // HOUSE STYLE (style/OBJECTS.md): pearl Crosshair, house `-|>` force arrow via SimBase._arrow (token head +
  // soft outline — do NOT hand-size), dashed velocity cue, white curved trail, velocity-blue motion blur.
  // ============================================================================================
  class Attractor2D extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.discMinPx = 2;
      this.k = opts.k ?? 4; this.mass = opts.mass ?? 1;
      this.x0d = opts.a ?? 3; this.y0d = 0;            // default initial position (A, 0); Reset returns here
      this.x0 = this.x0d; this.y0 = this.y0d;
      this.u0 = opts.u0 ?? 0; this.v0 = opts.v0 ?? 6;  // initial velocity: u along x, v along y
      this.velWorldPerMS = opts.velWorldPerMS ?? HOUSE.velWorldPerMS;   // house token (0.20 world per m/s)
      this.running = false; this.paused = false; this.everPlayed = false;
      this.t = 0; this.last = 0; this.now = 0; this.L = null; this.posHist = [];
      this.slomo = false; this.slomoFactor = 0.5;
      this.showReadout = true;
      this.vMin = -8; this.vMax = 8; this.vStep = 0.5; this.onVecChange = null;
      this.resize(); this._bindDrag();
    }
    get omega() { return Math.sqrt(Math.max(1e-6, this.k / this.mass)); }
    get radius() { return HOUSE.baseRadius; }
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.cx = w * 0.44; this.cy = h * 0.46;
      this.scale = (h * 0.32) / 3;                 // px/meter → a 3 m radius ≈ 0.32 H
      this.render();
    }
    sx(x) { return this.cx + x * this.scale; }
    sy(y) { return this.cy - y * this.scale; }
    _pos(t) { const L = this.L, w = L.omega;
      return { x: L.x0 * Math.cos(w * t) + (L.u0 / w) * Math.sin(w * t), y: L.y0 * Math.cos(w * t) + (L.v0 / w) * Math.sin(w * t) }; }
    play() { this.L = { x0: this.x0, y0: this.y0, u0: this.u0, v0: this.v0, omega: this.omega };
             this.t = 0; this.posHist = []; this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }
    reset() { this.running = false; this.paused = false; this.t = 0; this.posHist = []; this.x0 = this.x0d; this.y0 = this.y0d; this.render(); }
    step(now) {
      this.now = now;
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1); this.last = now; this.t += dt;
        const p = this._pos(this.t); this._recordPos(this.sx(p.x), this.sy(p.y), now, HOUSE.trailFadeS * 1000);
      }
      this.render();
    }
    _velTip() { return { x: this.x0 + this.u0 * this.velWorldPerMS, y: this.y0 + this.v0 * this.velWorldPerMS }; }
    _crosshair() { this._crosshairAt(this.cx, this.cy); }   // house Crosshair (shared) — token half-length, pearl
    _predicted() {   // closed ellipse over one period from the CURRENT ICs, dashed velocity-blue (house prediction)
      const w = this.omega, T = TAU / w, N = 128, ctx = this.ctx;
      ctx.save(); ctx.strokeStyle = HOUSE.velocity; ctx.globalAlpha = 0.32; ctx.lineWidth = 2; ctx.setLineDash([9, 8]); ctx.beginPath();
      for (let i = 0; i <= N; i++) { const t = T * i / N, x = this.x0 * Math.cos(w * t) + (this.u0 / w) * Math.sin(w * t), y = this.y0 * Math.cos(w * t) + (this.v0 / w) * Math.sin(w * t), X = this.sx(x), Y = this.sy(y);
        if (i === 0) ctx.moveTo(X, Y); else ctx.lineTo(X, Y); }
      ctx.stroke(); ctx.setLineDash([]); ctx.restore();
    }
    _velArrow() {   // house initial-velocity cue (shared dashed-shaft + soft token head), origin at r0
      const t = this._velTip();
      this._velCueArrow(this.sx(this.x0), this.sy(this.y0), this.sx(t.x), this.sy(t.y), HOUSE.velocity);
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      this._crosshair(); this._predicted();
      const active = this.running, p = active ? this._pos(this.t) : { x: this.x0, y: this.y0 };
      if (active) { this._whiteTrail(this.posHist, this.now, HOUSE.trailFadeS * 1000);
        this._motionBlur(this.radius, k => { const tk = this.t - k * HOUSE.blurDt; return tk < 0 ? null : this._pos(tk); }); }
      if (!active) this._velArrow();
      this._disc(p.x, p.y, this.radius, HOUSE.mass, 1);
      // restoring (spring) force pointing to the center and ENDING exactly on it — length = distance from the
      // center, so F = -k·r reads directly as "force ∝ distance from equilibrium" (and vanishes at the center).
      this._forceToPointPx(this.sx(p.x), this.sy(p.y), this.cx, this.cy, HOUSE.spring, 1);
      if (this.showReadout) this._readout();
    }
    _readout() {
      const ctx = this.ctx, fs = HOUSE.sizeBody * this.H;
      const lines = [`k = ${this.k.toFixed(1)} N/m`, `m = ${this.mass.toFixed(1)} kg`, `x₀ = ${this.x0.toFixed(1)} m`, `y₀ = ${this.y0.toFixed(1)} m`,
                     `u₀ = ${this.u0.toFixed(1)} m/s`, `v₀ = ${this.v0.toFixed(1)} m/s`];
      ctx.save(); ctx.font = fs + "px " + HOUSE.fontMono; ctx.textBaseline = "top";
      const pad = this.scale * 0.22; let w = 0; lines.forEach(l => w = Math.max(w, ctx.measureText(l).width));
      const lh = this.scale * 0.4, bx = this.W - w - pad * 2 - Math.max(this.scale * 1.6, 84), by = this.scale * 0.35;
      ctx.fillStyle = "rgba(0,0,0,0.42)"; ctx.fillRect(bx, by, w + pad * 2, lines.length * lh + pad);
      ctx.fillStyle = "#cfe6ff"; lines.forEach((l, i) => ctx.fillText(l, bx + pad, by + pad * 0.7 + i * lh)); ctx.restore();
    }
    _bindDrag() {
      let mode = null;
      const toWorld = (ev) => { const r = this.c.getBoundingClientRect(); const px = (ev.clientX - r.left) / r.width * this.W, py = (ev.clientY - r.top) / r.height * this.H; return { x: (px - this.cx) / this.scale, y: (this.cy - py) / this.scale }; };
      const nearTip = (w) => { const t = this._velTip(); return Math.hypot(w.x - t.x, w.y - t.y) < Math.max(0.5, this.radius * 2); };
      const nearBody = (w) => Math.hypot(w.x - this.x0, w.y - this.y0) < Math.max(0.6, this.radius * 2.5);
      this.c.addEventListener("pointerdown", (ev) => { if (this.running) return; const w = toWorld(ev);   // idle only — locked once Play is pressed
        mode = nearTip(w) ? "vel" : (nearBody(w) ? "pos" : null); if (mode) this.c.setPointerCapture?.(ev.pointerId); });
      this.c.addEventListener("pointermove", (ev) => { if (!mode) return; const w = toWorld(ev);
        if (mode === "vel") { let nu = (w.x - this.x0) / this.velWorldPerMS, nv = (w.y - this.y0) / this.velWorldPerMS;
          nu = Math.max(this.vMin, Math.min(this.vMax, Math.round(nu / this.vStep) * this.vStep));
          nv = Math.max(this.vMin, Math.min(this.vMax, Math.round(nv / this.vStep) * this.vStep));
          this.u0 = nu; this.v0 = nv; if (this.onVecChange) this.onVecChange(nu, nv); }
        else { this.x0 = Math.max(-5, Math.min(5, w.x)); this.y0 = Math.max(-3.5, Math.min(3.5, w.y)); }
        this.render(); });
      window.addEventListener("pointerup", () => { mode = null; });
    }
  }

  const ATTRACT_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout on" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>v</i><sub>x0</sub>:</span> <input type="range" class="s-u" min="-8" max="8" step="0.5"><input type="number" class="n-u" step="0.5"><span class="u">m/s</span></label>
        <label><span class="var"><i>v</i><sub>y0</sub>:</span> <input type="range" class="s-v" min="-8" max="8" step="0.5"><input type="number" class="n-v" step="0.5"><span class="u">m/s</span></label>
      </div>`;
  function mountAttractor2D(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", ATTRACT_CONTROLS_HTML);
    const d = section.dataset;
    const canvas = section.querySelector(".simcanvas");
    const sim = new Attractor2D(canvas, { k: d.k !== undefined ? +d.k : 4, mass: d.mass !== undefined ? +d.mass : 1, a: d.a !== undefined ? +d.a : 3,
      u0: d.u0 !== undefined ? +d.u0 : 0, v0: d.v0 !== undefined ? +d.v0 : 6 });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = { u: q(".s-u"), v: q(".s-v") }, num = { u: q(".n-u"), v: q(".n-v") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    const apply = () => { sim.u0 = +rng.u.value; sim.v0 = +rng.v.value; if (!sim.running) sim.render(); };
    rng.u.value = sim.u0; rng.v.value = sim.v0;
    sim.vMin = +rng.u.min; sim.vMax = +rng.u.max; sim.vStep = +rng.u.step || 0.5;
    sim.onVecChange = (u, v) => { rng.u.value = u; num.u.value = u; rng.v.value = v; num.v.value = v; };   // arrow drag → sliders
    Object.keys(rng).forEach(key => { const s = rng[key], n = num[key]; n.value = s.value;
      s.addEventListener("input", () => { n.value = s.value; apply(); });
      n.addEventListener("input", () => { const val = parseFloat(n.value); if (isNaN(val)) return; s.value = clamp(s, val); apply(); });
      n.addEventListener("change", () => { const val = parseFloat(n.value); n.value = isNaN(val) ? s.value : clamp(s, val); s.value = n.value; apply(); });
    });
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause"); };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { if (!sim.running) { apply(); sim.play(); } else if (sim.paused) sim.resume(); else sim.pause(); refreshPlay(); });
    q(".reset").addEventListener("click", () => { sim.reset(); refreshPlay(); });
    const slo = q(".slomo"); if (slo) { slo.classList.toggle("on", sim.slomo); slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); }); }
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); if (!sim.running) sim.render(); });
    sim.showReadout = true; apply();
    if (readonly) { canvas.style.pointerEvents = "none"; [playBtn, q(".reset"), slo, rt, rng.u, rng.v, num.u, num.v].forEach(el => { if (el) el.disabled = true; }); const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
    let raf = null, prev = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => { sim.step(now); if (sim.running !== prev) { prev = sim.running; refreshPlay(); } raf = requestAnimationFrame(loop); }; raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  // ============================================================================================
  // LauncherGame (data-sim="launcher") — Class I's gamified spring launcher with a LIVE scrolling
  // energy graph. Replaces the baked I2-1_Launcher clip in the deck's second pass.
  //
  // The physics beat: energy you PUT IN by hand comes back out as motion and height, and the spring's
  // share vanishes the instant the ball leaves it. The graph runs CONTINUOUSLY from the moment the
  // slide opens — before, during and after any launch — so the student sees the whole ledger, including
  // the part where *they* are the external force topping the system up.
  //
  //   • DRAG the ball to set compression AND launch angle about a PIN JOINT seated on the ground.
  //     Both are band-limited: no stretching past natural length (a push-only spring stores nothing in
  //     tension), no squashing past DMAX where the coil would go to mush.
  //   • RELEASE and the spring pushes the ball along its own axis — a genuinely integrated contact
  //     phase, not a teleport to a launch speed — and at natural length the ball leaves and is a plain
  //     projectile that never touches the spring again (a shot straight up is drawn passing over it).
  //   • CLICK THE LAUNCHER to recall a ball in flight: it vanishes and reloads immediately, so a missed
  //     shot costs no waiting.
  //   • Pressing Play only starts the targets. Everything else — graph, drag, launch — is live from the
  //     start, so there is no visual discontinuity between demoing and playing.
  //   • Play ⇄ Pause ⇄ Resume mid-round (pause to read the graph); a target reaching the GROUND ends the
  //     round. Failure UX follows Class E's DeflectGame, the high score follows Class F's SpringGame.
  // ============================================================================================
  const LAUNCHER_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <div class="simctrls hud-left">
        <button class="simbtn play">▶ Play</button>
      </div>`;

  class LauncherGame extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.discMinPx = 1.5;
      // k = 150 puts a full-compression vertical shot's apex at y ≈ 8.15 — just past the top of the play
      // area (y = 8), so the launcher can reach a target the instant it appears. At the old k = 120 the
      // apex was 6.6 and the top of the screen was simply unreachable.
      this.g = opts.g ?? 9.8; this.mass = opts.mass ?? 1; this.k = opts.k ?? 150;
      this.pivot = { x: 0, y: 0 };            // pin joint, seated ON the ground (y = 0)
      this.L0 = 1.5;                          // spring natural length
      this.dMax = 1.0;                        // max compression — beyond this the coil would visibly mush
      // Swing limit, measured from VERTICAL. The pedagogically useful reading is its complement: the
      // MINIMUM launch elevation above the horizontal, = 90° − thMax. At 75° that floor is 15°, half
      // the previous 30°, so much flatter shots are allowed while a truly horizontal launch (which
      // would just skid the ball along the ground) stays out of reach.
      this.thMax = Math.PI * (75 / 180);       // ±75° from vertical → ≥15° above horizontal
      this.worldH = 8; this.worldHalfW = 5.6;
      this.gTail = 6.0;                       // seconds of energy history on screen
      // Blank interval written into the graph each time a fresh ball loads. Without it the record is one
      // unbroken ribbon and a new ball's story runs straight on from the last one's, so a student reads the
      // scroll as a single continuous system.
      // Keep it a HAIRLINE. The first cut was 0.5 s, which backfired: a fast player can recall, aim and
      // fire again inside half a second, so the blank swallowed the start of the next shot and the graph
      // was missing real physics. It only has to read as a tick — punctuation, not a pause.
      // `gapFrames` guarantees the tick survives a slow frame, where one dt can exceed gapS outright.
      this.gapS = 0.05; this.gapMinFrames = 2;
      this.gapUntil = 0; this._gapFrames = 0; this._gapPending = false;
      // FROZEN energy scale. The most the system can ever hold is a full compression at zero tilt:
      // ½k·dMax² of spring, plus the ball's height at that moment. Everything after release is a
      // conservative trade, so nothing can exceed it — which means the axis never has to rescale, and a
      // band's height means the same thing at every moment of the round. An auto-scaling axis would
      // silently redefine "tall" every time the peak moved.
      this.eMax = (0.5 * this.k * this.dMax * this.dMax
                   + this.mass * this.g * (this.pivot.y + this.L0 - this.dMax)) * 1.08;
      // Furthest a full-compression shot can land (45°, level): v²/g. Used to clamp where targets may
      // appear — the band should span the screen, but never put one somewhere no shot could reach.
      const vLaunch = Math.sqrt(Math.max(0, (this.k * this.dMax * this.dMax
                                             - 2 * this.mass * this.g * this.dMax) / this.mass));
      this.reach = vLaunch * vLaunch / this.g;
      this.everPlayed = false; this.paused = false; this.best = null; this.record = false;
      this.resize();
      this.reset(true);
      this._bindPointer();
    }

    // ---- framing: play area on top, energy strip beneath, positioned by the HOUSE stack tokens ------
    // Same numbers a baked energy-graph slide uses (graph.stack_graph_h / _bottom_pct / _gap_pct), so the
    // live graph sits exactly where the clips' graphs sit and the two read as one object.
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      this.gh = h * HOUSE.stackGraphH;
      this.gy = h - h * (HOUSE.stackBottomPct / 100) - this.gh;
      this.playH = this.gy - h * (HOUSE.stackGapPct / 100);
      this.scale = Math.min(w / (this.worldHalfW * 2), this.playH / this.worldH);
      this.ox = w / 2;
    }
    sx(x) { return this.ox + x * this.scale; }
    sy(y) { return this.playH - y * this.scale; }      // world y = 0 IS the ground line
    get radius() { return HOUSE.baseRadius; }
    get running() { return this.gphase === "playing" && !this.paused; }

    // ---- state --------------------------------------------------------------------------------
    reset(hard) {
      this.theta = 0; this.delta = 0;
      this.attached = true; this.r = this.L0; this.rdot = 0;
      this.pos = this._axisPoint(this.r); this.vel = { x: 0, y: 0 };
      this.dragging = false; this.posHist = [];
      if (hard) {
        this.hits = 0; this.gphase = "idle"; this.target = null; this.nextIn = 0;
        this.hist = []; this.simT = 0; this.result = ""; this.record = false; this.paused = false;
        this.gapUntil = 0; this._gapFrames = 0; this._gapPending = false;   // simT restarts at 0 — no stale gap
      }
      // Re-seed the conservation reference from the state we just set. Without this, a reset after a loss
      // kept the PREVIOUS round's E0 — and _project(), seeing a total far above the loaded ball's
      // potential, would have handed the stationary ball the difference as kinetic energy and fired it
      // across the screen on its own.
      const e0 = this._energies(); this.E0 = e0.ke + e0.gpe + e0.spe;
      this.render();
    }
    _axisPoint(r) {
      return { x: this.pivot.x + r * Math.sin(this.theta), y: this.pivot.y + r * Math.cos(this.theta) };
    }
    play() {                                   // Play ⇄ Pause ⇄ Resume, plus Play-again after a loss
      if (this.gphase === "lost") { this.reset(true); }
      if (this.gphase === "playing") { this.paused = !this.paused; this.last = performance.now(); return; }
      this.gphase = "playing"; this.paused = false; this.everPlayed = true;
      this.nextIn = 1.2; this.last = performance.now();
    }
    _lose() {
      // Two end-game messages, following Class E's DeflectGame: a beaten high score is worth saying out
      // loud, and reads better than the same "Try again?" every time. Green + red for won/lost is that
      // sim's convention; the color is doing the same job here.
      const prev = this.best;                               // best BEFORE this run
      this.gphase = "lost";
      this.record = this.hits > 0 && this.hits > (prev ?? 0);
      this.result = this.record ? "New record!" : "Try again?";
      this.best = Math.max(prev ?? 0, this.hits);           // high score recorded at the end of the run
    }

    // ---- energy ledger ------------------------------------------------------------------------
    _energies() {
      const ke = 0.5 * this.mass * (this.attached ? this.rdot * this.rdot
                                                  : this.vel.x * this.vel.x + this.vel.y * this.vel.y);
      const y  = this.attached ? this._axisPoint(this.r).y : this.pos.y;
      const gpe = this.mass * this.g * Math.max(0, y - this.pivot.y);
      const spe = this.attached ? 0.5 * this.k * this.delta * this.delta : 0;
      return { ke, gpe, spe };
    }
    // Enforce EXACT conservation after the user lets go. Semi-implicit Euler is stable but not
    // symplectic-exact, so the total crept by a fraction of a percent over a long flight — invisible as
    // motion, but the whole teaching point here is a dead-flat total, and a visibly drifting lid
    // undermines it. So each substep we recompute the potential exactly, take the kinetic energy as the
    // REMAINDER of the launch energy, and rescale the velocity to match. Direction comes from the
    // integrator (which is accurate); only the magnitude is corrected. `E0` is re-read from the state
    // continuously while dragging — that is the one phase where the total is *supposed* to change.
    _project() {
      if (this.E0 == null) return;
      if (this.attached) {
        const y = this._axisPoint(this.r).y;
        const pot = this.mass * this.g * Math.max(0, y - this.pivot.y) + 0.5 * this.k * this.delta * this.delta;
        const ke = Math.max(0, this.E0 - pot);
        const spd = Math.sqrt(2 * ke / this.mass);
        this.rdot = this.rdot < 0 ? -spd : spd;
      } else {
        const pot = this.mass * this.g * Math.max(0, this.pos.y - this.pivot.y);
        const ke = Math.max(0, this.E0 - pot);
        const cur = 0.5 * this.mass * (this.vel.x * this.vel.x + this.vel.y * this.vel.y);
        if (cur > 1e-9) { const f = Math.sqrt(ke / cur); this.vel.x *= f; this.vel.y *= f; }
      }
    }
    _pushHistory() {
      const prune = () => {
        while (this.hist.length > 2 && this.simT - this.hist[0].t > this.gTail * 1.1) this.hist.shift();
      };
      // Inside a reload gap we record NOTHING, so the strip scrolls on as bare background. Pruning still
      // runs, or the tail would stop leaving the window while the gap scrolls through.
      if (this.simT < this.gapUntil || this._gapFrames > 0) {
        if (this._gapFrames > 0) this._gapFrames--;
        this._gapPending = true; prune(); return;
      }
      const e = this._energies();
      // `brk` marks the first sample after a gap: the renderer starts a new fill polygon there instead of
      // bridging the blank.
      this.hist.push({ t: this.simT, ke: e.ke, gpe: e.gpe, spe: e.spe, brk: this._gapPending });
      this._gapPending = false;
      prune();
    }

    // ---- pointer: drag the ball (compression + angle), click the launcher to recall -------------
    _bindPointer() {
      const toWorld = (ev) => {
        const rct = this.c.getBoundingClientRect();
        const px = (ev.clientX - rct.left) / rct.width * this.W, py = (ev.clientY - rct.top) / rct.height * this.H;
        return { x: (px - this.ox) / this.scale, y: (this.playH - py) / this.scale };
      };
      this.c.addEventListener("pointerdown", (ev) => {
        if (this.gphase === "lost") return;
        // Grab from ANYWHERE on the canvas. Requiring a hit on the ball itself was fiddly under time
        // pressure, and there is nothing else on screen to click — so a press anywhere starts the drag
        // and the ball snaps to the pointer on the first move. A press while a ball is in flight also
        // RECALLS it first, so a miss costs no waiting: one gesture recalls, aims and compresses.
        if (!this.attached) this._reload();
        this.dragging = true; this.c.setPointerCapture?.(ev.pointerId);
      });
      this.c.addEventListener("pointermove", (ev) => {
        if (!this.dragging) return;
        const p = toWorld(ev), dx = p.x - this.pivot.x, dy = p.y - this.pivot.y;
        this.theta = Math.max(-this.thMax, Math.min(this.thMax, Math.atan2(dx, dy)));   // from +y, not +x
        const rr = Math.max(this.L0 - this.dMax, Math.min(this.L0, Math.hypot(dx, dy)));
        this.delta = this.L0 - rr; this.r = rr; this.rdot = 0;
        this.pos = this._axisPoint(this.r);
        const e = this._energies(); this.E0 = e.ke + e.gpe + e.spe;   // dragging = the one phase that adds energy
        // NOTE: no clock advance here. The rAF loop owns simT; advancing it from the drag handler too
        // made the graph scroll at roughly double speed whenever the pointer was moving.
      });
      window.addEventListener("pointerup", () => {
        if (!this.dragging) return;
        this.dragging = false;
        if (this.delta <= 0.02) { this.delta = 0; this.r = this.L0; this.pos = this._axisPoint(this.r); }
      });
    }

    // ---- step: ALWAYS live unless paused or lost ------------------------------------------------
    // Pressing Play starts the targets and nothing else. The graph, the drag and the launch all run from
    // the moment the slide opens, so there is no jump between "demo" and "game".
    step(now) {
      if (this.paused || this.gphase === "lost") { this.last = now; return; }
      let dt = Math.min((now - this.last) / 1000, 0.05); this.last = now;
      const sub = 6, h = dt / sub;                       // substeps: the contact phase is stiff
      for (let i = 0; i < sub; i++) { this._integrate(h); this._project(); }
      this.simT += dt;
      this._pushHistory();
      if (this.gphase === "playing") this._targets(dt);
      this.render();
    }
    _integrate(h) {
      if (this.dragging) return;                          // while held, the user sets the state
      if (this.attached) {
        if (this.delta <= 0) return;
        const a = (this.k * (this.L0 - this.r) - this.mass * this.g * Math.cos(this.theta)) / this.mass;
        this.rdot += a * h; this.r += this.rdot * h;
        this.delta = Math.max(0, this.L0 - this.r);
        this.pos = this._axisPoint(this.r);
        if (this.r >= this.L0) {                          // coil back to natural length → the ball leaves
          this.attached = false; this.delta = 0;
          this.vel = { x: this.rdot * Math.sin(this.theta), y: this.rdot * Math.cos(this.theta) };
          this.pos = this._axisPoint(this.L0);
        }
      } else {
        this.vel.y -= this.g * h;
        this.pos.x += this.vel.x * h; this.pos.y += this.vel.y * h;
        this._recordPos(this.pos.x, this.pos.y, (this.now = performance.now()), HOUSE.trailFadeS * 1000);
        // Ground contact ends the flight the moment the ball TOUCHES the ground, not once its center has
        // sunk below it. The old test let a slow ball keep falling for several frames past the line,
        // converting height into kinetic energy that shouldn't exist — which showed up as a blue spike
        // and a bump in the total, exactly the artefact the graph must never have.
        // Sides: the ACTUAL visible half-width, so the ball flies right to the edge before recycling.
        const halfVis = (this.W / 2) / this.scale;
        if (this.pos.y - this.radius <= this.pivot.y ||
            Math.abs(this.pos.x) - this.radius > halfVis) this._reload();
      }
    }
    _reload() {
      this.attached = true; this.delta = 0; this.r = this.L0; this.rdot = 0;
      this.pos = this._axisPoint(this.r); this.vel = { x: 0, y: 0 }; this.posHist = [];
      const e = this._energies(); this.E0 = e.ke + e.gpe + e.spe;
      // punctuate the graph: this is a NEW ball, not more of the last
      this.gapUntil = this.simT + this.gapS; this._gapFrames = this.gapMinFrames;
    }

    // ---- targets ------------------------------------------------------------------------------
    // Difficulty is ONE knob: fall speed, climbing steadily with every hit. There is no spacing ramp —
    // a hit spawns the next target immediately, always — so the pressure comes from the clock on each
    // shot rather than from a gap that quietly shrinks. TARGET_RAMP is roughly double the first tuning;
    // it is the number to turn if the game is too easy or too brutal.
    _targets(dt) {
      const TARGET_V0 = 0.9, TARGET_RAMP = 0.28;
      const speed = TARGET_V0 + this.hits * TARGET_RAMP;
      // Targets eventually fall anywhere across the FULL visible width, but the band OPENS OUT over the
      // first SPAN_RAMP hits rather than starting wide. Full width from target one made the opening
      // seconds as hard as the endgame — the ramp gives a player a few near-vertical shots to find the
      // controls before the far corners start appearing. Width and speed now ramp together.
      const SPAN_RAMP = 15;
      const halfVis = (this.W / 2) / this.scale;
      const wide = Math.min(halfVis - this.radius, this.reach * 0.95);   // clamped: hard, never impossible
      const narrow = Math.min(this.worldHalfW * 0.72, wide);             // the original central band
      const span = narrow + (wide - narrow) * Math.min(1, this.hits / SPAN_RAMP);
      const spawn = () => { this.target = { x: (Math.random() * 2 - 1) * span,
                                            y: this.worldH, v: speed }; };
      if (!this.target) {
        this.nextIn -= dt;                        // only ever used for the FIRST target of a round
        if (this.nextIn <= 0) spawn();
        return;
      }
      this.target.y -= this.target.v * dt;
      if (this.target.y - this.radius <= this.pivot.y) return this._lose();   // touched the GROUND
      if (!this.attached) {
        const d = Math.hypot(this.pos.x - this.target.x, this.pos.y - this.target.y);
        if (d < 2 * this.radius) { this.hits += 1; this._reload(); spawn(); }   // next one falls at once
      }
    }

    // ---- drawing ------------------------------------------------------------------------------
    _ground() {   // house Floor: boundary-gray line + 45° hatch ticks below. The pin joint sits on it.
      const ctx = this.ctx, y = this.sy(0), x0 = 0, x1 = this.W;
      const hatch = 0.28 * this.scale, gap = Math.max(this.scale * 0.34, 13);
      ctx.save(); ctx.strokeStyle = HOUSE.boundary; ctx.lineCap = "butt"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(this.scale * 0.06, 4);
      ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x1, y); ctx.stroke();
      ctx.lineWidth = Math.max(this.scale * 0.032, 2.5);
      for (let hx = x0 + gap; hx <= x1 + 0.01; hx += gap) { ctx.beginPath(); ctx.moveTo(hx, y); ctx.lineTo(hx - hatch, y + hatch); ctx.stroke(); }
      ctx.restore();
    }
    _pin(cx, cy) {   // pin joint — background-filled ring in structural gray + solid center dot
      const ctx = this.ctx, R = Math.max(this.scale * 0.19, 6), ri = Math.max(this.scale * 0.06, 2.2);
      ctx.save();
      ctx.fillStyle = HOUSE.bg; ctx.strokeStyle = HOUSE.boundary; ctx.lineWidth = Math.max(this.scale * 0.028, 2);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = HOUSE.boundary; ctx.beginPath(); ctx.arc(cx, cy, ri, 0, TAU); ctx.fill();
      ctx.restore();
    }
    _coil() {        // the spring along its own (tilted) axis — house zigzag, boundary gray
      const ctx = this.ctx, a = this.pivot, b = this._axisPoint(this.r);
      const ax = this.sx(a.x), ay = this.sy(a.y), bx = this.sx(b.x), by = this.sy(b.y);
      const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
      const ux = dx / L, uy = dy / L, px = -uy, py = ux;
      const width = HOUSE.springWidth * this.scale, lead = HOUSE.springLead * this.scale;
      const coils = HOUSE.springCoils, s0 = lead * 0.5, s1 = L - lead, span = s1 - s0;
      ctx.save(); ctx.strokeStyle = HOUSE.boundary; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(this.scale * 0.045, 3);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + ux * s0, ay + uy * s0);
      if (span > 0) for (let i = 1; i < 2 * coils; i++) {
        const s = s0 + span * i / (2 * coils), off = (i % 2 === 1 ? width / 2 : -width / 2);
        ctx.lineTo(ax + ux * s + px * off, ay + uy * s + py * off);
      }
      ctx.lineTo(ax + ux * s1, ay + uy * s1); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore();
    }
    // A small BLACK cross inside the target disc. The target is deliberately the same pearl disc as the
    // ball (green was dropped — green is the spring role), so it needs some mark to read as a *target*
    // rather than a second ball. Black on the pearl fill, drawn in the background token so it stays a
    // hole in the disc rather than a new color in the palette.
    _targetMark(cx, cy) {
      const ctx = this.ctx, h = this.radius * this.scale * 0.62;
      ctx.save(); ctx.strokeStyle = HOUSE.bg; ctx.lineCap = "butt";
      ctx.lineWidth = Math.max(this.radius * this.scale * 0.22, 1.5);
      ctx.beginPath(); ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy);
      ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h); ctx.stroke(); ctx.restore();
    }
    _hud(ctx) {      // hits + high score, TOP LEFT (the Play button sits beneath, in .simctrls.hud-left)
      const pad = this.scale * 0.32, fs = HOUSE.sizeBody * this.H;
      ctx.save(); ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.font = "700 " + fs + "px " + HOUSE.fontMono; ctx.fillStyle = HOUSE.ink;
      ctx.fillText("Targets hit:  " + this.hits, pad, pad);
      if (this.best !== null) {
        ctx.font = (HOUSE.sizeCaption * this.H) + "px " + HOUSE.fontMono; ctx.fillStyle = HOUSE.muted;
        ctx.fillText("High Score:  " + this.best, pad, pad + fs * 1.25);
      }
      ctx.restore();
    }
    _graph(ctx) {
      // Scrolling stacked bands: "now" pinned to the right edge, history flowing left, on a FROZEN
      // vertical scale (this.eMax). Band order and colors match the baked energy graphs.
      // The y axis IS the left edge of the bands (x0 = axisX) — with the bands inset from it there was a
      // visible sliver of black between the axis and the oldest data, which read as a gap in the record.
      const axisX = this.W * 0.062, x0 = axisX, x1 = this.W * 0.985, gy = this.gy, gh = this.gh;
      const ax = axisX, ay = gy + gh;
      // The time axis runs the FULL width of the scrolling record, not a stub arm: the bands need a
      // baseline to sit on for their whole span, and a rule that stopped short left them floating.
      // Stroked LAST (see the call after the fills) rather than here — drawn first, the band fills would
      // cover its upper half wherever there is data, so it would read thinner under the record than
      // across the reload gaps.
      const timeAxis = () => {
        ctx.save(); ctx.strokeStyle = HOUSE.ink; ctx.lineWidth = 2; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x1, ay); ctx.stroke(); ctx.restore();
      };
      // the lower-left glyph: energy arm + both labels, drawn always — the axes are visible from frame zero
      ctx.save(); ctx.strokeStyle = HOUSE.ink; ctx.fillStyle = HOUSE.ink;
      ctx.lineWidth = 2; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax, ay - gh * 0.45); ctx.stroke();
      ctx.font = (HOUSE.sizeCaption * this.H * 0.85) + "px " + HOUSE.fontSans;
      ctx.textAlign = "center"; ctx.textBaseline = "top"; ctx.fillText("time", ax + this.W * 0.022, ay + 4);
      ctx.save(); ctx.translate(ax - 6, ay - gh * 0.225); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "bottom"; ctx.fillText("energy", 0, 0); ctx.restore();
      ctx.restore();

      const h = this.hist; if (h.length < 2) { timeAxis(); return; }
      const t1 = this.simT, t0 = t1 - this.gTail;
      const yOf = v => gy + gh - Math.min(1, v / this.eMax) * gh;
      const xOf = t => x0 + (Math.max(t0, Math.min(t1, t)) - t0) / this.gTail * (x1 - x0);
      const cum = h.map(p => ({ t: p.t, brk: p.brk, v: [p.ke, p.ke + p.gpe, p.ke + p.gpe + p.spe] }));
      const cols = [HOUSE.velocity, HOUSE.gravity, HOUSE.spring];
      // One run of samples per ball — split at the `brk` markers so the half-second blank left by a reload
      // stays blank instead of being spanned by the fill.
      const runs = []; let run = null;
      for (const c of cum) { if (!run || c.brk) { run = []; runs.push(run); } run.push(c); }
      // Painter's order, lowest band LAST — adjacent bands then share no edge against the background,
      // so there is no antialiased seam (the rule the baked renderer follows).
      for (let bi = cols.length - 1; bi >= 0; bi--) {
        ctx.save(); ctx.fillStyle = cols[bi];
        for (const rn of runs) {
          if (rn.length < 2) continue;
          ctx.beginPath();
          ctx.moveTo(xOf(rn[0].t), gy + gh);
          for (const c of rn) ctx.lineTo(xOf(c.t), yOf(c.v[bi]));
          ctx.lineTo(xOf(rn[rn.length - 1].t), gy + gh); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      timeAxis();   // on top of the fills, so the baseline is one even rule from the y axis to "now"
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      // The target is the SAME disc as the mass — same radius, same pearl fill, no border. Green was
      // tried and dropped: in this course green MEANS spring/restoring force, and a green target invited
      // students to read it as something spring-related rather than simply another mass. The two discs
      // are told apart by behavior, not color — the launched ball carries motion blur and a white
      // trail, the target falls clean.
      if (this.target) {
        this._disc(this.target.x, this.target.y, this.radius, HOUSE.mass, 1);
        this._targetMark(this.sx(this.target.x), this.sy(this.target.y));
      }
      this._ground();
      this._coil();
      this._pin(this.sx(this.pivot.x), this.sy(this.pivot.y));
      // Ball drawn OVER the coil: once released the two no longer interact, so an overlap is honest.
      if (!this.attached && this.posHist && this.posHist.length > 1) {
        this._whiteTrail(this.posHist.map(p => ({ x: this.sx(p.x), y: this.sy(p.y), t: p.t })),
                         this.now, HOUSE.trailFadeS * 1000);
        this._motionBlur(this.radius, k => this._posAtBack(k * HOUSE.blurDt * 1000) || null);
      }
      const b = this.attached ? this._axisPoint(this.r) : this.pos;
      this._disc(b.x, b.y, this.radius, HOUSE.mass, 1);
      this._hud(ctx);
      if (this.gphase === "lost") {
        ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillStyle = this.record ? HOUSE.spring : "#e6b0a0";
        ctx.font = "700 " + (HOUSE.sizeSubtitle * this.H) + "px " + HOUSE.fontSans;
        ctx.fillText(this.result, this.W / 2, this.playH * 0.16); ctx.restore();
      }
      this._graph(ctx);
    }
  }

  function mountLauncherGame(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", LAUNCHER_CONTROLS_HTML);
    const canvas = section.querySelector(".simcanvas");
    const sim = new LauncherGame(canvas, {
      k: section.dataset.k !== undefined ? +section.dataset.k : undefined,
      g: section.dataset.g !== undefined ? +section.dataset.g : undefined
    });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const playBtn = q(".play");
    // Play ⇄ Pause ⇄ Resume during a round (pause to read the graph), "↻ Play again" once it's over.
    const refreshPlay = () => {
      playBtn.disabled = readonly;
      playBtn.textContent = sim.gphase === "lost" ? "↻ Play again"
                          : sim.gphase !== "playing" ? "▶ Play"
                          : sim.paused ? "▶ Resume" : "⏸ Pause";
    };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { sim.play(); refreshPlay(); });
    if (readonly) { canvas.style.pointerEvents = "none"; playBtn.disabled = true; const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
    // The loop runs ALWAYS — the graph scrolls and the launcher is usable before Play is ever pressed.
    let raf = null, prevPhase = sim.gphase, prevPaused = sim.paused;
    sim.start = () => { if (raf) return; const loop = (now) => {
      sim.step(now);
      if (sim.gphase !== prevPhase || sim.paused !== prevPaused) { prevPhase = sim.gphase; prevPaused = sim.paused; refreshPlay(); }
      raf = requestAnimationFrame(loop);
    }; sim.last = performance.now(); raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    refreshPlay();
    return sim;
  }

  // Dispatcher: pick the preset from data-sim (default projectile).
  function mount(section) {
    const kind = (section.dataset.sim || "projectile").toLowerCase();
    if (kind === "elevator" || kind === "handlift" || kind === "normal") return mountHandLift(section);
    if (kind === "projectile2d" || kind === "2d") return mountProjectile2D(section);
    if (kind === "deflect" || kind === "game") return mountDeflect(section);
    if (kind === "circle" || kind === "circular") return mountCircle(section);
    if (kind === "oscillator" || kind === "spring") return mountOscillator(section);
    if (kind === "oscillator-game" || kind === "springgame") return mountSpringGame(section);
    if (kind === "attractor2d" || kind === "attractor") return mountAttractor2D(section);
    if (kind === "launcher" || kind === "launchergame") return mountLauncherGame(section);
    return mountProjectile(section);
  }

  function mountProjectile(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", CONTROLS_HTML);
    const d = section.dataset;
    const opts = {
      v0:   d.v0   !== undefined ? +d.v0   : 0,
      mass: d.mass !== undefined ? +d.mass : 1,
      g:    d.g    !== undefined ? +d.g    : 9.8,
      y0:   d.y0   !== undefined ? +d.y0   : undefined,
      focusY: d.focus !== undefined ? +d.focus : undefined,
      slomo: d.slomo !== "false"   // default ON; a slide opts out with data-slomo="false"
    };
    const canvas = section.querySelector(".simcanvas");
    const sim = new Projectile(canvas, opts);
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;              // speaker-view copy: read-only
    const rng = { v0: q(".s-v0"), mass: q(".s-mass"), g: q(".s-g") };
    const num = { v0: q(".n-v0"), mass: q(".n-mass"), g: q(".n-g") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    const apply = () => { sim.v0 = +rng.v0.value; sim.mass = +rng.mass.value; sim.g = +rng.g.value; if (!sim.running) sim.render(); };

    rng.v0.value = sim.v0; rng.mass.value = sim.mass; rng.g.value = sim.g;   // seed sliders from presets
    sim.vMin = +rng.v0.min; sim.vMax = +rng.v0.max; sim.vStep = +rng.v0.step || 0.5;
    sim.onV0Change = (v) => { rng.v0.value = v; num.v0.value = v; };         // velocity-arrow drag → slider/box
    Object.keys(rng).forEach(k => {
      const s = rng[k], n = num[k]; n.value = s.value;
      s.addEventListener("input", () => { n.value = s.value; apply(); });
      n.addEventListener("input", () => { const v = parseFloat(n.value); if (isNaN(v)) return; s.value = clamp(s, v); apply(); });
      n.addEventListener("change", () => { const v = parseFloat(n.value); n.value = isNaN(v) ? s.value : clamp(s, v); s.value = n.value; apply(); });
    });
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause"); };
    sim.refreshPlayBtn = refreshPlay;   // let the deck reset the label when it auto-resets the sim on slide-leave
    playBtn.addEventListener("click", () => {
      if (!sim.running) { apply(); sim.play(); }
      else if (sim.paused) sim.resume();
      else sim.pause();
      refreshPlay();
    });
    q(".reset").addEventListener("click", () => { sim.reset(); refreshPlay(); });
    const slo = q(".slomo");
    slo.classList.toggle("on", sim.slomo);
    slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); });
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); if (!sim.running) sim.render(); });
    apply();

    if (readonly) {
      canvas.style.pointerEvents = "none";
      [q(".play"), q(".reset"), slo, rt, rng.v0, rng.mass, rng.g, num.v0, num.mass, num.g].forEach(el => { if (el) el.disabled = true; });
      const ctrls = q(".simctrls"); if (ctrls) ctrls.style.opacity = ".4";
    }

    let raf = null, prevRunning = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => {
      sim.step(now);
      if (sim.running !== prevRunning) { prevRunning = sim.running; refreshPlay(); }   // e.g. it went off-screen
      raf = requestAnimationFrame(loop);
    }; raf = requestAnimationFrame(loop); };
    sim.stop  = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  window.Interactive = { Projectile, Projectile2D, HandLift, DeflectGame, Circular, Oscillator, SpringGame, Attractor2D, LauncherGame, mount, HOUSE };
})();
