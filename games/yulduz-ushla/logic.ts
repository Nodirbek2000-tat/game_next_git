// Pure helpers of "Yulduz ushla" (stars fall, children catch them with either hand).

export const MAX_STARS = 14;

/** how many stars may be in the air: more children, more stars */
export const starCap = (kids: number): number => Math.min(MAX_STARS, 4 + 2 * Math.max(1, kids));

/** catch radius around a wrist: grows with the child's size, never smaller than a readable minimum, plus the star's own radius */
export const catchRadius = (scale: number, minScale: number, starR: number): number => Math.max(scale, minScale) * 0.6 + starR;

export function catchHit(wx: number, wy: number, sx: number, sy: number, r: number): boolean {
  const dx = wx - sx;
  const dy = wy - sy;
  return dx * dx + dy * dy <= r * r;
}

/** every 10th caught star of the group is a bonus for everybody */
export const isBonus = (caught: number): boolean => caught > 0 && caught % 10 === 0;

/** px/s a star falls at; golden stars are a little slower so they are easier to get */
export const fallSpeed = (stageH: number, gold: boolean, rnd: number): number => stageH * (gold ? 0.14 : 0.16 + rnd * 0.12);
