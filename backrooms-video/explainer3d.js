// Style "character-explainer": step-by-step how-to in a Three.js cutaway room.
// The user's character walks between stations as a camera-facing billboard; a lip-synced host portrait sits in a
// corner circle; step badges + source chips; captions in the lower third. Every frame is a pure function of t.
const BR = (() => {
  const W = 1080, H = 1920;
  const C = { ink: '#ffffff', dark: 'rgba(12,16,24,.78)', yellow: '#ffcc4d', mint: '#5fe0b8', red: '#ff6b6b', dim: '#c9d2e0' };
  let TL, fps, out, g, gl, renderer, scene, camera, doctor, texFront, texBack, faceClosed, faceOpen;
  const P = {}; // animated props
  let steps = [], stationTimeline = [];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ease = x => { x = clamp(x, 0, 1); return x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
  const eout = x => 1 - Math.pow(1 - clamp(x, 0, 1), 3);
  const back = x => { x = clamp(x, 0, 1); const c = 1.7; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const loadImg = src => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });

  // where the character stands, and where the camera looks, for each station
  const STATIONS = {
    overview: { stand: V(0.3, 0, 0.7),  cam: V(3.6, 3.3, 6.2), look: V(-0.2, 0.9, -1.0) },
    desk:     { stand: V(-1.55, 0, -1.6), cam: V(0.9, 2.1, 3.0), look: V(-1.9, 1.0, -1.9) },
    sink:     { stand: V(-2.45, 0, 0.35), cam: V(0.4, 1.9, 3.6), look: V(-2.7, 1.0, 0.0), faceAway: true },
    bed:      { stand: V(0.55, 0, -2.45), cam: V(1.8, 2.45, 3.3), look: V(0.6, 1.1, -1.9) },
    bedClose: { stand: V(0.55, 0, -2.45), cam: V(1.35, 2.15, 1.75), look: V(0.55, 1.15, -1.9) },
    sharps:   { stand: V(2.05, 0, -0.25), cam: V(0.5, 1.75, 3.4), look: V(2.2, 1.05, -0.6) },
    center:   { stand: V(0.3, 0, 0.75),  cam: V(0.35, 1.55, 4.6), look: V(0.3, 1.15, 0.4) },
  };
  const VIA = { bed: [V(-0.9, 0, -2.5)], sharps: [V(1.95, 0, -2.45)] };

  // ---------- canvas textures ----------
  function canvasTex(w, h, draw) {
    const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c); t.anisotropy = 4; t.encoding = THREE.sRGBEncoding; return t;
  }
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, metalness: 0, ...o });
  function box(w, h, d, m, x, y, z, parent = scene) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.castShadow = b.receiveShadow = true; parent.add(b); return b;
  }

  function buildRoom() {
    scene = new THREE.Scene(); scene.background = new THREE.Color('#1b2230');
    scene.add(new THREE.HemisphereLight(0xffffff, 0x7a8796, 0.75));
    const sun = new THREE.DirectionalLight(0xfff3e0, 0.85); sun.position.set(3, 6, 5); sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5 }); sun.shadow.bias = -0.0005;
    scene.add(sun);
    const fill = new THREE.PointLight(0xcfe8ff, 0.35, 12); fill.position.set(-1, 2.6, 1); scene.add(fill);

    const floorTex = canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = '#d8c29f'; c.fillRect(0, 0, w, h);
      for (let i = 0; i < 8; i++) { c.fillStyle = i % 2 ? '#d2bb97' : '#dcc7a6'; c.fillRect(0, i * 64, w, 62); }
      c.strokeStyle = 'rgba(120,90,60,.25)'; for (let i = 0; i < 8; i++) { c.beginPath(); c.moveTo((i * 137) % w, i * 64); c.lineTo((i * 137) % w, i * 64 + 62); c.stroke(); }
    });
    floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping; floorTex.repeat.set(3, 3);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 6.6), mat('#ffffff', { map: floorTex }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, 0, -0.1); floor.receiveShadow = true; scene.add(floor);
    const wallM = mat('#e9eef0'), wallM2 = mat('#dfe8ea');
    const backW = new THREE.Mesh(new THREE.PlaneGeometry(7.4, 3.1), wallM); backW.position.set(0, 1.55, -3.0); backW.receiveShadow = true; scene.add(backW);
    const leftW = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 3.1), wallM2); leftW.rotation.y = Math.PI / 2; leftW.position.set(-3.7, 1.55, -0.1); leftW.receiveShadow = true; scene.add(leftW);
    box(7.4, .12, .04, mat('#b9c6cc'), 0, .06, -2.98); box(.04, .12, 6.6, mat('#b9c6cc'), -3.68, .06, -0.1);
    // cutaway edges (thick wall section like a model house)
    box(7.5, 3.1, .18, mat('#f5f2ec'), 0, 1.55, -3.1); box(.18, 3.1, 6.7, mat('#f5f2ec'), -3.8, 1.55, -0.1);
    box(7.5, .06, .2, mat('#c8b49a'), 0, 3.1, -3.1); box(.2, .06, 6.7, mat('#c8b49a'), -3.8, 3.1, -0.1);
    // window
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.0), new THREE.MeshBasicMaterial({ color: '#bfe3ff' }));
    win.position.set(2.2, 1.9, -2.97); scene.add(win);
    box(1.6, .06, .06, mat('#ffffff'), 2.2, 2.42, -2.95); box(1.6, .06, .06, mat('#ffffff'), 2.2, 1.38, -2.95);
    box(.06, 1.1, .06, mat('#ffffff'), 2.2, 1.9, -2.95);
    // plant
    box(.34, .4, .34, mat('#c6704b'), 3.1, .2, -2.55);
    for (let i = 0; i < 7; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(.18, 12, 10), mat('#4f9a62')); l.position.set(3.1 + Math.sin(i * 2) * .14, .55 + i * .07, -2.55 + Math.cos(i * 2) * .14); l.castShadow = true; scene.add(l); }
    // shelf + poster
    box(1.3, .05, .3, mat('#c9a77a'), -1.4, 2.05, -2.85);
    [['#5fb3d9', -1.85], ['#f2c35b', -1.6], ['#e57373', -1.35]].forEach(([c, x]) => box(.16, .3, .22, mat(c), x, 2.23, -2.85));
    const poster = new THREE.Mesh(new THREE.PlaneGeometry(.8, 1.05), new THREE.MeshStandardMaterial({ map: canvasTex(320, 420, (c, w, h) => {
      c.fillStyle = '#fbfaf6'; c.fillRect(0, 0, w, h); c.fillStyle = '#2f4858'; c.font = '700 28px Inter'; c.fillText('BODY MAP', 30, 50);
      c.strokeStyle = '#5c7d8a'; c.lineWidth = 6; c.beginPath(); c.arc(160, 120, 34, 0, 7); c.stroke();
      c.beginPath(); c.moveTo(160, 154); c.lineTo(160, 300); c.moveTo(100, 200); c.lineTo(220, 200); c.moveTo(160, 300); c.lineTo(115, 390); c.moveTo(160, 300); c.lineTo(205, 390); c.stroke();
      c.fillStyle = '#e05a47'; [[160, 190], [130, 240], [190, 240], [160, 280], [125, 350], [195, 350]].forEach(([x, y]) => { c.beginPath(); c.arc(x, y, 7, 0, 7); c.fill(); });
    }) }));
    poster.position.set(-0.6, 1.75, -2.965); scene.add(poster); P.poster = poster;
  }

  function buildProps() {
    // desk + chair + clipboard
    box(1.3, .06, .7, mat('#c9a77a'), -2.2, .76, -2.2); [[-2.78, -2.48], [-1.62, -2.48], [-2.78, -1.92], [-1.62, -1.92]].forEach(([x, z]) => box(.05, .76, .05, mat('#8f775a'), x, .38, z));
    box(.45, .04, .45, mat('#4a6b82'), -2.2, .46, -1.65); box(.45, .45, .04, mat('#4a6b82'), -2.2, .7, -1.45);
    box(.42, .02, .3, mat('#2c3e50'), -2.45, .8, -2.25); // laptop base
    const lid = box(.42, .28, .02, mat('#2c3e50'), -2.45, .94, -2.4); lid.rotation.x = -0.25;
    P.clip = box(.24, .015, .32, mat('#f4efe3'), -1.85, .79, -2.1);
    P.checks = [0, 1, 2, 3].map(i => { const m = new THREE.Mesh(new THREE.SphereGeometry(.035, 14, 10), mat('#43c08a', { emissive: '#1f7a50', emissiveIntensity: .5 }));
      m.position.set(-1.92, .82, -2.2 + i * .07); m.scale.setScalar(0.001); scene.add(m); return m; });
    // sink
    box(.6, .85, .5, mat('#e6ecef'), -3.35, .425, 0.2); const basin = box(.5, .08, .4, mat('#ffffff', { roughness: .3 }), -3.35, .9, 0.2);
    box(.04, .3, .04, mat('#b0bcc4', { metalness: .6, roughness: .3 }), -3.55, 1.05, 0.2); box(.22, .04, .04, mat('#b0bcc4', { metalness: .6, roughness: .3 }), -3.45, 1.19, 0.2);
    box(.08, .16, .08, mat('#78c2e8'), -3.55, 1.02, -0.05); // soap
    P.water = new THREE.Mesh(new THREE.CylinderGeometry(.015, .02, .26, 10), new THREE.MeshStandardMaterial({ color: '#9fd8ff', transparent: true, opacity: 0 }));
    P.water.position.set(-3.35, 1.05, 0.2); scene.add(P.water);
    P.bubbles = [...Array(10)].map((_, i) => { const m = new THREE.Mesh(new THREE.SphereGeometry(.03 + (i % 3) * .012, 12, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0, roughness: .1 })); scene.add(m); return m; });
    // bed + patient (prone, towel over legs)
    box(2.0, .5, .8, mat('#d7dde2'), 0.6, .25, -1.6); box(2.0, .14, .82, mat('#cfe9e6'), 0.6, .57, -1.6);
    box(.3, .08, .3, mat('#cfe9e6'), 1.75, .58, -1.6);
    const skin = mat('#e2b28e');
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(.2, .62, 6, 16), skin); torso.rotation.z = Math.PI / 2; torso.scale.set(1, 1, .72);
    torso.position.set(0.95, .8, -1.6); torso.castShadow = true; scene.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(.15, 20, 16), skin); head.position.set(1.52, .78, -1.6); scene.add(head);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(.152, 20, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat('#2b1d14')); hair.rotation.z = -Math.PI / 2; hair.position.copy(head.position); scene.add(hair);
    [-1, 1].forEach(s => { const a = new THREE.Mesh(new THREE.CapsuleGeometry(.06, .5, 4, 10), skin); a.rotation.z = Math.PI / 2; a.position.set(0.95, .72, -1.6 + s * .27); scene.add(a); });
    const legs = new THREE.Mesh(new THREE.CapsuleGeometry(.17, .7, 4, 12), mat('#e2b28e')); legs.rotation.z = Math.PI / 2; legs.position.set(0.05, .74, -1.6); scene.add(legs);
    box(1.0, .1, .7, mat('#f0d9a8'), 0.0, .86, -1.6); // towel
    // needles on the back: shaft + handle, inserted in step 3, stimulated in step 4, removed in step 5
    const pts = [[0.72, -1.66], [0.72, -1.54], [0.9, -1.7], [0.9, -1.5], [1.1, -1.64], [1.1, -1.56]];
    P.needles = pts.map(([x, z]) => {
      const n = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.0035, .0035, .12, 6), mat('#d9dee3', { metalness: .9, roughness: .2 })); shaft.position.y = .06;
      const hand = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .05, 10), mat('#d4a940', { metalness: .7, roughness: .3 })); hand.position.y = .145;
      n.add(shaft, hand); n.position.set(x, .93, z); n.visible = false; scene.add(n); return n;
    });
    // trolley: tray, sterile packets, guide tube, e-stim unit
    box(.7, .04, .5, mat('#d9e1e6', { metalness: .4, roughness: .4 }), -0.55, .82, -1.15);
    [[-0.85, -1.35], [-0.25, -1.35], [-0.85, -0.95], [-0.25, -0.95]].forEach(([x, z]) => box(.03, .82, .03, mat('#9aa7b0'), x, .41, z));
    box(.7, .03, .5, mat('#d9e1e6'), -0.55, .3, -1.15);
    P.packets = [0, 1, 2].map(i => { const m = box(.12, .02, .18, mat('#ffffff', { emissive: '#3b82c4', emissiveIntensity: .0 }), -0.75 + i * .16, .85, -1.1); m.scale.setScalar(0.001); return m; });
    P.unit = box(.18, .1, .14, mat('#3d4b57'), -0.4, .89, -1.3);
    P.led = new THREE.Mesh(new THREE.SphereGeometry(.015, 10, 8), new THREE.MeshBasicMaterial({ color: '#444' })); P.led.position.set(-0.36, .95, -1.23); scene.add(P.led);
    P.wires = [0, 1].map(i => { const m = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(-0.4, .92, -1.3), V(0.1, 1.15, -1.45), V(0.72, 1.08, i ? -1.54 : -1.66)]), 24, .006, 6), mat(i ? '#e5534b' : '#2f7ed8'));
      m.visible = false; scene.add(m); return m; });
    // sharps bin
    box(.3, .7, .3, mat('#8c99a3'), 2.55, .35, -0.55);
    P.bin = box(.34, .36, .3, mat('#f2c230'), 2.55, .88, -0.55); P.lid = box(.36, .05, .32, mat('#d64040', { emissive: '#ff3b3b', emissiveIntensity: 0 }), 2.55, 1.09, -0.55);
    // wall clock
    const face = new THREE.Mesh(new THREE.CircleGeometry(.24, 40), mat('#ffffff')); face.position.set(-0.9, 2.45, -2.97); scene.add(face);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(.24, .02, 8, 40), mat('#33414d')); rim.position.copy(face.position); scene.add(rim);
    P.hourHand = box(.02, .13, .01, mat('#33414d'), 0, 0, 0); P.minHand = box(.012, .19, .01, mat('#e05a47'), 0, 0, 0);
    [P.hourHand, P.minHand].forEach(h => { h.geometry.translate(0, h === P.hourHand ? .065 : .095, 0); h.position.set(-0.9, 2.45, -2.955); });
    // calendar of sessions (for the outro)
    P.cal = new THREE.Mesh(new THREE.PlaneGeometry(.6, .5), new THREE.MeshStandardMaterial({ map: canvasTex(240, 200, (c, w, h) => {
      c.fillStyle = '#fff'; c.fillRect(0, 0, w, h); c.fillStyle = '#e05a47'; c.fillRect(0, 0, w, 40);
      c.fillStyle = '#fff'; c.font = '700 22px Inter'; c.fillText('SESSIONS', 60, 28); c.strokeStyle = '#d0d6db';
      for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) c.strokeRect(14 + i * 43, 52 + j * 36, 40, 33);
    }) })); P.cal.position.set(-2.6, 1.6, -2.97); scene.add(P.cal);
  }

  // ---------- Blender set (glTF) ----------
  // The model replaces every static piece built above; animated props (needles, water, wires, LED, checks,
  // packets, poster, calendar) stay. Clock hands, sharps lid and Station_* empties are taken from the model.
  async function useModel(dataUrl) {
    const buf = await (await fetch(dataUrl)).arrayBuffer();
    const gltf = await new Promise((res, rej) => new THREE.GLTFLoader().parse(buf, '', res, rej));
    const keep = new Set([...P.checks, ...P.needles, ...P.bubbles, ...P.packets, ...P.wires, P.water, P.led, P.cal, P.poster].filter(Boolean));
    for (const o of [...scene.children]) if (!o.isLight && !keep.has(o)) scene.remove(o);
    const root = gltf.scene; scene.add(root);
    root.traverse(o => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; if (o.material) o.material.side = THREE.FrontSide; } });
    const byName = n => root.getObjectByName(n);
    if (byName('SharpsLid')) { P.lid = byName('SharpsLid'); P.lid.material = P.lid.material.clone(); P.lid.material.emissive = new THREE.Color('#ff3b3b'); P.lid.material.emissiveIntensity = 0; }
    if (byName('ClockHour')) P.hourHand = byName('ClockHour');
    if (byName('ClockMin')) P.minHand = byName('ClockMin');
    root.updateMatrixWorld(true);
    for (const k of Object.keys(STATIONS)) { const e = byName('Station_' + k); if (e) { const v = new THREE.Vector3(); e.getWorldPosition(v); STATIONS[k].stand = V(v.x, 0, v.z); } }
    scene.background = new THREE.Color('#1b2230');
  }

  // ---------- character billboard ----------
  function buildDoctor(imFront, imBack) {
    const mk = im => { const t = new THREE.Texture(im); t.needsUpdate = true; t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t; };
    texFront = mk(imFront); texBack = mk(imBack);
    doctor = new THREE.Sprite(new THREE.SpriteMaterial({ map: texFront, transparent: true }));
    doctor.center.set(0.5, 0); doctor.userData.aspect = imFront.width / imFront.height; doctor.userData.aspectB = imBack.width / imBack.height;
    scene.add(doctor);
    // contact shadow
    P.shadow = new THREE.Mesh(new THREE.CircleGeometry(.2, 24), new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: .16 }));
    P.shadow.rotation.x = -Math.PI / 2; scene.add(P.shadow);
  }

  // ---------- timeline helpers ----------
  function buildStationTimeline() {
    // [{t, station}] in order: overview, then each step's station
    stationTimeline = [{ t: 0, station: 'overview', stand: 'center' }];
    for (const s of steps) stationTimeline.push({ t: s.t, station: s.value.station || 'center' });
    const end = TL.cues.find(c => c.type === 'endcard');
    if (end) stationTimeline.push({ t: end.t, station: 'center' });
  }
  function routeBetween(a, b) {
    const pts = [STATIONS[a].stand, ...((VIA[b] && a !== b) ? VIA[b] : []), STATIONS[b].stand];
    if (a === 'bed' || a === 'bedClose') { if (VIA[a] && b !== 'bed' && b !== 'bedClose') pts.splice(1, 0, ...VIA[a].slice().reverse()); }
    return pts;
  }
  function walkState(t) {
    let i = 0; while (i + 1 < stationTimeline.length && stationTimeline[i + 1].t <= t) i++;
    const cur = stationTimeline[i], prev = stationTimeline[i - 1];
    const standKey = s => (s.stand || s.station) === 'overview' ? 'center' : (s.stand || s.station);
    if (!prev) return { pos: STATIONS[standKey(cur)].stand.clone(), moving: false, dir: V(0, 0, 1), station: cur.station };
    const a = standKey(prev), b = standKey(cur);
    const route = routeBetween(a, b);
    let len = 0; const seg = []; for (let k = 1; k < route.length; k++) { const d = route[k].distanceTo(route[k - 1]); seg.push(d); len += d; }
    const dur = len / 1.15, k = clamp((t - cur.t) / Math.max(dur, .01), 0, 1), s = ease(k) * len;
    let acc = 0, pos = route[route.length - 1].clone(), dir = V(0, 0, 1);
    for (let j = 0; j < seg.length; j++) {
      if (s <= acc + seg[j] || j === seg.length - 1) {
        const f = clamp((s - acc) / (seg[j] || 1), 0, 1); pos = route[j].clone().lerp(route[j + 1], f); dir = route[j + 1].clone().sub(route[j]).normalize(); break;
      }
      acc += seg[j];
    }
    return { pos, moving: k > 0 && k < 1 && len > 0.05, dir, station: cur.station, walked: s };
  }
  function cameraAt(t) {
    let i = 0; while (i + 1 < stationTimeline.length && stationTimeline[i + 1].t <= t) i++;
    const cur = STATIONS[stationTimeline[i].station], prev = STATIONS[(stationTimeline[i - 1] || stationTimeline[i]).station];
    const k = ease((t - stationTimeline[i].t) / 1.6);
    const pos = prev.cam.clone().lerp(cur.cam, k), look = prev.look.clone().lerp(cur.look, k);
    const drift = (t - stationTimeline[i].t) * 0.035;          // slow push-in while the step plays
    pos.lerp(look, Math.min(0.07, drift * 0.2));
    return { pos, look };
  }
  const stepAt = t => { let s = null; for (const x of steps) if (x.t <= t) s = x; return s; };
  const since = (n, t) => { const s = steps.find(x => x.value.n === n); return s ? t - s.t : -1; };

  // ---------- per-frame prop animation ----------
  function animateProps(t) {
    // step 1: checklist dots pop on the clipboard
    const s1 = since(1, t); P.checks.forEach((m, i) => m.scale.setScalar(Math.max(0.001, back((s1 - 1.2 - i * .6) / .4))));
    // step 2: running water, bubbles, sterile packets pop on the tray
    const s2 = since(2, t), wash = s2 > 1.4 && s2 < 4.6;
    P.water.material.opacity = wash ? .7 : 0; P.water.scale.y = 1 + Math.sin(t * 30) * .05;
    P.bubbles.forEach((b, i) => { const ph = ((t * .5 + i * .13) % 1); b.position.set(-3.35 + Math.sin(i * 7 + t) * .18, 1.0 + ph * .6, 0.2 + Math.cos(i * 5) * .15); b.material.opacity = wash ? .7 * (1 - ph) : 0; });
    P.packets.forEach((m, i) => { m.scale.setScalar(Math.max(0.001, back((s2 - 3.0 - i * .35) / .4))); m.material.emissiveIntensity = s2 > 3 && s2 < 9 ? .35 + .25 * Math.sin(t * 4 + i) : 0; });
    // step 3: needles slide in one by one
    const s3 = since(3, t), s5 = since(5, t), s4 = since(4, t);
    P.needles.forEach((n, i) => {
      const inK = eout((s3 - 1.6 - i * .45) / .5);
      const outK = s5 >= 0 ? eout((s5 - 1.4 - i * .3) / .5) : 0;
      n.visible = s3 >= 0 && inK > 0 && outK < 1;
      const base = n.userData.base || (n.userData.base = n.position.clone());
      n.position.set(base.x, base.y + (1 - inK) * .25 + outK * .35, base.z);
      if (outK > 0) n.position.lerp(V(2.55, 1.12, -0.55), Math.max(0, (outK - .3) / .7)); // fly to the sharps bin
      n.rotation.y = s4 >= 0 && s5 < 0 ? Math.sin((t + i) * 6) * .6 * Math.min(1, s4 / 2) : 0; // gentle twirl
    });
    // step 4: e-stim wires + blinking LED, clock runs
    const stim = s4 >= 1.5 && s5 < 0;
    P.wires.forEach(w => (w.visible = stim)); P.led.material.color.set(stim && Math.floor(t * 4) % 2 ? '#3dff7a' : '#444');
    const clockT = t * 0.15 + (s4 > 0 && s5 < 0 ? s4 * 1.4 : 0) + (s5 >= 0 ? 7 : 0);
    P.minHand.rotation.z = -clockT * Math.PI * 2 / 6; P.hourHand.rotation.z = -clockT * Math.PI * 2 / 72;
    // step 5: bin lid glows as needles drop in
    P.lid.material.emissiveIntensity = s5 > 1.5 && s5 < 5 ? .5 + .4 * Math.sin(t * 8) : 0;
  }

  function placeDoctor(t) {
    const w = walkState(t), st = STATIONS[w.station] || STATIONS.center;
    const camDir = camera.getWorldDirection(V(0, 0, 0));
    const away = w.moving ? w.dir.dot(camDir) > 0.35 : !!st.faceAway;
    const tex = away ? texBack : texFront;
    if (doctor.material.map !== tex) { doctor.material.map = tex; doctor.material.needsUpdate = true; }
    const hgt = 1.74, asp = away ? doctor.userData.aspectB : doctor.userData.aspect;
    const phase = (w.walked || 0) / 0.55 * Math.PI;                       // one bob per step
    const bob = w.moving ? Math.abs(Math.sin(phase)) * .045 : Math.sin(t * 1.7) * .006;
    const sway = w.moving ? Math.sin(phase) * .025 : 0;
    // flip to face the walking direction (screen-space x)
    const right = V().crossVectors(camDir, V(0, 1, 0)).normalize();
    const flip = w.moving && !away && w.dir.dot(right) < -0.2 ? -1 : 1;
    doctor.scale.set(hgt * asp * flip, hgt * (1 + (w.moving ? 0 : Math.sin(t * 1.7) * .004)), 1);
    doctor.position.set(w.pos.x + right.x * sway, bob, w.pos.z + right.z * sway);
    doctor.material.rotation = w.moving ? Math.sin(phase) * .02 : 0;
    P.shadow.position.set(w.pos.x, .005, w.pos.z); P.shadow.scale.setScalar(1 - bob * 2);
  }

  // ---------- 2D overlays ----------
  const seg = new Intl.Segmenter('en', { granularity: 'word' });
  function wrapWords(s, maxW) {
    const words = s.split(' '), rows = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (g.measureText(t).width > maxW && cur) { rows.push(cur); cur = w; } else cur = t; }
    if (cur) rows.push(cur); return rows;
  }
  function pill(x, y, txt, font, fg, bg, padX = 22, h = 52) {
    g.font = font; const w = g.measureText(txt).width + padX * 2;
    g.beginPath(); g.roundRect(x, y, w, h, h / 2); g.fillStyle = bg; g.fill(); g.fillStyle = fg; g.textBaseline = 'middle'; g.textAlign = 'left'; g.fillText(txt, x + padX, y + h / 2 + 1); g.textBaseline = 'alphabetic';
    return w;
  }
  function stepBadge(t) {
    const s = stepAt(t); if (!s) return;
    const age = t - s.t, k = back(age / .5), a = clamp(age / .25, 0, 1);
    g.save(); g.globalAlpha = a; g.translate(-(1 - clamp(k, 0, 1)) * 420, 0);
    g.beginPath(); g.roundRect(36, 150, 700, 150, 36); g.fillStyle = C.dark; g.fill();
    g.beginPath(); g.arc(112, 225, 58, 0, 7); g.fillStyle = C.yellow; g.fill();
    g.fillStyle = '#1b2230'; g.font = '800 72px Inter'; g.textAlign = 'center'; g.fillText(String(s.value.n), 112, 251);
    g.textAlign = 'left'; g.fillStyle = C.dim; g.font = '700 26px Inter'; g.fillText('STEP ' + s.value.n, 196, 204);
    g.fillStyle = C.ink; g.font = '800 54px Inter'; g.fillText(s.value.title, 196, 264);
    let x = 40; (s.value.chips || []).forEach((c, i) => { const ka = clamp((age - .5 - i * .15) / .3, 0, 1); g.globalAlpha = a * ka; x += pill(x, 318, c, '700 26px Inter', '#1b2230', '#dff7ee', 18, 46) + 10; });
    g.restore();
  }
  function hostCard(t) {
    const L = TL.lines.find(l => t >= l.start && t < l.end);
    const fi = L ? Math.floor((t - L.start) * fps) : 0;
    const lv = L ? Math.max(L.mouth[fi] || 0, L.mouth[fi + 1] || 0) : 0;
    const open = lv > 0.12 && Math.floor(t * 9) % 2 === 0;           // ~9 Hz flap while voiced
    const cx = 900, cy = 236, r = 132, intro = back(t / .6);
    g.save(); g.translate(cx, cy); g.scale(intro, intro);
    g.beginPath(); g.arc(0, 0, r + 10, 0, 7); g.fillStyle = L ? C.mint : 'rgba(255,255,255,.5)'; g.fill();
    g.beginPath(); g.arc(0, 0, r, 0, 7); g.fillStyle = '#cfd6dd'; g.fill(); g.clip();
    const im = open ? faceOpen : faceClosed;
    if (im) { const s = (2 * r) / im.width * 1.05, nod = -lv * 4; g.drawImage(im, -im.width * s / 2, -r * 1.02 + nod, im.width * s, im.height * s); }
    g.restore();
    pill(cx - 92, cy + r + 18, TL.meta.host || 'Dr. Phum', '700 30px Inter', '#1b2230', C.mint, 24, 50);
  }
  function captions(t) {
    const L = TL.lines.find(l => t >= l.start - .1 && t < l.end + .3); if (!L) return;
    g.font = '700 52px Inter'; const all = wrapWords(L.text, 940);
    const totalCh = L.text.length, spoken = clamp((t - L.start) / (L.end - L.start), 0, 1) * totalCh;
    // which row is being spoken -> show that 2-row page
    let acc = 0, cur = 0; all.forEach((r, i) => { if (spoken >= acc) cur = i; acc += r.length + 1; });
    const page = Math.floor(cur / 2), rows = all.slice(page * 2, page * 2 + 2);
    let ch = all.slice(0, page * 2).reduce((a, r) => a + r.length + 1, 0);
    const lh = 70, y0 = 1580 - (rows.length - 1) * lh / 2;
    rows.forEach((row, r) => {
      const rw = g.measureText(row).width, y = y0 + r * lh; let x = W / 2 - rw / 2;
      g.beginPath(); g.roundRect(x - 26, y - 50, rw + 52, 66, 16); g.fillStyle = 'rgba(10,14,22,.72)'; g.fill();
      row.split(' ').forEach((w, j) => {
        const piece = (j ? ' ' : '') + w; const done = ch + piece.length * .5 <= spoken;
        g.fillStyle = done ? '#fff' : 'rgba(255,255,255,.5)'; g.textAlign = 'left'; g.fillText(piece, x, y); x += g.measureText(piece).width; ch += piece.length;
      });
      ch += 1;
    });
  }
  function titleCard(t) {
    const c = TL.cues.find(c => c.type === 'title'); if (!c || t > c.t + c.dur) return;
    const a = Math.min(clamp((t - c.t) / .3, 0, 1), 1 - clamp((t - c.t - c.dur + .5) / .5, 0, 1)), k = back((t - c.t) / .6);
    g.save(); g.globalAlpha = a; g.translate(W / 2, 760); g.scale(.85 + .15 * k, .85 + .15 * k);
    g.textAlign = 'center'; g.lineJoin = 'round';
    const words = TL.meta.title.split(' '); const l1 = words.slice(0, Math.ceil(words.length / 2)).join(' '), l2 = words.slice(Math.ceil(words.length / 2)).join(' ');
    [[l1, 0, '#fff'], [l2, 130, C.yellow]].forEach(([s, y, col]) => { g.font = '800 120px Inter'; g.lineWidth = 18; g.strokeStyle = '#141a26'; g.strokeText(s, 0, y); g.fillStyle = col; g.fillText(s, 0, y); });
    if (TL.meta.subtitle) { g.font = '700 46px Inter'; const w = g.measureText(TL.meta.subtitle).width + 60; g.beginPath(); g.roundRect(-w / 2, 190, w, 76, 38); g.fillStyle = C.mint; g.fill(); g.fillStyle = '#132'; g.fillText(TL.meta.subtitle, 0, 243); }
    g.restore();
  }
  function endCard(t) {
    const c = TL.cues.find(c => c.type === 'endcard'); if (!c || t < c.t) return;
    const k = back((t - c.t) / .6);
    g.save(); g.globalAlpha = clamp((t - c.t) / .3, 0, 1); g.translate(W / 2, 1230); g.scale(.85 + .15 * k, .85 + .15 * k);
    g.beginPath(); g.roundRect(-470, -150, 940, 300, 40); g.fillStyle = C.dark; g.fill();
    g.textAlign = 'center'; g.fillStyle = C.yellow; g.font = '800 64px Inter'; g.fillText(c.value || 'Thanks for watching', 0, -30);
    if (c.sub) { g.fillStyle = '#fff'; g.font = '600 40px Inter'; g.fillText(c.sub, 0, 50); }
    g.restore();
  }

  // ---------- init / render ----------
  async function init(tl) {
    TL = tl; fps = tl.meta.fps;
    out = document.getElementById('out'); g = out.getContext('2d');
    const GS = tl.meta.gl_scale || 0.667; // 3D layer resolution (overlays stay full-res)
    gl = document.createElement('canvas'); gl.width = Math.round(W * GS); gl.height = Math.round(H * GS);
    THREE.ColorManagement.legacyMode = false; // hex colours are sRGB -> correct, non-washed-out shading
    // software WebGL in headless Chromium: MSAA and per-frame shadow passes dominate the cost, so
    // antialias is off (frames are downscaled by the video encoder anyway) and shadows are baked once
    renderer = new THREE.WebGLRenderer({ canvas: gl, antialias: !!tl.meta.msaa, preserveDrawingBuffer: true });
    renderer.setPixelRatio(1); renderer.setSize(gl.width, gl.height, false);
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    camera = new THREE.PerspectiveCamera(42, W / H, .05, 60);
    const before = new Set(scene ? scene.children : []);
    buildRoom(); buildProps();
    if ((tl.assets || {}).model) await useModel(tl.assets.model);
    const a = (tl.assets || {}).cx || {};
    const ph = await loadImg('data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="300"><rect x="30" y="80" width="40" height="200" fill="#2f9c96"/><circle cx="50" cy="45" r="30" fill="#e2b28e"/></svg>'));
    buildDoctor(a.body_front ? await loadImg(a.body_front) : ph, a.body_back ? await loadImg(a.body_back) : ph);
    if (a.face_closed) faceClosed = await loadImg(a.face_closed);
    faceOpen = a.face_open ? await loadImg(a.face_open) : faceClosed;
    renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true;
    camera.position.set(0, 2, 5); camera.lookAt(0, 1, -1); renderer.render(scene, camera); // bake static shadows
    steps = tl.cues.filter(c => c.type === 'step').sort((x, y) => x.t - y.t);
    buildStationTimeline();
    await document.fonts.ready;
    await Promise.all(['800 80px Inter', '700 40px Inter', '600 40px Inter'].map(f => document.fonts.load(f, 'Ab1')));
  }

  function render(f) {
    const t = f / fps;
    const cam = cameraAt(t); camera.position.copy(cam.pos); camera.lookAt(cam.look);
    animateProps(t); placeDoctor(t);
    renderer.render(scene, camera);
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(gl, 0, 0, W, H);
    // soft vignette + top progress bar
    const vg = g.createRadialGradient(W / 2, H / 2, H * .35, W / 2, H / 2, H * .75); vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = vg; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,.15)'; g.fillRect(0, 0, W, 10); g.fillStyle = C.yellow; g.fillRect(0, 0, W * t / TL.duration, 10);
    titleCard(t); stepBadge(t); hostCard(t); endCard(t); captions(t);
    if (TL.meta.watermark) pill(W / 2 - 300, 1830, TL.meta.watermark, '600 26px Inter', '#fff', 'rgba(10,14,22,.6)', 22, 46);
    if (t < .4) { g.fillStyle = `rgba(0,0,0,${1 - t / .4})`; g.fillRect(0, 0, W, H); }
  }

  function renderCover() {
    render(Math.round(1.6 * fps));
  }
  function profile(f) {
    const t = f / fps, T = {}; let t0 = performance.now();
    const cam = cameraAt(t); camera.position.copy(cam.pos); camera.lookAt(cam.look); animateProps(t); placeDoctor(t);
    renderer.render(scene, camera); renderer.getContext().finish(); T.gl = performance.now() - t0; t0 = performance.now();
    g.drawImage(gl, 0, 0); g.getImageData(0, 0, 1, 1); T.copy = performance.now() - t0; t0 = performance.now();
    render(f); T.full = performance.now() - t0; return T;
  }
  return { init, render, renderCover, profile };
})();
