// Style "presenter-explainer": cut-out presenter at the bottom, animated info cards above, karaoke captions.
// Same API as renderer.js (BR.init / BR.render / BR.renderCover) so capture.js drives both.
const BR = (() => {
  const W = 1080, H = 1920;
  const C = { bg0: '#171a2b', bg1: '#0a0c14', ink: '#f2efe6', dim: '#8d93a8', line: '#2a2f45',
              yellow: '#f5b942', mint: '#5fe0b8', violet: '#9b8cff', red: '#ff6b6b', blue: '#7aa7ff', paper: '#efe6d2' };
  let TL, fps, g, out, presenter = [], cards = [], cueList = [];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const easeBack = x => { x = clamp(x, 0, 1); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

  async function init(tl) {
    TL = tl; fps = tl.meta.fps;
    out = document.getElementById('out'); g = out.getContext('2d');
    const a = tl.assets || {};
    for (const src of (a.presenter || [])) presenter.push(await loadImg(src));
    cueList = tl.cues;
    cards = tl.cues.filter(c => c.type === 'card' || c.type === 'endcard').map((c, i, arr) =>
      ({ ...c, end: i + 1 < arr.length ? arr[i + 1].t : tl.duration + 1 }));
    await document.fonts.ready;
    await Promise.all(['800 80px Kanit', '700 40px Kanit', '600 40px "IBM Plex Sans Thai"', '600 30px "IBM Plex Mono"']
      .map(f => document.fonts.load(f, 'กขA0')));
  }

  // ---------- helpers ----------
  function text(t, x, y, font, color, align = 'left', base = 'alphabetic') {
    g.font = font; g.fillStyle = color; g.textAlign = align; g.textBaseline = base; g.fillText(t, x, y);
  }
  function rr(x, y, w, h, r) { g.beginPath(); g.roundRect(x, y, w, h, r); }
  // largest font size (<= max) that fits text on one line within w
  function fitFont(t, weight, family, max, min, w) {
    let sz = max; g.font = `${weight} ${sz}px ${family}`;
    while (sz > min && g.measureText(t).width > w) { sz -= 4; g.font = `${weight} ${sz}px ${family}`; }
    return g.font;
  }
  function fmtNum(v, dec) { return v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }
  const seg = new Intl.Segmenter('th', { granularity: 'word' });
  function wrap(s, maxW) {
    const rows = [[]]; let w = 0;
    for (const { segment: p } of seg.segment(s)) {
      const pw = g.measureText(p).width;
      if (w + pw > maxW && rows[rows.length - 1].length) { rows.push([]); w = 0; if (p === ' ') continue; }
      rows[rows.length - 1].push(p); w += pw;
    }
    return rows.map(r => r.join(''));
  }

  // ---------- background ----------
  function background(t, paper) {
    if (paper) {
      const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#e9dcc0'); gr.addColorStop(1, '#cdb78f');
      g.fillStyle = gr; g.fillRect(0, 0, W, H);
      g.fillStyle = 'rgba(0,0,0,.10)'; g.fillRect(0, 1180, W, 46); // shelf shadow like the reference
      return;
    }
    const gr = g.createRadialGradient(W / 2, 520, 60, W / 2, 760, 1300);
    gr.addColorStop(0, C.bg0); gr.addColorStop(1, C.bg1); g.fillStyle = gr; g.fillRect(0, 0, W, H);
    // slow drifting dust
    g.fillStyle = 'rgba(155,140,255,.06)';
    for (let i = 0; i < 26; i++) {
      const x = (i * 197 + t * (6 + i % 5)) % W, y = (i * 331 + Math.sin(t * .3 + i) * 30) % 1100;
      g.beginPath(); g.arc(x, y, 2 + i % 3, 0, 7); g.fill();
    }
  }

  // ---------- cards ----------
  // every card gets k (0..1 intro progress), age (s since start) and an exit fade
  const CARDS = {
    title(c, k) {
      g.save(); g.translate(W / 2, 470); g.scale(.9 + .1 * easeBack(k), .9 + .1 * easeBack(k));
      const f = fitFont(c.text, 800, 'Kanit', 112, 64, 960); const rows = [c.text];
      text(c.text, 0, 0, f, C.ink, 'center');
      if (c.sub) {
        g.font = '600 38px "IBM Plex Sans Thai"'; const w = g.measureText(c.sub).width + 60;
        rr(-w / 2, 60, w, 64, 32); g.strokeStyle = C.yellow; g.lineWidth = 3; g.stroke();
        text(c.sub, 0, 104, '600 38px "IBM Plex Sans Thai"', C.yellow, 'center');
      }
      g.restore();
    },
    counter(c, k, age) {
      const v = (c.value || 0) * ease(age / 1.3);
      text(c.label || '', W / 2, 250, '600 40px "IBM Plex Sans Thai"', C.dim, 'center');
      g.font = '800 230px Kanit'; const s = fmtNum(v, c.decimals || 0), sw = g.measureText(s).width;
      g.font = '700 70px Kanit'; const uw = c.unit ? g.measureText(c.unit).width + 16 : 0;
      const x0 = W / 2 - (sw + uw) / 2;
      text(s, x0, 500, '800 230px Kanit', C.ink); if (c.unit) text(c.unit, x0 + sw + 16, 500, '700 70px Kanit', C.ink);
      if (c.pill) {
        g.font = '600 40px "IBM Plex Sans Thai"'; const w = g.measureText(c.pill).width + 64, a = ease((age - .9) / .4);
        g.globalAlpha *= a; rr(W / 2 - w / 2, 560, w, 72, 36); g.strokeStyle = C.yellow; g.lineWidth = 4; g.stroke();
        text(c.pill, W / 2, 610, '600 40px "IBM Plex Sans Thai"', C.yellow, 'center'); g.globalAlpha /= a || 1;
      }
      // dot field that fills in like the reference
      const n = Math.round(ease((age - .3) / 1.4) * 360), tot = c.dots || 0;
      for (let i = 0; i < 360; i++) {
        const x = 110 + (i % 30) * 29, y = 720 + Math.floor(i / 30) * 26;
        g.fillStyle = i < n ? (tot && i < Math.round(tot * 3.6) ? C.yellow : 'rgba(245,185,66,.35)') : 'rgba(255,255,255,.06)';
        g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
      }
    },
    bars(c, k, age) {
      text(c.kicker || 'คำถาม', 90, 200, '500 32px "IBM Plex Sans Thai"', C.dim);
      g.font = '700 60px Kanit'; wrap(c.title || '', 900).forEach((r, i) => text(r, 90, 275 + i * 70, '700 60px Kanit', C.ink));
      const max = c.max || Math.max(...c.items.map(i => i.value));
      c.items.forEach((it, i) => {
        const y = 420 + i * 150, p = ease((age - .25 - i * .18) / .9), col = it.color || [C.yellow, C.blue, C.violet, C.mint][i % 4];
        text(it.label, 90, y, '600 42px "IBM Plex Sans Thai"', C.ink);
        text(fmtNum(it.value * p, c.decimals ?? 1) + (c.unit || ''), 990, y, '600 42px "IBM Plex Mono"', C.ink, 'right');
        rr(90, y + 26, 900, 22, 11); g.fillStyle = C.line; g.fill();
        rr(90, y + 26, Math.max(22, 900 * it.value / max * p), 22, 11); g.fillStyle = col; g.fill();
      });
    },
    threshold(c, k, age) {
      // horizontal scale with coloured zones and a marker that slides to the cut-off
      text(c.kicker || '', 90, 200, '500 34px "IBM Plex Sans Thai"', C.dim);
      text(c.title || '', 90, 285, '700 72px Kanit', C.ink);
      const x0 = 90, x1 = 990, y = 560, lo = c.min, hi = c.max, X = v => x0 + (x1 - x0) * (v - lo) / (hi - lo);
      const zones = c.zones; let from = lo;
      zones.forEach((z, i) => {
        const to = z.to ?? hi, p = ease((age - .2 - i * .25) / .6);
        const zx = X(from), zw = (X(to) - X(from)) * p;
        rr(zx + 3, y, Math.max(0, zw - 6), 54, 14); g.fillStyle = z.color; g.fill();
        g.globalAlpha *= p;
        text(z.label, zx + (X(to) - zx) / 2, y + 150, '600 38px "IBM Plex Sans Thai"', z.color, 'center');
        text(z.range || '', zx + (X(to) - zx) / 2, y + 198, '500 32px "IBM Plex Mono"', C.dim, 'center');
        g.globalAlpha /= p || 1;
        if (z.to != null) text(String(z.to), X(to), y + 92, '600 30px "IBM Plex Mono"', C.dim, 'center');
        from = to;
      });
      if (c.cutoff != null) {
        const p = ease((age - 1.0) / .8), mx = X(lo + (c.cutoff - lo) * p);
        g.globalAlpha *= clamp((age - .9) * 4, 0, 1);
        g.fillStyle = C.ink; g.beginPath(); g.moveTo(mx, y - 8); g.lineTo(mx - 18, y - 44); g.lineTo(mx + 18, y - 44); g.fill();
        g.fillRect(mx - 2, y - 8, 4, 70);
        const lab = c.cutoff_label || ('≥ ' + c.cutoff), bob = Math.sin(age * 3) * 4;
        g.font = '800 92px Kanit'; const w = g.measureText(lab).width + 70;
        rr(mx - w / 2, y - 210 + bob, w, 130, 26); g.fillStyle = C.red; g.fill();
        text(lab, mx, y - 112 + bob, '800 92px Kanit', '#fff', 'center');
        g.globalAlpha = 1;
      }
      if (c.note) { g.font = '500 36px "IBM Plex Sans Thai"'; wrap(c.note, 900).forEach((r, i) => text(r, 90, 860 + i * 50, '500 36px "IBM Plex Sans Thai"', C.dim)); }
    },
    checklist(c, k, age) {
      text(c.title || '', 90, 250, '700 66px Kanit', C.ink);
      c.items.forEach((it, i) => {
        const p = easeBack((age - .4 - i * .45) / .45), y = 380 + i * 150;
        g.save(); g.globalAlpha *= clamp(p, 0, 1); g.translate(90 + (1 - clamp(p, 0, 1)) * -40, y);
        rr(0, 0, 900, 120, 24); g.fillStyle = 'rgba(255,255,255,.05)'; g.fill(); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
        g.fillStyle = C.mint; g.beginPath(); g.arc(70, 60, 32, 0, 7); g.fill();
        g.strokeStyle = '#0b0d15'; g.lineWidth = 8; g.lineCap = 'round'; g.beginPath(); g.moveTo(54, 60); g.lineTo(66, 74); g.lineTo(88, 46); g.stroke();
        text(it, 130, 76, '600 46px "IBM Plex Sans Thai"', C.ink);
        g.restore();
      });
    },
    code(c, k, age) {
      if (c.title) text(c.title, 90, 230, '600 44px "IBM Plex Mono"', C.yellow);
      const lines = c.lines, total = lines.join('\n').length, shown = Math.floor(ease(age / (0.04 * total + .4)) * total);
      rr(70, 280, 940, 120 + lines.length * 74, 22); g.fillStyle = '#0d1019'; g.fill(); g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
      let used = 0;
      lines.forEach((ln, i) => {
        const vis = ln.slice(0, Math.max(0, shown - used)); used += ln.length + 1;
        g.font = '500 44px "IBM Plex Mono"'; let x = 120;
        for (const tok of vis.split(/(\s+)/)) {
          const col = /^(if|else|return|then)$/.test(tok) ? C.violet : /^[\d.]+$/.test(tok) ? C.yellow : /^["“].*/.test(tok) ? C.mint : C.ink;
          g.fillStyle = col; g.fillText(tok, x, 360 + i * 74); x += g.measureText(tok).width;
        }
        if (vis.length < ln.length && vis.length > 0 && Math.floor(age * 3) % 2 === 0) { g.fillStyle = C.ink; g.fillRect(x + 4, 324 + i * 74, 22, 44); }
      });
    },
    numbers(c, k, age) {
      text(c.title || '', W / 2, 220, '700 62px Kanit', C.ink, 'center');
      const n = c.items.length, cols = n > 2 ? 2 : n;
      c.items.forEach((it, i) => {
        const p = easeBack((age - .3 - i * .3) / .5), cx = cols === 1 ? W / 2 : 300 + (i % 2) * 480, cy = 420 + Math.floor(i / 2) * 330;
        g.save(); g.globalAlpha *= clamp(p, 0, 1); g.translate(cx, cy); g.scale(clamp(p, 0, 1.2), clamp(p, 0, 1.2));
        rr(-210, -130, 420, 280, 30); g.fillStyle = 'rgba(255,255,255,.05)'; g.fill(); g.strokeStyle = it.color || C.yellow; g.lineWidth = 4; g.stroke();
        text(it.value, 0, 40, '800 120px Kanit', it.color || C.yellow, 'center');
        text(it.label, 0, 110, '600 36px "IBM Plex Sans Thai"', C.ink, 'center');
        g.restore();
      });
    },
    note(c, k, age) { // taped paper note on a beige "shelf" scene
      const p = easeBack(age / .6);
      g.save(); g.translate(W / 2, 520 - (1 - clamp(p, 0, 1)) * 200); g.rotate(-0.03 + Math.sin(age * 1.2) * 0.006);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(-372, -262, 760, 560);
      g.fillStyle = C.paper; g.fillRect(-380, -280, 760, 560);
      g.fillStyle = 'rgba(210,190,140,.75)'; g.fillRect(-90, -300, 180, 46);
      g.font = '700 64px Kanit'; const rows = wrap(c.text, 640);
      rows.forEach((r, i) => text(r, 0, -120 + i * 84 + (4 - rows.length) * 30, '700 64px Kanit', '#2b2620', 'center'));
      if (c.sub) text(c.sub, 0, 230, '500 34px "IBM Plex Sans Thai"', '#6d6352', 'center');
      g.restore();
    },
    endcard(c, k, age) {
      g.save(); g.translate(W / 2, 430); const s = .85 + .15 * easeBack(k); g.scale(s, s);
      const v = c.value || 'เมนต์มาเลย'; text(v, 0, 0, fitFont(v, 800, 'Kanit', 112, 56, 980), C.yellow, 'center');
      if (c.sub) text(c.sub, 0, 110, '600 48px "IBM Plex Sans Thai"', C.ink, 'center');
      g.restore();
    },
  };

  function drawCards(t) {
    let paper = false;
    for (const c of cards) {
      if (t < c.t || t > c.end + 0.3) continue;
      const age = t - c.t, k = ease(age / .45), exit = 1 - ease((t - c.end) / .3);
      const card = c.type === 'endcard' ? { ...c, kind: 'endcard' } : { ...c.value };
      if (card.kind === 'note') paper = true;
      cardsToDraw.push({ card, age, k, a: Math.min(k, exit), c });
    }
    return paper;
  }
  let cardsToDraw = [];

  // ---------- presenter ----------
  function drawPresenter(t, f) {
    if (!presenter.length) return;
    let pose = 0; for (const c of cueList) if (c.type === 'pose' && c.t <= t) pose = c.value | 0;
    let prevPose = 0, poseT = -9; for (const c of cueList) if (c.type === 'pose' && c.t <= t) { prevPose = pose === (c.value | 0) ? prevPose : pose; poseT = c.t; }
    const L = TL.lines.find(l => t >= l.start && t < l.end);
    const fi = L ? Math.floor((t - L.start) * fps) : 0;
    const lv = L ? ((L.mouth[fi] || 0) + (L.mouth[fi - 1] || 0) + (L.mouth[fi + 2] || 0)) / 3 : 0;
    const im = presenter[Math.min(pose, presenter.length - 1)];
    const ph = 1650, pw = ph * im.width / im.height;
    const breathe = 1 + 0.005 * Math.sin(t * 1.6), sway = Math.sin(t * 0.7) * 6, nod = -lv * 7;
    const enter = ease((t - 0.1) / 0.6);
    g.save();
    g.translate(W / 2 + sway, 1160 + nod + (1 - enter) * 120); g.scale(breathe, breathe);
    // soft floor glow behind
    const gr = g.createRadialGradient(0, 600, 40, 0, 600, 520); gr.addColorStop(0, 'rgba(155,140,255,.20)'); gr.addColorStop(1, 'rgba(155,140,255,0)');
    g.fillStyle = gr; g.fillRect(-600, 0, 1200, 900);
    g.globalAlpha = enter;
    g.drawImage(im, -pw / 2, 0, pw, ph);
    g.restore();
  }

  // ---------- captions (karaoke) ----------
  function drawCaption(t) {
    const L = TL.lines.find(l => t >= l.start - .1 && t < l.end + .35); if (!L) return;
    g.font = '600 46px "IBM Plex Sans Thai"';
    const rows = wrap(L.text, 900).slice(0, 2), total = [...L.text].length;
    const spoken = clamp((t - L.start) / (L.end - L.start), 0, 1) * total;
    const y0 = 1060 - (rows.length - 1) * 30;
    let idx = 0;
    rows.forEach((row, r) => {
      const rw = g.measureText(row).width; let x = W / 2 - rw / 2; const y = y0 + r * 62;
      g.fillStyle = 'rgba(8,10,18,.55)'; rr(x - 22, y - 46, rw + 44, 62, 14); g.fill();
      for (const { segment: s } of seg.segment(row)) {
        const n = [...s].length; g.fillStyle = idx + n * .5 <= spoken ? '#fff' : 'rgba(255,255,255,.45)';
        g.textAlign = 'left'; g.fillText(s, x, y); x += g.measureText(s).width; idx += n;
      }
    });
  }

  function render(f) {
    const t = f / fps;
    cardsToDraw = [];
    const paper = drawCards(t);
    background(t, paper);
    for (const d of cardsToDraw) {
      g.save(); g.globalAlpha = d.a; g.translate(0, (1 - d.k) * 50);
      (CARDS[d.card.kind] || CARDS.note)(d.card, d.k, d.age); g.restore();
    }
    drawPresenter(t, f);
    drawCaption(t);
    // top progress bar + fade in
    g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, 0, W, 8);
    g.fillStyle = C.violet; g.fillRect(0, 0, W * t / TL.duration, 8);
    if (TL.meta.watermark) text(TL.meta.watermark, W - 30, 1900, '500 24px "IBM Plex Sans Thai"', 'rgba(255,255,255,.35)', 'right');
    if (t < .4) { g.fillStyle = `rgba(0,0,0,${1 - t / .4})`; g.fillRect(0, 0, W, H); }
  }

  function renderCover() {
    background(0, false);
    if (presenter.length) {
      const im = presenter[0], ph = 1700, pw = ph * im.width / im.height;
      g.drawImage(im, W / 2 - pw / 2 + 120, 760, pw, ph);
    }
    const gr = g.createLinearGradient(0, 0, 0, 900); gr.addColorStop(0, 'rgba(10,12,20,.9)'); gr.addColorStop(1, 'rgba(10,12,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, 900);
    g.font = '800 128px Kanit';
    wrap(TL.meta.title, 960).forEach((r, i) => {
      g.lineJoin = 'round'; g.lineWidth = 16; g.strokeStyle = '#0a0c14'; g.textAlign = 'left';
      g.strokeText(r, 60, 240 + i * 140); g.fillStyle = i === 0 ? '#fff' : C.yellow; g.fillText(r, 60, 240 + i * 140);
    });
    if (TL.meta.subtitle) text(TL.meta.subtitle, 64, 240 + wrap(TL.meta.title, 960).length * 140 + 10, '600 46px "IBM Plex Sans Thai"', C.mint);
  }
  return { init, render, renderCover };
})();
