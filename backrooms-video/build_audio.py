"""Step 1: TTS every line, build timeline.json, mix audio.wav.

Usage: python3 build_audio.py  (reads script.json, writes build/)
"""
import asyncio, hashlib, json, os, subprocess, sys, time
import numpy as np

# edge-tts pins certifi; point it at the system/proxy CA bundle when one is set
CA = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)
if CA:
    import certifi
    certifi.where = lambda: CA
import edge_tts

HERE = os.path.dirname(os.path.abspath(__file__))
BUILD = os.path.join(HERE, "build")
SR = 48000
os.makedirs(os.path.join(BUILD, "tts"), exist_ok=True)


def tts(text, v, voice=None):
    voice = voice or v["voice"]
    key = hashlib.sha1(f"{voice}|{v['rate']}|{v['pitch']}|{text}".encode()).hexdigest()[:16]
    path = os.path.join(BUILD, "tts", key + ".mp3")
    if not os.path.exists(path) or os.path.getsize(path) == 0:
        async def go():
            await edge_tts.Communicate(text, voice, rate=v["rate"], pitch=v["pitch"]).save(path)
        for attempt in range(4):
            try:
                asyncio.run(go()); break
            except edge_tts.exceptions.NoAudioReceived:
                if attempt == 3: raise
                time.sleep(2 * (attempt + 1))
    return path


def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                         check=True, capture_output=True).stdout
    a = np.frombuffer(raw, np.float32).copy()
    # trim edge-tts leading/trailing silence
    idx = np.where(np.abs(a) > 0.01)[0]
    if len(idx):
        a = a[max(0, idx[0] - int(0.03 * SR)): idx[-1] + int(0.08 * SR)]
    return a


def main():
    s = json.load(open(os.path.join(HERE, "script.json"), encoding="utf-8"))
    meta, voices, lines = s["meta"], s["voices"], s["lines"]
    fps = meta["fps"]

    # 0) pick one working voice per character (primary, else fallback) so a character never switches voice mid-episode
    for key, v in voices.items():
        mine = [ln["text"] for ln in lines if ln["who"] == key]
        for cand in [v["voice"]] + v.get("fallback", []):
            try:
                for text in mine: tts(text, v, cand)
                v["voice"] = cand; break
            except edge_tts.exceptions.NoAudioReceived:
                print(f"  ! voice {cand} unavailable for {v['name']}, trying fallback")
        else:
            raise SystemExit(f"no working voice for {v['name']}")
        print(f"  voice {v['name']}: {v['voice']}")

    # 1) voices + line timing
    t = meta["lead_in"]
    out_lines, clips = [], []
    for i, ln in enumerate(lines):
        v = voices[ln["who"]]
        audio = decode(tts(ln["text"], v))
        t += ln.get("gap_before", 0.35 if i else 0.0)
        start, dur = t, len(audio) / SR
        # mouth envelope at fps
        hop = SR // fps
        env = [float(np.sqrt(np.mean(audio[j:j + hop] ** 2))) for j in range(0, len(audio), hop)]
        peak = max(env) or 1
        out_lines.append({"i": i, "who": ln["who"], "text": ln["text"], "start": round(start, 3),
                          "end": round(start + dur, 3), "mouth": [round(e / peak, 2) for e in env]})
        clips.append((start, audio))
        t = start + dur
        print(f"  L{i:02d} {start:6.2f}-{t:6.2f} {v['name']}: {ln['text'][:40]}")
    total = t + meta["tail"]

    # 2) resolve cues to absolute seconds
    cues = []
    for ln, ol in zip(lines, out_lines):
        for c in ln.get("cues", []):
            base = ol["start"] if c.get("at", "start") == "start" else ol["end"]
            cc = dict(c); cc["t"] = round(max(0.0, base + c.get("offset", 0.0)), 3)
            cc.pop("at", None); cc.pop("offset", None)
            cues.append(cc)
    cues.sort(key=lambda c: c["t"])

    # 3) per-frame state: scene, lights, walk speed, path progress
    nF = int(np.ceil(total * fps))
    scene, lights, speed, prog = [], [], [], []
    cur_scene, L, Lfrom, Lto, Lt0, Ldur = "level0", 1.0, 1.0, 1.0, 0.0, 0.0
    target, v, p = 0.0, 0.0, 0.0
    ci = 0
    for f in range(nF):
        tt = f / fps
        while ci < len(cues) and cues[ci]["t"] <= tt:
            c = cues[ci]; ci += 1
            if c["type"] == "scene":
                cur_scene, p, v, L, Lfrom, Lto, Ldur = c["value"], 0.0, 0.0, 1.0, 1.0, 1.0, 0.0
            elif c["type"] == "lights":
                Lfrom, Lto, Lt0, Ldur = L, c["value"], tt, c.get("dur", 1.0)
            elif c["type"] == "walk":
                target = c["value"]
        if Ldur > 0:
            k = min(1.0, (tt - Lt0) / Ldur)
            # lights die in steps, like tubes switching off one by one
            L = Lfrom + (Lto - Lfrom) * (np.floor(k * 4) / 4 if k < 1 else 1.0)
        v += (target - v) * (1 - np.exp(-1 / fps / 0.35))
        p = max(0.0, p + v / fps)
        scene.append(cur_scene); lights.append(round(float(L), 3))
        speed.append(round(float(v), 3)); prog.append(round(float(p), 3))

    json.dump({"meta": meta, "voices": voices, "duration": round(total, 3), "frames": nF,
               "lines": out_lines, "cues": cues,
               "state": {"scene": scene, "lights": lights, "speed": speed, "prog": prog}},
              open(os.path.join(BUILD, "timeline.json"), "w", encoding="utf-8"), ensure_ascii=False)

    # 4) mix: voice + synthesized ambience/sfx
    n = int(total * SR)
    tt = np.arange(n) / SR
    voice = np.zeros(n, np.float32)
    for start, a in clips:
        i0 = int(start * SR); voice[i0:i0 + len(a)] += a[: n - i0]

    rng = np.random.default_rng(7)
    fr = np.array(lights)[np.minimum((tt * fps).astype(int), nF - 1)]
    sc = np.array(scene)[np.minimum((tt * fps).astype(int), nF - 1)]
    lit = np.convolve(fr, np.ones(2400) / 2400, mode="same")  # smooth gate

    hum = (0.5 * np.sin(2 * np.pi * 100 * tt) + 0.25 * np.sin(2 * np.pi * 200 * tt)
           + 0.12 * np.sign(np.sin(2 * np.pi * 50 * tt))) * 0.035
    hum *= lit * (sc != "doors")
    # dark drone pad (detuned low saws, slow swell)
    drone = sum(np.sin(2 * np.pi * f0 * tt + 0.3 * np.sin(2 * np.pi * 0.07 * tt)) for f0 in (55, 55.4, 82.4, 110.3))
    drone = drone / 4 * 0.06 * (0.6 + 0.4 * np.sin(2 * np.pi * tt / 11) ** 2)
    drone *= np.where(sc == "level0", 1.0 - 0.3 * lit, 0.8)
    noise_bed = rng.standard_normal(n).astype(np.float32) * 0.004

    sfx = np.zeros(n, np.float32)

    def put(t0, sig):
        i0 = int(t0 * SR); m = min(len(sig), n - i0)
        if m > 0: sfx[i0:i0 + m] += sig[:m]

    def env(d, a=0.005, r=None):
        k = np.arange(int(d * SR)) / SR
        r = r or d * 0.8
        return np.minimum(1, k / a) * np.exp(-k / r * 3)

    for c in cues:
        if c["type"] == "lights":
            for k in range(4):  # four clunks as tubes cut out
                d = 0.25; k_t = np.arange(int(d * SR)) / SR
                put(c["t"] + c.get("dur", 1) * (k + 1) / 4 - 0.02,
                    (np.sin(2 * np.pi * 60 * k_t) * 0.5 + rng.standard_normal(len(k_t)) * 0.3) * env(d, r=0.06) * 0.35)
        elif c["type"] == "toast":
            d = 0.5; k_t = np.arange(int(d * SR)) / SR
            put(c["t"], (np.sin(2 * np.pi * 988 * k_t) + np.sin(2 * np.pi * 1319 * k_t) * (k_t > 0.09)) * env(d) * 0.12)
        elif c["type"] == "entity":
            if c.get("value"):
                d = 3.0; k_t = np.arange(int(d * SR)) / SR
                sting = sum(np.sin(2 * np.pi * f0 * k_t) for f0 in (233, 247, 262, 311)) / 4
                put(c["t"], sting * np.minimum(1, k_t / 0.6) * np.exp(-k_t / 2.5) * 0.18)
        elif c["type"] in ("glitch", "whiteout"):
            d = c.get("dur", 1.0) + 0.4; k_t = np.arange(int(d * SR)) / SR
            nz = rng.standard_normal(len(k_t))
            if c["type"] == "glitch":
                nz *= (np.sin(2 * np.pi * 13 * k_t) > 0) * 0.8 + 0.2
                nz += np.sign(np.sin(2 * np.pi * (300 + 900 * k_t) * k_t)) * 0.4
            else:
                nz = np.convolve(nz, np.ones(40) / 40, "same") * 4
            put(c["t"], nz * np.sin(np.pi * k_t / d) * 0.16)
        elif c["type"] == "shake":
            d = 0.6; k_t = np.arange(int(d * SR)) / SR
            put(c["t"], np.sin(2 * np.pi * 45 * k_t) * env(d, r=0.4) * 0.4)

    # footsteps while walking
    spd = np.abs(np.array(speed))
    step_t, acc = [], 0.0
    for f in range(nF):
        acc += spd[f] / fps * 1.8
        if acc >= 1: acc -= 1; step_t.append(f / fps)
    for st in step_t:
        d = 0.12; k_t = np.arange(int(d * SR)) / SR
        put(st, np.convolve(rng.standard_normal(len(k_t)), np.ones(25) / 25, "same") * env(d, r=0.04) * 0.25)

    # duck ambience under voice
    venv = np.convolve(np.abs(voice), np.ones(4800) / 4800, "same")
    duck = 1 - 0.45 * np.clip(venv / 0.05, 0, 1)
    mix = voice * 1.0 + (hum + drone + noise_bed) * duck + sfx
    fade = np.minimum(1, np.minimum(tt / 0.5, (total - tt) / 1.5))
    mix = mix * fade
    mix /= max(1.0, np.max(np.abs(mix)) / 0.95)
    st = np.stack([mix, mix * 0.98], 1).astype(np.float32)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "2", "-i", "-",
                    os.path.join(BUILD, "audio.wav")], input=st.tobytes(), check=True)
    print(f"timeline: {total:.1f}s, {nF} frames, {len(cues)} cues -> build/timeline.json, build/audio.wav")


if __name__ == "__main__":
    sys.exit(main())
