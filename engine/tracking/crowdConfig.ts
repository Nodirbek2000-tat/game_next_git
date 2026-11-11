// Every tuning number of the crowd (Bog‘cha, 2..5 children) vision path lives here:
// camera size, tiled detection, the tile controller, duplicate merging, smooth motion, hold times, slot matching.
// Adult games never read this file's values (they use engine/config.ts and the full-frame path).

export const CROWD_CFG = {
  camera: {
    /** crowd games ask for 720p: a child far away has 4x the pixels of a 360p picture. The browser picks the closest mode. */
    width: 1280,
    height: 720,
    fps: 30,
    /** phones / tablets: smaller (decode + copy cost, heat), 4:3 = the whole sensor of a phone camera (16:9 is cut out of it) */
    mobileWidth: 960,
    mobileHeight: 720,
  },

  tiles: {
    /**
     * Also analyse a centre crop (left / centre / right). Off: for 16:9 the left and right square crops already overlap by ~22 %, the
     * centre crop adds ~50 % more model work for a child who stands exactly on the seam, who is already visible in both crops.
     */
    centre: false,
    /** frames narrower than this (width / height) are not cropped: a 4:3 picture would give two crops that are 75 % of the frame each */
    minAspect: 1.45,
    /** least overlap of neighbouring crops (fraction of the crop width), so a body on the seam is complete in at least one crop */
    overlapMin: 0.12,
    /** longest side (px) of the picture sent to the model for one crop; the model resamples to 224/256 itself, the landmark stage profits from the extra pixels */
    side: 512,
    /** the same, when the picture is brightened (the brightening runs on the main thread, pixel by pixel) */
    sideDark: 384,
    /** a body is taken from a crop only when its centre is inside the zone the crop owns, +- this margin (fraction of the frame width) */
    ownMargin: 0.03,
    /** a crop result older than this is not mixed into the "everybody in view" list that the menu cursor uses */
    staleMs: 450,
    /** phones: no crops by default (3 model instances = memory and heat) */
    mobile: false,
    /** main thread back-end: no crops by default (model time blocks rendering); ?tiles=2 forces them */
    mainThread: false,
  },

  merge: {
    /** two bodies from different crops are one child when their boxes overlap by this fraction of the smaller box */
    overlap: 0.5,
    /** body box = box around nose / shoulders / hips, grown by this fraction of its longer side */
    boxPad: 0.15,
    /** landmarks seen worse than this do not shape the box (unless fewer than two are seen) */
    minVis: 0.15,
    /** a body cut by the inner edge of its crop is less trustworthy: score x (1 - penalty * share of cut landmarks) */
    truncPenalty: 0.5,
    /** "cut" = within this fraction of the crop width from an inner crop edge */
    edgeMargin: 0.04,
  },

  /** the controller that moves between 3 crops, 2 crops and the old full-frame path */
  adapt: {
    /** a child must be refreshed at least every this many ms (one full round of all crops); slower -> fewer crops */
    maxCycleMs: 260,
    /** more crops are tried again only when the predicted round would be shorter than this */
    upCycleMs: 150,
    downAfterSec: 1.5,
    upAfterSec: 12,
    /** quiet time after each change */
    cooldownSec: 4,
    /** the "up" wait doubles after each up that was followed by a down within 30 s, at most this many times */
    backoffMax: 8,
    /** fixed cost per call that is not model time (copy of the picture, message to the worker), ms */
    overheadMs: 3,
    /** model time of a crop relative to the full frame when only the full frame has been measured */
    tileVsFull: 0.75,
    emaK: 0.15,
  },

  /**
   * Filtering of the measured points. Landmarks of a small child in a crop shake by a few percent of the body width from one
   * detection to the next; real motion (walking, a waving arm) is several times larger. So the filter looks at the SIZE of every
   * new measurement against the smoothed point (in body scales, the shoulder width): a small change is mostly noise and is averaged
   * over `tauMs` (heavy smoothing), a big change is real and passes almost unfiltered (the weight rises steeply around `knee`).
   * Then a dead zone (`dead`) keeps the output still while the smoothed point only wobbles inside it.
   * The body (shoulder centre) is filtered on its own; every other point as an offset from the body, so the animal does not
   * wobble inside itself when the child walks, and a waving hand does not shake the body.
   */
  smooth: {
    /** body anchor (shoulder centre) */
    body: { tauMs: 300, knee: 0.1, dead: 0.015 },
    /** head, shoulders, hips: a rigid frame around the anchor, change slowly */
    torso: { tauMs: 300, knee: 0.09, dead: 0.012 },
    /** elbows, wrists, knees, ankles: move a lot relative to the body */
    limb: { tauMs: 180, knee: 0.12, dead: 0.018 },
    /** a landmark that is seen badly is less trustworthy: the knee grows by this factor at visibility 0 */
    lowVisKnee: 0.5,
    /** size (shoulder width) and head radius: slow, a change of more than ~`scaleKnee` (relative) is real */
    scaleTauMs: 600,
    scaleKnee: 0.16,
  },

  /** between detections: extrapolate along the measured velocity and let the drawn point chase it (no hard stops, no jumps) */
  motion: {
    /**
     * The picture shown is `capture -> now` old (camera + model, 100-250 ms). The point is moved on along its velocity by the full age
     * up to `coastMs`, then the extra fades out with `holdTauMs` (a child who vanished glides to a stop instead of freezing or flying off).
     */
    coastMs: 280,
    holdTauMs: 220,
    gain: 0.85,
    /** limbs (elbows, wrists, knees, ankles) are extrapolated this much of the body's way (they swing back and forth) */
    limbGain: 0.6,
    /** velocity smoothing when it rises (a drop is taken at once, so a child who stops does not overshoot) */
    velTauMs: 90,
    /** speed (body scales / s) at which the velocity counts half: slower drifts are noise and are not extrapolated at all */
    velKnee: 0.15,
    /**
     * The drawn point follows its target with a time constant of `chaseFrac` x the time between two detections of this child (smooths the
     * jump when a new detection arrives), within [chaseMinMs, chaseMaxMs]. The target is aimed `chase` ahead along the velocity, so the
     * chase adds no lag to a steady walk.
     */
    chaseFrac: 0.9,
    chaseMinMs: 40,
    chaseMaxMs: 200,
    /** the target of the chase is aimed at most this far ahead along the velocity (a long chase must not push a waving hand past its turning point), ms */
    chaseAheadMaxMs: 90,
    /** after a long gap between detections the chase is slow at first (smooth catch-up) and relaxes to normal with this time constant, s */
    chaseRelaxSec: 0.3,
    /** a longer pause between two render calls snaps the point to its target (tab was hidden) */
    snapAfterSec: 0.25,
    /** velocity estimate limit, in shoulder widths per second (noise at low detection rates can invent 20 m/s) */
    maxSpeedScales: 8,
    /** a velocity is measured over at least this long a baseline (ms): shorter gaps (the same child from two crops) only carry noise */
    velMinGapMs: 45,
    /** velocities are measured across gaps up to this long (the old code gave up after 200 ms) */
    velGapMs: 700,
    /** the time step used for the signals (jump, squat...) is capped here */
    maxDtSec: 0.6,
    leadMs: 8,
  },

  hold: {
    /** a child counts as "present" (and keeps interacting) this long after the last detection; grows with the round time */
    presentSec: 1.0,
    /** the round time is multiplied by this to get the same, when it is longer */
    cycleFactor: 2.5,
    /** `held` is set when the child was not seen for this long but is still present */
    heldAfterSec: 0.25,
    /** the slot is given up after this many seconds without the child (at least; also longer than the present time + 1.2 s) */
    freeSec: 2,
    /** a new child may take the slot of a child who has been gone this long, never one who is gone shorter */
    stealMinLostSec: 1.0,
  },

  join: {
    /** a person must be seen this many times at about the same place before it becomes a child (one false detection is no child) */
    confirm: 2,
    withinMs: 800,
  },

  match: {
    /** position continuity: max distance in shoulder widths ... */
    scales: 2.6,
    /** ... plus this much per second while the child is away (at most `growMax` extra) */
    growPerSec: 1.2,
    growMax: 2.5,
    maxFrac: 0.5,
    /** a person whose size differs more than this from the slot's child is someone else */
    scaleRatio: 3,
    /** a slot that has not been seen for a while loses ties against a slot that has: cost x (1 + this x seconds away, <= 2 s) */
    staleCost: 0.6,
    /** the slot's predicted position uses its velocity for at most this long */
    predictMaxSec: 0.4,
  },

  /**
   * The alternative crowd detector (?pose=movenet): MoveNet MultiPose Lightning, TensorFlow.js, up to 6 people in one pass.
   * It runs in a Web Worker (tracking/movenet.worker.ts), so the picture the children see never waits for it; only the DETECTION rate
   * adapts to the device. ?pose=movenet-main is the old main-thread path (debug only).
   */
  movenet: {
    /**
     * What a crowd game uses when neither ?pose= nor a remembered choice says: "mediapipe" or "movenet" (the worker). Measured on the
     * reference laptop (Intel UHD, 6 people on screen): MoveNet worker ~18 detections/s, 4.9 of 5 children, 60 fps; MediaPipe crops
     * 2-9 detections/s, ~half of the children. MoveNet is the default; a browser without worker WebGL falls back to MediaPipe by itself.
     */
    defaultBackend: "movenet" as "mediapipe" | "movenet",
    /** where the self-hosted tfjs graph model lives (public/models/movenet-multipose) */
    modelUrl: "/models/movenet-multipose/model.json",
    /** a person (whole-body score of the model) below this is dropped (join.confirm already filters one-off false positives) */
    minPoseScore: 0.18,
    /** a keypoint below this score gets visibility 0 */
    minKeypoint: 0.08,
    /**
     * MoveNet keypoint scores of a seen point are 0.3-0.6 where MediaPipe's visibility is ~0.95: visibility = min(1, score / visScale),
     * so isKid / hipsOk / minVis / lowVisKnee treat both detectors alike.
     */
    visScale: 0.45,
    /** longest side (px) of the picture shown to the model: multiples of 32, the rungs of the adaptive ladder. Rung 0 is an emergency rung. */
    sides: [192, 256, 320, 384],
    /** index into `sides` the session starts on */
    startIdx: 1,
    /** rungs below this index are emergency rungs: left only when a call takes more than `emergencyMs` */
    floorIdx: 1,
    emergencyMs: 120,
    /**
     * Time of a model call (round trip, EMA, ms). Above `downMs` the picture gets smaller (fewer than ~13 detections/s); below `upMs`
     * (estimated for the next rung by area) it gets bigger. The call runs in a worker, so these judge throughput, not UI blocking.
     */
    downMs: 75,
    upMs: 40,
    downAfterSec: 2,
    upAfterSec: 8,
    cooldownSec: 6,
    /** the "up" wait doubles (at most 4 times) after an up that was followed by a down within this many seconds */
    backoffWithinSec: 40,
    emaK: 0.12,
    /** most detections per second: the integrated GPU keeps headroom for compositing the page */
    maxHz: 20,
    /** the worker answers nothing for this long (ms) while a picture is in flight: MediaPipe takes over */
    watchdogMs: 6000,
    /** starting the worker + downloading the model: no message for this long (ms) = give up, MediaPipe takes over */
    initTimeoutMs: 20000,
    /** compiling the shaders while loading (silent calls in the worker, ~3-5 s on an Intel UHD, more on a weak phone) */
    warmTimeoutMs: 60000,
  },
} as const;
