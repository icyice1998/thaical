"""Image and music providers (OpenAI + Google). Keys come only from the environment:

  OPENAI_API_KEY   images via OpenAI Images API (gpt-image models)
  GEMINI_API_KEY   images via Imagen and music via Lyria (Gemini API); GOOGLE_API_KEY also works

MEDIA_MOCK=1 makes every call return local placeholders, so the whole pipeline can be tested offline.
"""
import asyncio, base64, io, json, os, ssl, urllib.error, urllib.request, wave

import numpy as np

CA = os.environ.get("SSL_CERT_FILE") or ("/root/.ccr/ca-bundle.crt" if os.path.exists("/root/.ccr/ca-bundle.crt") else None)
OPENAI_IMAGE_MODEL = os.environ.get("OPENAI_IMAGE_MODEL", "gpt-image-1")
GOOGLE_IMAGE_MODEL = os.environ.get("GOOGLE_IMAGE_MODEL", "imagen-4.0-generate-001")
LYRIA_MODEL = os.environ.get("LYRIA_MODEL", "lyria-3-clip-preview")
LYRIA_REALTIME_MODEL = "models/lyria-realtime-exp"
MOCK = os.environ.get("MEDIA_MOCK") == "1"


class MediaUnavailable(Exception):
    pass


def _gemini_key():
    return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")


def available():
    return {"openai_images": bool(os.environ.get("OPENAI_API_KEY")) or MOCK,
            "google_images": bool(_gemini_key()) or MOCK,
            "lyria_music": bool(_gemini_key()) or MOCK}


# ---------------- images ----------------
# aspect: "9:16" | "1:1" | "16:9"
OPENAI_SIZES = {"9:16": "1024x1536", "1:1": "1024x1024", "16:9": "1536x1024"}


def openai_image(prompt, aspect="1:1", transparent=False, quality="medium"):
    key = os.environ.get("OPENAI_API_KEY")
    if not key:
        raise MediaUnavailable("OPENAI_API_KEY not set")
    body = {"model": OPENAI_IMAGE_MODEL, "prompt": prompt, "size": OPENAI_SIZES[aspect], "quality": quality, "n": 1}
    if transparent:
        body.update(background="transparent", output_format="png")
    req = urllib.request.Request("https://api.openai.com/v1/images/generations", data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=300, context=ssl.create_default_context(cafile=CA) if CA else None) as r:
            d = json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise MediaUnavailable(f"openai images {e.code}: {e.read().decode(errors='replace')[:300]}") from e
    item = d["data"][0]
    if "b64_json" in item:
        return base64.b64decode(item["b64_json"])
    with urllib.request.urlopen(item["url"], timeout=120) as r:
        return r.read()


def google_image(prompt, aspect="1:1", transparent=False, **_):
    key = _gemini_key()
    if not key:
        raise MediaUnavailable("GEMINI_API_KEY not set")
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=key)
    try:
        if GOOGLE_IMAGE_MODEL.startswith("imagen"):
            r = client.models.generate_images(model=GOOGLE_IMAGE_MODEL, prompt=prompt,
                                              config=types.GenerateImagesConfig(number_of_images=1, aspect_ratio=aspect))
            return r.generated_images[0].image.image_bytes
        # Gemini native image models (e.g. gemini-*-image): image comes back as inline data
        r = client.models.generate_content(model=GOOGLE_IMAGE_MODEL, contents=prompt + f" Aspect ratio {aspect}.",
                                           config=types.GenerateContentConfig(response_modalities=["IMAGE"]))
        for part in r.candidates[0].content.parts:
            if getattr(part, "inline_data", None) and part.inline_data.data:
                return part.inline_data.data
        raise MediaUnavailable("google image: no image in response")
    except MediaUnavailable:
        raise
    except Exception as e:  # noqa: BLE001
        raise MediaUnavailable(f"google image: {e}") from e


def _mock_image(prompt, aspect="1:1", transparent=False, **_):
    from PIL import Image, ImageDraw
    w, h = {"9:16": (576, 1024), "1:1": (512, 512), "16:9": (1024, 576)}[aspect]
    seed = abs(hash(prompt)) % 2 ** 32
    rng = np.random.default_rng(seed)
    base = rng.integers(40, 200, 3)
    yy, xx = np.mgrid[0:h, 0:w]
    arr = np.stack([np.clip(base[i] + 40 * np.sin(xx / (30 + 10 * i)) + 30 * np.cos(yy / 45) + rng.normal(0, 8, (h, w)), 0, 255)
                    for i in range(3)], -1).astype(np.uint8)
    im = Image.fromarray(arr).convert("RGBA")
    d = ImageDraw.Draw(im)
    if transparent or "portrait" in prompt.lower():
        bg = Image.new("RGBA", (w, h), (0, 0, 0, 0) if transparent else (30, 30, 40, 255))
        m = Image.new("L", (w, h), 0); md = ImageDraw.Draw(m)
        md.ellipse([w * .3, h * .15, w * .7, h * .6], fill=255); md.rectangle([w * .2, h * .6, w * .8, h], fill=255)
        bg.paste(im, (0, 0), m); im = bg
    d = ImageDraw.Draw(im); d.text((10, 10), "MOCK", fill=(255, 255, 255, 255))
    buf = io.BytesIO(); im.save(buf, "PNG"); return buf.getvalue()


IMAGE_PROVIDERS = {"openai": openai_image, "google": google_image}


def image(provider, prompt, aspect="1:1", transparent=False):
    if MOCK:
        return _mock_image(prompt, aspect, transparent)
    if provider not in IMAGE_PROVIDERS:
        raise MediaUnavailable(f"unknown image provider {provider!r}")
    return IMAGE_PROVIDERS[provider](prompt, aspect=aspect, transparent=transparent)


# ---------------- music (Google Lyria) ----------------
def _find_audio(obj):
    """Walk an Interactions response for the first {"type": "audio", "data": ...} block."""
    if isinstance(obj, dict):
        if obj.get("type") == "audio" and obj.get("data"):
            return obj["data"], obj.get("mime_type") or obj.get("mimeType")
        for v in obj.values():
            r = _find_audio(v)
            if r: return r
    elif isinstance(obj, list):
        for v in obj:
            r = _find_audio(v)
            if r: return r
    return None


def lyria_clip(prompt, model=LYRIA_MODEL):
    """Lyria 3 through the Gemini Interactions API. Returns (bytes, mime)."""
    from google import genai
    client = genai.Client(api_key=_gemini_key())
    r = client.interactions.create(model=model, input=prompt)
    found = _find_audio(r.model_dump(mode="json") if hasattr(r, "model_dump") else r)
    if not found:
        raise MediaUnavailable("lyria: no audio in response")
    data, mime = found
    return (base64.b64decode(data) if isinstance(data, str) else data), mime or "audio/wav"


def lyria_realtime(prompt, seconds=40, bpm=None):
    """Lyria RealTime (streaming). Returns 48 kHz stereo 16-bit PCM wrapped as WAV bytes."""
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=_gemini_key(), http_options={"api_version": "v1alpha"})
    need = int(seconds * 48000 * 2 * 2)
    pcm = bytearray()

    async def go():
        async with client.aio.live.music.connect(model=LYRIA_REALTIME_MODEL) as s:
            await s.set_weighted_prompts(prompts=[types.WeightedPrompt(text=prompt, weight=1.0)])
            cfg = {"temperature": 1.0}
            if bpm: cfg["bpm"] = int(bpm)
            await s.set_music_generation_config(config=types.LiveMusicGenerationConfig(**cfg))
            await s.play()
            async for msg in s.receive():
                sc = getattr(msg, "server_content", None)
                if sc and sc.audio_chunks:
                    for ch in sc.audio_chunks: pcm.extend(ch.data)
                if len(pcm) >= need:
                    await s.stop(); break
    asyncio.run(asyncio.wait_for(go(), timeout=seconds * 4 + 60))
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(48000); w.writeframes(bytes(pcm[:need]))
    return buf.getvalue(), "audio/wav"


def _mock_music(prompt, seconds=40, **_):
    sr = 48000; t = np.arange(int(seconds * sr)) / sr
    chord = sum(np.sin(2 * np.pi * f * t) for f in (110, 130.8, 164.8)) / 3
    pulse = 0.5 + 0.5 * np.sin(2 * np.pi * 0.5 * t)
    sig = (chord * pulse * 0.3 * 32767).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(2); w.setsampwidth(2); w.setframerate(sr); w.writeframes(np.repeat(sig, 2).tobytes())
    return buf.getvalue(), "audio/wav"


def music(prompt, seconds=40, bpm=None, model=None):
    """Returns (bytes, mime). Tries Lyria 3 clips, then Lyria RealTime."""
    if MOCK:
        return _mock_music(prompt, seconds)
    if not _gemini_key():
        raise MediaUnavailable("GEMINI_API_KEY not set")
    errors = []
    if (model or LYRIA_MODEL) != "realtime":
        try:
            return lyria_clip(prompt + (f" Tempo {bpm} BPM." if bpm else ""), model or LYRIA_MODEL)
        except Exception as e:  # noqa: BLE001
            errors.append(f"{model or LYRIA_MODEL}: {e}")
    try:
        return lyria_realtime(prompt, seconds, bpm)
    except Exception as e:  # noqa: BLE001
        errors.append(f"realtime: {e}")
    raise MediaUnavailable("; ".join(errors))
