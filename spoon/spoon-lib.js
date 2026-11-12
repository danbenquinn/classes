// ─────────────────────────────────────────────────────────────
// Spoon analysis, shared by viewer.html (and testable on its own).
// Coordinates: "page" = millimeters on the printed sheet (origin lower-left, y up), from spoon-geom.js;
// "image" = pixels in a camera frame (origin top-left, y down).
// ─────────────────────────────────────────────────────────────
const SpoonLib = (() => {
  const G = SPOON_GEOM;

  // ── homography: page mm -> image px, from 4 point pairs ──────
  function solve(A, b) {           // Gaussian elimination with partial pivoting, n×n
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let p = i;
      for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[p][i])) p = r;
      [A[i], A[p]] = [A[p], A[i]]; [b[i], b[p]] = [b[p], b[i]];
      if (Math.abs(A[i][i]) < 1e-12) return null;
      for (let r = i + 1; r < n; r++) {
        const f = A[r][i] / A[i][i];
        for (let c = i; c < n; c++) A[r][c] -= f * A[i][c];
        b[r] -= f * b[i];
      }
    }
    const x = new Array(n);
    for (let i = n - 1; i >= 0; i--) {
      let s = b[i];
      for (let c = i + 1; c < n; c++) s -= A[i][c] * x[c];
      x[i] = s / A[i][i];
    }
    return x;
  }
  function homography(src, dst) {   // src[i] -> dst[i], 4 pairs
    const A = [], b = [];
    for (let i = 0; i < 4; i++) {
      const [x, y] = src[i], [u, v] = dst[i];
      A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u);
      A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v);
    }
    const h = solve(A, b);
    return h && [...h, 1];
  }
  function apply(H, x, y) {
    const w = H[6] * x + H[7] * y + H[8];
    return [(H[0] * x + H[1] * y + H[2]) / w, (H[3] * x + H[4] * y + H[5]) / w];
  }

  // ── find the four black squares ─────────────────────────────
  // Works on a downsampled gray copy. Returns {pts:[TL,TR,BR,BL] in image px, H} or null.
  function findSquares(img, prev) {
    const { width: W, height: Hh, data } = img;
    const step = Math.max(1, Math.round(Math.max(W, Hh) / 480));
    const w = Math.floor(W / step), h = Math.floor(Hh / step);
    const gray = new Float32Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = ((y * step) * W + x * step) * 4;
      gray[y * w + x] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    // paper level = 90th percentile; dark = below 40% of it
    const sorted = Float32Array.from(gray).sort();
    const paper = sorted[Math.floor(sorted.length * 0.9)];
    const thr = 0.4 * paper;
    const lab = new Int32Array(w * h), blobs = [];
    const stack = [];
    for (let s = 0; s < w * h; s++) {
      if (lab[s] || gray[s] >= thr) continue;
      const id = blobs.length + 1;
      let n = 0, sx = 0, sy = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
      lab[s] = id; stack.push(s);
      while (stack.length) {
        const q = stack.pop(), qx = q % w, qy = (q - qx) / w;
        n++; sx += qx; sy += qy;
        if (qx < x0) x0 = qx; if (qx > x1) x1 = qx; if (qy < y0) y0 = qy; if (qy > y1) y1 = qy;
        const nb = [q - 1, q + 1, q - w, q + w];
        if (qx === 0) nb[0] = -1; if (qx === w - 1) nb[1] = -1;
        for (const r of nb) if (r >= 0 && r < w * h && !lab[r] && gray[r] < thr) { lab[r] = id; stack.push(r); }
      }
      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      blobs.push({ n, cx: (sx / n + 0.5) * step, cy: (sy / n + 0.5) * step, fill: n / (bw * bh), ar: bw / bh,
        edge: x0 === 0 || y0 === 0 || x1 === w - 1 || y1 === h - 1 });
    }
    // square-ish, solid, not touching the frame edge, not tiny
    const cand = blobs.filter((b) => b.n >= 12 && b.fill > 0.6 && b.ar > 0.35 && b.ar < 2.8 && !b.edge)
      .sort((a, b) => b.n - a.n).slice(0, 9);
    if (cand.length < 4) return null;
    let best = null;
    const k = cand.length;
    for (let a = 0; a < k; a++) for (let b = a + 1; b < k; b++) for (let c = b + 1; c < k; c++) for (let d = c + 1; d < k; d++) {
      const quad = [cand[a], cand[b], cand[c], cand[d]];
      const r = scoreQuad(quad, step, img);
      if (r && (!best || r.score < best.score)) best = r;
    }
    return best && best.score < 3 ? best : null;
  }
  function order4(pts) {   // TL, TR, BR, BL in image coords
    const s = pts.map((p) => p[0] + p[1]), d = pts.map((p) => p[0] - p[1]);
    const i = (arr, f) => arr.indexOf(f(...arr));
    return [pts[i(s, Math.min)], pts[i(d, Math.max)], pts[i(s, Math.max)], pts[i(d, Math.min)]];
  }
  function scoreQuad(quad, step, img) {
    const pts = order4(quad.map((b) => [b.cx, b.cy]));
    if (new Set(pts).size < 4) return null;
    // Fixed orientation (Daniel, 2026-11-11): the bowl always points at squares 3 and 4, and the phone looks
    // from the bowl end, so 3 and 4 are the bottom pair in the picture. No rotation search. The gray patch
    // only helps reject a wrong set of four blobs.
    const dst = pts;
    const H = homography(G.squares, dst);
    if (!H) return null;
    let err = 0;
    for (let j = 0; j < 4; j++) {   // each blob's area vs the area a 10 mm square should have there
      const [x, y] = G.squares[j], hs = G.squareSide / 2;
      const p = [[x - hs, y - hs], [x + hs, y - hs], [x + hs, y + hs], [x - hs, y + hs]].map(([a, b]) => apply(H, a, b));
      let area = 0;
      for (let m = 0; m < 4; m++) { const [x1, y1] = p[m], [x2, y2] = p[(m + 1) % 4]; area += x1 * y2 - x2 * y1; }
      area = Math.abs(area) / 2 / (step * step);
      const blob = quad.find((b) => b.cx === dst[j][0] && b.cy === dst[j][1]);
      err += Math.abs(Math.log(blob.n / area));
    }
    const g = sampleDisk(img, H, G.gray[0], G.gray[1], 2.5), pw = paperWhite(img, H);
    if (!g || !pw) return null;
    const ratio = (g[0] + g[1] + g[2]) / (pw[0] + pw[1] + pw[2]);
    return { score: err + 2 * Math.abs(ratio - 0.57), pts: dst, H, grayRatio: ratio };
  }

  // ── sampling ────────────────────────────────────────────────
  function px(img, x, y) {
    const xi = Math.round(x), yi = Math.round(y);
    if (xi < 0 || yi < 0 || xi >= img.width || yi >= img.height) return null;
    const i = (yi * img.width + xi) * 4, d = img.data;
    return [d[i], d[i + 1], d[i + 2]];
  }
  function sampleDisk(img, H, X, Y, r) {   // mean RGB over a disk of radius r mm on the page
    let s = [0, 0, 0], n = 0;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
      if (i * i + j * j > 9) continue;
      const [x, y] = apply(H, X + r * i / 3, Y + r * j / 3), c = px(img, x, y);
      if (c) { s[0] += c[0]; s[1] += c[1]; s[2] += c[2]; n++; }
    }
    return n ? s.map((v) => v / n) : null;
  }
  function paperWhite(img, H) {
    const c = G.paper.map(([x, y]) => sampleDisk(img, H, x, y, 3)).filter(Boolean);
    if (!c.length) return null;
    return [0, 1, 2].map((k) => c.reduce((a, v) => a + v[k], 0) / c.length);
  }
  // per-point colors, each channel divided by the paper's (takes out exposure and white-balance drift)
  function readPoints(img, H) {
    const w = paperWhite(img, H);
    return G.points.map((p) => {
      const c = sampleDisk(img, H, p.xy[0], p.xy[1], 1.5);
      return c ? [c[0] / w[0], c[1] / w[1], c[2] / w[2]] : [NaN, NaN, NaN];
    });
  }
  // 0 = the cold color, 1 = the warm color, measured along the line between them
  function progress(c, cold, warm) {
    const d = [warm[0] - cold[0], warm[1] - cold[1], warm[2] - cold[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (dd < 1e-4) return NaN;
    return ((c[0] - cold[0]) * d[0] + (c[1] - cold[1]) * d[1] + (c[2] - cold[2]) * d[2]) / dd;
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  // ── straightened top-down copy of the spoon region, paper-normalized ──
  const RECT = { x0: G.axis.cx - 20, x1: G.axis.cx + 20, y0: G.axis.tipY - 3, y1: G.axis.tipY + G.axis.length + 3, ppm: 4 };
  function rectify(img, H) {
    const w = Math.round((RECT.x1 - RECT.x0) * RECT.ppm), h = Math.round((RECT.y1 - RECT.y0) * RECT.ppm);
    const pw = paperWhite(img, H), out = new Float32Array(w * h * 3);
    for (let v = 0; v < h; v++) for (let u = 0; u < w; u++) {
      const X = RECT.x0 + (u + 0.5) / RECT.ppm, Y = RECT.y1 - (v + 0.5) / RECT.ppm;
      const [x, y] = apply(H, X, Y), c = px(img, x, y), o = (v * w + u) * 3;
      if (c) { out[o] = c[0] / pw[0]; out[o + 1] = c[1] / pw[1]; out[o + 2] = c[2] / pw[2]; }
    }
    return { w, h, data: out };
  }
  let maskCache = null;
  function spoonMask(w, h) {   // inside the outline, shrunk 1.5 mm
    if (maskCache && maskCache.w === w && maskCache.h === h) return maskCache.m;
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#fff"; g.beginPath();
    G.outline.forEach(([X, Y], i) => {
      const u = (X - RECT.x0) * RECT.ppm, v = (RECT.y1 - Y) * RECT.ppm;
      i ? g.lineTo(u, v) : g.moveTo(u, v);
    });
    g.closePath(); g.fill();
    g.globalCompositeOperation = "destination-out"; g.lineWidth = 2 * 1.5 * RECT.ppm; g.strokeStyle = "#000"; g.stroke();
    const d = g.getImageData(0, 0, w, h).data, m = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) m[i] = d[i * 4 + 3] > 128 ? 1 : 0;
    maskCache = { w, h, m };
    return m;
  }
  // per-pixel progress map, drawn into a canvas: blue = cold, red = room temperature
  function drawMap(canvas, cur, cold, warm) {
    const { w, h } = cur; canvas.width = w; canvas.height = h;
    const g = canvas.getContext("2d"), im = g.createImageData(w, h), m = spoonMask(w, h);
    for (let i = 0; i < w * h; i++) {
      const o = i * 4;
      if (!m[i]) { im.data[o] = im.data[o + 1] = im.data[o + 2] = 0; im.data[o + 3] = 0; continue; }
      const k = i * 3;
      let f = progress([cur.data[k], cur.data[k + 1], cur.data[k + 2]],
        [cold.data[k], cold.data[k + 1], cold.data[k + 2]], [warm.data[k], warm.data[k + 1], warm.data[k + 2]]);
      f = isNaN(f) ? 0.5 : Math.max(0, Math.min(1, f));
      im.data[o] = 30 + 210 * f; im.data[o + 1] = 40; im.data[o + 2] = 240 - 200 * f; im.data[o + 3] = 255;
    }
    g.putImageData(im, 0, 0);
  }

  return { G, homography, apply, findSquares, readPoints, paperWhite, progress, dist, rectify, drawMap, RECT };
})();
