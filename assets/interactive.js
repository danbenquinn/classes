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
  // The house per-body tint ramp, mirroring energygraph.tints() so a LIVE sim and a BAKED clip give
  // the same body the same shade. Blends the role color toward `tint_to` (a near-black, NOT white — the
  // ramp gets darker, which is the direction that surprised this engine once already). n < 4 is the
  // brightest-first branch; body 0 keeps the pure role color and each later body is a step darker.
  // Used for BOTH the mass discs and their kinetic-energy bands, so mass and band track each other.
  function tints(hex, n) {
    const to = cvar("--tint-to", "#101015"), spread = cnum("--tint-spread", 0.62);
    const rgb = h => { const v = h.replace("#", ""); return [0, 2, 4].map(i => parseInt(v.substr(i, 2), 16)); };
    const c0 = rgb(hex), c1 = rgb(to);
    const maxF = n > 2 ? spread * (n - 2) / (n - 1) : spread;
    const out = [];
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : maxF * i / (n - 1);
      out.push("#" + c0.map((c, j) => Math.round(c * (1 - f) + c1[j] * f).toString(16).padStart(2, "0")).join(""));
    }
    return out;
  }

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

  // ---- Quadratic drag (Class K) -------------------------------------------------------------
  // beta = ½·rho·C_d·A_perp  [kg/m] — the lumped constant on the FormulaSheet: F_d = -beta|ṙ|ṙ.
  // With beta > 0 the analytic pos(t)/vel(t) are gone: in 2-D drag couples x and y through |ṙ| and
  // there is no closed form (which is the point Class K makes). So a trajectory is RK4-integrated
  // once at play(), sampled onto a uniform grid, and interpolated. beta = 0 short-circuits back to
  // the analytic path, so every drag-free deck (B, D) behaves exactly as before.
  const RHO_AIR = 1.2;                                   // sea-level air density, the course's rho
  function betaOf(cd, area) { return 0.5 * RHO_AIR * Math.max(cd || 0, 0) * Math.max(area || 0, 0); }

  // One RK4 substep of  r̈ = -g ŷ - (beta/m)|ṙ|ṙ.  `k` is beta/m and is passed in FRESH every substep,
  // which is the whole point: the C_d / A⊥ sliders change the motion mid-flight, not just the arrows.
  function dragStep(st, dt, g, k) {                      // st = {x, y, u, v}, mutated in place
    const au = (u, v) => -k * Math.hypot(u, v) * u;
    const av = (u, v) => -g - k * Math.hypot(u, v) * v;
    const k1u = au(st.u, st.v), k1v = av(st.u, st.v);
    const k2u = au(st.u + .5 * dt * k1u, st.v + .5 * dt * k1v), k2v = av(st.u + .5 * dt * k1u, st.v + .5 * dt * k1v);
    const k3u = au(st.u + .5 * dt * k2u, st.v + .5 * dt * k2v), k3v = av(st.u + .5 * dt * k2u, st.v + .5 * dt * k2v);
    const k4u = au(st.u + dt * k3u, st.v + dt * k3v),           k4v = av(st.u + dt * k3u, st.v + dt * k3v);
    const du = dt / 6 * (k1u + 2 * k2u + 2 * k3u + k4u), dv = dt / 6 * (k1v + 2 * k2v + 2 * k3v + k4v);
    st.x += dt * (st.u + du / 2); st.y += dt * (st.v + dv / 2); st.u += du; st.v += dv;
  }

  // Advance by one frame in fixed ~2 ms substeps, so a long frame (tab refocus, slo-mo toggle) can't
  // destabilize it, then record the state. The history IS the trajectory now: with no closed form
  // left, it is what pos(t)/vel(t) read for PAST times — motion blur and the drawn trail.
  function dragAdvance(st, hist, t, dt, g, k) {
    const n = Math.max(1, Math.min(400, Math.ceil(dt / 0.002))), s = dt / n;
    for (let i = 0; i < n; i++) dragStep(st, s, g, k);
    hist.push({ t, x: st.x, y: st.y, u: st.u, v: st.v });
    if (hist.length > 6000) hist.shift();
  }

  function histAt(hist, t) {                             // binary search + linear interpolation
    if (!hist || !hist.length) return null;
    const last = hist[hist.length - 1];
    if (t >= last.t) return last;
    if (t <= hist[0].t) return hist[0];
    let lo = 0, hi = hist.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (hist[m].t <= t) lo = m; else hi = m; }
    const A = hist[lo], B = hist[hi], f = (t - A.t) / Math.max(B.t - A.t, 1e-9);
    return { t, x: A.x + (B.x - A.x) * f, y: A.y + (B.y - A.y) * f,
             u: A.u + (B.u - A.u) * f, v: A.v + (B.v - A.v) * f };
  }

  class Projectile extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.focusY = opts.focusY ?? HOUSE.focusY;
      this.v0 = opts.v0 ?? 0; this.g = opts.g ?? 9.8; this.mass = opts.mass ?? 1;
      this.beta = opts.beta ?? 0;          // ½rho·C_d·A_perp [kg/m], read LIVE off the sliders
      this.dragMode = !!opts.dragMode;     // set by the mount, NOT by beta: a slide that can reach
                                           // drag always integrates, so beta may change mid-flight
      this.st = null; this.hist = null;    // live state + its history (see dragAdvance / histAt)
      this.area = opts.area ?? 0.4;        // A_perp [m²], mirrored from the slider so the DISC can track it
      this.areaRef = opts.areaRef ?? 0.4;  // the area drawn at exactly house size (middle of the travel)
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

    // Drag slides draw the ball at the size the slider says it is: A_perp = pi r^2, so the disc
    // tracks sqrt(A). Bounded to [0.5, 1.75] x house size — enough that growing the area visibly
    // grows the ball, never enough for it to vanish or swallow the frame. Off a drag slide the
    // radius is the usual cbrt(mass).
    get radius() {
      if (this.dragMode) {
        const f = Math.sqrt(Math.max(this.area, 1e-6) / Math.max(this.areaRef, 1e-6));
        return HOUSE.baseRadius * Math.min(Math.max(f, 0.5), 1.75);
      }
      return HOUSE.baseRadius * Math.cbrt(this.mass);
    }
    _forceLen(g) { return 1.3 * this.mass * (g / 9.8); }
    // resize / sx / sy inherited from SimBase (centered viewplane, focusY at screen center)

    pos(t) { const L = this.L; if (!L) return { x: this.x0, y: this.y0 };
             if (this.dragMode) { const s = histAt(this.hist, t); return { x: L.x0, y: s ? s.y : L.y0 }; }
             return { x: L.x0, y: L.y0 + L.v0 * t - 0.5 * L.g * t * t }; }
    vel(t) { const L = this.L; if (!L) return this.v0;
             if (this.dragMode) { const s = histAt(this.hist, t); return s ? s.v : L.v0; }
             return L.v0 - L.g * t; }
    // Terminal speed sqrt(mg/beta) — the FormulaSheet result, shown live in the readout.
    get vTerm() { return this.beta > 0 ? Math.sqrt(this.mass * this.g / this.beta) : Infinity; }

    play()   { this.L = { x0: this.x0, y0: this.y0, v0: this.v0, g: this.g };
               this.st = { x: this.x0, y: this.y0, u: 0, v: this.v0 };
               this.hist = [{ t: 0, x: this.x0, y: this.y0, u: 0, v: this.v0 }];
               this.t = 0; this.gone = false; this.goneAt = null; this.fadeStart = null;
               this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }
    reset()  { this.running = false; this.paused = false; this.gone = false; this.goneAt = null; this.t = 0;
               this.L = null; this.st = null; this.hist = null;
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
        if (this.dragMode) dragAdvance(this.st, this.hist, this.t, dt, this.L.g, this.beta / this.mass);
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
      // Drag: amber (roles.friction), drawn opposite the motion, length on the SAME scale as the
      // weight arrow — so at terminal speed the two are visibly equal and opposite.
      if (this.beta > 0) {
        const vy = this.running ? this.vel(this.t) : this.v0;
        const fd = -this.beta * Math.abs(vy) * vy;                 // signed force, +y up
        if (Math.abs(fd) > 1e-9)
          this._arrow(p.x, p.y, 0, Math.sign(fd) * this._forceLen(Math.abs(fd) / this.mass), HOUSE.friction, a);
      }
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
      if (this.beta > 0) {                                        // Class K: the lumped constant and its asymptote
        lines.push(`\u03b2 = ${this.beta.toFixed(3)} kg/m`);
        lines.push(`terminal = ${this.vTerm.toFixed(2)} m/s`);
      }
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
      this.catching = false; this.catchY1 = undefined; this.catchA = 0;
      this.seating = false; this.seatA = 0;
    }
    play()   { this._resetState(); this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }  // starts from the current y0
    reset()  { this.running = false; this.paused = false; this.y0 = this.y0init; this._resetState(); this.render(); }                  // back to initial rest (slide-leave)
    // pause / resume inherited from SimBase

    // ---- the CATCH, as a quintic Hermite ------------------------------------------------------
    // Until 2026-08 the catch was an assignment: `this.ballY = line; this.ballVy = 0;` — the ball's
    // velocity went to zero inside one frame. On screen that is the abrupt stop; on Class J's energy
    // graph it is an infinite power spike, i.e. a vertical cliff in the very curve the class is asked
    // to read a slope off.
    //
    // The course already solved this. Class E's juggling hands catch a ball twice a second without a
    // jolt, using the quintic carry in mae-2501-applied-physics-i/kernels/juggle_common.py
    // (`_quintic` / `_quintic_accel`): a Hermite that matches POSITION, VELOCITY and ACCELERATION at
    // both ends. Same basis here, different boundary data — enter at the ball's own height and
    // velocity with gravity's acceleration, leave at rest with zero acceleration.
    //
    // Matching A0 = -g on entry is the part not to skip. It is what keeps the normal-force arrow from
    // popping into existence at full length the instant of contact: F_N = m(g + a), and if `a` jumps
    // from -g to something else in one frame, so does the arrow. The arrow is on screen.
    _quintic(P0, P1, M0, M1, A0, A1, s, T) {
      const s2 = s * s, s3 = s2 * s, s4 = s3 * s, s5 = s4 * s;
      const H0 = 1 - 10 * s3 + 15 * s4 - 6 * s5,   H1 = s - 6 * s3 + 8 * s4 - 3 * s5,
            H2 = 0.5 * s2 - 1.5 * s3 + 1.5 * s4 - 0.5 * s5, H3 = 0.5 * s3 - s4 + 0.5 * s5,
            H4 = -4 * s3 + 7 * s4 - 3 * s5,        H5 = 10 * s3 - 15 * s4 + 6 * s5;
      const D0 = -30 * s2 + 60 * s3 - 30 * s4,     D1 = 1 - 18 * s2 + 32 * s3 - 15 * s4,
            D2 = s - 4.5 * s2 + 6 * s3 - 2.5 * s4, D3 = 1.5 * s2 - 4 * s3 + 2.5 * s4,
            D4 = -12 * s2 + 28 * s3 - 15 * s4,     D5 = 30 * s2 - 60 * s3 + 30 * s4;
      const E0 = -60 * s + 180 * s2 - 120 * s3,    E1 = -36 * s + 96 * s2 - 60 * s3,
            E2 = 1 - 9 * s + 18 * s2 - 10 * s3,    E3 = 3 * s - 12 * s2 + 10 * s3,
            E4 = -24 * s + 84 * s2 - 60 * s3,      E5 = 60 * s - 180 * s2 + 120 * s3;
      const T2 = T * T;
      return {
        y:  H0 * P0 + H1 * T * M0 + H2 * T2 * A0 + H3 * T2 * A1 + H4 * T * M1 + H5 * P1,
        vy: (D0 * P0 + D1 * T * M0 + D2 * T2 * A0 + D3 * T2 * A1 + D4 * T * M1 + D5 * P1) / T,
        a:  (E0 * P0 + E1 * T * M0 + E2 * T2 * A0 + E3 * T2 * A1 + E4 * T * M1 + E5 * P1) / T2
      };
    }

    // Open the catch. The hand GIVES — it keeps descending under the ball and eases both to rest,
    // which is what a real catch does and what makes the lid of the energy graph fall smoothly
    // instead of dropping off a cliff. The give distance is the one a smooth deceleration actually
    // needs (mean speed over the carry is about half the entry speed), so a fast arrival gets a
    // deeper, longer catch and a gentle one barely dips.
    _beginCatch(t, yContact) {
      const v = Math.abs(this.ballVy);
      this.catchDur = Math.max(0.22, Math.min(0.55, 0.12 + 0.055 * v));
      this.catchT0 = t; this.catchY0 = yContact; this.catchV0 = this.ballVy;
      this.catchY1 = yContact - 0.5 * v * this.catchDur;
      // Seed the drawn acceleration with the quintic's own entry value. `render()` reads catchA to
      // size the normal-force arrow, and on THIS frame `_advance` is still in the free-flight branch,
      // so catchA has not been written yet — an unseeded `|| 0` drew N = mg for exactly one frame,
      // which is the flick of purple visible at the moment of contact. The model was always
      // continuous here (the quintic enters at A0 = -g, so N enters at zero); only the drawing lagged.
      this.catchA = -this.g;
      this.catching = true; this.attached = true; this.caught = true;
    }

    // The RE-SEAT, and it is not the catch. For |a_max| a little past g the ball leaves the palm for a
    // few frames and then meets a hand that has since decelerated — it never "flew," so it must land and
    // carry on riding the hand's planned push rather than coming to rest. That is why this cannot just
    // call _beginCatch: `caught` would end the run.
    //
    // The old code matched velocities by assignment here, which is the same infinite-power cliff the
    // catch used to have, only smaller and more often: a visible kink in the energy bands and a ~6 N
    // step in the normal-force arrow, both around a = -11.7. Same quintic, different boundary data —
    // enter at the ball's own velocity with gravity's acceleration, and leave matched to where the hand
    // will BE: its position, its velocity and its acceleration at the end of the blend. Matching all
    // three is what lets the attached branch take over without a second discontinuity.
    _beginSeat(t) {
      // The blend duration is chosen from how hard the re-seat is, not fixed. The quintic must swing
      // the ball's acceleration from -g to the hand's own value by the end, and forcing a big swing
      // through a short blend overshoots as 1/tau^2 — a fixed 0.08 s gave a 21 N per-frame step at
      // a = -11.7, worse than the hard snap it replaced. Two passes because the end state depends on
      // the duration that depends on the end state; it converges immediately.
      // The divisors are tuned, not derived: they are the ones that hold the worst per-frame step
      // across a in [-13, -10] to about 4 N, which is inside the ordinary variation of N during a
      // push and so reads as no event at all.
      let dur = 0.14;
      for (let k = 0; k < 2; k++) {
        const e = this._hand(t + dur);
        const dv = Math.abs(this.ballVy - e.vy);      // velocity to be matched
        const da = Math.abs(e.a + this.g);            // acceleration swing, from -g to the hand's
        dur = Math.max(0.12, Math.min(0.28, Math.max(dv / 12, da / 90)));
      }
      this.seatDur = dur;
      const end = this._hand(t + this.seatDur);
      this.seatT0 = t; this.seatY0 = this.ballY; this.seatV0 = this.ballVy;
      this.seatY1 = end.y; this.seatV1 = end.vy; this.seatA1 = end.a;
      this.seatA = -this.g;                       // entry acceleration, for the arrow on this frame
      this.seating = true; this.attached = true; this.detached = false; this.noRelease = true;
    }

    _seatAt(t) {
      const s = Math.min(1, Math.max(0, (t - this.seatT0) / this.seatDur));
      if (s >= 1) { const e = this._hand(t); return { y: e.y, vy: e.vy, a: e.a }; }
      return this._quintic(this.seatY0, this.seatY1, this.seatV0, this.seatV1,
                           -this.g, this.seatA1, s, this.seatDur);
    }

    _catchAt(t) {
      const s = Math.min(1, Math.max(0, (t - this.catchT0) / this.catchDur));
      if (s >= 1) return { y: this.catchY1, vy: 0, a: 0 };
      return this._quintic(this.catchY0, this.catchY1, this.catchV0, 0, -this.g, 0, s, this.catchDur);
    }

    // The physics, one fixed step. Split out of step() in 2026-08 so a subclass can run the whole
    // trajectory headlessly before showing it (HandLiftEnergy precomputes its axes this way). step()
    // is now only "what is dt, and draw"; nothing about the model lives there.
    _advance(dt) {
      this.t += dt; this.now = this.t * 1000;                   // blur/history keyed to SIM-time (baked-consistent)
      if (this.catching) {                                      // the hand is easing the ball to rest
        const p = this._catchAt(this.t);
        this.ballY = p.y; this.ballVy = p.vy; this.catchA = p.a;
        if (this.t - this.catchT0 >= this.catchDur) { this.catching = false; this.ballVy = 0; }
      } else if (this.seating) {                                // landing back on a still-moving hand
        const p = this._seatAt(this.t);
        this.ballY = p.y; this.ballVy = p.vy; this.seatA = p.a;
        if (this.t - this.seatT0 >= this.seatDur) this.seating = false;
      } else if (this.attached && !this.caught) {               // riding the hand's planned push
        const p = this._hand(this.t);
        this.ballY = p.y; this.ballVy = p.vy;
        if (!this.noRelease && p.a < -this.g) {                 // palm would have to pull -> release
          this.attached = false; this.detached = true; this.cleared = false;
          this.detachT = this.t; this.detachY = p.y; this.detachV = p.vy;
        }
      } else if (this.attached && this.caught) {                // resting in the hand again after a catch
        this.ballY = this.catchY1 !== undefined ? this.catchY1 : this._handTraj(this.t).y; this.ballVy = 0;
      } else {                                                  // free flight
        this.ballVy -= this.g * dt; this.ballY += this.ballVy * dt;
        const line = this._handTraj(this.t).y;
        if (this.ballY > line + 0.05) this.cleared = true;      // ball got clearly above the hand
        // Re-contact the hand only when it can actually support the ball again (its accel is no longer
        // steeper than g) OR the ball flew up and is falling back. Otherwise a genuine drop keeps
        // free-falling — the hand is still accelerating away below it, so it must not re-seat.
        const handCanHold = this._hand(this.t).a >= -this.g;
        if (this.ballY <= line && (this.cleared || handCanHold)) {
          if (this.cleared) this._beginCatch(this.t, line);   // flew and came back -> CATCH it
          else this._beginSeat(this.t);                       // brief false release -> blend back onto the hand
        }
      }
      this._recordPos(this.x0, this.ballY, this.now);           // record EVERY frame → blur shows during the push + flight
      if (this.t >= this.tMove && this.attached && !this.catching && !this.seating && Math.abs(this.ballVy) < 1e-3) {
        this.running = false; this.y0 = this.ballY;             // settle + "walk"
      }
      if (this.ballY < this.focusY - HOUSE.frameH - 1) { this.running = false; }   // safety: fell far off-screen
    }

    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1);
        this.last = now;
        this._advance(dt);
      }
      this.render();
    }

    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      this._ticks();
      // Running: the hand follows its trajectory (the ball may separate). Idle: the hand simply cups the
      // ball wherever it rests, so nudging the a_max slider (or a finished run) never repositions the scene.
      // Through the CATCH the hand is not on its planned trajectory — it is under the ball, giving,
      // which is the whole point of the quintic. `_handTraj` still reports the release height there, so
      // reading it would leave the hand hanging while the ball sinks past it.
      const handY = !this.running ? this.ballY
                  : ((this.catching || this.seating) ? this.ballY : this._handTraj(this.t).y);
      this._drawHand(this.x0, handY - this.handGap);
      this._motionBlur(this.radius, k => this._posAtBack(k * HOUSE.blurDt * 1000));   // shared house blur model
      this._disc(this.x0, this.ballY, this.radius, HOUSE.mass, 1);
      this._arrow(this.x0, this.ballY, 0, -this._flen(this.mass * this.g), HOUSE.gravity, 1);   // weight, down
      let acc, N;
      if (this.catching) { acc = this.catchA || 0; N = this.mass * (this.g + acc); }               // the give: F_N = m(g+a), a < 0
      else if (this.seating) { acc = this.seatA || 0; N = this.mass * (this.g + acc); }             // landing back on the hand
      else if (this.attached) { acc = (this.running && !this.caught) ? this._hand(this.t).a : 0; N = this.mass * (this.g + acc); }
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
        // `dragSpanY` rather than a hard 3: a subclass that reserves part of the canvas for a graph
        // sees a shorter world, and a clamp written for the full-height framing would let the ball be
        // dragged out of its own play area.
        const span = this.dragSpanY || 3;
        this.y0 = Math.max(this.focusY - span, Math.min(this.focusY + span, w.y));
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

  // Class K drag controls: exactly the two sliders that make up beta — shape and size. They are two
  // ways of changing one number (the readout shows beta itself), which is the point of lumping them.
  const DRAG_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>C</i><sub>d</sub>:</span> <input type="range" class="s-cd" min="0" max="1.5" step="0.05"><input type="number" class="n-cd" step="0.05"></label>
        <label><span class="var"><i>A</i><sub>⊥</sub>:</span> <input type="range" class="s-area" min="0.1" max="1" step="0.05"><input type="number" class="n-area" step="0.05"><span class="u">m²</span></label>
      </div>`;

  // Same two sliders on the wide 2-D frame; area in cm² because the object is a ball, not a skydiver.
  const DRAG_CONTROLS_2D_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>C</i><sub>d</sub>:</span> <input type="range" class="s-cd" min="0" max="1" step="0.05"><input type="number" class="n-cd" step="0.05"></label>
        <label><span class="var"><i>A</i><sub>⊥</sub>:</span> <input type="range" class="s-area" min="10" max="100" step="1"><input type="number" class="n-area" step="1"><span class="u">cm²</span></label>
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
  // Its own controls and its own mount, rather than a branch inside mountHandLift: the slider asks for
  // a different quantity in a different unit, there is a Reset button, and Play can be disabled. Class C's
  // path is left exactly as it was.
  const HAND_ENERGY_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var">max <i>ẏ</i>:</span> <input type="range" class="s-vmax" step="0.1"><input type="number" class="n-vmax" step="any"><span class="u">m/s</span></label>
      </div>`;

  function mountHandLiftEnergy(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", HAND_ENERGY_CONTROLS_HTML);
    const d = section.dataset;
    const canvas = section.querySelector(".simcanvas");
    const sim = new HandLiftEnergy(canvas, {
      vMax:   d.vmax  !== undefined ? +d.vmax  : 0,
      g:      d.g     !== undefined ? +d.g     : 9.8,
      y0:     d.y0    !== undefined ? +d.y0    : undefined,
      focusY: d.focus !== undefined ? +d.focus : undefined,
      slomo:  d.slomo === "true"                       // OFF unless a slide asks for it
    });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = q(".s-vmax"), num = q(".n-vmax");
    rng.min = -HandLiftEnergy.V_MAX; rng.max = HandLiftEnergy.V_MAX;
    const clamp = v => Math.max(+rng.min, Math.min(+rng.max, v));
    rng.value = sim.vMax; num.value = sim.vMax;

    const playBtn = q(".play"), resetBtn = q(".reset");
    // Play is dead at a standstill. Without this the old sim happily "ran" a zero-speed push: nothing
    // moved for a beat and then the controls came back, which reads as a bug rather than as a no-op.
    const refreshPlay = () => {
      playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause");
      const dead = !sim.running && !sim.canPlay;
      playBtn.disabled = readonly || dead;
      playBtn.style.opacity = dead ? ".35" : "";
      playBtn.title = dead ? "set a speed first" : "";
    };
    sim.refreshPlayBtn = refreshPlay;

    // Only commit between runs — changing the speed mid-flight would rewrite the trajectory under the
    // graph that is being drawn from it.
    const apply = () => { if (!sim.running) { sim.setV(+rng.value); sim.cal = null; sim.render(); refreshPlay(); } };
    rng.addEventListener("input", () => { num.value = rng.value; apply(); });
    num.addEventListener("input", () => { const v = parseFloat(num.value); if (isNaN(v)) return; rng.value = clamp(v); apply(); });
    num.addEventListener("change", () => { const v = parseFloat(num.value); num.value = isNaN(v) ? rng.value : clamp(v); rng.value = num.value; apply(); });

    playBtn.addEventListener("click", () => {
      if (!sim.running) { sim.setV(+rng.value); sim.play(); }
      else if (sim.paused) sim.resume(); else sim.pause();
      refreshPlay();
    });
    // Reset earns its place here and nowhere else: a slow lift runs for seconds, and without this you
    // are stuck watching one you have already changed your mind about.
    resetBtn.addEventListener("click", () => { sim.reset(); refreshPlay(); });

    const slo = q(".slomo"); slo.classList.toggle("on", sim.slomo);
    slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); });
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); if (!sim.running) sim.render(); });
    if (readonly) {
      canvas.style.pointerEvents = "none";
      [playBtn, resetBtn, slo, rt, rng, num].forEach(el => { if (el) el.disabled = true; });
      const ctrls = q(".simctrls"); if (ctrls) ctrls.style.opacity = ".4";
    }
    refreshPlay();
    // deck.js calls resize / render / start on slide entry and stop on exit — the same rAF wiring every
    // other mount in this file attaches by hand. It is a contract, not a base-class method.
    let raf = null, prev = sim.running;
    sim.start = () => {
      if (raf) return;
      const loop = (now) => {
        sim.step(now);
        if (sim.running !== prev) { prev = sim.running; refreshPlay(); }
        raf = requestAnimationFrame(loop);
      };
      sim.last = performance.now();
      raf = requestAnimationFrame(loop);
    };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    return sim;
  }

  function mountHandLift(section, Klass) {
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
    const sim = new (Klass || HandLift)(canvas, opts);
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = q(".s-amax"), num = q(".n-amax");
    const clamp = v => Math.max(+rng.min, Math.min(+rng.max, v));
    // The energy variant shows a FIXED slice of world height (so the scene is not shrunk by the graph
    // strip), which means a full +/-25 m/s^2 throw would leave the top of the frame. +/-15 keeps every
    // setting on screen and still spans the three regimes the slide is about: in-contact, thrown, dropped.
    if (sim instanceof HandLiftEnergy) { rng.min = -HandLiftEnergy.A_MAX; rng.max = HandLiftEnergy.A_MAX; }
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

  // ---- HandLiftEnergy: the same hand, with a live energy graph -------------------------------
  // Class J's slide. The hand and its physics are HandLift's, unchanged; what is added is a stacked
  // energy strip underneath, on the same graph.stack_* tokens a baked energy-graph slide uses, so the
  // live strip lands exactly where students have seen every strip land all term.
  //
  // WHY THIS IS SIMPLER THAN LauncherGame, the only other sim with a live graph. LauncherGame must
  // SCROLL, because the student keeps interacting with it and the record has no end. This one does
  // not: the slider is committed at Play (mountHandLift has always frozen it mid-run) and nothing the
  // student does after that changes the trajectory. The run is therefore fully determined the moment
  // Play is pressed — so it is precomputed there, and BOTH AXES ARE FIXED FROM FRAME ZERO. The bands
  // simply fill in left to right against axes that never move. An axis that rescales mid-run silently
  // redefines "tall," which is precisely the reading this slide is asking for.
  //
  // The graph carries two bands only. Blue is kinetic; red is gravitational potential; there is no
  // spring anywhere in this problem, so there is no green — and no lid line, per the house default:
  // the total is the stack's own top edge, and tracing it reads as a separate quantity that happens to
  // be constant, which is the opposite of today's message.
  //
  // The gravitational datum is the LOWEST point the run reaches, so U >= 0 and the stack never has to
  // render a negative band. That is a choice of origin and nothing else — only differences in U mean
  // anything — but it has to be made once and held for the whole run, or the lid would move for a
  // reason that is not physics.
  class HandLiftEnergy extends HandLift {
    constructor(canvas, opts = {}) {
      // focusY is both the ball's rest height and the center of the view, so defaulting it here moves
      // the scene down to where the asymmetric motion actually sits. A slide can still override it
      // with data-focus.
      super(canvas, Object.assign({}, opts, { focusY: opts.focusY ?? HandLiftEnergy.REST_Y }));
      this.run = null;           // the precomputed run — the ONE trajectory, and what the graph draws
      this.cal = null;           // the frozen axis: { y0, yDatum, eMax } — see _calibrate()
      // Slo-mo OFF by default here, unlike every other sim: the durations ARE the physics now, and a
      // 0.16x rate would turn the slowest lift into half a minute.
      this.slomo = !!opts.slomo;
      this.setV(opts.vMax ?? 0);
      this.resize();
      this.render();
    }

    // ---- framing: hand on top, energy strip beneath it, control bar beneath THAT ------------------
    // Daniel's order, and it puts the controls back where every other sim in the course keeps them.
    // The bar is a sibling DOM element overlaying the canvas, so its height is measured rather than
    // assumed — it wraps at narrow widths, and a hard-coded reserve would be wrong exactly then.
    resize() {
      const dpr = window.devicePixelRatio || 1;
      const w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      const bar = this.c.parentElement && this.c.parentElement.querySelector(".simctrls");
      const ctrlH = bar ? bar.offsetHeight : h * 0.12;
      const gap = h * (HOUSE.stackGapPct / 100);
      this.gh = h * HOUSE.stackGraphH;
      this.gy = h - ctrlH - gap - this.gh;
      this.playH = this.gy - gap;
      // The play area shows a FIXED slice of world height instead of being scaled by whatever height is
      // left over. Left to `playH / frameH` the whole scene shrank by the size of the graph strip, which
      // is how it came to read small; pinning the slice keeps the ball and the hand at very nearly the
      // size Class C draws them. The slider is narrowed to match (see mountHandLift) so the motion still
      // fits the slice at every setting.
      this.scale = Math.min(w / HOUSE.frameW, this.playH / HandLiftEnergy.PLAY_WORLD_H);
      this.ox = (w - HOUSE.frameW * this.scale) / 2;
      // Half the world height actually visible, less a margin for the ball and its weight arrow — the
      // bound the drag clamp uses, so the ball cannot be parked behind the graph or off the top.
      this.dragSpanY = Math.max(0.5, (this.playH / this.scale) / 2 - 0.9);
    }
    // focusY sits at the center of the PLAY AREA, not of the canvas...
    sy(y) { return this.playH / 2 - (y - this.focusY) * this.scale; }
    // ...and the inverse has to agree, or drag-to-reposition puts the ball somewhere else. SimBase's
    // version inverts the canvas-centered sy; this one inverts the play-area-centered sy. Without it
    // the hand jumped on every pointerdown.
    _toWorldCentered(ev) {
      const r = this.c.getBoundingClientRect();
      const px = (ev.clientX - r.left) / r.width * this.W, py = (ev.clientY - r.top) / r.height * this.H;
      return { x: (px - this.ox) / this.scale, y: this.focusY + (this.playH / 2 - py) / this.scale };
    }

    // Fixed travel, speed-driven duration. Overrides HandLift's fixed-duration / acceleration-driven
    // version; everything downstream (`_handTraj`, the release test, the catch, the re-seat) is written
    // against `_hand`'s output and needs no change.
    _hand(t) {
      const H = HandLiftEnergy.TRAVEL, v = this.vMax || 0;
      if (!v) return { y: this.y0, vy: 0, a: 0 };
      const T = this.tMove, rise = (v < 0 ? -1 : 1) * H;
      if (t <= 0) return { y: this.y0, vy: 0, a: 0 };
      if (t >= T) return { y: this.y0 + rise, vy: 0, a: 0 };
      const s = t / T;
      const S  = 6 * s ** 5 - 15 * s ** 4 + 10 * s ** 3;
      const S1 = 30 * s ** 4 - 60 * s ** 3 + 30 * s ** 2;
      const S2 = 120 * s ** 3 - 180 * s ** 2 + 60 * s;
      return { y: this.y0 + rise * S, vy: rise * S1 / T, a: rise * S2 / (T * T) };
    }

    // The one place vMax is set, because tMove has to move with it. max S' = 15/8, so
    // T = 1.875*H/|v| is exactly the duration whose peak speed is the one asked for.
    setV(v) {
      this.vMax = v;
      const mag = Math.max(Math.abs(v), 1e-6);
      this.tMove = 1.875 * HandLiftEnergy.TRAVEL / mag;
      return this;
    }
    get canPlay() { return Math.abs(this.vMax || 0) >= HandLiftEnergy.V_MIN; }

    _energyAt(y, vy, yDatum) {
      return { ke: 0.5 * this.mass * vy * vy, gpe: this.mass * this.g * (y - yDatum) };
    }

    // Run the whole trajectory before showing any of it, driving the SAME `_advance` the live loop
    // drives — the physics exists in one place. State is snapshotted and restored around it.
    //
    // What is kept is the whole banded record, not just the axes. The first version graphed samples
    // taken LIVE and only took the axes from here, which sounds harmless and is not: the live loop
    // steps at whatever dt requestAnimationFrame hands it (times the slo-mo factor) while this steps at
    // a fixed 1/240, so the two Euler integrations drift apart. The live path could then dip below this
    // pass's y-minimum — a negative U, drawn as a band hanging under the time axis — and outlast this
    // pass's duration, with every late sample clamped onto the right edge as a vertical wedge. Both are
    // visible in Daniel's screenshot. Drawing the precomputed record and revealing it by time removes
    // the disagreement rather than clamping it, and it is what a baked energy clip does with `still=`.
    _precompute() {
      const cal = this._calibrate();
      const { path } = this._probe(this.vMax);
      // Thin to a drawable number of points — 900 is well past one per pixel of the strip's width.
      const STRIDE = Math.max(1, Math.ceil(path.length / 900));
      const t = [], ke = [], gpe = [];
      const push = p => {
        const e = this._energyAt(p.y, p.vy, cal.yDatum);
        t.push(p.t); ke.push(e.ke); gpe.push(Math.max(0, e.gpe));
      };
      for (let i = 0; i < path.length; i += STRIDE) push(path[i]);
      const last = path[path.length - 1];
      if (t[t.length - 1] < last.t) push(last);
      // BOTH axes come from the calibration, and the time axis is the one that makes the slide work.
      // Now that every run covers the same distance, the lid ends at the same height for every speed
      // below the release threshold — same work — and the ONLY difference is how long it took. Stretch
      // each run to fill the strip and that difference vanishes: slow and fast come out as identical
      // pictures. At fixed seconds-per-pixel the slow lift fills the strip and is shallow, the fast one
      // ends a fifth of the way across and is steep, and the slope is the power. A fast run leaving
      // most of the strip empty is not a bug here; it is the measurement.
      this.run = { t, ke, gpe, dur: cal.dur, eMax: cal.eMax };
    }

    // Run one trajectory at a given a_max from the CURRENT rest height, with nothing drawn and nothing
    // left behind, and report what it reached. The shared probe behind both _precompute and _calibrate.
    _probe(vMax) {
      const keep = ["t", "now", "ballY", "ballVy", "attached", "caught", "detached", "cleared",
                    "noRelease", "catching", "catchT0", "catchY0", "catchV0", "catchY1", "catchDur",
                    "catchA", "detachT", "detachY", "detachV", "running", "y0", "aMax",
                    "vMax", "tMove", "seating", "seatA"];
      const save = {}; for (const k of keep) save[k] = this[k];
      const savePos = this.posHist.slice();
      this.setV(vMax); this._resetState(); this.running = true;
      const dt = 1 / 240, LIMIT = 240 * 15;
      const path = [{ t: 0, y: this.ballY, vy: this.ballVy }];
      let yMin = this.ballY, guard = 0;
      while (this.running && guard++ < LIMIT) {
        this._advance(dt);
        if (this.ballY < yMin) yMin = this.ballY;
        path.push({ t: this.t, y: this.ballY, vy: this.ballVy });
      }
      for (const k of keep) this[k] = save[k];
      this.posHist = savePos;
      return { path, yMin };
    }

    // ONE FROZEN AXIS PER SIGN of a_max — Daniel's refinement, and it uses the strip far better than a
    // single axis did.
    //
    // The problem with one axis for everything is the DATUM. A drop needs the datum at the deepest point
    // the ball can be driven to, or U goes negative; but then a lift — which never goes below the rest
    // height at all — inherits that whole offset as a constant red base. It was eating about 55% of the
    // strip on every positive run, so a gentle push moved the lid by a few percent of the picture.
    //
    // Split by sign and each branch gets the datum it actually needs. **Lifts measure from the rest
    // height**, so U starts at zero and the entire strip is the work being done — which is the thing the
    // slide is about. **Drops measure from the deepest reachable point**, as before. Runs stay comparable
    // within the branch being demonstrated, which is how the slide is used: you sweep the lifts against
    // each other, or the drops against each other, not one against the other.
    //
    // Worth saying out loud in class, because it IS a real choice and not a trick: only differences in U
    // mean anything, so where zero sits is ours to pick — and we pick it where it makes the picture
    // legible. The lift branch takes min(rest height, deepest reached) rather than the rest height
    // outright, because the catch's give can in principle end a throw slightly below where it started;
    // in practice they are the same number.
    _calibrate() {
      const sign = (this.vMax || 0) < 0 ? -1 : 1;
      if (this.cal && Math.abs(this.cal.y0 - this.y0) < 1e-9 && this.cal.sign === sign) return this.cal;
      const V = HandLiftEnergy.V_MAX, VMIN = HandLiftEnergy.V_MIN;
      // V_MIN is in the probe set on purpose: it is the SLOWEST run the branch allows and therefore the
      // one that sets the time axis. The fastest sets the energy axis.
      const probes = [V, V * 0.6, V * 0.3, VMIN].map(f => sign * Math.max(f, VMIN));
      let yDatum = this.y0, runs = [];
      for (const a of probes) { const r = this._probe(a); runs.push(r); yDatum = Math.min(yDatum, r.yMin); }
      let eMax = 0, durMax = 0;
      for (const r of runs) {
        durMax = Math.max(durMax, r.path[r.path.length - 1].t);
        for (const p of r.path) {
          const e = this._energyAt(p.y, p.vy, yDatum);
          eMax = Math.max(eMax, e.ke + Math.max(0, e.gpe));
        }
      }
      this.cal = { y0: this.y0, sign, yDatum, eMax: Math.max(eMax, 1e-6) * 1.06,
                   dur: Math.max(durMax, 0.4) * 1.04 };
      return this.cal;
    }

    play()  { if (!this.canPlay) return; super.play(); this._precompute(); }
    reset() { this.run = null; super.reset(); }

    _graph(ctx) {
      const x0 = this.W * 0.062, x1 = this.W * 0.985;
      const gy = this.gy, gh = this.gh, ay = gy + gh;
      // Axes are drawn from frame zero, before there is any data — the point of a fixed frame is that it
      // is visibly fixed, so the bands grow into a picture whose scale never moved.
      ctx.save(); ctx.strokeStyle = HOUSE.ink; ctx.fillStyle = HOUSE.ink;
      ctx.lineWidth = 2; ctx.lineCap = "butt";
      ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x0, ay - gh * 0.45); ctx.stroke();
      ctx.font = (HOUSE.sizeCaption * this.H * 0.85) + "px " + HOUSE.fontSans;
      ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.fillText("time", x0 + this.W * 0.022, ay + 4);
      ctx.save(); ctx.translate(x0 - 6, ay - gh * 0.225); ctx.rotate(-Math.PI / 2);
      ctx.textBaseline = "bottom"; ctx.fillText("energy", 0, 0); ctx.restore();
      ctx.restore();

      const timeAxis = () => {
        ctx.save(); ctx.strokeStyle = HOUSE.ink; ctx.lineWidth = 2; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(x0, ay); ctx.lineTo(x1, ay); ctx.stroke(); ctx.restore();
      };
      const R = this.run;
      if (!R) { timeAxis(); return; }

      // Reveal up to the live clock, with the leading edge interpolated so the bands grow smoothly
      // rather than in one-sample steps.
      const tNow = Math.min(this.t, R.t[R.t.length - 1]);
      let n = 0; while (n < R.t.length && R.t[n] <= tNow) n++;
      if (n < 2) { timeAxis(); return; }

      const yOf = v => ay - Math.max(0, Math.min(1, v / R.eMax)) * gh;
      const xOf = t => x0 + Math.max(0, Math.min(1, t / R.dur)) * (x1 - x0);
      const at = (arr, i) => arr[i];
      const edge = (arr) => {                       // linear interpolation to exactly tNow
        if (n >= R.t.length) return arr[arr.length - 1];
        const t0 = R.t[n - 1], t1 = R.t[n], f = t1 > t0 ? (tNow - t0) / (t1 - t0) : 0;
        return arr[n - 1] + f * (arr[n] - arr[n - 1]);
      };
      const bands = [
        { col: HOUSE.velocity, top: i => at(R.ke, i),                  edge: () => edge(R.ke) },
        { col: HOUSE.gravity,  top: i => at(R.ke, i) + at(R.gpe, i),   edge: () => edge(R.ke) + edge(R.gpe) }
      ];
      // Painter's order, lowest band LAST — adjacent bands then share no edge against the background,
      // so there is no antialiased seam. Same rule the baked renderer follows.
      for (let bi = bands.length - 1; bi >= 0; bi--) {
        const b = bands[bi];
        ctx.save(); ctx.fillStyle = b.col;
        ctx.beginPath(); ctx.moveTo(xOf(R.t[0]), ay);
        for (let i = 0; i < n; i++) ctx.lineTo(xOf(R.t[i]), yOf(b.top(i)));
        ctx.lineTo(xOf(tNow), yOf(b.edge()));
        ctx.lineTo(xOf(tNow), ay); ctx.closePath(); ctx.fill();
        ctx.restore();
      }
      timeAxis();   // over the fills, so the baseline is one even rule
    }

    render() {
      super.render();
      this._graph(this.ctx);
    }
  }
  // Slider bound, play-area world height, and rest position — one set of numbers, all three measured
  // together from a headless sweep rather than guessed, and they have to move together.
  //
  // At +/-15 the ball never left y in [0.56, 3.01] and there was no throw worth watching. At +/-22 the
  // excursion is about 4.25 m, so the play area has to show more world, and showing more world costs
  // drawn size: 5.6 m puts this at ~80 px/m against Class C's 90, i.e. about 11% smaller. That is the
  // trade Daniel asked for — a real throw is worth more here than matching Class C exactly, because
  // this slide is about watching the lid move and Class C's is about the normal force.
  //
  // The rest position drops to 1.8 because the motion is NOT symmetric about the start: a throw climbs
  // roughly twice as far as a drop falls, so centering the view on the old y = 2 wasted the top of the
  // frame. `focusY` is both the rest height and the center of the view, so moving it does both at once.
  // Re-measure all three before changing any of them, or before changing tMove.
  // The hand's travel is the same every run — that is the whole point of this variant — and the slider
  // asks for a peak SPEED, from which the duration follows. V_MIN is not decoration: T = 1.875*H/|v|, so
  // a speed of 0.2 m/s would be an eleven-second animation. Below V_MIN, Play is off.
  HandLiftEnergy.TRAVEL = 1.2;      // metres the hand moves, every time
  HandLiftEnergy.V_MAX  = 5;        // slider bound, m/s
  HandLiftEnergy.V_MIN  = 0.8;      // below this, Play is disabled (longest run ~2.8 s)
  HandLiftEnergy.A_MAX = 22;        // kept: HandLift's own slider bound, unused by this preset
  HandLiftEnergy.PLAY_WORLD_H = 5.6;
  HandLiftEnergy.REST_Y = 1.8;

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
      this.mass = opts.mass ?? 0.145;      // a baseball — sized so real ball drag lands in the slider's middle
      this.beta = opts.beta ?? 0;          // ½rho·C_d·A_perp [kg/m], read LIVE off the sliders
      this.dragMode = !!opts.dragMode;     // as in Projectile: capability, not current beta
      this.lockVec = !!opts.lockVec;       // Class K locks speed + angle so only drag varies
      this.st = null; this.hist = null;
      this.area = opts.area ?? 42e-4;      // A_perp [m²], mirrored from the slider so the DISC can track it
      this.areaRef = opts.areaRef ?? 42e-4;// a real baseball — drawn at exactly house size
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
    // Same rule as the 1-D drag sim: A_perp = pi r^2, so the disc tracks sqrt(A), bounded to
    // [0.5, 1.75] x house size. Worth doing here too — on this frame the ball is ~13 px, not the
    // couple of pixels it looks like it should be, so the change reads clearly.
    get radius() {
      const base = HOUSE.baseRadius * this.frameH / cnum("--frame-h", 8);
      if (!this.dragMode) return base;
      const f = Math.sqrt(Math.max(this.area, 1e-9) / Math.max(this.areaRef, 1e-9));
      return base * Math.min(Math.max(f, 0.5), 1.75);
    }
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
    pos(t) { const L = this.L; if (!L) return { x: this.x0, y: this.y0 };
             if (this.dragMode) { const s = histAt(this.hist, t); return s ? { x: s.x, y: s.y } : { x: L.x0, y: L.y0 }; }
             return { x: L.x0 + L.u0 * t, y: L.y0 + L.v0 * t - 0.5 * L.g * t * t }; }
    velY(t) { const L = this.L; if (!L) return this.v0;
              if (this.dragMode) { const s = histAt(this.hist, t); return s ? s.v : L.v0; }
              return L.v0 - L.g * t; }
    velX(t) { const L = this.L; if (!L) return this.u0;
              if (this.dragMode) { const s = histAt(this.hist, t); return s ? s.u : L.u0; }
              return L.u0; }
    get vTerm() { return this.beta > 0 ? Math.sqrt(this.mass * this.g / this.beta) : Infinity; }
    play() {
      this.L = { x0: this.x0, y0: this.y0, u0: this.u0, v0: this.v0, g: this.g };
      if (this.dragMode) {                                  // landing is detected live, not solved for
        this.st = { x: this.x0, y: this.y0, u: this.u0, v: this.v0 };
        this.hist = [{ t: 0, x: this.x0, y: this.y0, u: this.u0, v: this.v0 }];
        this.tLand = Infinity;
      } else {
        this.tLand = this._landTime(this.y0, this.v0, this.g);
      }
      this.t = 0; this.running = true; this.paused = false; this.landed = false;
      this.everPlayed = true; this.last = performance.now();
    }
    reset() { this.running = false; this.paused = false; this.landed = false; this.t = 0; this.render(); }
    // pause / resume inherited from SimBase
    step(now) {
      if (this.running && !this.paused) {
        const dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1);  // real-time by default; slomoFactor=0.5 when slo-mo is on
        this.last = now; this.t += dt;
        if (this.dragMode) {
          dragAdvance(this.st, this.hist, this.t, dt, this.L.g, this.beta / this.mass);
          if (this.st.y <= this.L.y0 && this.st.v < 0) { this.running = false; this.landed = true; this.tLand = this.t; }
        } else if (this.t >= this.tLand) { this.t = this.tLand; this.running = false; this.landed = true; }
      }
      this.render();
    }
    // The blue tick + label on the ground line marking where this shot lands. It is the number the
    // slide is arguing about on every projectile2d beat, so it belongs to the base class rather than
    // to the pair sim that first grew it. Sized off the CANVAS, not the world, for the same reason as
    // the arrowheads: it is a property of the picture. Skipped under drag, where the landing point is
    // not analytic and `_refLanding` already marks the drag-free reference.
    _rangeTick(range) {
      const ctx = this.ctx, X = this.sx(range), Y = this.sy(0);
      if (!isFinite(X) || X > this.W + 40) return;
      const half = Math.max(this.H * 0.022, 10);
      ctx.save();
      ctx.strokeStyle = HOUSE.velocity; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.setLineDash([]);
      ctx.globalAlpha = 0.9;
      ctx.beginPath(); ctx.moveTo(X, Y - half); ctx.lineTo(X, Y + half); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = HOUSE.muted;
      ctx.font = `600 ${Math.max(11, Math.round(this.H * 0.026))}px ${HOUSE.fontSans}`;
      // ABOVE the ground line: below it is the control bar's 140 px, which covered the label outright.
      ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      ctx.fillText(`${range.toFixed(0)} m`, X, Y - half - 20);
      ctx.restore();
    }
    _velTip() { return { x: this.x0 + this.u0 * this.velWorldPerMS, y: this.y0 + this.v0 * this.velWorldPerMS }; }
    _velShown() { return !this.running && !this.landed && (Math.abs(this.u0) > 0.01 || Math.abs(this.v0) > 0.01); }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H); this._axes();
      const active = this.running || this.landed;
      const src = active ? this.L : { x0: this.x0, y0: this.y0, u0: this.u0, v0: this.v0, g: this.g };
      // The faint dashed path is ALWAYS the drag-free parabola — it is the reference the real
      // (solid, integrated) trail is being compared against, so it must not use the live tLand.
      const tEnd = (active && !this.dragMode) ? this.tLand : this._landTime(src.y0, src.v0, src.g);
      ctx.save(); ctx.globalAlpha = 0.32; this._path(src, 0, tEnd, HOUSE.velocity, 2, [9, 8]); ctx.restore();   // dashed velocity-blue predicted parabola (house style: optional prediction)
      if (this.dragMode) this._refLanding(src, tEnd);   // ...and make sure it visibly lands
      if (!this.dragMode && src.g > 0) { const R = src.x0 + src.u0 * tEnd; if (R > 0.5) this._rangeTick(R); }
      const tNow = active ? Math.min(this.t, this.tLand) : 0;
      if (active) this._trail(src, tNow);                                      // white fading trajectory (house style)
      if (active) this._motionBlur(this.radius, k => { const tk = tNow - k * HOUSE.blurDt; return tk < 0 ? null : this.pos(tk); });
      const p = active ? this.pos(tNow) : { x: this.x0, y: this.y0 };
      if (this._velShown()) this._velArrow(this.x0, this.y0, this.u0, this.v0);
      this._disc(p.x, p.y, this.radius, HOUSE.mass, 1);
      if (src.g > 0) this._arrow(p.x, p.y, 0, -this._forceLen(src.g), HOUSE.gravity, 1);
      if (this.beta > 0) {                                        // amber drag, opposite the motion
        const st = active ? { u: this.velX(tNow), v: this.velY(tNow) } : { u: src.u0, v: src.v0 };
        const sp = Math.hypot(st.u, st.v);
        if (sp > 1e-6) {
          const len = this._forceLen(this.beta * sp * sp / this.mass);
          this._arrow(p.x, p.y, -st.u / sp * len, -st.v / sp * len, HOUSE.friction, 1);
        }
      }
      if (this.showReadout) this._readout(p);
    }
    _trail(src, tNow) {                              // white fading trajectory: last trailFadeS s of the analytic path
      const fade = HOUSE.trailFadeS, t0 = Math.max(0, tNow - fade);
      if (tNow - t0 < 1e-3) return;
      const N = 40, pts = [];
      for (let i = 0; i <= N; i++) {
        const t = t0 + (tNow - t0) * i / N;
        // The SOLID trail is the real path (integrated when drag is on); the faint dashed _path stays
        // analytic on purpose — it is the drag-free parabola the shot is being compared against.
        const q = this.dragMode ? (histAt(this.hist, t) || { x: src.x0, y: src.y0 })
                                : { x: src.x0 + src.u0 * t, y: src.y0 + src.v0 * t - 0.5 * src.g * t * t };
        pts.push({ x: this.sx(q.x), y: this.sy(q.y), t });
      }
      this._whiteTrail(pts, tNow, fade);             // one shared drawer; width/cap/alpha are house tokens
    }
    // The dashed reference is the drag-free parabola, and its END is the number the whole slide is
    // arguing about — the range this shot would have had with no air. A dashed stroke can finish
    // mid-gap, which left the curve hanging ~3 m above the ground line looking like it stopped short
    // (it did reach y = 0; the last ~11 px were simply in an "off" phase). So the final stretch is
    // redrawn solid, and the landing point gets a tick on the ground line.
    _refLanding(src, tEnd) {
      const ctx = this.ctx;
      ctx.save(); ctx.globalAlpha = 0.32;
      this._path(src, tEnd * 0.96, tEnd, HOUSE.velocity, 2, null);
      const X = this.sx(src.x0 + src.u0 * tEnd), Y = this.sy(src.y0);
      ctx.strokeStyle = HOUSE.velocity; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(X, Y - this.scale * 1.7); ctx.lineTo(X, Y + this.scale * 1.7); ctx.stroke();
      ctx.restore();
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
      if (this.beta > 0) {
        lines.push(`\u03b2 = ${this.beta.toExponential(1)} kg/m`);
        lines.push(`terminal = ${this.vTerm.toFixed(0)} m/s`);
      }
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
        if (this.running || this.lockVec) return; const w = toWorld(ev);   // lockVec: Class K fixes speed + angle
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
    // OPTIONAL data-speed / data-theta preload the launch vector. Omitted, the sim opens on the class
    // default — 40 m/s @ 45 deg, the world-record baseball throw — which is what every slide wanted until
    // Class D's `sim-2d-q2` needed to open on its comprehension check's own numbers instead.
    // KEEP THEM INTEGERS. The two sliders below step by 1, and the block right after this reads the sim's
    // u0/v0 back OUT into them, rounded; a preload the sliders cannot represent renders at one value and
    // then jumps to another the instant anyone touches a control or presses Play.
    if (d.speed !== undefined || d.theta !== undefined) {
      const sp = d.speed !== undefined ? +d.speed : 40;
      const th = (d.theta !== undefined ? +d.theta : 45) * Math.PI / 180;
      opts.u0 = sp * Math.cos(th); opts.v0 = sp * Math.sin(th);
    }
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
      // DAMPED variant (Class L, data-zeta): one slider, and it is the damping ratio. k and m are fixed
      // and hidden on purpose — the three regimes depend on zeta ALONE, and a student who can reach k
      // will reach for it instead of answering the question the board just posed.
      this.damped = !!opts.damped; this.zeta = opts.zeta ?? 0;
      this.d = 0;                       // displacement about the (gravity-shifted) equilibrium, meters
      this.v = 0;                       // damped variant only: integrated velocity, m/s
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
    get gamma() { return this.zeta * this.omega; }                          // decay rate, alpha/2m
    get alpha() { return 2 * this.zeta * Math.sqrt(this.k * this.mass); }   // the dimensional coefficient
    // The DAMPED frequency. The FormulaSheet writes it out rather than naming it: sqrt(w^2 - g^2).
    // Zero at and beyond critical, where there is no oscillation left to have a frequency.
    get omegaD() { return this.zeta < 1 ? this.omega * Math.sqrt(1 - this.zeta * this.zeta) : 0; }
    get regime() { return this.zeta === 0 ? "undamped"
                        : this.zeta < 0.999 ? "underdamped"
                        : this.zeta < 1.001 ? "critically damped" : "overdamped"; }
    get freq()  { return (this.damped ? this.omegaD : this.omega) / TAU; }
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
    reset() { this.d = 0; this.v = 0; this.amp = 0; this.phase = 0; this.oscillating = false; this.dragging = false;
              this.trace = []; this.simT = 0; this.running = true; this.paused = false; this.render(); }
    step(now) {
      if (this.running && !this.paused) {
        // dt is floored at 0 as well as capped: `reset()` does not touch `last`, so a caller that
        // restarts its own clock can hand this a NEGATIVE dt, and the damped branch integrates it —
        // one backwards step of a few seconds blows the oscillator up. The closed-form branch was
        // immune (it only advances a phase), which is why this never mattered before 2026-08-20.
        const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.05)) * (this.slomo ? this.slomoFactor : 1); this.last = now;
        this.simT += dt;
        if (this.damped) {
          // Integrated, not solved in closed form, for three reasons: zeta is dragged LIVE mid-motion
          // and a closed form would jump; the over/critical branches are different formulas; and the
          // same three lines cover all of them. Semi-implicit Euler, substepped so it stays stable at
          // high zeta (the decay time 1/gamma gets short fast).  d'' = -w^2 d - 2 zeta w d'
          if (this.oscillating && !this.dragging) {
            const w = this.omega, sub = Math.max(1, Math.ceil(dt / 0.002)), h = dt / sub;
            for (let i = 0; i < sub; i++) {
              this.v += (-w * w * this.d - 2 * this.zeta * w * this.v) * h;
              this.d += this.v * h;
            }
          }
        } else if (this.oscillating && !this.dragging) { this.phase += this.omega * dt; this.d = this.amp * Math.cos(this.phase); }
        this.trace.push({ t: this.simT, d: this.d });
        while (this.trace.length > 1 && this.massX - (this.simT - this.trace[0].t) * this.paperSpeed < -4) this.trace.shift();
      } else { this.last = now; }
      this.render();
    }
    _release() { this.amp = this.d; this.phase = 0; this.v = 0; this.oscillating = true; this.dragging = false; }   // released from REST at d, in both variants   // released from rest at d → cos phase starts at 0
    _bindDrag() {
      const toPx = (ev) => { const r = this.c.getBoundingClientRect(); return { x: (ev.clientX - r.left) / r.width * this.W, y: (ev.clientY - r.top) / r.height * this.H }; };
      const nearMass = (p) => Math.hypot(p.x - this.massX, p.y - this._massScreenY(this.d)) < Math.max(this.radius * this.scale * 1.8, 28);
      this.c.addEventListener("pointerdown", (ev) => { const p = toPx(ev);
        if (nearMass(p)) { this.dragging = true; this.oscillating = false; this.c.setPointerCapture?.(ev.pointerId); } });
      this.c.addEventListener("pointermove", (ev) => { if (!this.dragging) return; const p = toPx(ev);
        const d = (this.eqY0 - p.y) / this.pxPerM - this.xeq;
        this.d = Math.max(this.dMin, Math.min(this.dMax, d)); this.v = 0; this.render(); });
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
      // Damper force, amber (roles.friction — the same color as the heat band it produces, and the same
      // color Class K's drag arrow uses). Drawn opposite the motion, on the spring arrow's own force
      // scale, and from the CENTROID of the mass like every other force arrow (Daniel's rule,
      // 2026-08-20b — it shipped offset to the left for one afternoon and read as unattached).
      // Damped variant only, and it vanishes at the turning points — which is the whole point: a force
      // proportional to velocity takes nothing from a mass that is momentarily still. Drawn AFTER the
      // green spring arrow so that when the two point the same way the shorter one lands on top.
      if (this.damped && this.zeta > 0) {
        const fd = -this.alpha * this.v;                       // N, signed: + is up in world terms
        const lenPx = Math.abs(fd) / this.k * this.pxPerM;     // same N→px scale as the spring arrow
        if (lenPx > 1.5) this._arrow(this.massX, my, 0, -Math.sign(fd) * lenPx, HOUSE.friction, 1);
      }
      // NET force (spring + gravity) — WHITE, drawn just LEFT of the mass, ending exactly on the gravity-shifted
      // equilibrium (where the net force is zero). Gravity variant only. On the same force-scale as the green +
      // gravity arrows, so green(up) + gravity(down) = this white net vector — and it keeps the teaching beat of
      // a force arrow that points right at the equilibrium (which the green spring arrow, now referenced to the
      // spring's natural length, no longer does).
      // THE ONE STANDING EXCEPTION to "every force arrow starts at the centroid" (style/OBJECTS.md →
      // Force arrow). This is not a force ON the body, it is the SUM of the two that are, drawn beside
      // them so it can be compared with them, and it ends on the equilibrium. Moved to the centroid it
      // would sit exactly on top of the green spring arrow — the thing it exists to be read against.
      // Ruled by Daniel 2026-08-20; leave it to the side.
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
      const lines = this.damped
        ? [`ζ = ${this.zeta.toFixed(2)}`, this.regime,
           this.zeta < 1 ? `√(ω²−γ²) = ${this.omegaD.toFixed(2)} rad/s` : `no oscillation`]
        : [`f = ${this.freq.toFixed(2)} Hz`, `ω = ${this.omega.toFixed(2)} rad/s`];
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
  const OSC_D_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout on" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">⏸ Pause</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>ζ</i>:</span> <input type="range" class="s-zeta" min="0" max="3" step="0.01"><input type="number" class="n-zeta" step="0.01"><span class="u">damping ratio</span></label>
      </div>`;
  function mountOscillator(section) {
    const grav = section.dataset.gravity !== undefined;   // gravity variant: only a g slider (k & m fixed)
    const damp = section.dataset.zeta !== undefined;      // damped variant (Class L): only a zeta slider
    if (!section.querySelector(".simcanvas"))
      section.insertAdjacentHTML("beforeend", damp ? OSC_D_CONTROLS_HTML : grav ? OSC_G_CONTROLS_HTML : OSC_CONTROLS_HTML);
    const d = section.dataset;
    const canvas = section.querySelector(".simcanvas");
    const sim = new Oscillator(canvas, { k: d.k !== undefined ? +d.k : (grav ? 11 : 20), mass: d.mass !== undefined ? +d.mass : (grav ? 0.4 : 1), gravity: grav, g: 0,
                                         damped: damp, zeta: damp ? +d.zeta : 0 });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = {}, num = {};
    rng.k = q(".s-k"); num.k = q(".n-k");                 // present only in the free variant
    if (damp) { rng.zeta = q(".s-zeta"); num.zeta = q(".n-zeta"); }
    else if (grav) { rng.g = q(".s-g"); num.g = q(".n-g"); }
    else { rng.mass = q(".s-mass"); num.mass = q(".n-mass"); }
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    const apply = () => { if (rng.k) sim.k = +rng.k.value;
                          if (damp) sim.zeta = +rng.zeta.value; else if (grav) sim.g = +rng.g.value; else sim.mass = +rng.mass.value;
                          sim.render(); };
    if (rng.k) rng.k.value = sim.k;
    if (damp) rng.zeta.value = sim.zeta; else if (grav) rng.g.value = sim.g; else rng.mass.value = sim.mass;
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
    if (readonly) { canvas.style.pointerEvents = "none"; [playBtn, q(".reset"), slo, rt, netchk, rng.k, num.k, rng.mass, num.mass, rng.g, num.g, rng.zeta, num.zeta].forEach(el => { if (el) el.disabled = true; }); const c = q(".simctrls"); if (c) c.style.opacity = ".4"; }
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
      // NO CEILING. The axis is still frozen at eMax — a band's height means the same joules all the
      // way through — but a stack taller than eMax is drawn where it actually lands, climbing out of
      // the strip and up over the masses as resonance runs away. Clipping it at the top read as the
      // graph politely declining to answer; letting it swallow the animation is the honest picture,
      // and on this slide it is also the lesson (Daniel, 2026-08-26).
      const yOf = v => gy + gh - (v / this.eMax) * gh;
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

  // ============================================================================================
  // PIN-JOINTED PLATFORM FAMILY — PlatformBounce (Class H) and FrictionRamp (Class M).
  //
  // PlatformBounce arrived here on 2026-08-21, from `ClassH-Bouncing/gen/classH-sims.js`, where it
  // had been living since July behind a monkey-patch on `mount` with a TODO saying to fold it in.
  // The trigger was Class M needing the same platform: two copies of a pin joint is exactly the
  // drift this engine exists to prevent, so the class moved and Class H's local copy was deleted
  // (its file still owns WallBounce and FloorBounce, and still falls through to this dispatcher for
  // everything else — so Class H now runs the code below, unchanged in behavior).
  //
  // What the two share is the *stage*: a rigid bar on a center pin joint, click-draggable to any
  // angle within +/-60 degrees, with one slider mirroring the drag. What they do with it is opposite —
  // H drops a ball ONTO it, M puts a block ON it and asks when the block lets go — so FrictionRamp
  // extends PlatformBounce for the platform, the pin joint and the drag binding, and overrides
  // everything about the body.
  // ============================================================================================
  const D2R = Math.PI / 180;

  // Motion-blur sampler that returns null for phantom frames BEFORE the sim started (each play()
  // resets simMs to 0), so the after-images never POOL at the starting condition.
  const platBlurBack = (sim) => (kk) => {
    const b = kk * HOUSE.blurDt * 1000;
    return (sim.simMs - b < 0) ? null : sim._posAtBack(b);
  };

  class PlatformBounce extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas); this.discMinPx = 2;
      this.focusY = 0; this.pivX = HOUSE.frameW / 2; this.pivY = -1.6; this.halfLen = 2.6;
      this.angle = opts.angle ?? 22;                    // platform tilt, degrees, ±60
      this.minAngle = 1;                                // dead-zone: |angle| snaps up to this — keeps the shallow "walking" multi-bounce (≈3 at 1°) but drops the ~0° case that clips / smears vertically
      this.mass = opts.mass ?? 1; this.g = opts.g ?? 5.0; this.yStart = opts.yStart ?? 3.0;
      this.slomo = false; this.slomoFactor = 0.3; this.showReadout = false;
      this.running = false; this.paused = false; this.everPlayed = false;
      this.strike = null;                               // {x,y,nx,ny} recorded at the bounce (the actual strike point + normal)
      this.onAngleChange = null;
      this.resize(); this._bindDrag();
    }
    get radius() { return HOUSE.baseRadius * Math.cbrt(this.mass); }
    get phi() { return this.angle * D2R; }
    _tangent() { return { x: Math.cos(this.phi), y: Math.sin(this.phi) }; }
    _normal() { return { x: -Math.sin(this.phi), y: Math.cos(this.phi) }; }
    // contact: mass falls straight down through the pivot's x; it touches when its center is r/cosφ above pivot
    _contactY() { return this.pivY + this.radius / Math.cos(this.phi); }
    _impactSpeed() { return Math.sqrt(Math.max(0, 2 * this.g * (this.yStart - this._contactY()))); }
    _outVel() { const v = this._impactSpeed(); return { x: -v * Math.sin(2 * this.phi), y: v * Math.cos(2 * this.phi) }; }
    _snapAngle(a) { a = Math.max(-60, Math.min(60, a)); return Math.abs(a) < this.minAngle ? (a < 0 ? -this.minAngle : this.minAngle) : a; }   // snap out of the near-flat dead-zone
    // Whether a pointer-down may start an angle drag. PlatformBounce locks the platform at first
    // contact; FrictionRamp never locks it (see its override).
    _angleLocked() { return !!this.bounced; }
    play() { this.x = this.pivX; this.y = this.yStart; this.vx = 0; this.vy = 0; this.bounced = false;
             this.t = 0; this.simMs = 0; this.posHist = []; this._recordPos(this.x, this.y, 0);
             this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }
    reset() { this.running = false; this.paused = false; this.x = this.pivX; this.y = this.yStart; this.vx = 0; this.vy = 0; this.bounced = false; this.strike = null; this.render(); }
    _bindDrag() {
      let drag = false;
      const nearBar = (w) => {                          // distance from pointer to the platform line, within the bar span
        const t = this._tangent(), n = this._normal();
        const ox = w.x - this.pivX, oy = w.y - this.pivY;
        const along = ox * t.x + oy * t.y, perp = ox * n.x + oy * n.y;
        return Math.abs(perp) < 0.5 && Math.abs(along) < this.halfLen + 0.5;
      };
      const setFromPointer = (w) => {
        if (this._angleLocked()) return;                                // angle LOCKS at first contact (H only)
        let a = Math.atan2(w.y - this.pivY, w.x - this.pivX) / D2R;     // bar direction angle
        if (a > 90) a -= 180; else if (a < -90) a += 180;              // fold to a ±90 line orientation
        this.angle = this._snapAngle(a); if (this.onAngleChange) this.onAngleChange(this.angle);
      };
      this.c.addEventListener("pointerdown", (ev) => { if (this._angleLocked()) return;   // draggable while falling (quasi-static)
        const w = this._toWorldCentered(ev);
        if (nearBar(w)) { drag = true; setFromPointer(w); this.c.setPointerCapture?.(ev.pointerId); this.render(); } });
      this.c.addEventListener("pointermove", (ev) => { if (!drag) return; setFromPointer(this._toWorldCentered(ev)); this.render(); });
      window.addEventListener("pointerup", () => { drag = false; });
    }
    step(now) {
      if (this.running && !this.paused) {
        let dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1); this.last = now;
        const sub = 4; dt /= sub;
        for (let s = 0; s < sub; s++) {
          this.vy += -this.g * dt; this.x += this.vx * dt; this.y += this.vy * dt; this.simMs += dt * 1000;
          // elastic reflection — MULTIPLE bounces off the FINITE bar; the angle is frozen at first contact
          const n = this._normal(), t = this._tangent();
          const ox = this.x - this.pivX, oy = this.y - this.pivY;
          const perp = ox * n.x + oy * n.y, along = ox * t.x + oy * t.y;
          if (perp <= this.radius && Math.abs(along) <= this.halfLen) {   // within the bar's span (beyond the ends it passes through — a miss)
            const vn = this.vx * n.x + this.vy * n.y;
            if (vn < 0) {                                                 // moving INTO the surface → reflect (vn>0 already leaving → no re-trigger)
              this.vx -= 2 * vn * n.x; this.vy -= 2 * vn * n.y;           // reflect about the platform normal
              const pushOut = this.radius - perp; this.x += pushOut * n.x; this.y += pushOut * n.y;   // snap onto the surface (no sinking)
              if (!this.bounced) { this.bounced = true; this.strike = { x: this.x, y: this.y, nx: n.x, ny: n.y }; }   // FIRST contact: lock the angle + record the strike
            }
          }
        }
        this._recordPos(this.x, this.y, this.simMs, HOUSE.trailFadeS * 1000);
        if (this.y - this.radius < this.pivY - 5 || this.x < -1 || this.x > HOUSE.frameW + 1) { this.reset(); }   // fell off-screen → auto-reset (unlocks the platform angle + re-arms the drop)
      } else { this.last = now; }
      this.render();
    }
    _drawPlatform() {
      const ctx = this.ctx, t = this._tangent();
      const ax = this.sx(this.pivX - this.halfLen * t.x), ay = this.sy(this.pivY - this.halfLen * t.y);
      const bx = this.sx(this.pivX + this.halfLen * t.x), by = this.sy(this.pivY + this.halfLen * t.y);
      ctx.save(); ctx.strokeStyle = HOUSE.boundary; ctx.lineCap = "round"; ctx.lineWidth = Math.max(this.scale * 0.06, 4);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
      // 45° hatch on the underside (the -normal side)
      const n = this._normal(); const hatch = 0.26 * this.scale, gap = Math.max(this.scale * 0.42, 15);
      ctx.lineWidth = Math.max(this.scale * 0.03, 2.2);
      for (let s = -this.halfLen + 0.2; s <= this.halfLen - 0.1; s += gap / this.scale) {
        const px = this.pivX + s * t.x, py = this.pivY + s * t.y;
        ctx.beginPath(); ctx.moveTo(this.sx(px), this.sy(py));
        ctx.lineTo(this.sx(px - 0.28 * n.x) , this.sy(py - 0.28 * n.y)); ctx.stroke();
      }
      ctx.restore();
      this._drawPinJoint(this.sx(this.pivX), this.sy(this.pivY));       // hinge-style pin joint (ring + center dot)
    }
    // Pin joint à la X3-1_DoorHingeMid: a background-filled ring outlined in structural gray, plus a small
    // solid center dot — reads as a hinge knuckle sitting over the platform, not a crosshair.
    _drawPinJoint(cx, cy) {
      const ctx = this.ctx, R = Math.max(this.scale * 0.19, 6), ri = Math.max(this.scale * 0.06, 2.2);
      ctx.save();
      ctx.fillStyle = HOUSE.bg; ctx.strokeStyle = HOUSE.boundary; ctx.lineWidth = Math.max(this.scale * 0.028, 2);
      ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill(); ctx.stroke();      // bg-filled ring, gray outline
      ctx.fillStyle = HOUSE.boundary; ctx.beginPath(); ctx.arc(cx, cy, ri, 0, TAU); ctx.fill();   // solid center pin
      ctx.restore();
    }
    _drawPrediction() {
      const ctx = this.ctx;
      // strike point + platform normal: PREDICTED from the current angle before the bounce; the ACTUAL
      // recorded values after it (so rotating the platform post-bounce doesn't move the reflection axis).
      let sxp, syp, nx, ny;
      if (this.strike) { sxp = this.strike.x; syp = this.strike.y; nx = this.strike.nx; ny = this.strike.ny; }
      else { const n = this._normal(); sxp = this.pivX; syp = this._contactY(); nx = n.x; ny = n.y; }
      // (1) light-gray NORMAL line out of the platform at the strike point — angle in = angle out
      ctx.save(); ctx.strokeStyle = withAlpha(HOUSE.surface, 0.5); ctx.lineWidth = Math.max(this.scale * 0.016, 1.4);
      ctx.beginPath(); ctx.moveTo(this.sx(sxp - 0.35 * nx), this.sy(syp - 0.35 * ny));
      ctx.lineTo(this.sx(sxp + 3.0 * nx), this.sy(syp + 3.0 * ny)); ctx.stroke(); ctx.restore();
      // (2) dashed velocity-blue PREDICTED path — the FULL trajectory: free-fall drop + EVERY bounce off the
      //     bar (shallow angles bounce many times, walking along the platform before leaving its end). Stepped
      //     forward with the same reflection as the live sim, so it overlays the actual path exactly.
      {
        const nrm = this._normal(), tan = this._tangent(), r = this.radius, pdt = 0.01;
        ctx.save(); ctx.strokeStyle = withAlpha(HOUSE.velocity, 0.55); ctx.setLineDash([5, 6]);
        ctx.lineWidth = Math.max(this.scale * 0.02, 1.5); ctx.beginPath();
        let px = this.pivX, py = this.yStart, pvx = 0, pvy = 0, nb = 0;
        ctx.moveTo(this.sx(px), this.sy(py));
        for (let i = 0; i < 2400; i++) {
          pvy += -this.g * pdt; px += pvx * pdt; py += pvy * pdt;
          const ox = px - this.pivX, oy = py - this.pivY;
          const perp = ox * nrm.x + oy * nrm.y, along = ox * tan.x + oy * tan.y;
          if (perp <= r && Math.abs(along) <= this.halfLen) {            // reflect off the bar (within its span)
            const vn = pvx * nrm.x + pvy * nrm.y;
            if (vn < 0) { pvx -= 2 * vn * nrm.x; pvy -= 2 * vn * nrm.y; px += (r - perp) * nrm.x; py += (r - perp) * nrm.y; if (++nb > 30) break; }
          }
          ctx.lineTo(this.sx(px), this.sy(py));
          if (py - r < this.pivY - 5 || px < 0 || px > HOUSE.frameW) break;   // left the frame (or walked off the bar end and fell)
        }
        ctx.stroke(); ctx.restore();
      }
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      this._drawPrediction();                                          // behind everything
      this._drawPlatform();
      if (this.running) { this.now = this.simMs; this._motionBlur(this.radius, platBlurBack(this));
        // curved post-bounce path → white trail on
        const pts = []; const h = this.posHist || [];
        for (const p of h) pts.push({ x: this.sx(p.x), y: this.sy(p.y), t: p.t });
        this._whiteTrail(pts, this.simMs, HOUSE.trailFadeS * 1000);
        this._disc(this.x, this.y, this.radius, HOUSE.mass, 1);
      } else {
        this._disc(this.pivX, this.yStart, this.radius, HOUSE.mass, 1);
      }
    }
  }

  // ============================================================================================
  // FrictionRamp (data-sim="frictionramp") — Class M `sim-ramp`. A teethed block on the pin-jointed
  // platform: tip it and static friction grows to hold the block, tip past atan(mu_s) and the teeth
  // lift, the block slides, and the amber arrow SHRINKS to mu_k·|F_N|. Two live sliders, mu_s and
  // mu_k. The baked prototype is the retired quarry's `animations/scripts/tilt-ramp.py`; the block
  // anatomy (teeth buried while stuck, lifted by tooth_h once sliding) is OBJECTS.md's teethed
  // friction block, and physanim draws exactly the same object with `velocity_lift`.
  //
  // FOUR THINGS THAT ARE LOAD-BEARING, all of them learned somewhere else in this engine first:
  //
  // 1. THE INTEGRATOR RE-READS THE SLIDERS EVERY SUBSTEP. mu_s/mu_k are read inside `step()`, never
  //    captured at play(). This is the Class K drag trap verbatim (DESIGN.md "Quadratic drag"):
  //    precomputing the motion froze it on a snapshot while render() kept reading the slider live,
  //    so the arrow grew on a ball that visibly did not care. If a slider can change the force, the
  //    integrator has to read that slider.
  // 2. THE BLOCK IS PINNED TO THE SURFACE. Its state is (s, vs) — distance and speed ALONG the
  //    platform — not a free (x,y). So yanking the angle can never launch it: the worst a fast drag
  //    can do is change which way it slides. It becomes a free projectile at exactly one moment,
  //    when |s| passes halfLen and it leaves the end. Daniel's ask, and also the only version that
  //    survives a room watching someone scrub the slider.
  // 3. STICK IS A STATE, NOT A SMALL VELOCITY. Coulomb friction integrated naively chatters around
  //    v = 0 forever. Here `sliding` is an explicit flag: it goes true when |F_par| exceeds
  //    mu_s·|F_N|, and false again when the block's velocity crosses zero AND the static condition
  //    holds at that instant. That is also what makes the arrow honest — while stuck, friction is
  //    drawn as exactly -F_par (whatever it has to be), and only while sliding is it mu_k·|F_N|.
  // 4. IT RUNS ON MOUNT. Every other preset waits for Play, because every other preset is a launch.
  //    This one is a tilt table: the whole slide is Daniel dragging the bar and narrating what the
  //    arrows do, and a sim that needs Play first would swallow the first thing he shows. `running`
  //    starts true and `everPlayed` starts true, so the deck's advance key advances instead of
  //    arming. Play/Pause and Reset still do the obvious things.
  // ============================================================================================
  class FrictionRamp extends PlatformBounce {
    constructor(canvas, opts = {}) {
      super(canvas, opts);
      this.g = opts.g ?? 5.0;
      this.mus = opts.mus ?? 0.60;
      this.muk = Math.min(opts.muk ?? 0.35, this.mus);   // a slide asking for mu_k > mu_s is a config
      //   error, not an interaction; the RUNTIME invariant is held by the coupled sliders in the mount.
      this.minAngle = 0;                    // no dead-zone: flat IS the interesting starting state here
      this.angle0 = opts.angle ?? 0;        // what Reset returns the bar to
      this.angle = this.angle0;
      // Class H hangs its pivot low (pivY = -1.6) to leave the ball room to fall onto the bar. Nothing
      // falls onto this one, so the bar sits at the middle of the frame where it is easiest to read
      // from the back of the room — and the block still has four world units to fall through after it
      // walks off the end, which is more than enough to leave frame.
      this.pivY = 0;
      this.bw = 1.05; this.bh = 0.58;       // block, in world units (the quarry's proportions)
      this.nTeeth = 12; this.toothH = 0.09;
      this.forceScale = 0.42;               // ONE scale for every arrow, so lengths compare directly
      this.showReadout = false;
      this.running = true; this.paused = false; this.everPlayed = true;
      this.last = performance.now();
      this._resetBody();
    }
    _resetBody() {
      this.s = 0; this.vs = 0;              // along-platform position (from the pin) and velocity
      this.sliding = false; this.airborne = false;
      this.x = this.pivX; this.y = this.pivY; this.vx = 0; this.vy = 0;
      this.simMs = 0; this.posHist = [];
    }
    _angleLocked() { return false; }        // the platform is ALWAYS draggable — that is the slide
    play()  { this._resetBody(); this.running = true; this.paused = false; this.everPlayed = true; this.last = performance.now(); }
    // Reset puts the BAR back too, not just the block. A reset that recentered the block on a ramp
    // still tipped past the threshold just watched it slide off again, which is not a reset of
    // anything. onAngleChange carries it to the slider, the same channel a pointer drag uses.
    reset() {
      this._resetBody();
      this.angle = this.angle0;
      if (this.onAngleChange) this.onAngleChange(this.angle);
      this.running = true; this.paused = false; this.render();
    }

    // --- the physics, all per unit mass (m cancels out of every line, which is the lesson) --------
    get _aPar()  { return -this.g * Math.sin(this.phi); }        // gravity along +tangent
    get _normA() { return this.g * Math.cos(this.phi); }         // |F_N|/m = g cos(phi)
    get _fricStatic()  { return -this._aPar; }                   // whatever it has to be
    get _fricLimit()   { return this.mus * this._normA; }        // the ceiling
    get _critAngle()   { return Math.atan(this.mus) / D2R; }     // tan(theta_c) = mu_s

    // Block center, in world coords, lifted off the surface by half its height (plus the tooth lift).
    _bodyCenter() {
      const t = this._tangent(), n = this._normal();
      const lift = this.bh / 2 + (this.sliding ? this.toothH : 0);
      return { x: this.pivX + this.s * t.x + lift * n.x, y: this.pivY + this.s * t.y + lift * n.y };
    }
    step(now) {
      if (this.running && !this.paused) {
        let dt = Math.min((now - this.last) / 1000, 0.05) * (this.slomo ? this.slomoFactor : 1);
        this.last = now;
        const sub = 6, h = dt / sub;
        for (let i = 0; i < sub; i++) {
          this.simMs += h * 1000;
          if (this.airborne) {                                   // off the end — a frictionless projectile
            this.vy += -this.g * h; this.x += this.vx * h; this.y += this.vy * h;
            continue;
          }
          const aPar = this._aPar, limit = this._fricLimit;      // both read LIVE — see note 1
          if (!this.sliding) {
            if (Math.abs(aPar) > limit) this.sliding = true;     // the ceiling has been crossed
            else { this.vs = 0; }                                // still stuck: friction cancels the pull exactly
          }
          if (this.sliding) {
            // mu_k stands alone here, and that is deliberate (Daniel, 2026-08-21). The physics never
            // consults mu_s on this branch: mu_s decides WHETHER it slips, mu_k decides what happens
            // once it has, and the sliding block cannot be changed by a control that is about the
            // other branch. mu_k <= mu_s is maintained where it belongs — in the coupled sliders, at
            // the mount — so this line never needs a guard and never silently disagrees with what the
            // mu_k slider reads.
            const dir = this.vs !== 0 ? Math.sign(this.vs) : Math.sign(aPar);
            const a = aPar - this.muk * this._normA * dir;
            const vNew = this.vs + a * h;
            if (this.vs !== 0 && Math.sign(vNew) !== Math.sign(this.vs)) {
              // friction took the speed to zero inside this substep. Never let it carry through to a
              // reversal: kinetic friction stops a block, it does not push it back up the slope.
              this.vs = 0;
              if (Math.abs(aPar) <= limit) this.sliding = false;   // static can hold it → stick
              // The else is a guard rather than a case: with mu_k <= mu_s held by the sliders, a block
              // that is sliding because |F_par| > mu_s|F_N| cannot be stopped by mu_k|F_N|, so it does
              // not reach here. It stays sliding and restarts down-slope on the next substep.
            } else {
              this.vs = vNew; this.s += this.vs * h;
            }
          }
          if (!this.airborne && Math.abs(this.s) > this.halfLen) {   // walked off the end
            const t = this._tangent(), c = this._bodyCenter();
            this.airborne = true;
            this.x = c.x; this.y = c.y; this.vx = this.vs * t.x; this.vy = this.vs * t.y;
          }
        }
        const c = this.airborne ? { x: this.x, y: this.y } : this._bodyCenter();
        this._recordPos(c.x, c.y, this.simMs, HOUSE.trailFadeS * 1000);
        if (this.y < this.pivY - 5.5 || this.x < -2 || this.x > HOUSE.frameW + 2) this.reset();
      } else { this.last = now; }
      this.render();
    }

    // --- drawing -------------------------------------------------------------------------------
    // The teethed block (OBJECTS.md 'Variants — teethed (friction) block'): a rectangle whose bottom
    // edge is a triangle wave. While stuck the teeth are BURIED — we draw the block first and the
    // platform bar over it, so the interlock reads as solid contact and only the tips show. Once
    // sliding the whole block lifts by tooth_h and the voids between teeth become visible, which is
    // the entire visual argument for why kinetic friction is the smaller number.
    // One block polygon, drawn at a given world center in a given color — the real body, and each of
    // its after-images, so a ghost can never drift out of shape from the thing it is a ghost of.
    _drawBlockAt(c, color, alpha) {
      const ctx = this.ctx, t = this._tangent(), n = this._normal();
      const hw = this.bw / 2, hh = this.bh / 2;
      const P = (a, b) => ({ x: this.sx(c.x + a * t.x + b * n.x), y: this.sy(c.y + a * t.y + b * n.y) });
      ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.beginPath();
      let p = P(-hw, hh); ctx.moveTo(p.x, p.y);
      p = P(hw, hh);  ctx.lineTo(p.x, p.y);
      p = P(hw, -hh); ctx.lineTo(p.x, p.y);
      const n2 = 2 * this.nTeeth;                                  // triangle wave right → left along the bottom
      for (let i = 1; i <= n2; i++) {
        const a = hw - (this.bw * i) / n2;
        const b = -hh - (i % 2 ? this.toothH : 0);
        p = P(a, b); ctx.lineTo(p.x, p.y);
      }
      ctx.closePath(); ctx.fill(); ctx.restore();
    }
    _drawBlock() {
      this._drawBlockAt(this.airborne ? { x: this.x, y: this.y } : this._bodyCenter(), HOUSE.mass, 1);
    }
    // Velocity-blue after-images (STYLE.md: every moving body carries them; the smear length reads
    // true speed). `SimBase._motionBlur` draws DISCS, which is right for a point mass and wrong for a
    // block, so this is the same token recipe — `blur_frames` ghosts spaced `blur_dt_s` of physics
    // time back, `blur_alpha0` fading by `blur_falloff` per step — applied to the block polygon. Same
    // hand-application Class I's coaster makes for its three-car train.
    //
    // **This replaced a white trail** (Daniel, 2026-08-21). The white fading trajectory is for CURVED
    // paths, where the shape of the path is itself information — a bounced ball, a coaster. A block
    // sliding down a straight ramp traces a line that is already drawn on screen: the ramp. So the
    // trail said nothing and cluttered the one thing the slide is about, which is the arrows.
    _blockBlur() {
      if (!this.sliding && !this.airborne) return;                 // a stuck block has no speed to read
      this.now = this.simMs;                                       // _posAtBack measures back from here
      for (let k = HOUSE.blurFrames; k >= 1; k--) {                // oldest (faintest) first
        const back = k * HOUSE.blurDt * 1000;
        if (this.simMs - back < 0) continue;                       // phantom frame from before the slide began
        const p = this._posAtBack(back);
        if (p) this._drawBlockAt(p, HOUSE.velocity, HOUSE.blurAlpha0 * Math.pow(HOUSE.blurFalloff, k - 1));
      }
    }
    _forceArrow(c, ax, ay, color, alpha) {                          // an ACCELERATION (per unit mass), drawn at the one scale
      this._arrow(c.x, c.y, ax * this.forceScale, ay * this.forceScale, color, alpha === undefined ? 1 : alpha);
    }
    _dashTo(c, ax, ay, bx, by) {                                    // dashed guide completing the right-angle box
      const ctx = this.ctx, S = this.forceScale;
      ctx.save(); ctx.strokeStyle = withAlpha(HOUSE.gravity, 0.45); ctx.setLineDash([4, 5]);
      ctx.lineWidth = Math.max(this.scale * 0.014, 1.2);
      ctx.beginPath();
      ctx.moveTo(this.sx(c.x + ax * S), this.sy(c.y + ay * S));
      ctx.lineTo(this.sx(c.x + bx * S), this.sy(c.y + by * S));
      ctx.stroke(); ctx.restore();
    }
    _drawForces() {
      if (this.airborne) {                                          // off the ramp: gravity alone
        const c = { x: this.x, y: this.y };
        this._forceArrow(c, 0, -this.g, HOUSE.gravity);
        return;
      }
      const c = this._bodyCenter(), t = this._tangent(), n = this._normal();
      const aPar = this._aPar, aPerp = -this.g * Math.cos(this.phi);   // gravity's two components
      // gravity, and its two faded components with the dashed box
      this._forceArrow(c, 0, -this.g, HOUSE.gravity);
      this._forceArrow(c, aPar * t.x, aPar * t.y, HOUSE.gravity, 0.5);
      this._forceArrow(c, aPerp * n.x, aPerp * n.y, HOUSE.gravity, 0.5);
      this._dashTo(c, aPar * t.x, aPar * t.y, 0, -this.g);
      this._dashTo(c, aPerp * n.x, aPerp * n.y, 0, -this.g);
      // the normal force (purple) — always g cos(phi), always along +n
      const N = this._normA;
      this._forceArrow(c, N * n.x, N * n.y, HOUSE.normal);
      // friction (amber): -F_par while stuck, mu_k·|F_N| opposing the slide once moving
      let f;
      if (this.sliding) {
        const dir = this.vs !== 0 ? Math.sign(this.vs) : Math.sign(aPar);
        f = -this.muk * N * dir;                    // mu_k alone — see the note in step()
      } else {
        f = this._fricStatic;
      }
      if (Math.abs(f) > 1e-6) this._forceArrow(c, f * t.x, f * t.y, HOUSE.friction);
    }
    _readout() {
      const ctx = this.ctx, pad = Math.round(this.H * 0.028);
      const fs = HOUSE.sizeCaption * this.H;
      const stuck = !this.sliding && !this.airborne;
      const lines = [
        `angle  ${this.angle.toFixed(0)}°     tan = ${Math.abs(Math.tan(this.phi)).toFixed(2)}`,
        `μs = ${this.mus.toFixed(2)}   →  slips past ${this._critAngle.toFixed(0)}°`,
        `μk = ${this.muk.toFixed(2)}`,
        this.airborne ? "OFF THE END — no contact, no friction"
                      : (stuck ? "STUCK — friction = the pull, below its ceiling"
                               : "SLIDING — friction = μk |F_N|, constant")
      ];
      ctx.save();
      ctx.font = fs + "px " + HOUSE.fontMono; ctx.textBaseline = "top";
      lines.forEach((L, i) => {
        ctx.fillStyle = i === 3 ? (stuck ? HOUSE.spring : HOUSE.friction) : HOUSE.muted;
        ctx.fillText(L, pad, pad + i * fs * 1.45);
      });
      ctx.restore();
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      this._blockBlur();          // after-images UNDER the body…
      this._drawBlock();          // …then the block…
      this._drawPlatform();       // …then the bar over both, so buried teeth read as solid contact
      this._drawForces();
      if (this.showReadout) this._readout();
    }
  }

  // Shared shell + wiring for the platform family (mirrors mountProjectile's pattern: Play/Pause,
  // Reset, 🐢 slo-mo, sliders paired with editable number boxes; the speaker-view copy is read-only).
  function _platformShell(sliderHTML, withReadout) {
    return `
      <canvas class="simcanvas"></canvas>
      ${withReadout ? '<button class="simbtn toggle-readout" title="show / hide numbers">123</button>' : ""}
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        ${sliderHTML}
      </div>`;
  }
  function _wirePlatformCommon(section, sim, sliderSels) {
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const playBtn = q(".play");
    const refresh = () => { playBtn.textContent = !sim.running ? "▶ Play" : (sim.paused ? "▶ Resume" : "⏸ Pause"); };
    sim.refreshPlayBtn = refresh;
    playBtn.addEventListener("click", () => { if (!sim.running) sim.play(); else if (sim.paused) sim.resume(); else sim.pause(); refresh(); });
    q(".reset").addEventListener("click", () => { sim.reset(); refresh(); });
    const slo = q(".slomo"); if (slo) { slo.classList.toggle("on", sim.slomo); slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); }); }
    const rt = q(".toggle-readout");
    if (rt) rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); if (!sim.running) sim.render(); });
    if (readonly) {
      sim.c.style.pointerEvents = "none";
      [playBtn, q(".reset"), slo, rt, ...sliderSels.flatMap(s => [q(s.rng), q(s.num)])].forEach(el => { if (el) el.disabled = true; });
      const ctrls = q(".simctrls"); if (ctrls) ctrls.style.opacity = ".4";
    }
    let raf = null, prev = sim.running;
    sim.start = () => { if (raf) return; const loop = (now) => { sim.step(now); if (sim.running !== prev) { prev = sim.running; refresh(); } raf = requestAnimationFrame(loop); }; sim.last = performance.now(); raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    refresh();
    return { q, refresh };
  }
  // One slider + its number box, kept in step, clamped to the slider's own range.
  // `show(v)` moves BOTH controls without firing `set` — it is how one slider reports that it has
  // moved another one (FrictionRamp's coupled mu pair), so the display can never disagree with the
  // state while still leaving exactly one path that writes the state.
  function _bindSlider(section, rngSel, numSel, get, set) {
    const rng = section.querySelector(rngSel), num = section.querySelector(numSel);
    const clamp = v => Math.max(+rng.min, Math.min(+rng.max, v));
    rng.value = get(); num.value = get();
    const apply = () => { set(+rng.value); num.value = rng.value; };
    const show = (v) => { rng.value = clamp(v); num.value = rng.value; };
    rng.addEventListener("input", apply);
    num.addEventListener("input", () => { const v = parseFloat(num.value); if (isNaN(v)) return; rng.value = clamp(v); set(+rng.value); });
    num.addEventListener("change", () => { const v = parseFloat(num.value); num.value = isNaN(v) ? get() : clamp(v); rng.value = num.value; apply(); });
    return { rng, num, apply, show };
  }

  function mountPlatformBounce(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend",
      _platformShell(`<label><span class="var">angle:</span> <input type="range" class="s-ang" min="-60" max="60" step="1"><input type="number" class="n-ang" step="1"><span class="u">°</span></label>`, false));
    const d = section.dataset;
    const sim = new PlatformBounce(section.querySelector(".simcanvas"), { angle: d.angle !== undefined ? +d.angle : 22 });
    const q = s => section.querySelector(s);
    const rng = q(".s-ang"), num = q(".n-ang"); rng.value = sim.angle; num.value = sim.angle;
    const apply = () => { sim.angle = sim._snapAngle(+rng.value); rng.value = sim.angle; num.value = sim.angle; if (!sim.running) sim.render(); };   // snap out of the near-flat dead-zone
    sim.onAngleChange = (a) => { rng.value = Math.round(a); num.value = Math.round(a); };   // drag → slider (a is already snapped)
    rng.addEventListener("input", apply);
    num.addEventListener("change", () => { const v = parseFloat(num.value); rng.value = isNaN(v) ? sim.angle : sim._snapAngle(v); apply(); });
    _wirePlatformCommon(section, sim, [{ rng: ".s-ang", num: ".n-ang" }]); apply();
    return sim;
  }

  // Class M `sim-ramp`. Three controls: the platform angle (also draggable on the bar itself) and the
  // two coefficients. The two coefficients are INDEPENDENT — neither slider clamps or reads the other.
  // See the note in step() for why that matters more than keeping mu_k <= mu_s.
  function mountFrictionRamp(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend",
      _platformShell(
        `<label><span class="var">angle:</span> <input type="range" class="s-ang" min="-60" max="60" step="1"><input type="number" class="n-ang" step="1"><span class="u">°</span></label>
         <label><span class="var"><i>μ</i><sub>s</sub>:</span> <input type="range" class="s-mus" min="0" max="1.2" step="0.05"><input type="number" class="n-mus" step="0.05"></label>
         <label><span class="var"><i>μ</i><sub>k</sub>:</span> <input type="range" class="s-muk" min="0" max="1.2" step="0.05"><input type="number" class="n-muk" step="0.05"></label>`, true));
    const d = section.dataset;
    const sim = new FrictionRamp(section.querySelector(".simcanvas"), {
      angle: d.angle !== undefined ? +d.angle : 0,
      mus:   d.mus   !== undefined ? +d.mus   : 0.60,
      muk:   d.muk   !== undefined ? +d.muk   : 0.35,
      g:     d.g     !== undefined ? +d.g     : 5.0
    });
    const ang = _bindSlider(section, ".s-ang", ".n-ang", () => sim.angle,
      v => { sim.angle = sim._snapAngle(v); if (!sim.running) sim.render(); });
    sim.onAngleChange = (a) => { ang.rng.value = Math.round(a); ang.num.value = Math.round(a); };
    // THE COUPLED PAIR. mu_k <= mu_s is maintained by the CONTROLS, not by the physics: push one past
    // the other and the other one moves out of the way, visibly. Two earlier versions were worse.
    // Clamping mu_k to mu_s inside the physics meant dragging mu_s to zero mid-slide silently killed
    // the kinetic friction while its slider still read 0.35 — the state and the display disagreed, and
    // the display was lying. Leaving them fully independent (the version after that) let a presenter
    // set mu_k > mu_s, which is a surface that does not exist and which stick-slips on screen for
    // reasons nobody in the room can be told. Coupling gets both: the physics reads mu_k alone and is
    // never second-guessed, and no unphysical pair can be entered in the first place.
    // The one consequence to know at the board: dragging mu_s BELOW mu_k while the block is sliding
    // drags mu_k down with it, so the friction does shrink — but the mu_k slider moves while it
    // happens, so what changed is on screen. Anywhere above mu_k, mu_s does nothing to a moving block,
    // which is the behavior that matters.
    let musB, mukB;
    musB = _bindSlider(section, ".s-mus", ".n-mus", () => sim.mus, v => {
      sim.mus = v;
      if (sim.muk > sim.mus) { sim.muk = sim.mus; mukB.show(sim.muk); }
      if (!sim.running) sim.render();
    });
    mukB = _bindSlider(section, ".s-muk", ".n-muk", () => sim.muk, v => {
      sim.muk = v;
      if (sim.mus < sim.muk) { sim.mus = sim.muk; musB.show(sim.mus); }
      if (!sim.running) sim.render();
    });
    _wirePlatformCommon(section, sim, [{ rng: ".s-ang", num: ".n-ang" },
                                       { rng: ".s-mus", num: ".n-mus" },
                                       { rng: ".s-muk", num: ".n-muk" }]);
    sim.render();
    return sim;
  }

  // ============================================================================================
  // CoupledMass (data-sim="coupledmass") — Class N. The board derivation, made live.
  //
  // Two masses in deep space joined by one spring. m1 is driven by a fixed sinusoidal shaker
  // (light-blue, the applied role); the spring pushes BOTH bodies with equal and opposite green
  // arrows, which is the whole point of the slide — the third law, drawn, in a system where the two
  // members act on different bodies and therefore never cancel. Three sliders: m1, m2, k. The drive
  // amplitude and frequency are FIXED, because only the ratio m2*wd^2/k matters and every regime is
  // reachable without a fourth control.
  //
  // THE k SLIDER WALKS THE WHOLE CLASS, in narrative order, on one drag downward from the default:
  //     k = 12  default          both masses moving, in phase, m2 further than m1
  //     k =  9  THE NODE         k = m2*wd^2 -> x1 = 0: the DRIVEN mass stands still. Tuned mass damper.
  //     k =  6  RESONANCE        k = m12*wd^2: amplitudes run away until the masses touch
  //     k =  2  ISOLATION        m2*wd^2 >> k -> x2/x1 small AND NEGATIVE: m2 barely moves, out of phase.
  //                              This is the swan, and it is the last thing on board-4.
  //
  // SWEEPING THROUGH RESONANCE IS SUPPOSED TO SURVIVE, and it does, for free, because the integrator
  // is honest: resonance is a growth RATE (about 1/(zeta*omega) to build), not a wall. Cross it in
  // half a second and the pair wobbles and sails through to the isolation regime; sit in it and the
  // amplitude climbs until they collide and the sim resets itself. The reset is a safety net for
  // DWELLING, not the expected cost of crossing — which is why a jet engine is spun up fast through
  // its critical speed, and why the homework says the drone's camera thrashes for one second on every
  // spin-up and is steady the rest of the flight.
  //
  // DAMPING — it damps the WOBBLE, not the ANSWER, and the distinction is the whole reason this
  // slide is usable. A plain dashpot forces a trade with no winner: heavy enough to settle in a couple
  // of cycles and it flattens resonance and blurs the node; light enough to keep those and every
  // slider move leaves five or six drive periods of beating, so you change something and then wait.
  // Instead the strong damping acts on the relative velocity MINUS the relative velocity the board's
  // undamped solution has at that instant — the free vibration, and nothing else. At steady state that
  // term is exactly zero, so what is on screen is the board's formula uncorrected: x1 = 0 is a TRUE
  // zero at the node, the ratio is exactly k/(k - m2*wd^2), and it still settles in about two cycles.
  // On resonance the board's answer is infinite and the split is meaningless, so a light ordinary
  // dashpot fades in there instead and the peak climbs until the masses touch. See _coupling().
  //
  // SEEDING HAPPENS ON LOAD AND RESET ONLY — NEVER ON A SLIDER CHANGE, and this is the single
  // easiest way to get this preset subtly wrong. Re-seeding whenever a slider moved would TELEPORT
  // the system to the analytic steady state for the new parameters, so a fast drag through resonance
  // would snap to the resonant amplitude and collide: the exact opposite of what really happens and
  // of what the slide teaches. The sliders feed the integrator and nothing else. If a slider JUMP (a
  // click on the track) ever reads as messy, slew the value to its target over ~0.15 s so a click
  // becomes a fast drag; do NOT re-seed, and do NOT raise zeta, which is the knob that costs the
  // resonance.
  //
  // The energy strip underneath is the LauncherGame pattern (Class I) on the same graph.stack_*
  // tokens a baked energy clip uses, so live and baked sit in the same place and read as one object.
  // Two kinetic bands (one per mass, velocity-blue tints, m1 darker) over one shared spring-PE band.
  // NO heat band: the damping is a numerical convenience rather than physics being taught, and
  // banding it would advertise the fudge on a graph whose job is to show the drive pumping the
  // system. The consequence is the good part — the top edge of the stack is K + U, which is NOT
  // conserved here, so THE LID MOVES. First moving lid since Class I, and it climbs near resonance.
  // ============================================================================================
  const COUPLED_CONTROLS_HTML = `
      <canvas class="simcanvas"></canvas>
      <button class="simbtn toggle-readout" title="show / hide numbers">123</button>
      <div class="simctrls">
        <button class="simbtn play">⏸ Pause</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>k</i>:</span> <input type="range" class="s-k" min="2" max="30" step="0.5"><input type="number" class="n-k" step="0.5"><span class="u">N/m</span></label>
      </div>`;

  class CoupledMass extends SimBase {
    constructor(canvas, opts = {}) {
      super(canvas);
      this.m1 = opts.m1 ?? CoupledMass.M1_DEF;
      this.m2 = opts.m2 ?? CoupledMass.M2_DEF;
      this.k = opts.k ?? CoupledMass.K_DEF;
      // A slider or a preset button sets the TARGET; the live value eases onto it (see _slew).
      this.m1T = this.m1; this.m2T = this.m2; this.kT = this.k;
      this.wd = opts.wd ?? CoupledMass.WD;
      this.F0 = opts.F0 ?? CoupledMass.F0;
      this.slomo = opts.slomo ?? false;
      // The numbers start OFF behind the `123` toggle, as in HandLiftEnergy. The energy strip is
      // ALWAYS drawn — it is part of the object, not an option (Daniel, 2026-08-25).
      this.showReadout = false;
      // Per-body shades off the house ramp: body 0 keeps the pure colour, body 1 is a step darker, and
      // the SAME index drives the mass disc and its kinetic band, so the little dark mass and the dark
      // blue band are visibly the same body.
      // Indices 0 and 2, NOT 0 and 1: adjacent steps on the ramp (#f0f0f5 vs #cdcdd2) are a difference
      // you can measure and not one you can see from the back of a lecture hall, which was the whole
      // point (Daniel, 2026-08-26). Skipping the middle gives #f0f0f5 / #ababb0 for the discs and
      // #5d80b4 / #455c82 for the bands — obvious at projector size, and still the same ramp.
      const mR = tints(HOUSE.mass, 3), vR = tints(HOUSE.velocity, 3);
      this.massCol = [mR[0], mR[2]];
      this.keCol = [vR[0], vR[2]];
      this.paused = false;
      this.everPlayed = true;            // auto-runs; -> always advances the deck
      this.focusY = 0;
      this.simT = 0;
      this.hist = [];
      this.gTail = 6.0;                  // seconds of energy history on screen
      this.crash = null;                 // {phase, t} while the collision cut is running
      this.resize();
      this.reset(true);
    }

    // ---- derived quantities ------------------------------------------------------------------
    get m12() { return this.m1 * this.m2 / (this.m1 + this.m2); }
    get omega() { return Math.sqrt(this.k / this.m12); }         // free-free natural frequency
    /** How far the drive sits from resonance, 0 (on it) to 1 (comfortably off it). Smoothstepped, so
     *  the damping model below changes character continuously rather than switching. */
    get offResonance() {
      const wd2 = this.wd * this.wd, w2 = this.omega * this.omega;
      const r = Math.abs(w2 - wd2) / w2 / CoupledMass.RES_BAND;
      const u = Math.max(0, Math.min(1, r));
      return u * u * (3 - 2 * u);
    }
    /** The damping that survives into the STEADY state. Off resonance this is zero by construction —
     *  see _coupling() — so what you watch there is the board's undamped answer, exactly. */
    get alphaSteady() { return 2 * CoupledMass.ZETA_RES * this.omega * this.m12 * (1 - this.offResonance); }
    /** The damping that acts only on the WOBBLE. Large, because it costs nothing at steady state. */
    get alphaDev() { return 2 * CoupledMass.ZETA_DEV * this.omega * this.m12 * this.offResonance; }

    /** The relative velocity the UNDAMPED board solution has right now. The deviation from this is the
     *  free vibration — the wobble — and it is the only thing the strong damping is allowed to see.
     *  Relative amplitude falls out of the board's two lines as A2 - A1 = -F0/(m1*(omega^2 - wd^2)). */
    _relVelStar() {
      const wd2 = this.wd * this.wd, w2 = this.omega * this.omega;
      const den = this.m1 * (w2 - wd2);
      if (Math.abs(den) < 1e-9) return 0;
      const Arel = -this.F0 / den;
      return -Arel * this.wd * Math.sin(this.wd * this.simT);
    }
    get r1() { return HOUSE.baseRadius * Math.cbrt(this.m1); }
    get r2() { return HOUSE.baseRadius * Math.cbrt(this.m2); }
    get rSum() { return this.r1 + this.r2; }
    /** x2/x1 = k/(k - m2*wd^2) — the board's amplitude ratio, and the whole bird half of the class. */
    get ratio() {
      const den = this.k - this.m2 * this.wd * this.wd;
      return Math.abs(den) < 1e-9 ? Infinity : this.k / den;
    }
    get running() { return !this.paused; }

    /** The EXACT steady state of the DAMPED pair, as complex amplitudes, so a seed leaves literally no
     *  transient rather than a small one to be damped away. The board's formula is the alpha -> 0 limit
     *  of this and the two agree to a few percent off resonance; seeding on the undamped one left a ~4%
     *  wobble that took several seconds to settle, which is exactly what the seed exists to avoid.
     *
     *      [ k - m1*wd^2 + i*a*wd      -(k + i*a*wd)      ] [X1]   [F0]
     *      [   -(k + i*a*wd)         k - m2*wd^2 + i*a*wd ] [X2] = [ 0]
     *
     *  with a = alpha. Then x_j(0) = Re(X_j) and v_j(0) = -wd*Im(X_j), since x_j(t) = Re(X_j e^{i wd t}).
     *  Near resonance the determinant is small but never zero (that is what the damping buys), so no
     *  clamp is needed for the solve — only the SEED_CAP below, which keeps a seed at resonance from
     *  opening the slide mid-collision. */
    _steady() {
      const wd = this.wd, wd2 = wd * wd, a = this.alphaSteady, k = this.k;
      const mul = (p, q) => [p[0] * q[0] - p[1] * q[1], p[0] * q[1] + p[1] * q[0]];
      const sub = (p, q) => [p[0] - q[0], p[1] - q[1]];
      const div = (p, q) => { const d = q[0] * q[0] + q[1] * q[1];
                              return [(p[0] * q[0] + p[1] * q[1]) / d, (p[1] * q[0] - p[0] * q[1]) / d]; };
      const A00 = [k - this.m1 * wd2, a * wd];
      const A11 = [k - this.m2 * wd2, a * wd];
      const Aoff = [-k, -a * wd];                       // the off-diagonal coupling, = -(k + i a wd)
      const det = sub(mul(A00, A11), mul(Aoff, Aoff));
      const X1 = div(mul([this.F0, 0], A11), det);
      const X2 = div(mul([-this.F0, 0], Aoff), det);
      return { A1: X1[0], A2: X2[0], V1: -wd * X1[1], V2: -wd * X2[1] };
    }

    /** Seed the state ON the analytic steady state, so the sim opens with no transient at all rather
     *  than damping one away. Called on load and on reset. NEVER on a slider change — see the header. */
    reset(hard) {
      const { A1, A2, V1, V2 } = this._steady();
      const cap = CoupledMass.SEED_CAP;
      const s = Math.min(1, cap / Math.max(Math.abs(A1), Math.abs(A2), 1e-9));
      this.x1 = CoupledMass.X1EQ + A1 * s;
      this.x2 = CoupledMass.X1EQ + CoupledMass.L0 + A2 * s;
      this.v1 = V1 * s; this.v2 = V2 * s;
      if (hard) { this.simT = 0; this.hist = []; this.paused = false; }
      this._freezeScale();
      this.last = performance.now();
    }

    /** The energy axis, and it is FIXED — one number, set once, never touched again.
     *
     *  It used to be recomputed whenever a slider moved, which is defensible on paper (within a run a
     *  band's height meant one thing) and was wrong in the room: every parameter change rescaled the
     *  graph under you, so you could not tell whether a band grew because the physics changed or
     *  because the axis did. That confusion cost more than the scaling bought.
     *
     *  24 J is chosen to hold the whole usable slider space without clipping: the steady-state peak
     *  runs about 2 J in the stiffest corner and about 23 J just outside the resonance band, so
     *  nothing clips except right next to resonance itself. The default sits near a quarter height,
     *  which is deliberately modest — the strip is for comparing now against ten seconds ago, and a
     *  band that fills the frame at rest has nowhere to go when the drive starts pumping it.
     *
     *  Clipping near resonance is not a loss: the stack visibly slams into the ceiling as the
     *  amplitude runs away, which is the honest picture of a quantity going somewhere you cannot
     *  follow. */
    _freezeScale() { this.eMax = CoupledMass.EMAX; }

    // ---- physics -----------------------------------------------------------------------------
    _energies() {
      const d = (this.x2 - this.x1) - CoupledMass.L0;
      return { ke1: 0.5 * this.m1 * this.v1 * this.v1,
               ke2: 0.5 * this.m2 * this.v2 * this.v2,
               spe: 0.5 * this.k * d * d };
    }
    /** Spring + dashpot force along +x ON m1 (toward m2 when stretched). Its negative acts on m2 —
     *  one number, two bodies, opposite signs. That IS the third law, and it is why the two green
     *  arrows can never disagree by a pixel: they are drawn from the same scalar. */
    /** DAMP THE WOBBLE, NOT THE ANSWER.
     *
     *  A plain dashpot forces a three-way trade nobody wins: heavy enough to settle in a couple of
     *  cycles (zeta ~ 0.11) and it flattens resonance and blurs the node; light enough to keep those
     *  (zeta ~ 0.045) and every slider move leaves five or six drive periods of beating before the
     *  picture means anything. That beating is what made the sim feel unusable — you change something
     *  and then wait, and the room waits with you.
     *
     *  The way out is that a driven LINEAR system splits exactly in two: the particular solution (the
     *  board's answer, at the drive frequency) plus a free vibration at the natural frequency (the
     *  wobble). Only the second one should decay. So the strong damping acts on the RELATIVE VELOCITY
     *  MINUS the relative velocity the board's undamped solution has at this instant — which is zero
     *  once the wobble is gone. At steady state the strong term therefore contributes NOTHING, and
     *  what is on screen is the board's formula with no damping correction at all: the node is a true
     *  zero, the ratio is exactly k/(k - m2*wd^2), and it still settles in about two cycles.
     *
     *  ON RESONANCE the board's answer is infinite and this split is meaningless, so `offResonance`
     *  fades the strong term out and a light ordinary dashpot in — which is what we want there anyway:
     *  a tall peak that keeps climbing until the masses touch. The two never both act at full strength.
     *
     *  It is a modelling choice rather than a mechanism, and so was the plain dashpot — you cannot run
     *  a driven oscillator from an arbitrary state in real time without choosing how the transient
     *  goes away. This choice is the one that makes the slide show the board. Say "there is a little
     *  damping" to the room; say this to whoever asks the good question. */
    _coupling() {
      const d = (this.x2 - this.x1) - CoupledMass.L0;
      const vrel = this.v2 - this.v1;
      return this.k * d
           + this.alphaDev * (vrel - this._relVelStar())     // kills the wobble
           + this.alphaSteady * vrel;                        // holds resonance to something finite
    }
    _drive(t) { return this.F0 * Math.cos(this.wd * t); }

    /** Hold the system's NET MOMENTUM to what the drive alone can account for, and no more.
     *
     *  The only external force here is the shaker, so p(t) = integral F dt = (F0/wd)*sin(wd*t) plus a
     *  constant, and that constant is supposed to be ZERO: the pair floats, the drive averages to
     *  nothing over a cycle, and the center of mass should rock in place rather than travel. The exact
     *  seed satisfies that automatically (adding the two board equations gives m1*X1 + m2*X2 = -F0/wd^2,
     *  which is REAL, so the seeded momentum is zero to machine precision).
     *
     *  A SLIDER BREAKS IT, and this is the bug Daniel found. Dragging m1 from 2 to 5 mid-motion keeps
     *  v1 and changes the mass, so m1*v1 jumps — injecting net momentum out of nowhere. Nothing damps
     *  the center-of-mass mode (deliberately: the dashpot is internal, between the masses), so that
     *  injected momentum never decays and the whole system slides off the frame. Measured before this
     *  fix: raising m1 to 5 threw the momentum from 4.66 to 6.94 and walked the center of mass 4.25
     *  world units in twelve seconds.
     *
     *  Changing a body's mass mid-flight is not a physical operation at all, so what happens next is a
     *  modelling choice rather than a result. The honest choice is to keep the momentum the drive
     *  accounts for and discard the rest: subtract the excess from BOTH velocities equally, which
     *  leaves the RELATIVE velocity — the internal mode, the entire subject of the slide — untouched
     *  to the last bit, and removes only the spurious drift. Applied every step, so integrator creep
     *  in the center-of-mass mode cannot accumulate either. */
    _holdMomentum() {
      const want = (this.F0 / this.wd) * Math.sin(this.wd * this.simT);
      const have = this.m1 * this.v1 + this.m2 * this.v2;
      const dv = (have - want) / (this.m1 + this.m2);
      this.v1 -= dv; this.v2 -= dv;
    }

    /** Semi-implicit Euler, re-reading m1/m2/k/alpha EVERY substep. Precomputing at play() is the
     *  trap DESIGN.md records from Class K's drag — it freezes the motion on a snapshot while the
     *  render keeps reading the sliders live — and here it would also destroy the fast-sweep
     *  behaviour, which is the best thing on the slide. Integrate, do not solve. */
    _advance(dt) {
      const n = CoupledMass.SUBSTEPS, h = dt / n;
      for (let i = 0; i < n; i++) {
        const Fs = this._coupling();
        const a1 = (Fs + this._drive(this.simT)) / this.m1;
        const a2 = (-Fs) / this.m2;
        this.v1 += a1 * h; this.v2 += a2 * h;
        this.x1 += this.v1 * h; this.x2 += this.v2 * h;
        this.simT += h;
        if (this.x2 - this.x1 <= this.rSum) { this._beginReset(); return; }
      }
    }

    /** THE MASSES TOUCHED, AND IT IS A CRASH.
     *
     *  The first version eased everything home over six-tenths of a second with the sliders walking back, which read
     *  as the sim quietly tidying up after itself: the force arrows reappeared, the masses drifted
     *  back to where they started, and nothing about it said "that just broke" (Daniel, 2026-08-26).
     *  It broke. Resonance ran the amplitude up until two bodies hit each other, and the honest
     *  punctuation for that is a cut, not a dissolve.
     *
     *  So: everything on the canvas — masses, arrows, coil, energy strip — fades to black in about a
     *  sixth of a second, holds black for half a second, and then the slide fades back up on a fresh,
     *  stable system at the default stiffness. The half-second of nothing is doing the work; it is
     *  long enough to register as an event and short enough not to feel like a hang. The energy
     *  history is dropped rather than punctuated, because after a cut the graph should start again,
     *  not carry the wreckage across.
     *
     *  The state is FROZEN where it was at contact for the fade-out, so what fades is the collision
     *  itself. Nothing integrates again until the system comes back. */
    _beginReset() {
      this.crash = { phase: "out", t: 0 };
    }

    /** 1 normally; ramps to 0 through the crash fade-out, sits at 0 through the beat, ramps back on
     *  the way in. Applied as a global alpha over the whole canvas, and the stage behind is black. */
    get crashAlpha() {
      const c = this.crash; if (!c) return 1;
      const C = CoupledMass;
      if (c.phase === "out") return Math.max(0, 1 - c.t / C.CRASH_OUT_S);
      if (c.phase === "hold") return 0;
      return Math.min(1, c.t / C.CRASH_IN_S);
    }

    /** Drive the crash state machine. Returns true while the scene must NOT integrate. */
    _crashStep(dt) {
      const c = this.crash; if (!c) return false;
      const C = CoupledMass;
      c.t += dt;
      if (c.phase === "out") {
        if (c.t >= C.CRASH_OUT_S) { c.phase = "hold"; c.t = 0; }
        return true;
      }
      if (c.phase === "hold") {
        if (c.t < C.CRASH_HOLD_S) return true;
        // The beat is over. Come back as a fresh system at the default stiffness, with the slider
        // walked home so the panel never disagrees with the physics, and no history behind it.
        this.k = this.kT = CoupledMass.K_DEF;
        if (this.onParams) this.onParams(this.m1, this.m2, this.k);
        this.bhist = null;
        this.reset(true);
        c.phase = "in"; c.t = 0;
        return false;                       // it runs while it fades up, so it arrives already moving
      }
      if (c.t >= C.CRASH_IN_S) this.crash = null;
      return false;
    }

    /** Ease the live parameters onto whatever the controls are asking for, over ~0.3 s.
     *
     *  A slider DRAG already arrives as a stream of small changes and needs none of this. A CLICK on
     *  the slider track, or a preset button, arrives as one discontinuous jump — and k appears inside
     *  the spring energy, so the energy strip took a visible KINK at that instant: half a joule of
     *  spring PE materialising between two frames because ½k·delta² changed while delta did not. The
     *  kink is real given an instantaneous k, and an instantaneous k is the unphysical part. Easing it
     *  turns every click into a fast drag, which the sim already handles, and the strip stays smooth.
     *  Deliberately quick: slow enough to be continuous, fast enough that "jump to resonance" still
     *  reads as a jump rather than a journey. */
    _slew(dt) {
      const f = 1 - Math.exp(-dt / CoupledMass.SLEW_TAU);
      this.m1 += (this.m1T - this.m1) * f;
      this.m2 += (this.m2T - this.m2) * f;
      this.k += (this.kT - this.k) * f;
    }

    step(now) {
      if (this.paused) { this.last = now; return; }
      const wall = Math.min((now - this.last) / 1000, 0.05);
      this.last = now;
      const dt = wall * (this.slomo ? CoupledMass.SLOMO_K : 1);
      if (this._crashStep(dt)) { this.render(); return; }   // frozen mid-crash: fade only
      this._slew(dt);
      this._advance(dt);
      this._holdMomentum();
      this._blurHist();
      this._pushHistory();
      this.render();
    }

    /** House motion blur: velocity-blue after-images behind each disc, drawn through the SHARED
     *  SimBase._motionBlur so a live body smears exactly like a baked one. Straight-line motion here,
     *  so blur ONLY and no white trail — the trail is for curved paths (tokens.json, "motion"). Needs
     *  a short position history because the state is integrated rather than analytic. */
    _blurHist() {
      const h = (this.bhist || (this.bhist = []));
      h.push({ t: this.simT, x1: this.x1, x2: this.x2 });
      const keep = HOUSE.blurFrames * HOUSE.blurDt * 1.2;
      while (h.length > 1 && this.simT - h[0].t > keep) h.shift();
    }
    _backAt(tBack, key) {
      const h = this.bhist; if (!h || !h.length) return null;
      if (tBack <= h[0].t) return { x: h[0][key], y: 0 };
      for (let i = h.length - 1; i >= 0; i--) {
        if (h[i].t <= tBack) {
          const a = h[i], b = h[i + 1] || a, f = (b.t === a.t) ? 0 : (tBack - a.t) / (b.t - a.t);
          return { x: a[key] + (b[key] - a[key]) * f, y: 0 };
        }
      }
      return { x: h[0][key], y: 0 };
    }

    _pushHistory() {
      const e = this._energies();
      this.hist.push({ t: this.simT, ke1: e.ke1, ke2: e.ke2, spe: e.spe, brk: !!this._gapPending });
      this._gapPending = false;
      while (this.hist.length > 2 && this.simT - this.hist[0].t > this.gTail * 1.1) this.hist.shift();
    }

    // ---- framing: play area on top, energy strip beneath, on the HOUSE stack tokens -------------
    resize() {
      const dpr = window.devicePixelRatio || 1, w = this.c.clientWidth || this.c.width, h = this.c.clientHeight || this.c.height;
      this.c.width = Math.round(w * dpr); this.c.height = Math.round(h * dpr);
      this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.W = w; this.H = h;
      // Band height is the house graph.stack_* geometry, so a live strip and a baked one are the same
      // object. The BOTTOM is not: a baked clip has nothing under it, and this sim has a live control
      // bar. The house 6% bottom margin put the strip straight through the slider (Daniel,
      // 2026-08-26), so the strip is lifted clear of the bar's MEASURED height — measured, because the
      // bar wraps at narrow widths and a hard-coded reserve would be wrong exactly when it wraps.
      // Same rule HandLiftEnergy uses (DESIGN, "Layout, top to bottom: hand, energy strip, control bar").
      this.gh = h * HOUSE.stackGraphH;
      const bar = this.c.parentElement && this.c.parentElement.querySelector(".simctrls");
      const barH = bar ? bar.getBoundingClientRect().height : h * 0.11;
      this.gy = h - barH - h * (HOUSE.stackBottomPct / 100) - this.gh;
      this.playH = this.gy - h * (HOUSE.stackGapPct / 100);
      this.scale = Math.min(w / HOUSE.frameW, this.playH / CoupledMass.PLAY_WORLD_H);
      this.ox = (w - HOUSE.frameW * this.scale) / 2;
    }
    /** The masses ride ABOVE the middle of the play area, not on it. The energy stack is allowed to
     *  overshoot its own ceiling and climb into this space near resonance (see _graph), so the scene
     *  gets out of its way — and the picture of the graph swallowing the animation is the point. */
    sy(y) { return this.playH * CoupledMass.PLAY_CY - (y - this.focusY) * this.scale; }

    // ---- drawing -----------------------------------------------------------------------------
    /** The house zigzag between the two masses, in scenery gray. NEVER green: the coil is structure,
     *  the FORCE is the role color (style/OBJECTS.md, "Springs & elastic"). */
    _coil() {
      const ctx = this.ctx;
      const ax = this.sx(this.x1 + this.r1), ay = this.sy(0);
      const bx = this.sx(this.x2 - this.r2), by = this.sy(0);
      const L = Math.max(bx - ax, 1);
      const width = HOUSE.springWidth * this.scale, lead = HOUSE.springLead * this.scale;
      // Coil count nudges with stiffness as a GRAPHICAL cue only, clamped to the token band — it is
      // never a physical coil count (tokens.json, "spring").
      const frac = (this.k - 2) / 38;
      const coils = Math.round(Math.max(HOUSE.springCoilsMin,
                    Math.min(HOUSE.springCoilsMax, HOUSE.springCoilsMin + frac * (HOUSE.springCoilsMax - HOUSE.springCoilsMin))));
      const s0 = lead * 0.5, s1 = L - lead * 0.5, span = s1 - s0;
      ctx.save(); ctx.strokeStyle = HOUSE.boundary; ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.lineWidth = Math.max(this.scale * 0.045, 3);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax + s0, ay);
      if (span > 0) for (let i = 1; i < 2 * coils; i++) {
        ctx.lineTo(ax + s0 + span * i / (2 * coils), ay + (i % 2 === 1 ? -width / 2 : width / 2));
      }
      ctx.lineTo(ax + s1, ay); ctx.lineTo(bx, by); ctx.stroke(); ctx.restore();
    }

    /** A quiet pearl label under a disc. Muted, caption tier — a name, not a readout. */
    _name(ctx, x, r, txt) {
      ctx.save(); ctx.fillStyle = HOUSE.muted; ctx.textAlign = "center"; ctx.textBaseline = "top";
      ctx.font = (HOUSE.sizeCaption * this.H * 0.9) + "px " + HOUSE.fontSans;
      ctx.fillText(txt, this.sx(x), this.sy(0) + r * this.scale + this.H * 0.012);
      ctx.restore();
    }

    /** The numbers, TOP RIGHT under the `123` toggle that hides them, right-aligned — the corner every
     *  other sim in the suite puts its readout in. No verdict line: a sim that announces "NODE — the
     *  driven mass stops" is narrating for Daniel, and the narration is his (Daniel, 2026-08-25). The
     *  numbers say where you are; whether that is interesting is the room's business. */
    /** Two numbers, both frequencies, both with units. x2/x1 used to be the third line and is gone
     *  (Daniel, 2026-08-26): the ratio is what the SCENE shows — one mass barely moving while the
     *  other swings — and printing it invites the room to read the number instead of the picture.
     *  What the picture cannot show is where the drive sits relative to the natural frequency, which
     *  is exactly what these two lines are for. */
    _readout(ctx) {
      const padR = this.W * 0.02, top = this.H * 0.09, fs = HOUSE.sizeCaption * this.H;
      ctx.save(); ctx.textAlign = "right"; ctx.textBaseline = "top";
      ctx.font = fs + "px " + HOUSE.fontMono; ctx.fillStyle = HOUSE.muted;
      [ "ω_d = " + this.wd.toFixed(2) + " rad/s",
        "ω = √(k/m₁₂) = " + this.omega.toFixed(2) + " rad/s",
      ].forEach((t, i) => ctx.fillText(t, this.W - padR, top + i * fs * 1.35));
      ctx.restore();
    }

    _graph(ctx) {
      // Scrolling stacked bands, "now" pinned to the right edge, history flowing left, on the frozen
      // eMax. Same geometry and painter's order as LauncherGame, so the live strip and a baked one
      // are the same object.
      const axisX = this.W * 0.062, x0 = axisX, x1 = this.W * 0.985, gy = this.gy, gh = this.gh;
      const ax = axisX, ay = gy + gh;
      const timeAxis = () => {
        ctx.save(); ctx.strokeStyle = HOUSE.ink; ctx.lineWidth = 2; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(x1, ay); ctx.stroke(); ctx.restore();
      };
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
      // NO CEILING. The axis is still frozen at eMax — a band's height means the same joules all the
      // way through — but a stack taller than eMax is drawn where it actually lands, climbing out of
      // the strip and up over the masses as resonance runs away. Clipping it at the top read as the
      // graph politely declining to answer; letting it swallow the animation is the honest picture,
      // and on this slide it is also the lesson (Daniel, 2026-08-26).
      const yOf = v => gy + gh - (v / this.eMax) * gh;
      const xOf = t => x0 + (Math.max(t0, Math.min(t1, t)) - t0) / this.gTail * (x1 - x0);
      const cum = h.map(p => ({ t: p.t, brk: p.brk, v: [p.ke1, p.ke1 + p.ke2, p.ke1 + p.ke2 + p.spe] }));
      const cols = [this.keCol[0], this.keCol[1], HOUSE.spring];
      const runs = []; let run = null;
      for (const c of cum) { if (!run || c.brk) { run = []; runs.push(run); } run.push(c); }
      for (let bi = cols.length - 1; bi >= 0; bi--) {      // painter's order, lowest band LAST: no seams
        ctx.save(); ctx.fillStyle = cols[bi];
        for (const rn of runs) {
          if (rn.length < 2) continue;
          ctx.beginPath(); ctx.moveTo(xOf(rn[0].t), gy + gh);
          for (const c of rn) ctx.lineTo(xOf(c.t), yOf(c.v[bi]));
          ctx.lineTo(xOf(rn[rn.length - 1].t), gy + gh); ctx.closePath(); ctx.fill();
        }
        ctx.restore();
      }
      timeAxis();
    }

    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H);
      const a = this.crashAlpha;
      if (a <= 0) return;                       // the beat: nothing on screen at all
      ctx.save(); ctx.globalAlpha = a;
      const s = CoupledMass.FORCE_SCALE;
      this._coil();
      // The third-law pair, from ONE scalar so the two can never disagree.
      const Fs = this._coupling();
      this._arrow(this.x1, 0, +Fs * s, 0, HOUSE.spring, 1);      // on m1, toward m2 when stretched
      this._arrow(this.x2, 0, -Fs * s, 0, HOUSE.spring, 1);      // on m2, the equal and opposite partner
      // The shaker, on m1 only. Light-blue = applied (roles.applied), never the velocity blue.
      this._arrow(this.x1, 0, this._drive(this.simT) * s, 0, HOUSE.applied, 1);
      // Blur first, so the after-images sit UNDER the body (house order).
      this._motionBlur(this.r1, k => this._backAt(this.simT - k * HOUSE.blurDt, "x1"));
      this._motionBlur(this.r2, k => this._backAt(this.simT - k * HOUSE.blurDt, "x2"));
      this._disc(this.x1, 0, this.r1, this.massCol[0], 1);
      this._disc(this.x2, 0, this.r2, this.massCol[1], 1);
      this._name(ctx, this.x1, this.r1, "m₁");     // first-year class: say which mass is which
      this._name(ctx, this.x2, this.r2, "m₂");
      if (this.showReadout) this._readout(ctx);
      this._graph(ctx);
      ctx.restore();
    }
  }
  // THE MASSES ARE FIXED (Daniel, 2026-08-25). Three sliders made this read as a dynamics-course
  // instrument rather than an intro-physics slide, and the mass dependence — real, and interesting —
  // is not what this class is for. A heavy body with a light one hanging off it also simply READS as a
  // neck, which is where the class is going. 5:1 puts the two radii at 1.7:1 on screen.
  CoupledMass.M1_DEF = 5.0;      // kg — the body. FIXED.
  CoupledMass.M2_DEF = 1.0;      // kg — the head. FIXED.
  CoupledMass.K_DEF = 14.0;      // N/m — ABOVE the node (9), so one downward drag walks
                                 // node (9) -> resonance (7.5) -> isolation, in board-4's order
  CoupledMass.WD = 3.0;          // rad/s — fixed drive; period ~2.1 s reads clearly from the back of the room
  CoupledMass.F0 = 20.0;         // N — sized against the COLLISION HEADROOM, not just against how big the
                               // default looks. The relative amplitude is F0/(m1*(wd^2 - omega^2)), which
                               // grows as k falls toward resonance, so F0 sets which k values can survive
                               // at all: at F0 = 16 with L0 = 3.4 the steady state at k = 4 already sat
                               // within 12% of the masses touching, and EVERY sweep collided no matter how
                               // fast — which reads as "the sim is fragile" rather than "resonance is".
  CoupledMass.ZETA_DEV = 0.30;   // damping on the WOBBLE only — free to be large, it vanishes at steady state
  CoupledMass.ZETA_RES = 0.030;  // the ordinary dashpot, which only has authority ON resonance
  CoupledMass.RES_BAND = 0.15;   // |omega^2 - wd^2|/omega^2 over which the two damping models blend.
                                 // Must stay BELOW the node's own distance from resonance (0.167 for
                                 // the fixed 5:1 pair) or the node falls inside the blend and the
                                 // ordinary dashpot spoils its zero — at 0.30 the node read 1.1% of
                                 // x2 instead of 0.01%. It must also stay ABOVE the collision band
                                 // (r < 0.09), so 0.15 is the widest value that clears both.
  CoupledMass.SLEW_TAU = 0.22;   // s — a click on a slider track becomes a ~0.7 s drag, which drops the
                                 // energy strip's kink at that instant from 39x the ordinary
                                 // frame-to-frame variation to under 4x. Longer buys little (0.30 s
                                 // only reaches 3x) and starts to read as a journey rather than a jump.
  CoupledMass.EMAX = 24.0;       // FIXED energy-axis ceiling (joules, world units) — see _freezeScale
  CoupledMass.L0 = 5.0;          // world m — spring natural length, i.e. the collision headroom is
                               // L0 - (r1 + r2) ~ 3.6. Chosen so the k in [5, 7] resonance neighbourhood
                               // collides and everything outside it survives, which is the behaviour the
                               // slide is about.
  CoupledMass.X1EQ = HOUSE.frameW * 0.30;  // m1 sits left of centre; m2 is L0 to its right, and the pair
                                 // then has symmetric room to swing before either leaves the frame
  CoupledMass.PLAY_WORLD_H = 4.2;
  CoupledMass.PLAY_CY = 0.40;    // the masses' centre line, as a fraction of the play area's height —
                                 // above the middle, leaving room beneath for the energy stack to climb
                                 // into as it overshoots near resonance
  CoupledMass.SUBSTEPS = 16;
  CoupledMass.SLOMO_K = 0.3;
  CoupledMass.CRASH_OUT_S = 0.16;   // s — fade the whole canvas down at contact. Short: this is a cut.
  CoupledMass.CRASH_HOLD_S = 0.50;  // s — the beat. Long enough to register as an event, short enough
                                    // not to read as a hang. The half second is doing all the work.
  CoupledMass.CRASH_IN_S = 0.35;    // s — fade back up on the fresh system, which is already running
  CoupledMass.SEED_CAP = 1.6;    // world m — a seed near resonance would open mid-collision
  CoupledMass.FORCE_SCALE = 0.09;
  CoupledMass.HEADROOM = 3.0;    // energy-axis headroom over the steady-state peak — see _freezeScale

  function mountCoupledMass(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", COUPLED_CONTROLS_HTML);
    const d = section.dataset;
    const canvas = section.querySelector(".simcanvas");
    const sim = new CoupledMass(canvas, {
      m1: d.m1 !== undefined ? +d.m1 : undefined,
      m2: d.m2 !== undefined ? +d.m2 : undefined,
      k: d.k !== undefined ? +d.k : undefined,
      wd: d.wd !== undefined ? +d.wd : undefined,
      slomo: d.slomo === "true"
    });
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;              // speaker-view copy: read-only
    // ONE SLIDER. The masses are FIXED — see the header for why; a slide that wants different ones
    // sets data-m1 / data-m2, but nobody moves them live.
    const rng = { k: q(".s-k") };
    const num = { k: q(".n-k") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    // The slider feeds the integrator. It does NOT re-seed — see the header.
    const apply = () => {
      sim.kT = +rng.k.value;
      if (sim.paused) { sim.k = sim.kT; sim.render(); }
    };
    rng.k.value = sim.k;
    Object.keys(rng).forEach(key => {
      const s = rng[key], n = num[key]; n.value = s.value;
      s.addEventListener("input", () => { n.value = s.value; apply(); });
      n.addEventListener("input", () => { const v = parseFloat(n.value); if (isNaN(v)) return; s.value = clamp(s, v); apply(); });
      n.addEventListener("change", () => { const v = parseFloat(n.value); n.value = isNaN(v) ? s.value : clamp(s, v); s.value = n.value; apply(); });
    });
    // The collision reset walks the controls home too, so the panel never disagrees with the physics.
    sim.onParams = (m1, m2, k) => { rng.k.value = k; num.k.value = k; };
    const playBtn = q(".play");
    const refreshPlay = () => { playBtn.textContent = sim.paused ? "▶ Play" : "⏸ Pause"; };
    sim.refreshPlayBtn = refreshPlay;
    playBtn.addEventListener("click", () => { sim.paused = !sim.paused; if (!sim.paused) sim.last = performance.now(); refreshPlay(); });
    q(".reset").addEventListener("click", () => {
      sim.k = sim.kT = CoupledMass.K_DEF;
      sim.onParams(sim.m1, sim.m2, sim.k);
      sim.crash = null;                       // cancel a collision cut in flight, or Reset does nothing
      sim.bhist = null;
      sim.reset(true); refreshPlay(); sim.render();
    });
    const slo = q(".slomo");
    if (slo) { slo.classList.toggle("on", sim.slomo); slo.addEventListener("click", () => { sim.slomo = !sim.slomo; slo.classList.toggle("on", sim.slomo); }); }
    const rt = q(".toggle-readout");
    if (rt) { rt.classList.toggle("on", sim.showReadout);
              rt.addEventListener("click", () => { sim.showReadout = !sim.showReadout; rt.classList.toggle("on", sim.showReadout); sim.render(); }); }
    apply();
    if (readonly) {
      canvas.style.pointerEvents = "none";
      [playBtn, q(".reset"), slo, rt, rng.k, num.k].forEach(el => { if (el) el.disabled = true; });
      const c = q(".simctrls"); if (c) c.style.opacity = ".4";
    }
    let raf = null;
    sim.start = () => { sim.everPlayed = true; if (raf) return; const loop = (now) => { sim.step(now); raf = requestAnimationFrame(loop); }; sim.last = performance.now(); raf = requestAnimationFrame(loop); };
    sim.stop = () => { if (raf) { cancelAnimationFrame(raf); raf = null; } };
    window.addEventListener("resize", () => { sim.resize(); sim.render(); });
    sim.render();
    return sim;
  }


  // ============================================================================================
  // Projectile2DPair (data-sim="projectile2d-pair") — Class D's comprehension check, made visible.
  // TWO balls launched at once from the origin, with their velocity COMPONENTS SWAPPED: ball A goes
  // <vx0, vy0>, ball B goes <vy0, vx0>. Sliders set vx0 and vy0 directly (not speed and angle) because
  // the whole argument is about the two components and about what happens when you exchange them.
  //
  // WHY IT EXISTS. `sim-2d` already sweeps one shot through theta and shows 45 degrees winning. That
  // demonstrates the maximum; it does NOT demonstrate the tie, because you cannot see two ranges at
  // once by playing one ball twice — the first arc is gone by the time the second lands. Here both are
  // in the air together, they trace visibly different paths, one is still climbing while the other is
  // already down, and they finish on the same tick on the ground line. Range is 2·vx0·vy0/g and a
  // product does not care which factor is which; the two hang times, 2·vy0/g and 2·vx0/g, differ.
  //
  // THE BALLS DO NOT INTERACT, and nothing here pretends they do — two independent analytic
  // parabolas drawn in one frame.
  //
  // COLOUR IS ROLE, NOT IDENTITY (style/STYLE.md), so both balls are HOUSE.mass and both launch
  // arrows are HOUSE.velocity — giving ball B its own hue would be inventing a second physical role
  // that does not exist. They are told apart by their arrows and their paths; there are no A/B labels,
  // because the point of the slide is that the two are interchangeable.
  //
  // EITHER ARROW IS DRAGGABLE. Grab one tip and you set that arrow's own components; the other follows,
  // swapped, because the pair is pinned to be each other's converse.
  //
  // EACH COMPONENT CAPS AT 28 m/s, not 40. The frame is the same FIXED 165 m as `sim-2d`, whose cap is
  // on the SPEED; here the sliders are the components, and 28 m/s each is a speed of 39.6 — the same
  // shot, so the widest possible range (160 m) still just fills the screen instead of flying off it.
  // The axes do NOT follow the shot. An auto-fitting frame kept the arcs large, but it also meant the
  // ruler changed every time a slider moved, so two settings could not be compared by eye — which is
  // the whole job here. Frozen axes, same as `sim-2d`.
  // ============================================================================================
  class Projectile2DPair extends Projectile2D {
    constructor(canvas, opts = {}) {
      super(canvas, opts);
      this.u0 = opts.u0 ?? 10;      // vx0 of ball A (= vy0 of ball B)
      this.v0 = opts.v0 ?? 20;      // vy0 of ball A (= vx0 of ball B)
      this.maxComp = opts.maxComp ?? 28;
      this.showReadout = false;
    }
    _legs() { return [{ u: this.u0, v: this.v0 }, { u: this.v0, v: this.u0 }]; }
    _srcOf(leg) { return { x0: 0, y0: 0, u0: leg.u, v0: leg.v, g: this.g }; }
    get range() { return this.g > 0 ? 2 * this.u0 * this.v0 / this.g : 0; }
    play() {
      this.L = { x0: 0, y0: 0, u0: this.u0, v0: this.v0, g: this.g };
      // run until the SLOWER of the two is down, so nothing vanishes mid-flight
      this.tLand = Math.max(this._landTime(0, this.u0, this.g), this._landTime(0, this.v0, this.g));
      this.t = 0; this.running = true; this.paused = false; this.landed = false;
      this.everPlayed = true; this.last = performance.now();
    }
    _at(leg, t) { return { x: leg.u * t, y: leg.v * t - 0.5 * this.g * t * t }; }
    // EITHER TIP IS GRABBABLE. The base class only knows one velocity arrow; here there are two, and
    // they are locked converses, so dragging B is dragging A with the components exchanged. Nearest
    // tip wins, which keeps the two separable even when vx0 and vy0 are close (and when they are
    // equal the arrows coincide and it does not matter which one you get).
    _bindDrag() {
      let leg = null;                       // 0 = the <vx0, vy0> arrow, 1 = its converse
      const toWorld = (ev) => {
        const r = this.c.getBoundingClientRect();
        const px = (ev.clientX - r.left) / r.width * this.W, py = (ev.clientY - r.top) / r.height * this.H;
        return { x: (px - this.ox) / this.scale, y: ((this.H - this.padB) - py) / this.scale };
      };
      const tipOf = (l) => ({ x: l.u * this.velWorldPerMS, y: l.v * this.velWorldPerMS });
      this.c.addEventListener("pointerdown", (ev) => {
        if (this.running || !this._velShown()) return;
        const w = toWorld(ev);
        let best = null, bestD = Infinity;
        this._legs().forEach((l, i) => {
          const t = tipOf(l), d = Math.hypot(w.x - t.x, w.y - t.y);
          if (d < bestD) { bestD = d; best = i; }
        });
        leg = bestD < Math.max(this.frameW * 0.03, this.radius * 2) ? best : null;
        if (leg !== null) this.c.setPointerCapture?.(ev.pointerId);
      });
      this.c.addEventListener("pointermove", (ev) => {
        if (leg === null) return;
        const w = toWorld(ev);
        // the DRAGGED arrow's own components, first quadrant only, each capped at the slider max
        const lim = (q) => Math.max(0, Math.min(this.maxComp, q));
        const a = lim(w.x / this.velWorldPerMS), b = lim(w.y / this.velWorldPerMS);
        if (leg === 0) { this.u0 = a; this.v0 = b; } else { this.u0 = b; this.v0 = a; }
        this.landed = false;
        if (this.onVecChange) this.onVecChange(this.u0, this.v0);   // → the vx0 / vy0 sliders, rounded
        this.render();
      });
      window.addEventListener("pointerup", () => { leg = null; });
    }
    render() {
      const ctx = this.ctx; ctx.clearRect(0, 0, this.W, this.H); this._axes();
      const active = this.running || this.landed;
      const legs = this._legs();
      // dashed predicted parabolas first, then the shared landing tick, then the bodies on top
      for (const leg of legs) {
        const src = this._srcOf(leg);
        ctx.save(); ctx.globalAlpha = 0.32;
        this._path(src, 0, this._landTime(0, leg.v, this.g), HOUSE.velocity, 2, [9, 8]);
        ctx.restore();
      }
      if (this.g > 0) this._rangeTick(this.range);
      for (const leg of legs) {
        const src = this._srcOf(leg);
        const tLeg = this._landTime(0, leg.v, this.g);
        const tNow = active ? Math.min(this.t, tLeg) : 0;
        if (active) {
          this._trail(src, tNow);
          this._motionBlur(this.radius, k => {
            const tk = tNow - k * HOUSE.blurDt;
            return tk < 0 ? null : this._at(leg, tk);
          });
        }
        if (this._velShown()) this._velArrow(0, 0, leg.u, leg.v);
        const p = active ? this._at(leg, tNow) : { x: 0, y: 0 };
        this._disc(p.x, p.y, this.radius, HOUSE.mass, 1);
        if (this.g > 0) this._arrow(p.x, p.y, 0, -this._forceLen(this.g), HOUSE.gravity, 1);
      }
    }
  }

  // NO g SLIDER, unlike `sim-2d`. Two reasons, and the second is the real one. The labels here are long
  // — each names both balls — so a third control wrapped the bar onto two rows at 1280. And this slide
  // is not asking a question about gravity: it is asking whether swapping the two components changes
  // the range, and the answer (a product does not care which factor is which) is the same on the moon.
  // `data-g` still sets it, so a slide can open on another world; nothing on screen can change it.
  //
  // SLIDER LABELS NAME BOTH BALLS. Each slider is one number wearing two hats — the first is ball 1's
  // x-component AND ball 2's y-component, the second is ball 2's x AND ball 1's y — and saying that on
  // the label is the cheapest way to make the swap legible without putting identity tags back on the
  // canvas. Note the second slider is labelled from ball 2's point of view but still sets `v0`, ball
  // 1's vertical component; they are the same number, which is the point.
  const CONTROLS_PAIR_HTML = `
      <canvas class="simcanvas"></canvas>
      <div class="simctrls">
        <button class="simbtn play">▶ Play</button>
        <button class="simbtn reset">↺ Reset</button>
        <button class="simbtn slomo" title="Slow motion">🐢</button>
        <label><span class="var"><i>v</i><sub><i>x</i>01</sub> (<i>v</i><sub><i>y</i>02</sub>):</span> <input type="range" class="s-vx" min="0" max="28" step="1"><input type="number" class="n-vx" step="1"><span class="u">m/s</span></label>
        <label><span class="var"><i>v</i><sub><i>x</i>02</sub> (<i>v</i><sub><i>y</i>01</sub>):</span> <input type="range" class="s-vy" min="0" max="28" step="1"><input type="number" class="n-vy" step="1"><span class="u">m/s</span></label>
      </div>`;

  function mountProjectile2DPair(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", CONTROLS_PAIR_HTML);
    const d = section.dataset;
    const sim = new Projectile2DPair(section.querySelector(".simcanvas"), {
      g: d.g !== undefined ? +d.g : 9.8,
      frameW: d.framew !== undefined ? +d.framew : undefined,
      u0: d.vx0 !== undefined ? +d.vx0 : undefined,
      v0: d.vy0 !== undefined ? +d.vy0 : undefined,
      slomo: d.slomo !== "false"
    });
    const q = s => section.querySelector(s);
    const rng = { vx: q(".s-vx"), vy: q(".s-vy") };
    const num = { vx: q(".n-vx"), vy: q(".n-vy") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
    rng.vx.value = sim.u0; rng.vy.value = sim.v0;
    sim.maxComp = +rng.vx.max;
    // Arrow drag → the two component sliders. Snap the sim to the rounded values as well: the sliders
    // step by 1, and `apply()` re-reads them on Play, so an unrounded drag would jump on launch.
    sim.onVecChange = (vx, vy) => {
      const a = Math.round(vx), b = Math.round(vy);
      rng.vx.value = a; num.vx.value = a; rng.vy.value = b; num.vy.value = b;
      sim.u0 = a; sim.v0 = b;
    };
    const apply = () => {
      sim.u0 = +rng.vx.value; sim.v0 = +rng.vy.value;      // g is fixed on this sim — see above
      if (!sim.running) { sim.landed = false; sim.render(); }
    };
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
    apply();
    if (window.self !== window.top) {                 // framed (the published site): look, don't touch
      sim.c.style.pointerEvents = "none";
      [playBtn, q(".reset"), slo, rng.vx, rng.vy, num.vx, num.vy].forEach(el => { if (el) el.disabled = true; });
      const ctrls = q(".simctrls"); if (ctrls) ctrls.style.opacity = ".4";
    }
    // THE ANIMATION LOOP. Every other mount ends with this and it is not optional: deck.js calls
    // sim.start()/sim.stop() as the slide comes and goes, and without it the sim mounts, renders once,
    // accepts a click on Play (the button even flips to Pause) and then never moves.
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

  // Dispatcher: pick the preset from data-sim (default projectile).
  // The closed vocabulary of data-sim values, so mount() can tell "no attribute" (fall back to the
  // projectile, as it always has) from "an attribute nobody implemented" (say so). Keep in step with
  // the branches below, and with DESIGN.md's sim catalog.
  const SIM_KINDS = new Set([
    "projectile", "elevator", "handlift", "normal", "handlift-energy", "handliftenergy",
    "projectile2d", "2d", "projectile2d-pair", "pair2d",
    "deflect", "game", "circle", "circular", "oscillator", "spring",
    "oscillator-game", "springgame", "attractor2d", "attractor", "launcher", "launchergame",
    "platformbounce", "frictionramp", "coupledmass"
  ]);

  function mount(section) {
    const kind = (section.dataset.sim || "projectile").toLowerCase();
    // An UNRECOGNISED data-sim used to fall through to the projectile at the bottom of this chain, so a
    // slide asking for a preset that does not exist quietly showed different physics and looked fine —
    // which is exactly how Class J's handlift-energy slide came to be running Class B's launch. A
    // fallback is right for a MISSING attribute and wrong for a wrong one; say so, on the slide.
    if (section.dataset.sim !== undefined && !SIM_KINDS.has(kind)) {
      console.error("[interactive] unknown data-sim:", kind);
      section.insertAdjacentHTML("beforeend",
        '<div class="simerror" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);' +
        'font:600 calc(var(--size-body) * 720px)/1.4 var(--font-sans, Inter, sans-serif);' +
        'color:var(--mma-red,#eb6235);text-align:center;">unknown <code>data-sim="' + kind + '"</code><br>' +
        '<span style="font-size:.7em;color:var(--muted,#888)">no preset by that name in interactive.js</span></div>');
      return null;
    }
    if (kind === "elevator" || kind === "handlift" || kind === "normal") return mountHandLift(section);
    if (kind === "handlift-energy" || kind === "handliftenergy") return mountHandLiftEnergy(section);
    if (kind === "projectile2d-pair" || kind === "pair2d") return mountProjectile2DPair(section);
    if (kind === "projectile2d" || kind === "2d")
      return section.dataset.drag !== undefined ? mountProjectile2DDrag(section) : mountProjectile2D(section);
    if (kind === "deflect" || kind === "game") return mountDeflect(section);
    if (kind === "circle" || kind === "circular") return mountCircle(section);
    if (kind === "oscillator" || kind === "spring") return mountOscillator(section);
    if (kind === "oscillator-game" || kind === "springgame") return mountSpringGame(section);
    if (kind === "attractor2d" || kind === "attractor") return mountAttractor2D(section);
    if (kind === "launcher" || kind === "launchergame") return mountLauncherGame(section);
    if (kind === "platformbounce") return mountPlatformBounce(section);
    if (kind === "frictionramp") return mountFrictionRamp(section);
    if (kind === "coupledmass") return mountCoupledMass(section);
    return mountProjectile(section);
  }

  function mountProjectile(section) {
    const dragMode = section.dataset.drag !== undefined;          // Class K: swap in the C_d / A_perp sliders
    if (dragMode) return mountProjectileDrag(section);
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

  // ---- Class K mounts: the same two presets, with drag and the two-slider control bar --------------
  // Factored out rather than branched inline so the drag-free mounts above are byte-for-byte untouched.
  function _wireDragSliders(section, sim, apply, extraDisable) {
    const q = s => section.querySelector(s);
    const readonly = window.self !== window.top;
    const rng = { cd: q(".s-cd"), area: q(".s-area") };
    const num = { cd: q(".n-cd"), area: q(".n-area") };
    const clamp = (el, v) => Math.max(+el.min, Math.min(+el.max, v));
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
      sim.c.style.pointerEvents = "none";
      [playBtn, q(".reset"), slo, rt, rng.cd, rng.area, num.cd, num.area].concat(extraDisable || [])
        .forEach(el => { if (el) el.disabled = true; });
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
    return { rng, num };
  }

  // 1-D free fall with drag (Class K `sim-freefall`). Opens with C_d = 0 — the Class B ball — so the
  // first slider push is the moment drag enters the course.
  function mountProjectileDrag(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", DRAG_CONTROLS_HTML);
    const d = section.dataset;
    const sim = new Projectile(section.querySelector(".simcanvas"), {
      v0: d.v0 !== undefined ? +d.v0 : 0,
      mass: d.mass !== undefined ? +d.mass : 1,
      g: d.g !== undefined ? +d.g : 9.8,
      y0: d.y0 !== undefined ? +d.y0 : 5,
      focusY: d.focus !== undefined ? +d.focus : undefined,
      dragMode: true,
      slomo: d.slomo !== "false"
    });
    const q = s => section.querySelector(s);
    q(".s-cd").value = d.cd !== undefined ? +d.cd : 0;
    q(".s-area").value = d.area !== undefined ? +d.area : 0.4;
    const apply = () => {
      const cd = +q(".s-cd").value, area = +q(".s-area").value;
      sim.beta = betaOf(cd, area);
      sim.area = area;                     // the disc reads this — see Projectile.radius
      if (!sim.running) sim.render();
    };
    _wireDragSliders(section, sim, apply);
    return sim;
  }

  // 2-D projectile with drag (Class K `sim-2d`). Speed and angle are LOCKED at the Class D record
  // throw (40 m/s @ 45°) so the only thing that changes on screen is the drag.
  function mountProjectile2DDrag(section) {
    if (!section.querySelector(".simcanvas")) section.insertAdjacentHTML("beforeend", DRAG_CONTROLS_2D_HTML);
    const d = section.dataset;
    const speed = d.speed !== undefined ? +d.speed : 40;
    const theta = (d.theta !== undefined ? +d.theta : 45) * Math.PI / 180;
    const sim = new Projectile2D(section.querySelector(".simcanvas"), {
      g: d.g !== undefined ? +d.g : 9.8,
      mass: d.mass !== undefined ? +d.mass : 0.145,
      frameW: d.framew !== undefined ? +d.framew : undefined,
      lockVec: d.lock !== undefined,
      dragMode: true,
      slomo: d.slomo !== "false"
    });
    sim.u0 = speed * Math.cos(theta); sim.v0 = speed * Math.sin(theta);
    const q = s => section.querySelector(s);
    q(".s-cd").value = d.cd !== undefined ? +d.cd : 0;
    q(".s-area").value = d.area !== undefined ? +d.area : 42;    // cm² — a real baseball
    const apply = () => {
      const cd = +q(".s-cd").value, area = +q(".s-area").value * 1e-4;    // cm² → m²
      sim.beta = betaOf(cd, area);
      sim.area = area;                     // the disc reads this — see Projectile2D.radius
      if (!sim.running) { sim.landed = false; sim.render(); }
    };
    _wireDragSliders(section, sim, apply);
    return sim;
  }

  window.Interactive = { Projectile, Projectile2D, HandLift, HandLiftEnergy, DeflectGame, Circular, Oscillator, SpringGame, Attractor2D, LauncherGame, PlatformBounce, FrictionRamp, CoupledMass, mount, HOUSE, betaOf, dragStep, dragAdvance, histAt };
})();
