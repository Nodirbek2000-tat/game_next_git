"""Harakat o'yinlari - Baliq ovi: the fish species, modelled in Blender, textured with generated skins.

    blender -b --factory-startup --python tools/blender/baliq_fish.py -- --out public/models/baliq-ovi/fish [--only sazan,forel]

Per species one GLB (one mesh, one material, nose towards +x, back towards +y, the body from x = -len/2 to +len/2,
the tail fin behind it), the same frame as the procedural fish in games/baliq-ovi/fishGeometry.ts, so the game bends it
the same way while it swims.
  * body: lofted through superelliptic cross sections along a species profile (deep carp, torpedo trout / zander,
    duck-billed pike, flat-headed catfish, snakehead), gill cover ridge, mouth notch, belly sag;
  * fins: caudal (forked / rounded / truncate), dorsal (one, long, spiny + soft for zander, adipose for trout), anal,
    pectoral and pelvic pairs, barbels for carp and catfish; thin, with rays;
  * eyes: domed, with iris and pupil;
  * one 1024 x 512 atlas (numpy): skin with countershading, scales (size per species), lateral line, gill cover,
    markings (trout's band and spots, zander's bars, pike's bean spots, snakehead blotches, catfish marbling); the fins
    with rays and ragged translucent edges; the eye. Plus a normal map of the scales and rays.
"""

import argparse
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Vector

# ---------------------------------------------------------------- species (mirrors games/baliq-ovi/species.ts)

C = lambda h: tuple(int(h[i:i + 2], 16) / 255 for i in (1, 3, 5))  # noqa: E731

SPECIES = {
    # id: len, height, form, colours (back, flank, belly, fin), scale size (fraction of the length), extras
    "zogora": dict(L=0.42, H=0.139, form="carp", back="#5a4a1c", flank="#b8902a", belly="#f4e2a6", fin="#a0522d", scale=1 / 28, barbels=2),
    "sazan": dict(L=0.5, H=0.16, form="carp", back="#3f3a1c", flank="#8d7a36", belly="#e8d9a0", fin="#7a4a20", scale=1 / 26, barbels=4, dorsal="long", thick=1.1),
    "amur": dict(L=0.62, H=0.136, form="torpedo", back="#3c4a40", flank="#7f8f80", belly="#e6ece8", fin="#5f6f68", scale=1 / 30, net=True),
    "dongpeshona": dict(L=0.6, H=0.18, form="carp", back="#4a5458", flank="#9aa4a8", belly="#eef2f2", fin="#78858c", scale=1 / 60, head=1.25, blotch="#3a4448", lowEye=True),
    "chortan": dict(L=0.72, H=0.115, form="pike", back="#2e4218", flank="#5f7a30", belly="#eef2d0", fin="#8a5a2a", scale=1 / 80, beans="#d8e6a0", dorsal="rear", finSpots="#3a2a14"),
    "laqqa": dict(L=0.86, H=0.146, form="catfish", back="#1f1f1a", flank="#4a463a", belly="#b8b09c", fin="#2a2822", scale=0, barbels=6, marble=True, dorsal="tiny", anal="long"),
    "forel": dict(L=0.46, H=0.115, form="torpedo", back="#4a6074", flank="#9fb2bf", belly="#f3ecec", fin="#6a7a8a", scale=1 / 90, band="#e05a80", spots="#1e1e1e", adipose=True, finSpots="#2a2a2a"),
    "sudak": dict(L=0.64, H=0.128, form="torpedo", back="#4a4c34", flank="#9a9c78", belly="#ecead2", fin="#6a6f4a", scale=1 / 70, bars="#3a3c28", dorsal="spiny", finSpots="#2a2c1a"),
    "ilonbosh": dict(L=0.7, H=0.105, form="snake", back="#2f301c", flank="#6a6b3a", belly="#d8d2a8", fin="#4a4a28", scale=1 / 45, blotch="#22230f", dorsal="snake", anal="long", caudal="round"),
    "karas": dict(L=0.3, H=0.135, form="carp", back="#4a3a14", flank="#a8904c", belly="#ece0a8", fin="#8a6a30", scale=1 / 24, thick=1.05),
    "oltin": dict(L=0.22, H=0.088, form="carp", back="#d06a00", flank="#ff9a10", belly="#ffe6a0", fin="#ff7a10", scale=1 / 22, tail=1.6, thick=1.1),
}

# profiles: (u, half height factor, half width factor, centre offset factor); u = 0 tail stalk end .. 1 snout
FORMS = {
    "carp": [(0, .3, .12, 0), (.1, .38, .16, 0), (.25, .66, .28, -.02), (.42, .9, .36, -.03), (.56, 1, .4, -.03), (.7, .95, .4, -.02), (.82, .8, .37, 0), (.9, .6, .3, .02), (.96, .36, .2, .03), (1, .1, .07, .03)],
    "torpedo": [(0, .26, .12, 0), (.1, .34, .16, 0), (.25, .6, .3, -.02), (.42, .86, .42, -.03), (.56, 1, .46, -.03), (.7, .96, .45, -.02), (.82, .8, .41, 0), (.9, .6, .34, .02), (.96, .36, .22, .03), (1, .1, .07, .03)],
    "pike": [(0, .32, .14, 0), (.12, .46, .22, 0), (.3, .82, .42, -.02), (.5, .97, .5, -.02), (.62, 1, .52, -.02), (.74, .92, .5, 0), (.82, .7, .46, .04), (.9, .42, .4, .08), (.96, .26, .34, .1), (1, .12, .2, .1)],
    "catfish": [(0, .24, .08, 0), (.12, .44, .14, 0), (.3, .72, .32, 0), (.5, .92, .55, -.02), (.65, 1, .75, -.03), (.78, .92, .95, -.03), (.88, .7, 1.05, 0), (.95, .45, .95, .02), (1, .1, .5, .02)],
    "snake": [(0, .3, .14, 0), (.12, .55, .3, 0), (.3, .85, .5, 0), (.5, .97, .58, 0), (.65, 1, .62, 0), (.8, .95, .66, 0), (.9, .72, .62, .02), (.96, .45, .48, .03), (1, .1, .2, .03)],
}

ATLAS_W, ATLAS_H = 1024, 512
BODY_V = 0.74  # body texture: v 0 .. BODY_V; fins: v 0.76 .. 1, u 0 .. 0.6; eye: u 0.62 .. 0.74


def curve(form, u, k):
    pts = FORMS[form]
    for (u0, *a), (u1, *b) in zip(pts, pts[1:]):
        if u <= u1:
            t = (u - u0) / (u1 - u0)
            t = t * t * (3 - 2 * t)
            return a[k] + (b[k] - a[k]) * t
    return pts[-1][k + 1]


# ---------------------------------------------------------------- textures

def noise2(shape, cells, rng):
    """smooth value noise 0..1 on a grid of `cells` (smoothstep-interpolated)."""
    g = rng.random((cells[1] + 1, cells[0] + 1)).astype(np.float32)
    y = np.linspace(0, cells[1], shape[0], endpoint=False)
    x = np.linspace(0, cells[0], shape[1], endpoint=False)
    yi, xi = np.floor(y).astype(int), np.floor(x).astype(int)
    fy, fx = y - yi, x - xi
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    a = g[yi][:, xi]
    b = g[yi][:, xi + 1]
    c = g[yi + 1][:, xi]
    d = g[yi + 1][:, xi + 1]
    top = a + (b - a) * fx[None]
    bot = c + (d - c) * fx[None]
    return top + (bot - top) * fy[:, None]


def skin(sp, rng):
    """RGBA atlas + height map (rows from the top of the image = v from 1 down to 0)."""
    H, W = ATLAS_H, ATLAS_W
    col = np.zeros((H, W, 4), np.float32)
    hgt = np.zeros((H, W), np.float32)
    bh = int(H * BODY_V)  # body rows (bottom of the image in uv terms)
    # body region: image rows H - bh .. H  <->  v 0 .. BODY_V ; v_around = v / BODY_V (0 top of the back .. 0.5 belly .. 1)
    ys, xs = np.mgrid[0:bh, 0:W].astype(np.float32)
    u = (xs + 0.5) / W
    va = 1 - (ys + 0.5) / bh  # row 0 of this block = top of the block = v_around 1
    th = va * 2 * math.pi  # around angle, 0 = top
    down = (1 - np.cos(th)) / 2  # 0 back .. 1 belly
    back, flank, belly = (np.array(C(sp[k])) for k in ("back", "flank", "belly"))
    c = back[None, None] * (1 - np.clip(down / 0.32, 0, 1))[..., None] + flank[None, None] * np.clip(down / 0.32, 0, 1)[..., None]
    t2 = np.clip((down - 0.55) / 0.3, 0, 1)[..., None]
    c = c * (1 - t2) + belly[None, None] * t2
    # low-frequency variation
    nz = noise2((bh, W), (24, 8), rng)
    c *= (0.88 + 0.24 * nz)[..., None]
    L = sp["L"]
    head = u > 0.78
    # scales: staggered cells, darker posterior rim, lighter centre, a little sheen
    if sp["scale"] > 0:
        s = sp["scale"]
        circ = 2.0 * sp["H"] * 1.4  # rough body circumference / length units
        cu = u / s
        cv = va * circ / L / s
        row = np.floor(cv)
        cu2 = cu + 0.5 * (row % 2)
        fu = cu2 - np.floor(cu2)
        fv = cv - row
        # distance to the scale's rounded front edge (scales overlap towards the tail: rim on the tail side, fu small)
        d = np.sqrt(((fu - 0.75) * 1.0) ** 2 + ((fv - 0.5) * 0.9) ** 2)
        rim = np.clip(1 - np.abs(d - 0.48) / 0.12, 0, 1)
        dome = np.clip(1 - d / 0.55, 0, 1)
        k = np.clip((0.8 - u) / 0.05, 0, 1) * np.clip((u - 0.04) / 0.08, 0, 1)
        strength = 0.55 if sp.get("net") else 0.32
        c *= (1 - strength * rim * k)[..., None]
        c += (0.07 * dome * k * (1 - down * 0.5))[..., None]
        hgt[H - bh:] += (dome * 0.8 - rim * 0.5) * k
    # lateral line (slightly above the middle of the flank) on both sides
    for side in (0.25, 0.75):
        ll = side + (0.03 if side < 0.5 else -0.03) + 0.01 * np.sin(u * 9)
        m = np.exp(-((va - ll) / 0.007) ** 2) * (u > 0.08) * (u < 0.8)
        c = c * (1 - 0.25 * m[..., None]) + 0.25 * m[..., None] * (back[None, None] * 0.6 + 0.4)
    # markings
    if sp.get("band"):
        b = np.array(C(sp["band"]))
        for side in (0.25, 0.75):
            m = np.exp(-((va - side) / 0.05) ** 2) * np.clip((u - 0.06) / 0.1, 0, 1)
            c = c * (1 - 0.6 * m[..., None]) + 0.6 * m[..., None] * b
    if sp.get("spots"):
        sc = np.array(C(sp["spots"]))
        for _ in range(int(380 * L)):
            x = rng.uniform(0.04, 0.97)
            v = rng.uniform(0, 1)
            if 0.38 < v < 0.62 and rng.random() < 0.85:
                continue
            r = rng.uniform(0.004, 0.009) * 0.5 / L
            m = np.exp(-(((u - x) / r) ** 2 + ((va - v) / (r * 2.2)) ** 2))
            c = c * (1 - 0.8 * m[..., None]) + 0.8 * m[..., None] * sc
    if sp.get("bars"):
        bc = np.array(C(sp["bars"]))
        for k in range(9):
            x = 0.12 + k * 0.075 + rng.uniform(-0.01, 0.01)
            m = np.exp(-((u - x) / 0.014) ** 2) * np.clip(1 - down / 0.62, 0, 1) * (u < 0.78)
            c = c * (1 - 0.55 * m[..., None]) + 0.55 * m[..., None] * bc
    if sp.get("beans"):
        bc = np.array(C(sp["beans"]))
        for _ in range(int(260 * L)):
            x = rng.uniform(0.06, 0.8)
            v = rng.uniform(0.08, 0.92)
            if 0.4 < v < 0.6:
                continue
            m = np.exp(-(((u - x) / 0.012) ** 2 + ((va - v) / 0.016) ** 2))
            c = c * (1 - 0.7 * m[..., None]) + 0.7 * m[..., None] * bc
    if sp.get("blotch"):
        bc = np.array(C(sp["blotch"]))
        for _ in range(int(50 * L)):
            x = rng.uniform(0.06, 0.82)
            v = rng.choice([rng.uniform(0.12, 0.34), rng.uniform(0.66, 0.88)])
            r = rng.uniform(0.02, 0.04)
            m = np.exp(-(((u - x) / r) ** 2 + ((va - v) / (r * 1.4)) ** 2)) ** 0.6
            c = c * (1 - 0.65 * m[..., None]) + 0.65 * m[..., None] * bc
    if sp.get("marble"):
        n1 = noise2((bh, W), (60, 14), rng)
        n2 = noise2((bh, W), (140, 30), rng)
        m = np.clip((n1 * 0.6 + n2 * 0.4 - 0.45) * 4, 0, 1) * np.clip(1 - down / 0.7, 0, 1)
        c = c * (1 - 0.45 * m[..., None])
    # head: gill cover edge, darker crown, the mouth line at the snout
    gill = np.exp(-((u - (0.8 + 0.03 * np.sin(th) ** 2)) / 0.005) ** 2) * np.clip((0.85 - np.abs(np.cos(th))) / 0.2, 0, 1)
    c *= (1 - 0.35 * gill)[..., None]
    hgt[H - bh:] += gill * 1.2
    mouth = np.exp(-((va - 0.5) ** 2 / 0.0004)) * 0 + np.exp(-((u - 0.985) / 0.01) ** 2) * (np.abs(np.cos(th) + 0.25) < 0.35)
    c *= (1 - 0.5 * np.clip(mouth, 0, 1))[..., None]
    col[H - bh:, :, :3] = np.clip(c, 0, 1)
    col[H - bh:, :, 3] = 1
    # ---- fin block: rows 0 .. (1 - 0.76) * H, u 0 .. 0.6 ; fin uv: x = across the fin, y = base (0) -> edge (1)
    fh = int(H * 0.24)
    fw = int(W * 0.6)
    ys, xs = np.mgrid[0:fh, 0:fw].astype(np.float32)
    fx = (xs + 0.5) / fw
    fy = 1 - (ys + 0.5) / fh  # 0 at the base (bottom of the block), 1 at the edge
    fin = np.array(C(sp["fin"]))
    rays = 0.5 + 0.5 * np.cos(fx * math.pi * 2 * 26 * 6 + np.sin(fy * 5) * 0.4)
    rays = rays ** 4
    edge = noise2((fh, fw), (90, 4), rng)
    alpha = np.clip((1 - fy - 0.06 + 0.12 * (edge - 0.5)) / 0.08, 0, 1)
    memb = 0.62 + 0.25 * (1 - fy)
    fc = np.clip(fin * 1.35 + 0.04, 0, 1)[None, None] * (0.8 + 0.35 * (1 - fy))[..., None]
    fc = fc * (1 - 0.35 * rays[..., None])
    if sp.get("finSpots"):
        sc = np.array(C(sp["finSpots"]))
        for _ in range(140):
            x, y = rng.uniform(0, 1), rng.uniform(0.1, 0.9)
            m = np.exp(-(((fx - x) / 0.006) ** 2 + ((fy - y) / 0.05) ** 2))
            fc = fc * (1 - 0.7 * m[..., None]) + 0.7 * m[..., None] * sc
    col[0:fh, 0:fw, :3] = np.clip(fc, 0, 1)
    col[0:fh, 0:fw, 3] = alpha * np.clip(memb + rays * 0.3, 0, 1)
    hgt[0:fh, 0:fw] += rays * 0.8
    # ---- eye block: u 0.62 .. 0.74, same rows as the fins
    ex0 = int(W * 0.62)
    ew = int(W * 0.12)
    ys, xs = np.mgrid[0:fh, 0:ew].astype(np.float32)
    ex = (xs + 0.5) / ew * 2 - 1
    ey = (ys + 0.5) / fh * 2 - 1
    r = np.sqrt(ex ** 2 + ey ** 2)
    iris = np.array([0.78, 0.62, 0.25]) if sp["form"] in ("carp", "torpedo") else np.array([0.75, 0.7, 0.45])
    if sp["form"] == "catfish":
        iris = np.array([0.35, 0.3, 0.2])
    ec = np.where((r < 0.42)[..., None], np.array([0.02, 0.02, 0.025]), iris * (0.7 + 0.3 * np.cos(np.arctan2(ey, ex) * 20))[..., None])
    ec = np.where((r > 0.9)[..., None], np.array(C(sp["back"])) * 0.7, ec)
    col[0:fh, ex0:ex0 + ew, :3] = np.clip(ec, 0, 1)
    col[0:fh, ex0:ex0 + ew, 3] = 1
    return col, hgt


def save_png(path, arr):
    """arr: rows from the top, RGB or RGBA 0..1 (saved through Blender: its rows start at the bottom)."""
    h, w = arr.shape[:2]
    if arr.shape[2] == 3:
        arr = np.dstack((arr, np.ones((h, w), np.float32)))
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(np.clip(arr[::-1], 0, 1).astype(np.float32)).ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    bpy.data.images.remove(img)


def normal_from_height(h, strength=2.5):
    gy, gx = np.gradient(h)
    n = np.dstack((-gx * strength, gy * strength, np.ones_like(h)))
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


# ---------------------------------------------------------------- mesh

def build_fish(name, sp, tex_dir):
    rng = random.Random(hash(name) & 0xFFFF)
    nrng = np.random.default_rng(abs(hash(name)) % (2 ** 31))
    L, Hh = sp["L"], sp["H"] / 2
    thick = sp.get("thick", 1.0)
    headK = sp.get("head", 1.0)
    form = sp["form"]
    bm = bmesh.new()
    uvl = bm.loops.layers.uv.new("UVMap")
    N, M = 56, 30
    rings = []
    for i in range(N + 1):
        u = i / N
        x = (u - 0.5) * L
        a = Hh * curve(form, u, 0)
        b = Hh * curve(form, u, 1) * thick * (headK if u > 0.72 else 1)
        cy = Hh * curve(form, u, 2)
        # gill cover ridge
        ridge = 1.0
        row = []
        for j in range(M + 1):
            th = j / M * 2 * math.pi
            ct, st = math.cos(th), math.sin(th)
            # gill cover: a raised edge on the sides only
            ridge = 1 + 0.025 * math.exp(-((u - 0.8 - 0.02 * ct * ct) / 0.008) ** 2) * st * st
            # superellipse (flatter belly for the catfish / pike heads)
            e = 2.3 if form in ("carp", "torpedo") else 2.6
            ry = a * ridge * math.copysign(abs(ct) ** (2 / e), ct)
            rz = b * ridge * math.copysign(abs(st) ** (2 / e), st)
            if ct < 0:
                ry *= 1.0 if form != "catfish" else 0.8
            # mouth notch at the snout (a dark lip line): pull the sides in a little
            if u > 0.95 and abs(ct + 0.25) < 0.3:
                ry *= 0.9
                rz *= 0.85
            row.append(bm.verts.new((x, cy + ry, rz)))
        rings.append(row)
    for i in range(N):
        for j in range(M):
            f = bm.faces.new((rings[i][j], rings[i + 1][j], rings[i + 1][j + 1], rings[i][j + 1]))
            for loop, (uu, vv) in zip(f.loops, ((i / N, j / M), ((i + 1) / N, j / M), ((i + 1) / N, (j + 1) / M), (i / N, (j + 1) / M))):
                loop[uvl].uv = (uu, (1 - vv) * BODY_V)
    # snout cap / stalk cap
    for i, rev in ((0, True), (N, False)):
        ring = rings[i][:-1]
        c = bm.verts.new(Vector(sum((v.co for v in ring), Vector())) / len(ring))
        for j in range(len(ring)):
            a, b = ring[j], ring[(j + 1) % len(ring)]
            f = bm.faces.new((c, b, a) if rev else (c, a, b))
            for loop in f.loops:
                loop[uvl].uv = (i / N, BODY_V * 0.5)

    def at(u, side=0.0, up=1.0):
        """surface point of the body at u: up = +1 back, -1 belly; side = +-1"""
        i = min(N, max(0, round(u * N)))
        a = Hh * curve(form, u, 0)
        cy = Hh * curve(form, u, 2)
        b = Hh * curve(form, u, 1) * thick
        return Vector(((u - 0.5) * L, cy + a * up * (1 - abs(side) * 0.6), b * side))

    def fin(base0, base1, tip_fn, n=8, rows=4, k=0):
        """fin sheet: base edge base0 -> base1, edge points tip_fn(t). UV in the fin block, column k of 6."""
        grid = []
        for r in range(rows + 1):
            s = r / rows
            line = []
            for q in range(n + 1):
                t = q / n
                b = base0.lerp(base1, t)
                p = b.lerp(tip_fn(t), s)
                line.append(bm.verts.new(p))
            grid.append(line)
        u0 = k / 6 * 0.6
        for r in range(rows):
            for q in range(n):
                f = bm.faces.new((grid[r][q], grid[r][q + 1], grid[r + 1][q + 1], grid[r + 1][q]))
                for loop, (a, b) in zip(f.loops, ((q, r), (q + 1, r), (q + 1, r + 1), (q, r + 1))):
                    loop[uvl].uv = (u0 + a / n * 0.1 - 0.0, 0.76 + b / rows * 0.235)

    H = sp["H"]
    tailK = sp.get("tail", 1.0)
    # ---- caudal fin
    x0 = -L / 2
    stalk = Hh * curve(form, 0, 0)
    tl = L * 0.24 * tailK
    ts = H * 0.6 * tailK
    caud = sp.get("caudal", "fork" if form in ("carp", "torpedo") else "trunc")
    if form == "catfish":
        caud = "round"

    def tail_tip(t):
        y = (t - 0.5) * 2  # -1 .. 1
        if caud == "fork":
            depth = tl * (0.55 + 0.45 * abs(y) ** 0.8)
        elif caud == "round":
            depth = tl * 0.85 * math.sqrt(max(0.0, 1 - y * y * 0.8))
        else:
            depth = tl * (0.85 + 0.1 * abs(y))
        return Vector((x0 - depth, y * ts * (0.9 if caud != "round" else 0.6), 0))
    fin(Vector((x0 + 0.01 * L, -stalk * 0.9, 0)), Vector((x0 + 0.01 * L, stalk * 0.9, 0)), tail_tip, n=10, rows=5, k=0)
    # ---- dorsal
    d = sp.get("dorsal", "normal")
    if d == "long":
        spans = [(0.38, 0.75, 0.35)]
    elif d == "rear":
        spans = [(0.16, 0.3, 0.55)]
    elif d == "tiny":
        spans = [(0.62, 0.68, 0.35)]
    elif d == "spiny":
        spans = [(0.5, 0.68, 0.6), (0.24, 0.46, 0.45)]
    elif d == "snake":
        spans = [(0.12, 0.8, 0.22)]
    else:
        spans = [(0.45, 0.62, 0.62)]
    for (ua, ub, hk) in spans:
        pa, pb = at(ua), at(ub)
        hf = H * hk
        fin(pa - Vector((0, 0.003, 0)), pb - Vector((0, 0.003, 0)),
            lambda t, pa=pa, pb=pb, hf=hf: pa.lerp(pb, t) + Vector((-0.25 * hf * t, hf * ((0.35 + 0.65 * (1 - t) ** (0.6 if d != "spiny" else 0.3)) if d != "snake" else (0.4 + 0.6 * math.sin(math.pi * min(1, t * 1.1)) ** 0.5)), 0)), k=1)
    if sp.get("adipose"):
        pa, pb = at(0.16), at(0.22)
        fin(pa, pb, lambda t, pa=pa, pb=pb: pa.lerp(pb, t) + Vector((-0.01, H * 0.12 * math.sin(math.pi * t), 0)), n=4, rows=2, k=1)
    # ---- anal
    a_span = (0.1, 0.55) if sp.get("anal") == "long" else ((0.16, 0.3) if form == "pike" else (0.2, 0.3))
    pa, pb = at(a_span[0], up=-1), at(a_span[1], up=-1)
    fin(pa + Vector((0, 0.003, 0)), pb + Vector((0, 0.003, 0)),
        lambda t, pa=pa, pb=pb: pa.lerp(pb, t) + Vector((-0.02 * L * t, -H * (0.32 if sp.get("anal") != "long" else 0.2) * (0.4 + 0.6 * (1 - t)), 0)), k=2)
    # ---- pectoral / pelvic pairs
    for side in (1, -1):
        base = at(0.74, side=side * 0.85, up=-0.45)
        base2 = base + Vector((-0.04 * L, -0.01 * L, 0))
        fin(base, base2, lambda t, b=base, s=side: b + Vector((-L * (0.14 + 0.03 * t), -H * (0.12 + 0.18 * t), s * H * 0.28)), n=5, rows=3, k=3)
        base = at(0.48 if form != "pike" else 0.36, side=side * 0.4, up=-0.92)
        base2 = base + Vector((-0.035 * L, 0, 0))
        fin(base, base2, lambda t, b=base, s=side: b + Vector((-L * (0.1 + 0.02 * t), -H * (0.2 + 0.08 * t), s * H * 0.12)), n=4, rows=3, k=4)
    # ---- barbels
    nb = sp.get("barbels", 0)
    for kk in range(nb):
        side = 1 if kk % 2 == 0 else -1
        pair = kk // 2
        length = (L * 0.28 if form == "catfish" and pair == 0 else L * (0.05 if form == "carp" else 0.09))
        root = at(0.975 - 0.02 * pair, side=side * 0.7, up=-0.1 - 0.4 * pair)
        tip = root + Vector((-length * 0.6, -length * 0.5, side * length * 0.6))
        mid = (root + tip) / 2 + Vector((0, -length * 0.1, 0))
        prev = None
        segs = 6
        w = 0.0035 if form == "catfish" else 0.002
        for q in range(segs + 1):
            t = q / segs
            p = (1 - t) ** 2 * root + 2 * (1 - t) * t * mid + t * t * tip
            a = bm.verts.new(p + Vector((0, w * (1 - t * 0.7), 0)))
            b = bm.verts.new(p - Vector((0, w * (1 - t * 0.7), 0)))
            if prev:
                f = bm.faces.new((prev[0], prev[1], b, a))
                for loop in f.loops:
                    loop[uvl].uv = (0.55, 0.8)
            prev = (a, b)
    # ---- eyes
    eye_u = 0.9 if form != "catfish" else 0.92
    er = H * (0.075 if form != "catfish" else 0.04) * (1.2 if L < 0.35 else 1)
    for side in (1, -1):
        c = at(eye_u, side=side * 0.82, up=(0.35 if not sp.get("lowEye") else -0.1))
        c.z = side * (abs(c.z) * 0.92)
        s = bmesh.ops.create_uvsphere(bm, u_segments=14, v_segments=8, radius=er)
        vs = s["verts"]
        for v in vs:
            v.co.z *= 0.45
            v.co += c
        for f in {f for v in vs for f in v.link_faces}:
            for loop in f.loops:
                p = loop.vert.co - c
                loop[uvl].uv = (0.62 + 0.12 * (0.5 + 0.5 * p.x / er), 0.76 + 0.235 * (0.5 + 0.5 * p.y / er))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(o)
    # textures
    colr, hgt = skin(sp, nrng)
    cp = os.path.join(tex_dir, f"{name}_col.png")
    npth = os.path.join(tex_dir, f"{name}_nor.png")
    save_png(cp, colr)
    nm = normal_from_height(hgt)
    save_png(npth, nm[::2, ::2])
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    ti = nt.nodes.new("ShaderNodeTexImage")
    ti.image = bpy.data.images.load(cp)
    nt.links.new(ti.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(ti.outputs["Alpha"], bsdf.inputs["Alpha"])
    tn = nt.nodes.new("ShaderNodeTexImage")
    tn.image = bpy.data.images.load(npth)
    tn.image.colorspace_settings.name = "Non-Color"
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.32
    bsdf.inputs["Metallic"].default_value = 0.15
    m.blend_method = "CLIP" if hasattr(m, "blend_method") else None
    me.materials.append(m)
    return o


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models/baliq-ovi/fish")
    ap.add_argument("--tex", default="tools/blender/out/fish")
    ap.add_argument("--only", default="")
    a = ap.parse_args(argv)
    out = os.path.abspath(a.out)
    tex = os.path.abspath(a.tex)
    os.makedirs(out, exist_ok=True)
    os.makedirs(tex, exist_ok=True)
    for name, sp in SPECIES.items():
        if a.only and name not in a.only.split(","):
            continue
        bpy.ops.wm.read_factory_settings(use_empty=True)
        o = build_fish(name, sp, tex)
        for x in bpy.context.scene.objects:
            x.select_set(x is o)
        bpy.ops.export_scene.gltf(filepath=os.path.join(out, f"{name}.glb"), export_format="GLB", use_selection=True, export_yup=False,
                                  export_apply=True, export_image_format="AUTO", export_cameras=False, export_lights=False)
        print(f"[baliq_fish] {name}: {sum(len(p.vertices) - 2 for p in o.data.polygons)} tris")


main()
