"""Background removal for character-sheet panels (flat light-grey background, white separator lines).

Rules (character-explainer skill):
  bg = median of the corner pixels; candidate = colour distance < 24
  background = candidate components touching the panel border (faces: not the bottom edge)
             + enclosed candidate components > 120 px whose mean distance < 10
  binary opening; keep the largest component for full bodies; 0.7 px blur on alpha; crop to bbox.
Pure numpy + PIL (no scipy).
"""
from collections import deque

import numpy as np
from PIL import Image, ImageFilter


def _label(mask):
    """4-connected components of a boolean mask -> (labels, count)."""
    h, w = mask.shape
    lab = np.zeros((h, w), np.int32)
    n = 0
    ys, xs = np.nonzero(mask)
    for y0, x0 in zip(ys, xs):
        if lab[y0, x0]:
            continue
        n += 1
        lab[y0, x0] = n
        q = deque([(y0, x0)])
        while q:
            y, x = q.popleft()
            for ny, nx in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= ny < h and 0 <= nx < w and mask[ny, nx] and not lab[ny, nx]:
                    lab[ny, nx] = n
                    q.append((ny, nx))
    return lab, n


def _erode(m):
    o = m.copy()
    o[1:] &= m[:-1]; o[:-1] &= m[1:]; o[:, 1:] &= m[:, :-1]; o[:, :-1] &= m[:, 1:]
    return o


def _dilate(m):
    o = m.copy()
    o[1:] |= m[:-1]; o[:-1] |= m[1:]; o[:, 1:] |= m[:, :-1]; o[:, :-1] |= m[:, 1:]
    return o


def trim_separators(im, thresh=245):
    """Drop white separator rows/cols (mean brightness > thresh) at the panel edges."""
    a = np.asarray(im.convert("L"), np.float32)
    rows = np.where(a.mean(1) <= thresh)[0]; cols = np.where(a.mean(0) <= thresh)[0]
    if len(rows) and len(cols):
        im = im.crop((cols[0], rows[0], cols[-1] + 1, rows[-1] + 1))
    return im


def cut(im, kind="body", work=420):
    """kind: 'body' (keep largest component) or 'face' (bottom edge is not background)."""
    im = trim_separators(im.convert("RGB"))
    # work at a bounded size for speed, then upscale the mask
    scale = min(1.0, work / max(im.size))
    small = im.resize((max(1, int(im.width * scale)), max(1, int(im.height * scale))), Image.BILINEAR) if scale < 1 else im
    a = np.asarray(small, np.float32)
    h, w = a.shape[:2]
    k = max(2, min(h, w) // 40)
    corners = np.concatenate([a[:k, :k].reshape(-1, 3), a[:k, -k:].reshape(-1, 3), a[-k:, :k].reshape(-1, 3), a[-k:, -k:].reshape(-1, 3)])
    bg = np.median(corners, 0)
    dist = np.sqrt(((a - bg) ** 2).sum(-1))
    cand = dist < 24
    lab, n = _label(cand)
    border = set(np.unique(lab[0])) | set(np.unique(lab[:, 0])) | set(np.unique(lab[:, -1]))
    if kind != "face":
        border |= set(np.unique(lab[-1]))
    border.discard(0)
    bgmask = np.isin(lab, list(border))
    min_px = 120 * scale * scale
    for i in range(1, n + 1):
        if i in border:
            continue
        sel = lab == i
        if sel.sum() > min_px and dist[sel].mean() < 10:
            bgmask |= sel
    fg = ~bgmask
    fg = _dilate(_erode(fg))  # binary opening removes speckles/halo threads
    if kind == "body":
        flab, fn = _label(fg)
        if fn > 1:
            sizes = np.bincount(flab.ravel())[1:]
            fg = flab == (int(np.argmax(sizes)) + 1)
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).resize(im.size, Image.BILINEAR)
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.7 / scale if scale < 1 else 0.7))
    out = im.convert("RGBA"); out.putalpha(alpha)
    bbox = alpha.point(lambda v: 255 if v > 20 else 0).getbbox()
    return out.crop(bbox) if bbox else out


def slice_sheet(sheet, rows=2, cols=4):
    """Split a character sheet into panels using the white separator lines (fallback: equal grid)."""
    a = np.asarray(sheet.convert("L"), np.float32)
    def bands(profile, n):
        bright = profile > 245
        cuts, i = [], 0
        while i < len(bright):
            if bright[i]:
                j = i
                while j < len(bright) and bright[j]: j += 1
                cuts.append((i + j) // 2); i = j
            else:
                i += 1
        inner = [c for c in cuts if 0.05 * len(profile) < c < 0.95 * len(profile)]
        if len(inner) >= n - 1:
            # choose the n-1 cuts closest to the ideal equal split
            ideal = [len(profile) * (k + 1) / n for k in range(n - 1)]
            inner = [min(inner, key=lambda c: abs(c - x)) for x in ideal]
        else:
            inner = [int(len(profile) * (k + 1) / n) for k in range(n - 1)]
        edges = [0] + inner + [len(profile)]
        return list(zip(edges[:-1], edges[1:]))
    rb, cb = bands(a.mean(1), rows), bands(a.mean(0), cols)
    return [[sheet.crop((c0, r0, c1, r1)) for (c0, c1) in cb] for (r0, r1) in rb]


def preview_on_dark(images, path, h=360):
    tiles = []
    for im in images:
        t = im.copy(); t.thumbnail((h, h))
        bg = Image.new("RGBA", t.size, (18, 20, 30, 255)); bg.alpha_composite(t); tiles.append(bg)
    W = sum(t.width for t in tiles) + 10 * (len(tiles) + 1)
    sheet = Image.new("RGB", (W, h + 20), (40, 40, 50)); x = 10
    for t in tiles:
        sheet.paste(t.convert("RGB"), (x, 10)); x += t.width + 10
    sheet.save(path)


if __name__ == "__main__":
    import sys, time
    sheet = Image.open(sys.argv[1]); row = int(sys.argv[2]) if len(sys.argv) > 2 else 0
    t0 = time.time()
    p = slice_sheet(sheet)[row]
    outs = [cut(p[0], "face"), cut(p[1], "face"), cut(p[2], "body"), cut(p[3], "body")]
    preview_on_dark(outs, sys.argv[3] if len(sys.argv) > 3 else "cutout_preview.jpg")
    print("sizes", [o.size for o in outs], f"{time.time() - t0:.1f}s")
