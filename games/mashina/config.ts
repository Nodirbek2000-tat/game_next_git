// All tunable numbers of "Mashina haydash 2.0" in one place. The traffic-rule / control numbers are the ones that were
// tested in the prototype (docs/prototype/harakat-oyinlari.html, class Driving); they are DEFAULTS and can be overridden
// through the persisted game settings (see settings.ts) or URL query for tests.

export type CarId = "sedan" | "krossover" | "sport";
export type ModeId = "erkin" | "missiya" | "imtihon" | "drift";

export interface CarSpec {
  id: CarId;
  name: string;
  /** kg */
  mass: number;
  /** launch acceleration, m/s^2 (prototype driving: 7.5) */
  accel: number;
  /** m/s (at 100 % gas) */
  topSpeed: number;
  /** braking deceleration, m/s^2 (prototype: 14) */
  brake: number;
  /** base tyre grip multiplier (1 = sedan) */
  grip: number;
  /** 0..1 how easily the rear end lets go (drift tendency) */
  driftBias: number;
  /** share of engine force sent to the rear axle (0 = FWD, 1 = RWD) */
  driveRear: number;
  /** max steering lock at standstill, rad */
  steerMax: number;
  /** half extents of the body, metres [x (width), y, z (length)] */
  half: [number, number, number];
  wheelBase: number;
  trackHalf: number;
  wheelR: number;
  /** body paint sorted: first is the default */
  colors: string[];
}

export const CARS: Record<CarId, CarSpec> = {
  sedan: {
    id: "sedan", name: "Sedan", mass: 1250, accel: 5.5, topSpeed: 42, brake: 14, grip: 1.0, driftBias: 0.35, driveRear: 0.3,
    steerMax: 0.5, half: [0.9, 0.4, 2.15], wheelBase: 2.7, trackHalf: 0.78, wheelR: 0.33,
    colors: ["#c8102e", "#1565c0", "#f9a825", "#e0e0e0", "#212121", "#2e7d32"],
  },
  krossover: {
    id: "krossover", name: "Krossover", mass: 1650, accel: 4.8, topSpeed: 40, brake: 13, grip: 1.12, driftBias: 0.2, driveRear: 0.5,
    steerMax: 0.46, half: [0.95, 0.5, 2.25], wheelBase: 2.8, trackHalf: 0.82, wheelR: 0.38,
    colors: ["#2e7d32", "#ff7043", "#455a64", "#e0e0e0", "#6d4c41", "#1565c0"],
  },
  sport: {
    id: "sport", name: "Sport", mass: 1300, accel: 8.2, topSpeed: 58, brake: 16, grip: 1.15, driftBias: 0.85, driveRear: 1.0,
    steerMax: 0.52, half: [0.95, 0.32, 2.2], wheelBase: 2.6, trackHalf: 0.82, wheelR: 0.34,
    colors: ["#ffd600", "#e53935", "#7c4dff", "#00bcd4", "#212121", "#eeeeee"],
  },
};
export const CAR_IDS: CarId[] = ["sedan", "krossover", "sport"];

export const MODES: { id: ModeId; name: string; sub: string }[] = [
  { id: "erkin", name: "Erkin haydash", sub: "Ochiq shahar va trassa, missiyasiz" },
  { id: "missiya", name: "Missiyalar", sub: "Registon maydoniga yetib boring, yo‘lovchini eltib qo‘ying" },
  { id: "imtihon", name: "YHQ imtihoni", sub: "Avtomaktab uslubi: jarima ball, o‘tdi / o‘tmadi" },
  { id: "drift", name: "Drift", sub: "Aerodromda ochko yig‘ing" },
];

/** Controls (TZ 6.3). All thresholds are configurable. */
export const CONTROL_DEFAULTS = {
  /** hands: dead zone (deg) and the angle that means full lock (prototype: 5 deg / 60 deg) */
  steerDeadDeg: 5,
  steerFullDeg: 60,
  /** low-pass of pedals / steering (per second, converted from the prototype per-frame lerps at 60 fps) */
  gasSmooth: 22,
  brakeSmooth: 26,
  steerSmooth: 18,
  /** hold the brake at standstill this long to toggle reverse (TZ 6.3) */
  reverseHoldSec: 1.5,
  reverseMaxSpeed: 0.6,
  /** handbrake: right wrist drops faster than this (screen heights / s) while the left wrist stays */
  handbrakeDownVel: 1.25,
  handbrakeLeftMax: 0.45,
  handbrakeHoldSec: 0.9,
  /** camera switch: both hands above the head, min time between two switches */
  cameraCooldownSec: 1.4,
  /** kids mode: lane-keeping strength (the gas is the knee, exactly as in every other mode: there is no automatic gas) */
  kidsLaneAssist: 1.0,
  /** standing: a knee lift of `legRange` x the leg's own rest height is a full pedal (prototype: .8) */
  legRange: 0.8,
  /** the lift (fraction of a full pedal) that engages a pedal; the noise floor can only raise it. Leaves again at 55 % of it. */
  legDead: 0.14,
  /** seated mode: knee lift relative to the seated rest pose, in body scales, for a full pedal */
  seatedRange: 0.3,
  /**
   * An extra gate on the pedal value the leg reader gives out (0..1, hysteresis at half of it; 0 = no gate). Standing needs none
   * (a dead zone of 14 % of a 0.8-leg-height range is already ~5 cm of knee lift); seated the same 14 % of 0.3 body scales is under
   * 2 cm, which a shifting thigh reaches, so a seated pedal must be lifted clearly before the car moves.
   */
  pedalGate: 0,
  pedalGateSeated: 0.3,
  /** pedal calibration: both legs down and still for this long ("ikkala oyoqda turing") */
  legCalibSec: 1,
  /** a lift must persist this long before the pedal engages (kills single-frame glitches, ~1.5 frames at 30 fps) */
  legEngageSec: 0.05,
  /** wheel: the wrists must be this far apart (in shoulder widths), else the angle is noise */
  steerMinSep: 0.35,
  /** wheel: hands lost -> the last angle is held this long, then the wheel returns to the middle at this rate (1/s) */
  handsHoldSec: 0.25,
  handsCentreRate: 5,
  /** which gesture means "handbrake" */
  handbrake: "hand" as "hand" | "knees" | "off",
};
export type ControlConfig = typeof CONTROL_DEFAULTS;

/** Traffic rules (Uzbekistan YHQ), prototype numbers kept. Speeds in km/h, distances in metres. */
export const RULE_DEFAULTS = {
  limitCity: 60,
  limitHighway: 90,
  /** speeding is judged when over limit + tolerance for `speedHoldSec` */
  speedTolerance: 10,
  speedHoldSec: 1.5,
  speedCooldownSec: 6,
  /** STOP: slower than this (m/s) somewhere in the approach window */
  stopSpeed: 1.5,
  stopWindow: 40,
  /** give way: crossing traffic closer than this (m) makes passing at speed a violation */
  giveWaySpeed: 4,
  noStopSeconds: 3,
  /** score deltas (free / mission modes) */
  score: { stopOk: 150, stopBad: -150, pedOk: 200, pedBad: -250, pedHit: -300, speed: -100, crash: -100, lightOk: 120, lightBad: -250, overtake: 50, cityOk: 150, perMetre: 0.5, wrongWay: -150, noStop: -80, giveWayOk: 100, giveWayBad: -150 },
  /** exam penalty points (driving school) */
  penalty: { speed: 3, stop: 5, redLight: 10, pedestrian: 10, pedHit: 20, crash: 5, wrongWay: 5, noStop: 2, giveWay: 5, offRoad: 1 },
  /** exam passes when penalty <= examLimit and no gross violation (red light, pedestrian, STOP) */
  examLimit: 8,
  examGross: ["redLight", "pedestrian", "pedHit", "stop"] as string[],
  examTimeSec: 300,
};
export type RuleConfig = typeof RULE_DEFAULTS;

export const DRIFT_DEFAULTS = {
  /** drift counts when the body angle to the velocity is above this (deg) and speed above minSpeed (m/s) */
  minAngleDeg: 14,
  minSpeed: 7,
  /** seconds without drifting before the chain is banked */
  graceSec: 1.2,
  /** seconds in a chain per combo level */
  comboEvery: 3,
  maxCombo: 8,
  /** points per (deg * m/s * s) */
  k: 0.05,
  sessionSec: 150,
};
export type DriftConfig = typeof DRIFT_DEFAULTS;

export const DAY_SECONDS = 240; // one full day/night cycle in real seconds
