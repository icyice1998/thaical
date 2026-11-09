"""Voice providers. Every provider writes one audio file per line and caches it by content hash.

A voice entry in script.json looks like:
  {"name": "มายด์", "provider": "cartesia", "voice": "<cartesia voice id>", "model": "sonic-3",
   "speed": 1.05, "color": "#ffd166",
   "fallback": [{"provider": "edge", "voice": "th-TH-PremwadeeNeural", "rate": "+12%"}]}
Entries without "provider" are treated as edge-tts (backwards compatible).
"""
import asyncio, hashlib, json, os, time, urllib.error, urllib.request

CARTESIA_URL = "https://api.cartesia.ai"
CARTESIA_VERSION = "2025-04-16"
CA = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)


class VoiceUnavailable(Exception):
    pass


def _key(*parts):
    return hashlib.sha1("|".join(map(str, parts)).encode()).hexdigest()[:16]


# ---------------- Cartesia ----------------
def _cartesia_headers():
    # In a sandbox whose proxy injects the key, any placeholder works; locally set CARTESIA_API_KEY.
    return {"X-API-Key": os.environ.get("CARTESIA_API_KEY", "injected-by-proxy"),
            "Cartesia-Version": CARTESIA_VERSION, "Content-Type": "application/json"}


def _ssl_ctx():
    import ssl
    return ssl.create_default_context(cafile=CA) if CA else None


def cartesia_request(path, body=None, timeout=60):
    req = urllib.request.Request(CARTESIA_URL + path, method="POST" if body is not None else "GET",
                                 headers=_cartesia_headers(),
                                 data=json.dumps(body).encode() if body is not None else None)
    with urllib.request.urlopen(req, timeout=timeout, context=_ssl_ctx()) as r:
        return r.read()


def cartesia_voices(language="th", limit=100):
    d = json.loads(cartesia_request(f"/voices?limit={limit}&language={language}"))
    return [{"id": v["id"], "name": v["name"], "gender": v.get("gender"), "language": v.get("language"),
             "description": v.get("description", "")} for v in d.get("data", []) if v.get("language") == language]


def cartesia_tts(text, v, out_dir, emotion=None, language="th"):
    gen = {"speed": v.get("speed", 1.0), "volume": v.get("volume", 1.0)}
    if emotion or v.get("emotion"):
        gen["emotion"] = emotion or v["emotion"]
    model = v.get("model", "sonic-3")
    path = os.path.join(out_dir, _key("cartesia", model, v["voice"], json.dumps(gen, sort_keys=True), text) + ".wav")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path
    body = {"model_id": model, "transcript": text, "voice": {"mode": "id", "id": v["voice"]},
            "language": v.get("language", language), "generation_config": gen,
            "output_format": {"container": "wav", "encoding": "pcm_f32le", "sample_rate": 48000}}
    for attempt in range(4):
        try:
            data = cartesia_request("/tts/bytes", body, timeout=120)
            open(path, "wb").write(data)
            return path
        except urllib.error.HTTPError as e:
            msg = e.read().decode(errors="replace")[:200]
            if e.code == 400 and "emotion" in gen:  # unknown emotion: retry plain
                gen.pop("emotion"); body["generation_config"] = gen; continue
            if e.code in (401, 403):
                raise VoiceUnavailable(f"cartesia auth failed ({e.code}): set CARTESIA_API_KEY") from e
            if e.code < 500 and e.code != 429:
                raise VoiceUnavailable(f"cartesia {e.code}: {msg}") from e
        except urllib.error.URLError:
            pass
        time.sleep(2 * (attempt + 1))
    raise VoiceUnavailable("cartesia: no audio after retries")


# ---------------- edge-tts (free fallback) ----------------
def edge_tts_synth(text, v, out_dir, **_):
    if CA:
        import certifi
        certifi.where = lambda: CA
    import edge_tts
    rate, pitch = v.get("rate", "+0%"), v.get("pitch", "+0Hz")
    path = os.path.join(out_dir, _key(v["voice"], rate, pitch, text) + ".mp3")
    if os.path.exists(path) and os.path.getsize(path) > 0:
        return path

    async def go():
        await edge_tts.Communicate(text, v["voice"], rate=rate, pitch=pitch).save(path)
    for attempt in range(4):
        try:
            asyncio.run(go()); return path
        except edge_tts.exceptions.NoAudioReceived:
            time.sleep(2 * (attempt + 1))
    if os.path.exists(path): os.remove(path)
    raise VoiceUnavailable(f"edge-tts voice {v['voice']} returned no audio")


PROVIDERS = {"cartesia": cartesia_tts, "edge": edge_tts_synth}


def synth(text, v, out_dir, emotion=None):
    return PROVIDERS[v.get("provider", "edge")](text, v, out_dir, emotion=emotion)


def candidates(v):
    """Primary voice config followed by its fallbacks (fallbacks inherit name/color)."""
    base = {k: x for k, x in v.items() if k != "fallback"}
    out = [base]
    for fb in v.get("fallback", []):
        fb = {"voice": fb} if isinstance(fb, str) else fb  # old format: bare edge voice name
        out.append({**{k: base[k] for k in ("name", "color") if k in base}, "provider": "edge", **fb})
    return out
