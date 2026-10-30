"""Harakat o'yinlari - realistic, light car models for "Mashina haydash" (games/mashina), built by script in Blender.

    blender -b --factory-startup --python tools/blender/cars.py -- --out public/models/mashina [--only sedan,sport] [--preview DIR]

Everything is procedural (no textures): a smooth lofted body shell with real proportions, wheel arches cut by boolean,
lamps / grille / plates / shut lines projected onto the body (ray cast), an interior seen through the glass, detailed
wheels, and ambient occlusion baked (Cycles) into vertex colours. The game assigns its own materials by ROLE, which is
the material name in the GLB: paint (tinted by the chosen colour), glass, metal, matte, lamp. Vertex colour = base
colour x baked AO, so the shading costs nothing at run time (no AO pass, no texture fetch).

Outputs (glTF, y up, metres, +z = nose, y = 0 = ground, wheels touch the ground):
  <out>/<car>.glb          player car (sedan, krossover, sport): node "body" + node "wheel" (one wheel at the origin,
                           axle on x, rim facing +x; the game mirrors it for the -x side and spins/steers it)
  <out>/traffic/<kind>.glb light model for the traffic (sedan, krossover, van, truck): one node "body", wheels included

Coordinates in this file are the GAME's: x = the car's left (driver side, left-hand drive), y = up, z = forward.
"""

import argparse
import bisect
import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ROLES = ("paint", "glass", "metal", "matte", "lamp")


# ------------------------------------------------------------------------------------------------ colours (linear)

def srgb(h):
    h = h.lstrip("#")
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def grey(v):
    return (v, v, v)


WHITE = (1.0, 1.0, 1.0)
UNDER = grey(0.018)
BLACK = grey(0.022)
SEAL = grey(0.012)
CLAD = grey(0.035)
RUBBER = grey(0.03)
CHROME = grey(0.9)
DARKCHROME = grey(0.32)
ALU = grey(0.62)
GUNMETAL = grey(0.11)
STEEL = grey(0.5)
DISC = grey(0.3)
GLASS = (0.05, 0.058, 0.066)
CLOTH = grey(0.03)
DASH = grey(0.018)
PLATE = grey(0.82)
HEAD = (1.0, 0.96, 0.86)
DRL = (0.86, 0.93, 1.0)
TAIL = srgb("#7a0a0a")
TAILHI = srgb("#ff2414")
AMBER = srgb("#ff8a10")
REVERSE = grey(0.7)
FLAG_B, FLAG_W, FLAG_G = srgb("#1eb2e6"), grey(0.9), srgb("#1fa149")

PAINT = ("paint", WHITE)


# ------------------------------------------------------------------------------------------------ small math

def lerp(a, b, t):
    return a + (b - a) * t


def clamp(x, a, b):
    return a if x < a else b if x > b else x


def smooth(t):
    t = clamp(t, 0.0, 1.0)
    return t * t * (3 - 2 * t)


def pchip(pts):
    """Monotone cubic through [(x, y)] (no overshoot): smooth body lines without bumps."""
    if not isinstance(pts, (list, tuple)) or not isinstance(pts[0], (list, tuple)):
        v = float(pts)
        return lambda x: v
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    n = len(pts)
    h = [xs[i + 1] - xs[i] for i in range(n - 1)]
    d = [(ys[i + 1] - ys[i]) / h[i] for i in range(n - 1)]
    m = [0.0] * n
    m[0], m[-1] = d[0], d[-1]
    for i in range(1, n - 1):
        if d[i - 1] * d[i] <= 0:
            m[i] = 0.0
        else:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])

    def f(x):
        if x <= xs[0]:
            return ys[0]
        if x >= xs[-1]:
            return ys[-1]
        i = min(bisect.bisect_right(xs, x) - 1, n - 2)
        t = (x - xs[i]) / h[i]
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i]
                + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1])

    return f


def chaikin(pts, it=3):
    for _ in range(it):
        out = [pts[0]]
        for a, b in zip(pts, pts[1:]):
            out.append((lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)))
            out.append((lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)))
        out.append(pts[-1])
        pts = out
    return pts


def resample(pts, n):
    cum = [0.0]
    for a, b in zip(pts, pts[1:]):
        cum.append(cum[-1] + math.hypot(b[0] - a[0], b[1] - a[1]))
    total = cum[-1] or 1e-9
    out = []
    j = 0
    for k in range(n):
        s = total * k / (n - 1)
        while j < len(cum) - 2 and cum[j + 1] < s:
            j += 1
        seg = (cum[j + 1] - cum[j]) or 1e-9
        t = clamp((s - cum[j]) / seg, 0, 1)
        out.append((lerp(pts[j][0], pts[j + 1][0], t), lerp(pts[j][1], pts[j + 1][1], t)))
    return out


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def vcross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def vdot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def vnorm(a):
    l = math.sqrt(vdot(a, a)) or 1e-12
    return (a[0] / l, a[1] / l, a[2] / l)


# ------------------------------------------------------------------------------------------------ mesh builder

class Part:
    """Triangles/quads with a role and a base colour per face (game coordinates)."""

    def __init__(self):
        self.v = []
        self.f = []
        self.r = []
        self.c = []

    def vert(self, p):
        self.v.append((float(p[0]), float(p[1]), float(p[2])))
        return len(self.v) - 1

    def face(self, idx, role, col):
        idx = tuple(idx)
        if len(set(idx)) < 3:
            return
        self.f.append(idx)
        self.r.append(ROLES.index(role))
        self.c.append(tuple(col))

    def add(self, *others):
        for o in others:
            base = len(self.v)
            self.v += o.v
            self.f += [tuple(i + base for i in f) for f in o.f]
            self.r += o.r
            self.c += o.c
        return self

    def copy(self):
        p = Part()
        p.v, p.f, p.r, p.c = list(self.v), list(self.f), list(self.r), list(self.c)
        return p

    def map(self, fn):
        p = self.copy()
        p.v = [fn(v) for v in self.v]
        return p

    def move(self, dx, dy, dz):
        return self.map(lambda v: (v[0] + dx, v[1] + dy, v[2] + dz))

    def scale(self, sx, sy, sz):
        return self.map(lambda v: (v[0] * sx, v[1] * sy, v[2] * sz))

    def rot(self, axis, a, pivot=(0, 0, 0)):
        c, s = math.cos(a), math.sin(a)
        px, py, pz = pivot

        def fn(v):
            x, y, z = v[0] - px, v[1] - py, v[2] - pz
            if axis == "x":
                x, y, z = x, y * c - z * s, y * s + z * c
            elif axis == "y":
                x, y, z = x * c + z * s, y, -x * s + z * c
            else:
                x, y, z = x * c - y * s, x * s + y * c, z
            return (x + px, y + py, z + pz)

        return self.map(fn)

    def mirror_x(self):
        p = self.map(lambda v: (-v[0], v[1], v[2]))
        p.f = [tuple(reversed(f)) for f in p.f]
        return p

    def flip(self):
        p = self.copy()
        p.f = [tuple(reversed(f)) for f in p.f]
        return p

    def recolor(self, role, col):
        p = self.copy()
        p.r = [ROLES.index(role)] * len(p.f)
        p.c = [tuple(col)] * len(p.f)
        return p

    def normal(self, fi):
        f = self.f[fi]
        n = [0.0, 0.0, 0.0]
        for i in range(len(f)):
            a, b = self.v[f[i]], self.v[f[(i + 1) % len(f)]]
            n[0] += (a[1] - b[1]) * (a[2] + b[2])
            n[1] += (a[2] - b[2]) * (a[0] + b[0])
            n[2] += (a[0] - b[0]) * (a[1] + b[1])
        return tuple(n)

    def center(self, fi):
        f = self.f[fi]
        return tuple(sum(self.v[i][k] for i in f) / len(f) for k in range(3))

    def orient(self, fn):
        """Flip every face whose normal points against fn(face_centre) (an outward direction)."""
        for fi in range(len(self.f)):
            if vdot(self.normal(fi), fn(self.center(fi))) < 0:
                self.f[fi] = tuple(reversed(self.f[fi]))
        return self

    def outward(self, c):
        return self.orient(lambda p: vsub(p, c))

    @property
    def tris(self):
        return sum(len(f) - 2 for f in self.f)


def lathe(profile, segs, style, a0=0.0, a1=2 * math.pi, rmod=None):
    """Revolve [(x, r)] about the x axis. style(i, k) -> (role, col) for the band i..i+1, sector k..k+1.
    Faces point to the left of the profile direction (profile going +x at constant r -> outward)."""
    p = Part()
    full = abs((a1 - a0) - 2 * math.pi) < 1e-6
    na = segs if full else segs + 1
    rows = []
    for i, (x, r) in enumerate(profile):
        row = []
        for k in range(na):
            a = a0 + (a1 - a0) * k / segs
            rr = r + (rmod(i, k) if rmod else 0.0)
            row.append(p.vert((x, rr * math.cos(a), rr * math.sin(a))))
        rows.append(row)
    for i in range(len(profile) - 1):
        for k in range(segs):
            k2 = (k + 1) % na
            role, col = style(i, k)
            p.face((rows[i][k], rows[i][k2], rows[i + 1][k2], rows[i + 1][k]), role, col)
    return p


def disc(x, r, segs, role, col, facing=1, r0=0.0, cy=0.0, cz=0.0):
    """A disc (or ring when r0 > 0) in the plane x = const, facing +x (facing=1) or -x."""
    p = Part()
    outer = [p.vert((x, cy + r * math.cos(2 * math.pi * k / segs), cz + r * math.sin(2 * math.pi * k / segs))) for k in range(segs)]
    if r0 > 0:
        inner = [p.vert((x, cy + r0 * math.cos(2 * math.pi * k / segs), cz + r0 * math.sin(2 * math.pi * k / segs))) for k in range(segs)]
        for k in range(segs):
            p.face((outer[k], outer[(k + 1) % segs], inner[(k + 1) % segs], inner[k]), role, col)
    else:
        c = p.vert((x, cy, cz))
        for k in range(segs):
            p.face((c, outer[k], outer[(k + 1) % segs]), role, col)
    return p.orient(lambda q: (facing, 0, 0))


def cylinder_x(x0, x1, r, segs, role, col, caps=True, cy=0.0, cz=0.0):
    p = lathe([(x0, r), (x1, r)], segs, lambda i, k: (role, col)).move(0, cy, cz)
    if caps:
        p.add(disc(x1, r, segs, role, col, 1, cy=cy, cz=cz), disc(x0, r, segs, role, col, -1, cy=cy, cz=cz))
    return p


def along_z(p):
    """Turn an x-axis part so that its axis runs along +z."""
    return p.rot("y", -math.pi / 2)


def along_y(p):
    return p.rot("z", math.pi / 2)


def rbox(c, size, r, role, col, n=3, flat=1):
    """Rounded box: a subdivided cube projected onto the rounded shape. c = centre, size = full extents."""
    h = [size[0] / 2, size[1] / 2, size[2] / 2]
    r = max(1e-4, min(r, min(h) * 0.98))
    inner = [hh - r for hh in h]

    def coords(k):
        t = [inner[k] + r * math.tan(math.pi / 4 * j / n) for j in range(n + 1)]
        mids = [inner[k] * (2 * j / (flat + 1) - 1) for j in range(1, flat + 1)] if inner[k] > 1e-4 else []
        neg = [-x for x in reversed(t)]
        return neg + mids + t

    C = [coords(0), coords(1), coords(2)]
    p = Part()
    for ax in range(3):
        u, v = [(1, 2), (2, 0), (0, 1)][ax]
        for sgn in (-1, 1):
            grid = []
            for a in C[u]:
                row = []
                for b in C[v]:
                    q = [0.0, 0.0, 0.0]
                    q[ax] = sgn * (inner[ax] + r)
                    q[u], q[v] = a, b
                    cl = [clamp(q[i], -inner[i], inner[i]) for i in range(3)]
                    d = vnorm(vsub(q, cl))
                    pt = (cl[0] + d[0] * r + c[0], cl[1] + d[1] * r + c[1], cl[2] + d[2] * r + c[2])
                    row.append(p.vert(pt))
                grid.append(row)
            for i in range(len(C[u]) - 1):
                for j in range(len(C[v]) - 1):
                    p.face((grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]), role, col)
    return p.outward(c)


def ellipsoid(c, rx, ry, rz, role, col, nu=16, nv=10):
    p = Part()
    rows = []
    for i in range(nv + 1):
        th = math.pi * i / nv
        row = []
        for k in range(nu):
            ph = 2 * math.pi * k / nu
            row.append(p.vert((c[0] + rx * math.sin(th) * math.cos(ph), c[1] + ry * math.cos(th), c[2] + rz * math.sin(th) * math.sin(ph))))
        rows.append(row)
    for i in range(nv):
        for k in range(nu):
            k2 = (k + 1) % nu
            if i == 0:
                p.face((rows[0][0], rows[1][k], rows[1][k2]), role, col)
            elif i == nv - 1:
                p.face((rows[i][k], rows[i + 1][0], rows[i][k2]), role, col)
            else:
                p.face((rows[i][k], rows[i + 1][k], rows[i + 1][k2], rows[i][k2]), role, col)
    return p.outward(c)


def torus_x(R, r, nu, nv, role, col):
    """Torus around the x axis (ring in the y-z plane)."""
    p = Part()
    rows = []
    for i in range(nu):
        a = 2 * math.pi * i / nu
        row = []
        for k in range(nv):
            b = 2 * math.pi * k / nv
            rr = R + r * math.cos(b)
            row.append(p.vert((r * math.sin(b), rr * math.cos(a), rr * math.sin(a))))
        rows.append(row)
    for i in range(nu):
        for k in range(nv):
            p.face((rows[i][k], rows[(i + 1) % nu][k], rows[(i + 1) % nu][(k + 1) % nv], rows[i][(k + 1) % nv]), role, col)

    def out(q):
        d = math.hypot(q[1], q[2]) or 1e-9
        return (q[0], q[1] - R * q[1] / d, q[2] - R * q[2] / d)

    return p.orient(out)


# 2D outlines (u, v)
def rrect(cu, cv, w, h, r, n=4):
    r = min(r, w / 2, h / 2)
    pts = []
    for (sx, sy, a0) in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ccu, ccv = cu + sx * (w / 2 - r), cv + sy * (h / 2 - r)
        for j in range(n + 1):
            a = math.radians(a0 + 90 * j / n)
            pts.append((ccu + r * math.cos(a), ccv + r * math.sin(a)))
    return pts


def circle(cu, cv, r, n=16):
    return [(cu + r * math.cos(2 * math.pi * k / n), cv + r * math.sin(2 * math.pi * k / n)) for k in range(n)]


def smooth_outline(pts, it=2):
    """Closed polygon -> rounded corners (closed Chaikin)."""
    for _ in range(it):
        out = []
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            out.append((lerp(a[0], b[0], 0.25), lerp(a[1], b[1], 0.25)))
            out.append((lerp(a[0], b[0], 0.75), lerp(a[1], b[1], 0.75)))
        pts = out
    return pts


def mirror_u(pts):
    return [(-u, v) for (u, v) in reversed(pts)]


# ------------------------------------------------------------------------------------------------ Blender glue

def G(v):
    """game (x, y, z) -> Blender (x, -z, y); a proper rotation, windings stay."""
    return (v[0], -v[2], v[1])


def GD(v):
    """Blender -> game"""
    return (v[0], v[2], -v[1])


MATS = []


def make_materials():
    MATS.clear()
    spec = {
        "paint": dict(rough=0.32, metal=0.4, coat=1.0),
        "glass": dict(rough=0.04, metal=0.0, alpha=0.45),
        "metal": dict(rough=0.2, metal=1.0),
        "matte": dict(rough=0.75, metal=0.0),
        "lamp": dict(rough=0.3, metal=0.0, emit=1.0),
    }
    for name in ROLES:
        m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        s = spec[name]
        bsdf.inputs["Roughness"].default_value = s["rough"]
        bsdf.inputs["Metallic"].default_value = s["metal"]
        if "coat" in s:
            bsdf.inputs["Coat Weight"].default_value = s["coat"]
            bsdf.inputs["Coat Roughness"].default_value = 0.03
        if "alpha" in s:
            bsdf.inputs["Alpha"].default_value = s["alpha"]
            try:
                m.surface_render_method = "BLENDED"
            except Exception:
                pass
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        tint = nt.nodes.new("ShaderNodeMix")
        tint.data_type = "RGBA"
        tint.blend_type = "MULTIPLY"
        tint.inputs[0].default_value = 1.0
        tint.inputs[7].default_value = (1, 1, 1, 1)
        tint.name = "tint"
        nt.links.new(vc.outputs["Color"], tint.inputs[6])
        nt.links.new(tint.outputs[2], bsdf.inputs["Base Color"])
        if "emit" in s:
            nt.links.new(tint.outputs[2], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = 1.5
        MATS.append(m)


def set_paint_tint(col):
    t = bpy.data.materials["paint"].node_tree.nodes["tint"]
    t.inputs[7].default_value = (*col, 1)


def to_object(name, part, merge=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata([G(v) for v in part.v], [], part.f)
    me.update()
    for m in MATS:
        me.materials.append(m)
    me.polygons.foreach_set("material_index", part.r)
    attr = me.attributes.new("base", "FLOAT_COLOR", "FACE")
    flat = []
    for c in part.c:
        flat += [c[0], c[1], c[2], 1.0]
    attr.data.foreach_set("color", flat)
    if merge:
        bm = bmesh.new()
        bm.from_mesh(me)
        bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=2e-5)
        bm.to_mesh(me)
        bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    bpy.data.meshes.remove(old)


def boolean_cut(ob, cutter_part):
    c = to_object("cutter", cutter_part)
    mod = ob.modifiers.new("cut", "BOOLEAN")
    mod.operation = "DIFFERENCE"
    mod.solver = "EXACT"
    mod.object = c
    mod.material_mode = "TRANSFER"
    apply_modifiers(ob)
    bpy.data.objects.remove(c)


def shade(ob, angle=34):
    me = ob.data
    me.polygons.foreach_set("use_smooth", [True] * len(me.polygons))
    me.set_sharp_from_angle(angle=math.radians(angle))


class Surf:
    """Ray casts onto a body (for projecting lamps, grilles, shut lines...)."""

    PLANES = {
        "front": lambda u, v: ((u, v, 8.0), (0, 0, -1)),
        "rear": lambda u, v: ((u, v, -8.0), (0, 0, 1)),
        "left": lambda u, v: ((4.0, v, u), (-1, 0, 0)),
        "right": lambda u, v: ((-4.0, v, u), (1, 0, 0)),
        "top": lambda u, v: ((u, 6.0, v), (0, -1, 0)),
    }

    def __init__(self, ob):
        dg = bpy.context.evaluated_depsgraph_get()
        self.bvh = BVHTree.FromObject(ob, dg)
        self.misses = 0

    def hit(self, plane, u, v):
        o, d = self.PLANES[plane](u, v)
        loc, nor, _, _ = self.bvh.ray_cast(Vector(G(o)), Vector(G(d)), 20.0)
        if loc is None:
            self.misses += 1
            return None
        return GD(loc), vnorm(GD(nor))

    def point(self, plane, u, v, off=0.0):
        h = self.hit(plane, u, v)
        if not h:
            return None
        p, n = h
        return (p[0] + n[0] * off, p[1] + n[1] * off, p[2] + n[2] * off)


def patch(S, P, plane, outline, role, col, off=0.004, rings=3, lift=0.0, mirror=False):
    """Project a closed 2D outline onto the body and fill it (concentric rings, so it hugs curved panels).
    lift > 0 raises it into a small solid (door handles, trims). mirror=True also adds the x-mirrored copy."""
    if mirror:
        if plane in ("left", "right"):
            patch(S, P, "right" if plane == "left" else "left", outline, role, col, off, rings, lift)
        else:
            patch(S, P, plane, mirror_u(outline), role, col, off, rings, lift)
    cu = sum(u for u, _ in outline) / len(outline)
    cv = sum(v for _, v in outline) / len(outline)
    hits = []
    for k in range(rings):
        s = 1 - k / rings
        row = []
        for (u, v) in outline:
            h = S.hit(plane, cu + (u - cu) * s, cv + (v - cv) * s)
            if not h:
                return
            row.append(h)
        hits.append(row)
    hc = S.hit(plane, cu, cv)
    if not hc:
        return
    q = Part()

    def put(h, extra):
        p, n = h
        o = off + extra
        return q.vert((p[0] + n[0] * o, p[1] + n[1] * o, p[2] + n[2] * o))

    ids = [[put(h, lift) for h in row] for row in hits]
    cid = put(hc, lift)
    m = len(outline)
    for k in range(rings - 1):
        for j in range(m):
            q.face((ids[k][j], ids[k][(j + 1) % m], ids[k + 1][(j + 1) % m], ids[k + 1][j]), role, col)
    for j in range(m):
        q.face((ids[-1][j], ids[-1][(j + 1) % m], cid), role, col)
    nrm = hc[1]
    if lift > 0:
        base = [put(h, 0.0) for h in hits[0]]
        for j in range(m):
            q.face((base[j], base[(j + 1) % m], ids[0][(j + 1) % m], ids[0][j]), role, col)
        cpos = q.v[cid]
        nf = len(q.f) - m
        q.orient(lambda c: nrm)
        # walls: outward from the patch centre
        for fi in range(nf, len(q.f)):
            c = q.center(fi)
            d = vsub(c, cpos)
            d = vsub(d, tuple(nrm[i] * vdot(d, nrm) for i in range(3)))
            if vdot(q.normal(fi), d) < 0:
                q.f[fi] = tuple(reversed(q.f[fi]))
    else:
        q.orient(lambda c: nrm)
    P.add(q)


def seam(S, P, plane, path, width, role=None, col=None, off=0.003, mirror=False):
    """A thin strip (shut line, trim, wiper) along a 2D path projected on the body."""
    role, col = role or "matte", col or SEAL
    if mirror:
        if plane in ("left", "right"):
            seam(S, P, "right" if plane == "left" else "left", path, width, role, col, off)
        else:
            seam(S, P, plane, [(-u, v) for u, v in path], width, role, col, off)
    q = Part()
    L, R = [], []
    nrm = None
    for i, (u, v) in enumerate(path):
        a = path[max(0, i - 1)]
        b = path[min(len(path) - 1, i + 1)]
        du, dv = b[0] - a[0], b[1] - a[1]
        l = math.hypot(du, dv) or 1e-9
        nu, nv = -dv / l * width / 2, du / l * width / 2
        h1 = S.hit(plane, u + nu, v + nv)
        h2 = S.hit(plane, u - nu, v - nv)
        if not h1 or not h2:
            return
        nrm = h1[1]
        L.append(q.vert(tuple(h1[0][k] + h1[1][k] * off for k in range(3))))
        R.append(q.vert(tuple(h2[0][k] + h2[1][k] * off for k in range(3))))
    hs = [S.hit(plane, u, v) for (u, v) in path]
    for i in range(len(path) - 1):
        q.face((L[i], L[i + 1], R[i + 1], R[i]), role, col)
        n = hs[i][1] if hs[i] else nrm
        fi = len(q.f) - 1
        if vdot(q.normal(fi), n) < 0:
            q.f[fi] = tuple(reversed(q.f[fi]))
    P.add(q)


# ------------------------------------------------------------------------------------------------ body shell

def shell(S, lod):
    hw, yb, ys, yt, rw = (pchip(S[k]) for k in ("hw", "yb", "ys", "yt", "rw"))
    zr, zf = S["z"]
    crown = S.get("crown", 0.05)
    NA, NB, NC = (14, 8, 11) if lod == 0 else (7, 4, 5)
    step = 0.035 if lod == 0 else 0.1
    Rr, Rf = S.get("round", (0.12, 0.14))
    smin = S.get("smin", 0.6)
    zs = []
    n = max(2, int((zf - zr) / step))
    zs += [zr + (zf - zr) * i / n for i in range(n + 1)]
    ne = 8 if lod == 0 else 3
    for k in range(1, ne):
        th = (math.pi / 2) * k / ne
        zs.append(zf - Rf * (1 - math.cos(th)))
        zs.append(zr + Rr * (1 - math.cos(th)))
    keep = [z for z in S.get("cuts", []) if zr < z < zf]
    zs.sort()
    stations = []
    for z in zs:
        if any(abs(z - k) < (0.012 if lod == 0 else 0.03) for k in keep):
            continue
        if stations and z - stations[-1] < 0.006:
            continue
        stations.append(z)
    stations = sorted(set(stations + keep))

    def endscale(z):
        for d, R in ((zf - z, Rf), (z - zr, Rr)):
            if d < R:
                t = 1 - d / R
                return smin + (1 - smin) * math.sqrt(max(0.0, 1 - t * t))
        return 1.0

    def half(z):
        w, b, s, t = hw(z), yb(z), ys(z), yt(z)
        t = max(t, s + 0.004)
        h = (t - crown) - s
        g = clamp(h / 0.16, 0, 1)
        xs_ = w * S.get("shoulder", 0.955)
        xe = lerp(xs_ - 0.03, rw(z), smooth(g))
        ye = s + max(h, 0.008)
        lower_ctrl = [(0, b), (w * 0.55, b), (w * 0.86, b + 0.008), (w * 0.975, b + 0.05), (w, b + S.get("waist", 0.42) * (s - b)),
                      (w * 0.99, b + 0.74 * (s - b)), (w * 0.968, s - 0.018), (xs_, s)]
        lower = resample(chaikin(lower_ctrl, 3), NA)
        upper = []
        for k in range(NB):
            u = k / (NB - 1)
            upper.append((lerp(xs_, xe, u) + S.get("bulge", 0.018) * math.sin(math.pi * u) * g, lerp(s, ye, u)))
        top = []
        ex = S.get("roofround", 2.5)
        for k in range(NC):
            u = k / (NC - 1)
            top.append((xe * (1 - u), t - (t - ye) * (1 - u) ** ex))
        return lower + upper[1:] + top[1:], (b, t)

    N = NA + NB + NC - 2
    M = 2 * N - 2
    P = Part()
    rings = []
    for z in stations:
        pts, (b, t) = half(z)
        cy = (b + t) / 2
        sc = endscale(z)
        ring = pts + [(-x, y) for (x, y) in reversed(pts[1:-1])]
        rings.append([P.vert((x * sc, cy + (y - cy) * sc, z)) for (x, y) in ring])

    def fidx(j):
        return j if j < N - 1 else M - 1 - j

    role_fn = S["role"]
    for i in range(len(stations) - 1):
        zc = (stations[i] + stations[i + 1]) / 2
        for j in range(M):
            a, b2, c, d = rings[i][j], rings[i][(j + 1) % M], rings[i + 1][(j + 1) % M], rings[i + 1][j]
            f = fidx(j)
            yc = (P.v[a][1] + P.v[b2][1] + P.v[c][1] + P.v[d][1]) / 4
            xc = abs(P.v[a][0] + P.v[b2][0] + P.v[c][0] + P.v[d][0]) / 4
            if f < NA - 1:
                seg, k, nk = "lower", f, NA - 1
            elif f < NA + NB - 2:
                seg, k, nk = "upper", f - (NA - 1), NB - 1
            else:
                seg, k, nk = "top", f - (NA + NB - 2), NC - 1
            role, col = role_fn(seg, k, nk, zc, yc, xc, lod)
            P.face((a, b2, c, d), role, col)
    for idx, z, sgn in ((0, stations[0], -1), (len(stations) - 1, stations[-1], 1)):
        ring = rings[idx]
        cx = sum(P.v[i][1] for i in ring) / M
        cid = P.vert((0.0, cx, z + sgn * 0.004))
        for j in range(M):
            if sgn > 0:
                P.face((cid, ring[j], ring[(j + 1) % M]), "paint", WHITE)
            else:
                P.face((cid, ring[(j + 1) % M], ring[j]), "paint", WHITE)
    return P


def window_roles(W):
    """Standard role function from window ranges: W = dict(front=(z0,z1), rear=(z0,z1), side=[(z0,z1),...],
    black=[(z0,z1)] (blacked-out pillars), clad=y (black lower cladding), belt=chrome?, pillar=columns of paint)."""

    def fn(seg, k, nk, z, y, x, lod):
        if seg == "lower":
            if k <= (1 if lod == 0 else 0):
                return ("matte", UNDER)
            if W.get("clad") and y < W["clad"]:
                return ("matte", CLAD)
            return PAINT
        if seg == "upper":
            for (z0, z1) in W.get("side", []):
                if z0 < z < z1:
                    if k == 0:
                        return ("metal", CHROME) if W.get("belt", True) else ("matte", SEAL)
                    if k == nk - 1 and lod == 0:
                        return ("matte", SEAL)
                    return ("glass", GLASS)
            for (z0, z1) in W.get("black", []):
                if z0 < z < z1:
                    return ("matte", BLACK)
            return PAINT
        pil = W.get("pillar", 2) if lod == 0 else 1
        for key in ("front", "rear"):
            r = W.get(key)
            if r and r[0] < z < r[1] and k >= pil:
                return ("glass", GLASS)
        r = W.get("sunroof")
        if r and r[0] < z < r[1] and k >= pil + 1:
            return ("glass", GLASS)
        return PAINT

    return fn


def arch_cutters(S, lod):
    """Two cylinders per axle (one each side) -> wheel arches. Their faces become the dark wheel wells."""
    P = Part()
    segs = 48 if lod == 0 else 16
    for (z, r) in S["arches"]:
        x0 = S["track"] + 0.03 - 0.22
        cyl = cylinder_x(x0, 2.5, r, segs, "matte", UNDER).move(0, S["wheel"]["r"] + 0.012, z)
        P.add(cyl, cyl.mirror_x())
    return P


# ------------------------------------------------------------------------------------------------ wheels

def make_wheel(W, lod):
    R, w, rr = W["r"], W["w"] / 2, W["r"] * W["rim"]
    H = R - rr
    P = Part()
    segs = 72 if lod == 0 else 18
    tread = lambda i, k: ("matte", RUBBER)
    if lod == 0:
        prof = [(-0.80 * w, rr + 0.004), (-0.97 * w, rr + 0.22 * H), (-1.0 * w, rr + 0.55 * H), (-0.94 * w, R - 0.14 * H),
                (-0.82 * w, R - 0.03), (-0.66 * w, R - 0.006), (-0.56 * w, R), (-0.22 * w, R), (-0.2 * w, R - 0.009),
                (-0.13 * w, R - 0.009), (-0.11 * w, R), (0.11 * w, R), (0.13 * w, R - 0.009), (0.2 * w, R - 0.009), (0.22 * w, R),
                (0.56 * w, R), (0.66 * w, R - 0.006), (0.82 * w, R - 0.03), (0.94 * w, R - 0.14 * H), (1.0 * w, rr + 0.55 * H),
                (0.97 * w, rr + 0.22 * H), (0.80 * w, rr + 0.004)]
        blocks = {5, 6, 15, 16}
        rmod = lambda i, k: (-0.007 if (i in blocks and k % 2) else 0.0)
    else:
        prof = [(-0.8 * w, rr), (-1.0 * w, rr + 0.5 * H), (-0.85 * w, R - 0.02), (-0.6 * w, R), (0.6 * w, R), (0.85 * w, R - 0.02),
                (1.0 * w, rr + 0.5 * H), (0.8 * w, rr)]
        rmod = None
    P.add(lathe(prof, segs, tread, rmod=rmod))
    style = W.get("style", "alloy5")
    rimc = W.get("color", ALU)
    rs = 64 if lod == 0 else 16
    # lip + dish
    lip = [(0.80 * w, rr + 0.004), (0.87 * w, rr - 0.004), (0.85 * w, rr - 0.02), (0.7 * w, rr - 0.03)]
    P.add(lathe(lip, rs, lambda i, k: ("metal", rimc)))
    # barrel (dark, seen between spokes) and back plate so nothing shows through the wheel
    P.add(lathe([(0.7 * w, rr - 0.03), (0.3 * w, rr - 0.038), (-0.7 * w, rr - 0.038)], rs, lambda i, k: ("matte", grey(0.05))))
    P.add(disc(-0.55 * w, rr - 0.03, rs, "matte", grey(0.012), 1))
    if lod == 0:
        P.add(lathe([(0.12 * w, rr * 0.74), (0.12 * w, 0.1), (-0.12 * w, 0.1)], 40, lambda i, k: ("metal", DISC)))
        P.add(lathe([(-0.12 * w, rr * 0.74), (0.12 * w, rr * 0.74)], 40, lambda i, k: ("metal", DISC)))
    face_x = 0.66 * w
    if style.startswith("steel"):
        prof = [(0.7 * w, rr - 0.03), (0.6 * w, rr - 0.05), (0.42 * w, rr * 0.74), (0.5 * w, rr * 0.48), (0.62 * w, 0.11)]
        P.add(lathe(prof, rs, lambda i, k: ("metal", rimc)))
        P.add(disc(0.62 * w, 0.11, rs, "metal", rimc, 1))
        holes = 8 if lod == 0 else 0
        for k in range(holes):
            a = 2 * math.pi * k / holes
            cy, cz = rr * 0.6 * math.cos(a), rr * 0.6 * math.sin(a)
            P.add(disc(0.47 * w + 0.004, rr * 0.11, 12, "matte", grey(0.01), 1, cy=cy, cz=cz))
        hub = W.get("hub", 0.075)
        P.add(lathe([(0.62 * w, hub), (0.72 * w, hub * 0.92), (0.76 * w, hub * 0.6)], 24 if lod == 0 else 10, lambda i, k: ("metal", CHROME)))
        P.add(disc(0.76 * w, hub * 0.6, 24 if lod == 0 else 10, "metal", CHROME, 1))
        if lod == 0 and W.get("nuts"):
            for k in range(W["nuts"]):
                a = 2 * math.pi * k / W["nuts"]
                P.add(cylinder_x(0.62 * w, 0.7 * w, 0.014, 6, "metal", CHROME, cy=hub * 1.35 * math.cos(a), cz=hub * 1.35 * math.sin(a)))
        return P
    n = W.get("spokes", 5)
    twin = style == "twin"
    if lod == 0:
        r0, r1 = 0.07, rr - 0.026
        for k in range(n * (2 if twin else 1)):
            base = 2 * math.pi * (k // 2 if twin else k) / n
            a = base + ((0.075 if k % 2 else -0.075) if twin else 0.0)
            P.add(spoke(a, r0, r1, W.get("sw", (0.055, 0.04)) if not twin else (0.03, 0.022), face_x, w, rimc))
    else:
        # cheap: a flat face disc with dark sectors suggests spokes from afar
        P.add(disc(0.62 * w, rr - 0.03, rs, "metal", rimc, 1, r0=0.08))
    hub = 0.085
    P.add(lathe([(0.56 * w, hub), (0.74 * w, hub * 0.95), (0.78 * w, hub * 0.7)], 32 if lod == 0 else 10, lambda i, k: ("metal", rimc)))
    P.add(disc(0.78 * w, hub * 0.7, 32 if lod == 0 else 10, "metal", W.get("cap", GUNMETAL), 1))
    if lod == 0:
        for k in range(5):
            a = 2 * math.pi * k / 5 + 0.3
            P.add(cylinder_x(0.74 * w, 0.8 * w, 0.011, 6, "metal", CHROME, cy=0.058 * math.cos(a), cz=0.058 * math.sin(a)))
    return P


def spoke(a, r0, r1, wdt, face_x, w, col):
    """One spoke from the hub to the rim, slightly concave (hub stands out)."""
    P = Part()
    st = [0.0, 0.35, 1.0]
    rows = []
    cr, sr = math.cos(a), math.sin(a)
    for t in st:
        r = lerp(r0, r1, t)
        ww = lerp(wdt[0], wdt[1], t) / 2
        xf = lerp(face_x + 0.06 * w, face_x - 0.02 * w, t ** 0.7)
        xb = xf - 0.045
        ring = []
        for (dx, dw) in ((xf, ww), (xf, -ww), (xb, -ww * 1.15), (xb, ww * 1.15)):
            ring.append(P.vert((dx, r * cr - dw * sr, r * sr + dw * cr)))
        rows.append(ring)
    for i in range(len(st) - 1):
        for j in range(4):
            P.face((rows[i][j], rows[i][(j + 1) % 4], rows[i + 1][(j + 1) % 4], rows[i + 1][j]), "metal", col)

    def out(c):
        r = c[1] * cr + c[2] * sr
        return (c[0] - (face_x - 0.02), c[1] - r * cr, c[2] - r * sr)

    return P.orient(out)


# ------------------------------------------------------------------------------------------------ shared details

def interior(S, lod):
    c = S.get("cabin")
    P = Part()
    if not c:
        return P
    z0, z1, y0, y1, hwc = c["z0"], c["z1"], c["floor"], c["roof"], c["hw"]
    n = 3 if lod == 0 else 1
    seats = [(x, c["seat_z"]) for x in (0.37, -0.37)]
    for (x, z) in seats:
        P.add(rbox((x, y0 + 0.16, z), (0.5, 0.13, 0.5), 0.05, "matte", CLOTH, n))
        back = rbox((x, y0 + 0.5, z - 0.27), (0.5, 0.62, 0.13), 0.05, "matte", CLOTH, n).rot("x", -0.22, (x, y0 + 0.2, z - 0.27))
        P.add(back)
        if lod == 0:
            P.add(rbox((x, y0 + 0.9, z - 0.36), (0.26, 0.16, 0.1), 0.04, "matte", CLOTH, 2))
    if c.get("bench") is not None:
        zb = c["bench"]
        P.add(rbox((0, y0 + 0.16, zb), (hwc * 1.7, 0.13, 0.48), 0.05, "matte", CLOTH, n))
        P.add(rbox((0, y0 + 0.48, zb - 0.27), (hwc * 1.7, 0.56, 0.13), 0.05, "matte", CLOTH, n).rot("x", -0.22, (0, y0 + 0.2, zb - 0.27)))
    dz = c["dash"]
    P.add(rbox((0, c.get("dash_y", y0 + 0.55), dz), (hwc * 1.95, 0.24, 0.42), 0.08, "matte", DASH, n))
    if lod == 0:
        sw = torus_x(0.17, 0.018, 28, 8, "matte", grey(0.02)).rot("y", math.pi / 2).rot("x", -0.35)
        P.add(sw.move(0.37, c.get("dash_y", y0 + 0.55) + 0.2, dz - 0.28))
        P.add(rbox((0.37, c.get("dash_y", y0 + 0.55) + 0.12, dz - 0.18), (0.06, 0.06, 0.2), 0.02, "matte", grey(0.02), 2))
    return P


def lining(S):
    """The inside of the body: a low-res copy of the shell moved 3.5 cm inwards and turned inside out, without the
    window faces (so the cabin is dark but you can still look through the car). Only visible from inside."""
    inner = shell(S, 1)
    keep = [i for i in range(len(inner.f)) if ROLES[inner.r[i]] != "glass"]
    P = Part()
    P.v = inner.v
    P.f = [inner.f[i] for i in keep]
    P.r = [ROLES.index("matte")] * len(keep)
    P.c = [grey(0.03)] * len(keep)
    ob = to_object("lining", P)
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.normal_update()
    for v in bm.verts:
        v.co -= v.normal * 0.035
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(ob.data)
    bm.free()
    return ob


def mirror_part(S, P, z, y, lod, col=PAINT):
    """Door mirror on both sides, attached near the A pillar at (z, y)."""
    h = S.hit("left", z, y)
    if not h:
        return
    x = h[0][0]
    n = 3 if lod == 0 else 1
    m = Part()
    m.add(rbox((x + 0.11, y + 0.07, z - 0.02), (0.14, 0.12, 0.09), 0.04, col[0], col[1], n))
    m.add(rbox((x + 0.03, y + 0.03, z), (0.07, 0.04, 0.06), 0.015, "matte", BLACK, 1))
    if lod == 0:
        m.add(rbox((x + 0.115, y + 0.07, z - 0.064), (0.11, 0.09, 0.006), 0.003, "metal", grey(0.6), 1))
    P.add(m, m.mirror_x())


def plate(S, P, plane, cu, cv, lod, w=0.52, h=0.112):
    """Uzbek number plate: white, flag on the left, dark characters."""
    patch(S, P, plane, rrect(cu, cv, w, h, 0.01), "matte", PLATE, off=0.006, rings=2)
    if lod != 0:
        return
    sgn = 1 if plane == "front" else -1  # u runs to the left of the car (x); seen from the front +x is on the right
    fx = cu - sgn * (w / 2 - 0.045)
    for i, c in enumerate((FLAG_B, FLAG_W, FLAG_G)):
        patch(S, P, plane, rrect(fx, cv + 0.026 - i * 0.017, 0.045, 0.016, 0.001, 1), "lamp", c, off=0.0085, rings=1)
    patch(S, P, plane, rrect(cu - sgn * (w / 2 - 0.1), cv, 0.004, h * 0.8, 0.001, 1), "matte", grey(0.02), off=0.0085, rings=1)
    for k in range(6):
        gx = cu - sgn * (w / 2 - 0.14 - k * 0.058)
        patch(S, P, plane, rrect(gx, cv - 0.004, 0.036, 0.062, 0.004, 1), "matte", grey(0.02), off=0.0085, rings=1)


def lamp_cluster(S, P, plane, outline, housing, inner=None, inner_col=None, extra=(), lod=0):
    patch(S, P, plane, outline, housing[0], housing[1], off=0.005, rings=3, mirror=True)
    if lod != 0:
        return
    if inner:
        patch(S, P, plane, inner, "lamp", inner_col, off=0.009, rings=2, mirror=True)
    for (ol, col) in extra:
        patch(S, P, plane, ol, "lamp", col, off=0.009, rings=2, mirror=True)


def exhaust(P, x, y, z, r, lod, n=24):
    n = n if lod == 0 else 8
    # profile outlet at x = 0; turning +90 deg about y sends +x to -z, so the outlet ends up at the back (z)
    pipe = lathe([(-0.14, r), (0.0, r), (0.0, r * 0.82), (-0.06, r * 0.82)], n, lambda i, k: ("metal", CHROME if i < 2 else grey(0.02)))
    P.add(pipe.rot("y", math.pi / 2).move(x, y, z))


def wipers(S, P, zc, lod):
    if lod != 0:
        return
    for x0, x1 in ((0.62, 0.06), (0.0, -0.55)):
        seam(S, P, "top", [(x0, zc), ((x0 + x1) / 2, zc - 0.012), (x1, zc - 0.03)], 0.016, "matte", grey(0.015), off=0.012)


def door_lines(S, P, zs, y0, y1, lod, slant=0.0):
    if lod != 0:
        return
    for z in zs:
        seam(S, P, "left", [(z + slant * 0, y0), (z + slant * 0.5, (y0 + y1) / 2), (z + slant, y1)], 0.005, mirror=True)


def handles(S, P, zs, y, lod, col=None):
    if lod != 0:
        return
    for z in zs:
        patch(S, P, "left", rrect(z, y, 0.15, 0.032, 0.012, 3), *(col or ("metal", CHROME)), off=0.002, rings=2, lift=0.012, mirror=True)


# ------------------------------------------------------------------------------------------------ cars

def sedan():
    W = dict(front=(0.5, 1.03), rear=(-1.42, -0.88), side=[(-0.02, 0.88), (-0.82, -0.1)], black=[(-0.1, -0.02)])
    S = dict(
        name="sedan", z=(-2.17, 2.18), track=0.78, wb=2.7, round=(0.09, 0.13), smin=0.7,
        hw=[(-2.17, 0.8), (-2.02, 0.895), (-1.75, 0.92), (-1.35, 0.925), (1.35, 0.925), (1.8, 0.905), (2.05, 0.86), (2.18, 0.76)],
        yb=[(-2.17, 0.36), (-1.95, 0.27), (-1.6, 0.235), (1.55, 0.235), (1.95, 0.25), (2.18, 0.31)],
        ys=[(-2.17, 0.88), (-2.06, 0.95), (-1.5, 0.97), (-0.5, 0.95), (0.9, 0.93), (1.5, 0.87), (2.0, 0.78), (2.18, 0.66)],
        yt=[(-2.17, 0.93), (-2.08, 1.0), (-1.8, 1.025), (-1.44, 1.04), (-0.86, 1.38), (-0.5, 1.435), (0.15, 1.445), (0.48, 1.405),
            (1.05, 1.0), (1.4, 0.94), (1.85, 0.86), (2.1, 0.76), (2.18, 0.68)],
        rw=[(-1.5, 0.66), (-0.8, 0.7), (0.4, 0.71), (1.1, 0.74)],
        cuts=[0.5, 1.03, -1.42, -0.88, -0.02, 0.88, -0.82, -0.1],
        arches=[(1.35, 0.375), (-1.35, 0.375)],
        wheel=dict(r=0.33, w=0.205, rim=0.62, style="alloy5", spokes=5, color=ALU),
        cabin=dict(z0=-1.2, z1=1.0, floor=0.3, roof=1.38, hw=0.78, seat_z=0.05, bench=-0.85, dash=0.82, dash_y=0.82),
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        lamp_cluster(Sf, P, "front", smooth_outline([(0.38, 0.635), (0.84, 0.66), (0.92, 0.72), (0.88, 0.775), (0.43, 0.75)], 1),
                     ("metal", DARKCHROME), smooth_outline([(0.44, 0.735), (0.86, 0.755), (0.88, 0.765), (0.45, 0.748)], 1), DRL,
                     [(circle(0.55, 0.69, 0.04, 16), HEAD), (circle(0.71, 0.7, 0.04, 16), HEAD)], lod)
        patch(Sf, P, "front", smooth_outline([(-0.38, 0.52), (0.38, 0.52), (0.42, 0.66), (-0.42, 0.66)], 1), "matte", BLACK, off=0.005, rings=3)
        if lod == 0:
            for k in range(3):
                yv = 0.56 + k * 0.035
                patch(Sf, P, "front", rrect(0, yv, 0.78, 0.009, 0.004, 1), "metal", CHROME, off=0.009, rings=1)
            patch(Sf, P, "front", rrect(0, 0.62, 0.11, 0.05, 0.02, 3), "metal", CHROME, off=0.012, rings=2)
        patch(Sf, P, "front", smooth_outline([(-0.62, 0.32), (0.62, 0.32), (0.66, 0.4), (-0.66, 0.4)], 1), "matte", BLACK, off=0.005, rings=2)
        patch(Sf, P, "front", circle(0.72, 0.37, 0.035, 14), "lamp", grey(0.55), off=0.008, rings=2, mirror=True)
        plate(Sf, P, "front", 0.0, 0.455, lod)
        # rear
        lamp_cluster(Sf, P, "rear", smooth_outline([(0.4, 0.66), (0.92, 0.66), (0.96, 0.8), (0.9, 0.9), (0.46, 0.87)], 1),
                     ("lamp", TAIL), smooth_outline([(0.47, 0.8), (0.9, 0.8), (0.91, 0.83), (0.48, 0.835)], 1), TAILHI,
                     [(rrect(0.58, 0.705, 0.14, 0.045, 0.012, 2), REVERSE), (rrect(0.82, 0.705, 0.12, 0.045, 0.012, 2), AMBER)], lod)
        patch(Sf, P, "left", smooth_outline([(-2.16, 0.68), (-1.98, 0.74), (-1.97, 0.86), (-2.14, 0.88)], 1), "lamp", TAIL, off=0.005, rings=2, mirror=True)
        plate(Sf, P, "rear", 0.0, 0.56, lod)
        if lod == 0:
            patch(Sf, P, "rear", rrect(0, 0.79, 0.8, 0.014, 0.006, 1), "metal", CHROME, off=0.007, rings=1)
        patch(Sf, P, "rear", smooth_outline([(-0.8, 0.3), (0.8, 0.3), (0.82, 0.38), (-0.82, 0.38)], 1), "matte", BLACK, off=0.005, rings=2)
        exhaust(P, 0.5, 0.3, -2.12, 0.035, lod)
        # sides
        door_lines(Sf, P, (0.9, -0.06, -0.86), 0.3, 0.93, lod)
        handles(Sf, P, (0.1, -0.82), 0.86, lod)
        patch(Sf, P, "left", rrect(1.62, 0.8, 0.08, 0.025, 0.01, 2), "lamp", AMBER, off=0.006, rings=1, mirror=True)
        if lod == 0:
            seam(Sf, P, "top", [(x, 1.06) for x in (-0.6, -0.3, 0.0, 0.3, 0.6)], 0.07, "matte", grey(0.02), off=0.006)
            seam(Sf, P, "top", [(x, 1.98) for x in (-0.7, -0.35, 0.0, 0.35, 0.7)], 0.005, off=0.003)
            seam(Sf, P, "top", [(x, -1.5) for x in (-0.75, -0.4, 0.0, 0.4, 0.75)], 0.005, off=0.003)
        wipers(Sf, P, 1.09, lod)
        mirror_part(Sf, P, 0.86, 0.95, lod)

    S["details"] = details
    return S


def krossover():
    W = dict(front=(0.78, 1.31), rear=(-2.2, -1.98), side=[(0.0, 1.12), (-1.0, -0.08), (-1.85, -1.08)], black=[(-0.08, 0.0), (-1.08, -1.0)],
             clad=0.52, belt=False, pillar=2)
    S = dict(
        name="krossover", z=(-2.27, 2.28), track=0.82, wb=2.8,
        hw=[(-2.27, 0.84), (-2.12, 0.94), (-1.85, 0.97), (1.7, 0.97), (2.05, 0.94), (2.28, 0.84)],
        yb=[(-2.27, 0.46), (-2.0, 0.39), (-1.7, 0.35), (1.7, 0.35), (2.0, 0.39), (2.28, 0.46)],
        ys=[(-2.27, 1.02), (-2.1, 1.12), (-1.0, 1.13), (0.8, 1.11), (1.4, 1.07), (2.0, 0.99), (2.28, 0.86)],
        yt=[(-2.27, 1.07), (-2.23, 1.38), (-2.12, 1.66), (-1.95, 1.78), (-1.6, 1.81), (0.3, 1.82), (0.78, 1.75), (1.33, 1.17),
            (1.75, 1.11), (2.12, 1.01), (2.28, 0.88)],
        rw=[(-2.2, 0.72), (-1.6, 0.8), (0.6, 0.8), (1.2, 0.84)],
        cuts=[0.78, 1.31, -2.2, -1.98, 0.0, 1.12, -1.0, -0.08, -1.85, -1.08],
        arches=[(1.4, 0.43), (-1.4, 0.43)],
        wheel=dict(r=0.38, w=0.235, rim=0.6, style="alloy", spokes=6, sw=(0.05, 0.034), color=grey(0.5)),
        cabin=dict(z0=-1.95, z1=1.2, floor=0.45, roof=1.76, hw=0.82, seat_z=0.25, bench=-0.85, dash=1.02, dash_y=1.0),
        shoulder=0.95, round=(0.1, 0.16),
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        lamp_cluster(Sf, P, "front", smooth_outline([(0.5, 0.86), (0.88, 0.875), (0.93, 0.94), (0.55, 0.95)], 1),
                     ("metal", DARKCHROME), smooth_outline([(0.52, 0.925), (0.9, 0.925), (0.91, 0.935), (0.53, 0.94)], 1), DRL,
                     [(rrect(0.7, 0.895, 0.22, 0.04, 0.015, 2), HEAD)], lod)
        patch(Sf, P, "front", smooth_outline([(-0.48, 0.6), (0.48, 0.6), (0.5, 0.87), (-0.5, 0.87)], 1), "matte", BLACK, off=0.005, rings=3)
        if lod == 0:
            for k in range(5):
                patch(Sf, P, "front", rrect(0, 0.64 + k * 0.05, 0.94, 0.01, 0.005, 1), "metal", DARKCHROME, off=0.009, rings=1)
            patch(Sf, P, "front", rrect(0, 0.79, 0.14, 0.06, 0.025, 3), "metal", CHROME, off=0.012, rings=2)
        patch(Sf, P, "front", smooth_outline([(-0.7, 0.44), (0.7, 0.44), (0.72, 0.53), (-0.72, 0.53)], 1), "metal", grey(0.45), off=0.006, rings=2)
        patch(Sf, P, "front", rrect(0.8, 0.6, 0.12, 0.04, 0.015, 2), "lamp", grey(0.55), off=0.008, rings=1, mirror=True)
        plate(Sf, P, "front", 0.0, 0.56, lod)
        lamp_cluster(Sf, P, "rear", smooth_outline([(0.62, 1.05), (0.93, 1.03), (0.95, 1.3), (0.8, 1.33)], 1),
                     ("lamp", TAIL), smooth_outline([(0.7, 1.12), (0.9, 1.11), (0.91, 1.13), (0.71, 1.14)], 1), TAILHI,
                     [(rrect(0.84, 1.24, 0.05, 0.06, 0.01, 2), REVERSE)], lod)
        patch(Sf, P, "rear", smooth_outline([(-0.75, 0.45), (0.75, 0.45), (0.77, 0.55), (-0.77, 0.55)], 1), "metal", grey(0.45), off=0.006, rings=2)
        plate(Sf, P, "rear", 0.0, 0.86, lod)
        exhaust(P, 0.55, 0.42, -2.2, 0.04, lod)
        door_lines(Sf, P, (1.12, 0.0, -1.0), 0.55, 1.12, lod)
        handles(Sf, P, (0.2, -0.82), 1.05, lod)
        # fender flares
        for (z, r) in Sf_arches(S):
            ol = [(z + (r + 0.075) * math.cos(a), S["wheel"]["r"] + 0.012 + (r + 0.075) * math.sin(a)) for a in [math.pi * k / 16 for k in range(17)]]
            ol += [(z + (r + 0.005) * math.cos(a), S["wheel"]["r"] + 0.012 + (r + 0.005) * math.sin(a)) for a in [math.pi * (16 - k) / 16 for k in range(17)]]
            patch(Sf, P, "left", ol, "matte", CLAD, off=0.006, rings=1, lift=0.012, mirror=True)
        if lod == 0:
            seam(Sf, P, "top", [(x, 1.36) for x in (-0.7, -0.35, 0.0, 0.35, 0.7)], 0.07, "matte", grey(0.02), off=0.006)
            seam(Sf, P, "top", [(x, 2.08) for x in (-0.75, -0.4, 0.0, 0.4, 0.75)], 0.005, off=0.003)
        # roof rails
        for x in (0.62, -0.62):
            ya = Sf.point("top", x, -1.3)
            yf = Sf.point("top", x, 0.4)
            if ya and yf:
                y = max(ya[1], yf[1]) + 0.05
                P.add(rbox((x, y, -0.45), (0.045, 0.03, 1.75), 0.012, "metal", grey(0.55), 2 if lod == 0 else 1))
                for zz in (-1.3, 0.4):
                    P.add(rbox((x, y - 0.03, zz), (0.045, 0.07, 0.08), 0.012, "matte", BLACK, 1))
        wipers(Sf, P, 1.38, lod)
        mirror_part(Sf, P, 1.1, 1.14, lod)

    S["details"] = details
    return S


def Sf_arches(S):
    return S["arches"]


def sport():
    W = dict(front=(0.33, 0.95), rear=(-1.32, -0.55), side=[(-0.62, 0.85)], belt=False, pillar=2)
    S = dict(
        name="sport", z=(-2.2, 2.2), track=0.82, wb=2.6,
        hw=[(-2.2, 0.86), (-1.95, 0.955), (-1.35, 0.98), (-0.5, 0.93), (0.6, 0.93), (1.3, 0.955), (1.9, 0.925), (2.2, 0.8)],
        yb=[(-2.2, 0.3), (-1.85, 0.22), (-1.5, 0.19), (1.5, 0.18), (1.95, 0.19), (2.2, 0.22)],
        ys=[(-2.2, 0.8), (-2.02, 0.95), (-1.45, 0.98), (-0.65, 0.9), (0.6, 0.86), (1.3, 0.8), (1.9, 0.66), (2.2, 0.5)],
        yt=[(-2.2, 0.84), (-2.08, 0.99), (-1.85, 1.01), (-1.34, 1.035), (-0.55, 1.275), (-0.2, 1.31), (0.2, 1.3), (0.95, 0.94),
            (1.35, 0.85), (1.9, 0.69), (2.2, 0.52)],
        rw=[(-1.4, 0.6), (-0.6, 0.6), (0.3, 0.62), (0.9, 0.7)],
        cuts=[0.33, 0.95, -1.32, -0.55, -0.62, 0.85],
        arches=[(1.3, 0.385), (-1.3, 0.385)],
        wheel=dict(r=0.34, w=0.265, rim=0.7, style="twin", spokes=5, color=GUNMETAL, cap=grey(0.03)),
        cabin=dict(z0=-0.85, z1=0.85, floor=0.24, roof=1.24, hw=0.76, seat_z=-0.25, bench=None, dash=0.62, dash_y=0.72),
        crown=0.04, shoulder=0.96, waist=0.36, round=(0.12, 0.16), smin=0.55,
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        lamp_cluster(Sf, P, "front", smooth_outline([(0.42, 0.56), (0.83, 0.61), (0.9, 0.655), (0.5, 0.64)], 1),
                     ("metal", grey(0.05)), smooth_outline([(0.47, 0.6), (0.84, 0.63), (0.86, 0.642), (0.48, 0.615)], 1), DRL,
                     [(circle(0.62, 0.605, 0.022, 12), HEAD), (circle(0.71, 0.615, 0.022, 12), HEAD)], lod)
        patch(Sf, P, "front", smooth_outline([(-0.5, 0.25), (0.5, 0.25), (0.42, 0.44), (-0.42, 0.44)], 1), "matte", BLACK, off=0.005, rings=3)
        patch(Sf, P, "front", smooth_outline([(0.55, 0.24), (0.82, 0.24), (0.78, 0.43), (0.6, 0.45)], 1), "matte", BLACK, off=0.005, rings=2, mirror=True)
        plate(Sf, P, "front", 0.0, 0.34, lod, w=0.46, h=0.1)
        if lod == 0:
            patch(Sf, P, "front", rrect(0, 0.5, 0.09, 0.04, 0.015, 3), "metal", CHROME, off=0.008, rings=2)
        # splitter
        P.add(rbox((0, 0.17, 2.1), (1.7, 0.03, 0.22), 0.012, "matte", BLACK, 2 if lod == 0 else 1))
        # rear: full width light bar
        lamp_cluster(Sf, P, "rear", smooth_outline([(0.25, 0.86), (0.9, 0.86), (0.92, 0.92), (0.28, 0.92)], 1),
                     ("lamp", TAIL), smooth_outline([(0.3, 0.885), (0.88, 0.885), (0.88, 0.897), (0.3, 0.897)], 1), TAILHI, (), lod)
        patch(Sf, P, "rear", rrect(0, 0.89, 0.5, 0.03, 0.01, 2), "lamp", TAIL, off=0.005, rings=1)
        patch(Sf, P, "rear", smooth_outline([(-0.82, 0.24), (0.82, 0.24), (0.86, 0.42), (-0.86, 0.42)], 1), "matte", BLACK, off=0.005, rings=2)
        plate(Sf, P, "rear", 0.0, 0.62, lod, w=0.46, h=0.1)
        for x in (0.42, 0.56):
            exhaust(P, x, 0.3, -2.15, 0.045, lod)
            exhaust(P, -x, 0.3, -2.15, 0.045, lod)
        if lod == 0:
            for x in (-0.5, -0.25, 0.0, 0.25, 0.5):
                P.add(rbox((x, 0.27, -2.05), (0.012, 0.1, 0.3), 0.004, "matte", BLACK, 1))
        # rear wing
        n = 3 if lod == 0 else 1
        P.add(rbox((0, 1.16, -1.98), (1.66, 0.035, 0.3), 0.015, "paint", WHITE, n).rot("x", 0.06, (0, 1.16, -1.98)))
        for x in (0.55, -0.55):
            P.add(rbox((x, 1.07, -1.95), (0.03, 0.15, 0.12), 0.01, "matte", BLACK, 1))
        # side intakes and skirts
        patch(Sf, P, "left", smooth_outline([(-0.78, 0.45), (-0.78, 0.7), (-0.55, 0.62), (-0.5, 0.45)], 1), "matte", BLACK, off=0.005, rings=2, mirror=True)
        patch(Sf, P, "left", smooth_outline([(-0.95, 0.2), (0.95, 0.2), (0.95, 0.29), (-0.95, 0.27)], 1), "matte", BLACK, off=0.005, rings=1, mirror=True)
        door_lines(Sf, P, (0.86, -0.64), 0.3, 0.86, lod)
        if lod == 0:
            seam(Sf, P, "top", [(x, 0.99) for x in (-0.55, -0.25, 0.0, 0.25, 0.55)], 0.06, "matte", grey(0.02), off=0.006)
            seam(Sf, P, "top", [(x, 1.95) for x in (-0.7, -0.35, 0.0, 0.35, 0.7)], 0.005, off=0.003)
            for x in (0.18, -0.18):
                patch(Sf, P, "top", rrect(x, 1.45, 0.09, 0.32, 0.03, 3), "matte", BLACK, off=0.004, rings=2)
        wipers(Sf, P, 1.0, lod)
        mirror_part(Sf, P, 0.78, 0.88, lod)

    S["details"] = details
    return S


def van():
    W = dict(front=(1.62, 2.12), side=[(1.22, 1.98), (0.25, 1.12), (-0.85, 0.15), (-2.3, -0.95)], black=[(1.12, 1.22), (0.15, 0.25), (-0.95, -0.85)],
             rear=None, clad=0.5, belt=False, pillar=2)
    S = dict(
        name="van", z=(-2.55, 2.55), track=0.85, wb=3.2,
        hw=[(-2.55, 0.92), (-2.45, 0.97), (2.2, 0.97), (2.45, 0.93), (2.55, 0.84)],
        yb=[(-2.55, 0.42), (-2.3, 0.38), (2.2, 0.38), (2.55, 0.44)],
        ys=[(-2.55, 1.2), (-2.4, 1.22), (1.6, 1.2), (2.15, 1.12), (2.55, 0.92)],
        yt=[(-2.55, 2.0), (-2.45, 2.1), (1.25, 2.12), (1.6, 2.02), (2.13, 1.22), (2.42, 1.07), (2.55, 0.94)],
        rw=[(-2.5, 0.9), (1.4, 0.9), (2.0, 0.92)],
        cuts=[1.62, 2.12, 1.22, 1.98, 0.25, 1.12, -0.85, 0.15, -2.3, -0.95, 1.12, 0.15, -0.95],
        arches=[(1.6, 0.41), (-1.6, 0.41)],
        wheel=dict(r=0.36, w=0.215, rim=0.56, style="steel", color=STEEL, nuts=5),
        cabin=dict(z0=-2.3, z1=1.95, floor=0.5, roof=2.02, hw=0.86, seat_z=1.05, bench=-0.2, dash=1.75, dash_y=1.05),
        crown=0.04, bulge=0.008, roofround=3.5, round=(0.08, 0.14), smin=0.7,
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        lamp_cluster(Sf, P, "front", smooth_outline([(0.55, 0.88), (0.9, 0.86), (0.93, 1.0), (0.6, 1.02)], 1),
                     ("metal", DARKCHROME), None, None, [(rrect(0.74, 0.94, 0.2, 0.08, 0.02, 2), HEAD)], lod)
        patch(Sf, P, "front", smooth_outline([(-0.5, 0.72), (0.5, 0.72), (0.52, 0.98), (-0.52, 0.98)], 1), "matte", BLACK, off=0.005, rings=3)
        patch(Sf, P, "front", smooth_outline([(-0.9, 0.42), (0.9, 0.42), (0.92, 0.6), (-0.92, 0.6)], 1), "matte", CLAD, off=0.006, rings=2)
        plate(Sf, P, "front", 0.0, 0.66, lod)
        for x in (0.75, -0.75):
            pass
        # rear: doors with windows, lamps up the pillars
        patch(Sf, P, "rear", rrect(0.43, 1.62, 0.72, 0.5, 0.05, 3), "glass", GLASS, off=0.005, rings=2)
        patch(Sf, P, "rear", rrect(-0.43, 1.62, 0.72, 0.5, 0.05, 3), "glass", GLASS, off=0.005, rings=2)
        patch(Sf, P, "rear", rrect(0.88, 0.95, 0.1, 0.42, 0.02, 2), "lamp", TAIL, off=0.006, rings=2, mirror=True)
        if lod == 0:
            seam(Sf, P, "rear", [(0.0, 0.45), (0.0, 1.2), (0.0, 2.0)], 0.006)
            patch(Sf, P, "rear", rrect(0.88, 1.08, 0.08, 0.08, 0.01, 2), "lamp", AMBER, off=0.009, rings=1, mirror=True)
            patch(Sf, P, "rear", rrect(0.2, 1.2, 0.16, 0.03, 0.01, 2), "metal", CHROME, off=0.006, rings=1, lift=0.012)
        patch(Sf, P, "rear", smooth_outline([(-0.94, 0.42), (0.94, 0.42), (0.95, 0.58), (-0.95, 0.58)], 1), "matte", CLAD, off=0.006, rings=2)
        plate(Sf, P, "rear", 0.0, 0.72, lod)
        door_lines(Sf, P, (1.98, 1.15, 0.2), 0.5, 1.2, lod)
        handles(Sf, P, (1.3,), 1.1, lod, ("matte", BLACK))
        wipers(Sf, P, 1.68, lod)
        mirror_part(Sf, P, 1.95, 1.25, lod, ("matte", BLACK))

    S["details"] = details
    return S


def truck():
    """Cab-over light truck: cab shell (tinted) + box body (white) + chassis + dual rear wheels."""
    W = dict(front=None, side=[(3.25, 3.95)], black=[], belt=False, clad=0.75, pillar=1)
    S = dict(
        name="truck", z=(1.95, 4.12), track=1.0, wb=5.2,
        hw=[(1.95, 1.18), (2.1, 1.2), (3.9, 1.2), (4.12, 1.1)],
        yb=[(1.95, 0.62), (4.12, 0.58)],
        ys=[(1.95, 1.62), (3.9, 1.62), (4.12, 1.55)],
        yt=[(1.95, 2.7), (2.2, 2.75), (3.75, 2.75), (3.98, 2.6), (4.12, 1.75)],
        rw=[(2.0, 1.12), (3.8, 1.12)],
        cuts=[3.25, 3.95],
        arches=[(2.9, 0.56)],
        wheel=dict(r=0.5, w=0.3, rim=0.52, style="steel", color=grey(0.7), nuts=8, hub=0.11),
        crown=0.03, bulge=0.004, roofround=4.0, round=(0.04, 0.1), smin=0.8,
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        n = 3 if lod == 0 else 1
        patch(Sf, P, "front", rrect(0, 2.08, 2.1, 0.78, 0.06, 3), "glass", GLASS, off=0.006, rings=2)
        patch(Sf, P, "front", rrect(0, 1.38, 1.5, 0.32, 0.04, 2), "matte", BLACK, off=0.006, rings=2)
        if lod == 0:
            for k in range(4):
                patch(Sf, P, "front", rrect(0, 1.27 + k * 0.075, 1.42, 0.015, 0.006, 1), "metal", DARKCHROME, off=0.01, rings=1)
        patch(Sf, P, "front", rrect(0.88, 1.0, 0.3, 0.14, 0.03, 2), "lamp", HEAD, off=0.008, rings=2, mirror=True)
        patch(Sf, P, "front", rrect(0.88, 1.13, 0.3, 0.05, 0.01, 1), "lamp", AMBER, off=0.008, rings=1, mirror=True)
        P.add(rbox((0, 0.72, 4.12), (2.4, 0.3, 0.16), 0.04, "matte", grey(0.08), n))
        plate(Sf, P, "front", 0.0, 0.72, lod)
        handles(Sf, P, (3.4,), 1.55, lod, ("matte", BLACK))
        door_lines(Sf, P, (3.2, 3.98), 0.7, 1.62, lod)
        if lod == 0:
            for side in (1, -1):
                P.add(rbox((side * 1.32, 2.1, 3.9), (0.05, 0.36, 0.14), 0.02, "matte", BLACK, 2))
                P.add(rbox((side * 1.25, 2.3, 3.92), (0.16, 0.03, 0.03), 0.01, "matte", BLACK, 1))
        # box body
        bx = Part()
        bx.add(rbox((0, 2.34, -1.3), (2.46, 2.7, 6.1), 0.05, "matte", grey(0.78), n, flat=6 if lod == 0 else 1))
        if lod == 0:
            for k in range(18):
                z = -4.2 + k * (5.8 / 17)
                for side in (1, -1):
                    bx.add(rbox((side * 1.235, 2.34, z), (0.02, 2.6, 0.05), 0.008, "matte", grey(0.72), 1))
            bx.add(rbox((0, 2.34, -4.36), (2.3, 2.5, 0.02), 0.008, "matte", grey(0.7), 1))
            bx.add(rbox((0, 2.34, -4.38), (0.012, 2.5, 0.02), 0.004, "matte", grey(0.1), 1))
            for x in (0.35, -0.35):
                bx.add(rbox((x, 1.9, -4.39), (0.03, 1.4, 0.03), 0.01, "metal", STEEL, 1))
        P.add(bx)
        # chassis, tank, guards, bumper, rear lamps
        P.add(rbox((0.45, 0.72, -0.6), (0.12, 0.22, 7.4), 0.02, "matte", grey(0.03), 1), rbox((-0.45, 0.72, -0.6), (0.12, 0.22, 7.4), 0.02, "matte", grey(0.03), 1))
        P.add(along_z(cylinder_x(-0.6, 0.6, 0.24, 20 if lod == 0 else 8, "metal", grey(0.6))).move(1.0, 0.72, 0.8))
        for side in (1, -1):
            P.add(rbox((side * 1.12, 0.62, -0.75), (0.04, 0.18, 2.3), 0.01, "matte", grey(0.5), 1))
            P.add(rbox((side * 1.0, 0.45, -3.0), (0.4, 0.5, 0.02), 0.005, "matte", grey(0.02), 1))
            P.add(rbox((side * 0.92, 0.82, -4.42), (0.34, 0.16, 0.04), 0.01, "lamp", TAIL, 1))
            if lod == 0:
                P.add(rbox((side * 0.62, 0.82, -4.42), (0.12, 0.12, 0.04), 0.01, "lamp", AMBER, 1))
        P.add(rbox((0, 0.68, -4.4), (2.3, 0.14, 0.12), 0.02, "matte", grey(0.03), 1))
        P.add(rbox((0, 0.52, -4.44), (0.5, 0.11, 0.02), 0.004, "matte", PLATE, 1))

    S["details"] = details
    S["extra_wheels"] = [(2.9, False), (-2.3, True)]
    return S


def boron():
    """'Bo\'ron': mid-engine V12-style supercar (Italian GT proportions, our own design, no badges): cab-forward,
    short nose, long engine deck, deep side intakes, twin round tail lamps, centre exhausts, big diffuser."""
    W = dict(front=(0.42, 0.95), rear=(-1.05, -0.62), side=[(-0.55, 0.84)], belt=False, pillar=2)
    S = dict(
        name="boron", z=(-2.3, 2.3), track=0.84, wb=2.66, preview="#c1121f",
        hw=[(-2.3, 0.86), (-2.08, 0.975), (-1.35, 1.0), (-0.65, 0.93), (0.55, 0.935), (1.33, 0.975), (1.92, 0.94), (2.3, 0.74)],
        yb=[(-2.3, 0.3), (-2.05, 0.17), (-1.6, 0.14), (1.6, 0.13), (2.05, 0.15), (2.3, 0.2)],
        ys=[(-2.3, 0.74), (-2.12, 0.9), (-1.45, 0.96), (-0.75, 0.86), (0.55, 0.8), (1.3, 0.77), (1.9, 0.66), (2.3, 0.44)],
        yt=[(-2.3, 0.77), (-2.2, 0.95), (-1.95, 1.0), (-1.2, 1.02), (-0.62, 1.155), (-0.2, 1.2), (0.2, 1.19), (0.96, 0.87),
            (1.4, 0.8), (1.95, 0.66), (2.3, 0.46)],
        rw=[(-1.3, 0.56), (-0.6, 0.58), (0.3, 0.6), (0.95, 0.7)],
        cuts=[0.42, 0.95, -1.05, -0.62, -0.55, 0.84],
        arches=[(1.33, 0.39), (-1.33, 0.4)],
        wheel=dict(r=0.35, w=0.285, rim=0.72, style="twin", spokes=5, color=grey(0.06), cap=grey(0.02)),
        cabin=dict(z0=-0.7, z1=0.85, floor=0.2, roof=1.14, hw=0.78, seat_z=-0.2, bench=None, dash=0.62, dash_y=0.66),
        crown=0.035, shoulder=0.965, waist=0.34, round=(0.12, 0.16), smin=0.5, bulge=0.012,
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        n = 3 if lod == 0 else 1
        # slim swept headlamps with an LED blade and two projector dots
        lamp_cluster(Sf, P, "front", smooth_outline([(0.46, 0.555), (0.86, 0.6), (0.94, 0.65), (0.88, 0.66), (0.52, 0.605)], 1),
                     ("metal", grey(0.04)), smooth_outline([(0.5, 0.6), (0.88, 0.642), (0.9, 0.652), (0.51, 0.612)], 1), DRL,
                     [(circle(0.66, 0.6, 0.02, 12), HEAD), (circle(0.75, 0.613, 0.02, 12), HEAD)], lod)
        # wide grille mouth, two side mouths, splitter
        patch(Sf, P, "front", smooth_outline([(-0.55, 0.2), (0.55, 0.2), (0.48, 0.38), (-0.48, 0.38)], 2), "matte", grey(0.012), off=0.005, rings=3)
        patch(Sf, P, "front", smooth_outline([(0.58, 0.19), (0.88, 0.2), (0.82, 0.4), (0.62, 0.42)], 2), "matte", grey(0.012), off=0.005, rings=2, mirror=True)
        if lod == 0:
            for k in range(4):
                patch(Sf, P, "front", rrect(0, 0.235 + k * 0.035, 0.98, 0.008, 0.004, 1), "metal", grey(0.2), off=0.009, rings=1)
        P.add(rbox((0, 0.13, 2.08), (1.55, 0.022, 0.2), 0.01, "matte", grey(0.02), n))
        plate(Sf, P, "front", 0.0, 0.3, lod, w=0.46, h=0.1)
        # hood vents and the roof/engine glass louvres
        if lod == 0:
            for x in (0.3, -0.3):
                patch(Sf, P, "top", smooth_outline([(x - 0.12, 1.55), (x + 0.12, 1.55), (x + 0.1, 1.85), (x - 0.1, 1.85)], 1), "matte", grey(0.015), off=0.004, rings=2)
            for k in range(5):
                seam(Sf, P, "top", [(-0.42, -1.12 - k * 0.11), (0.0, -1.12 - k * 0.11), (0.42, -1.12 - k * 0.11)], 0.035, "matte", grey(0.015), off=0.006)
        # deep side intakes behind the doors, skirts
        patch(Sf, P, "left", smooth_outline([(-0.62, 0.42), (-0.6, 0.76), (-1.05, 0.66), (-1.12, 0.42)], 2), "matte", grey(0.01), off=0.004, rings=3, mirror=True)
        patch(Sf, P, "left", smooth_outline([(-1.0, 0.15), (1.0, 0.14), (1.0, 0.24), (-1.0, 0.25)], 1), "matte", grey(0.02), off=0.005, rings=1, mirror=True)
        door_lines(Sf, P, (0.86, -0.58), 0.25, 0.8, lod)
        # rear: twin round lamps per side, ducktail, diffuser, centre exhausts
        for x in (0.62, 0.82):
            patch(Sf, P, "rear", circle(x, 0.79, 0.075, 20), "metal", grey(0.05), off=0.005, rings=2, mirror=True)
            if lod == 0:
                patch(Sf, P, "rear", circle(x, 0.79, 0.06, 20), "lamp", TAIL, off=0.009, rings=2, mirror=True)
                patch(Sf, P, "rear", circle(x, 0.79, 0.03, 16), "lamp", TAILHI, off=0.012, rings=1, mirror=True)
            else:
                patch(Sf, P, "rear", circle(x, 0.79, 0.06, 10), "lamp", TAILHI, off=0.009, rings=1, mirror=True)
        patch(Sf, P, "rear", smooth_outline([(-0.95, 0.18), (0.95, 0.18), (0.9, 0.46), (-0.9, 0.46)], 2), "matte", grey(0.012), off=0.005, rings=3)
        if lod == 0:
            for x in (-0.6, -0.3, 0.3, 0.6):
                P.add(rbox((x, 0.3, -2.1), (0.012, 0.11, 0.3), 0.004, "matte", grey(0.03), 1))
            patch(Sf, P, "rear", rrect(0, 0.58, 0.3, 0.06, 0.02, 2), "matte", grey(0.02), off=0.006, rings=1)
        plate(Sf, P, "rear", 0.0, 0.58, lod, w=0.46, h=0.1)
        for x in (0.12, -0.12):
            exhaust(P, x, 0.33, -2.24, 0.045, lod)
        P.add(rbox((0, 0.985, -2.18), (1.5, 0.02, 0.12), 0.008, "paint", WHITE, n))
        if lod == 0:
            seam(Sf, P, "top", [(x, 0.99) for x in (-0.5, -0.25, 0.0, 0.25, 0.5)], 0.05, "matte", grey(0.02), off=0.006)
        wipers(Sf, P, 1.0, lod)
        mirror_part(Sf, P, 0.78, 0.83, lod)

    S["details"] = details
    return S


def chaqmoq():
    """'Chaqmoq': wedge hypercar (V10/V12 'raging bull' school, our own design): very low and wide, sharp creases,
    hexagonal intakes, Y-shaped lamps, roof scoop, big fixed wing, centre exhaust."""
    W = dict(front=(0.3, 1.02), rear=None, side=[(-0.45, 0.9)], belt=False, pillar=2)
    S = dict(
        name="chaqmoq", z=(-2.35, 2.35), track=0.86, wb=2.7, preview="#e8b400",
        hw=[(-2.35, 0.9), (-2.1, 1.0), (-1.4, 1.02), (-0.6, 0.95), (0.6, 0.95), (1.35, 0.99), (2.0, 0.95), (2.35, 0.7)],
        yb=[(-2.35, 0.26), (-2.1, 0.15), (1.8, 0.12), (2.35, 0.17)],
        ys=[(-2.35, 0.8), (-2.15, 0.93), (-1.45, 0.94), (-0.6, 0.83), (0.6, 0.76), (1.35, 0.7), (2.0, 0.55), (2.35, 0.36)],
        yt=[(-2.35, 0.83), (-2.2, 0.96), (-1.6, 0.99), (-0.75, 1.06), (-0.3, 1.13), (0.2, 1.12), (1.02, 0.79), (1.6, 0.65),
            (2.1, 0.5), (2.35, 0.38)],
        rw=[(-1.4, 0.5), (-0.5, 0.56), (0.3, 0.58), (1.0, 0.66)],
        cuts=[0.3, 1.02, -0.45, 0.9],
        arches=[(1.35, 0.39), (-1.35, 0.4)],
        wheel=dict(r=0.35, w=0.295, rim=0.73, style="alloy", spokes=10, sw=(0.03, 0.022), color=grey(0.04), cap=grey(0.02)),
        cabin=dict(z0=-0.6, z1=0.9, floor=0.18, roof=1.07, hw=0.76, seat_z=-0.15, bench=None, dash=0.66, dash_y=0.62),
        crown=0.025, shoulder=0.97, waist=0.3, round=(0.1, 0.12), smin=0.5, bulge=0.004, roofround=4.0,
        role=window_roles(W),
    )

    def details(Sf, P, lod):
        n = 3 if lod == 0 else 1
        # Y lamps: thin LED strokes in a black housing
        lamp_cluster(Sf, P, "front", [(0.42, 0.47), (0.9, 0.52), (0.96, 0.56), (0.5, 0.53)], ("metal", grey(0.03)),
                     [(0.47, 0.505), (0.9, 0.538), (0.91, 0.546), (0.48, 0.513)], DRL, [([(0.7, 0.52), (0.78, 0.48), (0.8, 0.49), (0.72, 0.53)], DRL)], lod)
        hexa = lambda cu, cv, w, h: [(cu - w / 2, cv), (cu - w / 3, cv + h / 2), (cu + w / 3, cv + h / 2), (cu + w / 2, cv), (cu + w / 3, cv - h / 2), (cu - w / 3, cv - h / 2)]
        patch(Sf, P, "front", hexa(0.68, 0.33, 0.3, 0.14), "matte", grey(0.01), off=0.005, rings=2, mirror=True)
        patch(Sf, P, "front", hexa(0.0, 0.27, 0.6, 0.1), "matte", grey(0.01), off=0.005, rings=2)
        P.add(rbox((0, 0.12, 2.12), (1.6, 0.022, 0.2), 0.01, "matte", grey(0.02), n))
        plate(Sf, P, "front", 0.0, 0.38, lod, w=0.44, h=0.1)
        if lod == 0:
            for x in (0.25, -0.25):
                patch(Sf, P, "top", hexa(x, 1.75, 0.18, 0.4), "matte", grey(0.015), off=0.004, rings=2)
            for k in range(6):
                seam(Sf, P, "top", [(-0.38, -0.85 - k * 0.14), (0.0, -0.8 - k * 0.14), (0.38, -0.85 - k * 0.14)], 0.05, "matte", grey(0.012), off=0.006)
        # huge side intakes (hexagon) in front of the rear wheels, skirt with a crease
        patch(Sf, P, "left", hexa(-0.82, 0.55, 0.62, 0.34), "matte", grey(0.008), off=0.004, rings=3, mirror=True)
        patch(Sf, P, "left", smooth_outline([(-1.0, 0.13), (1.0, 0.12), (1.0, 0.22), (-1.0, 0.24)], 1), "matte", grey(0.02), off=0.005, rings=1, mirror=True)
        door_lines(Sf, P, (0.92, -0.48), 0.22, 0.76, lod)
        # roof scoop
        P.add(rbox((0, 1.15, -0.4), (0.5, 0.06, 0.5), 0.03, "matte", grey(0.02), n))
        # rear: Y lamps, mesh panel, diffuser, centre exhaust, fixed wing
        lamp_cluster(Sf, P, "rear", [(0.45, 0.82), (0.95, 0.83), (0.97, 0.88), (0.48, 0.87)], ("lamp", TAIL),
                     [(0.5, 0.843), (0.93, 0.85), (0.94, 0.858), (0.51, 0.852)], TAILHI, [([(0.7, 0.83), (0.82, 0.76), (0.84, 0.77), (0.73, 0.84)], TAILHI)], lod)
        patch(Sf, P, "rear", smooth_outline([(-0.9, 0.5), (0.9, 0.5), (0.9, 0.78), (-0.9, 0.78)], 1), "matte", grey(0.01), off=0.005, rings=2)
        patch(Sf, P, "rear", smooth_outline([(-1.0, 0.15), (1.0, 0.15), (0.9, 0.42), (-0.9, 0.42)], 2), "matte", grey(0.012), off=0.005, rings=3)
        if lod == 0:
            for x in (-0.7, -0.45, 0.45, 0.7):
                P.add(rbox((x, 0.27, -2.14), (0.012, 0.11, 0.32), 0.004, "matte", grey(0.03), 1))
        P.add(along_z(cylinder_x(-0.1, 0.1, 0.07, 6 if lod else 6, "metal", CHROME)).rot("z", math.pi / 6).move(0, 0.4, -2.3))
        P.add(rbox((0, 1.2, -2.0), (1.85, 0.03, 0.34), 0.012, "matte", grey(0.02), n).rot("x", 0.08, (0, 1.2, -2.0)))
        for x in (0.6, -0.6):
            P.add(rbox((x, 1.06, -1.98), (0.03, 0.24, 0.16), 0.01, "matte", grey(0.02), 1))
        plate(Sf, P, "rear", 0.0, 0.62, lod, w=0.44, h=0.1)
        wipers(Sf, P, 1.06, lod)
        mirror_part(Sf, P, 0.82, 0.78, lod)

    S["details"] = details
    return S


CARS = dict(sedan=sedan, krossover=krossover, sport=sport, van=van, truck=truck, boron=boron, chaqmoq=chaqmoq)
PLAYER = ("sedan", "krossover", "sport", "boron", "chaqmoq")
TRAFFIC = ("sedan", "krossover", "van", "truck")


# ------------------------------------------------------------------------------------------------ pipeline

def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    sc = bpy.context.scene
    if sc.world is None:
        sc.world = bpy.data.worlds.new("World")
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.world.light_settings.distance = 0.7


def wheel_positions(S):
    r = S["wheel"]["r"]
    x = S["track"] + 0.03
    if S.get("extra_wheels"):
        out = []
        for z, dual in S["extra_wheels"]:
            out += [(x, r, z, False), (-x, r, z, True)]
            if dual:
                out += [(x - S["wheel"]["w"] - 0.02, r, z, False), (-(x - S["wheel"]["w"] - 0.02), r, z, True)]
        return out
    z = S["wb"] / 2
    return [(x, r, z, False), (-x, r, z, True), (x, r, -z, False), (-x, r, -z, True)]


def build(kind, lod):
    S = CARS[kind]()
    body = shell(S, lod)
    ob = to_object("body", body)
    boolean_cut(ob, arch_cutters(S, lod))
    shade(ob, 38)
    surf = Surf(ob)
    det = Part()
    S["details"](surf, det, lod)
    if surf.misses:
        print(f"[cars] {kind} lod{lod}: {surf.misses} ray misses (some details skipped)")
    det.add(interior(S, lod))
    objs = [ob]
    if S.get("cabin"):
        objs.append(lining(S))
    if det.f:
        od = to_object("details", det, merge=False)
        shade(od, 40)
        objs.append(od)
    wheel = make_wheel(S["wheel"], lod)
    wheels = []
    for (x, y, z, mir) in wheel_positions(S):
        w = wheel.mirror_x() if mir else wheel
        o = to_object("wheelpos", w.move(x, y, z))
        shade(o, 40)
        wheels.append(o)
    return S, objs, wheels, wheel


def bake_ao(objs, samples):
    sc = bpy.context.scene
    sc.cycles.samples = samples
    sc.render.bake.target = "VERTEX_COLORS"
    for ob in objs:
        me = ob.data
        if "ao" not in me.color_attributes:
            me.color_attributes.new("ao", "FLOAT_COLOR", "CORNER")
        me.color_attributes.active_color = me.color_attributes["ao"]
        for o in sc.objects:
            o.select_set(False)
        ob.select_set(True)
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.bake(type="AO")


def compose(ob, strength=0.85):
    me = ob.data
    nl = len(me.loops)
    ao = [1.0] * (nl * 4)
    if "ao" in me.color_attributes:
        me.color_attributes["ao"].data.foreach_get("color", ao)
    base = [1.0] * (len(me.polygons) * 4)
    me.attributes["base"].data.foreach_get("color", base)
    lamp = ROLES.index("lamp")
    out = [1.0] * (nl * 4)
    for p in me.polygons:
        r, g, b = base[p.index * 4:p.index * 4 + 3]
        for li in p.loop_indices:
            f = 1.0 if p.material_index == lamp else (1 - strength) + strength * ao[li * 4]
            out[li * 4:li * 4 + 4] = (r * f, g * f, b * f, 1.0)
    if "Col" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["Col"])
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    col.data.foreach_set("color", out)
    if "ao" in me.color_attributes:
        me.color_attributes.remove(me.color_attributes["ao"])
    me.color_attributes.active_color = me.color_attributes["Col"]
    me.color_attributes.render_color_index = me.color_attributes.active_color_index


def join(objs, name):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    me = ob.data
    if "base" in me.attributes:
        me.attributes.remove(me.attributes["base"])
    used = sorted(set(p.material_index for p in me.polygons))
    return ob


def export(objs, path):
    for o in bpy.context.scene.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", use_selection=True, export_yup=True, export_apply=True,
        export_texcoords=False, export_normals=True, export_vertex_color="ACTIVE", export_materials="EXPORT",
        export_cameras=False, export_lights=False, export_extras=False, export_animations=False, export_skins=False,
        export_morph=False, export_attributes=False,
    )


def ground():
    me = bpy.data.meshes.new("ground")
    s = 12
    me.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    ob = bpy.data.objects.new("ground", me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def make_player(kind, out, preview):
    reset_scene()
    S, objs, wheels, wheel = build(kind, 0)
    g = ground()
    bake_ao(objs, 48)
    for o in objs:
        compose(o)
    for o in wheels:
        bpy.data.objects.remove(o)
    g.hide_render = True
    # the exported wheel: alone (its own AO), at the origin
    wob = to_object("wheel", wheel)
    shade(wob, 40)
    for o in objs:
        o.hide_render = True
    bake_ao([wob], 32)
    compose(wob, 0.7)
    for o in objs:
        o.hide_render = False
    body = join(objs, "body")
    wob.data.attributes.remove(wob.data.attributes["base"])
    print(f"[cars] {kind}: body {tri_count(body)} tris, wheel {tri_count(wob)} tris")
    export([body, wob], os.path.join(out, f"{kind}.glb"))
    if preview:
        placed = []
        for (x, y, z, mir) in wheel_positions(S):
            o = wob.copy()
            o.data = wob.data
            bpy.context.scene.collection.objects.link(o)
            o.location = G((x, y, z))
            if mir:
                o.scale = (-1, 1, 1)
            placed.append(o)
        wob.hide_render = True
        render_preview(kind, preview, S)


def make_traffic(kind, out, preview):
    reset_scene()
    S, objs, wheels, _ = build(kind, 1)
    g = ground()
    bake_ao(objs + wheels, 24)
    for o in objs + wheels:
        compose(o)
    bpy.data.objects.remove(g)
    body = join(objs + wheels, "body")
    print(f"[cars] traffic {kind}: {tri_count(body)} tris")
    export([body], os.path.join(out, "traffic", f"{kind}.glb"))
    if preview:
        render_preview(f"traffic-{kind}", preview, S)


def render_preview(name, d, S):
    sc = bpy.context.scene
    os.makedirs(d, exist_ok=True)
    set_paint_tint(srgb(S.get("preview", "#b0121f")))
    world = sc.world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment")
    env.image = bpy.data.images.load(os.path.join(bpy.utils.system_resource("DATAFILES", path="studiolights/world"), "courtyard.exr"))
    nt.links.new(env.outputs["Color"], nt.nodes["Background"].inputs["Color"])
    nt.nodes["Background"].inputs["Strength"].default_value = 1.2
    gm = bpy.data.meshes.new("floor")
    s = 30
    gm.from_pydata([(-s, -s, 0), (s, -s, 0), (s, s, 0), (-s, s, 0)], [], [(0, 1, 2, 3)])
    fl = bpy.data.objects.new("floor", gm)
    sc.collection.objects.link(fl)
    fm = bpy.data.materials.new("floor")
    fm.use_nodes = True
    fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.08, 0.08, 0.085, 1)
    fm.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.6
    gm.materials.append(fm)
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    so = bpy.data.objects.new("sun", sun)
    so.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(so)
    cam = bpy.data.cameras.new("cam")
    cam.lens = 50
    co = bpy.data.objects.new("cam", cam)
    sc.collection.objects.link(co)
    sc.camera = co
    sc.render.resolution_x, sc.render.resolution_y = 1000, 560
    sc.cycles.samples = 48
    sc.cycles.use_denoising = True
    sc.render.image_settings.file_format = "PNG"
    L = S["z"][1] - S["z"][0]
    zc = (S["z"][1] + S["z"][0]) / 2
    for tag, (az, el, dist) in {"front": (35, 12, 2.4), "rear": (215, 14, 2.4), "side": (90, 4, 2.3)}.items():
        a = math.radians(az)
        e = math.radians(el)
        D = L * dist / 1.0
        tgt = (0, 0.7 if S["name"] != "truck" else 1.6, zc)
        pos = (tgt[0] + D * math.sin(a) * math.cos(e), tgt[1] + D * math.sin(e) + 0.2, tgt[2] + D * math.cos(a) * math.cos(e))
        co.location = G(pos)
        direction = Vector(G(tgt)) - Vector(G(pos))
        co.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(d, f"{name}-{tag}.png")
        bpy.ops.render.render(write_still=True)
    set_paint_tint((1, 1, 1))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="public/models/mashina")
    ap.add_argument("--only", default="")
    ap.add_argument("--preview", default="")
    ap.add_argument("--skip-traffic", action="store_true")
    ap.add_argument("--skip-player", action="store_true")
    a = ap.parse_args(argv)
    only = set(filter(None, a.only.split(",")))
    if not a.skip_player:
        for k in PLAYER:
            if not only or k in only:
                make_player(k, a.out, a.preview)
    if not a.skip_traffic:
        for k in TRAFFIC:
            if not only or k in only:
                make_traffic(k, a.out, a.preview)


if __name__ == "__main__" and "--street" not in sys.argv:
    main()
