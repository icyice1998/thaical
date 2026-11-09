// Deterministic frame renderer: BR.init(timeline) then BR.render(frameIndex) draws one 1080x1920 frame.
// The 3D view is a textured raycaster at 270x295, upscaled 4x for the retro pixel look.
const BR = (() => {
  const OUT_W = 1080, OUT_H = 1920;
  const VIEW_H = 1180, W = 270, H = 295, SCALE = 4;
  const FOV = 1.15, F = (W / 2) / Math.tan(FOV / 2);
  const T = 64; // texture size

  let TL, fps, out, octx, low, lctx, img, buf, zbuf;
  const tex = {}, sprites = {}, scenes = {};
  let camTrack = []; // per-frame {x,y,dx,dy,gx,gy,scene}

  // ---------- deterministic helpers ----------
  const hash = (a, b = 0, c = 0) => {
    let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const rng = seed => () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const rgb = (r, g, b) => (255 << 24) | (clamp(b, 0, 255) << 16) | (clamp(g, 0, 255) << 8) | clamp(r, 0, 255);
  const hex = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

  // ---------- textures ----------
  function makeTex(fn, seed = 1) {
    const r = rng(seed), d = new Uint32Array(T * T);
    for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) d[y * T + x] = fn(x, y, r);
    return d;
  }
  function buildTextures() {
    tex.yWall = makeTex((x, y, r) => {
      const n = r() * 14 - 7;
      const stripe = (x % 8 < 1) ? -10 : 0;
      const chev = ((x + Math.abs((y % 16) - 8)) % 16 < 2) ? 8 : 0;
      const grime = y > 40 ? -(y - 40) * 0.6 : 0;
      if (y > 58) return rgb(110 + n, 92 + n, 50 + n);
      return rgb(200 + n + stripe + chev + grime, 184 + n + stripe + chev + grime, 96 + n * 0.6 + stripe + grime);
    }, 11);
    tex.carpet = makeTex((x, y, r) => {
      const blot = Math.sin(x * 0.3) * Math.cos(y * 0.25) * 10 + Math.sin((x + y) * 0.11) * 8;
      const n = r() * 26 - 13 + blot;
      return rgb(120 + n, 102 + n, 70 + n * 0.8);
    }, 12);
    tex.yCeil = makeTex((x, y, r) => {
      const n = r() * 10 - 5;
      if (x % 32 === 0 || y % 32 === 0) return rgb(120, 118, 100);
      const dots = r() < 0.08 ? -18 : 0;
      return rgb(178 + n + dots, 174 + n + dots, 150 + n + dots);
    }, 13);
    tex.gWall = makeTex((x, y, r) => {
      const n = r() * 8 - 4;
      if (y >= 26 && y <= 29) return rgb(90 + n, 80 + n, 70 + n); // handrail
      if (y < 26) return rgb(214 + n, 210 + n, 190 + n);
      if (x % 12 === 0 || (y - 30) % 12 === 0) return rgb(96, 128, 110);
      return rgb(128 + n, 170 + n, 146 + n);
    }, 21);
    tex.vinyl = makeTex((x, y, r) => {
      const n = r() * 12 - 6, sp = r() < 0.05 ? -30 : 0;
      if (x % 32 === 0 || y % 32 === 0) return rgb(150, 152, 148);
      return rgb(186 + n + sp, 190 + n + sp, 184 + n + sp);
    }, 22);
    tex.wCeil = makeTex((x, y, r) => {
      const n = r() * 6 - 3;
      if (x % 32 === 0 || y % 32 === 0) return rgb(160, 162, 160);
      return rgb(222 + n, 224 + n, 218 + n);
    }, 23);
    tex.door = makeTex((x, y, r) => {
      const n = r() * 8 - 4;
      if (y < 9) return rgb(200 + n, 30, 30); // red header band
      if (x < 3 || x > 60) return rgb(150, 150, 146);
      if (x === 31 || x === 32) return rgb(90, 90, 90);
      const win = (y > 18 && y < 34) && ((x > 10 && x < 25) || (x > 38 && x < 53));
      if (win) return rgb(255, 250, 225); // light leaking through
      if (y > 36 && y < 39 && ((x > 22 && x < 28) || (x > 35 && x < 41))) return rgb(70, 70, 70);
      return rgb(176 + n, 196 + n, 200 + n);
    }, 24);
    tex.mWall = makeTex((x, y, r) => { // ward side-room wall (cream + green base)
      const n = r() * 8 - 4;
      if (y > 50) return rgb(120 + n, 160 + n, 138 + n);
      return rgb(206 + n, 204 + n, 186 + n);
    }, 25);
  }

  // ---------- sprites (procedural pixel art on tiny canvases) ----------
  function canvasPix(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; draw(g);
    return { w, h, c, d: new Uint32Array(g.getImageData(0, 0, w, h).data.buffer) };
  }
  const R = (g, col, x, y, w, h) => { g.fillStyle = col; g.fillRect(x, y, w, h); };

  // มายด์: resident doctor in teal scrubs, ponytail, stethoscope
  function drawMind(g, view, phase) {
    const skin = '#e9b896', skinS = '#c99273', hair = '#1d1512', scrub = '#2f9c96', scrubS = '#22746f', shoe = '#f2f2f2';
    const bob = (phase % 2) ? 1 : 0;
    const legA = [0, 2, 0, -2][phase % 4], legB = -legA;
    const oy = bob;
    // legs
    R(g, scrub, 6, 27 + oy, 3, 9 + Math.min(0, legA)); R(g, scrub, 11, 27 + oy, 3, 9 + Math.min(0, legB));
    R(g, scrubS, 8, 27 + oy, 1, 8);
    R(g, shoe, 5 + (legA > 0 ? 0 : 0), 36 + oy + Math.min(0, legA), 4, 2); R(g, shoe, 11, 36 + oy + Math.min(0, legB), 4, 2);
    // torso
    R(g, scrub, 4, 14 + oy, 12, 14); R(g, scrubS, 4, 25 + oy, 12, 2);
    // arms swing
    R(g, scrub, 2, 14 + oy + Math.max(0, legB / 2), 2, 7); R(g, skin, 2, 21 + oy + Math.max(0, legB / 2), 2, 4);
    R(g, scrub, 16, 14 + oy + Math.max(0, legA / 2), 2, 7); R(g, skin, 16, 21 + oy + Math.max(0, legA / 2), 2, 4);
    // neck + head
    R(g, skinS, 8, 12 + oy, 4, 2);
    if (view === 'front') {
      R(g, '#1a5e5a', 8, 14 + oy, 4, 3); R(g, skin, 9, 14 + oy, 2, 2); // V-neck
      R(g, '#333', 6, 14 + oy, 1, 6); R(g, '#333', 13, 14 + oy, 1, 6); R(g, '#888', 7, 20 + oy, 6, 1); // stethoscope
      R(g, '#fff', 13, 17 + oy, 2, 3); // ID badge
      R(g, hair, 5, 2 + oy, 10, 4); R(g, skin, 6, 4 + oy, 8, 8); R(g, hair, 5, 4 + oy, 1, 6); R(g, hair, 14, 4 + oy, 1, 6);
      R(g, hair, 6, 3 + oy, 8, 2);
      R(g, '#111', 7, 7 + oy, 2, 1); R(g, '#111', 11, 7 + oy, 2, 1); R(g, '#b0584e', 9, 10 + oy, 2, 1);
    } else {
      R(g, hair, 5, 2 + oy, 10, 10); R(g, '#2c201a', 8, 3 + oy, 4, 8);
      R(g, hair, 8, 11 + oy, 4, 5); R(g, '#ffd166', 8, 11 + oy, 4, 1); // ponytail + scrunchie
      R(g, '#333', 6, 14 + oy, 8, 1);
    }
  }
  function drawEntity(g) {
    R(g, '#050505', 6, 0, 8, 9); R(g, '#050505', 4, 9, 12, 26); R(g, '#050505', 2, 10, 2, 22); R(g, '#050505', 16, 10, 2, 22);
    R(g, '#050505', 5, 35, 3, 13); R(g, '#050505', 12, 35, 3, 13); R(g, '#050505', 1, 30, 2, 8); R(g, '#050505', 17, 30, 2, 8);
    R(g, '#fffef0', 7, 3, 2, 2); R(g, '#fffef0', 11, 3, 2, 2);
    R(g, '#fffef0', 6, 6, 8, 1); R(g, '#fffef0', 6, 5, 1, 1); R(g, '#fffef0', 13, 5, 1, 1);
    for (let i = 7; i < 13; i += 2) R(g, '#050505', i, 6, 1, 1);
  }
  function drawBed(g) {
    R(g, '#9aa', 1, 10, 30, 2); R(g, '#f4f4f2', 2, 6, 28, 5); R(g, '#d7dde8', 3, 5, 9, 2); R(g, '#6fa3c9', 12, 6, 18, 4);
    R(g, '#778', 2, 12, 2, 6); R(g, '#778', 28, 12, 2, 6); R(g, '#778', 2, 2, 2, 9); R(g, '#556', 2, 18, 3, 1); R(g, '#556', 27, 18, 3, 1);
  }
  function drawIV(g) {
    R(g, '#999', 4, 2, 1, 30); R(g, '#bbb', 2, 2, 5, 1); R(g, '#e8f4ff', 1, 3, 3, 6); R(g, '#9cf', 1, 6, 3, 3);
    R(g, '#777', 1, 31, 7, 1);
  }
  function drawExit(g) {
    R(g, '#0a6e2e', 0, 0, 24, 9); R(g, '#e8ffe8', 1, 1, 22, 7); R(g, '#0a8a3a', 2, 2, 20, 5);
    R(g, '#e8ffe8', 4, 3, 5, 1); R(g, '#e8ffe8', 3, 4, 1, 1); R(g, '#e8ffe8', 15, 3, 5, 1); R(g, '#e8ffe8', 20, 4, 1, 1);
    R(g, '#e8ffe8', 11, 2, 1, 5);
  }
  function drawBottle(g) {
    R(g, '#cfe8ff', 2, 3, 4, 8); R(g, '#3b7bd6', 2, 6, 4, 2); R(g, '#e33', 3, 2, 2, 1);
  }
  function drawFlashlight(g) {
    R(g, '#222', 1, 3, 10, 3); R(g, '#555', 10, 2, 3, 5); R(g, '#ffe9a0', 13, 3, 1, 3);
  }
  function buildSprites() {
    for (let p = 0; p < 4; p++) {
      sprites['mindBack' + p] = canvasPix(20, 40, g => drawMind(g, 'back', p));
      sprites['mindFront' + p] = canvasPix(20, 40, g => drawMind(g, 'front', p));
    }
    sprites.mindFront = sprites.mindFront0;
    sprites.entity = canvasPix(20, 48, drawEntity);
    sprites.bed = canvasPix(32, 20, drawBed);
    sprites.iv = canvasPix(9, 33, drawIV);
    sprites.exit = canvasPix(24, 9, drawExit);
    sprites.flashlight = canvasPix(14, 8, drawFlashlight);
    sprites.bottle = canvasPix(8, 12, drawBottle);
  }

  // ---------- maps ----------
  const DIRS = { E: [1, 0], W: [-1, 0], N: [0, -1], S: [0, 1] };
  function buildPath(start, segs) {
    const pts = [start.slice()]; let [x, y] = start;
    for (const [d, len] of segs) { x += DIRS[d][0] * len; y += DIRS[d][1] * len; pts.push([x, y]); }
    const cum = [0]; for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, cum, len: cum[cum.length - 1] };
  }
  function pathAt(P, s) {
    s = clamp(s, 0, P.len);
    let i = 1; while (i < P.cum.length - 1 && P.cum[i] < s) i++;
    const a = P.pts[i - 1], b = P.pts[i], k = (s - P.cum[i - 1]) / ((P.cum[i] - P.cum[i - 1]) || 1);
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  function scaleSegs(segs, maxPre) {
    const pre = segs.slice(0, -1).reduce((a, s) => a + s[1], 0);
    const k = Math.min(1, maxPre / pre);
    return segs.map((s, i) => i < segs.length - 1 ? [s[0], Math.max(3, Math.round(s[1] * k))] : s);
  }
  function makeGrid(P, margin) {
    const xs = P.pts.map(p => p[0]), ys = P.pts.map(p => p[1]);
    const ox = Math.floor(Math.min(...xs)) - margin, oy = Math.floor(Math.min(...ys)) - margin;
    const gw = Math.ceil(Math.max(...xs)) - ox + margin, gh = Math.ceil(Math.max(...ys)) - oy + margin;
    // shift path into grid space
    P.pts = P.pts.map(([x, y]) => [x - ox, y - oy]);
    return { w: gw, h: gh, cells: new Uint8Array(gw * gh), floorMark: new Uint8Array(gw * gh) };
  }
  const gget = (G, x, y) => (x < 0 || y < 0 || x >= G.w || y >= G.h) ? 1 : G.cells[y * G.w + x];
  const gset = (G, x, y, v) => { if (x >= 0 && y >= 0 && x < G.w && y < G.h) G.cells[y * G.w + x] = v; };
  function carve(G, P, rad, extraAhead = 0) {
    const L = P.len + extraAhead;
    const last = P.pts[P.pts.length - 1], prev = P.pts[P.pts.length - 2];
    const dx = Math.sign(last[0] - prev[0]), dy = Math.sign(last[1] - prev[1]);
    for (let s = 0; s <= L; s += 0.25) {
      const [x, y] = s <= P.len ? pathAt(P, s) : [last[0] + dx * (s - P.len), last[1] + dy * (s - P.len)];
      for (let i = -rad; i <= rad; i++) for (let j = -rad; j <= rad; j++) gset(G, Math.floor(x) + i, Math.floor(y) + j, 0);
    }
  }

  function buildLevel0(maxProg, stopProg) {
    let segs = [['E', 10], ['N', 7], ['E', 9], ['S', 9], ['E', 0]];
    segs = scaleSegs(segs, Math.max(6, stopProg - 2.5));
    const pre = segs.slice(0, -1).reduce((a, s) => a + s[1], 0);
    segs[segs.length - 1][1] = Math.max(6, maxProg + 2 - pre);
    const P = buildPath([0.5, 0.5], segs);
    const G = makeGrid(P, 9);
    const r = rng(77);
    for (let y = 0; y < G.h; y++) for (let x = 0; x < G.w; x++) {
      if (x === 0 || y === 0 || x === G.w - 1 || y === G.h - 1) gset(G, x, y, 1);
      else if (r() < 0.05) gset(G, x, y, 1);
    }
    for (let k = 0; k < G.w * G.h / 30; k++) { // random wall runs
      const x = Math.floor(r() * G.w), y = Math.floor(r() * G.h), len = 2 + Math.floor(r() * 5), hor = r() < 0.5;
      for (let i = 0; i < len; i++) gset(G, x + (hor ? i : 0), y + (hor ? 0 : i), 1);
    }
    carve(G, P, 1, 12);
    return { name: 'level0', label: 'LEVEL 0', P, G, wallTex: [null, tex.yWall], floor: tex.carpet, ceil: tex.yCeil,
      fog: 11, sky: [60, 55, 35], panel: [255, 250, 215], mapCol: '#e2d27a', sprites: [], lightEvery: 3 };
  }

  function buildWard(maxProg) {
    const L = maxProg + 1.5 + 1.3;
    let segs = [['N', 14], ['E', 8], ['N', 0]];
    segs = scaleSegs(segs, Math.max(6, L - 7));
    const pre = segs.slice(0, -1).reduce((a, s) => a + s[1], 0);
    segs[segs.length - 1][1] = Math.max(6, L - pre);
    const P = buildPath([0.5, 0.5], segs);
    const G = makeGrid(P, 6);
    G.cells.fill(3);
    carve(G, P, 1, 0);
    const spr = [];
    const r = rng(91);
    // side rooms with empty beds
    for (let i = 0; i < P.pts.length - 1; i++) {
      const a = P.pts[i], b = P.pts[i + 1];
      const dx = Math.sign(b[0] - a[0]), dy = Math.sign(b[1] - a[1]);
      const n = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      for (let s = 3; s < n - 2; s += 4) {
        const side = ((s / 4) | 0) % 2 ? 1 : -1;
        const cx = a[0] + dx * s + (-dy) * side * 3, cy = a[1] + dy * s + dx * side * 3;
        for (let u = -1; u <= 1; u++) for (let v = -1; v <= 1; v++) {
          const X = Math.floor(cx) + u, Y = Math.floor(cy) + v;
          if (gget(G, X, Y) === 3) gset(G, X, Y, 0);
        }
        // room walls get the side-room texture
        for (let u = -2; u <= 2; u++) for (let v = -2; v <= 2; v++) {
          const X = Math.floor(cx) + u, Y = Math.floor(cy) + v;
          if (gget(G, X, Y) === 3 && (Math.abs(u) === 2 || Math.abs(v) === 2)) gset(G, X, Y, 5);
        }
        spr.push({ k: 'bed', x: cx, y: cy, h: 0.42, w: 0.85 });
        if (r() < 0.6) spr.push({ k: 'iv', x: cx + 0.6 * (dx || 1), y: cy + 0.6 * (dy || 1), h: 0.9, w: 0.25 });
      }
      // exit signs hanging from ceiling, pointing in conflicting directions
      spr.push({ k: 'exit', x: a[0] + dx * 2, y: a[1] + dy * 2, h: 0.13, w: 0.45, z: 0.8, glow: 1 });
    }
    // floor guidance line + door at the end
    for (let s = 0; s <= P.len; s += 0.25) { const [x, y] = pathAt(P, s); G.floorMark[Math.floor(y) * G.w + Math.floor(x)] = 1; }
    const last = P.pts[P.pts.length - 1], prev = P.pts[P.pts.length - 2];
    const dx = Math.sign(last[0] - prev[0]), dy = Math.sign(last[1] - prev[1]);
    for (let i = -1; i <= 1; i++) gset(G, Math.floor(last[0]) + dx * 1 + (dy ? i : 0), Math.floor(last[1]) + dy * 1 + (dx ? i : 0), 4);
    for (let i = -1; i <= 1; i++) gset(G, Math.floor(last[0]) + dx * 2 + (dy ? i : 0), Math.floor(last[1]) + dy * 2 + (dx ? i : 0), 3);
    return { name: 'ward', label: 'LEVEL ???', P, G, wallTex: [null, tex.yWall, null, tex.gWall, tex.door, tex.mWall],
      floor: tex.vinyl, ceil: tex.wCeil, fog: 14, sky: [40, 48, 44], panel: [245, 255, 250], mapCol: '#8fd1a8', sprites: spr, lightEvery: 2, redLine: true };
  }

  // ---------- init ----------
  async function init(tl) {
    TL = tl; fps = tl.meta.fps;
    out = document.getElementById('out'); octx = out.getContext('2d');
    low = document.createElement('canvas'); low.width = W; low.height = H; lctx = low.getContext('2d');
    img = lctx.createImageData(W, H); buf = new Uint32Array(img.data.buffer); zbuf = new Float32Array(W);
    buildTextures(); buildSprites(); buildOverlays();

    const st = tl.state;
    const range = name => { const idx = st.scene.map((s, i) => s === name ? i : -1).filter(i => i >= 0); return idx; };
    const l0 = range('level0'), wd = range('ward');
    const maxP = idx => Math.max(1, ...idx.map(i => st.prog[i]));
    const entityCue = tl.cues.find(c => c.type === 'entity' && c.value);
    const stopProg = entityCue ? st.prog[Math.round(entityCue.t * fps)] : maxP(l0);
    scenes.level0 = buildLevel0(maxP(l0), stopProg);
    scenes.ward = buildWard(maxP(wd));
    scenes.doors = { name: 'doors', label: 'LEVEL ???' };

    // pickup props on level0 path (flashlight near the "found it" line)
    const toast = tl.cues.find(c => c.type === 'toast');
    if (toast) {
      const s0 = st.prog[Math.round(toast.t * fps)] + 1.5 + 1.2;
      const [x, y] = pathAt(scenes.level0.P, s0);
      scenes.level0.pickup = { k: 'flashlight', x, y, h: 0.1, w: 0.3, until: toast.t };
    }

    // camera track
    const GIRL_AHEAD = 2.3;
    let prevDir = null;
    for (let f = 0; f < tl.frames; f++) {
      const sc = scenes[st.scene[f]];
      if (!sc.P) { camTrack.push({ scene: sc.name }); prevDir = null; continue; }
      const gS = Math.min(st.prog[f] + GIRL_AHEAD, sc.P.len - 0.2), cS = gS - GIRL_AHEAD;
      const [x, y] = pathAt(sc.P, cS), [gx, gy] = pathAt(sc.P, gS);
      const a = pathAt(sc.P, cS - 0.6), b = pathAt(sc.P, cS + 2.4);
      let dx = b[0] - a[0], dy = b[1] - a[1]; const n = Math.hypot(dx, dy) || 1; dx /= n; dy /= n;
      if (prevDir) { dx = prevDir[0] * 0.8 + dx * 0.2; dy = prevDir[1] * 0.8 + dy * 0.2; const m = Math.hypot(dx, dy); dx /= m; dy /= m; }
      prevDir = [dx, dy];
      camTrack.push({ scene: sc.name, x, y, dx, dy, gx, gy, cS });
    }
    // entity: straight ahead of the stopped camera, before the first wall
    if (entityCue) {
      const c = camTrack[Math.round(entityCue.t * fps)];
      // offset sideways so มายด์ (standing straight ahead) does not hide it
      const G0 = scenes.level0.G;
      let best = null;
      for (const o of [1.1, -1.1, 0.8, -0.8, 0.5, -0.5])
        for (const d of [4.8, 4.2, 5.5, 3.6]) {
          const ex = c.x + c.dx * d - c.dy * o, ey = c.y + c.dy * d + c.dx * o, L = Math.hypot(ex - c.x, ey - c.y);
          if (castDist(G0, c.x, c.y, (ex - c.x) / L, (ey - c.y) / L) > L + 0.4) { best = [ex, ey]; break; }
        }
      if (!best) { const d = Math.min(6, castDist(G0, c.x, c.y, c.dx, c.dy) - 0.8); best = [c.x + c.dx * d, c.y + c.dy * d]; }
      scenes.level0.entity = { k: 'entity', x: best[0], y: best[1], h: 0.98, w: 0.32 };
    }
    await document.fonts.ready;
    await Promise.all(['700 80px Kanit', '800 80px Kanit', '600 40px "IBM Plex Sans Thai"', '600 30px "IBM Plex Mono"'].map(f => document.fonts.load(f, 'กขA0')));
  }

  function castDist(G, px, py, dx, dy) {
    for (let d = 0.1; d < 30; d += 0.05) if (gget(G, Math.floor(px + dx * d), Math.floor(py + dy * d))) return d;
    return 30;
  }

  // ---------- state queries ----------
  const cueState = (type, t) => { let v = null, ct = null; for (const c of TL.cues) { if (c.type !== type || c.t > t) continue; v = c; ct = c.t; } return v; };
  const cueActive = (type, t) => TL.cues.filter(c => c.type === type && t >= c.t && t < c.t + (c.dur || 0));

  // ---------- 3D render ----------
  function renderView(f, t) {
    const c = camTrack[f], sc = scenes[c.scene], G = sc.G, st = TL.state;
    const lights = st.lights[f];
    const flashOn = (cueState('flashlight', t) || {}).value ? 1 : 0;
    const flashK = flashOn ? 0.85 + 0.15 * hash(f, 3) : 0;
    const flick = lights > 0 && lights < 1 ? (hash(f, 9) < 0.35 ? 0.35 : 1) : (hash(f >> 1, 5) < 0.015 ? 0.85 : 1);
    const amb = (0.04 + 0.96 * lights) * flick;
    const moving = Math.abs(st.speed[f]) > 0.05;
    const shake = cueActive('shake', t).length ? (hash(f, 1) - 0.5) * 10 : 0;
    const horizon = Math.round(H / 2 + (moving ? Math.sin(c.cS * Math.PI * 2 * 1.8) * 1.6 : 0) + shake);
    const camZ = 0.5;
    const px = c.x, py = c.y, dx = c.dx, dy = c.dy;
    const plx = -dy * Math.tan(FOV / 2), ply = dx * Math.tan(FOV / 2);
    const fog = sc.fog, [skyR, skyG, skyB] = sc.sky;
    const flashR = (x, y) => { const ux = (x - W / 2) / (W * 0.34), uy = (y - H * 0.52) / (H * 0.42); return smooth(1, 0.25, Math.sqrt(ux * ux + uy * uy)); };

    const shadeTex = (col, d, x, y, emissive) => {
      let b = amb * Math.max(0, 1 - d / fog);
      if (flashK) b += flashK * flashR(x, y) * 1.5 / (1 + 0.05 * d * d);
      if (emissive) b = Math.max(b, emissive);
      b = Math.min(b, 1.25);
      const r = (col & 255) * b, g = ((col >> 8) & 255) * b, bl = ((col >> 16) & 255) * b;
      const fk = flashK ? 0 : Math.min(1, d / fog) * lights * 0.6; // haze toward fog colour when lit
      return rgb(r + (skyR - r) * fk, g + (skyG - g) * fk, bl + (skyB - bl) * fk);
    };

    // floor + ceiling
    for (let y = 0; y < H; y++) {
      const isFloor = y > horizon; const p = isFloor ? y - horizon : horizon - y;
      if (p === 0) { for (let x = 0; x < W; x++) buf[y * W + x] = rgb(0, 0, 0); continue; }
      const rowDist = (isFloor ? camZ : 1 - camZ) * F / p;
      const lx0 = dx - plx, ly0 = dy - ply;
      const stepX = rowDist * 2 * plx / W, stepY = rowDist * 2 * ply / W;
      let wx = px + rowDist * lx0, wy = py + rowDist * ly0;
      const tx = isFloor ? sc.floor : sc.ceil;
      for (let x = 0; x < W; x++, wx += stepX, wy += stepY) {
        const cx = Math.floor(wx), cy = Math.floor(wy), fx = wx - cx, fy = wy - cy;
        let col = tx[((fy * T) & 63) * T + ((fx * T) & 63)], em = 0;
        if (isFloor) {
          if (sc.redLine && G.floorMark[cy * G.w + cx]) {
            const h = G.floorMark[(cy) * G.w + cx - 1] || G.floorMark[cy * G.w + cx + 1];
            const v = G.floorMark[(cy - 1) * G.w + cx] || G.floorMark[(cy + 1) * G.w + cx];
            if ((h && Math.abs(fy - 0.5) < 0.05) || (v && Math.abs(fx - 0.5) < 0.05)) col = rgb(196, 36, 40);
          }
        } else if (((cx % sc.lightEvery) + sc.lightEvery) % sc.lightEvery === 0 && ((cy % 2) + 2) % 2 === 0 && fx > 0.25 && fx < 0.75 && fy > 0.12 && fy < 0.88) {
          const [r, g, b] = sc.panel; col = rgb(r, g, b); em = lights * flick > 0.05 ? 1.0 * Math.max(0.3, lights * flick) : 0;
          if (!em) col = rgb(90, 90, 80);
        }
        buf[y * W + x] = shadeTex(col, rowDist, x, y, em);
      }
    }
    // walls (DDA)
    for (let x = 0; x < W; x++) {
      const camX = 2 * x / W - 1, rdx = dx + plx * camX, rdy = dy + ply * camX;
      let mx = Math.floor(px), my = Math.floor(py);
      const ddx = Math.abs(1 / rdx), ddy = Math.abs(1 / rdy);
      let sx, sy, sdx, sdy;
      if (rdx < 0) { sx = -1; sdx = (px - mx) * ddx; } else { sx = 1; sdx = (mx + 1 - px) * ddx; }
      if (rdy < 0) { sy = -1; sdy = (py - my) * ddy; } else { sy = 1; sdy = (my + 1 - py) * ddy; }
      let side = 0, cell = 0, n = 0;
      while (n++ < 200) {
        if (sdx < sdy) { sdx += ddx; mx += sx; side = 0; } else { sdy += ddy; my += sy; side = 1; }
        cell = gget(G, mx, my); if (cell) break;
      }
      const dist = side === 0 ? sdx - ddx : sdy - ddy;
      zbuf[x] = dist;
      let wallX = side === 0 ? py + dist * rdy : px + dist * rdx; wallX -= Math.floor(wallX);
      let texX = (wallX * T) | 0; if ((side === 0 && rdx > 0) || (side === 1 && rdy < 0)) texX = T - texX - 1;
      const lineH = F / dist;
      const top = horizon - lineH * (1 - camZ), bot = horizon + lineH * camZ;
      const y0 = Math.max(0, Math.ceil(top)), y1 = Math.min(H - 1, Math.floor(bot));
      const tw = (sc.wallTex[cell] || tex.yWall);
      const sideK = side ? 0.82 : 1;
      for (let y = y0; y <= y1; y++) {
        const ty = Math.min(63, ((y - top) / lineH * T) | 0);
        let col = tw[ty * T + texX];
        if (sideK < 1) col = rgb((col & 255) * sideK, ((col >> 8) & 255) * sideK, ((col >> 16) & 255) * sideK);
        const em = (cell === 4 && (col & 0xffffff) === (rgb(255, 250, 225) & 0xffffff)) ? 1 : 0;
        buf[y * W + x] = shadeTex(col, dist, x, y, em);
      }
    }
    // sprites
    const list = [...sc.sprites];
    if (sc.pickup && t < sc.pickup.until) list.push(sc.pickup);
    const ent = cueState('entity', t);
    if (sc.entity && ent && ent.value) list.push({ ...sc.entity, emissiveFace: 1 });
    const phase = moving ? Math.floor(c.cS * 4) % 4 : 0;
    const back = st.speed[f] > 0.05;
    list.push({ k: (back ? 'mindBack' : 'mindFront') + phase, x: c.gx, y: c.gy, h: 0.62, w: 0.31 });
    const inv = 1 / (plx * dy - dx * ply);
    list.forEach(s => { s.d = (s.x - px) ** 2 + (s.y - py) ** 2; });
    list.sort((a, b) => b.d - a.d);
    for (const s of list) {
      const spr = sprites[s.k]; if (!spr) continue;
      const rx = s.x - px, ry = s.y - py;
      const tX = inv * (dy * rx - dx * ry), tY = inv * (-ply * rx + plx * ry);
      if (tY <= 0.15) continue;
      const scX = (W / 2) * (1 + tX / tY);
      const hPix = s.h * F / tY, wPix = hPix * spr.w / spr.h;
      const zb = s.z || 0;
      const yBot = horizon + (camZ - zb) * F / tY, yTop = yBot - hPix;
      const x0 = Math.floor(scX - wPix / 2), x1 = Math.ceil(scX + wPix / 2);
      for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
        if (tY >= zbuf[x]) continue;
        const u = Math.floor((x - (scX - wPix / 2)) / wPix * spr.w); if (u < 0 || u >= spr.w) continue;
        for (let y = Math.max(0, Math.floor(yTop)); y < Math.min(H, Math.ceil(yBot)); y++) {
          const v = Math.floor((y - yTop) / hPix * spr.h); if (v < 0 || v >= spr.h) continue;
          const col = spr.d[v * spr.w + u]; if ((col >>> 24) < 128) continue;
          const bright = (col & 255) > 240 && ((col >> 8) & 255) > 240;
          const em = (s.emissiveFace && bright) ? 1 : (s.glow ? 0.9 : 0);
          buf[y * W + x] = shadeTex(col, tY, x, y, em);
        }
      }
    }
    // flashlight hand in first person when torch is on
    lctx.putImageData(img, 0, 0);
  }

  // doors scene: flat pixel illustration
  function renderDoors(f, t) {
    const g = lctx;
    const fl = hash(f >> 1, 4);
    g.fillStyle = '#d9dcd6'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#c3c7c0'; g.fillRect(0, 0, W, 40);
    g.fillStyle = '#9fa49c'; g.fillRect(0, 210, W, 85);
    for (let x = 0; x < W; x += 24) { g.fillStyle = '#b2b6ae'; g.fillRect(x, 210, 1, 85); }
    g.fillStyle = '#fffbea'; g.fillRect(40, 14, 70, 8); g.fillRect(160, 14, 70, 8);
    const doors = [{ x: 22, c: '#4f9d6b' }, { x: 104, c: '#7a7f86' }, { x: 186, c: '#2a1414' }];
    doors.forEach((d, i) => {
      g.fillStyle = '#6b6e68'; g.fillRect(d.x - 4, 76, 70, 138);
      g.fillStyle = d.c; g.fillRect(d.x, 80, 62, 132);
      g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(d.x + 30, 80, 2, 132);
      g.fillStyle = '#ddd'; g.fillRect(d.x + 24, 146, 4, 8); g.fillRect(d.x + 34, 146, 4, 8);
      if (i === 2) { // light under the forbidden door flickers red
        g.fillStyle = fl < 0.5 ? '#ff2a2a' : '#7a0d0d'; g.fillRect(d.x, 210, 62, 3);
      } else { g.fillStyle = '#fff6c8'; g.fillRect(d.x, 210, 62, 2); }
      g.fillStyle = '#f7f7f2'; g.fillRect(d.x + 4, 58, 54, 14);
    });
    // มายด์ from behind, centred
    const s = sprites.mindBack0;
    g.imageSmoothingEnabled = false; g.drawImage(s.c, W / 2 - 20, 196, 40, 80);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(W / 2 - 16, 274, 32, 4);
  }

  // ---------- overlays ----------
  let scan, vign, noise = [];
  function buildOverlays() {
    scan = document.createElement('canvas'); scan.width = OUT_W; scan.height = VIEW_H;
    const s = scan.getContext('2d'); s.fillStyle = 'rgba(0,0,0,0.16)';
    for (let y = 0; y < VIEW_H; y += 4) s.fillRect(0, y, OUT_W, 2);
    vign = document.createElement('canvas'); vign.width = OUT_W; vign.height = VIEW_H;
    const v = vign.getContext('2d'); const gr = v.createRadialGradient(OUT_W / 2, VIEW_H / 2, VIEW_H * 0.3, OUT_W / 2, VIEW_H / 2, VIEW_H * 0.78);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.6)'); v.fillStyle = gr; v.fillRect(0, 0, OUT_W, VIEW_H);
    for (let k = 0; k < 6; k++) {
      const c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d'), id = g.createImageData(W, H), r = rng(500 + k);
      for (let i = 0; i < W * H; i++) { const n = r() * 255; id.data.set([n, n, n, r() < 0.5 ? 18 : 0], i * 4); }
      g.putImageData(id, 0, 0); noise.push(c);
    }
  }

  function outlined(ctx, text, x, y, font, fill, stroke, lw, align = 'center') {
    ctx.font = font; ctx.textAlign = align; ctx.textBaseline = 'alphabetic'; ctx.lineJoin = 'round';
    ctx.lineWidth = lw; ctx.strokeStyle = stroke; ctx.strokeText(text, x, y); ctx.fillStyle = fill; ctx.fillText(text, x, y);
  }
  const fmt = s => { s = Math.floor(s); return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };

  function drawHUD(f, t) {
    const g = octx, c = camTrack[f], sc = scenes[c.scene];
    // REC
    if (Math.floor(t * 1.2) % 2 === 0) { g.fillStyle = '#ff3030'; g.beginPath(); g.arc(46, 58, 13, 0, 7); g.fill(); }
    outlined(g, 'REC ' + fmt(t), 70, 70, '600 38px "IBM Plex Mono"', '#fff', 'rgba(0,0,0,.6)', 6, 'left');
    outlined(g, TL.meta.date, 36, 112, '600 24px "IBM Plex Mono"', '#eee', 'rgba(0,0,0,.6)', 5, 'left');
    // minimap
    if (sc.G) {
      const mx = 800, my = 30, size = 244, cellPx = 14, half = size / cellPx / 2;
      g.save(); g.fillStyle = '#0b0b0b'; g.fillRect(mx, my, size, size);
      g.beginPath(); g.rect(mx, my, size, size); g.clip();
      for (let yy = Math.floor(c.y - half) - 1; yy <= c.y + half + 1; yy++) for (let xx = Math.floor(c.x - half) - 1; xx <= c.x + half + 1; xx++) {
        const v = gget(sc.G, xx, yy); if (!v) continue;
        g.fillStyle = v === 4 ? '#ff4d4d' : sc.mapCol;
        g.fillRect(mx + size / 2 + (xx - c.x) * cellPx, my + size / 2 + (yy - c.y) * cellPx, cellPx + 0.5, cellPx + 0.5);
      }
      // trail
      g.fillStyle = 'rgba(120,180,255,.55)';
      for (let k = Math.max(0, f - 2400); k < f; k += 6) { const p = camTrack[k]; if (p.scene !== c.scene) continue;
        g.fillRect(mx + size / 2 + (p.x - c.x) * cellPx - 2, my + size / 2 + (p.y - c.y) * cellPx - 2, 4, 4); }
      const ent = cueState('entity', t);
      if (sc.entity && ent && ent.value && hash(f >> 3) < 0.7) { g.fillStyle = '#ff2b2b';
        g.fillRect(mx + size / 2 + (sc.entity.x - c.x) * cellPx - 5, my + size / 2 + (sc.entity.y - c.y) * cellPx - 5, 10, 10); }
      g.fillStyle = '#5fb4ff'; g.fillRect(mx + size / 2 + (c.gx - c.x) * cellPx - 5, my + size / 2 + (c.gy - c.y) * cellPx - 5, 10, 10);
      g.translate(mx + size / 2, my + size / 2); g.rotate(Math.atan2(c.dy, c.dx) + Math.PI / 2);
      g.fillStyle = '#fff'; g.beginPath(); g.moveTo(0, -12); g.lineTo(9, 10); g.lineTo(0, 5); g.lineTo(-9, 10); g.closePath(); g.fill();
      g.restore();
      g.strokeStyle = '#ddd'; g.lineWidth = 4; g.strokeRect(mx, my, size, size);
    }
    if (sc.G) outlined(g, sc.label, 922, 314, '700 34px Kanit', '#ffd23f', 'rgba(0,0,0,.7)', 6);
    // mission box
    const mis = cueState('mission', t);
    if (mis && mis.value) {
      const k = smooth(mis.t, mis.t + 0.35, t), x = 36 - (1 - k) * 600, y = 140;
      const isNew = mis.value.startsWith('ภารกิจใหม่');
      const body = mis.value.replace(/^ภารกิจใหม่ · /, '');
      g.font = '600 38px "IBM Plex Sans Thai"'; const w = Math.max(300, g.measureText(body).width + 50);
      g.fillStyle = 'rgba(10,10,14,.85)'; g.fillRect(x, y, w, 104);
      g.strokeStyle = '#ffd23f'; g.lineWidth = 5; g.strokeRect(x, y, w, 104);
      g.fillStyle = '#ffd23f'; g.font = '600 24px "IBM Plex Sans Thai"'; g.textAlign = 'left'; g.fillText(isNew ? 'ภารกิจใหม่' : 'ภารกิจ', x + 22, y + 36);
      g.fillStyle = '#fff'; g.font = '600 38px "IBM Plex Sans Thai"'; g.fillText(body, x + 22, y + 84);
    }
    // toast
    for (const ts of TL.cues.filter(c => c.type === 'toast' && t >= c.t && t < c.t + 3.2)) {
      const k = smooth(ts.t, ts.t + 0.3, t) * (1 - smooth(ts.t + 2.8, ts.t + 3.2, t));
      g.globalAlpha = k; const [a, b] = ts.value.split(' · ');
      g.font = '600 40px "IBM Plex Sans Thai"'; const w = g.measureText(b).width + 50, x = 780 - w - 20, y = 36;
      g.fillStyle = 'rgba(10,20,12,.88)'; g.fillRect(x, y, w, 110); g.strokeStyle = '#4dff88'; g.lineWidth = 5; g.strokeRect(x, y, w, 110);
      g.fillStyle = '#4dff88'; g.font = '600 24px "IBM Plex Sans Thai"'; g.textAlign = 'left'; g.fillText(a, x + 24, y + 38);
      g.fillStyle = '#fff'; g.font = '600 40px "IBM Plex Sans Thai"'; g.fillText(b, x + 24, y + 88);
      g.globalAlpha = 1;
    }
    // doors labels
    if (c.scene === 'doors') {
      const labels = [['กลับบ้าน', '#bff5cf'], ['ลึกลงไป', '#e6e6e6'], ['ห้ามเปิด', '#ff6a6a']];
      labels.forEach(([txt, col], i) => outlined(g, txt, (22 + 31 + i * 82) * SCALE, 70 * SCALE + 6, '700 44px Kanit', col, '#111', 8));
    }
    // title card
    const tc = TL.cues.find(c => c.type === 'title');
    if (tc && t < tc.t + tc.dur) {
      const a = 1 - smooth(tc.t + tc.dur - 0.8, tc.t + tc.dur, t);
      const pop = 0.85 + 0.15 * smooth(tc.t, tc.t + 0.35, t);
      g.save(); g.globalAlpha = a; g.translate(540, 250); g.scale(pop, pop);
      outlined(g, 'หลุดเข้า', 0, 0, '800 110px Kanit', '#fff', '#1a1a1a', 16);
      outlined(g, 'BACKROOMS', 0, 140, '800 150px Kanit', '#e52222', '#fff', 14);
      outlined(g, TL.meta.subtitle, 0, 230, '700 52px Kanit', '#ffd23f', '#1a1a1a', 10);
      g.restore();
    }
    // end card
    const ec = cueState('endcard', t);
    if (ec) {
      const k = smooth(ec.t, ec.t + 0.4, t);
      g.save(); g.globalAlpha = k; g.translate(540, 520); g.scale(0.9 + 0.1 * k, 0.9 + 0.1 * k);
      outlined(g, 'เปิดบานไหนดี?', 0, 0, '800 112px Kanit', '#ffd23f', '#1a1a1a', 16);
      outlined(g, 'เมนต์มาเลย 👇', 0, 100, '700 64px Kanit', '#fff', '#1a1a1a', 12);
      g.restore();
    }
    outlined(g, TL.meta.watermark, 1050, 1160, '500 24px "IBM Plex Sans Thai"', 'rgba(255,255,255,.75)', 'rgba(0,0,0,.5)', 4, 'right');
  }

  function postFX(f, t) {
    const g = octx;
    g.drawImage(noise[f % 6], 0, 0, OUT_W, VIEW_H);
    g.drawImage(scan, 0, 0); g.drawImage(vign, 0, 0);
    // occasional VHS tracking line
    if (hash(f >> 2, 77) < 0.08) { const y = Math.floor(hash(f, 78) * VIEW_H); g.drawImage(out, 0, y, OUT_W, 18, 14, y, OUT_W, 18); }
    for (const gl of cueActive('glitch', t)) {
      const k = Math.sin(Math.PI * (t - gl.t) / gl.dur);
      if (hash(f, 31) < 0.6) { // yellow chevron flash
        g.globalAlpha = 0.35 * k; for (let y = 0; y < VIEW_H; y += 40) { g.fillStyle = (y / 40) % 2 ? '#e8d84a' : '#b8a830'; g.fillRect(0, y, OUT_W, 20); } g.globalAlpha = 1;
      }
      for (let i = 0; i < 16; i++) {
        const y = Math.floor(hash(f, i, 1) * VIEW_H), h = 10 + Math.floor(hash(f, i, 2) * 70), off = (hash(f, i, 3) - 0.5) * 240 * k;
        g.drawImage(out, 0, y, OUT_W, h, off, y, OUT_W, h);
        if (hash(f, i, 4) < 0.3) { g.fillStyle = ['#ff2bd6', '#2bfff0', '#fff22b', '#22ff55'][i % 4]; g.globalAlpha = 0.5 * k; g.fillRect(0, y, OUT_W, 6); g.globalAlpha = 1; }
      }
    }
    for (const w of cueActive('whiteout', t)) {
      const k = Math.sin(Math.PI * (t - w.t) / w.dur); g.fillStyle = `rgba(255,255,248,${k})`; g.fillRect(0, 0, OUT_W, VIEW_H);
    }
    // fade in from black at start
    if (t < 0.6) { g.fillStyle = `rgba(0,0,0,${1 - t / 0.6})`; g.fillRect(0, 0, OUT_W, VIEW_H); }
  }

  // ---------- subtitles ----------
  const seg = new Intl.Segmenter('th', { granularity: 'word' });
  function wrap(g, text, maxW) {
    const words = [...seg.segment(text)].map(s => s.segment);
    const lines = [[]]; let w = 0;
    for (const wd of words) {
      const ww = g.measureText(wd).width;
      if (w + ww > maxW && lines[lines.length - 1].length) { lines.push([]); w = 0; if (wd === ' ') continue; }
      lines[lines.length - 1].push(wd); w += ww;
    }
    return lines.map(l => l.join(''));
  }
  function drawSubtitle(f, t) {
    const g = octx;
    g.fillStyle = '#000'; g.fillRect(0, VIEW_H, OUT_W, 300);
    g.strokeStyle = '#d9d9de'; g.lineWidth = 6; g.strokeRect(26, VIEW_H + 22, OUT_W - 52, 252);
    g.strokeStyle = '#55555c'; g.lineWidth = 2; g.strokeRect(40, VIEW_H + 36, OUT_W - 80, 224);
    g.fillStyle = '#0d0e14'; g.fillRect(42, VIEW_H + 38, OUT_W - 84, 220);
    let L = null;
    for (const l of TL.lines) if (t >= l.start - 0.15 && t <= l.end + 0.5) L = l;
    if (!L) return;
    const v = TL.voices[L.who];
    g.textAlign = 'left'; g.font = '700 30px Kanit'; g.fillStyle = v.color; g.fillText('▸ ' + v.name, 70, VIEW_H + 82);
    g.font = '600 44px "IBM Plex Sans Thai"';
    const rows = wrap(g, L.text, OUT_W - 150);
    const total = [...L.text].length;
    const spoken = clamp((t - L.start) / (L.end - L.start), 0, 1) * total;
    let idx = 0;
    rows.slice(0, 3).forEach((row, r) => {
      let x = 70; const y = VIEW_H + 142 + r * 58;
      for (const ch of seg.segment(row)) {
        const s = ch.segment, n = [...s].length;
        g.fillStyle = idx + n * 0.5 <= spoken ? '#ffffff' : '#6c6f7a';
        g.fillText(s, x, y); x += g.measureText(s).width; idx += n;
      }
    });
  }

  // ---------- portraits ----------
  const portraitCache = {};
  // looks: 'operator' (male, headset) | 'doctor' (female, scrubs) | 'entity' (shadow with a smile)
  function portrait(look, mouth, blink) {
    const key = look + mouth + blink; if (portraitCache[key]) return portraitCache[key];
    const pc = canvasPix(40, 44, g => {
      if (look === 'entity') {
        R(g, '#120808', 0, 0, 40, 44); R(g, '#030303', 10, 6, 20, 38); R(g, '#030303', 6, 30, 28, 14);
        R(g, '#fffef0', 14, 16, 3, blink ? 1 : 3); R(g, '#fffef0', 23, 16, 3, blink ? 1 : 3);
        R(g, '#fffef0', 12, 25, 16, mouth ? 4 : 2); for (let i = 13; i < 28; i += 2) R(g, '#030303', i, 25, 1, mouth ? 4 : 2);
      } else if (look === 'operator') {
        R(g, '#3b1d1f', 0, 0, 40, 44);
        const skin = '#d9a07a', sh = '#b77f5c', hair = '#141016';
        R(g, '#22314f', 6, 34, 28, 10); R(g, '#2c3f66', 8, 35, 24, 9); R(g, '#d9a07a', 16, 33, 8, 3); // shirt+neck
        R(g, sh, 16, 29, 8, 5);
        R(g, skin, 11, 10, 18, 21); R(g, sh, 11, 26, 18, 5); R(g, skin, 12, 26, 16, 4); R(g, skin, 13, 30, 14, 2);
        R(g, hair, 10, 5, 20, 7); R(g, hair, 9, 7, 3, 9); R(g, hair, 28, 7, 3, 7); R(g, hair, 14, 4, 13, 2); R(g, hair, 20, 11, 7, 2);
        R(g, skin, 9, 16, 2, 5); R(g, skin, 29, 16, 2, 5); // ears
        R(g, '#2b2b30', 8, 9, 2, 12); R(g, '#2b2b30', 30, 9, 2, 12); R(g, '#2b2b30', 9, 4, 22, 2); // headset band
        R(g, '#444', 7, 15, 4, 7); R(g, '#444', 29, 15, 4, 7);
        R(g, '#333', 10, 22, 1, 6); R(g, '#333', 10, 27, 6, 1); R(g, '#e33', 16, 27, 2, 2); // mic boom
        R(g, '#1a1214', 14, 15, 5, 1); R(g, '#1a1214', 22, 15, 5, 1); // brows
        if (blink) { R(g, '#3a2420', 15, 18, 4, 1); R(g, '#3a2420', 22, 18, 4, 1); }
        else { R(g, '#fff', 15, 17, 4, 3); R(g, '#fff', 22, 17, 4, 3); R(g, '#2a1a12', 16, 17, 2, 3); R(g, '#2a1a12', 23, 17, 2, 3); }
        R(g, sh, 19, 19, 2, 5);
        if (mouth) { R(g, '#5a1f22', 17, 25, 6, 3); R(g, '#fff', 18, 25, 4, 1); } else R(g, '#8a4a40', 17, 26, 6, 1);
      } else {
        R(g, '#15303a', 0, 0, 40, 44);
        const skin = '#efc2a2', sh = '#d29b7c', hair = '#1d1512';
        R(g, hair, 6, 8, 28, 30); // hair behind
        R(g, '#2f9c96', 4, 35, 32, 9); R(g, '#22746f', 16, 35, 8, 5); R(g, skin, 17, 34, 6, 3); R(g, '#2f9c96', 17, 37, 6, 7); // scrubs V
        R(g, skin, 17, 34, 6, 3); R(g, '#222', 10, 36, 1, 6); R(g, '#222', 29, 36, 1, 6); R(g, '#999', 11, 41, 18, 1); // stethoscope
        R(g, sh, 16, 29, 8, 6);
        R(g, skin, 11, 9, 18, 22); R(g, skin, 13, 30, 14, 2);
        R(g, hair, 10, 6, 20, 6); R(g, hair, 9, 9, 3, 16); R(g, hair, 28, 9, 3, 16); R(g, hair, 13, 11, 7, 2); R(g, hair, 24, 11, 4, 1);
        R(g, '#ffd166', 27, 8, 3, 2); // hair clip
        R(g, '#3a2420', 14, 15, 5, 1); R(g, '#3a2420', 22, 15, 5, 1);
        if (blink) { R(g, '#3a2420', 15, 18, 4, 1); R(g, '#3a2420', 22, 18, 4, 1); }
        else { R(g, '#fff', 15, 17, 4, 3); R(g, '#fff', 22, 17, 4, 3); R(g, '#24160f', 16, 17, 3, 3); R(g, '#24160f', 23, 17, 3, 3); R(g, '#fff', 17, 17, 1, 1); R(g, '#fff', 24, 17, 1, 1); }
        R(g, '#f0a0a0', 13, 21, 3, 2); R(g, '#f0a0a0', 25, 21, 3, 2); // blush
        R(g, sh, 20, 20, 1, 3);
        if (mouth) { R(g, '#7a2630', 18, 25, 5, 3); R(g, '#fff', 18, 25, 5, 1); } else R(g, '#c2626a', 18, 26, 5, 1);
      }
    });
    return (portraitCache[key] = pc.c);
  }
  function drawPortraits(f, t) {
    const g = octx, y0 = VIEW_H + 300, h = OUT_H - y0;
    g.fillStyle = '#3a3a40'; g.fillRect(0, y0, OUT_W, h);
    for (let x = 0; x < OUT_W; x += 12) { g.fillStyle = '#34343a'; g.fillRect(x, y0, 4, h); }
    g.fillStyle = '#56565e'; g.fillRect(0, y0, OUT_W, 4);
    const who = Object.keys(TL.voices).slice(0, 3), n = who.length, pw = n > 2 ? 260 : 300, gap = 30;
    const left = (OUT_W - (n * pw + (n - 1) * gap)) / 2;
    who.forEach((w, i) => {
      const L = TL.lines.find(l => l.who === w && t >= l.start && t < l.end);
      const talk = !!L, mf = L ? L.mouth[Math.floor((t - L.start) * fps)] || 0 : 0;
      const blink = (Math.floor(t * fps) + i * 37) % 112 < 4;
      const ph = Math.round(pw * 1.1), x = left + i * (pw + gap), bounce = talk ? Math.sin(t * 18) * 3 : 0, y = y0 + 40 - bounce;
      g.imageSmoothingEnabled = false;
      g.globalAlpha = talk ? 1 : 0.62;
      const look = TL.voices[w].look || (i === 0 ? 'operator' : 'doctor');
      g.drawImage(portrait(look, mf > 0.33 ? 1 : 0, blink ? 1 : 0), x, y, pw, ph);
      g.globalAlpha = 1;
      g.strokeStyle = talk ? TL.voices[w].color : '#77777f'; g.lineWidth = talk ? 8 : 5; g.strokeRect(x, y, pw, ph);
      outlined(g, TL.voices[w].name, x + pw / 2, y + ph + 54, '700 38px Kanit', talk ? TL.voices[w].color : '#bbb', '#111', 6);
    });
    g.fillStyle = '#ffd23f'; g.fillRect(0, OUT_H - 10, OUT_W * (t / TL.duration), 10);
  }

  // ---------- frame ----------
  function render(f) {
    const t = f / fps, c = camTrack[f];
    if (c.scene === 'doors') renderDoors(f, t); else renderView(f, t);
    octx.imageSmoothingEnabled = false;
    octx.drawImage(low, 0, 0, W, H, 0, 0, OUT_W, VIEW_H);
    postFX(f, t);
    drawHUD(f, t);
    drawSubtitle(f, t);
    drawPortraits(f, t);
  }
  return { init, render };
})();
