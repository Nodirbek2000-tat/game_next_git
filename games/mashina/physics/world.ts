import type RAPIER from "@dimforge/rapier3d-compat";
import type { BoxCollider, MeshCollider } from "../world/tileBuilder";
import type { Rect } from "../world/layout";
import type { Rapier } from "./vehicle";

export const FIXED_DT = 1 / 60;

let rapier: Promise<Rapier> | null = null;

/**
 * Load + initialise the WASM exactly ONCE per page. React StrictMode (dev) mounts the scene twice; a second `init()`
 * would instantiate the module again and invalidate every object of the first instance (Rust "unreachable" panics).
 */
function loadRapier(): Promise<Rapier> {
  rapier ??= (async () => {
    const mod = (await import("@dimforge/rapier3d-compat")) as unknown as { default: Rapier };
    await mod.default.init();
    return mod.default;
  })();
  return rapier;
}

/** The Rapier world: static colliders per streamed tile (one fixed body per tile) and a fixed-step accumulator. */
export class PhysWorld {
  readonly world: RAPIER.World;
  private bodies = new Map<string, RAPIER.RigidBody>();
  private acc = 0;

  private constructor(readonly R: Rapier) {
    this.world = new R.World({ x: 0, y: -9.81, z: 0 });
    this.world.timestep = FIXED_DT;
  }

  /** Loads the WASM (inlined in the package: no extra file to host) and creates the world. */
  static async create(): Promise<PhysWorld> {
    return new PhysWorld(await loadRapier());
  }

  addTile(id: string, boxes: BoxCollider[], meshes: MeshCollider[], ground: Rect[]): void {
    this.removeTile(id);
    const R = this.R;
    const body = this.world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const g of ground) {
      const hx = (g.x1 - g.x0) / 2;
      const hz = (g.z1 - g.z0) / 2;
      this.world.createCollider(R.ColliderDesc.cuboid(hx, 0.5, hz).setTranslation(g.x0 + hx, -0.5, g.z0 + hz).setFriction(1), body);
    }
    for (const b of boxes) {
      const d = R.ColliderDesc.cuboid(b.hx, b.hy, b.hz)
        .setTranslation(b.x, b.y, b.z)
        .setRotation({ x: 0, y: Math.sin(b.yaw / 2), z: 0, w: Math.cos(b.yaw / 2) })
        .setFriction(0.3)
        .setRestitution(0.15);
      this.world.createCollider(d, body);
    }
    for (const m of meshes) this.world.createCollider(R.ColliderDesc.trimesh(m.verts, m.idx).setFriction(1), body);
    this.bodies.set(id, body);
  }

  removeTile(id: string): void {
    const b = this.bodies.get(id);
    if (!b) return;
    this.world.removeRigidBody(b);
    this.bodies.delete(id);
  }

  has(id: string): boolean {
    return this.bodies.has(id);
  }

  /** Run fixed steps for `dt` seconds; `pre` is called before every step (vehicle update). Returns the steps made. */
  advance(dt: number, pre: (h: number) => void, post?: (h: number) => void): number {
    this.acc = Math.min(this.acc + dt, FIXED_DT * 5);
    let n = 0;
    while (this.acc >= FIXED_DT) {
      pre(FIXED_DT);
      this.world.step();
      post?.(FIXED_DT);
      this.acc -= FIXED_DT;
      n++;
    }
    return n;
  }

  dispose(): void {
    this.bodies.clear();
    this.world.free();
  }
}
