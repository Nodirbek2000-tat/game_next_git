import type RAPIER from "@dimforge/rapier3d-compat";
import { clamp, lerp } from "@/engine/math";
import type { CarSpec } from "../config";
import { axleGrip, engineCurve, slipAngle, steerLimit, type Grip } from "../logic/tyre";

export type Rapier = typeof RAPIER;

export interface DriveInput {
  /** 0..1 */
  gas: number;
  /** 0..1 */
  brake: number;
  /** -1 (left) .. 1 (right) */
  steer: number;
  handbrake: boolean;
  /** true = reverse gear */
  reverse: boolean;
}

export interface Env {
  /** surface grip multiplier at the car (asphalt 1) */
  surface: number;
  wet: number;
}

export const SUSP_REST = 0.28;

/**
 * Wheel order: 0 front-left, 1 front-right, 2 rear-left, 3 rear-right.
 * The chassis faces +z (Rapier's default forward axis); left is +x. Visual models use the same frame.
 */
export class RaycastCar {
  readonly body: RAPIER.RigidBody;
  ctl!: RAPIER.DynamicRayCastVehicleController;
  readonly input: DriveInput = { gas: 0, brake: 0, steer: 0, handbrake: false, reverse: false };
  // read-only state for the visuals / game logic (plain numbers, no allocation per frame)
  speed = 0; // signed, along the nose (m/s)
  fx = 0;
  fz = 1;
  vx = 0;
  vz = 0;
  slip = 0; // signed rad
  yawRate = 0;
  steerAngle = 0;
  grounded = 0;
  readonly wheelSpin = [0, 0, 0, 0];
  readonly wheelSusp = [0, 0, 0, 0];
  readonly wheelContact = [false, false, false, false];
  readonly wheelSlide = [0, 0, 0, 0];
  private readonly grip: Grip = { front: 1, rear: 1 };
  /** 0..1 arcade counter-steer help while sliding (kids / casual); the player's own input is added on top */
  driftAssist = 0.8;
  private steerSm = 0;
  private readonly collider: RAPIER.Collider;

  constructor(
    R: Rapier,
    private readonly world: RAPIER.World,
    readonly spec: CarSpec,
    x: number,
    y: number,
    z: number,
    yaw: number,
  ) {
    const s = spec;
    const rb = R.RigidBodyDesc.dynamic()
      .setTranslation(x, y, z)
      .setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) })
      .setLinearDamping(0.02)
      .setAngularDamping(1.1)
      .setCanSleep(false);
    this.body = world.createRigidBody(rb);
    const cd = R.ColliderDesc.cuboid(s.half[0], s.half[1], s.half[2]).setMass(s.mass).setFriction(0.1).setRestitution(0.05);
    this.collider = world.createCollider(cd, this.body);
    this.buildController();
  }

  /** (Re)creates the raycast controller and its four wheels. */
  private buildController(): void {
    const s = this.spec;
    this.ctl = this.world.createVehicleController(this.body);
    const hy = -s.half[1] * 0.4;
    const zf = s.wheelBase / 2;
    const pos = [
      { x: s.trackHalf, y: hy, z: zf },
      { x: -s.trackHalf, y: hy, z: zf },
      { x: s.trackHalf, y: hy, z: -zf },
      { x: -s.trackHalf, y: hy, z: -zf },
    ];
    for (let i = 0; i < 4; i++) {
      this.ctl.addWheel(pos[i], { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, SUSP_REST, s.wheelR);
      this.ctl.setWheelSuspensionStiffness(i, 38 + s.mass / 60);
      this.ctl.setWheelSuspensionCompression(i, 2.4);
      this.ctl.setWheelSuspensionRelaxation(i, 3.2);
      this.ctl.setWheelMaxSuspensionTravel(i, 0.3);
      this.ctl.setWheelMaxSuspensionForce(i, 100000);
      this.ctl.setWheelSideFrictionStiffness(i, 1);
      this.ctl.setWheelFrictionSlip(i, 1.5 * s.grip);
    }
  }

  /** Teleport (respawn). */
  place(x: number, y: number, z: number, yaw: number): void {
    // a fresh controller: its wheels must not remember colliders of tiles that were released after the jump
    this.world.removeVehicleController(this.ctl);
    this.buildController();
    this.body.setTranslation({ x, y, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.steerSm = 0;
  }

  /** Advance the vehicle by `dt` (call before `world.step`). */
  update(dt: number, env: Env): void {
    const s = this.spec;
    const i = this.input;
    const q = this.body.rotation();
    // forward = chassis +z rotated by q (projected on the ground plane)
    const fx = 2 * (q.x * q.z + q.w * q.y);
    const fz = 1 - 2 * (q.x * q.x + q.y * q.y);
    const fl = Math.hypot(fx, fz) || 1;
    this.fx = fx / fl;
    this.fz = fz / fl;
    const v = this.body.linvel();
    this.vx = v.x;
    this.vz = v.z;
    this.speed = v.x * this.fx + v.z * this.fz;
    this.slip = slipAngle(this.fx, this.fz, v.x, v.z);
    this.yawRate = this.body.angvel().y;

    // steering: smoothed, limited by speed; when the tail is out, counter-steer may use most of the lock
    const lock = Math.max(steerLimit(s, Math.abs(this.speed)), Math.abs(this.slip) > 0.25 ? s.steerMax * 0.8 : 0);
    // counter-steer help: point the front wheels where the car is really going (opposite lock) so a slide does not become a spin
    const sliding = Math.abs(this.speed) > 4 ? clamp(this.slip / 0.55, -1, 1) : 0;
    const cmd = clamp(i.steer + this.driftAssist * sliding, -1, 1);
    this.steerSm = lerp(this.steerSm, cmd, 1 - Math.exp(-dt * 14));
    this.steerAngle = this.steerSm * lock;

    // engine / brake forces
    const dir = i.reverse ? -1 : 1;
    const curve = engineCurve(this.speed * dir, i.reverse ? s.topSpeed * 0.25 : s.topSpeed);
    const against = this.speed * dir < 0 ? 1 : curve;
    // Rapier ignores a wheel's brake while its engine force is not exactly 0, so the pedals must never overlap:
    // braking cuts the engine (and so does a tiny leftover gas value from the input smoothing)
    const gasIn = i.gas < 0.02 || i.brake > 0.05 ? 0 : i.gas;
    const driveTotal = s.mass * s.accel * gasIn * against * dir * (i.reverse ? 0.5 : 1);
    const frontShare = 1 - s.driveRear;
    // Rapier's wheel brake is an IMPULSE per step (not a force): mass * deceleration * dt
    const braking = s.mass * s.brake * i.brake * dt;
    const bf = braking * 0.62;
    const br = braking * 0.38;
    const hb = i.handbrake ? s.mass * s.brake * 0.6 * dt : 0;
    const rest = Math.abs(this.speed) < 0.2 && i.gas < 0.02;
    const holdBrake = rest ? s.mass * 0.25 : 0; // parking brake: the car does not roll away

    axleGrip(
      { car: s, surface: env.surface, wet: env.wet, handbrake: i.handbrake, throttle: i.gas, slip: Math.abs(this.slip), speed: Math.abs(this.speed) },
      this.grip,
    );
    const baseFric = 1.5;
    const c = this.ctl;
    for (let w = 0; w < 4; w++) {
      const front = w < 2;
      const share = front ? frontShare / 2 : s.driveRear / 2;
      c.setWheelEngineForce(w, !front && i.handbrake ? 0 : driveTotal * share);
      c.setWheelBrake(w, front ? (bf + holdBrake) / 2 : (br + hb + holdBrake) / 2);
      c.setWheelFrictionSlip(w, baseFric * (front ? this.grip.front : this.grip.rear));
      c.setWheelSteering(w, front ? -this.steerAngle : 0);
    }
    c.updateVehicle(dt);
    let grounded = 0;
    for (let w = 0; w < 4; w++) {
      const on = c.wheelIsInContact(w);
      this.wheelContact[w] = on;
      if (on) grounded++;
      this.wheelSusp[w] = c.wheelSuspensionLength(w) ?? 0;
      this.wheelSpin[w] = c.wheelRotation(w) ?? 0;
      this.wheelSlide[w] = Math.abs(c.wheelSideImpulse(w) ?? 0);
    }
    this.grounded = grounded;
    // roll damping keeps the car on its wheels on a flat road
    const av = this.body.angvel();
    const roll = clamp(1 - dt * 3, 0, 1);
    this.body.setAngvel({ x: av.x * roll, y: av.y, z: av.z * roll }, true);
  }

  dispose(): void {
    this.world.removeVehicleController(this.ctl);
    this.world.removeCollider(this.collider, false);
    this.world.removeRigidBody(this.body);
  }
}
