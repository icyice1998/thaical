// Style "history-doc": full-bleed archival paintings with slow Ken Burns moves and crossfades, date/place chips,
// big-number boxes (with strike-through), archival image cards, typed quotes, timeline chips, cut-out presenter,
// captions, film grade. Same API as the other renderers. Every frame is a pure function of t.
const BR = (() => {
  const W = 1080, H = 1920;
  const C = { yellow: '#ffc94d', red: '#e5484d', ink: '#fff', paper: '#efe3c8', dark: 'rgba(14,10,6,.78)' };
  let TL, fps, g, imgs = {}, credits = [], shots = [], presenter = null, grain = [];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = x => { x = clamp(x, 0, 1); return x < .5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
  const eout = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const back = x => { x = clamp(x, 0, 1); const c = 1.6; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

  async function init(tl) {
    TL = tl; fps = tl.meta.fps;
    g = document.getElementById('out').getContext('2d');
    const a = tl.assets || {};
    for (const [k, v] of Object.entries(a.images || {})) imgs[k] = await loadImg(v.src);
    credits = a.credits || [];
    if (a.cx && a.cx.body_front) presenter = await loadImg(a.cx.body_front);
    shots = tl.cues.filter(c => c.type === 'shot').sort((x, y) => x.t - y.t)
      .map((c, i, arr) => ({ ...c, end: i + 1 < arr.length ? arr[i + 1].t : tl.duration + 1 }));
    for (let k = 0; k < 4; k++) { // film grain tiles
      const c = document.createElement('canvas'); c.width = 270; c.height = 480; const x = c.getContext('2d'), id = x.createImageData(270, 480);
      let s = 1234 + k * 99; const r = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < id.data.length; i += 4) { const v = r() * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 16; }
      x.putImageData(id, 0, 0); grain.push(c);
    }
    await document.fonts.ready;
    await Promise.all(['800 80px Inter', '700 40px Inter', '800 80px "Playfair Display"', 'italic 600 50px "Playfair Display"'].map(f => document.fonts.load(f, 'Ab1')));
  }

  // ---------- painting with Ken Burns ----------
  function drawShot(s, t, alpha) {
    const im = imgs[s.value.img]; if (!im) return;
    const k = clamp((t - s.t) / Math.max(1, s.end - s.t + .8), 0, 1);
    const [fx, fy, fz] = s.value.from || [.5, .4, 1.0], [tx, ty, tz] = s.value.to || [.5, .45, 1.12];
    const cx = fx + (tx - fx) * ease(k), cy = fy + (ty - fy) * ease(k), z = fz + (tz - fz) * ease(k);
    const cover = Math.max(W / im.width, H / im.height) * z;
    const dw = im.width * cover, dh = im.height * cover;
    let x = W / 2 - cx * dw, y = H / 2 - cy * dh;
    x = clamp(x, W - dw, 0); y = clamp(y, H - dh, 0);
    g.globalAlpha = alpha; g.drawImage(im, x, y, dw, dh); g.globalAlpha = 1;
  }

  // ---------- overlay elements (timed relative to the shot start) ----------
  function chip(x, y, text, bg, fg, a, dot = true) {
    g.save(); g.globalAlpha = a; g.font = '700 38px Inter'; const w = g.measureText(text).width + (dot ? 74 : 48);
    g.beginPath(); g.roundRect(x, y, w, 66, 14); g.fillStyle = bg; g.fill();
    if (dot) { g.beginPath(); g.arc(x + 30, y + 33, 8, 0, 7); g.fillStyle = fg; g.fill(); }
    g.fillStyle = fg; g.textBaseline = 'middle'; g.fillText(text, x + (dot ? 52 : 24), y + 35); g.restore(); return w;
  }
  function bigBox(b, age) {
    const p = back((age - (b.at || .6)) / .45); if (p <= 0) return;
    g.save(); g.translate(70, b.y || 330); g.scale(clamp(p, 0, 1.2), clamp(p, 0, 1.2)); g.globalAlpha = clamp(p, 0, 1);
    if (b.strike) {
      g.font = '700 52px Inter'; const sw = g.measureText(b.strike).width;
      g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(-10, -60, sw + 20, 74); g.fillStyle = '#ddd'; g.fillText(b.strike, 0, 0);
      const sk = eout((age - (b.at || .6) - .5) / .4); g.strokeStyle = C.red; g.lineWidth = 8; g.beginPath(); g.moveTo(-6, -18); g.lineTo(-6 + (sw + 12) * sk, -22); g.stroke();
      g.translate(0, 110 * eout((age - (b.at || .6) - .7) / .4));
      g.globalAlpha = clamp((age - (b.at || .6) - .8) / .3, 0, 1);
    }
    g.font = '800 104px Inter'; const w = g.measureText(b.text).width + 60;
    g.beginPath(); g.roundRect(0, -100, w, 130, 18); g.fillStyle = C.yellow; g.fill();
    g.fillStyle = '#1b130a'; g.fillText(b.text, 30, 2);
    if (b.sub) { g.font = '700 36px Inter'; g.fillStyle = '#fff'; g.fillText(b.sub, 4, 82); }
    g.restore();
  }
  function card(c, age) {
    const im = imgs[c.img]; if (!im) return;
    const p = back((age - (c.at || .4)) / .55); if (p <= 0) return;
    const maxW = 620, maxH = 720, s = Math.min(maxW / im.width, maxH / im.height), w = im.width * s, h = im.height * s;
    g.save(); g.translate(W / 2, 560 + (1 - clamp(p, 0, 1)) * 80); g.rotate(-0.025 + Math.sin(age * .8) * .004); g.globalAlpha = clamp(p, 0, 1);
    g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(-w / 2 - 14, -h / 2 - 4, w + 40, h + 130);
    g.fillStyle = C.paper; g.fillRect(-w / 2 - 22, -h / 2 - 22, w + 44, h + 130);
    g.drawImage(im, -w / 2, -h / 2, w, h);
    if (c.title) { g.font = '800 34px Inter'; const tw = g.measureText(c.title).width + 40; g.fillStyle = C.yellow; g.fillRect(-tw / 2, -h / 2 - 60, tw, 56); g.fillStyle = '#1b130a'; g.textAlign = 'center'; g.fillText(c.title, 0, -h / 2 - 20); }
    g.textAlign = 'center'; g.fillStyle = '#4a3a22'; g.font = 'italic 600 30px "Playfair Display"'; g.fillText(c.caption || '', 0, h / 2 + 62);
    g.restore();
  }
  function quote(q, age) {
    const a = clamp((age - (q.at || .2)) / .4, 0, 1); if (a <= 0) return;
    const chars = Math.floor(clamp((age - (q.at || .2)) / (q.type_s || 3.2), 0, 1) * q.text.length);
    g.save(); g.globalAlpha = a;
    const grd = g.createLinearGradient(0, 220, 0, 900); grd.addColorStop(0, 'rgba(10,6,2,.85)'); grd.addColorStop(1, 'rgba(10,6,2,0)');
    g.fillStyle = grd; g.fillRect(0, 160, W, 760);
    g.fillStyle = C.yellow; g.font = '800 140px "Playfair Display"'; g.fillText('“', 60, 360);
    g.fillStyle = '#fff'; g.font = 'italic 600 58px "Playfair Display"';
    const words = q.text.slice(0, chars).split(' '); let line = '', y = 380; const lines = [];
    for (const w of words) { const t = line ? line + ' ' + w : w; if (g.measureText(t).width > 900 && line) { lines.push(line); line = w; } else line = t; }
    lines.push(line); lines.forEach((l, i) => g.fillText(l, 90, y + i * 78));
    if (q.by && chars >= q.text.length) { g.font = '700 34px Inter'; g.fillStyle = C.yellow; g.fillText('— ' + q.by, 90, y + lines.length * 78 + 30); }
    g.restore();
  }
  function timeline(tl, age) {
    const y = tl.y || 420, x0 = 150, x1 = 930, p = eout((age - (tl.at || .4)) / 1.2);
    g.save(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 6; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + (x1 - x0) * p, y); g.stroke();
    tl.points.forEach((pt, i) => {
      const px = x0 + (x1 - x0) * (i / (tl.points.length - 1)), a = clamp((age - (tl.at || .4) - i * .5) / .35, 0, 1);
      g.globalAlpha = a; g.fillStyle = i === tl.points.length - 1 ? C.yellow : '#fff'; g.beginPath(); g.arc(px, y, 16, 0, 7); g.fill();
      g.font = '800 54px Inter'; g.textAlign = 'center'; g.fillText(pt.year, px, y - 40);
      g.font = '600 32px Inter'; g.fillStyle = '#fff'; g.fillText(pt.label, px, y + 64);
    });
    g.restore();
  }

  function drawOverlays(s, t) {
    const v = s.value, age = t - s.t, out = 1 - clamp((t - s.end + .2) / .3, 0, 1);
    let y = 150;
    (v.tags || []).forEach((tg, i) => {
      const a = Math.min(clamp((age - (tg.at ?? .3 + i * .25)) / .3, 0, 1), out);
      const red = tg.style === 'red';
      const w = chip(60 - (1 - a) * 40, y, tg.text, red ? C.red : 'rgba(10,8,6,.82)', red ? '#fff' : C.yellow, a, !red);
      y += 84;
    });
    g.save(); g.globalAlpha = out;
    if (v.big) bigBox({ y: y + 120, ...v.big }, age);
    if (v.card) card(v.card, age);
    if (v.quote) quote(v.quote, age);
    if (v.timeline) timeline(v.timeline, age);
    g.restore();
  }

  // ---------- presenter + captions ----------
  function drawPresenter(t) {
    if (!presenter) return;
    const L = TL.lines.find(l => t >= l.start && t < l.end);
    const fi = L ? Math.floor((t - L.start) * fps) : 0, lv = L ? ((L.mouth[fi] || 0) + (L.mouth[fi + 2] || 0)) / 2 : 0;
    const ph = 1450, pw = ph * presenter.width / presenter.height;
    const enter = eout((t - .3) / .7), sway = Math.sin(t * .7) * 5, br = 1 + .005 * Math.sin(t * 1.6);
    g.save(); g.translate(W / 2 + sway, 1330 - lv * 6 + (1 - enter) * 160); g.scale(br, br);
    g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 40; g.globalAlpha = enter;
    g.drawImage(presenter, -pw / 2, 0, pw, ph); g.restore();
  }
  function captions(t) {
    const L = TL.lines.find(l => t >= l.start - .1 && t < l.end + .3); if (!L) return;
    g.font = '700 46px Inter'; const words = L.text.split(' '), rows = []; let cur = '';
    for (const w of words) { const n = cur ? cur + ' ' + w : w; if (g.measureText(n).width > 920 && cur) { rows.push(cur); cur = w; } else cur = n; }
    rows.push(cur);
    const spoken = clamp((t - L.start) / (L.end - L.start), 0, 1) * L.text.length;
    let acc = 0, ci = 0; rows.forEach((r, i) => { if (spoken >= acc) ci = i; acc += r.length + 1; });
    const page = Math.floor(ci / 2), show = rows.slice(page * 2, page * 2 + 2);
    let ch = rows.slice(0, page * 2).reduce((a, r) => a + r.length + 1, 0);
    show.forEach((row, r) => {
      const rw = g.measureText(row).width, y = 1235 + r * 62; let x = W / 2 - rw / 2;
      g.beginPath(); g.roundRect(x - 22, y - 46, rw + 44, 62, 12); g.fillStyle = 'rgba(12,8,4,.72)'; g.fill();
      row.split(' ').forEach((w, j) => { const pc = (j ? ' ' : '') + w; g.fillStyle = ch + pc.length * .5 <= spoken ? '#fff' : 'rgba(255,255,255,.5)'; g.textAlign = 'left'; g.fillText(pc, x, y); x += g.measureText(pc).width; ch += pc.length; });
      ch += 1;
    });
  }
  function titleCard(t) {
    const c = TL.cues.find(c => c.type === 'title'); if (!c || t > c.t + c.dur) return;
    const a = Math.min(clamp((t - c.t) / .4, 0, 1), 1 - clamp((t - c.t - c.dur + .5) / .5, 0, 1));
    g.save(); g.globalAlpha = a; g.textAlign = 'center'; g.lineJoin = 'round';
    const k = back((t - c.t) / .7); g.translate(W / 2, 330); g.scale(.9 + .1 * k, .9 + .1 * k);
    g.font = '800 112px "Playfair Display"'; g.lineWidth = 14; g.strokeStyle = 'rgba(0,0,0,.75)'; g.strokeText(TL.meta.title, 0, 0); g.fillStyle = '#fff'; g.fillText(TL.meta.title, 0, 0);
    if (TL.meta.subtitle) { g.font = '700 50px Inter'; g.strokeText(TL.meta.subtitle, 0, 90); g.fillStyle = C.yellow; g.fillText(TL.meta.subtitle, 0, 90); }
    g.restore();
  }
  function endCard(t) {
    const c = TL.cues.find(c => c.type === 'endcard'); if (!c || t < c.t) return;
    const k = back((t - c.t) / .6), a = clamp((t - c.t) / .3, 0, 1);
    g.save(); g.globalAlpha = a; g.translate(W / 2, 300); g.scale(.9 + .1 * k, .9 + .1 * k); g.textAlign = 'center';
    let fs = 70; g.font = `800 ${fs}px Inter`; while (g.measureText(c.value).width > 900 && fs > 40) { fs -= 4; g.font = `800 ${fs}px Inter`; }
    const w = g.measureText(c.value).width + 70;
    g.beginPath(); g.roundRect(-w / 2, -70, w, 100, 20); g.fillStyle = C.yellow; g.fill(); g.fillStyle = '#1b130a'; g.fillText(c.value, 0, 6);
    if (c.sub) { g.font = '700 42px Inter'; g.fillStyle = '#fff'; g.fillText(c.sub, 0, 100); }
    g.restore();
  }

  function render(f) {
    const t = f / fps;
    g.fillStyle = '#0b0805'; g.fillRect(0, 0, W, H);
    // current + previous shot crossfade
    let i = 0; while (i + 1 < shots.length && shots[i + 1].t <= t) i++;
    const s = shots[i];
    if (s) {
      const fade = clamp((t - s.t) / .7, 0, 1);
      if (i > 0 && fade < 1) drawShot(shots[i - 1], t, 1);
      drawShot(s, t, i > 0 ? ease(fade) : 1);
    }
    // grade: warm overlay, vignette, top/bottom darkening for legibility
    g.fillStyle = 'rgba(60,35,10,.12)'; g.fillRect(0, 0, W, H);
    const vg = g.createRadialGradient(W / 2, H * .42, H * .25, W / 2, H * .45, H * .8); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.6)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    const bt = g.createLinearGradient(0, H * .55, 0, H); bt.addColorStop(0, 'rgba(0,0,0,0)'); bt.addColorStop(1, 'rgba(0,0,0,.75)'); g.fillStyle = bt; g.fillRect(0, H * .55, W, H * .45);
    g.drawImage(grain[Math.floor(t * 24) % 4], 0, 0, W, H);
    if (s) drawOverlays(s, t);
    titleCard(t); drawPresenter(t); captions(t); endCard(t);
    // credit line for the current image + progress bar
    if (s && imgs[s.value.img]) {
      const cr = credits.find(c => c.key === s.value.img);
      if (cr) { g.font = '500 22px Inter'; g.textAlign = 'right'; g.fillStyle = 'rgba(255,255,255,.7)'; g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 6; g.fillText(cr.short, W - 28, 50); g.shadowBlur = 0; g.textAlign = 'left'; }
    }
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(0, H - 8, W, 8); g.fillStyle = C.yellow; g.fillRect(0, H - 8, W * t / TL.duration, 8);
    if (t < .4) { g.fillStyle = `rgba(0,0,0,${1 - t / .4})`; g.fillRect(0, 0, W, H); }
  }
  function renderCover() { render(Math.round(1.5 * fps)); }
  return { init, render, renderCover };
})();
