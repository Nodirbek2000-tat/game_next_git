"""Harakat o'yinlari - skyscrapers and city buildings for the open city, built in Blender.

    blender -b --factory-startup --python tools/blender/buildings.py -- [--out public/models/poyga/buildings]
            [--tex public/textures/poyga/facades] [--trees public/textures/poyga/trees] [--preview DIR]

Towers are real geometry (piers, recessed glass, spandrels, setbacks, cornices, twisted lofts) with a handful of
role materials (glass, stone, metal, concrete, accent, light) so the game can share five shaders:
  deco      - art-deco setback tower with limestone piers and a mast (Empire State school)
  burama    - twisted, tapering glass tower (Shanghai Tower school)
  pogona    - tiered pagoda-like tower with cornices and a spire (Jin Mao school)
  ochqich   - tapering prism with an opening at the top (SWFC school)
  minora    - TV tower: three legs, a tapering shaft, observation pods, an antenna (Tashkent TV tower school)
  ofis_*    - modern glass office towers (chamfered, stepped, rounded)
Mid-rise blocks use FACADE TILES rendered here from detailed geometry (window frames, glass, curtains, balconies):
  facade_flats.png (one bay x two floors), facade_shop.png (ground floor), facade_office.png (curtain wall)
"""

import argparse
import math
import os
import random
import sys

import bpy
from mathutils import Vector

ROLES = {
    "glass": dict(c=(0.06, 0.08, 0.1), rough=0.04, metal=0.9),
    "stone": dict(c=(0.62, 0.58, 0.5), rough=0.7, metal=0.0),
    "metal": dict(c=(0.55, 0.57, 0.6), rough=0.3, metal=1.0),
    "concrete": dict(c=(0.72, 0.71, 0.68), rough=0.85, metal=0.0),
    "accent": dict(c=(0.55, 0.42, 0.2), rough=0.35, metal=0.8),
    "dark": dict(c=(0.03, 0.03, 0.035), rough=0.6, metal=0.2),
    "light": dict(c=(1.0, 0.85, 0.6), rough=0.5, metal=0.0, emit=2.0),
}


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.world = bpy.data.worlds.new("World")
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    return sc


MATS = {}


def mats():
    MATS.clear()
    for name, d in ROLES.items():
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        b = m.node_tree.nodes["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*d["c"], 1)
        b.inputs["Roughness"].default_value = d["rough"]
        b.inputs["Metallic"].default_value = d["metal"]
        if "emit" in d:
            b.inputs["Emission Color"].default_value = (*d["c"], 1)
            b.inputs["Emission Strength"].default_value = d["emit"]
        MATS[name] = m


class Geo:
    """Faces with a role each; becomes one Blender object (one material slot per role)."""

    def __init__(self):
        self.v = []
        self.f = []
        self.r = []

    def vert(self, p):
        self.v.append((p[0], p[1], p[2]))
        return len(self.v) - 1

    def face(self, pts, role):
        ids = [self.vert(p) for p in pts]
        self.f.append(ids)
        self.r.append(role)

    # z is up in Blender: ground plane is x, y
    def prism(self, poly, z0, z1, role, cap=True, bottom=False):
        """Extrude a CCW polygon [(x, y)] from z0 to z1 (outward walls + top)."""
        n = len(poly)
        for i in range(n):
            a = poly[i]
            b = poly[(i + 1) % n]
            self.face([(a[0], a[1], z0), (b[0], b[1], z0), (b[0], b[1], z1), (a[0], a[1], z1)], role)
        if cap:
            self.face([(x, y, z1) for (x, y) in poly], role)
        if bottom:
            self.face([(x, y, z0) for (x, y) in reversed(poly)], role)

    def box(self, x0, y0, x1, y1, z0, z1, role):
        self.prism([(x0, y0), (x1, y0), (x1, y1), (x0, y1)], z0, z1, role)

    def cbox(self, cx, cy, sx, sy, z0, z1, role):
        self.box(cx - sx / 2, cy - sy / 2, cx + sx / 2, cy + sy / 2, z0, z1, role)

    def loft(self, rings, role, cap=True):
        """rings: [(poly, z)] with equal vertex counts (CCW)."""
        for (pa, za), (pb, zb) in zip(rings, rings[1:]):
            n = len(pa)
            for i in range(n):
                j = (i + 1) % n
                self.face([(pa[i][0], pa[i][1], za), (pa[j][0], pa[j][1], za), (pb[j][0], pb[j][1], zb), (pb[i][0], pb[i][1], zb)], role)
        if cap:
            p, z = rings[-1]
            self.face([(x, y, z) for (x, y) in p], role)

    def cyl(self, cx, cy, r0, r1, z0, z1, n, role, cap=True):
        p0 = [(cx + r0 * math.cos(2 * math.pi * k / n), cy + r0 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        p1 = [(cx + r1 * math.cos(2 * math.pi * k / n), cy + r1 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        self.loft([(p0, z0), (p1, z1)], role, cap)

    def sphere(self, cx, cy, cz, r, role, rows=12, n=24, sz=1.0):
        rings = []
        for i in range(1, rows):
            th = math.pi * i / rows
            rr = r * math.sin(th)
            z = cz + r * math.cos(th) * sz
            rings.append(([(cx + rr * math.cos(2 * math.pi * k / n), cy + rr * math.sin(2 * math.pi * k / n)) for k in range(n)], z))
        rings.reverse()
        self.loft(rings, role, cap=False)
        self.face([(x, y, rings[-1][1]) for (x, y) in rings[-1][0]], role)
        self.face([(x, y, rings[0][1]) for (x, y) in reversed(rings[0][0])], role)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        me.from_pydata(self.v, [], self.f)
        me.update()
        roles = sorted(set(self.r))
        for r in roles:
            me.materials.append(MATS[r])
        me.polygons.foreach_set("material_index", [roles.index(r) for r in self.r])
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        import bmesh

        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-4)
        bm.to_mesh(me)
        bm.free()
        me.set_sharp_from_angle(angle=math.radians(30))
        me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
        return ob


# ------------------------------------------------------------------------------------------------ facade helpers

def rect(w, d, cx=0, cy=0):
    return [(cx - w / 2, cy - d / 2), (cx + w / 2, cy - d / 2), (cx + w / 2, cy + d / 2), (cx - w / 2, cy + d / 2)]


def chamfer(w, d, c):
    hw, hd = w / 2, d / 2
    return [(-hw + c, -hd), (hw - c, -hd), (hw, -hd + c), (hw, hd - c), (hw - c, hd), (-hw + c, hd), (-hw, hd - c), (-hw, -hd + c)]


def edges(poly):
    n = len(poly)
    for i in range(n):
        a = Vector((*poly[i], 0))
        b = Vector((*poly[(i + 1) % n], 0))
        d = b - a
        L = d.length
        if L < 1e-6:
            continue
        d /= L
        out = Vector((d.y, -d.x, 0))  # outward for a CCW polygon
        yield a, d, out, L


def pier_tier(G, poly, z0, z1, floor_h, bay, depth=0.45, pier_w=0.7, spandrel=True):
    """Stone tier: recessed dark glass between full-height stone piers, metal spandrels at every floor."""
    inset = [(x, y) for (x, y) in poly]
    G.prism(inset, z0, z1, "glass", cap=False)
    floors = max(1, int((z1 - z0) / floor_h))
    for a, d, out, L in edges(poly):
        n = max(1, int(L / bay))
        for k in range(n + 1):
            t = k * L / n
            c = a + d * t
            p = [tuple(c + d * (-pier_w / 2)), tuple(c + d * (pier_w / 2)), tuple(c + d * (pier_w / 2) + out * depth), tuple(c + d * (-pier_w / 2) + out * depth)]
            G.prism([(q[0], q[1]) for q in p], z0, z1, "stone")
        if spandrel:
            for f in range(floors):
                z = z0 + f * floor_h
                q0 = a + out * (depth * 0.4)
                q1 = a + d * L + out * (depth * 0.4)
                G.face([(q0.x, q0.y, z), (q1.x, q1.y, z), (q1.x, q1.y, z + floor_h * 0.28), (q0.x, q0.y, z + floor_h * 0.28)], "metal")
    # cornice
    G.prism(offset(poly, depth + 0.35), z1, z1 + 1.2, "stone")


def offset(poly, o):
    """Grow a convex CCW polygon by o (miter)."""
    n = len(poly)
    out = []
    for i in range(n):
        p = Vector((*poly[i], 0))
        a = Vector((*poly[i - 1], 0))
        b = Vector((*poly[(i + 1) % n], 0))
        d1 = (p - a).normalized()
        d2 = (b - p).normalized()
        n1 = Vector((d1.y, -d1.x, 0))
        n2 = Vector((d2.y, -d2.x, 0))
        m = (n1 + n2).normalized()
        k = o / max(0.3, m.dot(n1))
        q = p + m * k
        out.append((q.x, q.y))
    return out


def curtain(G, poly, z0, z1, floor_h, mull=1.6, fin=0.25, bands=1):
    """Glass curtain wall: glass skin, vertical mullion fins, a metal band every `bands` floors."""
    G.prism(poly, z0, z1, "glass", cap=False)
    for a, d, out, L in edges(poly):
        n = max(1, int(L / mull))
        for k in range(n + 1):
            c = a + d * (k * L / n)
            p = [c + d * -0.06, c + d * 0.06, c + d * 0.06 + out * fin, c + d * -0.06 + out * fin]
            G.prism([(q.x, q.y) for q in p], z0, z1, "metal", cap=False)
    floors = int((z1 - z0) / floor_h)
    for f in range(0, floors + 1, bands):
        z = z0 + f * floor_h
        G.prism(offset(poly, 0.12), z, z + 0.18, "metal")


# ------------------------------------------------------------------------------------------------ towers

def deco(seed=1):
    """Art-deco setback tower with a mast (Empire State school), ~380 m with the mast."""
    G = Geo()
    tiers = [(0, 22, 58, 44), (22, 95, 50, 36), (95, 118, 44, 31), (118, 255, 38, 27), (255, 300, 31, 22), (300, 318, 24, 17)]
    for (z0, z1, w, d) in tiers:
        pier_tier(G, rect(w, d), z0, z1, 3.9, 2.0)
        G.box(-w / 2, -d / 2, w / 2, d / 2, z1, z1 + 0.6, "stone")
    # crown: stepped ribs and the mast
    for k, (w, h) in enumerate([(18, 6), (14, 6), (10, 6)]):
        z = 319 + k * 6
        pier_tier(G, rect(w, w * 0.75), z, z + h, 3, 1.6, depth=0.3)
    G.cyl(0, 0, 4, 2.6, 337, 362, 16, "metal")
    G.cyl(0, 0, 2.6, 0.5, 362, 395, 12, "metal")
    G.cyl(0, 0, 0.5, 0.12, 395, 440, 8, "metal")
    # the lobby entrance
    G.box(-6, -23, 6, -21.8, 0, 9, "dark")
    G.box(-7, -23.6, 7, -22, 9, 10.2, "accent")
    return G


def burama(seed=1):
    """Twisted, tapering rounded-triangle glass tower (Shanghai Tower school), 520 m."""
    G = Geo()
    H = 520
    n = 36
    rings = []
    for i in range(0, 61):
        t = i / 60
        z = H * t
        R = 36 * (1 - 0.42 * t) - 2 * t * t
        tw = math.radians(120) * t
        sec = []
        for k in range(n):
            a = 2 * math.pi * k / n
            # rounded triangle: radius modulated by cos(3a)
            r = R * (1 + 0.12 * math.cos(3 * a))
            # the vertical notch
            if abs((a - math.pi / 2 + math.pi) % (2 * math.pi) - math.pi) < 0.09:
                r *= 0.92
            sec.append((r * math.cos(a + tw), r * math.sin(a + tw)))
        rings.append((sec, z))
    G.loft(rings, "glass", cap=True)
    # floor bands every ~15 m (the "zones"), a slim one every 4.5 m
    for i in range(0, 60):
        p, z = rings[i]
        G.prism(offset_list(p, 0.25 if i % 4 == 0 else 0.1), z, z + (0.9 if i % 4 == 0 else 0.15), "metal")
    # crown
    p, z = rings[-1]
    G.prism(offset_list(p, 0.5), z, z + 12, "metal", cap=False)
    G.cyl(0, 0, 3, 1.2, z, z + 40, 12, "metal")
    return G


def offset_list(poly, o):
    """Grow any star-shaped polygon radially from its centroid (good enough for the bands)."""
    cx = sum(p[0] for p in poly) / len(poly)
    cy = sum(p[1] for p in poly) / len(poly)
    out = []
    for (x, y) in poly:
        d = math.hypot(x - cx, y - cy) or 1
        out.append((x + (x - cx) / d * o, y + (y - cy) / d * o))
    return out


def pogona(seed=1):
    """Tiered pagoda-like tower with cornices and a spire (Jin Mao school), 420 m."""
    G = Geo()
    z = 0
    w = 54
    tiers = 13
    G.box(-34, -34, 34, 34, 0, 8, "stone")
    z = 8
    for i in range(tiers):
        h = 34 - i * 2.0
        c = w * 0.22
        poly = chamfer(w, w, c)
        curtain(G, poly, z, z + h, 4.0, mull=2.4, fin=0.35, bands=1)
        # cornice: protruding ring with corner spikes
        G.prism(offset(poly, 1.4), z + h, z + h + 1.0, "accent")
        for (x, y) in offset(poly, 1.4):
            G.cyl(x, y, 0.35, 0.05, z + h + 1.0, z + h + 4.0, 6, "accent")
        z += h + 1.0
        w *= 0.93
    G.cyl(0, 0, w * 0.35, w * 0.2, z, z + 18, 8, "accent")
    G.cyl(0, 0, 1.6, 0.15, z + 18, z + 60, 8, "metal")
    return G


def ochqich(seed=1):
    """Tapering prism with an opening at the top (SWFC school), 490 m."""
    G = Geo()
    H = 490
    rings = []
    for i in range(0, 41):
        t = i / 40
        z = H * t
        hw = 29
        # two opposite faces converge into a line at the top: the plan goes from a square to a long thin diamond
        wx = hw * (1 - 0.86 * t)
        wy = hw * (1 + 0.05 * t)
        poly = [(-wx, -wy), (wx, -wy), (wx + hw * t * 0.6, 0), (wx, wy), (-wx, wy), (-wx - hw * t * 0.6, 0)]
        rings.append((poly, z))
    G.loft(rings[:35], "glass", cap=False)
    # the top with the opening: two side towers joined by a bridge
    p, z = rings[34]
    zt = H
    for s in (-1, 1):
        G.box(-p[1][0] - 2, s * 22, p[1][0] + 2, s * 29, z, zt, "glass")
    G.box(-p[1][0] - 2, -29, p[1][0] + 2, 29, zt - 6, zt, "metal")
    G.box(-p[1][0] - 2, -29, p[1][0] + 2, -22, z - 2, z, "metal")
    for i in range(0, 35, 2):
        pp, zz = rings[i]
        G.prism(offset(pp, 0.12), zz, zz + 0.25, "metal")
    return G


def minora(seed=1):
    """TV tower (Tashkent TV tower school): three curved legs, a tapering steel shaft, two pods, a striped antenna."""
    G = Geo()
    for k in range(3):
        a = 2 * math.pi * k / 3
        ring_prev = None
        for i in range(13):
            t = i / 12
            r = 30 * (1 - t) ** 1.5 + 3.2
            cx, cy, cz = math.cos(a) * r, math.sin(a) * r, 64 * t
            rad = lerp(2.2, 1.4, t)
            ring = [(cx + rad * math.cos(2 * math.pi * m / 10), cy + rad * math.sin(2 * math.pi * m / 10), cz) for m in range(10)]
            if ring_prev:
                for m in range(10):
                    n2 = (m + 1) % 10
                    G.face([ring_prev[m], ring_prev[n2], ring[n2], ring[m]], "concrete")
            ring_prev = ring
    G.cyl(0, 0, 5.5, 3.6, 0, 240, 24, "concrete")
    # lower pod (machine rooms), the observation "disc" with windows, a restaurant ring
    G.cyl(0, 0, 8, 12, 96, 102, 32, "concrete")
    G.cyl(0, 0, 12, 12, 102, 106, 32, "glass", cap=False)
    G.cyl(0, 0, 12, 8, 106, 110, 32, "concrete")
    G.cyl(0, 0, 9, 16, 210, 216, 36, "concrete")
    G.cyl(0, 0, 16, 16, 216, 222, 36, "glass", cap=False)
    G.cyl(0, 0, 16, 10, 222, 228, 36, "concrete")
    # antenna with red / white bands
    z = 240
    for i in range(12):
        r0 = lerp(3.4, 0.4, i / 12)
        r1 = lerp(3.4, 0.4, (i + 1) / 12)
        G.cyl(0, 0, r0, r1, z, z + 11, 12, "accent" if i % 2 else "concrete")
        z += 11
    return G


def lerp(a, b, t):
    return a + (b - a) * t


def ofis(variant, seed=1):
    """Modern glass offices: 0 chamfered box, 1 stepped (two setbacks), 2 rounded slab with a crown."""
    rnd = random.Random(seed)
    G = Geo()
    if variant == 0:
        H = rnd.uniform(140, 210)
        poly = chamfer(34, 30, 4)
        G.box(-20, -18, 20, 18, 0, 10, "stone")
        curtain(G, poly, 10, H, 4.0, mull=1.6, fin=0.3, bands=1)
        G.prism(offset(poly, 0.5), H, H + 6, "metal", cap=True)
    elif variant == 1:
        H = rnd.uniform(160, 240)
        z = 0
        for k, (w, d, h) in enumerate([(40, 34, H * 0.5), (32, 28, H * 0.3), (22, 20, H * 0.2)]):
            poly = rect(w, d)
            curtain(G, poly, z, z + h, 4.2, mull=2.0, fin=0.45, bands=1)
            G.prism(offset(poly, 0.6), z + h, z + h + 1.5, "metal")
            z += h + 1.5
        G.cyl(0, 0, 1.2, 0.2, z, z + 30, 8, "metal")
    else:
        H = rnd.uniform(120, 180)
        n = 28
        poly = [(22 * math.cos(2 * math.pi * k / n), 13 * math.sin(2 * math.pi * k / n)) for k in range(n)]
        curtain(G, poly, 0, H, 3.8, mull=2.2, fin=0.25, bands=2)
        G.prism(offset_list(poly, 1.0), H, H + 9, "metal", cap=False)
        G.prism(poly, H, H + 0.5, "concrete")
    return G


TOWERS = {"deco": deco, "burama": burama, "pogona": pogona, "ochqich": ochqich, "minora": minora, "ofis_0": lambda s=1: ofis(0, s), "ofis_1": lambda s=1: ofis(1, s), "ofis_2": lambda s=1: ofis(2, s)}


# ------------------------------------------------------------------------------------------------ facade tiles (rendered)

def facade_tile(kind, path, size=1024):
    """Render one detailed facade tile orthographically (frames, sills, recessed glass with curtains, balconies)."""
    clear()
    mats()
    G = Geo()
    if kind == "flats":
        W, H = 3.2, 6.0
        MATS["concrete"].node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.5, 0.47, 0.42, 1)
        G.box(-W / 2, -0.05, W / 2, 0, 0, H, "concrete")
        for f in range(2):
            z = f * 3.0
            # window recess + frame + sill + glass + curtain (light cloth behind the glass)
            G.box(-0.75, -0.12, 0.75, -0.02, z + 0.85, z + 2.5, "dark")
            for (x0, x1) in ((-0.8, -0.72), (0.72, 0.8), (-0.04, 0.04)):
                G.box(x0, -0.14, x1, -0.05, z + 0.85, z + 2.5, "stone")
            G.box(-0.8, -0.14, 0.8, -0.05, z + 2.42, z + 2.5, "stone")
            G.box(-0.8, -0.14, 0.8, -0.05, z + 0.85, z + 0.93, "stone")
            G.box(-0.95, -0.25, 0.95, -0.05, z + 0.78, z + 0.86, "stone")
            G.box(-0.7, -0.09, -0.08, -0.08, z + 0.95, z + 2.4, "glass")
            G.box(0.08, -0.09, 0.7, -0.08, z + 0.95, z + 2.4, "glass")
            G.box(-0.68, -0.06, -0.1 + 0.3 * (f % 2), -0.05, z + 1.0, z + 2.35, "concrete")
        # a balcony on the upper floor
        G.box(-1.4, -1.25, 1.4, -0.05, 2.95, 3.08, "concrete")
        G.box(-1.4, -1.25, 1.4, -1.18, 3.08, 4.0, "concrete")
        G.box(-1.4, -1.25, -1.33, -0.05, 3.08, 4.0, "concrete")
        G.box(1.33, -1.25, 1.4, -0.05, 3.08, 4.0, "concrete")
    elif kind == "shop":
        W, H = 3.2, 4.0
        G.box(-W / 2, -0.05, W / 2, 0, 0, H, "stone")
        G.box(-1.45, -0.1, 1.45, -0.02, 0.3, 3.0, "light")
        G.box(-1.5, -0.12, 1.5, -0.05, 0.25, 0.35, "metal")
        G.box(-1.5, -0.12, 1.5, -0.05, 2.95, 3.05, "metal")
        G.box(-0.04, -0.12, 0.04, -0.05, 0.3, 3.0, "metal")
        G.box(-1.6, -0.4, 1.6, -0.05, 3.15, 3.8, "dark")
        # shelves and goods silhouettes behind the glass
        for k in range(3):
            G.box(-1.3, -0.04, 1.3, -0.03, 0.8 + k * 0.7, 0.86 + k * 0.7, "dark")
        G.box(-1.42, -0.095, 1.42, -0.09, 0.3, 3.0, "glass")
    else:
        W, H = 3.2, 8.0
        for f in range(2):
            z = f * 4.0
            G.box(-W / 2, -0.12, W / 2, -0.02, z, z + 4.0, "glass")
            G.box(-W / 2, -0.2, W / 2, -0.05, z, z + 0.9, "dark")
        for x in (-W / 2, 0, W / 2):
            G.box(x - 0.06, -0.35, x + 0.06, -0.05, 0, H, "metal")
        G.box(-W / 2, -0.25, W / 2, -0.05, 3.95, 4.05, "metal")
    # rotate to face the camera (-y) and render
    ob = G.to_object("tile")
    sc = bpy.context.scene
    sc.world.use_nodes = True
    sky = sc.world.node_tree.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = math.radians(35)
    except Exception:
        pass
    sc.world.node_tree.links.new(sky.outputs["Color"], sc.world.node_tree.nodes["Background"].inputs["Color"])
    sc.world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.25
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 2.5
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(60), 0, math.radians(-30))
    cam = bpy.data.cameras.new("cam")
    cam.type = "ORTHO"
    W = 3.2
    Ht = {"flats": 6.0, "shop": 4.0, "office": 8.0}[kind]
    cam.ortho_scale = max(W, Ht)
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    co.location = (0, -10, Ht / 2)
    co.rotation_euler = (math.radians(90), 0, 0)
    sc.camera = co
    sc.render.resolution_x = int(size * W / max(W, Ht))
    sc.render.resolution_y = int(size * Ht / max(W, Ht))
    sc.cycles.samples = 64
    sc.cycles.use_denoising = True
    sc.view_settings.view_transform = "Standard"
    sc.render.film_transparent = False
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------------------------------------ export / preview

def export(ob, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    ob.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
                              export_texcoords=False, export_normals=True, export_materials="EXPORT", export_cameras=False, export_lights=False)


def textured_block(name, w, d, floors, tex, z0=0):
    """A mid-rise block using the rendered facade tile (for the preview)."""
    import bmesh

    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    H = floors * 3.0
    pts = [(-w / 2, -d / 2), (w / 2, -d / 2), (w / 2, d / 2), (-w / 2, d / 2)]
    uv = bm.loops.layers.uv.new("UVMap")
    for i in range(4):
        a, b = pts[i], pts[(i + 1) % 4]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        vs = [bm.verts.new((a[0], a[1], z0)), bm.verts.new((b[0], b[1], z0)), bm.verts.new((b[0], b[1], z0 + H)), bm.verts.new((a[0], a[1], z0 + H))]
        f = bm.faces.new(vs)
        for lp, (u, v) in zip(f.loops, ((0, 0), (L / 3.2, 0), (L / 3.2, H / 6.0), (0, H / 6.0))):
            lp[uv].uv = (u, v)
    top = bm.faces.new([bm.verts.new((x, y, z0 + H)) for (x, y) in pts])
    bm.to_mesh(me)
    bm.free()
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    t = m.node_tree.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(tex)
    tint = m.node_tree.nodes.new("ShaderNodeMix")
    tint.data_type = "RGBA"
    tint.blend_type = "MULTIPLY"
    tint.inputs[0].default_value = 1.0
    r = random.Random(hash(name) & 0xffff)
    tint.inputs[7].default_value = random.Random(hash(name)).choice([(1, 0.93, 0.82, 1), (0.95, 0.9, 0.86, 1), (1, 0.86, 0.72, 1), (0.88, 0.9, 0.92, 1), (0.92, 0.78, 0.66, 1)])
    m.node_tree.links.new(t.outputs["Color"], tint.inputs[6])
    m.node_tree.links.new(tint.outputs[2], m.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.7
    _ = r
    me.materials.append(m)
    me.materials.append(MATS["concrete"])
    me.polygons[-1].material_index = 1
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def preview(d, texdir, treetex):
    """Aerial view of a skyline: the towers on a street grid among textured mid-rise blocks and trees, golden hour."""
    sc = clear()
    mats()
    rnd = random.Random(4)
    placed = [("burama", 0, 0), ("ochqich", 95, -40), ("pogona", 60, 70), ("deco", -120, 40), ("minora", -230, -160), ("ofis_0", -40, 110),
              ("ofis_1", 150, 60), ("ofis_2", 30, -120), ("ofis_0", -110, -90), ("ofis_1", -60, -10), ("ofis_2", 200, -70), ("ofis_0", 120, 160)]
    for k, (name, x, y) in enumerate(placed):
        ob = TOWERS[name](k + 1).to_object(f"{name}_{k}")
        ob.location = (x, y, 0)
        ob.rotation_euler.z = rnd.uniform(-0.2, 0.2) if name != "minora" else 0
    flats = os.path.join(texdir, "facade_flats.png")
    for gx in range(-6, 7):
        for gy in range(-6, 7):
            x, y = gx * 60 + 30, gy * 60 + 30
            if any(math.hypot(x - px, y - py) < 45 for (_, px, py) in placed):
                continue
            if rnd.random() < 0.85:
                ob = textured_block(f"b{gx}_{gy}", rnd.choice([24, 30, 36]), rnd.choice([14, 18]), rnd.choice([5, 9, 9, 12, 16]), flats)
                ob.location = (x + rnd.uniform(-6, 6), y + rnd.uniform(-6, 6), 0)
    # trees along the streets (the GLBs of tools/blender/trees.py)
    tdir = os.path.join(os.path.dirname(treetex), "glb") if treetex else ""
    protos = []
    for nm in ("terak_0.glb", "chinor_0.glb"):
        pth = os.path.join(tdir, nm)
        if os.path.exists(pth):
            before = set(bpy.context.scene.objects)
            bpy.ops.import_scene.gltf(filepath=pth)
            protos.append([o for o in bpy.context.scene.objects if o not in before and o.type == "MESH"])
    if protos:
        for gx in range(-6, 7):
            for t in range(-330, 330, 14):
                for side in (-1, 1):
                    pr = protos[(gx + t // 14) % len(protos)]
                    for (x, y) in ((gx * 60 + side * 9, t), (t, gx * 60 + side * 9)):
                        if any(math.hypot(x - px, y - py) < 40 for (_, px, py) in placed):
                            continue
                        for o in pr:
                            c = o.copy()
                            bpy.context.scene.collection.objects.link(c)
                            c.location = (x, y, 0)
                            c.rotation_euler.z = rnd.uniform(0, 6.28)
        for pr in protos:
            for o in pr:
                o.hide_render = True
    # ground + streets
    bpy.ops.mesh.primitive_plane_add(size=1600)
    g = bpy.context.active_object
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    gm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.09, 0.09, 1)
    g.data.materials.append(gm)
    # sky, sun, haze
    sc.world.use_nodes = True
    nt = sc.world.node_tree
    sky = nt.nodes.new("ShaderNodeTexSky")
    try:
        sky.sky_type = "NISHITA"
        sky.sun_elevation = math.radians(14)
        sky.sun_rotation = math.radians(250)
        sky.dust_density = 3
        sky.air_density = 1.5
    except Exception:
        pass
    nt.links.new(sky.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 0.3
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.2
    sun.color = (1, 0.82, 0.62)
    so = bpy.data.objects.new("sun", sun)
    sc.collection.objects.link(so)
    so.rotation_euler = (math.radians(76), 0, math.radians(250 - 90))
    cam = bpy.data.cameras.new("cam")
    cam.lens = 35
    cam.clip_end = 5000
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    co.location = (-760, -700, 170)
    tgt = Vector((10, 10, 160))
    co.rotation_euler = (tgt - co.location).to_track_quat("-Z", "Y").to_euler()
    sc.camera = co
    # atmospheric haze via the mist pass in the compositor
    sc.view_layers[0].use_pass_mist = True
    sc.world.mist_settings.start = 350
    sc.world.mist_settings.depth = 2600
    sc.use_nodes = True
    ct = sc.node_tree
    rl = ct.nodes["Render Layers"]
    comp = ct.nodes["Composite"]
    mix = ct.nodes.new("CompositorNodeMixRGB")
    mix.inputs[2].default_value = (0.78, 0.72, 0.66, 1)
    half = ct.nodes.new("CompositorNodeMath")
    half.operation = "MULTIPLY"
    half.inputs[1].default_value = 0.55
    ct.links.new(rl.outputs["Mist"], half.inputs[0])
    ct.links.new(half.outputs[0], mix.inputs[0])
    ct.links.new(rl.outputs["Image"], mix.inputs[1])
    ct.links.new(mix.outputs[0], comp.inputs["Image"])
    sc.render.resolution_x, sc.render.resolution_y = 1280, 760
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception:
        pass
    os.makedirs(d, exist_ok=True)
    sc.render.filepath = os.path.join(d, "skyline.png")
    bpy.ops.render.render(write_still=True)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models/poyga/buildings")
    ap.add_argument("--tex", default="public/textures/poyga/facades")
    ap.add_argument("--trees", default="public/textures/poyga/trees")
    ap.add_argument("--preview", default="")
    ap.add_argument("--no-export", action="store_true")
    a = ap.parse_args(argv)
    texdir = os.path.abspath(a.tex)
    os.makedirs(texdir, exist_ok=True)
    for kind in ("flats", "shop", "office"):
        facade_tile(kind, os.path.join(texdir, f"facade_{kind}.png"))
    if not a.no_export:
        for name, fn in TOWERS.items():
            clear()
            mats()
            ob = fn(1).to_object(name)
            print(f"[buildings] {name}: {len(ob.data.polygons)} faces")
            export(ob, os.path.join(os.path.abspath(a.out), f"{name}.glb"))
    if a.preview:
        preview(a.preview, texdir, a.trees)


main()
