// Step 2: render frames in headless Chromium and encode with ffmpeg.
//   node capture.js                 -> build/out.mp4 (full video, parallel workers)
//   node capture.js --stills 5,30,62 -> build/still-<sec>.png for quick checks
//   add --project DIR to use DIR/build instead of this folder's build/
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs'), path = require('path'), os = require('os');

const args = process.argv.slice(2);
const pi = args.indexOf('--project');
const HERE = __dirname, BUILD = path.join(pi >= 0 ? path.resolve(args[pi + 1]) : HERE, 'build');
const tl = JSON.parse(fs.readFileSync(path.join(BUILD, 'timeline.json'), 'utf8'));
const fps = tl.meta.fps;

async function openPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
  await page.goto('file://' + path.join(HERE, 'renderer.html'));
  await page.evaluate(t => BR.init(t), tl);
  return page;
}
const grab = (page, f, type = 'jpeg') => page.evaluate(([f, type]) => {
  BR.render(f);
  return document.getElementById('out').toDataURL(type === 'png' ? 'image/png' : 'image/jpeg', 0.93).split(',')[1];
}, [f, type]);

async function stills(list) {
  const browser = await chromium.launch();
  const page = await openPage(browser);
  for (const s of list) {
    const f = Math.min(tl.frames - 1, Math.round(s * fps));
    fs.writeFileSync(path.join(BUILD, `still-${s}.png`), Buffer.from(await grab(page, f, 'png'), 'base64'));
    console.log('still', s);
  }
  await browser.close();
}

async function renderChunk(browser, idx, f0, f1) {
  const page = await openPage(browser);
  const file = path.join(BUILD, `chunk-${idx}.mp4`);
  const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-c:v', 'mjpeg', '-framerate', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-pix_fmt', 'yuv420p', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  for (let f = f0; f < f1; f++) {
    const ok = ff.stdin.write(Buffer.from(await grab(page, f), 'base64'));
    if (!ok) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - f0) % 60 === 0) console.log(`progress worker=${idx} ${f - f0}/${f1 - f0}`);
  }
  ff.stdin.end();
  await new Promise(r => ff.on('close', r));
  await page.close();
  return file;
}

async function full() {
  const N = Math.max(1, Math.min(4, os.cpus().length));
  const browser = await chromium.launch();
  const per = Math.ceil(tl.frames / N);
  const t0 = Date.now();
  const files = await Promise.all([...Array(N)].map((_, i) => renderChunk(browser, i, i * per, Math.min(tl.frames, (i + 1) * per))));
  await browser.close();
  fs.writeFileSync(path.join(BUILD, 'chunks.txt'), files.map(f => `file '${f}'`).join('\n'));
  const outFile = path.join(BUILD, 'out.mp4');
  await new Promise((res, rej) => spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(BUILD, 'chunks.txt'),
    '-i', path.join(BUILD, 'audio.wav'), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', outFile],
    { stdio: 'inherit' }).on('close', c => c ? rej(c) : res()));
  files.forEach(f => fs.unlinkSync(f));
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(0)}s -> ${outFile}`);
}

(async () => {
  const i = args.indexOf('--stills');
  if (i >= 0) await stills(args[i + 1].split(',').map(Number));
  else await full();
})().catch(e => { console.error(e); process.exit(1); });
