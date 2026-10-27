// The world as DATA. A compact ASCII map describes which kind of tile sits where; everything else (roads, intersections,
// traffic-rule definitions, signs, lanes for the traffic AI and for the GPS) is derived from it by pure functions, so a
// bigger map (countryside, mountain serpentine, the full 4x4 km) is just more rows / more tile kinds.
//
// Coordinates: metres, x = east, z = south, y = up. Tile (c, r) covers x in [c*TILE, (c+1)*TILE], z in [r*TILE, (r+1)*TILE].
// Traffic drives on the right: facing +x the right-hand side is +z; right of direction d = (dx, dz) is (-dz, dx).

export const TILE = 120;
/** length (m) of the dead-end street stubs at the edge of the city */
export const STUB = 44;

export type TileKind = "city" | "plaza" | "highway" | "bridge" | "airfield" | "field";
export type Control = "light" | "stop" | "giveWay" | "none";
export type Dir = "n" | "e" | "s" | "w";

/** Legend of the ASCII map. '.' (or anything outside the rows) is open countryside (kind "field"). */
export const LEGEND: Record<string, TileKind> = { C: "city", P: "plaza", H: "highway", B: "bridge", A: "airfield", ".": "field" };

/** The Samarkand-inspired district (TZ 6.1, agreed reduced scope). Row = z, column = x. */
export const SAMARKAND_ROWS: string[] = [
  "PCCC.........",
  "CCCCHHBHHAA..",
  "CCCC.....AA..",
];

export const ROAD = {
  /** city lane width (prototype ROAD_W) and asphalt+shoulder half width (prototype ROAD_EDGE) */
  lane: 3.6,
  cityHalf: 3.6,
  sidewalk: 2.6,
  /** highway: 3 lanes per direction of 3.5 m, 3 m median */
  hwLane: 3.5,
  hwLanes: 3,
  hwMedian: 3,
  hwHalf: 13.5,
  stopLine: 9.5,
  zebraAt: 38,
} as const;

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
export interface RoadRect extends Rect {
  axis: "x" | "z";
  surface: "asphalt" | "concrete";
}

export interface TileSpec {
  id: string;
  c: number;
  r: number;
  kind: TileKind;
  x0: number;
  z0: number;
  cx: number;
  cz: number;
  /** road present on this side (including short dead-end stubs at the edge of the city) */
  arms: Record<Dir, boolean>;
  /** the road continues into the neighbouring tile (graph edge) */
  link: Record<Dir, boolean>;
  control: Control;
  /** light cycle offset (s) */
  offset: number;
  /** mid-block zebra: on the E-W road (axis "x") or N-S road ("z") */
  zebraAxis: "x" | "z" | null;
  seed: number;
  road: RoadRect[];
}

export interface Node {
  id: string;
  x: number;
  z: number;
  tile: string;
  control: Control;
  kind: "city" | "plaza" | "highway" | "airfield";
}
export interface Edge {
  from: string;
  to: string;
  len: number;
  dx: number;
  dz: number;
  /** lanes in the driving direction from -> to (1 in the city, 3 on the highway) */
  lanes: number;
  oneWay: boolean;
  /** both ends are highway tiles (3 lanes) */
  highway: boolean;
  /** exactly one end is a city intersection: the carriageway narrows from the highway to a city street along the edge */
  taper: boolean;
}

export type RuleDef =
  | { type: "light"; id: string; node: string; x: number; z: number; dx: number; dz: number; axis: "x" | "z"; half: number }
  | { type: "stop"; id: string; node: string; x: number; z: number; dx: number; dz: number; half: number }
  | { type: "giveWay"; id: string; node: string; x: number; z: number; dx: number; dz: number; half: number }
  | { type: "zebra"; id: string; zebra: string; x: number; z: number; dx: number; dz: number; half: number };

export interface SpeedZone extends Rect {
  id: string;
  limit: number;
  name: string;
  /** "shahar" = settlement (city), "trassa" = highway, "maydon" = drift area (no limit scoring) */
  kind: "shahar" | "trassa" | "maydon";
}
export interface OneWayZone extends Rect {
  id: string;
  dx: number;
  dz: number;
}
export interface NoStopZone extends Rect {
  id: string;
}
export interface Zebra {
  id: string;
  /** centre of the crossing (on the road centreline) */
  x: number;
  z: number;
  /** road axis the zebra lies on */
  axis: "x" | "z";
  tile: string;
}
export interface Light {
  id: string;
  node: string;
  x: number;
  z: number;
  /** direction the driver travels (the light faces him) */
  dx: number;
  dz: number;
  axis: "x" | "z";
  offset: number;
}

export type SignKind = "limit" | "stop" | "giveWay" | "zebra" | "cityIn" | "cityOut" | "dir" | "oneWay" | "noEntry" | "noStop" | "airfield" | "bridge";
export interface Sign {
  kind: SignKind;
  x: number;
  z: number;
  /** direction the sign FACES (towards the approaching driver) as a unit vector */
  fx: number;
  fz: number;
  text?: string;
  sub?: string;
  tile: string;
}

export interface Landmark {
  id: string;
  name: string;
  x: number;
  z: number;
  r: number;
}

export interface Layout {
  rows: string[];
  tiles: Map<string, TileSpec>;
  tileList: TileSpec[];
  nodes: Map<string, Node>;
  edges: Edge[];
  adj: Map<string, Edge[]>;
  rules: RuleDef[];
  zebras: Zebra[];
  lights: Light[];
  zones: SpeedZone[];
  oneWays: OneWayZone[];
  noStops: NoStopZone[];
  signs: Sign[];
  landmarks: Landmark[];
  bounds: Rect;
  /** tiles that exist in the manifest (not implicit fields) */
  specAt(c: number, r: number): TileSpec;
  tileKey(c: number, r: number): string;
}

export const tileKey = (c: number, r: number): string => `${c},${r}`;
const DIRS: Record<Dir, [number, number]> = { n: [0, -1], e: [1, 0], s: [0, 1], w: [-1, 0] };
const OPP: Record<Dir, Dir> = { n: "s", e: "w", s: "n", w: "e" };

function roadable(a: TileKind, b: TileKind, d: Dir): boolean {
  const hw = (k: TileKind): boolean => k === "highway" || k === "bridge";
  if (a === "city" && b === "city") return true;
  if (a === "plaza" && b === "city") return d === "s";
  if (a === "city" && b === "plaza") return d === "n";
  if (hw(a) && hw(b)) return d === "e" || d === "w";
  if ((a === "city" && hw(b)) || (hw(a) && b === "city")) return d === "e" || d === "w";
  if ((hw(a) && b === "airfield") || (a === "airfield" && hw(b))) return d === "e" || d === "w";
  return false;
}

/** Hash for per-tile variety (deterministic). */
export function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function buildLayout(rows: string[] = SAMARKAND_ROWS): Layout {
  const kindAt = (c: number, r: number): TileKind => {
    const ch = rows[r]?.[c];
    return (ch && LEGEND[ch]) || "field";
  };
  const tiles = new Map<string, TileSpec>();
  const tileList: TileSpec[] = [];
  const mk = (c: number, r: number): TileSpec => {
    const kind = kindAt(c, r);
    const arms: Record<Dir, boolean> = { n: false, e: false, s: false, w: false };
    const link: Record<Dir, boolean> = { n: false, e: false, s: false, w: false };
    (Object.keys(DIRS) as Dir[]).forEach((d) => {
      const [dc, dr] = DIRS[d];
      const nk = kindAt(c + dc, r + dr);
      link[d] = roadable(kind, nk, d);
      // the edge of the city: a short dead-end street with a barrier
      arms[d] = link[d] || (kind === "city" && nk === "field");
    });
    const x0 = c * TILE;
    const z0 = r * TILE;
    const cx = x0 + TILE / 2;
    const cz = z0 + TILE / 2;
    const control: Control = kind === "city" ? ((c + r) % 2 === 0 ? "light" : c % 2 === 0 ? "giveWay" : "stop") : "none";
    const spec: TileSpec = {
      id: tileKey(c, r),
      c,
      r,
      kind,
      x0,
      z0,
      cx,
      cz,
      arms,
      link,
      control,
      offset: ((c * 3 + r * 5) % 7) * 2.5,
      zebraAxis: kind === "city" ? ((c + r) % 2 === 0 ? "x" : "z") : null,
      seed: Math.floor(hash2(c, r) * 1e9),
      road: [],
    };
    spec.road = roadRects(spec);
    return spec;
  };
  const bc = rows.reduce((m, s) => Math.max(m, s.length), 0);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < bc; c++) {
      const t = mk(c, r);
      tiles.set(t.id, t);
      if (t.kind !== "field") tileList.push(t);
    }
  }
  const specAt = (c: number, r: number): TileSpec => tiles.get(tileKey(c, r)) ?? mk(c, r);

  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const rules: RuleDef[] = [];
  const zebras: Zebra[] = [];
  const lights: Light[] = [];
  const signs: Sign[] = [];
  const oneWays: OneWayZone[] = [];
  const noStops: NoStopZone[] = [];
  const landmarks: Landmark[] = [];

  // ---- nodes
  const nodeKind = (k: TileKind): Node["kind"] => (k === "city" ? "city" : k === "plaza" ? "plaza" : k === "airfield" ? "airfield" : "highway");
  for (const t of tileList) nodes.set(t.id, { id: t.id, x: t.cx, z: t.cz, tile: t.id, control: t.control, kind: nodeKind(t.kind) });

  // ---- edges (both directions) between neighbouring tiles with matching arms
  const adj = new Map<string, Edge[]>();
  const addEdge = (e: Edge): void => {
    edges.push(e);
    const l = adj.get(e.from) ?? [];
    l.push(e);
    adj.set(e.from, l);
  };
  for (const t of tileList) {
    for (const d of ["e", "s"] as Dir[]) {
      if (!t.link[d]) continue;
      const [dc, dr] = DIRS[d];
      const o = tiles.get(tileKey(t.c + dc, t.r + dr));
      if (!o || !o.link[OPP[d]]) continue;
      const isHw = (k: TileKind): boolean => k === "highway" || k === "bridge" || k === "airfield";
      const hw = isHw(t.kind) && isHw(o.kind);
      const taper = (t.kind === "city" && isHw(o.kind)) || (isHw(t.kind) && o.kind === "city");
      const [dx, dz] = DIRS[d];
      const len = TILE;
      // one-way street: the E-W street between node (2,2) and (3,2) runs eastbound only
      const oneWay = t.id === "2,2" && o.id === "3,2";
      addEdge({ from: t.id, to: o.id, len, dx, dz, lanes: hw ? ROAD.hwLanes : 1, oneWay, highway: hw, taper });
      if (!oneWay) addEdge({ from: o.id, to: t.id, len, dx: -dx, dz: -dz, lanes: hw ? ROAD.hwLanes : 1, oneWay: false, highway: hw, taper });
      if (oneWay) {
        const x0 = t.cx + 14;
        const x1 = o.cx - 14;
        oneWays.push({ id: "ow1", x0, x1, z0: t.cz - 5, z1: t.cz + 5, dx: 1, dz: 0 });
        // blue "bir tomonlama" at the entrance, "kirish taqiqlangan" for traffic coming the wrong way
        signs.push({ kind: "oneWay", x: x0 + 2, z: t.cz + ROAD.cityHalf + 1, fx: -1, fz: 0, tile: t.id, text: "Bir tomonlama yo‘l" });
        signs.push({ kind: "noEntry", x: x1 - 2, z: t.cz - ROAD.cityHalf - 1, fx: 1, fz: 0, tile: o.id, text: "Kirish taqiqlangan" });
      }
    }
  }

  // ---- city intersections: stop lines, lights, signs; mid-block zebras
  for (const t of tileList) {
    if (t.kind !== "city") continue;
    const approaches: { d: Dir; dx: number; dz: number; px: number; pz: number }[] = [
      // driver comes FROM the west heading east (arm "w"), etc. Stop line before the intersection on his lane.
      { d: "w", dx: 1, dz: 0, px: t.cx - ROAD.stopLine, pz: t.cz + ROAD.lane / 2 },
      { d: "e", dx: -1, dz: 0, px: t.cx + ROAD.stopLine, pz: t.cz - ROAD.lane / 2 },
      { d: "n", dx: 0, dz: 1, px: t.cx - ROAD.lane / 2, pz: t.cz - ROAD.stopLine },
      { d: "s", dx: 0, dz: -1, px: t.cx + ROAD.lane / 2, pz: t.cz + ROAD.stopLine },
    ];
    // east-west is the priority road at stop / give-way intersections
    for (const a of approaches) {
      if (!t.arms[a.d]) continue;
      const axis: "x" | "z" = a.dx !== 0 ? "x" : "z";
      const rx = -a.dz;
      const rz = a.dx; // right-hand vector
      if (t.control === "light") {
        const id = `${t.id}:${a.d}`;
        rules.push({ type: "light", id, node: t.id, x: a.px, z: a.pz, dx: a.dx, dz: a.dz, axis, half: ROAD.lane / 2 });
        lights.push({ id, node: t.id, x: a.px + rx * (ROAD.lane / 2 + 1.2) - a.dx * 1, z: a.pz + rz * (ROAD.lane / 2 + 1.2) - a.dz * 1, dx: a.dx, dz: a.dz, axis, offset: t.offset });
      } else if (axis === "z" && (t.control === "stop" || t.control === "giveWay")) {
        const kind = t.control;
        rules.push({ type: kind, id: `${t.id}:${a.d}`, node: t.id, x: a.px, z: a.pz, dx: a.dx, dz: a.dz, half: ROAD.lane / 2 });
        signs.push({
          kind,
          x: a.px - a.dx * 1.5 + rx * (ROAD.lane / 2 + 1.1),
          z: a.pz - a.dz * 1.5 + rz * (ROAD.lane / 2 + 1.1),
          fx: -a.dx,
          fz: -a.dz,
          tile: t.id,
          text: kind === "stop" ? "STOP" : "Yo‘l bering",
        });
      }
    }
    // mid-block zebra on the east (axis x) or south (axis z) arm
    if (t.zebraAxis === "x" && t.link.e) addZebra(t, "x", t.cx + ROAD.zebraAt, t.cz);
    if (t.zebraAxis === "z" && t.link.s) addZebra(t, "z", t.cx, t.cz + ROAD.zebraAt);
  }

  function addZebra(t: TileSpec, axis: "x" | "z", x: number, z: number): void {
    const id = `z:${t.id}`;
    zebras.push({ id, x, z, axis, tile: t.id });
    const dirs = axis === "x" ? [[1, 0], [-1, 0]] : [[0, 1], [0, -1]];
    for (const [dx, dz] of dirs) {
      // judged when the car reaches 2 m before the stripes (prototype: e.s - 2)
      const px = x - dx * 3.2 + (-dz) * (ROAD.lane / 2);
      const pz = z - dz * 3.2 + dx * (ROAD.lane / 2);
      rules.push({ type: "zebra", id: `${id}:${dx},${dz}`, zebra: id, x: px, z: pz, dx, dz, half: ROAD.lane / 2 });
      const rx = -dz;
      const rz = dx;
      signs.push({ kind: "zebra", x: x - dx * 6 + rx * (ROAD.cityHalf + 1.1), z: z - dz * 6 + rz * (ROAD.cityHalf + 1.1), fx: -dx, fz: -dz, tile: t.id, text: "Piyodalar o‘tish joyi" });
    }
  }

  // ---- speed zones, settlement boards, direction boards
  const ext = (a: Rect, b: Rect): Rect => ({ x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), z0: Math.min(a.z0, b.z0), z1: Math.max(a.z1, b.z1) });
  const zones: SpeedZone[] = [];
  const cityTiles = tileList.filter((t) => t.kind === "city" || t.kind === "plaza");
  const hwTiles = tileList.filter((t) => t.kind === "highway" || t.kind === "bridge");
  const airTiles = tileList.filter((t) => t.kind === "airfield");
  const box = (list: TileSpec[]): Rect =>
    list.map((t) => ({ x0: t.x0, x1: t.x0 + TILE, z0: t.z0, z1: t.z0 + TILE })).reduce(ext);
  if (cityTiles.length) zones.push({ id: "city", ...box(cityTiles), limit: 60, name: "Samarqand", kind: "shahar" });
  if (hwTiles.length) zones.push({ id: "hw", ...box(hwTiles), limit: 90, name: "Samarqand — Toshkent trassasi", kind: "trassa" });
  if (airTiles.length) zones.push({ id: "air", ...box(airTiles), limit: 40, name: "Aerodrom", kind: "maydon" });

  const cityEast = tiles.get("3,1");
  const hwFirst = tiles.get("4,1");
  if (cityEast && hwFirst && cityEast.link.e) {
    const x = cityEast.x0 + TILE - 4;
    // facing the traffic that LEAVES the city (heading east) and the traffic that ENTERS (heading west)
    signs.push({ kind: "cityOut", x, z: cityEast.cz + 8.5, fx: -1, fz: 0, tile: cityEast.id, text: "Samarqand" });
    signs.push({ kind: "cityIn", x: x + 8, z: cityEast.cz - 8.5, fx: 1, fz: 0, tile: hwFirst.id, text: "Samarqand" });
    signs.push({ kind: "limit", x: x + 3, z: cityEast.cz + 5.2, fx: -1, fz: 0, tile: hwFirst.id, text: "90" });
    signs.push({ kind: "limit", x: x - 3, z: cityEast.cz - 5.2, fx: 1, fz: 0, tile: cityEast.id, text: "60" });
  }
  // city entry limit signs on every street end that leads out of the city were covered above; add the city's own 60 at spawn
  const spawn = tiles.get("2,1");
  if (spawn) signs.push({ kind: "limit", x: spawn.cx - 22, z: spawn.cz + ROAD.cityHalf + 1.2, fx: -1, fz: 0, tile: spawn.id, text: "60" });
  const br = tileList.find((t) => t.kind === "bridge");
  if (br) {
    signs.push({ kind: "bridge", x: br.cx - 56, z: br.cz + ROAD.hwHalf + 1.5, fx: -1, fz: 0, tile: br.id, text: "Ko‘prik" });
    signs.push({ kind: "dir", x: br.cx - 50, z: br.cz + ROAD.hwHalf + 2.5, fx: -1, fz: 0, tile: br.id, text: "Aerodrom", sub: "2 km" });
    signs.push({ kind: "dir", x: br.cx + 50, z: br.cz - ROAD.hwHalf - 2.5, fx: 1, fz: 0, tile: br.id, text: "Samarqand", sub: "1 km" });
  }
  const air = tileList.find((t) => t.kind === "airfield");
  if (air) signs.push({ kind: "airfield", x: air.x0 - 6, z: air.cz + ROAD.hwHalf + 2, fx: -1, fz: 0, tile: air.id, text: "Drift maydoni" });

  // no stopping in front of the Registan (south arm of the plaza)
  const plaza = tileList.find((t) => t.kind === "plaza");
  if (plaza) {
    const below = tiles.get(tileKey(plaza.c, plaza.r + 1));
    if (below) {
      noStops.push({ id: "ns1", x0: below.cx - 6, x1: below.cx + 6, z0: below.z0 + 8, z1: below.cz - 14 });
      signs.push({ kind: "noStop", x: below.cx + ROAD.cityHalf + 1.1, z: below.cz - 14, fx: 0, fz: 1, tile: below.id, text: "To‘xtash taqiqlangan" });
    }
    landmarks.push({ id: "registon", name: "Registon", x: plaza.cx, z: plaza.cz + 18, r: 14 });
  }
  const pick = tiles.get("1,1");
  if (pick) landmarks.push({ id: "yolovchi", name: "Yo‘lovchi", x: pick.cx - 26, z: pick.cz + ROAD.lane / 2, r: 6 });
  const bazaar = tiles.get("3,2");
  if (bazaar) landmarks.push({ id: "bozor", name: "Bozor", x: bazaar.cx, z: bazaar.cz - 30, r: 10 });
  const apt = tileList.find((t) => t.kind === "airfield");
  if (apt) landmarks.push({ id: "aerodrom", name: "Aerodrom", x: apt.x0 + TILE, z: apt.z0 + TILE, r: 40 });

  const all = tileList.map((t) => ({ x0: t.x0, x1: t.x0 + TILE, z0: t.z0, z1: t.z0 + TILE })).reduce(ext);
  return {
    rows, tiles, tileList, nodes, edges, adj, rules, zebras, lights, zones, oneWays, noStops, signs, landmarks, bounds: all, specAt, tileKey,
  };
}

/** Asphalt / concrete rectangles of a tile. */
function roadRects(t: TileSpec): RoadRect[] {
  const out: RoadRect[] = [];
  const { cx, cz, x0, z0 } = t;
  if (t.kind === "city" || t.kind === "plaza") {
    const h = ROAD.cityHalf;
    out.push({ x0: cx - h, x1: cx + h, z0: cz - h, z1: cz + h, axis: "x", surface: "asphalt" });
    if (t.kind === "city") {
      const len = (d: Dir): number => (t.link[d] ? TILE / 2 : STUB);
      if (t.arms.e) out.push({ x0: cx, x1: cx + len("e"), z0: cz - h, z1: cz + h, axis: "x", surface: "asphalt" });
      if (t.arms.w) out.push({ x0: cx - len("w"), x1: cx, z0: cz - h, z1: cz + h, axis: "x", surface: "asphalt" });
      if (t.arms.s) out.push({ x0: cx - h, x1: cx + h, z0: cz, z1: cz + len("s"), axis: "z", surface: "asphalt" });
      if (t.arms.n) out.push({ x0: cx - h, x1: cx + h, z0: cz - len("n"), z1: cz, axis: "z", surface: "asphalt" });
    } else {
      // the plaza is paved all over (stone) and the street comes in from the south
      out.push({ x0: x0 + 4, x1: x0 + TILE - 4, z0: z0 + 4, z1: z0 + TILE, axis: "z", surface: "concrete" });
    }
  } else if (t.kind === "highway" || t.kind === "bridge") {
    out.push({ x0: t.link.w ? x0 : cx, x1: t.link.e ? x0 + TILE : cx, z0: cz - ROAD.hwHalf, z1: cz + ROAD.hwHalf, axis: "x", surface: "asphalt" });
  } else if (t.kind === "airfield") {
    out.push({ x0: x0 + (t.link.w ? 0 : 6), x1: x0 + TILE - 6, z0: z0 + 6, z1: z0 + TILE - 6, axis: "x", surface: "concrete" });
    if (t.link.w) out.push({ x0, x1: x0 + 8, z0: cz - ROAD.hwHalf, z1: cz + ROAD.hwHalf, axis: "x", surface: "asphalt" });
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ queries

export type Surface = "asphalt" | "concrete" | "grass";
export const SURFACE_GRIP: Record<Surface, number> = { asphalt: 1, concrete: 0.95, grass: 0.55 };

export function surfaceAt(L: Layout, x: number, z: number): Surface {
  const t = L.specAt(Math.floor(x / TILE), Math.floor(z / TILE));
  for (const r of t.road) if (x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1) return r.surface;
  return "grass";
}

/** Height of the road surface (bridge deck profile). Only the bridge tile has any. */
export function bridgeDeckY(L: Layout, x: number, z: number): number {
  const t = L.specAt(Math.floor(x / TILE), Math.floor(z / TILE));
  if (t.kind !== "bridge") return 0;
  return deckProfile(x - t.cx);
}
/** Deck height along the bridge tile: smooth ramps over 40 m, flat 3.2 m deck above the 40 m wide river. */
export function deckProfile(dx: number): number {
  const a = Math.abs(dx);
  if (a >= 60) return 0;
  if (a <= 20) return DECK_H;
  const k = (60 - a) / 40;
  return DECK_H * (k * k * (3 - 2 * k));
}
export const DECK_H = 3.2;
export const RIVER_HALF = 24;

export function zoneAt(L: Layout, x: number, z: number): SpeedZone | null {
  for (const zn of L.zones) if (x >= zn.x0 && x < zn.x1 && z >= zn.z0 && z < zn.z1) return zn;
  return null;
}

export function inRect(r: Rect, x: number, z: number): boolean {
  return x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;
}

/** Nearest graph node to a point. */
export function nearestNode(L: Layout, x: number, z: number): Node | null {
  let best: Node | null = null;
  let bd = Infinity;
  for (const n of L.nodes.values()) {
    const d = (n.x - x) ** 2 + (n.z - z) ** 2;
    if (d < bd) {
      bd = d;
      best = n;
    }
  }
  return best;
}

/** Shortest route (list of node ids) between two nodes, respecting one-way streets. Dijkstra on a tiny graph. */
export function findRoute(L: Layout, from: string, to: string): string[] {
  if (from === to) return [from];
  const dist = new Map<string, number>([[from, 0]]);
  const prev = new Map<string, string>();
  const open = new Set<string>([from]);
  while (open.size) {
    let cur = "";
    let cd = Infinity;
    for (const id of open) {
      const d = dist.get(id) ?? Infinity;
      if (d < cd) {
        cd = d;
        cur = id;
      }
    }
    open.delete(cur);
    if (cur === to) break;
    for (const e of L.adj.get(cur) ?? []) {
      const nd = cd + e.len;
      if (nd < (dist.get(e.to) ?? Infinity)) {
        dist.set(e.to, nd);
        prev.set(e.to, cur);
        open.add(e.to);
      }
    }
  }
  if (!prev.has(to)) return [];
  const path = [to];
  while (path[0] !== from) path.unshift(prev.get(path[0])!);
  return path;
}

/** Lane centre offset (to the right of the road centreline) for lane index 0..lanes-1 (0 = nearest the centre / fast lane). */
export function laneOffset(highway: boolean, lane: number): number {
  return highway ? ROAD.hwMedian / 2 + ROAD.hwLane * (lane + 0.5) : ROAD.lane / 2;
}
