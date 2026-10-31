// Every tuning number of the crowd (Bog‘cha, 2..5 children) vision path lives here:
// camera size, tiled detection, the tile controller, duplicate merging, smooth motion, hold times, slot matching.
// Adult games never read this file's values (they use engine/config.ts and the full-frame path).

export const CROWD_CFG = {
  camera: {
    /** crowd games ask for 720p: a child far away has 4x the pixels of a 360p picture. The browser picks the closest mode. */
    width: 1280,
    height: 720,
    fps: 30,
    /** phones / tablets: smaller (decode + copy cost, heat) */
    mobileWidth: 960,
    mobileHeight: 540,
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
    maxCycleMs: 150,
    /** more crops are tried again only when the predicted round would be shorter than this */
    upCycleMs: 85,
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

  /** between detections: extrapolate along a velocity that fades out, and let the drawn point chase it (no hard stops, no jumps) */
  motion: {
    /** time constant of the fading velocity: the point coasts at most velocity x tau x gain after the last detection */
    holdTauMs: 450,
    gain: 0.9,
    /**
     * The drawn point follows its target with a time constant of `chaseFrac` x the time between two detections of this child (smooths the
     * jump when a new detection arrives), within [chaseMinMs, chaseMaxMs]: quick when detections are frequent, so the extra delay stays small.
     */
    chaseFrac: 0.35,
    chaseMinMs: 25,
    chaseMaxMs: 110,
    /** after a long gap between detections the chase is slow at first (smooth catch-up) and relaxes to normal with this time constant, s */
    chaseRelaxSec: 0.3,
    /** a longer pause between two render calls snaps the point to its target (tab was hidden) */
    snapAfterSec: 0.25,
    /** velocity estimate limit, in shoulder widths per second (noise at low detection rates can invent 20 m/s) */
    maxSpeedScales: 8,
    /** velocities are measured across gaps up to this long (the old code gave up after 200 ms) */
    velGapMs: 700,
    /** the time step used for the signals (jump, squat...) is capped here */
    maxDtSec: 0.6,
    leadMs: 8,
  },

  hold: {
    /** a child counts as "present" (and keeps interacting) this long after the last detection; grows with the round time */
    presentSec: 0.8,
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
} as const;
